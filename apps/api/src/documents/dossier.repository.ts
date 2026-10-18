import { Inject, Injectable } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { FOUNDATION_CONFIG, FOUNDATION_DB } from '../foundation/ports'
import type { AuthSession, FoundationDatabase, SqlClient } from '../foundation/ports'
import type { AppConfig } from '../config/configuration'
import { CoreRepository, requireUuid } from '../foundation/core.repository'
import { FoundationError, notFound } from '../foundation/errors'
import { requestHash } from '../foundation/canonical'
import { PostgresDocumentRepository } from './postgres-document.repository'
import { suggestDocumentGroup } from './document-archive'
import type { ArchiveEntry } from './document-archive'
import type { DocumentInspector } from './ports'
import { extractionSummary } from './extraction-summary'

export const DOSSIER_MAX_BYTES = 32 * 1024 * 1024
export interface DossierAttempt {
  archiveId: string; caseId: string; organizationId: string; fence: number; workerId: string
  kind: 'archive' | 'member'; memberId?: string; sha256: string; bytes: Buffer
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const memberSelect = `SELECT m.*,j.state AS job_state,j.error_code AS job_error,j.retryable AS job_retryable,
  EXISTS(SELECT 1 FROM aic.mvp_document_results r,
    LATERAL jsonb_array_elements(COALESCE(r.raw_extraction->'fields','[]'::jsonb)) f
    WHERE r.organization_id=m.organization_id AND r.case_id=m.case_id AND r.job_id=m.job_id
      AND r.outcome='published' AND f ? 'value' AND f->'value' IS DISTINCT FROM 'null'::jsonb
      AND f->'value' IS DISTINCT FROM '"unknown"'::jsonb AND f->>'quality'<>'unreadable'
      AND jsonb_array_length(COALESCE(f->'evidence_ids','[]'::jsonb))>0) AS usable
  FROM aic.mvp_dossier_members m LEFT JOIN aic.mvp_document_jobs j
    ON j.organization_id=m.organization_id AND j.case_id=m.case_id AND j.id=m.job_id`

@Injectable()
export class DossierRepository {
  private readonly core: CoreRepository
  private readonly documents: PostgresDocumentRepository
  constructor(@Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) private readonly config: AppConfig) {
    this.core = new CoreRepository(db)
    this.documents = new PostgresDocumentRepository(db, config)
  }
  private async active(tx: SqlClient, session: AuthSession) {
    if (!session?.user) throw new FoundationError(401, 'SESSION_EXPIRED')
    const found = await tx.query('SELECT * FROM aic.lock_active_session($1,$2,$3,$4)',
      [session.id, session.user.id, session.user.organization_id, this.config.sessionIdleMs])
    if (!found.rows[0]) throw new FoundationError(401, 'SESSION_EXPIRED')
  }
  private async access(tx: SqlClient, session: AuthSession, caseId: string, lock = true) {
    requireUuid(caseId)
    await this.active(tx, session)
    const current = await this.core.assertCaseAccess(tx, session.user, caseId, lock)
    await this.active(tx, session)
    return current
  }
  async enqueue(session: AuthSession, caseId: string, key: string, bytes: Buffer, expectedRevision?: number) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes.length > DOSSIER_MAX_BYTES ||
        bytes.readUInt32LE(0) !== 0x04034b50) throw new FoundationError(422, 'ARCHIVE_INVALID_ZIP')
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key || '') || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      throw new FoundationError(422, 'INVALID_INPUT')
    const owned = Buffer.from(bytes), sha256 = digest(owned)
    const hash = requestHash({ sha256, byte_size: owned.length, expected_revision: expectedRevision })
    return this.db.transaction(async (tx) => {
      const current = await this.access(tx, session, caseId)
      const scope = [session.user.organization_id, session.user.id, 'dossier/upload:case:' + caseId, key]
      const cached = (await tx.query(`SELECT *,expires_at>clock_timestamp() AS active FROM aic.idempotency_keys
        WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4`, scope)).rows[0]
      if (cached) {
        if (!cached.active || cached.request_hash !== hash) throw new FoundationError(409, 'IDEMPOTENCY_CONFLICT')
        return cached.response_body
      }
      if (Number(current.revision) !== expectedRevision || expectedRevision >= Number.MAX_SAFE_INTEGER)
        throw new FoundationError(409, 'REVISION_CONFLICT')
      const count = (await tx.query(`SELECT count(*)::int AS n FROM aic.mvp_dossier_archives WHERE organization_id=$1 AND case_id=$2`,
        [session.user.organization_id, caseId])).rows[0].n
      if (count >= 4) throw new FoundationError(409, 'DOSSIER_CASE_ARCHIVE_LIMIT')
      const id = randomUUID(), revision = expectedRevision + 1
      await tx.query("SET LOCAL synchronous_commit = 'on'")
      await tx.query(`INSERT INTO aic.mvp_dossier_archives(id,organization_id,case_id,created_by,sha256,byte_size,ai_mode)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, session.user.organization_id, caseId, session.user.id, sha256, owned.length, this.config.documentAiMode])
      await tx.query(`INSERT INTO aic.mvp_dossier_archive_objects(organization_id,case_id,archive_id,sha256,bytes)
        VALUES($1,$2,$3,$4,$5)`, [session.user.organization_id, caseId, id, sha256, owned])
      await tx.query(`UPDATE aic.cases SET revision=$3,dossier_intake_pending=dossier_intake_pending+1,
        updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2`, [session.user.organization_id, caseId, revision])
      const body = { archive_id: id, case_id: caseId, archive_sha256: sha256, revision,
        intake_state: 'queued', manifest_url: '/api/v2/dossier-archives/' + id }
      await tx.query(`INSERT INTO aic.idempotency_keys(organization_id,actor_id,operation,key,request_hash,response_status,response_body,expires_at)
        VALUES($1,$2,$3,$4,$5,202,$6::jsonb,clock_timestamp()+($7::bigint*interval '1 millisecond'))`,
        [...scope, hash, JSON.stringify(body), this.config.idempotencyTtlMs])
      await this.audit(tx, current.organization_id, caseId, id, 'dossier.queued', { sha256, authorization_actor_id: session.user.id })
      await this.active(tx, session)
      return body
    })
  }
  private async audit(tx: SqlClient, org: string, caseId: string, subject: string, action: string, metadata: unknown) {
    await tx.query(`INSERT INTO aic.audit_events(id,organization_id,case_id,actor_type,actor_id,action,subject_id,metadata_json)
      VALUES($1,$2,$3,'operator',NULL,$4,$5,$6::jsonb)`, [randomUUID(), org, caseId, action, subject, JSON.stringify(metadata)])
  }
  private projectMember(row: any) {
    const processing = row.state === 'rejected' ? 'not_applicable' : row.state === 'needs_review' ? 'needs_review' :
      row.job_state === 'succeeded' ? row.usable ? 'completed_with_usable_data' : 'completed_zero_usable' :
      ['failed', 'stale'].includes(row.job_state) ? 'failed' : row.job_state || 'waiting'
    return { id: row.id, archive_id: row.archive_id, entry_index: row.entry_index, entry_path: row.entry_path,
      byte_size: Number(row.byte_size), sha256: row.sha256, detected_mime: row.detected_mime,
      group: row.group_name, suggested_type: row.suggested_type, classification_verification: 'unverified',
      period_suggestion: { year: row.year_hint, kind: 'unresolved', basis: 'unresolved', verification: 'unverified' },
      subject_verification: 'unresolved', intake_state: row.state, processing_state: processing,
      page_count: row.page_count, document_id: row.document_id, job_id: row.job_id,
      error_code: row.error_code || row.job_error || null, retryable: row.retryable || row.job_retryable || false,
      source_url: row.sha256 ? '/api/v2/dossier-members/' + row.id + '/source' : null }
  }
  private summary(archive: any, members: ReturnType<DossierRepository['projectMember']>[]) {
    const counters = { discovered: members.length, registered: members.filter((m) => m.sha256 && m.intake_state !== 'rejected').length,
      rejected: members.filter((m) => m.intake_state === 'rejected').length,
      awaiting_inspection: members.filter((m) => ['awaiting_inspection', 'inspecting'].includes(m.intake_state)).length,
      queued: 0, running: 0, completed_with_usable_data: 0, completed_zero_usable: 0, failed: 0, needs_review: 0 }
    for (const member of members) if (Object.hasOwn(counters, member.processing_state)) counters[member.processing_state]++
    const processing = ['queued', 'validating', 'registering'].includes(archive.state) ? 'waiting' :
      counters.queued + counters.running ? 'processing' :
      archive.state === 'rejected' || counters.failed + counters.rejected + counters.needs_review > 0 ? 'finished_with_errors' : 'finished'
    return { id: archive.id, case_id: archive.case_id, archive_sha256: archive.sha256,
      intake_state: archive.state, processing_state: processing,
      created_at: archive.created_at instanceof Date ? archive.created_at.toISOString() : archive.created_at,
      counters, error_code: archive.error_code }
  }
  async get(session: AuthSession, id: string) {
    requireUuid(id)
    return this.db.transaction(async (tx) => {
      const binding = (await tx.query('SELECT case_id FROM aic.mvp_dossier_archives WHERE organization_id=$1 AND id=$2', [session.user.organization_id, id])).rows[0]
      if (!binding) throw notFound()
      await this.access(tx, session, binding.case_id)
      // Re-read after the case lock: never combine an old archive state with a
      // manifest that committed while this request waited for authorization.
      const archive = (await tx.query('SELECT * FROM aic.mvp_dossier_archives WHERE organization_id=$1 AND id=$2', [session.user.organization_id, id])).rows[0]
      const members = (await tx.query(`${memberSelect} WHERE m.organization_id=$1 AND m.archive_id=$2 ORDER BY m.entry_index`,
        [session.user.organization_id, id])).rows.map((row) => this.projectMember(row))
      await this.active(tx, session)
      return { ...this.summary(archive, members), members }
    })
  }
  async list(session: AuthSession, caseId: string) {
    await this.db.transaction((tx) => this.access(tx, session, caseId))
    const rows = (await this.db.query('SELECT id FROM aic.mvp_dossier_archives WHERE organization_id=$1 AND case_id=$2 ORDER BY created_at,id',
      [session.user.organization_id, caseId])).rows
    return Promise.all(rows.map(async (row) => { const { members, ...summary } = await this.get(session, row.id); return summary }))
  }
  private async member(session: AuthSession, id: string) {
    requireUuid(id)
    return this.db.transaction(async (tx) => {
      const binding = (await tx.query('SELECT case_id FROM aic.mvp_dossier_members WHERE organization_id=$1 AND id=$2', [session.user.organization_id, id])).rows[0]
      if (!binding) throw notFound()
      await this.access(tx, session, binding.case_id)
      const row = (await tx.query(`${memberSelect} WHERE m.organization_id=$1 AND m.id=$2`, [session.user.organization_id, id])).rows[0]
      return { row, member: this.projectMember(row) }
    })
  }
  async source(session: AuthSession, id: string) {
    const { member, row } = await this.member(session, id)
    return this.db.transaction(async (tx) => {
      await this.access(tx, session, row.case_id)
      const object = (await tx.query(`SELECT bytes,sha256 FROM aic.mvp_dossier_member_objects WHERE organization_id=$1 AND case_id=$2 AND member_id=$3`,
        [session.user.organization_id, row.case_id, id])).rows[0]
      if (!object) throw notFound()
      if (digest(object.bytes) !== row.sha256 || object.bytes.length !== Number(row.byte_size)) throw new FoundationError(500, 'SOURCE_INTEGRITY_FAILURE')
      await this.active(tx, session)
      return { member, bytes: object.bytes as Buffer }
    })
  }
  async memberSummary(session: AuthSession, id: string) {
    requireUuid(id)
    return this.db.transaction(async (tx) => {
      const binding = (await tx.query('SELECT case_id FROM aic.mvp_dossier_members WHERE organization_id=$1 AND id=$2', [session.user.organization_id, id])).rows[0]
      if (!binding) throw notFound()
      await this.access(tx, session, binding.case_id)
      const row = (await tx.query(`${memberSelect} WHERE m.organization_id=$1 AND m.id=$2`, [session.user.organization_id, id])).rows[0]
      const member = this.projectMember(row)
      const reader = new PostgresDocumentRepository({ query: (sql, values) => tx.query(sql, values), transaction: (work) => work(tx) }, this.config)
      const document = member.document_id ? (await reader.read(session, member.document_id)).document : null
      await this.active(tx, session)
      return { member_id: id, archive_id: member.archive_id, document_id: member.document_id, job_id: member.job_id,
        intake_state: member.intake_state, processing_state: member.processing_state, error_code: member.error_code,
        extraction: document ? extractionSummary(document) : null }
    })
  }
  async claim(workerId: string, leaseMs = 120_000): Promise<DossierAttempt | null> {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(workerId) || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000)
      throw new FoundationError(422, 'INVALID_INPUT')
    return this.db.transaction(async (tx) => {
      if (!(await tx.query("SELECT pg_try_advisory_xact_lock(hashtextextended('aic.dossier-intake-capacity',0)) AS locked")).rows[0].locked)
        return null
      if ((await tx.query(`SELECT count(*)::int AS n FROM aic.mvp_dossier_archives WHERE lease_expires_at>clock_timestamp()`)).rows[0].n >= 2)
        return null
      const current = (await tx.query(`SELECT c.* FROM aic.cases c WHERE EXISTS (
        SELECT 1 FROM aic.mvp_dossier_archives a WHERE a.organization_id=c.organization_id AND a.case_id=c.id
        AND a.state IN ('queued','validating','registering') AND (a.lease_expires_at IS NULL OR a.lease_expires_at<=clock_timestamp()))
        AND NOT EXISTS (SELECT 1 FROM aic.mvp_dossier_archives busy WHERE busy.organization_id=c.organization_id
          AND busy.case_id=c.id AND busy.lease_expires_at>clock_timestamp())
        ORDER BY c.updated_at,c.id LIMIT 1 FOR UPDATE OF c SKIP LOCKED`)).rows[0]
      if (!current) return null
      const archive = (await tx.query(`SELECT * FROM aic.mvp_dossier_archives WHERE organization_id=$1 AND case_id=$2
        AND state IN ('queued','validating','registering') AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp())
        ORDER BY updated_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [current.organization_id, current.id])).rows[0]
      if (!archive) return null
      let member: any = null
      if (archive.state === 'registering') {
        member = (await tx.query(`SELECT * FROM aic.mvp_dossier_members WHERE archive_id=$1
          AND state IN ('awaiting_inspection','inspecting') ORDER BY entry_index LIMIT 1 FOR UPDATE`, [archive.id])).rows[0]
        if (!member) { await this.finish(tx, archive); return null }
        if (member.attempts >= 3) {
          await tx.query(`UPDATE aic.mvp_dossier_members SET state='needs_review',error_code='DOSSIER_INSPECTION_ATTEMPTS_EXHAUSTED',retryable=false WHERE id=$1`, [member.id])
          await this.release(tx, archive, false)
          return null
        }
      } else if (archive.parse_attempts >= 3) {
        await this.finish(tx, archive, 'DOSSIER_INTAKE_ATTEMPTS_EXHAUSTED')
        return null
      }
      const changed = (await tx.query(`UPDATE aic.mvp_dossier_archives SET state=$2,
        parse_attempts=parse_attempts+$3,fence=fence+1,worker_id=$4,
        lease_expires_at=clock_timestamp()+($5::bigint*interval '1 millisecond'),updated_at=clock_timestamp()
        WHERE id=$1 RETURNING *`, [archive.id, member ? 'registering' : 'validating', member ? 0 : 1, workerId, leaseMs])).rows[0]
      if (member) await tx.query(`UPDATE aic.mvp_dossier_members SET state='inspecting',attempts=attempts+1 WHERE id=$1`, [member.id])
      const object = member ? (await tx.query(`SELECT bytes,sha256 FROM aic.mvp_dossier_member_objects WHERE member_id=$1`, [member.id])).rows[0] :
        (await tx.query(`SELECT bytes,sha256 FROM aic.mvp_dossier_archive_objects WHERE archive_id=$1`, [archive.id])).rows[0]
      if (!object || digest(object.bytes) !== object.sha256 || object.sha256 !== (member?.sha256 || archive.sha256))
        throw new FoundationError(500, 'SOURCE_INTEGRITY_FAILURE')
      return { archiveId: archive.id, caseId: archive.case_id, organizationId: archive.organization_id,
        fence: Number(changed.fence), workerId, kind: member ? 'member' : 'archive', memberId: member?.id,
        sha256: object.sha256, bytes: object.bytes }
    })
  }
  private async locked(tx: SqlClient, attempt: DossierAttempt) {
    await tx.query('SELECT id FROM aic.cases WHERE organization_id=$1 AND id=$2 FOR UPDATE', [attempt.organizationId, attempt.caseId])
    return (await tx.query(`SELECT * FROM aic.mvp_dossier_archives WHERE organization_id=$1 AND case_id=$2 AND id=$3
      AND fence=$4 AND worker_id=$5 AND lease_expires_at>clock_timestamp() FOR UPDATE`,
      [attempt.organizationId, attempt.caseId, attempt.archiveId, attempt.fence, attempt.workerId])).rows[0]
  }
  private async release(tx: SqlClient, archive: any, fenced = true) {
    const changed = await tx.query(`UPDATE aic.mvp_dossier_archives SET worker_id=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
      WHERE id=$1 ${fenced ? 'AND fence=$2 AND worker_id=$3 AND lease_expires_at>clock_timestamp()' : ''}`,
      fenced ? [archive.id, archive.fence, archive.worker_id] : [archive.id])
    if (changed.rowCount !== 1) throw new FoundationError(409, 'DOSSIER_STALE_LEASE')
  }
  private async finish(tx: SqlClient, archive: any, fatal: string | null = null) {
    const counts = (await tx.query(`SELECT count(*) FILTER(WHERE sha256 IS NOT NULL AND state<>'rejected')::int AS accepted,
      count(*) FILTER(WHERE state='rejected')::int AS rejected FROM aic.mvp_dossier_members WHERE archive_id=$1`, [archive.id])).rows[0]
    const state = fatal || !counts.accepted ? 'rejected' : counts.rejected ? 'partially_accepted' : 'accepted'
    await tx.query(`UPDATE aic.mvp_dossier_archives SET state=$2,error_code=$3,worker_id=NULL,lease_expires_at=NULL,
      updated_at=clock_timestamp() WHERE id=$1`, [archive.id, state, fatal])
    const counter = await tx.query(`UPDATE aic.cases SET dossier_intake_pending=dossier_intake_pending-1,updated_at=clock_timestamp()
      WHERE organization_id=$1 AND id=$2 AND dossier_intake_pending>0`, [archive.organization_id, archive.case_id])
    if (counter.rowCount !== 1) throw new FoundationError(500, 'DOSSIER_COUNTER_CONFLICT')
    await this.audit(tx, archive.organization_id, archive.case_id, archive.id, 'dossier.intake_finished', { intake_state: state, code: fatal })
  }
  async manifest(attempt: DossierAttempt, entries: ArchiveEntry[]) {
    if (attempt.kind !== 'archive' || !entries.length || entries.length > 128) throw new FoundationError(422, 'INVALID_INPUT')
    return this.db.transaction(async (tx) => {
      const archive = await this.locked(tx, attempt)
      if (!archive || archive.state !== 'validating') return false
      const quota = (await tx.query(`SELECT count(*)::int AS n,COALESCE(sum(octet_length(o.bytes)),0)::bigint AS bytes
        FROM aic.mvp_dossier_member_objects o WHERE organization_id=$1 AND case_id=$2`, [archive.organization_id, archive.case_id])).rows[0]
      let count = quota.n, total = Number(quota.bytes)
      for (const entry of entries) {
        if (Date.now() >= new Date(archive.lease_expires_at).getTime() - 1000)
          throw new FoundationError(409, 'DOSSIER_STALE_LEASE')
        const id = randomUUID(), suggestion = suggestDocumentGroup(entry.entry_path)
        let error = entry.rejection_code
        let bytes = entry.data ? Buffer.from(entry.data, 'base64') : null
        if (bytes && (bytes.length > 10 * 1024 * 1024 || bytes.length !== entry.byte_size || digest(bytes) !== entry.sha256))
          throw new FoundationError(500, 'ARCHIVE_READER_INVALID_OUTPUT')
        if (!error && bytes) {
          if (count >= 128) error = 'DOSSIER_CASE_MEMBER_LIMIT'
          else if (total + bytes.length > 128 * 1024 * 1024) error = 'DOSSIER_CASE_BYTE_LIMIT'
          else { count++; total += bytes.length }
        }
        if (error) bytes = null
        const years = [...new Set(entry.entry_path.match(/(?:19|20)\d{2}/g) || [])]
        await tx.query(`INSERT INTO aic.mvp_dossier_members(id,organization_id,case_id,archive_id,entry_index,entry_path,path_key,
          byte_size,sha256,detected_mime,suggested_type,group_name,year_hint,state,error_code)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [id, archive.organization_id, archive.case_id, archive.id, entry.entry_index, entry.entry_path,
           entry.entry_path.normalize('NFKC').toLowerCase(), entry.byte_size, bytes ? entry.sha256 : null,
           bytes ? 'application/pdf' : null, suggestion.suggested_type, suggestion.group, years.length === 1 ? Number(years[0]) : null,
           bytes ? 'awaiting_inspection' : 'rejected', error || (bytes ? null : 'INVALID_DOCUMENT')])
        if (bytes) await tx.query(`INSERT INTO aic.mvp_dossier_member_objects(organization_id,case_id,member_id,sha256,bytes)
          VALUES($1,$2,$3,$4,$5)`, [archive.organization_id, archive.case_id, id, entry.sha256, bytes])
      }
      await tx.query(`UPDATE aic.mvp_dossier_archives SET state='registering' WHERE id=$1`, [archive.id])
      await this.release(tx, archive)
      if (!entries.some((entry) => entry.data && !entry.rejection_code)) await this.finish(tx, archive)
      await this.audit(tx, archive.organization_id, archive.case_id, archive.id, 'dossier.manifested', { members: entries.length })
      return true
    })
  }
  async fail(attempt: DossierAttempt, code: string, retryable: boolean) {
    if (!/^[A-Z][A-Z0-9_]{1,99}$/.test(code)) throw new FoundationError(422, 'INVALID_INPUT')
    return this.db.transaction(async (tx) => {
      const archive = await this.locked(tx, attempt)
      if (!archive) return false
      if (attempt.kind === 'archive') {
        if (retryable && archive.parse_attempts < 3) {
          await tx.query(`UPDATE aic.mvp_dossier_archives SET state='queued',error_code=$2 WHERE id=$1`, [archive.id, code])
          await this.release(tx, archive)
        } else {
          await this.release(tx, archive)
          await this.finish(tx, archive, code)
        }
      } else {
        const member = (await tx.query('SELECT attempts FROM aic.mvp_dossier_members WHERE id=$1', [attempt.memberId])).rows[0]
        await tx.query(`UPDATE aic.mvp_dossier_members SET state=$2,error_code=$3,retryable=$4 WHERE id=$1 AND state='inspecting'`,
          [attempt.memberId, retryable && member.attempts < 3 ? 'awaiting_inspection' : retryable ? 'needs_review' : 'rejected',
           code, retryable && member.attempts < 3])
        await this.release(tx, archive)
      }
      return true
    })
  }
  async inspected(attempt: DossierAttempt, inspection: Awaited<ReturnType<DocumentInspector['inspect']>>) {
    return this.db.transaction(async (tx) => {
      const archive = await this.locked(tx, attempt)
      if (!archive || attempt.kind !== 'member') return false
      if (inspection.sha256 !== attempt.sha256 || inspection.byte_size !== attempt.bytes.length || inspection.page_count < 1)
        throw new FoundationError(502, 'AI_CONTENT_MISMATCH')
      let code = inspection.encrypted || inspection.has_embedded_files ? 'DOCUMENT_INSPECTION_REJECTED' :
        inspection.page_count > 500 ? 'PDF_PAGE_BUDGET' : inspection.page_count > 10 ? 'PDF_REQUIRES_CHUNKED_PROCESSING' : null
      if (!code) {
        try { await this.documents.registerDossierMember(tx, archive.id, attempt.memberId, attempt.fence,
          attempt.workerId, attempt.bytes, inspection.page_count, inspection.mode) }
        catch (error) {
          if (!(error instanceof FoundationError) || (error.getResponse() as any).code !== 'PDF_PAGE_BUDGET') throw error
          code = 'PDF_PAGE_BUDGET'
        }
      }
      if (code) await tx.query(`UPDATE aic.mvp_dossier_members SET state=$2,page_count=$3,error_code=$4,retryable=false
        WHERE id=$1 AND state='inspecting'`, [attempt.memberId,
        code === 'DOCUMENT_INSPECTION_REJECTED' ? 'rejected' : 'needs_review', inspection.page_count, code])
      await this.release(tx, archive)
      const pending = (await tx.query(`SELECT 1 FROM aic.mvp_dossier_members WHERE archive_id=$1
        AND state IN ('awaiting_inspection','inspecting') LIMIT 1`, [archive.id])).rows[0]
      if (!pending) await this.finish(tx, archive)
      return true
    })
  }
}
