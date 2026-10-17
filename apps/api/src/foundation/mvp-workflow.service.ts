import { Inject, Injectable, Optional } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { projectLegacyExtraction } from '../documents/evidence-projection'
import { canonicalJson, requestHash } from './canonical'
import { CaseMutations } from './case-mutations'
import { CoreRepository, requireUuid } from './core.repository'
import { FoundationError, notFound } from './errors'
import { FOUNDATION_CONFIG, FOUNDATION_DB } from './ports'
import type { AuthSession, FoundationConfig, FoundationDatabase, SqlClient } from './ports'
import { validateContract } from './validation'
import { MvpQuestionnaireService } from './mvp-questionnaire.service'

const RULES_VERSION = 'AIC-MVP-DOCUMENT-TRANSACTION-1'
const REQUIREMENTS = [
  'counterparty_identity_source',
  'financial_minimum',
  'transaction_contract',
  'delivery_acceptance_source',
  'paid_received_source',
  'refund_guarantee_source',
  'supplementary_tax_invoice',
]
const conflict = (code: string): never => {
  throw new FoundationError(409, code)
}
const invalid = (code = 'INVALID_INPUT'): never => {
  throw new FoundationError(422, code)
}
const iso = (value: string | Date) => new Date(value).toISOString()
const hashBytes = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** Sandbox workflow only. No automatic fact verification, FHI, delivery/payment
 * inference, outbound messaging, migrations, policy registration or job startup. */
@Injectable()
export class MvpWorkflowService {
  constructor(
    @Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) private readonly config: FoundationConfig,
    private readonly core: CoreRepository,
    private readonly mutations: CaseMutations,
    @Optional() private readonly questionnaires?: MvpQuestionnaireService,
  ) {
    for (const duration of [config.sessionIdleMs, config.idempotencyTtlMs])
      if (!Number.isSafeInteger(duration) || duration < 1)
        throw new Error('Invalid workflow duration')
  }

  private input(name: string, body: unknown): any {
    const snapshot = JSON.parse(canonicalJson(body))
    validateContract(name, snapshot)
    return snapshot
  }

  private output(name: string, body: any): any {
    validateContract(name, body, true)
    return body
  }

  private async active(tx: SqlClient, session: AuthSession): Promise<void> {
    if (!session || !session.user || session.user.role !== 'specialist')
      throw new FoundationError(401, 'SESSION_EXPIRED')
    const result = await tx.query('SELECT * FROM aic.lock_active_session($1,$2,$3,$4)', [
      session.id,
      session.user.id,
      session.user.organization_id,
      this.config.sessionIdleMs,
    ])
    if (!result.rows[0]) throw new FoundationError(401, 'SESSION_EXPIRED')
  }

  private async access(tx: SqlClient, session: AuthSession, caseId: string) {
    await this.active(tx, session)
    const current = await this.core.assertCaseAccess(tx, session.user, caseId, true)
    await this.active(tx, session)
    return current
  }

  private async now(tx: SqlClient): Promise<string> {
    return iso((await tx.query('SELECT clock_timestamp() AS at')).rows[0].at)
  }

  private async policy(tx: SqlClient, current: any) {
    const row = (
      await tx.query(
        `SELECT * FROM aic.mvp_policy_artifacts
      WHERE version=$1 AND sha256=$2`,
        [current.policy_version, current.policy_artifact_hash],
      )
    ).rows[0]
    const artifact = row?.artifact_json
    if (
      !artifact ||
      artifact.artifact_kind !== 'case_policy' ||
      artifact.status !== 'approved' ||
      artifact.runtime_eligible !== true ||
      requestHash(artifact) !== current.policy_artifact_hash ||
      artifact.policy_version !== current.policy_version ||
      !artifact.approval?.source ||
      !artifact.scope?.exposure_kinds?.includes(current.exposure_kind) ||
      artifact.scope.currency !== 'VND' ||
      !Array.isArray(artifact.checklist) ||
      artifact.checklist.length !== REQUIREMENTS.length ||
      new Set(artifact.checklist.map((item: any) => item.requirement_key)).size !==
        REQUIREMENTS.length ||
      REQUIREMENTS.some(
        (key) => !artifact.checklist.some((item: any) => item.requirement_key === key),
      ) ||
      artifact.checklist.find((item: any) => item.requirement_key === 'financial_minimum')
        .waivable !== false
    )
      throw new FoundationError(503, 'INVALID_POLICY_ARTIFACT')
    return artifact
  }

  private activated(key: string, current: any): boolean {
    const exposure = current.exposure_json
    const conditions = exposure.conditions ?? []
    switch (key) {
      case 'counterparty_identity_source':
      case 'financial_minimum':
        return true
      case 'transaction_contract':
        return current.lifecycle_stage === 'active'
      case 'delivery_acceptance_source':
        return conditions.some((item: any) => ['delivery', 'acceptance'].includes(item.kind))
      case 'paid_received_source':
        return (exposure.claims ?? []).some((claim: any) => claim.event_state === 'actual')
      case 'refund_guarantee_source':
        return conditions.some(
          (item: any) =>
            item.kind === 'guarantee' ||
            (current.exposure_kind === 'PREPAYMENT' && item.kind === 'refund'),
        )
      case 'supplementary_tax_invoice':
        return true
      default:
        return false
    }
  }

  private async sources(tx: SqlClient, current: any) {
    const org = current.organization_id
    const docs = (
      await tx.query(
        `SELECT d.*,j.state AS job_state,r.id AS result_id,r.raw_extraction AS extraction
      FROM aic.mvp_documents d JOIN aic.mvp_document_lineages l ON l.organization_id=d.organization_id
        AND l.case_id=d.case_id AND l.current_document_id=d.id
      JOIN aic.mvp_document_jobs j ON j.organization_id=d.organization_id AND j.case_id=d.case_id AND j.document_id=d.id
      LEFT JOIN aic.mvp_document_results r ON r.organization_id=d.organization_id AND r.case_id=d.case_id
        AND r.document_id=d.id AND r.document_version=d.version AND r.sha256=d.hash AND r.outcome='published'
      WHERE d.organization_id=$1 AND d.case_id=$2 ORDER BY d.id`,
        [org, current.id],
      )
    ).rows
    const counterparty = (
      await tx.query(
        `SELECT id,revision,identity_status FROM aic.counterparties
      WHERE organization_id=$1 AND id=$2 FOR SHARE`,
        [org, current.counterparty_id],
      )
    ).rows[0]
    const projections = docs.map((doc) => {
      if (!doc.extraction) return null
      try {
        return projectLegacyExtraction(doc, doc.extraction)
      } catch {
        return null
      }
    })
    const decisions = (
      await tx.query(
        `SELECT * FROM aic.mvp_document_decisions WHERE organization_id=$1 AND case_id=$2 ORDER BY case_revision`,
        [org, current.id],
      )
    ).rows
    for (const doc of docs) {
      const classification = decisions
        .filter((d) => d.document_id === doc.id && d.kind === 'classification')
        .at(-1)
      doc.source_review =
        Number(classification?.payload_json?.counterparty_revision) ===
        Number(counterparty.revision)
          ? classification.payload_json
          : null
      const projection = projections[docs.indexOf(doc)]
      for (const correction of decisions.filter(
        (d) => d.document_id === doc.id && ['correction', 'verification'].includes(d.kind),
      )) {
        const field = projection?.fields.find(
          (f) => f.field_key === correction.payload_json.field_key,
        )
        if (field) {
          if (correction.kind === 'correction') field.value = correction.payload_json.value
          field.evidence_refs = correction.payload_json.evidence_refs
          field.quality =
            Number(correction.payload_json.counterparty_revision) === Number(counterparty.revision)
              ? 'human_reviewed'
              : 'uncertain'
          field.missing_reason = field.value === null ? 'human_marked_missing' : null
        }
      }
    }
    const policy = await this.policy(tx, current)
    const snapshot = {
      policy_version: current.policy_version,
      policy_artifact_hash: current.policy_artifact_hash,
      exposure_kind: current.exposure_kind,
      lifecycle_stage: current.lifecycle_stage,
      exposure: current.exposure_json,
      counterparty: { ...counterparty, revision: Number(counterparty.revision) },
      documents: docs.map((doc) => ({
        id: doc.id,
        lineage: doc.lineage,
        version: doc.version,
        hash: doc.hash,
        pages: doc.pages,
        type: doc.type,
        source_class: doc.source_class,
        job_state: doc.job_state,
        result_id: doc.result_id ?? null,
        extraction_hash: doc.extraction ? requestHash(doc.extraction) : null,
        verification: 'unverified',
      })),
      human_verification: 'pending',
      human_decisions: decisions.map((d) => ({
        id: d.id,
        document_id: d.document_id,
        case_revision: Number(d.case_revision),
        kind: d.kind,
        payload: d.payload_json,
      })),
      questionnaires: this.questionnaires ? await this.questionnaires.listTx(tx, current) : [],
    }
    return { policy, docs, projections, counterparty, snapshot }
  }

  private findings(
    current: any,
    sources: Awaited<ReturnType<MvpWorkflowService['sources']>>,
    waivers: any[],
    requests: any[],
  ) {
    const findings: any[] = []
    const add = (
      key: string,
      category: string,
      severity: string,
      summary: string,
      limitations: string[],
      refs: string[] = [],
      absence?: string,
    ) => {
      const identity = createHash('sha256')
        .update('aic-mvp-issue-1:' + current.id + ':' + key)
        .digest()
        .subarray(0, 16)
      identity[6] = (identity[6] & 15) | 0x80
      identity[8] = (identity[8] & 63) | 0x80
      const hex = identity.toString('hex'),
        id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
      const finding: any = {
        id,
        issue_key: key,
        rule_id: key,
        category,
        severity,
        summary,
        evidence_refs: [...new Set(refs)],
        finding_state: 'open',
        handling_state: 'none',
        limitations,
      }
      if (absence !== undefined) finding.absence_basis = absence
      findings.push(finding)
      return finding
    }
    for (const row of sources.policy.checklist) {
      if (!this.activated(row.requirement_key, current)) continue
      const present = sources.docs.some(
        (doc) =>
          row.document_types.includes(doc.source_review?.declared_type) &&
          doc.source_review?.subject_match === 'match',
      )
      if (!present) {
        const financial = row.requirement_key === 'financial_minimum'
        const optional = row.classification === 'optional'
        const finding = add(
          row.requirement_key,
          financial ? 'financial_minimum' : 'missing_document',
          financial || optional ? 'info' : 'warning',
          `Missing documentary support: ${row.requirement_key}`,
          [
            row.missing_behavior,
            'Absence of a document does not establish absence of the underlying fact.',
          ],
          [],
          'No current document has matching specialist-reviewed scope and a policy-listed supporting type.',
        )
        if (
          waivers.some((waiver) => waiver.requirement_key === row.requirement_key && waiver.active)
        ) {
          finding.handling_state = 'waived'
          finding.limitations.push(
            row.waiver_scope,
            'Missing support remains missing; no fact has been verified.',
          )
        } else if (
          requests.some(
            (request) =>
              request.status === 'approved' && request.requirement_key === row.requirement_key,
          )
        )
          finding.handling_state = 'requested'
      }
    }
    const refs = sources.projections.flatMap(
      (projection) => projection?.evidence.map((item) => item.id) ?? [],
    )
    if (sources.counterparty.identity_status === 'conflicting')
      add(
        'identity_conflict',
        'identity_conflict',
        'blocker',
        'Counterparty identity is conflicting.',
        ['Affected identity conclusions are blocked. A waiver cannot resolve this conflict.'],
        refs,
      )
    else if (sources.counterparty.identity_status !== 'confirmed')
      add(
        'identity_pending',
        'identity_uncertainty',
        'warning',
        'Counterparty identity remains unresolved.',
        ['A declared registration and AI extraction do not verify the legal entity.'],
        refs,
      )
    sources.docs.forEach((doc, index) => {
      const projection = sources.projections[index]
      if (doc.source_review?.subject_match === 'mismatch')
        add(
          `document_subject_mismatch:${doc.id}`,
          'identity_conflict',
          'blocker',
          `Specialist identified a subject mismatch in document ${doc.id}.`,
          ['Wrong subject source cannot satisfy documentary requirements or resolve findings.'],
          projection?.evidence.map((e) => e.id) ?? [],
        )
      add(
        `document_unverified:${doc.id}`,
        'source_uncertainty',
        'info',
        `Document ${doc.id} is declared, not verified.`,
        [
          'Document classification, identity, dates, amounts and signatures remain subject to human verification.',
        ],
        projection?.evidence.map((item) => item.id) ?? [],
      )
      if (
        !projection ||
        !projection.fields.length ||
        projection.fields.some(
          (field) =>
            !['readable', 'human_reviewed'].includes(field.quality) || field.value === null,
        )
      )
        add(
          `extraction_uncertain:${doc.id}`,
          'source_uncertainty',
          'warning',
          `Document ${doc.id} has missing or uncertain extraction.`,
          [
            'Unreadable, absent, failed or uncertain extraction is not silently replaced with a confirmed fact.',
          ],
          projection?.evidence.map((item) => item.id) ?? [],
        )
      if (doc.type === 'invoice')
        add(
          `invoice_not_payment:${doc.id}`,
          'transaction_uncertainty',
          'info',
          'An invoice is not proof of payment or receipt.',
          ['No settlement or outstanding amount is inferred from invoices.'],
          projection?.evidence.map((item) => item.id) ?? [],
        )
    })
    for (const condition of current.exposure_json.conditions ?? []) {
      add(
        `condition_unverified:${condition.id}`,
        'transaction_uncertainty',
        'warning',
        `Reported ${condition.kind} condition remains unverified.`,
        [
          'Proposed or reported satisfaction is distinct from verified satisfaction.',
          condition.missing_reason,
        ].filter(Boolean),
        (condition.source_refs ?? []).flatMap((source: any) =>
          refs.includes(source.evidence_ref) ? [source.evidence_ref] : [],
        ),
      )
    }
    for (const claim of current.exposure_json.claims ?? []) {
      add(
        `claim_unverified:${claim.id}`,
        'transaction_uncertainty',
        'warning',
        `${claim.event_state} ${claim.kind} claim remains unverified.`,
        [
          'Paid and received claims are not netted, summed or treated as independent verified settlements.',
          'Unknown amounts remain unknown; missing support is not zero or nonpayment.',
        ],
        (claim.source_refs ?? []).flatMap((source: any) =>
          refs.includes(source.evidence_ref) ? [source.evidence_ref] : [],
        ),
      )
    }
    return findings
  }

  private async requests(tx: SqlClient, current: any) {
    const rows = (
      await tx.query(
        `SELECT * FROM aic.mvp_document_requests WHERE organization_id=$1 AND case_id=$2 ORDER BY created_at,id`,
        [current.organization_id, current.id],
      )
    ).rows
    return rows.map((row) => this.requestOutput(row))
  }
  private requestOutput(row: any) {
    return this.output('DocumentRequest', {
      id: row.id,
      status: row.status,
      revision: Number(row.revision),
      run_id: row.run_id,
      issue_id: row.issue_id,
      purpose: row.purpose,
      content: row.content,
      document_types: row.document_types,
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at),
      ...(row.approved_hash
        ? { approved_payload: row.approved_payload, approved_hash: row.approved_hash }
        : {}),
    })
  }
  private async waivers(tx: SqlClient, current: any) {
    const rows = (
      await tx.query(
        `SELECT w.*,r.created_at revoked_at FROM aic.mvp_waivers w LEFT JOIN aic.mvp_waiver_revocations r
      ON r.organization_id=w.organization_id AND r.case_id=w.case_id AND r.waiver_id=w.id
      WHERE w.organization_id=$1 AND w.case_id=$2 ORDER BY w.created_at,w.id`,
        [current.organization_id, current.id],
      )
    ).rows
    return rows.map((w) =>
      this.output('Waiver', {
        id: w.id,
        actor_id: w.actor_id,
        policy_version: w.policy_version,
        created_at: iso(w.created_at),
        active: !w.revoked_at,
        requirement_key: w.requirement_key,
        reason: w.reason,
        issue_id: w.issue_id,
        revoked_at: w.revoked_at ? iso(w.revoked_at) : null,
      }),
    )
  }
  private async latest(tx: SqlClient, current: any) {
    const row = (
      await tx.query(
        `SELECT * FROM aic.mvp_review_runs WHERE organization_id=$1 AND case_id=$2
      ORDER BY case_revision DESC,id DESC LIMIT 1`,
        [current.organization_id, current.id],
      )
    ).rows[0]
    const cp = (
      await tx.query(
        'SELECT revision FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE',
        [current.organization_id, current.counterparty_id],
      )
    ).rows[0]
    return row
      ? {
          ...row.payload_json,
          stale:
            Number(row.case_revision) !== Number(current.revision) ||
            Number(row.payload_json.counterparty_revision) !== Number(cp?.revision),
        }
      : null
  }
  async detail(session: AuthSession, caseId: string) {
    requireUuid(caseId)
    return this.db.transaction(async (tx) => {
      const current = await this.access(tx, session, caseId),
        policy = await this.policy(tx, current)
      const review = await this.latest(tx, current),
        waivers = await this.waivers(tx, current),
        requests = await this.requests(tx, current)
      const readiness = this.output('Readiness', {
        case_revision: Number(current.revision),
        document_review_allowed: true,
        numeric_assessment_allowed: false,
        method_status: 'unconfigured',
        blockers: [
          {
            code: 'FHI_METHOD_UNCONFIGURED',
            message: 'Separate financial method approval is required.',
          },
        ],
        limitations: ['Document review does not verify facts or approve a transaction.'],
        waivable_requirements:
          review && !review.stale
            ? policy.checklist
                .filter(
                  (p: any) =>
                    p.waivable &&
                    review.findings.some(
                      (f: any) =>
                        f.issue_key === p.requirement_key && f.category === 'missing_document',
                    ),
                )
                .map((p: any) => ({
                  requirement_key: p.requirement_key,
                  label: p.requirement_key,
                  issue_id: review.findings.find((f: any) => f.issue_key === p.requirement_key).id,
                }))
            : [],
      })
      await this.active(tx, session)
      return {
        latest_review_run_id: review?.id ?? null,
        review_stale: review?.stale ?? false,
        findings: review?.findings ?? [],
        issue_history: review?.issue_history ?? [],
        readiness,
        requests,
        waivers,
        transaction_review: review?.transaction_review ?? null,
        questionnaires: this.questionnaires ? await this.questionnaires.listTx(tx, current) : [],
      }
    })
  }
  async run(session: AuthSession, caseId: string, key: string, body: unknown) {
    const input = this.input('RevisionInput', body)
    return this.mutations.execute(session, caseId, {
      operation: 'review.run',
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        const review = await this.saveReview(tx, current, next)
        return { status: 201, body: review, action: 'review.completed' }
      },
    })
  }
  private async saveReview(tx: SqlClient, current: any, next: number) {
    const caseId = current.id
    const sources = await this.sources(tx, current),
      waivers = await this.waivers(tx, current),
      requests = await this.requests(tx, current)
    // Bind approved requests to their immutable finding's requirement key.
    for (const request of requests) {
      const run = (
        await tx.query(
          'SELECT payload_json FROM aic.mvp_review_runs WHERE organization_id=$1 AND case_id=$2 AND id=$3',
          [current.organization_id, current.id, request.run_id],
        )
      ).rows[0]
      ;(request as any).requirement_key = run?.payload_json.findings.find(
        (f: any) => f.id === request.issue_id,
      )?.issue_key
    }
    const findings = this.findings(current, sources, waivers, requests),
      at = await this.now(tx)
    const sourceHash = requestHash(sources.snapshot)
    const prior = await this.latest(tx, current)
    const history = [...(prior?.issue_history ?? []), ...(prior?.findings ?? [])]
      .filter(
        (f: any, index: number, all: any[]) =>
          !findings.some((active: any) => active.id === f.id) &&
          all.findIndex((a) => a.id === f.id) === index,
      )
      .map((f: any) => ({ ...f, finding_state: 'open', handling_state: 'none' }))
    const decisions = (
      await tx.query(
        'SELECT * FROM aic.mvp_issue_decisions WHERE organization_id=$1 AND case_id=$2 ORDER BY case_revision',
        [current.organization_id, caseId],
      )
    ).rows
    for (const f of [...findings, ...history]) {
      const decision = decisions.filter((d) => d.issue_id === f.id).at(-1)
      if (decision?.source_snapshot_hash === sourceHash) {
        f.finding_state =
          decision.action === 'resolve'
            ? 'verified_resolved'
            : decision.action === 'dismiss'
              ? 'dismissed'
              : 'open'
      }
    }
    const review = this.output('ReviewRun', {
      id: randomUUID(),
      case_id: caseId,
      case_revision: next,
      rules_version: RULES_VERSION,
      policy_version: current.policy_version,
      snapshot_hash: requestHash({ ...sources.snapshot, waivers, requests }),
      source_snapshot_hash: sourceHash,
      counterparty_revision: Number(sources.counterparty.revision),
      state: 'completed',
      stale: false,
      findings,
      issue_history: history,
      transaction_review: {
        exposure_kind: current.exposure_kind,
        status: findings.some((f) => f.severity === 'blocker')
          ? 'BLOCKED'
          : findings.length
            ? 'FOLLOW_UP'
            : 'UNKNOWN',
        findings,
        limitations: [
          'No verified settlement or outstanding balance is computed.',
          'Human verification remains required.',
        ],
        verified_settlement_vnd: null,
        verified_outstanding_vnd: null,
      },
      financial_health: {
        status: 'unconfigured',
        score: null,
        band: null,
        grade: null,
        pd: null,
        blockers: ['FHI_METHOD_UNCONFIGURED', 'VERIFIED_FINANCIAL_INPUTS_REQUIRED'],
      },
      created_at: at,
    })
    await tx.query(
      `INSERT INTO aic.mvp_review_runs(id,organization_id,case_id,case_revision,snapshot_hash,policy_version,payload_json,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [
        review.id,
        current.organization_id,
        caseId,
        next,
        review.snapshot_hash,
        current.policy_version,
        canonicalJson(review),
        at,
      ],
    )
    return review
  }
  async decideIssue(session: AuthSession, issueId: string, key: string, body: unknown) {
    requireUuid(issueId)
    const input = this.input('IssueDecisionInput', body)
    // An opaque issue identifier never grants access to a case or other tenant.
    const bound = await this.db.transaction(async (tx) => {
      await this.active(tx, session)
      const row = (
        await tx.query(
          `SELECT case_id FROM aic.mvp_review_runs WHERE organization_id=$1
          AND (payload_json->'findings' @> $2::jsonb OR payload_json->'issue_history' @> $2::jsonb)
          ORDER BY case_revision DESC LIMIT 1`,
          [session.user.organization_id, canonicalJson([{ id: issueId }])],
        )
      ).rows[0]
      if (!row) throw notFound()
      await this.access(tx, session, row.case_id)
      return row
    })
    return this.mutations.execute(session, bound.case_id, {
      operation: 'issue.decision:' + issueId,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        const review = await this.latest(tx, current)
        if (!review || review.stale || review.state !== 'completed')
          conflict('CURRENT_REVIEW_REQUIRED')
        const finding = [...review.findings, ...(review.issue_history ?? [])].find(
          (f: any) => f.id === issueId,
        )
        if (!finding) throw notFound()
        const sources = await this.sources(tx, current)
        const sourceHash = requestHash(sources.snapshot)
        if (review.source_snapshot_hash !== sourceHash) conflict('STALE_SOURCE')
        const available = sources.projections.flatMap((projection, i) => {
          const doc = sources.docs[i]
          const complete =
            projection &&
            projection.fields.length > 0 &&
            Array.isArray(projection.raw.pages) &&
            projection.raw.pages.length === doc.pages &&
            Array.isArray(projection.raw.diagnostics) &&
            !projection.raw.diagnostics.length &&
            projection.fields.every(
              (f) => f.value !== null && ['readable', 'human_reviewed'].includes(f.quality),
            )
          return doc.job_state === 'succeeded' && doc.source_review?.subject_match === 'match'
            ? (projection?.evidence
                .filter((e) => doc.source_review.reviewed_pages.includes(e.page))
                .map((e) => ({ ...e, type: doc.source_review.declared_type, complete })) ?? [])
            : []
        })
        if (input.evidence_refs.some((ref: string) => !available.some((e) => e.id === ref)))
          invalid('CURRENT_REVIEWED_EVIDENCE_REQUIRED')
        if (input.action !== 'reopen' && !input.evidence_refs.length) invalid('EVIDENCE_REQUIRED')
        if (
          input.action === 'reopen'
            ? finding.finding_state === 'open'
            : finding.finding_state !== 'open'
        )
          conflict('INVALID_ISSUE_STATE')
        if (input.action === 'resolve') {
          if (
            input.evidence_refs.some(
              (ref: string) => !available.some((e) => e.id === ref && e.complete),
            )
          )
            conflict('PARTIAL_SOURCE_CANNOT_RESOLVE')
          // A waiver, dismissed label, partial extraction or client assertion
          // cannot make the current detector stop observing the issue.
          if (this.findings(current, sources, [], []).some((f) => f.id === issueId))
            conflict('ISSUE_STILL_PRESENT')
          const requirement = sources.policy.checklist.find(
            (r: any) => r.requirement_key === finding.issue_key,
          )
          if (
            requirement &&
            !available.some(
              (e) =>
                input.evidence_refs.includes(e.id) && requirement.document_types.includes(e.type),
            )
          )
            invalid('ISSUE_SOURCE_SCOPE_MISMATCH')
          const documentIssue =
            /^(?:document_subject_mismatch|extraction_uncertain|document_unverified|invoice_not_payment):(.+)$/.exec(
              finding.issue_key,
            )
          if (documentIssue) {
            const target = (
              await tx.query(
                'SELECT lineage FROM aic.mvp_documents WHERE organization_id=$1 AND case_id=$2 AND id=$3',
                [current.organization_id, current.id, documentIssue[1]],
              )
            ).rows[0]
            if (
              !target ||
              !available.some(
                (e) =>
                  input.evidence_refs.includes(e.id) &&
                  sources.docs.some((d) => d.id === e.document_id && d.lineage === target.lineage),
              )
            )
              invalid('ISSUE_SOURCE_SCOPE_MISMATCH')
          }
          if (
            /^(?:claim_unverified:|condition_unverified:|identity_pending$|identity_conflict$)/.test(
              finding.issue_key,
            )
          )
            conflict('FACT_VERIFICATION_CONTRACT_NOT_RELEASED')
        }
        // Dismissal is a recorded human disposition; detector findings, source
        // limitations and transaction/financial gates remain independently intact.
        const id = randomUUID()
        const saved = (
          await tx.query(
            `INSERT INTO aic.mvp_issue_decisions(id,organization_id,case_id,issue_id,run_id,source_snapshot_hash,case_revision,action,reason,evidence_refs,actor_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING created_at`,
            [
              id,
              current.organization_id,
              current.id,
              issueId,
              review.id,
              sourceHash,
              next,
              input.action,
              input.reason,
              canonicalJson(input.evidence_refs),
              session.user.id,
            ],
          )
        ).rows[0]
        const updated = await this.saveReview(tx, current, next)
        const issue = [...updated.findings, ...updated.issue_history].find(
          (f: any) => f.id === issueId,
        )
        return {
          status: 200,
          body: this.output('IssueDecisionOutput', {
            issue,
            revision: next,
            decision_id: id,
            created_at: iso(saved.created_at),
          }),
          action: 'issue.' + input.action,
          reason: input.reason,
          subjectId: issueId,
          metadata: { run_id: review.id, source_snapshot_hash: sourceHash },
        }
      },
    })
  }
  async getRun(session: AuthSession, runId: string) {
    requireUuid(runId)
    return this.db.transaction(async (tx) => {
      await this.active(tx, session)
      const row = (
        await tx.query('SELECT * FROM aic.mvp_review_runs WHERE organization_id=$1 AND id=$2', [
          session.user.organization_id,
          runId,
        ])
      ).rows[0]
      if (!row) throw notFound()
      const current = await this.access(tx, session, row.case_id)
      return this.output('ReviewRun', {
        ...row.payload_json,
        stale:
          Number(row.case_revision) !== Number(current.revision) ||
          Number(row.payload_json.counterparty_revision) !==
            Number(
              (
                await tx.query(
                  'SELECT revision FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE',
                  [current.organization_id, current.counterparty_id],
                )
              ).rows[0]?.revision,
            ),
      })
    })
  }
  private async resource(
    session: AuthSession,
    table: 'mvp_document_requests' | 'mvp_waivers',
    id: string,
  ) {
    requireUuid(id)
    return this.db.transaction(async (tx) => {
      await this.active(tx, session)
      const row = (
        await tx.query(`SELECT * FROM aic.${table} WHERE organization_id=$1 AND id=$2`, [
          session.user.organization_id,
          id,
        ])
      ).rows[0]
      if (!row) throw notFound()
      await this.access(tx, session, row.case_id)
      return row
    })
  }
  private async history(tx: SqlClient, session: AuthSession, row: any) {
    await tx.query(
      `INSERT INTO aic.mvp_request_history(id,organization_id,case_id,request_id,request_revision,payload_json,actor_id)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        randomUUID(),
        row.organization_id,
        row.case_id,
        row.id,
        row.revision,
        canonicalJson(this.requestOutput(row)),
        session.user.id,
      ],
    )
  }
  private async freshRequestSource(tx: SqlClient, current: any, runId: string) {
    const review = (
      await tx.query(
        'SELECT case_revision,payload_json FROM aic.mvp_review_runs WHERE organization_id=$1 AND case_id=$2 AND id=$3',
        [current.organization_id, current.id, runId],
      )
    ).rows[0]
    if (!review) conflict('STALE_REVIEW')
    if (
      Number(review.payload_json.counterparty_revision) !==
      Number(
        (
          await tx.query(
            'SELECT revision FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE',
            [current.organization_id, current.counterparty_id],
          )
        ).rows[0]?.revision,
      )
    )
      conflict('STALE_REVIEW')
    const changed = (
      await tx.query(
        `SELECT 1 FROM aic.audit_events WHERE organization_id=$1 AND case_id=$2 AND revision_after>$3
      AND action NOT IN ('request.drafted','request.edited') LIMIT 1`,
        [current.organization_id, current.id, review.case_revision],
      )
    ).rows[0]
    if (changed) conflict('STALE_REVIEW')
  }
  async draft(session: AuthSession, caseId: string, key: string, body: unknown) {
    return this.saveDraft(session, caseId, undefined, key, body)
  }
  async editDraft(session: AuthSession, id: string, key: string, body: unknown) {
    const row = await this.resource(session, 'mvp_document_requests', id)
    return this.saveDraft(session, row.case_id, id, key, body)
  }
  private async saveDraft(
    session: AuthSession,
    caseId: string,
    id: string | undefined,
    key: string,
    body: unknown,
  ) {
    const input = this.input('RequestDraftInput', body)
    return this.mutations.execute(session, caseId, {
      operation: id ? 'request.edit:' + id : 'request.draft',
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current) => {
        await this.policy(tx, current)
        const review = (
          await tx.query(
            'SELECT * FROM aic.mvp_review_runs WHERE organization_id=$1 AND case_id=$2 AND id=$3',
            [current.organization_id, caseId, input.run_id],
          )
        ).rows[0]
        // Draft/approval mutations themselves advance case revision. Source freshness
        // is established below by the source snapshot, rather than an edit counter.
        if (!review || !review.payload_json.findings.some((f: any) => f.id === input.issue_id))
          invalid('INVALID_REQUEST_FINDING')
        if (Number(review.case_revision) !== Number(current.revision) && !id)
          conflict('STALE_REVIEW')
        if (id) await this.freshRequestSource(tx, current, input.run_id)
        const at = await this.now(tx)
        let row: any
        if (id) {
          const old = (
            await tx.query(
              'SELECT * FROM aic.mvp_document_requests WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE',
              [current.organization_id, caseId, id],
            )
          ).rows[0]
          if (!old || old.status !== 'draft') conflict('REQUEST_NOT_DRAFT')
          if (old.run_id !== input.run_id || old.issue_id !== input.issue_id)
            invalid('REQUEST_BINDING_IMMUTABLE')
          row = (
            await tx.query(
              `UPDATE aic.mvp_document_requests SET purpose=$4,content=$5,document_types=$6::jsonb,revision=revision+1,updated_at=$7
            WHERE organization_id=$1 AND case_id=$2 AND id=$3 RETURNING *`,
              [
                current.organization_id,
                caseId,
                id,
                input.purpose,
                input.content,
                JSON.stringify(input.document_types),
                at,
              ],
            )
          ).rows[0]
        } else
          row = (
            await tx.query(
              `INSERT INTO aic.mvp_document_requests(id,organization_id,case_id,run_id,issue_id,purpose,content,document_types,status,revision,created_by,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'draft',1,$9,$10,$10) RETURNING *`,
              [
                randomUUID(),
                current.organization_id,
                caseId,
                input.run_id,
                input.issue_id,
                input.purpose,
                input.content,
                JSON.stringify(input.document_types),
                session.user.id,
                at,
              ],
            )
          ).rows[0]
        await this.history(tx, session, row)
        return {
          status: id ? 200 : 201,
          body: this.requestOutput(row),
          action: id ? 'request.edited' : 'request.drafted',
          subjectId: row.id,
        }
      },
    })
  }
  async decideRequest(
    session: AuthSession,
    id: string,
    mode: 'approve' | 'cancel' | 'ack',
    key: string,
    body: unknown,
  ) {
    const input = this.input('ReasonInput', body),
      bound = await this.resource(session, 'mvp_document_requests', id)
    if (!['approve', 'cancel', 'ack'].includes(mode)) invalid()
    return this.mutations.execute(session, bound.case_id, {
      operation: 'request.' + mode + ':' + id,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current) => {
        await this.policy(tx, current)
        const row = (
          await tx.query(
            'SELECT * FROM aic.mvp_document_requests WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE',
            [current.organization_id, current.id, id],
          )
        ).rows[0]
        if (
          (mode === 'approve' && row.status !== 'draft') ||
          (mode === 'cancel' && !['draft', 'approved'].includes(row.status)) ||
          (mode === 'ack' && row.status !== 'approved')
        )
          conflict('INVALID_REQUEST_STATE')
        const at = await this.now(tx)
        let payload = row.approved_payload,
          bytes = row.approved_export,
          hash = row.approved_hash
        if (mode === 'approve') {
          await this.freshRequestSource(tx, current, row.run_id)
          payload = {
            request_id: id,
            case_id: current.id,
            counterparty_id: current.counterparty_id,
            request_revision: Number(row.revision) + 1,
            run_id: row.run_id,
            issue_id: row.issue_id,
            purpose: row.purpose,
            content: row.content,
            document_types: row.document_types,
            approved_by: session.user.id,
            approved_at: at,
            reason: input.reason,
            scope: 'sandbox supplement request; not transaction approval',
          }
          bytes = Buffer.from(JSON.stringify(payload, null, 2) + '\n', 'utf8')
          hash = hashBytes(bytes)
        }
        if (mode === 'ack') {
          const responses = (
            await tx.query(
              `SELECT b.*,d.created_at FROM aic.mvp_response_bindings b JOIN aic.mvp_documents d ON d.organization_id=b.organization_id AND d.case_id=b.case_id AND d.id=b.document_id
            WHERE b.organization_id=$1 AND b.case_id=$2 AND b.request_id=$3`,
              [current.organization_id, current.id, id],
            )
          ).rows
          const review = await this.latest(tx, current)
          if (
            !responses.length ||
            !review ||
            review.stale ||
            responses.some((r) => Date.parse(iso(r.created_at)) >= Date.parse(review.created_at))
          )
            conflict('RECHECK_REQUIRED')
          if (review.findings.some((f: any) => f.severity === 'blocker')) conflict('REVIEW_BLOCKED')
          const reviewed = (
            await tx.query(
              `SELECT 1 FROM aic.mvp_response_bindings b JOIN aic.mvp_document_lineages l
            ON l.organization_id=b.organization_id AND l.case_id=b.case_id AND l.current_document_id=b.document_id
            JOIN LATERAL (SELECT payload_json FROM aic.mvp_document_decisions h WHERE h.organization_id=b.organization_id AND h.case_id=b.case_id
              AND h.document_id=b.document_id AND h.kind='classification' ORDER BY h.case_revision DESC LIMIT 1) h ON true
            WHERE b.organization_id=$1 AND b.case_id=$2 AND b.request_id=$3 AND h.payload_json->>'subject_match'='match'
              AND h.payload_json->>'counterparty_revision'=$5
              AND $4::jsonb ? (h.payload_json->>'declared_type') LIMIT 1`,
              [
                current.organization_id,
                current.id,
                id,
                JSON.stringify(row.document_types),
                String(review.counterparty_revision),
              ],
            )
          ).rows[0]
          if (!reviewed) conflict('RESPONSE_SOURCE_REVIEW_REQUIRED')
        }
        const changed = (
          await tx.query(
            `UPDATE aic.mvp_document_requests SET status=$4,revision=revision+1,approved_payload=$5::jsonb,
          approved_export=$6,approved_hash=$7,updated_at=$8 WHERE organization_id=$1 AND case_id=$2 AND id=$3 RETURNING *`,
            [
              current.organization_id,
              current.id,
              id,
              mode === 'approve' ? 'approved' : mode === 'cancel' ? 'cancelled' : 'closed',
              payload ? canonicalJson(payload) : null,
              bytes,
              hash,
              at,
            ],
          )
        ).rows[0]
        await this.history(tx, session, changed)
        return {
          status: 200,
          body: this.requestOutput(changed),
          action: 'request.' + mode,
          reason: input.reason,
          subjectId: id,
        }
      },
    })
  }
  async exportRequest(session: AuthSession, id: string) {
    const row = await this.resource(session, 'mvp_document_requests', id)
    if (!row.approved_export || hashBytes(row.approved_export) !== row.approved_hash)
      conflict('APPROVED_EXPORT_UNAVAILABLE')
    return { bytes: Buffer.from(row.approved_export), hash: row.approved_hash as string }
  }
  async waive(session: AuthSession, caseId: string, key: string, body: unknown) {
    const input = this.input('WaiverInput', body)
    return this.mutations.execute(session, caseId, {
      operation: 'waiver.create',
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current) => {
        const policy = await this.policy(tx, current),
          review = await this.latest(tx, current)
        const rule = policy.checklist.find((r: any) => r.requirement_key === input.requirement_key)
        if (!rule?.waivable || input.requirement_key === 'financial_minimum')
          invalid('REQUIREMENT_NOT_WAIVABLE')
        const finding = review?.findings.find(
          (f: any) =>
            f.id === input.issue_id &&
            f.issue_key === input.requirement_key &&
            f.category === 'missing_document',
        )
        if (!review || review.stale || !finding) conflict('STALE_OR_INVALID_FINDING')
        if (
          (await this.waivers(tx, current)).some(
            (w) => w.requirement_key === input.requirement_key && w.active,
          )
        )
          conflict('WAIVER_ALREADY_ACTIVE')
        const row = (
          await tx.query(
            `INSERT INTO aic.mvp_waivers(id,organization_id,case_id,requirement_key,issue_id,reason,policy_version,actor_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
              randomUUID(),
              current.organization_id,
              caseId,
              input.requirement_key,
              input.issue_id,
              input.reason,
              current.policy_version,
              session.user.id,
            ],
          )
        ).rows[0]
        return {
          status: 201,
          body: (await this.waivers(tx, current)).find((w) => w.id === row.id),
          action: 'waiver.created',
          reason: input.reason,
          subjectId: row.id,
        }
      },
    })
  }
  async revoke(session: AuthSession, id: string, key: string, body: unknown) {
    const input = this.input('ReasonInput', body),
      bound = await this.resource(session, 'mvp_waivers', id)
    return this.mutations.execute(session, bound.case_id, {
      operation: 'waiver.revoke:' + id,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current) => {
        const waiver = (await this.waivers(tx, current)).find((w) => w.id === id)
        if (!waiver?.active) conflict('WAIVER_NOT_ACTIVE')
        await tx.query(
          `INSERT INTO aic.mvp_waiver_revocations(id,organization_id,case_id,waiver_id,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6)`,
          [randomUUID(), current.organization_id, current.id, id, input.reason, session.user.id],
        )
        return {
          status: 200,
          body: (await this.waivers(tx, current)).find((w) => w.id === id),
          action: 'waiver.revoked',
          reason: input.reason,
          subjectId: id,
        }
      },
    })
  }
}
