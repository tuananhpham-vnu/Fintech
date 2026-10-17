import { Inject, Injectable, Optional } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { projectLegacyExtraction } from '../documents/evidence-projection'
import { CaseMutations } from './case-mutations'
import { canonicalJson, requestHash } from './canonical'
import { CoreRepository, requireUuid } from './core.repository'
import { FoundationError, notFound } from './errors'
import { FOUNDATION_CONFIG, FOUNDATION_DB } from './ports'
import type { AuthSession, FoundationConfig, FoundationDatabase, SqlClient } from './ports'
import { validateContract } from './validation'
import { MvpCapabilityService } from './mvp-capability.service'

const invalid = (code: string): never => {
  throw new FoundationError(422, code)
}
const conflict = (code: string): never => {
  throw new FoundationError(409, code)
}
const iso = (value: Date | string) => new Date(value).toISOString()

/** Optional questions and source-fidelity verification. Direct capability access
 * lives in MvpCapabilityService; neither path verifies identity or settlement. */
@Injectable()
export class MvpQuestionnaireService {
  constructor(
    @Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) private readonly config: FoundationConfig,
    private readonly core: CoreRepository,
    private readonly mutations: CaseMutations,
    @Optional() private readonly capabilities?: MvpCapabilityService,
  ) {}
  private input(name: string, body: unknown): any {
    const input = JSON.parse(canonicalJson(body))
    validateContract(name, input)
    return input
  }
  private output(name: string, body: any): any {
    validateContract(name, body, true)
    return body
  }
  private async scope(tx: SqlClient, current: any) {
    const artifact = (
      await tx.query(
        'SELECT artifact_json FROM aic.mvp_policy_artifacts WHERE version=$1 AND sha256=$2',
        [current.policy_version, current.policy_artifact_hash],
      )
    ).rows[0]?.artifact_json
    if (
      !['RECEIVABLE', 'PREPAYMENT'].includes(current.exposure_kind) ||
      !artifact ||
      artifact.status !== 'approved' ||
      requestHash(artifact) !== current.policy_artifact_hash ||
      !artifact.scope?.exposure_kinds?.includes(current.exposure_kind)
    )
      conflict('POLICY_BINDING_REQUIRED')
  }
  private async access(tx: SqlClient, session: AuthSession, caseId: string) {
    const active = (
      await tx.query('SELECT * FROM aic.lock_active_session($1,$2,$3,$4)', [
        session.id,
        session.user.id,
        session.user.organization_id,
        this.config.sessionIdleMs,
      ])
    ).rows[0]
    if (!active) throw new FoundationError(401, 'SESSION_EXPIRED')
    const current = await this.core.assertCaseAccess(tx, session.user, caseId, true)
    if (
      !(
        await tx.query('SELECT * FROM aic.lock_active_session($1,$2,$3,$4)', [
          session.id,
          session.user.id,
          session.user.organization_id,
          this.config.sessionIdleMs,
        ])
      ).rows[0]
    )
      throw new FoundationError(401, 'SESSION_EXPIRED')
    await this.scope(tx, current)
    return current
  }
  private async resource(
    session: AuthSession,
    table: 'mvp_questionnaires' | 'mvp_staff_responses',
    id: string,
  ) {
    requireUuid(id)
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query(
          `SELECT * FROM aic.${table} WHERE organization_id=$1 AND id=$2 ORDER BY case_revision DESC LIMIT 1`,
          [session.user.organization_id, id],
        )
      ).rows[0]
      if (!row) throw notFound()
      await this.access(tx, session, row.case_id)
      return row
    })
  }
  private async sources(tx: SqlClient, current: any) {
    const rows = (
      await tx.query(
        `SELECT d.*,j.state AS job_state,r.raw_extraction AS extraction,r.id AS result_id FROM aic.mvp_documents d
        JOIN aic.mvp_document_lineages l ON l.organization_id=d.organization_id AND l.case_id=d.case_id AND l.current_document_id=d.id
        JOIN aic.mvp_document_jobs j ON j.organization_id=d.organization_id AND j.case_id=d.case_id AND j.document_id=d.id
        LEFT JOIN aic.mvp_document_results r ON r.organization_id=d.organization_id AND r.case_id=d.case_id
          AND r.document_id=d.id AND r.document_version=d.version AND r.sha256=d.hash AND r.outcome='published'
        WHERE d.organization_id=$1 AND d.case_id=$2 ORDER BY d.id`,
        [current.organization_id, current.id],
      )
    ).rows
    const decisions = (
      await tx.query(
        'SELECT * FROM aic.mvp_document_decisions WHERE organization_id=$1 AND case_id=$2 ORDER BY case_revision',
        [current.organization_id, current.id],
      )
    ).rows
    const refs: { id: string; reviewed: boolean }[] = []
    for (const doc of rows) {
      if (!doc.extraction || doc.job_state !== 'succeeded') continue
      try {
        const projection = projectLegacyExtraction(doc, doc.extraction)
        const classification = decisions
          .filter((d) => d.document_id === doc.id && d.kind === 'classification')
          .at(-1)?.payload_json
        const cp = (
          await tx.query(
            'SELECT revision FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE',
            [current.organization_id, current.counterparty_id],
          )
        ).rows[0]
        for (const e of projection.evidence)
          refs.push({
            id: e.id,
            reviewed:
              classification?.subject_match === 'match' &&
              Number(classification.counterparty_revision) === Number(cp.revision) &&
              classification.reviewed_pages.includes(e.page),
          })
      } catch {
        /* Invalid extraction cannot supply a source for a decision. */
      }
    }
    const counterparty = (
      await tx.query(
        'SELECT revision,identity_status FROM aic.counterparties WHERE organization_id=$1 AND id=$2',
        [current.organization_id, current.counterparty_id],
      )
    ).rows[0]
    return {
      refs,
      hash: requestHash({
        exposure: current.exposure_json,
        counterparty,
        documents: rows.map((d) => ({
          id: d.id,
          version: d.version,
          hash: d.hash,
          job: d.job_state,
          result: d.result_id ?? null,
        })),
        decisions: decisions.map((d) => ({ id: d.id, payload: d.payload_json })),
      }),
    }
  }
  private assertRefs(
    sources: Awaited<ReturnType<MvpQuestionnaireService['sources']>>,
    refs: string[],
    reviewed: boolean,
  ) {
    if (refs.some((ref) => !sources.refs.some((e) => e.id === ref && (!reviewed || e.reviewed))))
      invalid('CURRENT_CASE_EVIDENCE_REQUIRED')
    if (reviewed && !refs.length) invalid('EVIDENCE_REQUIRED')
  }
  private response(row: any, verification: any, sourceHash: string) {
    const stale = !!verification && verification.source_snapshot_hash !== sourceHash
    return this.output('StaffResponse', {
      id: row.id,
      question_id: row.question_id,
      question_version: row.question_version,
      answer_state: row.answer_state,
      answer_json: row.answer_json,
      origin: row.origin,
      source_refs: row.source_refs,
      revision: Number(row.revision),
      reported_by: row.reported_by,
      reported_reference: row.reported_reference,
      entered_by: row.entered_by,
      invitation_id: row.invitation_id ?? null,
      created_at: iso(row.created_at),
      reason: row.reason,
      verification_status: !stale && verification ? verification.status : 'unverified',
      verification_stale: stale,
    })
  }
  async listTx(tx: SqlClient, current: any) {
    const forms = (
      await tx.query(
        'SELECT * FROM aic.mvp_questionnaires WHERE organization_id=$1 AND case_id=$2 ORDER BY case_revision',
        [current.organization_id, current.id],
      )
    ).rows
    const sources = await this.sources(tx, current)
    const rows = (
      await tx.query(
        `SELECT DISTINCT ON (questionnaire_id,question_id) * FROM aic.mvp_staff_responses
        WHERE organization_id=$1 AND case_id=$2 ORDER BY questionnaire_id,question_id,revision DESC`,
        [current.organization_id, current.id],
      )
    ).rows
    const verified = (
      await tx.query(
        'SELECT * FROM aic.mvp_response_verifications WHERE organization_id=$1 AND case_id=$2 ORDER BY case_revision',
        [current.organization_id, current.id],
      )
    ).rows
    return Promise.all(
      forms.map(async (form) =>
        this.output('Questionnaire', {
          id: form.id,
          version: 1,
          state:
            (
              await tx.query(
                'SELECT kind FROM aic.mvp_questionnaire_events WHERE organization_id=$1 AND case_id=$2 AND questionnaire_id=$3 ORDER BY case_revision DESC LIMIT 1',
                [current.organization_id, current.id, form.id],
              )
            ).rows[0]?.kind === 'closed'
              ? 'closed'
              : (
                    await tx.query(
                      "SELECT 1 FROM aic.mvp_questionnaire_events WHERE organization_id=$1 AND case_id=$2 AND questionnaire_id=$3 AND kind='published' LIMIT 1",
                      [current.organization_id, current.id, form.id],
                    )
                  ).rows.length
                ? 'published'
                : 'draft',
          invitations: this.capabilities
            ? await this.capabilities.listTx(tx, current, form.id)
            : [],
          policy_version: form.policy_version,
          questions: form.questions,
          responses: rows
            .filter((r) => r.questionnaire_id === form.id)
            .map((r) =>
              this.response(
                r,
                verified
                  .filter(
                    (v) =>
                      v.response_id === r.id && Number(v.response_revision) === Number(r.revision),
                  )
                  .at(-1),
                sources.hash,
              ),
            ),
        }),
      ),
    )
  }
  async get(session: AuthSession, id: string) {
    const form = await this.resource(session, 'mvp_questionnaires', id)
    return this.db.transaction(async (tx) => {
      const current = await this.access(tx, session, form.case_id)
      return (await this.listTx(tx, current)).find((f) => f.id === id)
    })
  }
  async create(session: AuthSession, caseId: string, key: string, body: unknown) {
    const input = this.input('QuestionnaireCreateInput', body)
    return this.mutations.execute(session, caseId, {
      operation: 'questionnaire.create',
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        await this.scope(tx, current)
        const questions = input.questions.map((q: any) => ({
          id: randomUUID(),
          version: 1,
          answer_type: 'text',
          label: q.label,
          requiredness: 'optional',
          allowed_to_skip: true,
          source_requirements: {
            declaration_allowed: true,
            documents_required: false,
            skip_reason_required: true,
          },
          verification_policy: 'human_source_review_only_not_fact_or_settlement_certification',
        }))
        const id = randomUUID()
        await tx.query(
          `INSERT INTO aic.mvp_questionnaires(id,organization_id,case_id,questions,policy_version,case_revision,actor_id)
          VALUES($1,$2,$3,$4::jsonb,'MVP-OPTIONAL-TEXT-1',$5,$6)`,
          [id, current.organization_id, caseId, canonicalJson(questions), next, session.user.id],
        )
        return {
          status: 201,
          body: this.output('Questionnaire', {
            id,
            policy_version: 'MVP-OPTIONAL-TEXT-1',
            questions,
            responses: [],
          }),
          action: 'questionnaire.created',
          reason: input.reason,
          subjectId: id,
        }
      },
    })
  }
  async respond(session: AuthSession, id: string, key: string, body: unknown) {
    const input = this.input('StaffResponseInput', body)
    const form = await this.resource(session, 'mvp_questionnaires', id)
    return this.mutations.execute(session, form.case_id, {
      operation: 'questionnaire.respond:' + id,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        await this.scope(tx, current)
        if (
          (
            await tx.query(
              "SELECT 1 FROM aic.mvp_questionnaire_events WHERE organization_id=$1 AND case_id=$2 AND questionnaire_id=$3 AND kind='closed' LIMIT 1",
              [current.organization_id, current.id, id],
            )
          ).rows[0]
        )
          conflict('QUESTIONNAIRE_CLOSED')
        const question = form.questions.find(
          (q: any) => q.id === input.question_id && q.version === input.question_version,
        )
        if (!question || question.answer_type !== 'text') invalid('QUESTION_SCOPE_MISMATCH')
        if (
          input.answer_state === 'skipped'
            ? !question.allowed_to_skip || input.answer_json !== null
            : typeof input.answer_json !== 'string' || !input.answer_json.trim()
        )
          invalid('INVALID_ANSWER')
        const sources = await this.sources(tx, current)
        this.assertRefs(sources, input.source_refs, false)
        const prior = (
          await tx.query(
            `SELECT id,revision FROM aic.mvp_staff_responses WHERE organization_id=$1 AND case_id=$2
          AND questionnaire_id=$3 AND question_id=$4 ORDER BY revision DESC LIMIT 1`,
            [current.organization_id, current.id, id, question.id],
          )
        ).rows[0]
        const responseId = prior?.id ?? randomUUID(),
          revision = prior ? Number(prior.revision) + 1 : 1
        if (!Number.isSafeInteger(revision)) conflict('REVISION_CONFLICT')
        const row = (
          await tx.query(
            `INSERT INTO aic.mvp_staff_responses(id,revision,organization_id,case_id,questionnaire_id,question_id,question_version,
          answer_state,answer_json,origin,reported_by,reported_reference,source_refs,reason,case_revision,entered_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'staff_transcribed',$10,$11,$12::jsonb,$13,$14,$15) RETURNING *`,
            [
              responseId,
              revision,
              current.organization_id,
              current.id,
              id,
              question.id,
              question.version,
              input.answer_state,
              canonicalJson(input.answer_json),
              input.reported_by,
              input.reported_reference,
              canonicalJson(input.source_refs),
              input.reason,
              next,
              session.user.id,
            ],
          )
        ).rows[0]
        return {
          status: 201,
          body: this.response(row, null, sources.hash),
          action: 'questionnaire.staff_response',
          reason: input.reason,
          subjectId: responseId,
        }
      },
    })
  }
  async verify(session: AuthSession, id: string, key: string, body: unknown) {
    const input = this.input('ResponseVerificationInput', body)
    const bound = await this.resource(session, 'mvp_staff_responses', id)
    return this.mutations.execute(session, bound.case_id, {
      operation: 'response.verify:' + id,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        await this.scope(tx, current)
        const row = (
          await tx.query(
            'SELECT * FROM aic.mvp_staff_responses WHERE organization_id=$1 AND case_id=$2 AND id=$3 ORDER BY revision DESC LIMIT 1',
            [current.organization_id, current.id, id],
          )
        ).rows[0]
        if (Number(row.revision) !== input.response_revision) conflict('STALE_RESPONSE')
        if (row.answer_state === 'skipped' && input.status !== 'unverified')
          invalid('SKIPPED_RESPONSE_NOT_VERIFIABLE')
        const sources = await this.sources(tx, current)
        this.assertRefs(sources, input.evidence_refs, input.status !== 'unverified')
        const saved = (
          await tx.query(
            `INSERT INTO aic.mvp_response_verifications(id,organization_id,case_id,response_id,response_revision,
          status,reason,evidence_refs,source_snapshot_hash,case_revision,actor_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11) RETURNING *`,
            [
              randomUUID(),
              current.organization_id,
              current.id,
              id,
              input.response_revision,
              input.status,
              input.reason,
              canonicalJson(input.evidence_refs),
              sources.hash,
              next,
              session.user.id,
            ],
          )
        ).rows[0]
        return {
          status: 201,
          body: this.output('ResponseVerificationOutput', {
            id: saved.id,
            response_id: id,
            response_revision: input.response_revision,
            revision: next,
            status: input.status,
            reason: input.reason,
            evidence_refs: input.evidence_refs,
            actor_id: session.user.id,
            created_at: iso(saved.created_at),
          }),
          action: 'response.source_verification',
          reason: input.reason,
          subjectId: id,
          metadata: {
            response_revision: input.response_revision,
            scope: 'response source fidelity; not identity, settlement or financial eligibility',
          },
        }
      },
    })
  }
}
