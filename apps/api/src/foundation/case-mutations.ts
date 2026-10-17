import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import {
  FOUNDATION_CONFIG,
  FOUNDATION_DB,
  FoundationConfig,
  FoundationDatabase,
  AuthSession,
  SqlClient,
} from './ports'
import { FoundationError } from './errors'
import { CoreRepository } from './core.repository'
import { canonicalJson, requestHash } from './canonical'

/** Transaction primitive only; disputed business mutations have no HTTP route. */
@Injectable()
export class CaseMutations {
  constructor(
    @Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) private readonly config: FoundationConfig,
    private readonly core: CoreRepository,
  ) {}
  async execute(
    session: AuthSession,
    caseId: string,
    input: {
      operation: string
      key: string
      expectedRevision: number
      payload: unknown
      work: (
        tx: SqlClient,
        current: any,
        nextRevision: number,
      ) => Promise<{
        status: number
        body: unknown
        action: string
        reason?: string
        subjectId?: string
        metadata?: Record<string, unknown>
      }>
    },
  ) {
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      !/^[\x21-\x7e]{1,200}$/.test(input.key) ||
      !/^[A-Za-z0-9/_:.-]{1,200}$/.test(input.operation)
    )
      throw new FoundationError(422, 'INVALID_INPUT')
    const hash = requestHash({
        case_id: caseId,
        expected_revision: input.expectedRevision,
        payload: input.payload,
      }),
      user = session.user
    return this.db.transaction(async (tx) => {
      const active = await tx.query('SELECT * FROM aic.lock_active_session($1,$2,$3,$4)', [
        session.id,
        user.id,
        user.organization_id,
        this.config.sessionIdleMs,
      ])
      if (!active.rows[0]) throw new FoundationError(401, 'SESSION_EXPIRED')
      const current = await this.core.assertCaseAccess(tx, user, caseId, true)
      const scope = [user.organization_id, user.id, input.operation + ':case:' + caseId, input.key]
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [canonicalJson(scope)])
      // Row/advisory lock waits may cross absolute or idle expiry. Check real DB time again.
      const stillActive = await tx.query('SELECT * FROM aic.lock_active_session($1,$2,$3,$4)', [
        session.id,
        user.id,
        user.organization_id,
        this.config.sessionIdleMs,
      ])
      if (!stillActive.rows[0]) throw new FoundationError(401, 'SESSION_EXPIRED')
      const cached = await tx.query(
        `SELECT *,expires_at>clock_timestamp() AS active FROM aic.idempotency_keys
        WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4`,
        scope,
      )
      if (cached.rows[0]) {
        const record = cached.rows[0]
        if (record.request_hash !== hash || !record.active)
          throw new FoundationError(409, 'IDEMPOTENCY_CONFLICT')
        return { status: record.response_status, body: record.response_body, replayed: true }
      }
      if (
        Number(current.revision) !== input.expectedRevision ||
        Number(current.revision) >= Number.MAX_SAFE_INTEGER
      )
        throw new FoundationError(409, 'REVISION_CONFLICT')
      const next = Number(current.revision) + 1,
        result = await input.work(tx, current, next)
      if (!Number.isInteger(result.status) || result.status < 200 || result.status > 299)
        throw Error('Mutation result must be successful')
      const body = JSON.parse(canonicalJson(result.body))
      await tx.query(
        'UPDATE aic.cases SET revision=$3,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2',
        [user.organization_id, caseId, next],
      )
      await tx.query(
        `INSERT INTO aic.audit_events(id,organization_id,case_id,actor_type,actor_id,action,subject_id,revision_before,revision_after,metadata_json,reason)
        VALUES($1,$2,$3,'specialist',$4,$5,$8,$6,$7,$9::jsonb,$10)`,
        [
          randomUUID(),
          user.organization_id,
          caseId,
          user.id,
          result.action,
          Number(current.revision),
          next,
          result.subjectId ?? caseId,
          canonicalJson(result.metadata ?? {}),
          result.reason ?? null,
        ],
      )
      await tx.query(
        `INSERT INTO aic.idempotency_keys(organization_id,actor_id,operation,key,request_hash,response_status,response_body,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,clock_timestamp()+($8::bigint*interval '1 millisecond'))`,
        [...scope, hash, result.status, JSON.stringify(body), this.config.idempotencyTtlMs],
      )
      const finalSession = await tx.query('SELECT * FROM aic.lock_active_session($1,$2,$3,$4)', [
        session.id,
        user.id,
        user.organization_id,
        this.config.sessionIdleMs,
      ])
      if (!finalSession.rows[0]) throw new FoundationError(401, 'SESSION_EXPIRED')
      return { status: result.status, body, replayed: false }
    })
  }
}
