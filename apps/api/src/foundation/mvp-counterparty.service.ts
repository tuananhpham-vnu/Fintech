import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { canonicalJson, requestHash } from './canonical'
import { requireUuid } from './core.repository'
import { FoundationError, notFound } from './errors'
import { FOUNDATION_CONFIG, FOUNDATION_DB } from './ports'
import type { AuthSession, FoundationConfig, FoundationDatabase, SqlClient } from './ports'
import { validateContract } from './validation'

const REPLAY_MS = 24 * 60 * 60 * 1000
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const iso = (value: Date | string) => new Date(value).toISOString()

/** Local MVP only; registration is opt-in. No case locks, membership writes or identity approval. */
@Injectable()
export class MvpCounterpartyService {
  constructor(
    @Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) private readonly config: FoundationConfig,
  ) {
    if (!Number.isSafeInteger(config.sessionIdleMs) || config.sessionIdleMs <= 0)
      throw new Error('Invalid MVP counterparty session duration')
  }

  private async active(tx: SqlClient, session: AuthSession) {
    const result = await tx.query('SELECT * FROM aic.lock_active_session($1,$2,$3,$4)', [
      session.id,
      session.user.id,
      session.user.organization_id,
      this.config.sessionIdleMs,
    ])
    if (!result.rows[0]) throw new FoundationError(401, 'SESSION_EXPIRED')
  }

  private async lock(tx: SqlClient, session: AuthSession, id: string) {
    const result = await tx.query(
      `SELECT c.* FROM aic.counterparties c
      JOIN aic.organizations o ON o.id=c.organization_id
      JOIN aic.users u ON u.organization_id=c.organization_id AND u.id=$2
        AND u.disabled_at IS NULL AND u.role='specialist'
      WHERE c.organization_id=$1 AND c.id=$3 FOR UPDATE OF c`,
      [session.user.organization_id, session.user.id, id],
    )
    // The clock/session may have expired while the counterparty row was locked.
    await this.active(tx, session)
    if (!result.rows[0]) throw notFound()
    return result.rows[0]
  }

  private project(row: any) {
    const result = {
      id: row.id,
      organization_id: row.organization_id,
      name: row.name,
      country: row.country,
      tax_id: row.tax_id,
      industry_code: row.industry_code,
      source_refs: row.source_refs,
      identity_status: row.identity_status,
      revision: Number(row.revision),
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at),
    }
    validateContract('Counterparty', result, true)
    return result
  }

  create(session: AuthSession, key: string, body: unknown) {
    return this.execute(session, null, key, body)
  }

  update(session: AuthSession, id: string, key: string, body: unknown) {
    requireUuid(id)
    return this.execute(session, id, key, body)
  }

  private async execute(sessionInput: AuthSession, id: string | null, key: string, body: unknown) {
    if (
      !sessionInput ||
      !uuid.test(sessionInput.id) ||
      !uuid.test(sessionInput.user?.id) ||
      !uuid.test(sessionInput.user?.organization_id) ||
      sessionInput.user?.role !== 'specialist'
    )
      throw new FoundationError(401, 'SESSION_EXPIRED')
    // Own the entire caller input, including source and principal, before waiting.
    const session = { ...sessionInput, user: { ...sessionInput.user } }
    const input = JSON.parse(canonicalJson(body))
    validateContract(id ? 'CounterpartyUpdateInput' : 'CounterpartyCreateInput', input)
    if (
      typeof key !== 'string' ||
      !/^[\x21-\x7e]{1,200}$/.test(key) ||
      [
        input.name,
        input.country,
        input.reason,
        input.source.reported_reference,
        input.source.statement,
      ].some((value) => !value.trim())
    )
      throw new FoundationError(422, 'INVALID_INPUT')
    const operation = id ? 'counterparty.update' : 'counterparty.create'
    const scope = [session.user.organization_id, session.user.id, operation, key]
    const hash = requestHash({ counterparty_id: id, input })
    try {
      return await this.db.transaction(async (tx) => {
        await this.active(tx, session)
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          canonicalJson(scope),
        ])
        await this.active(tx, session)
        const cached = (
          await tx.query(
            `SELECT * FROM aic.idempotency_keys
            WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4`,
            scope,
          )
        ).rows[0]
        const target = id ?? cached?.response_body.id
        const current = target ? await this.lock(tx, session, target) : null
        if (cached) {
          // Evaluate expiry after all waits. Never refresh, delete or reuse an expired key.
          const valid = (
            await tx.query('SELECT $1::timestamptz>clock_timestamp() AS active', [
              cached.expires_at,
            ])
          ).rows[0].active
          await this.active(tx, session)
          if (!valid || cached.request_hash !== hash)
            throw new FoundationError(409, 'IDEMPOTENCY_CONFLICT')
          return {
            status: cached.response_status,
            body: cached.response_body,
            replayed: true,
          }
        }
        if (current && Number(current.revision) !== input.expected_revision)
          throw new FoundationError(409, 'REVISION_CONFLICT')
        const revision = current ? Number(current.revision) + 1 : 1
        if (!Number.isSafeInteger(revision)) throw new FoundationError(409, 'REVISION_CONFLICT')
        const counterpartyId = id ?? randomUUID(),
          sourceId = randomUUID()
        const recordedAt = iso((await tx.query('SELECT clock_timestamp() AS time')).rows[0].time)
        const source = {
          ...input.source,
          id: sourceId,
          organization_id: session.user.organization_id,
          counterparty_id: counterpartyId,
          source_revision: revision,
          origin: 'staff_transcribed',
          entered_by: session.user.id,
          actor_id: session.user.id,
          recorded_at: recordedAt,
          verification: 'unverified',
        }
        await this.active(tx, session)
        await tx.query("SET LOCAL synchronous_commit = 'on'")
        const values = [
          session.user.organization_id,
          counterpartyId,
          input.name,
          input.country,
          input.tax_id,
          input.industry_code,
          canonicalJson([sourceId]),
          revision,
          recordedAt,
        ]
        const row = (
          await tx.query(
            current
              ? `UPDATE aic.counterparties SET name=$3,country=$4,tax_id=$5,industry_code=$6,
                  source_refs=$7::jsonb,identity_status='unresolved',revision=$8,updated_at=$9::timestamptz
                WHERE organization_id=$1 AND id=$2 RETURNING *`
              : `INSERT INTO aic.counterparties
                (organization_id,id,name,country,tax_id,industry_code,source_refs,identity_status,revision,created_at,updated_at)
                VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'unresolved',$8,$9::timestamptz,$9::timestamptz) RETURNING *`,
            values,
          )
        ).rows[0]
        const result = this.project(row)
        await tx.query(
          `INSERT INTO aic.mvp_counterparty_versions
          (id,organization_id,counterparty_id,revision,source_json,payload_json,actor_id,reason,created_at)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::timestamptz)`,
          [
            sourceId,
            session.user.organization_id,
            counterpartyId,
            revision,
            canonicalJson(source),
            canonicalJson(result),
            session.user.id,
            input.reason,
            recordedAt,
          ],
        )
        await tx.query(
          `INSERT INTO aic.audit_events
          (id,organization_id,case_id,actor_type,actor_id,action,subject_id,revision_before,revision_after,reason,metadata_json)
          VALUES($1,$2,NULL,'specialist',$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [
            randomUUID(),
            session.user.organization_id,
            session.user.id,
            current ? 'counterparty.updated' : 'counterparty.created',
            counterpartyId,
            current ? Number(current.revision) : null,
            revision,
            input.reason,
            canonicalJson({
              source_id: sourceId,
              identity_status: 'unresolved',
              verification: 'unverified',
            }),
          ],
        )
        const status = current ? 200 : 201
        await tx.query(
          `INSERT INTO aic.idempotency_keys
          (organization_id,actor_id,operation,key,request_hash,response_status,response_body,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,clock_timestamp()+($8::bigint*interval '1 millisecond'))`,
          [...scope, hash, status, canonicalJson(result), REPLAY_MS],
        )
        await this.active(tx, session)
        return { status, body: result, replayed: false }
      })
    } catch (error) {
      if (error?.code === '23505' && error?.constraint === 'counterparties_tax_identity_unique')
        throw new FoundationError(409, 'COUNTERPARTY_TAX_ID_CONFLICT')
      throw error
    }
  }
}
