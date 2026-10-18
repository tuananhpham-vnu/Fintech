import { Inject, Injectable } from '@nestjs/common'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { CaseMutations } from './case-mutations'
import { canonicalJson, requestHash } from './canonical'
import { CoreRepository, requireUuid } from './core.repository'
import { FoundationError, notFound } from './errors'
import { FOUNDATION_CONFIG, FOUNDATION_DB } from './ports'
import type { AuthSession, FoundationConfig, FoundationDatabase, SqlClient } from './ports'
import { validateContract } from './validation'

const iso = (value: Date | string) => new Date(value).toISOString()
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const conflict = (code: string): never => {
  throw new FoundationError(409, code)
}
const invalid = (code: string): never => {
  throw new FoundationError(422, code)
}

/** A native form capability grants question access, never identity assurance.
 * Raw tokens exist only in the first create response header and client memory.
 * Case locks serialize close/revoke/submit; immutable rows retain all outcomes. */
@Injectable()
export class MvpCapabilityService {
  readonly ttl: number
  readonly requestsPerMinute: number
  constructor(
    @Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) private readonly config: FoundationConfig,
    private readonly core: CoreRepository,
    private readonly mutations: CaseMutations,
  ) {
    this.ttl = config.invitationTtlMs ?? 3600000
    this.requestsPerMinute = config.respondentRequestsPerMinute ?? 120
    if (
      !Number.isSafeInteger(this.ttl) ||
      this.ttl < 60000 ||
      this.ttl > 7 * 86400000 ||
      !Number.isSafeInteger(this.requestsPerMinute) ||
      this.requestsPerMinute < 1 ||
      this.requestsPerMinute > 1200
    )
      throw Error('Invalid bounded capability config')
  }
  private input(name: string, value: unknown): any {
    const input = JSON.parse(canonicalJson(value))
    validateContract(name, input)
    return input
  }
  private output(name: string, value: any): any {
    validateContract(name, value, true)
    return value
  }
  private async bound(
    session: AuthSession,
    table: 'mvp_questionnaires' | 'mvp_invitations',
    id: string,
  ) {
    requireUuid(id)
    return this.db.transaction(async (tx) => {
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
      const row = (
        await tx.query(`SELECT * FROM aic.${table} WHERE organization_id=$1 AND id=$2`, [
          session.user.organization_id,
          id,
        ])
      ).rows[0]
      if (!row) throw notFound()
      await this.core.assertCaseAccess(tx, session.user, row.case_id, true)
      return row
    })
  }
  private async closed(tx: SqlClient, row: any) {
    return !!(
      await tx.query(
        `SELECT 1 FROM aic.mvp_questionnaire_events WHERE organization_id=$1 AND case_id=$2 AND questionnaire_id=$3 AND kind='closed' LIMIT 1`,
        [row.organization_id, row.case_id, row.questionnaire_id ?? row.id],
      )
    ).rows[0]
  }
  async listTx(tx: SqlClient, current: any, questionnaireId: string) {
    const rows = (
      await tx.query(
        `SELECT i.*,clock_timestamp() AS checked_at,
      EXISTS(SELECT 1 FROM aic.mvp_invitation_revocations r WHERE r.organization_id=i.organization_id AND r.case_id=i.case_id AND r.invitation_id=i.id) AS revoked,
      EXISTS(SELECT 1 FROM aic.mvp_respondent_submissions s WHERE s.organization_id=i.organization_id AND s.case_id=i.case_id AND s.invitation_id=i.id) AS submitted,
      EXISTS(SELECT 1 FROM aic.mvp_questionnaire_events e WHERE e.organization_id=i.organization_id AND e.case_id=i.case_id AND e.questionnaire_id=i.questionnaire_id AND e.kind='closed') AS closed
      FROM aic.mvp_invitations i WHERE i.organization_id=$1 AND i.case_id=$2 AND i.questionnaire_id=$3 ORDER BY i.created_at,i.id`,
        [current.organization_id, current.id, questionnaireId],
      )
    ).rows
    return rows.map((row) => this.invitation(row))
  }
  private invitation(row: any) {
    return this.output('Invitation', {
      id: row.id,
      questionnaire_id: row.questionnaire_id,
      questionnaire_version: 1,
      question_ids: row.question_ids,
      reported_by: row.reported_by,
      recipient_reference: row.recipient_reference,
      expires_at: iso(row.expires_at),
      created_at: iso(row.created_at),
      token_delivery: 'one_time_response_header',
      status: row.closed
        ? 'closed'
        : row.revoked
          ? 'revoked'
          : Date.parse(iso(row.expires_at)) <= Date.parse(iso(row.checked_at ?? row.created_at))
            ? 'expired'
            : row.submitted
              ? 'submitted'
              : 'active',
    })
  }
  async create(session: AuthSession, questionnaireId: string, key: string, body: unknown) {
    const input = this.input('InvitationCreateInput', body),
      form = await this.bound(session, 'mvp_questionnaires', questionnaireId)
    let rawToken: string | undefined
    const result = await this.mutations.execute(session, form.case_id, {
      operation: 'invitation.create:' + questionnaireId,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        if (await this.closed(tx, form)) conflict('QUESTIONNAIRE_CLOSED')
        if (
          input.question_ids.some(
            (id: string) => !form.questions.some((q: any) => q.id === id && q.version === 1),
          )
        )
          invalid('QUESTION_SCOPE_MISMATCH')
        rawToken = randomBytes(32).toString('base64url')
        // Reissue for the same intended reporter revokes older capabilities in
        // this form. Other recipients have independently scoped lifecycles.
        await tx.query(
          `INSERT INTO aic.mvp_invitation_revocations(id,organization_id,case_id,invitation_id,actor_id,reason)
          SELECT gen_random_uuid(),i.organization_id,i.case_id,i.id,$5,$6 FROM aic.mvp_invitations i
          WHERE i.organization_id=$1 AND i.case_id=$2 AND i.questionnaire_id=$3 AND i.recipient_reference=$4 AND i.reported_by=$7
          AND NOT EXISTS(SELECT 1 FROM aic.mvp_invitation_revocations r WHERE r.organization_id=i.organization_id AND r.case_id=i.case_id AND r.invitation_id=i.id)`,
          [
            current.organization_id,
            current.id,
            questionnaireId,
            input.recipient_reference,
            session.user.id,
            'Superseded by explicit invitation reissue: ' + input.reason,
            input.reported_by,
          ],
        )
        const row = (
          await tx.query(
            `INSERT INTO aic.mvp_invitations(id,organization_id,case_id,questionnaire_id,questionnaire_version,question_ids,
          token_hash,reported_by,recipient_reference,expires_at,created_by)
          VALUES($1,$2,$3,$4,1,$5::jsonb,$6,$7,$8,clock_timestamp()+($9::bigint*interval '1 millisecond'),$10) RETURNING *`,
            [
              randomUUID(),
              current.organization_id,
              current.id,
              questionnaireId,
              canonicalJson(input.question_ids),
              digest(rawToken),
              input.reported_by,
              input.recipient_reference,
              this.ttl,
              session.user.id,
            ],
          )
        ).rows[0]
        await tx.query(
          `INSERT INTO aic.mvp_questionnaire_events(id,organization_id,case_id,questionnaire_id,kind,actor_id,case_revision,reason)
          VALUES($1,$2,$3,$4,'published',$5,$6,$7)`,
          [
            randomUUID(),
            current.organization_id,
            current.id,
            questionnaireId,
            session.user.id,
            next,
            input.reason,
          ],
        )
        return {
          status: 201,
          body: this.output('InvitationCreated', {
            invitation: this.invitation(row),
            revision: next,
          }),
          action: 'invitation.created',
          reason: input.reason,
          subjectId: row.id,
        }
      },
    })
    // The frozen status/body contains metadata only, never the secret. Exact
    // replay preserves it, but cannot return a raw credential a second time.
    return { ...result, rawToken: result.replayed ? undefined : rawToken }
  }
  async revoke(session: AuthSession, id: string, key: string, body: unknown) {
    const input = this.input('ReasonInput', body),
      row = await this.bound(session, 'mvp_invitations', id)
    return this.mutations.execute(session, row.case_id, {
      operation: 'invitation.revoke:' + id,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        if (
          (
            await tx.query(
              'SELECT 1 FROM aic.mvp_invitation_revocations WHERE organization_id=$1 AND case_id=$2 AND invitation_id=$3',
              [current.organization_id, current.id, id],
            )
          ).rows[0]
        )
          conflict('INVITATION_REVOKED')
        await tx.query(
          `INSERT INTO aic.mvp_invitation_revocations(id,organization_id,case_id,invitation_id,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6)`,
          [randomUUID(), current.organization_id, current.id, id, session.user.id, input.reason],
        )
        return {
          status: 200,
          body: this.output('InvitationCreated', {
            invitation: this.invitation({ ...row, revoked: true }),
            revision: next,
          }),
          action: 'invitation.revoked',
          reason: input.reason,
          subjectId: id,
        }
      },
    })
  }
  async close(session: AuthSession, id: string, key: string, body: unknown) {
    const input = this.input('ReasonInput', body),
      form = await this.bound(session, 'mvp_questionnaires', id)
    return this.mutations.execute(session, form.case_id, {
      operation: 'questionnaire.close:' + id,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        if (await this.closed(tx, form)) conflict('QUESTIONNAIRE_CLOSED')
        await tx.query(
          `INSERT INTO aic.mvp_questionnaire_events(id,organization_id,case_id,questionnaire_id,kind,actor_id,case_revision,reason) VALUES($1,$2,$3,$4,'closed',$5,$6,$7)`,
          [
            randomUUID(),
            current.organization_id,
            current.id,
            id,
            session.user.id,
            next,
            input.reason,
          ],
        )
        return {
          status: 200,
          body: this.output('QuestionnaireState', {
            id,
            version: 1,
            state: 'closed',
            revision: next,
          }),
          action: 'questionnaire.closed',
          reason: input.reason,
          subjectId: id,
        }
      },
    })
  }
  private async throttle(remote: string) {
    const row = (
      await this.db.query(
        `INSERT INTO aic.mvp_capability_limits(ip_hash,window_started_at,count) VALUES($1,clock_timestamp(),1)
      ON CONFLICT(ip_hash) DO UPDATE SET count=CASE WHEN aic.mvp_capability_limits.window_started_at<clock_timestamp()-interval '1 minute' THEN 1 ELSE aic.mvp_capability_limits.count+1 END,
      window_started_at=CASE WHEN aic.mvp_capability_limits.window_started_at<clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE aic.mvp_capability_limits.window_started_at END RETURNING count`,
        [digest('aic-capability-ip:' + remote)],
      )
    ).rows[0]
    if (Number(row.count) > this.requestsPerMinute)
      throw new FoundationError(429, 'CAPABILITY_RATE_LIMIT')
  }
  private async capability(token: string, remote: string) {
    await this.throttle(remote)
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw notFound()
    const row = (
      await this.db.query('SELECT * FROM aic.mvp_invitations WHERE token_hash=$1', [digest(token)])
    ).rows[0]
    if (!row) throw notFound()
    return row
  }
  private async authorize(tx: SqlClient, row: any) {
    const current = (
      await tx.query('SELECT * FROM aic.cases WHERE organization_id=$1 AND id=$2 FOR UPDATE', [
        row.organization_id,
        row.case_id,
      ])
    ).rows[0]
    if (!current) throw notFound()
    // Real DB time after any case-lock wait. No token/cookie/forwarded-IP claims
    // can extend expiry or override a committed close/revocation.
    const valid = (
      await tx.query(
        `SELECT 1 FROM aic.mvp_invitations i WHERE i.id=$1 AND i.organization_id=$2 AND i.case_id=$3 AND i.expires_at>clock_timestamp()
      AND NOT EXISTS(SELECT 1 FROM aic.mvp_invitation_revocations r WHERE r.organization_id=i.organization_id AND r.case_id=i.case_id AND r.invitation_id=i.id)`,
        [row.id, row.organization_id, row.case_id],
      )
    ).rows[0]
    if (!valid || (await this.closed(tx, row))) throw notFound()
    return current
  }
  async form(token: string, remote: string) {
    const row = await this.capability(token, remote)
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, row)
      const form = (
        await tx.query(
          'SELECT questions FROM aic.mvp_questionnaires WHERE organization_id=$1 AND case_id=$2 AND id=$3',
          [row.organization_id, row.case_id, row.questionnaire_id],
        )
      ).rows[0]
      const receipt = (
        await tx.query(
          'SELECT receipt_json FROM aic.mvp_respondent_submissions WHERE organization_id=$1 AND case_id=$2 AND invitation_id=$3',
          [row.organization_id, row.case_id, row.id],
        )
      ).rows[0]?.receipt_json
      return this.output('RespondentForm', {
        questions: form.questions.filter((q: any) => row.question_ids.includes(q.id)),
        expires_at: iso(row.expires_at),
        questionnaire_version: 1,
        ...(receipt ? { receipt } : {}),
      })
    })
  }
  async submit(token: string, remote: string, key: string, body: unknown) {
    const input = this.input('RespondentSubmitInput', body)
    if (typeof key !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(key)) invalid('INVALID_INPUT')
    const row = await this.capability(token, remote),
      hash = requestHash(input)
    return this.db.transaction(async (tx) => {
      const current = await this.authorize(tx, row)
      const old = (
        await tx.query(
          'SELECT *,replay_expires_at>clock_timestamp() AS replay_active FROM aic.mvp_respondent_submissions WHERE organization_id=$1 AND case_id=$2 AND invitation_id=$3',
          [row.organization_id, row.case_id, row.id],
        )
      ).rows[0]
      if (old) {
        if (old.key !== key || old.request_hash !== hash || !old.replay_active)
          conflict('IDEMPOTENCY_CONFLICT')
        return old.receipt_json
      }
      const form = (
        await tx.query(
          'SELECT questions FROM aic.mvp_questionnaires WHERE organization_id=$1 AND case_id=$2 AND id=$3',
          [row.organization_id, row.case_id, row.questionnaire_id],
        )
      ).rows[0]
      const ids = input.answers.map((a: any) => a.question_id)
      if (
        new Set(ids).size !== ids.length ||
        ids.length !== row.question_ids.length ||
        ids.some((id: string) => !row.question_ids.includes(id))
      )
        invalid('QUESTION_SCOPE_MISMATCH')
      const next = Number(current.revision) + 1
      if (!Number.isSafeInteger(next)) conflict('REVISION_CONFLICT')
      for (const answer of input.answers) {
        const q = form.questions.find(
          (q: any) => q.id === answer.question_id && q.version === answer.question_version,
        )
        if (
          !q ||
          q.answer_type !== 'text' ||
          (answer.answer_state === 'skipped'
            ? !q.allowed_to_skip || answer.answer_json !== null || !answer.skip_reason?.trim()
            : typeof answer.answer_json !== 'string' ||
              !answer.answer_json.trim() ||
              answer.skip_reason !== null)
        )
          invalid('INVALID_ANSWER')
        const prior = (
          await tx.query(
            'SELECT id,revision FROM aic.mvp_staff_responses WHERE organization_id=$1 AND case_id=$2 AND questionnaire_id=$3 AND question_id=$4 ORDER BY revision DESC LIMIT 1',
            [row.organization_id, row.case_id, row.questionnaire_id, q.id],
          )
        ).rows[0]
        const revision = prior ? Number(prior.revision) + 1 : 1
        if (!Number.isSafeInteger(revision)) conflict('REVISION_CONFLICT')
        await tx.query(
          `INSERT INTO aic.mvp_staff_responses(id,revision,organization_id,case_id,questionnaire_id,question_id,question_version,answer_state,answer_json,origin,
          reported_by,reported_reference,source_refs,reason,case_revision,entered_by,invitation_id)
          VALUES($1,$2,$3,$4,$5,$6,1,$7,$8::jsonb,'SME_direct',$9,$10,'[]'::jsonb,$11,$12,NULL,$13)`,
          [
            prior?.id ?? randomUUID(),
            revision,
            row.organization_id,
            row.case_id,
            row.questionnaire_id,
            q.id,
            answer.answer_state,
            canonicalJson(answer.answer_json),
            row.reported_by,
            input.reported_reference,
            answer.skip_reason ?? 'Direct self-reported response; capability only',
            next,
            row.id,
          ],
        )
      }
      const at = iso((await tx.query('SELECT clock_timestamp() AS at')).rows[0].at)
      const receipt = this.output('RespondentReceipt', {
        receipt_id: randomUUID(),
        submitted_at: at,
        answer_count: input.answers.length,
        identity_assurance: 'self_reported_capability_only',
      })
      await tx.query(
        `INSERT INTO aic.mvp_respondent_submissions(id,organization_id,case_id,invitation_id,key,request_hash,receipt_json,replay_expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,clock_timestamp()+($8::bigint*interval '1 millisecond'))`,
        [
          receipt.receipt_id,
          row.organization_id,
          row.case_id,
          row.id,
          key,
          hash,
          canonicalJson(receipt),
          this.config.idempotencyTtlMs,
        ],
      )
      await tx.query(
        'UPDATE aic.cases SET revision=$3,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2',
        [row.organization_id, row.case_id, next],
      )
      await tx.query(
        `INSERT INTO aic.audit_events(id,organization_id,case_id,actor_type,capability_id,action,subject_id,revision_before,revision_after,reason,metadata_json)
        VALUES($1,$2,$3,'capability',$4,'questionnaire.direct_response',$5,$6,$7,$8,$9::jsonb)`,
        [
          randomUUID(),
          row.organization_id,
          row.case_id,
          row.id,
          row.questionnaire_id,
          Number(current.revision),
          next,
          'Self-reported capability submission',
          canonicalJson({
            identity_assurance: 'self_reported_capability_only',
            receipt_id: receipt.receipt_id,
          }),
        ],
      )
      await this.authorize(tx, row)
      return receipt
    })
  }
}
