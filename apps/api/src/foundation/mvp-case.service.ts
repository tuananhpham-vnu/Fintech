import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { canonicalJson, requestHash } from './canonical'
import { CaseMutations } from './case-mutations'
import { CoreRepository, projectCase, requireUuid } from './core.repository'
import { FoundationError, notFound } from './errors'
import { FOUNDATION_CONFIG, FOUNDATION_DB } from './ports'
import type { AuthSession, FoundationConfig, FoundationDatabase, SqlClient } from './ports'
import { validateContract } from './validation'

const EXPOSURE_VERSION = 'AIC-MVP-EXPOSURE-1'
const DEFAULT_REPLAY_MS = 24 * 60 * 60 * 1000
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const reason = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0
const invalid = (code = 'INVALID_INPUT'): never => {
  throw new FoundationError(422, code)
}
const iso = (value: Date | string) => new Date(value).toISOString()

interface SourceBinding {
  binding_id: string
  source_kind: 'declaration' | 'document'
  source_id: string
  document_version: number | null
  document_sha256: string | null
  evidence_ref: string | null
  reported_by: 'organization' | 'counterparty'
  response_revision?: number | null
  questionnaire_id?: string | null
  question_id?: string | null
}
interface PreparedExposure {
  sourceId: string
  exposure: Record<string, unknown>
  aggregate: Record<string, unknown>
  bindings: SourceBinding[]
  recordedAt: string
}

/**
 * Sandbox business service only. The controller owns local enablement and
 * Origin/CSRF. No environment reads, policy registration, verification workflow,
 * settlement arithmetic, automatic lifecycle transition or retention cleanup.
 */
@Injectable()
export class MvpCaseService {
  private readonly config: FoundationConfig
  private readonly mutations: CaseMutations

  constructor(
    @Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) config: FoundationConfig,
    private readonly core: CoreRepository,
    mutations: CaseMutations,
  ) {
    this.config = {
      ...config,
      idempotencyTtlMs:
        config.idempotencyTtlMs === undefined ? DEFAULT_REPLAY_MS : config.idempotencyTtlMs,
    }
    for (const value of [this.config.idempotencyTtlMs, this.config.sessionIdleMs])
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error('Invalid MVP case duration configuration')
    // CaseMutations is stateless. Use the same primitive with the normalized
    // duration when a direct caller has omitted the approved technical default.
    this.mutations =
      config.idempotencyTtlMs === undefined ? new CaseMutations(db, this.config, core) : mutations
  }

  private principal(session: AuthSession): AuthSession {
    if (
      !session ||
      !uuid.test(session.id) ||
      !uuid.test(session.user?.id) ||
      !uuid.test(session.user?.organization_id) ||
      session.user?.role !== 'specialist'
    )
      throw new FoundationError(401, 'SESSION_EXPIRED')
    return { ...session, user: { ...session.user } }
  }

  private async active(tx: SqlClient, session: AuthSession): Promise<void> {
    const result = await tx.query('SELECT * FROM aic.lock_active_session($1,$2,$3,$4)', [
      session.id,
      session.user.id,
      session.user.organization_id,
      this.config.sessionIdleMs,
    ])
    if (!result.rows[0]) throw new FoundationError(401, 'SESSION_EXPIRED')
  }

  private input(name: string, body: unknown): any {
    // Take ownership before awaiting locks, including nested source references.
    const snapshot = JSON.parse(canonicalJson(body))
    validateContract(name, snapshot)
    return snapshot
  }

  private key(key: string): void {
    if (typeof key !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(key)) invalid()
  }

  private semantics(kind: string, exposure: any): void {
    if (!['RECEIVABLE', 'PREPAYMENT'].includes(kind)) invalid('UNSUPPORTED_EXPOSURE_KIND')
    const receivable = kind === 'RECEIVABLE'
    if (
      exposure.organization_role !== (receivable ? 'seller' : 'buyer') ||
      exposure.counterparty_role !== (receivable ? 'buyer' : 'seller')
    )
      invalid('EXPOSURE_ROLE_MISMATCH')
    if (
      exposure.amount_vnd === null
        ? !reason(exposure.amount_missing_reason)
        : exposure.amount_missing_reason !== undefined && exposure.amount_missing_reason !== null
    )
      invalid()
    const payer = receivable ? 'counterparty' : 'organization'
    const payee = receivable ? 'organization' : 'counterparty'
    for (const claim of exposure.claims ?? []) {
      const claimant = claim.kind === 'paid' ? payer : payee
      if (
        claim.payer_party !== payer ||
        claim.payee_party !== payee ||
        claim.claimant_party !== claimant
      )
        invalid('CLAIM_ROLE_MISMATCH')
      if (claim.source_refs.some((source: any) => source.reported_by !== claimant))
        invalid('CLAIM_SOURCE_ROLE_MISMATCH')
      if (
        claim.amount_vnd === null
          ? !reason(claim.amount_missing_reason)
          : claim.amount_missing_reason !== null
      )
        invalid()
      if (claim.event_state === 'proposed' && claim.occurred_on !== null) invalid()
      if (
        claim.event_state === 'actual' &&
        claim.occurred_on === null &&
        !reason(claim.date_missing_reason)
      )
        invalid()
      if (claim.occurred_on !== null && claim.date_missing_reason !== null) invalid()
    }
    for (const condition of exposure.conditions) {
      if (
        !reason(condition.scope) ||
        (condition.reported_state === 'unknown' && !reason(condition.missing_reason))
      )
        invalid()
    }
  }

  private project(row: any): Record<string, unknown> {
    const body = { ...projectCase(row), policy_artifact_hash: row.policy_artifact_hash ?? null }
    validateContract('Case', body, true)
    return body
  }

  private async clock(tx: SqlClient): Promise<string> {
    return iso((await tx.query('SELECT clock_timestamp() AS recorded_at')).rows[0].recorded_at)
  }

  private async policy(tx: SqlClient, org: string, kind: string, stage: string, at: string) {
    // Count assignments before validating their artifacts: a corrupt candidate
    // must not hide ambiguity or cause a fallback to a different policy.
    const assignments = await tx.query(
      `SELECT * FROM aic.mvp_policy_assignments
      WHERE organization_id=$1 AND exposure_kind=$2 AND effective_from<=$3::timestamptz
        AND (effective_until IS NULL OR $3::timestamptz<effective_until)`,
      [org, kind, at],
    )
    if (!assignments.rows.length) throw new FoundationError(503, 'POLICY_NOT_CONFIGURED')
    if (assignments.rows.length !== 1) throw new FoundationError(409, 'POLICY_ASSIGNMENT_AMBIGUOUS')
    const assignment = assignments.rows[0]
    return this.boundPolicy(
      tx,
      assignment.policy_version,
      assignment.artifact_hash,
      kind,
      stage,
      at,
    )
  }

  private async boundPolicy(
    tx: SqlClient,
    version: string,
    hash: string,
    kind: string,
    stage: string,
    at: string,
  ) {
    if (!reason(version) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
      throw new FoundationError(409, 'POLICY_BINDING_REQUIRED')
    const record = (
      await tx.query(
        `SELECT * FROM aic.mvp_policy_artifacts
      WHERE version=$1 AND sha256=$2 AND approved_at<=$3::timestamptz
        AND effective_from<=$3::timestamptz`,
        [version, hash, at],
      )
    ).rows[0]
    const artifact = record?.artifact_json
    const instant = Date.parse(at)
    const approval = Date.parse(artifact?.approval?.recorded_at)
    const effective = Date.parse(artifact?.effective_from)
    const until =
      artifact?.effective_until === null ? Infinity : Date.parse(artifact?.effective_until)
    if (
      !record ||
      !artifact ||
      artifact.artifact_kind !== 'case_policy' ||
      artifact.status !== 'approved' ||
      artifact.runtime_eligible !== true ||
      artifact.policy_version !== record.version ||
      requestHash(artifact) !== record.sha256 ||
      !reason(artifact.approval?.source) ||
      !reason(artifact.approval?.scope) ||
      !Number.isFinite(approval) ||
      approval > instant ||
      !Number.isFinite(effective) ||
      effective < approval ||
      effective > instant ||
      !(instant < until) ||
      artifact.scope?.currency !== 'VND' ||
      !Array.isArray(artifact.scope?.exposure_kinds) ||
      !artifact.scope.exposure_kinds.includes(kind) ||
      !Array.isArray(artifact.scope?.lifecycle_stages) ||
      !artifact.scope.lifecycle_stages.includes(stage) ||
      !Array.isArray(artifact.checklist) ||
      artifact.checklist.length === 0 ||
      artifact.financial_method_boundary?.method_version !== null ||
      artifact.financial_method_boundary?.activate_fhi_pilot !== false ||
      artifact.financial_method_boundary?.allow_numeric_without_separate_method_approval !== false
    )
      throw new FoundationError(503, 'INVALID_POLICY_ARTIFACT')
    return { version: record.version as string, hash: record.sha256 as string }
  }

  private async prepare(
    tx: SqlClient,
    session: AuthSession,
    current: any,
    input: any,
    revision: number,
    recordedAt: string,
  ): Promise<PreparedExposure> {
    this.semantics(current.exposure_kind, input)
    const sourceId = randomUUID(),
      bindings: SourceBinding[] = [],
      allSources: any[] = []
    const bind = async (sources: any[]) => {
      const resolved: any[] = []
      for (const source of sources) {
        let response: any = null
        if (source.kind === 'questionnaire') {
          response = (
            await tx.query(
              `SELECT r.* FROM aic.mvp_staff_responses r
            WHERE r.organization_id=$1 AND r.case_id=$2 AND r.id=$3 AND r.revision=$4
              AND r.questionnaire_id=$5 AND r.question_id=$6 AND r.reported_by=$7 AND r.answer_state<>'skipped'
              AND NOT EXISTS(SELECT 1 FROM aic.mvp_staff_responses later WHERE later.organization_id=r.organization_id AND later.case_id=r.case_id AND later.id=r.id AND later.revision>r.revision)`,
              [
                session.user.organization_id,
                current.id,
                source.response_id,
                source.response_revision,
                source.questionnaire_id,
                source.question_id,
                source.reported_by,
              ],
            )
          ).rows[0]
          if (!response) invalid('INVALID_QUESTIONNAIRE_SOURCE')
        }
        if (source.kind === 'document') {
          // A matching PDF alone is insufficient: the evidence must actually
          // exist in a published result for this exact tenant/case/version/hash.
          const found = await tx.query(
            `SELECT d.id FROM aic.mvp_documents d
            WHERE d.organization_id=$1 AND d.case_id=$2 AND d.id=$3 AND d.version=$4 AND d.hash=$5
              AND EXISTS (SELECT 1 FROM aic.mvp_document_results r
                WHERE r.organization_id=d.organization_id AND r.case_id=d.case_id AND r.document_id=d.id
                  AND r.document_version=d.version AND r.sha256=d.hash AND r.outcome='published'
                  AND r.raw_extraction->>'document_id'=d.id::text
                  AND r.raw_extraction->>'case_id'=d.case_id::text AND r.raw_extraction->>'sha256'=d.hash
                  AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE
                    WHEN jsonb_typeof(r.raw_extraction->'evidence')='array' THEN r.raw_extraction->'evidence'
                    ELSE '[]'::jsonb END) evidence
                    WHERE evidence->>'id'=$6 AND evidence->>'document_id'=d.id::text))`,
            [
              session.user.organization_id,
              current.id,
              source.document_id,
              source.document_version,
              source.document_sha256,
              source.evidence_ref,
            ],
          )
          if (!found.rows[0]) invalid('INVALID_EXPOSURE_SOURCE')
        }
        const binding: SourceBinding = {
          binding_id: randomUUID(),
          source_kind: source.kind,
          source_id:
            source.kind === 'declaration'
              ? sourceId
              : source.kind === 'questionnaire'
                ? source.response_id
                : source.document_id,
          document_version: source.kind === 'document' ? source.document_version : null,
          document_sha256: source.kind === 'document' ? source.document_sha256 : null,
          evidence_ref: source.kind === 'document' ? source.evidence_ref : null,
          reported_by: source.reported_by,
          response_revision: response ? Number(response.revision) : null,
          questionnaire_id: response?.questionnaire_id ?? null,
          question_id: response?.question_id ?? null,
        }
        bindings.push(binding)
        const ref = {
          ...source,
          binding_id: binding.binding_id,
          source_id: binding.source_id,
          source_revision:
            source.kind === 'declaration'
              ? revision
              : response
                ? Number(response.revision)
                : source.document_version,
          ...(response
            ? {
                origin: response.origin,
                entered_by: response.entered_by,
                source_created_at: iso(response.created_at),
                verification: 'unverified',
                identity_assurance: 'self_reported',
              }
            : {}),
        }
        resolved.push(ref)
        allSources.push(ref)
      }
      return resolved
    }
    const conditions: any[] = [],
      claims: any[] = []
    for (const condition of input.conditions)
      conditions.push({
        ...condition,
        id: randomUUID(),
        source_refs: await bind(condition.source_refs),
        verification: 'unverified',
      })
    for (const claim of input.claims ?? [])
      claims.push({
        ...claim,
        id: randomUUID(),
        source_refs: await bind(claim.source_refs),
        verification: 'unverified',
      })
    const exposure = {
      ...input,
      schema_version: EXPOSURE_VERSION,
      amount_missing_reason: input.amount_missing_reason ?? null,
      term_null_reason: input.term_null_reason ?? null,
      due_date: input.due_date ?? null,
      source_origin: 'staff_entered',
      conditions,
      claims,
      source_refs: allSources,
      verification: 'unverified',
    }
    validateContract('ExposureRead', exposure, true)
    const aggregate = {
      schema_version: EXPOSURE_VERSION,
      organization_id: session.user.organization_id,
      case_id: current.id,
      counterparty_id: current.counterparty_id,
      exposure_kind: current.exposure_kind,
      lifecycle_stage: current.lifecycle_stage,
      revision,
      source_id: sourceId,
      entered_by: session.user.id,
      created_at: recordedAt,
      exposure,
    }
    return { sourceId, exposure, aggregate, bindings, recordedAt }
  }

  private async persist(
    tx: SqlClient,
    session: AuthSession,
    caseId: string,
    revision: number,
    prepared: PreparedExposure,
  ): Promise<void> {
    await tx.query(
      `INSERT INTO aic.mvp_exposure_versions
      (organization_id,case_id,revision,source_id,aggregate_json,entered_by,created_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::timestamptz)`,
      [
        session.user.organization_id,
        caseId,
        revision,
        prepared.sourceId,
        canonicalJson(prepared.aggregate),
        session.user.id,
        prepared.recordedAt,
      ],
    )
    for (const binding of prepared.bindings)
      await tx.query(
        `INSERT INTO aic.mvp_exposure_source_bindings
        (organization_id,case_id,exposure_revision,binding_id,source_kind,source_id,
          document_version,document_sha256,evidence_ref,reported_by,response_revision,questionnaire_id,question_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          session.user.organization_id,
          caseId,
          revision,
          binding.binding_id,
          binding.source_kind,
          binding.source_id,
          binding.document_version,
          binding.document_sha256,
          binding.evidence_ref,
          binding.reported_by,
          binding.response_revision ?? null,
          binding.questionnaire_id ?? null,
          binding.question_id ?? null,
        ],
      )
  }

  async create(sessionInput: AuthSession, key: string, body: unknown) {
    const session = this.principal(sessionInput),
      input = this.input('CaseCreateInput', body)
    this.key(key)
    this.semantics(input.exposure_kind, input.exposure)
    const hash = requestHash(input)
    const scope = [session.user.organization_id, session.user.id, 'case.create', key]
    return this.db.transaction(async (tx) => {
      await this.active(tx, session)
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [canonicalJson(scope)])
      await this.active(tx, session)
      const cached = (
        await tx.query(
          `SELECT *,expires_at>clock_timestamp() AS active
        FROM aic.idempotency_keys WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4`,
          scope,
        )
      ).rows[0]
      if (cached) {
        await this.core.assertCaseAccess(tx, session.user, cached.response_body.id, true)
        await this.active(tx, session)
        if (!cached.active || cached.request_hash !== hash)
          throw new FoundationError(409, 'IDEMPOTENCY_CONFLICT')
        return { status: 201 as const, body: cached.response_body, replayed: true }
      }
      const counterparty = await tx.query('SELECT * FROM aic.lock_case_counterparty($1,$2,$3)', [
        session.user.organization_id,
        session.user.id,
        input.counterparty_id,
      ])
      if (!counterparty.rows[0]) throw notFound()
      // Same namespace as the registry's INSERT trigger, shared on resolution:
      // immutable policy rows need SELECT only, never UPDATE for row locking.
      await tx.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
        `mvp_policy_assignment:${session.user.organization_id}:${input.exposure_kind}`,
      ])
      await this.active(tx, session)
      const recordedAt = await this.clock(tx)
      const policy = await this.policy(
        tx,
        session.user.organization_id,
        input.exposure_kind,
        input.lifecycle_stage,
        recordedAt,
      )
      const id = randomUUID()
      const prepared = await this.prepare(
        tx,
        session,
        { id, ...input },
        input.exposure,
        1,
        recordedAt,
      )
      await this.active(tx, session)
      await tx.query("SET LOCAL synchronous_commit = 'on'")
      const row = (
        await tx.query(
          `INSERT INTO aic.cases
        (id,organization_id,counterparty_id,exposure_kind,lifecycle_stage,exposure_json,revision,
          policy_version,policy_artifact_hash,method_version,created_by,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,1,$7,$8,NULL,$9,$10::timestamptz,$10::timestamptz) RETURNING *`,
          [
            id,
            session.user.organization_id,
            input.counterparty_id,
            input.exposure_kind,
            input.lifecycle_stage,
            canonicalJson(prepared.exposure),
            policy.version,
            policy.hash,
            session.user.id,
            recordedAt,
          ],
        )
      ).rows[0]
      await this.persist(tx, session, id, 1, prepared)
      const result = this.project(row)
      await tx.query(
        `INSERT INTO aic.audit_events
        (id,organization_id,case_id,actor_type,actor_id,action,subject_id,revision_before,revision_after,metadata_json)
        VALUES($1,$2,$3,'specialist',$4,'case.created',$3,NULL,1,$5::jsonb)`,
        [
          randomUUID(),
          session.user.organization_id,
          id,
          session.user.id,
          canonicalJson({
            policy_version: policy.version,
            policy_artifact_hash: policy.hash,
            exposure_source_id: prepared.sourceId,
            verification: 'unverified',
          }),
        ],
      )
      await tx.query(
        `INSERT INTO aic.idempotency_keys
        (organization_id,actor_id,operation,key,request_hash,response_status,response_body,expires_at)
        VALUES($1,$2,$3,$4,$5,201,$6::jsonb,clock_timestamp()+($7::bigint*interval '1 millisecond'))`,
        [...scope, hash, canonicalJson(result), this.config.idempotencyTtlMs],
      )
      await this.active(tx, session)
      return { status: 201 as const, body: result, replayed: false }
    })
  }

  async update(sessionInput: AuthSession, caseId: string, key: string, body: unknown) {
    const session = this.principal(sessionInput),
      input = this.input('ExposureUpdateInput', body)
    requireUuid(caseId)
    this.key(key)
    return this.mutations.execute(session, caseId, {
      operation: 'exposure.update',
      key,
      expectedRevision: input.expected_revision,
      payload: input.exposure,
      work: async (tx, current, nextRevision) => {
        // Validate the immutable binding at case creation, not today's registry
        // assignment/effectivity. Historical cases without approval stay closed.
        await this.boundPolicy(
          tx,
          current.policy_version,
          current.policy_artifact_hash,
          current.exposure_kind,
          current.lifecycle_stage,
          iso(current.created_at),
        )
        const recordedAt = await this.clock(tx)
        const prepared = await this.prepare(
          tx,
          session,
          current,
          input.exposure,
          nextRevision,
          recordedAt,
        )
        await this.active(tx, session)
        await tx.query("SET LOCAL synchronous_commit = 'on'")
        await this.persist(tx, session, caseId, nextRevision, prepared)
        const row = (
          await tx.query(
            `UPDATE aic.cases SET exposure_json=$3::jsonb,
          revision=$4,updated_at=$5::timestamptz WHERE organization_id=$1 AND id=$2 RETURNING *`,
            [
              session.user.organization_id,
              caseId,
              canonicalJson(prepared.exposure),
              nextRevision,
              recordedAt,
            ],
          )
        ).rows[0]
        // CaseMutations owns the final revision write, audit and frozen replay.
        // A changed case revision invalidates dependent review snapshots without
        // altering or deleting any historical result/source/verification record.
        return { status: 200, body: this.project(row), action: 'exposure.updated' }
      },
    })
  }
}
