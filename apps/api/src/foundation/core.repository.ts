import { Inject, Injectable } from '@nestjs/common'
import { FOUNDATION_DB, FoundationDatabase, Principal, SqlClient } from './ports'
import { FoundationError, notFound } from './errors'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export function requireUuid(id: string) {
  if (!uuid.test(id)) throw notFound()
  return id
}
function pagination(query: any = {}) {
  if (Object.keys(query).some((k) => !['limit', 'cursor'].includes(k)))
    throw new FoundationError(422, 'INVALID_INPUT')
  const limit = query.limit === undefined ? 20 : Number(query.limit)
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (query.limit !== undefined && !/^\d+$/.test(query.limit))
  )
    throw new FoundationError(422, 'INVALID_INPUT')
  let cursor: { time: string; id: string } | null = null
  if (query.cursor !== undefined) {
    try {
      if (typeof query.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(query.cursor))
        throw Error()
      cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))
      if (
        !cursor ||
        Object.keys(cursor).sort().join(',') !== 'id,time' ||
        !uuid.test(cursor.id) ||
        typeof cursor.time !== 'string' ||
        !Number.isFinite(Date.parse(cursor.time))
      )
        throw Error()
    } catch {
      throw new FoundationError(422, 'INVALID_INPUT', 'Invalid cursor')
    }
  }
  return { limit, cursor }
}
const iso = (value: any) => (value instanceof Date ? value.toISOString() : value)
export function projectCase(row: any) {
  return {
    ...(row.purpose === 'company_health'
      ? { purpose: 'company_health', policy_artifact_hash: null }
      : {}),
    id: row.id,
    organization_id: row.organization_id,
    counterparty_id: row.counterparty_id,
    exposure_kind: row.exposure_kind,
    lifecycle_stage: row.lifecycle_stage,
    exposure: row.exposure_json,
    revision: Number(row.revision),
    ...(row.counterparty_revision
      ? { counterparty_revision: Number(row.counterparty_revision) }
      : {}),
    policy_version: row.policy_version,
    method_version: row.method_version,
    ...(row.policy_artifact_hash ? { policy_artifact_hash: row.policy_artifact_hash } : {}),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  }
}
function projectCounterparty(row: any) {
  return {
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
}
function page(rows: any[], limit: number, project: (row: any) => any) {
  const selected = rows.slice(0, limit),
    last = selected[selected.length - 1]
  return {
    items: selected.map(project),
    next_cursor:
      rows.length > limit
        ? Buffer.from(JSON.stringify({ time: last.cursor_time, id: last.id })).toString('base64url')
        : null,
  }
}

@Injectable()
export class CoreRepository {
  constructor(@Inject(FOUNDATION_DB) private readonly db: FoundationDatabase) {}
  async assertCaseAccess(client: SqlClient, user: Principal, caseId: string, lock = false) {
    requireUuid(caseId)
    if (lock) {
      const locked = await client.query('SELECT * FROM aic.lock_case_access($1,$2,$3)', [
        user.organization_id,
        user.id,
        caseId,
      ])
      if (!locked.rows[0]) throw notFound()
      return locked.rows[0]
    }
    const result = await client.query(
      `SELECT c.*,(SELECT p.revision FROM aic.counterparties p WHERE p.organization_id=c.organization_id AND p.id=c.counterparty_id) AS counterparty_revision FROM aic.cases c
      JOIN aic.case_memberships m ON m.organization_id=c.organization_id AND m.case_id=c.id AND m.user_id=$2
      JOIN aic.users u ON u.organization_id=m.organization_id AND u.id=m.user_id AND u.disabled_at IS NULL
      WHERE c.organization_id=$1 AND c.id=$3`,
      [user.organization_id, user.id, caseId],
    )
    if (!result.rows[0]) throw notFound()
    return result.rows[0]
  }
  async cases(user: Principal, query: any) {
    const { limit, cursor } = pagination(query)
    const result = await this.db.query(
      `SELECT c.*,c.updated_at::text AS cursor_time FROM aic.cases c
      JOIN aic.case_memberships m ON m.organization_id=c.organization_id AND m.case_id=c.id AND m.user_id=$2
      JOIN aic.users u ON u.organization_id=m.organization_id AND u.id=m.user_id AND u.disabled_at IS NULL
      WHERE c.organization_id=$1 AND ($3::timestamptz IS NULL OR (c.updated_at,c.id)<($3::timestamptz,$4::uuid))
      ORDER BY c.updated_at DESC,c.id DESC LIMIT $5`,
      [user.organization_id, user.id, cursor?.time ?? null, cursor?.id ?? null, limit + 1],
    )
    return page(result.rows, limit, projectCase)
  }
  async case(user: Principal, id: string) {
    return projectCase(await this.assertCaseAccess(this.db, user, id))
  }
  async counterparties(user: Principal, query: any) {
    const { limit, cursor } = pagination(query)
    const result = await this.db.query(
      `SELECT *,updated_at::text AS cursor_time FROM aic.counterparties
      WHERE organization_id=$1 AND ($2::timestamptz IS NULL OR (updated_at,id)<($2::timestamptz,$3::uuid))
      ORDER BY updated_at DESC,id DESC LIMIT $4`,
      [user.organization_id, cursor?.time ?? null, cursor?.id ?? null, limit + 1],
    )
    return page(result.rows, limit, projectCounterparty)
  }
  async counterparty(user: Principal, id: string) {
    requireUuid(id)
    const result = await this.db.query(
      'SELECT * FROM aic.counterparties WHERE organization_id=$1 AND id=$2',
      [user.organization_id, id],
    )
    if (!result.rows[0]) throw notFound()
    return projectCounterparty(result.rows[0])
  }
  async history(user: Principal, id: string, query: any) {
    await this.assertCaseAccess(this.db, user, id)
    const { limit, cursor } = pagination(query)
    const result = await this.db.query(
      `SELECT e.*,e.created_at::text AS cursor_time FROM aic.audit_events e
      JOIN aic.case_memberships m ON m.organization_id=e.organization_id AND m.case_id=e.case_id AND m.user_id=$2
      WHERE e.organization_id=$1 AND e.case_id=$3 AND ($4::timestamptz IS NULL OR (e.created_at,e.id)<($4::timestamptz,$5::uuid))
      ORDER BY e.created_at DESC,e.id DESC LIMIT $6`,
      [user.organization_id, user.id, id, cursor?.time ?? null, cursor?.id ?? null, limit + 1],
    )
    return page(result.rows, limit, (row) => ({
      id: row.id,
      actor: row.actor_id ?? row.actor_type,
      action: row.action,
      time: iso(row.created_at),
      reason: row.reason,
      revision_before: row.revision_before === null ? null : Number(row.revision_before),
      revision_after: row.revision_after === null ? null : Number(row.revision_after),
      subject_refs: row.subject_id ? [row.subject_id] : [],
    }))
  }
}
