import { Inject, Injectable } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import {
  FOUNDATION_CONFIG,
  FOUNDATION_DB,
  FoundationConfig,
  FoundationDatabase,
  AuthSession,
  SqlClient,
} from '../foundation/ports'
import { CoreRepository, requireUuid } from '../foundation/core.repository'
import { FoundationError, notFound } from '../foundation/errors'
import { canonicalJson, requestHash } from '../foundation/canonical'
import type { ArchiveInput, PreparedArchiveItem } from './document-archive'
import {
  DocumentRepository,
  DocumentWorkerRepository,
  DocumentUpload,
  DocumentAcceptResult,
  DocumentAttempt,
  StoredDocument,
  DOCUMENT_TYPES,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_PAGES,
  DOCUMENT_MAX_ACTIVE,
  DOCUMENT_MAX_ACTIVE_PAGES,
  DOCUMENT_RETRY_MAX_ATTEMPTS,
  DOCUMENT_RETRY_DEADLINE_MS,
  DOCUMENT_RETRY_MIN_REMAINING_MS,
  projectDocument,
} from './ports'

// Wire DOCUMENT_REPOSITORY with useExisting: PostgresDocumentRepository. The same
// instance implements DocumentWorkerRepository; workers need no fabricated AuthSession.
const documentSelect = `SELECT d.*, l.capacity_class, (l.current_document_id=d.id) AS active,
  CASE j.state WHEN 'succeeded' THEN 'completed' WHEN 'stale' THEN 'failed'
    ELSE j.state END AS status,
  COALESCE(r.ai_mode,d.ai_mode) AS ai_mode, r.raw_extraction AS extraction,
  (SELECT h.payload_json || jsonb_build_object('actor_id',h.actor_id,'created_at',h.created_at)
    FROM aic.mvp_document_decisions h WHERE h.organization_id=d.organization_id AND h.case_id=d.case_id
      AND h.document_id=d.id AND h.kind='classification'
      AND h.payload_json->>'counterparty_revision'=(SELECT p.revision::text FROM aic.cases c JOIN aic.counterparties p ON p.organization_id=c.organization_id AND p.id=c.counterparty_id WHERE c.organization_id=d.organization_id AND c.id=d.case_id)
      ORDER BY h.case_revision DESC LIMIT 1) AS source_review
  FROM aic.mvp_documents d
  JOIN aic.mvp_document_lineages l ON l.organization_id=d.organization_id
    AND l.case_id=d.case_id AND l.id=d.lineage
  JOIN aic.mvp_document_jobs j ON j.organization_id=d.organization_id
    AND j.case_id=d.case_id AND j.document_id=d.id
  LEFT JOIN aic.mvp_document_results r ON r.organization_id=d.organization_id
    AND r.case_id=d.case_id AND r.job_id=j.id AND r.outcome='published'`
const iso = (value: string | Date) => (value instanceof Date ? value.toISOString() : value)
const conflict = (code: string) => new FoundationError(409, code)
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const validUuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
function positive(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new FoundationError(422, 'INVALID_INPUT')
}

@Injectable()
export class PostgresDocumentRepository implements DocumentRepository, DocumentWorkerRepository {
  private readonly core: CoreRepository
  constructor(
    @Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) private readonly config: FoundationConfig,
  ) {
    positive(config.idempotencyTtlMs)
    positive(config.sessionIdleMs)
    this.core = new CoreRepository(db)
  }

  private async session(tx: SqlClient, session: AuthSession) {
    if (
      !session ||
      !validUuid(session.id) ||
      !validUuid(session.user?.id) ||
      !validUuid(session.user?.organization_id)
    )
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
    await this.session(tx, session)
    const current = await this.core.assertCaseAccess(tx, session.user, caseId, true)
    // Authorization lock waits may cross both absolute and idle expiry.
    await this.session(tx, session)
    return current
  }

  private archiveScope(session: AuthSession, caseId: string, key: string, input: ArchiveInput) {
    requireUuid(caseId)
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key || '') ||
        !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 ||
        !/^[a-f0-9]{64}$/.test(input.sha256))
      throw new FoundationError(422, 'INVALID_INPUT')
    return [session.user.organization_id, session.user.id, 'document/archive:case:' + caseId, key]
  }

  private async archiveReplay(tx: SqlClient, scope: unknown[], input: ArchiveInput) {
    const row = (await tx.query(`SELECT *,expires_at>clock_timestamp() AS active
      FROM aic.idempotency_keys WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4`, scope)).rows[0]
    if (!row) return null
    if (!row.active || row.request_hash !== requestHash(input)) throw conflict('IDEMPOTENCY_CONFLICT')
    return row.response_body as Record<string, unknown>
  }

  /** ACL/session always precede replay, including after membership revocation. */
  async replayArchive(session: AuthSession, caseId: string, key: string, input: ArchiveInput) {
    const scope = this.archiveScope(session, caseId, key, input)
    return this.db.transaction(async (tx) => {
      await this.access(tx, session, caseId)
      const replay = await this.archiveReplay(tx, scope, input)
      await this.session(tx, session)
      return replay
    })
  }

  /** All accepted members and the complete receipt commit atomically, no migration.
   * Reuse the existing single-document writer on this SAME transaction/client;
   * it retains quotas, immutable bytes, version/hash, jobs, audit and replay rules.
   */
  async acceptArchive(session: AuthSession, caseId: string, key: string, input: ArchiveInput,
                      items: PreparedArchiveItem[]) {
    const scope = this.archiveScope(session, caseId, key, input)
    return this.db.transaction(async (tx) => {
      const current = await this.access(tx, session, caseId)
      const replay = await this.archiveReplay(tx, scope, input)
      if (replay) return replay
      if (Number(current.revision) !== input.expectedRevision) throw conflict('REVISION_CONFLICT')
      const writer = new PostgresDocumentRepository({
        query: (sql, values) => tx.query(sql, values),
        transaction: (work) => work(tx),
      }, this.config)
      let revision = input.expectedRevision, accepted = 0
      const output = []
      for (const item of items) {
        const { upload, ...descriptor } = item
        if (!upload || descriptor.rejection) {
          output.push({ ...descriptor, status: 'rejected', document: null, job: null })
          continue
        }
        try {
          const memberKey = 'zip:' + requestHash({ scope, archive: input.sha256, index: item.entry_index })
          const result = await writer.accept(session, caseId, memberKey, { ...upload, expectedRevision: revision })
          revision = result.body.revision
          accepted++
          output.push({ ...descriptor, status: 'accepted', document: result.body.document, job: result.body.job })
        } catch (error) {
          // This guard occurs before writes in accept. Any other error aborts the
          // entire transaction; never continue after a failed SQL statement.
          if (!(error instanceof FoundationError) ||
              (error.getResponse() as any).code !== 'DOCUMENT_CASE_QUOTA_EXCEEDED') throw error
          output.push({ ...descriptor, status: 'rejected', document: null, job: null,
                        rejection: { code: 'DOCUMENT_CASE_QUOTA_EXCEEDED', retryable: false } })
        }
      }
      const body = { archive_sha256: input.sha256, case_id: caseId, revision,
                     state: accepted === output.length ? 'accepted' : accepted ? 'partial' : 'rejected', items: output }
      await this.audit(tx, session.user.organization_id, caseId, caseId, 'specialist', session.user.id,
                       'document.archive_imported', input.expectedRevision, revision,
                       { archive_sha256: input.sha256, accepted, rejected: output.length - accepted })
      await tx.query(`INSERT INTO aic.idempotency_keys
        (organization_id,actor_id,operation,key,request_hash,response_status,response_body,expires_at)
        VALUES($1,$2,$3,$4,$5,202,$6::jsonb,clock_timestamp()+($7::bigint*interval '1 millisecond'))`,
        [...scope, requestHash(input), JSON.stringify(body), this.config.idempotencyTtlMs])
      await this.session(tx, session)
      return body
    })
  }

  private clientUpload(key: string, upload: Omit<DocumentUpload, 'pageCount' | 'aiMode'>) {
    if (
      !upload ||
      !['new', 'replace', 'response'].includes(upload.mode) ||
      !DOCUMENT_TYPES.includes(upload.type) ||
      typeof key !== 'string' ||
      !/^[\x21-\x7e]{1,200}$/.test(key) ||
      typeof upload.sourceClass !== 'string' ||
      !upload.sourceClass.trim() ||
      upload.sourceClass.length > 200 ||
      /[\x00-\x1f\x7f]/.test(upload.sourceClass) ||
      typeof upload.displayName !== 'string' ||
      !upload.displayName.trim() ||
      upload.displayName.length > 255 ||
      /[\x00-\x1f\x7f]/.test(upload.displayName) ||
      !Number.isSafeInteger(upload.expectedRevision) ||
      upload.expectedRevision < 1 ||
      !Buffer.isBuffer(upload.bytes) ||
      upload.bytes.length < 1 ||
      typeof upload.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(upload.sha256) ||
      (upload.mode !== 'replace' && upload.replacesDocumentId !== undefined) ||
      (upload.mode !== 'response' && upload.responseRequestId !== undefined) ||
      (upload.mode === 'replace' && !validUuid(upload.replacesDocumentId)) ||
      (upload.mode === 'response' && !validUuid(upload.responseRequestId))
    )
      throw new FoundationError(422, 'INVALID_INPUT')
    if (upload.bytes.length > DOCUMENT_MAX_BYTES)
      throw new FoundationError(413, 'DOCUMENT_TOO_LARGE')
    // Own the bytes and metadata before the first await; callers cannot change a fingerprint in flight.
    const copy = { ...upload, bytes: Buffer.from(upload.bytes) }
    if (digest(copy.bytes) !== copy.sha256) throw new FoundationError(422, 'DOCUMENT_HASH_MISMATCH')
    return copy
  }

  private upload(key: string, upload: DocumentUpload): DocumentUpload {
    const copy = this.clientUpload(key, upload)
    if (
      !['live', 'mock'].includes(upload.aiMode) ||
      !Number.isInteger(upload.pageCount) ||
      upload.pageCount < 1
    )
      throw new FoundationError(422, 'INVALID_INPUT')
    if (upload.pageCount > DOCUMENT_MAX_PAGES) throw new FoundationError(422, 'DOCUMENT_PAGE_LIMIT')
    return { ...copy, pageCount: upload.pageCount, aiMode: upload.aiMode }
  }

  private fingerprint(caseId: string, upload: Omit<DocumentUpload, 'pageCount' | 'aiMode'>) {
    return requestHash({
      case_id: caseId,
      mode: upload.mode,
      type: upload.type,
      source_class: upload.sourceClass,
      expected_revision: upload.expectedRevision,
      replaces_document_id: upload.replacesDocumentId ?? null,
      name: upload.displayName,
      response_request_id: upload.responseRequestId ?? null,
      sha256: upload.sha256,
      byte_size: upload.bytes.length,
    })
  }

  async replay(
    session: AuthSession,
    caseId: string,
    key: string,
    input: Omit<DocumentUpload, 'pageCount' | 'aiMode'>,
  ): Promise<DocumentAcceptResult | null> {
    requireUuid(caseId)
    const upload = this.clientUpload(key, input),
      hash = this.fingerprint(caseId, upload)
    return this.db.transaction(async (tx) => {
      await this.access(tx, session, caseId)
      const cached = (
        await tx.query(
          `SELECT *,expires_at>clock_timestamp() AS active
        FROM aic.mvp_document_replays WHERE organization_id=$1 AND actor_id=$2
        AND case_id=$3 AND operation=$4 AND key=$5`,
          [session.user.organization_id, session.user.id, caseId, 'document/' + upload.mode, key],
        )
      ).rows[0]
      await this.session(tx, session)
      if (!cached) return null
      if (!cached.active || cached.request_hash !== hash) throw conflict('IDEMPOTENCY_CONFLICT')
      return { status: 202, body: cached.response_body, replayed: true }
    })
  }

  async accept(
    session: AuthSession,
    caseId: string,
    key: string,
    input: DocumentUpload,
  ): Promise<DocumentAcceptResult> {
    requireUuid(caseId)
    const upload = this.upload(key, input)
    const hash = this.fingerprint(caseId, upload)
    return this.db.transaction(async (tx) => {
      const current = await this.access(tx, session, caseId)
      const org = session.user.organization_id
      const scope = [org, session.user.id, caseId, 'document/' + upload.mode, key]
      // The case lock serializes acceptance and keys; current ACL always precedes replay.
      const cached = (
        await tx.query(
          `SELECT *,expires_at>clock_timestamp() AS active
        FROM aic.mvp_document_replays WHERE organization_id=$1 AND actor_id=$2
        AND case_id=$3 AND operation=$4 AND key=$5`,
          scope,
        )
      ).rows[0]
      if (cached) {
        if (!cached.active || cached.request_hash !== hash) throw conflict('IDEMPOTENCY_CONFLICT')
        await this.session(tx, session)
        return { status: 202, body: cached.response_body, replayed: true }
      }
      const revision = Number(current.revision)
      if (revision !== upload.expectedRevision || revision >= Number.MAX_SAFE_INTEGER)
        throw conflict('REVISION_CONFLICT')
      let old: any = null
      let responseRequest: any = null
      if (upload.mode === 'replace') {
        old = (
          await tx.query(
            `${documentSelect} WHERE d.organization_id=$1 AND d.case_id=$2
          AND d.id=$3 AND l.current_document_id=d.id`,
            [org, caseId, upload.replacesDocumentId],
          )
        ).rows[0]
        if (!old) throw notFound()
        if (old.version >= 2147483647) throw conflict('DOCUMENT_VERSION_LIMIT')
        const binding = (
          await tx.query(
            `SELECT request_id FROM aic.mvp_response_bindings WHERE organization_id=$1 AND case_id=$2 AND document_id=$3`,
            [org, caseId, old.id],
          )
        ).rows[0]
        if (binding) {
          responseRequest = (
            await tx.query(
              'SELECT * FROM aic.mvp_document_requests WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR SHARE',
              [org, caseId, binding.request_id],
            )
          ).rows[0]
          if (responseRequest?.status !== 'approved' || !responseRequest.approved_hash)
            throw conflict('RESPONSE_REQUEST_NOT_APPROVED')
          if (!responseRequest.document_types.includes(upload.type))
            throw conflict('RESPONSE_DOCUMENT_TYPE_NOT_REQUESTED')
        }
      }
      if (upload.mode === 'response') {
        responseRequest = (
          await tx.query(
            `SELECT id,revision,approved_hash,status,document_types
          FROM aic.mvp_document_requests WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR SHARE`,
            [org, caseId, upload.responseRequestId],
          )
        ).rows[0]
        if (!responseRequest) throw notFound()
        if (responseRequest.status !== 'approved' || !responseRequest.approved_hash)
          throw conflict('RESPONSE_REQUEST_NOT_APPROVED')
        if (
          !Array.isArray(responseRequest.document_types) ||
          !responseRequest.document_types.includes(upload.type)
        )
          throw conflict('RESPONSE_DOCUMENT_TYPE_NOT_REQUESTED')
        await this.session(tx, session)
      }
      const quota = (
        await tx.query(
          `SELECT count(*)::int AS count,COALESCE(sum(d.pages),0)::int AS pages
        FROM aic.mvp_document_lineages l JOIN aic.mvp_documents d ON d.organization_id=l.organization_id
        AND d.case_id=l.case_id AND d.id=l.current_document_id
        WHERE l.organization_id=$1 AND l.case_id=$2 AND l.capacity_class='legacy'`,
          [org, caseId],
        )
      ).rows[0]
      if (
        old?.capacity_class !== 'dossier' && (
          quota.count + (old ? 0 : 1) > DOCUMENT_MAX_ACTIVE ||
          quota.pages - (old?.pages ?? 0) + upload.pageCount > DOCUMENT_MAX_ACTIVE_PAGES)
      )
        throw conflict('DOCUMENT_CASE_QUOTA_EXCEEDED')
      if (old?.capacity_class === 'dossier') {
        const dossierPages = (await tx.query(`SELECT COALESCE(sum(d.pages),0)::int AS pages
          FROM aic.mvp_document_lineages l JOIN aic.mvp_documents d ON d.organization_id=l.organization_id
            AND d.case_id=l.case_id AND d.id=l.current_document_id
          WHERE l.organization_id=$1 AND l.case_id=$2 AND l.capacity_class='dossier'`, [org, caseId])).rows[0].pages
        if (dossierPages - old.pages + upload.pageCount > 1024) throw conflict('PDF_PAGE_BUDGET')
      }
      const id = randomUUID(),
        jobId = randomUUID(),
        lineage = old?.lineage ?? randomUUID()
      const version = old ? old.version + 1 : 1,
        next = revision + 1
      // A connection configured with synchronous_commit=off must not weaken canonical acceptance.
      await tx.query("SET LOCAL synchronous_commit = 'on'")
      await tx.query(
        `INSERT INTO aic.mvp_document_objects
        (organization_id,case_id,document_id,sha256,byte_size,bytes) VALUES($1,$2,$3,$4,$5,$6)`,
        [org, caseId, id, upload.sha256, upload.bytes.length, upload.bytes],
      )
      if (!old)
        await tx.query(
          `INSERT INTO aic.mvp_document_lineages
        (organization_id,case_id,id,current_document_id) VALUES($1,$2,$3,$4)`,
          [org, caseId, lineage, id],
        )
      const row = (
        await tx.query(
          `INSERT INTO aic.mvp_documents
        (id,organization_id,case_id,lineage,version,replaces_document_id,hash,byte_size,pages,name,type,source_class,ai_mode,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [
            id,
            org,
            caseId,
            lineage,
            version,
            old?.id ?? null,
            upload.sha256,
            upload.bytes.length,
            upload.pageCount,
            upload.displayName,
            upload.type,
            upload.sourceClass,
            upload.aiMode,
            session.user.id,
          ],
        )
      ).rows[0]
      if (old) {
        const moved = await tx.query(
          `UPDATE aic.mvp_document_lineages SET current_document_id=$4
          WHERE organization_id=$1 AND case_id=$2 AND id=$3 AND current_document_id=$5`,
          [org, caseId, lineage, id, old.id],
        )
        if (moved.rowCount !== 1) throw conflict('REVISION_CONFLICT')
      }
      await tx.query(
        `INSERT INTO aic.mvp_document_jobs
        (id,organization_id,case_id,document_id,document_version,sha256,snapshot_case_revision,ai_mode,snapshot_counterparty_revision)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,(SELECT revision FROM aic.counterparties WHERE organization_id=$2 AND id=$9))`,
        [
          jobId,
          org,
          caseId,
          id,
          version,
          upload.sha256,
          next,
          upload.aiMode,
          current.counterparty_id,
        ],
      )
      if (responseRequest)
        await tx.query(
          `INSERT INTO aic.mvp_response_bindings
        (organization_id,case_id,request_id,request_revision,request_hash,document_id)
        VALUES($1,$2,$3,$4,$5,$6)`,
          [
            org,
            caseId,
            responseRequest.id,
            responseRequest.revision,
            responseRequest.approved_hash,
            id,
          ],
        )
      const document: StoredDocument = { ...row, status: 'queued', active: true, extraction: null }
      const body = JSON.parse(
        canonicalJson({
          document: projectDocument(document),
          job: this.projectJob({
            id: jobId,
            case_id: caseId,
            document_id: id,
            state: 'queued',
            attempts: 0,
            error_code: null,
            retryable: false,
            ai_mode: upload.aiMode,
            created_at: row.created_at,
          }),
          revision: next,
        }),
      )
      await tx.query(
        `UPDATE aic.cases SET revision=$3,updated_at=clock_timestamp()
        WHERE organization_id=$1 AND id=$2 AND revision=$4`,
        [org, caseId, next, revision],
      )
      await this.audit(
        tx,
        org,
        caseId,
        id,
        'specialist',
        session.user.id,
        upload.mode === 'replace'
          ? 'document.replaced'
          : responseRequest
            ? 'document.response_accepted'
            : 'document.accepted',
        revision,
        next,
        {
          document_id: id,
          job_id: jobId,
          lineage,
          version,
          sha256: upload.sha256,
          ai_mode: upload.aiMode,
          replaces_document_id: old?.id ?? null,
          response_request_id: responseRequest?.id ?? null,
          response_request_revision: responseRequest ? Number(responseRequest.revision) : null,
          response_request_hash: responseRequest?.approved_hash ?? null,
          subject_verification: 'unverified',
        },
      )
      await tx.query(
        `INSERT INTO aic.mvp_document_replays
        (organization_id,actor_id,case_id,operation,key,request_hash,document_id,job_id,response_status,response_body,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,202,$9::jsonb,clock_timestamp()+($10::bigint*interval '1 millisecond'))`,
        [...scope, hash, id, jobId, JSON.stringify(body), this.config.idempotencyTtlMs],
      )
      await this.session(tx, session)
      return { status: 202, body, replayed: false }
    })
  }

  /** Only the durable intake worker calls this on its locked, fenced transaction.
   * No AuthSession is invented: upload intent authorizes background work; current
   * actor membership/account is checked again independently of browser logout.
   */
  async registerDossierMember(tx: SqlClient, archiveId: string, memberId: string,
    fence: number, workerId: string, bytes: Buffer, pageCount: number, mode: 'live' | 'mock') {
    requireUuid(archiveId)
    requireUuid(memberId)
    const source = (await tx.query(`SELECT m.*,a.created_by,a.ai_mode
      FROM aic.mvp_dossier_members m JOIN aic.mvp_dossier_archives a
        ON a.organization_id=m.organization_id AND a.case_id=m.case_id AND a.id=m.archive_id
      WHERE a.id=$1 AND m.id=$2 AND a.fence=$3 AND a.worker_id=$4
        AND a.lease_expires_at>clock_timestamp() AND a.state='registering'
        AND m.state='inspecting' AND m.document_id IS NULL`, [archiveId, memberId, fence, workerId])).rows[0]
    if (!source) throw conflict('DOSSIER_STALE_LEASE')
    if (source.ai_mode !== mode) throw new FoundationError(502, 'AI_MODE_MISMATCH')
    const current = await this.core.assertCaseAccess(tx, {
      id: source.created_by, organization_id: source.organization_id, role: 'specialist', display_name: '',
    }, source.case_id, true)
    const revision = Number(current.revision)
    if (revision >= Number.MAX_SAFE_INTEGER) throw conflict('REVISION_CONFLICT')
    const upload = this.upload('dossier:' + memberId, {
      mode: 'new', type: source.suggested_type, sourceClass: 'dossier_unverified', expectedRevision: revision,
      displayName: source.entry_path.split('/').pop().slice(0, 200), bytes,
      sha256: source.sha256, pageCount, aiMode: mode,
    })
    if (upload.bytes.length !== Number(source.byte_size)) throw new FoundationError(500, 'SOURCE_INTEGRITY_FAILURE')
    const pages = (await tx.query(`SELECT COALESCE(sum(d.pages),0)::int AS pages
      FROM aic.mvp_document_lineages l JOIN aic.mvp_documents d ON d.organization_id=l.organization_id
        AND d.case_id=l.case_id AND d.id=l.current_document_id
      WHERE l.organization_id=$1 AND l.case_id=$2 AND l.capacity_class='dossier'`,
      [source.organization_id, source.case_id])).rows[0].pages
    if (pages + pageCount > 1024) throw conflict('PDF_PAGE_BUDGET')
    const id = randomUUID(), lineage = randomUUID(), jobId = randomUUID(), next = revision + 1
    await tx.query("SET LOCAL synchronous_commit = 'on'")
    await tx.query(`INSERT INTO aic.mvp_document_objects
      (organization_id,case_id,document_id,sha256,byte_size,bytes) VALUES($1,$2,$3,$4,$5,$6)`,
      [source.organization_id, source.case_id, id, upload.sha256, bytes.length, upload.bytes])
    await tx.query(`INSERT INTO aic.mvp_document_lineages
      (organization_id,case_id,id,current_document_id,capacity_class) VALUES($1,$2,$3,$4,'dossier')`,
      [source.organization_id, source.case_id, lineage, id])
    await tx.query(`INSERT INTO aic.mvp_documents
      (id,organization_id,case_id,lineage,version,hash,byte_size,pages,name,type,source_class,ai_mode,created_by)
      VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,'dossier_unverified',$10,$11)`,
      [id, source.organization_id, source.case_id, lineage, upload.sha256, bytes.length, pageCount,
       upload.displayName, upload.type, mode, source.created_by])
    await tx.query(`INSERT INTO aic.mvp_document_jobs
      (id,organization_id,case_id,document_id,document_version,sha256,snapshot_case_revision,ai_mode,snapshot_counterparty_revision)
      VALUES($1,$2,$3,$4,1,$5,$6,$7,(SELECT revision FROM aic.counterparties WHERE organization_id=$2 AND id=$8))`,
      [jobId, source.organization_id, source.case_id, id, upload.sha256, next, mode, current.counterparty_id])
    const linked = await tx.query(`UPDATE aic.mvp_dossier_members SET document_id=$2,job_id=$3,state='registered',
      page_count=$4,error_code=NULL,retryable=false WHERE id=$1 AND state='inspecting' AND document_id IS NULL`,
      [memberId, id, jobId, pageCount])
    if (linked.rowCount !== 1) throw conflict('DOSSIER_STALE_LEASE')
    await tx.query(`UPDATE aic.cases SET revision=$3,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2`,
      [source.organization_id, source.case_id, next])
    await this.audit(tx, source.organization_id, source.case_id, id, 'operator', null,
      'document.dossier_registered', revision, next,
      { archive_id: archiveId, member_id: memberId, document_id: id, job_id: jobId,
        version: 1, sha256: upload.sha256, authorization_actor_id: source.created_by, subject_verification: 'unverified' })
    return { documentId: id, jobId }
  }

  async list(session: AuthSession, caseId: string): Promise<StoredDocument[]> {
    requireUuid(caseId)
    return this.db.transaction(async (tx) => {
      await this.access(tx, session, caseId)
      const result = await tx.query(
        `${documentSelect} WHERE d.organization_id=$1 AND d.case_id=$2
        AND l.current_document_id=d.id ORDER BY d.created_at,d.id`,
        [session.user.organization_id, caseId],
      )
      await this.session(tx, session)
      return result.rows
    })
  }

  async read(
    session: AuthSession,
    documentId: string,
  ): Promise<{ document: StoredDocument; bytes: Buffer }> {
    requireUuid(documentId)
    return this.db.transaction(async (tx) => {
      await this.session(tx, session)
      const scope = [session.user.organization_id, documentId]
      const found = (
        await tx.query(
          `SELECT case_id FROM aic.mvp_documents
        WHERE organization_id=$1 AND id=$2`,
          scope,
        )
      ).rows[0]
      if (!found) throw notFound()
      await this.access(tx, session, found.case_id)
      const document = (
        await tx.query(`${documentSelect} WHERE d.organization_id=$1 AND d.id=$2`, scope)
      ).rows[0]
      if (!document) throw notFound()
      const object = (
        await tx.query(
          `SELECT bytes FROM aic.mvp_document_objects
        WHERE organization_id=$1 AND case_id=$2 AND document_id=$3`,
          [session.user.organization_id, found.case_id, documentId],
        )
      ).rows[0]
      this.verify(document, object?.bytes)
      await this.session(tx, session)
      return { document, bytes: object.bytes }
    })
  }

  async evidenceDocument(session: AuthSession, evidenceId: string): Promise<StoredDocument> {
    requireUuid(evidenceId)
    return this.db.transaction(async (tx) => {
      await this.session(tx, session)
      const found = await tx.query(
        `SELECT r.document_id,r.case_id FROM aic.mvp_document_results r
        JOIN aic.case_memberships m ON m.organization_id=r.organization_id AND m.case_id=r.case_id AND m.user_id=$2
        JOIN aic.users u ON u.organization_id=m.organization_id AND u.id=m.user_id AND u.disabled_at IS NULL
        WHERE r.organization_id=$1 AND r.outcome='published' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.raw_extraction->'evidence')='array'
            THEN r.raw_extraction->'evidence' ELSE '[]'::jsonb END) e WHERE e->>'id'=$3
        ) LIMIT 2`,
        [session.user.organization_id, session.user.id, evidenceId],
      )
      // Ambiguous IDs are also hidden; do not search any unauthorized case for uniqueness.
      if (found.rows.length !== 1) throw notFound()
      const hit = found.rows[0]
      await this.access(tx, session, hit.case_id)
      const document = (
        await tx.query(
          `${documentSelect} WHERE d.organization_id=$1 AND d.case_id=$2 AND d.id=$3`,
          [session.user.organization_id, hit.case_id, hit.document_id],
        )
      ).rows[0]
      if (!document) throw notFound()
      await this.session(tx, session)
      return document
    })
  }

  private projectJob(row: any): Record<string, unknown> {
    const state =
      row.state === 'succeeded' ? 'completed' : row.state === 'stale' ? 'failed' : row.state
    return {
      id: row.id,
      case_id: row.case_id,
      document_id: row.document_id,
      state,
      attempts: Number(row.attempts),
      errors: row.error_code ? [{ code: row.error_code, retryable: row.retryable }] : [],
      retryable: row.retryable,
      mode: row.ai_mode,
      created_at: iso(row.created_at),
    }
  }

  async job(session: AuthSession, jobId: string): Promise<Record<string, unknown>> {
    requireUuid(jobId)
    return this.db.transaction(async (tx) => {
      await this.session(tx, session)
      const row = (
        await tx.query(`SELECT * FROM aic.mvp_document_jobs WHERE organization_id=$1 AND id=$2`, [
          session.user.organization_id,
          jobId,
        ])
      ).rows[0]
      if (!row) throw notFound()
      await this.access(tx, session, row.case_id)
      // Re-read after the case lock, rather than returning a pre-wait job snapshot.
      const current = (
        await tx.query(`SELECT * FROM aic.mvp_document_jobs WHERE organization_id=$1 AND id=$2`, [
          session.user.organization_id,
          jobId,
        ])
      ).rows[0]
      await this.session(tx, session)
      return this.projectJob(current)
    })
  }

  async listJobs(session: AuthSession, caseId: string): Promise<Record<string, unknown>[]> {
    requireUuid(caseId)
    return this.db.transaction(async (tx) => {
      await this.access(tx, session, caseId)
      const rows = (
        await tx.query(
          `SELECT * FROM aic.mvp_document_jobs
        WHERE organization_id=$1 AND case_id=$2 ORDER BY created_at,id`,
          [session.user.organization_id, caseId],
        )
      ).rows
      await this.session(tx, session)
      return rows.map((row) => this.projectJob(row))
    })
  }

  /** Called only inside CaseMutations, after its current session/ACL/replay/revision checks. */
  async retryFailed(
    tx: SqlClient,
    organizationId: string,
    caseId: string,
    jobId: string,
    currentRevision: number,
  ): Promise<Record<string, unknown>> {
    const scope = [organizationId, caseId, jobId]
    // CaseMutations already holds the case lock: retain case -> job lock order.
    const job = (
      await tx.query(
        `SELECT * FROM aic.mvp_document_jobs
        WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE`,
        scope,
      )
    ).rows[0]
    if (!job) throw notFound()
    if (job.state !== 'failed' || job.lease_expires_at !== null) throw conflict('JOB_NOT_RETRYABLE')
    if (
      !job.retryable ||
      job.attempts < 1 ||
      job.attempts >= DOCUMENT_RETRY_MAX_ATTEMPTS ||
      Number(job.fence) < job.attempts ||
      Number(job.fence) >= Number.MAX_SAFE_INTEGER
    )
      throw conflict('JOB_RETRY_BUDGET_EXHAUSTED')
    if (Number(job.snapshot_case_revision) !== currentRevision)
      throw conflict('STALE_DOCUMENT_SNAPSHOT')
    if (
      !(
        await tx.query(
          `SELECT 1 FROM aic.cases c JOIN aic.counterparties p ON p.organization_id=c.organization_id AND p.id=c.counterparty_id
      WHERE c.organization_id=$1 AND c.id=$2 AND p.revision=$3 FOR SHARE OF p`,
          [organizationId, caseId, job.snapshot_counterparty_revision],
        )
      ).rows[0]
    )
      throw conflict('STALE_DOCUMENT_SNAPSHOT')
    // An expired lease or transport timeout is not a reconciled provider failure.
    // Only a validated, completed upstream failure envelope is manually retryable.
    const outcome = (
      await tx.query(
        `SELECT 1 FROM aic.mvp_document_results
        WHERE organization_id=$1 AND case_id=$2 AND job_id=$3 AND fence=$4
          AND worker_id=$5 AND document_id=$6 AND document_version=$7 AND sha256=$8
          AND case_revision=$9 AND ai_mode=$10 AND outcome='failed' AND retryable
          AND error_code=$11 AND error_code IN ('PROVIDER_UNAVAILABLE','INTERNAL_ERROR')`,
        [
          ...scope,
          job.fence,
          job.worker_id,
          job.document_id,
          job.document_version,
          job.sha256,
          job.snapshot_case_revision,
          job.ai_mode,
          job.error_code,
        ],
      )
    ).rows[0]
    if (!outcome) throw conflict('JOB_OUTCOME_RECONCILIATION_REQUIRED')
    const source = (
      await tx.query(
        `SELECT 1 FROM aic.mvp_documents d
        JOIN aic.mvp_document_lineages l ON l.organization_id=d.organization_id
          AND l.case_id=d.case_id AND l.id=d.lineage AND l.current_document_id=d.id
        JOIN aic.mvp_document_objects o ON o.organization_id=d.organization_id
          AND o.case_id=d.case_id AND o.document_id=d.id AND o.sha256=d.hash
          AND o.byte_size=d.byte_size
        WHERE d.organization_id=$1 AND d.case_id=$2 AND d.id=$3
          AND d.version=$4 AND d.hash=$5 AND d.ai_mode=$6
          AND NOT EXISTS (SELECT 1 FROM aic.mvp_document_results r
            WHERE r.organization_id=d.organization_id AND r.case_id=d.case_id
              AND r.document_id=d.id AND r.outcome='published')`,
        [organizationId, caseId, job.document_id, job.document_version, job.sha256, job.ai_mode],
      )
    ).rows[0]
    if (!source) throw conflict('STALE_DOCUMENT_SNAPSHOT')
    // Real DB time is checked after all waits, in the transition itself. Attempts,
    // fence and source remain unchanged; the next actual claim increments them.
    const changed = (
      await tx.query(
        `UPDATE aic.mvp_document_jobs SET state='queued',error_code=NULL,
          updated_at=clock_timestamp()
        WHERE organization_id=$1 AND case_id=$2 AND id=$3 AND state='failed'
          AND lease_expires_at IS NULL AND retryable AND attempts<$4
          AND created_at + ($5::bigint*interval '1 millisecond') >=
            clock_timestamp() + ($6::bigint*interval '1 millisecond')
        RETURNING *`,
        [
          ...scope,
          DOCUMENT_RETRY_MAX_ATTEMPTS,
          DOCUMENT_RETRY_DEADLINE_MS,
          DOCUMENT_RETRY_MIN_REMAINING_MS,
        ],
      )
    ).rows[0]
    if (!changed) throw conflict('JOB_RETRY_DEADLINE_EXCEEDED')
    return this.projectJob(changed)
  }

  private verify(document: any, bytes: Buffer) {
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length !== document.byte_size ||
      digest(bytes) !== document.hash
    )
      throw new FoundationError(500, 'DOCUMENT_INTEGRITY_FAILURE')
  }

  private async audit(
    tx: SqlClient,
    org: string,
    caseId: string,
    documentId: string,
    actorType: 'specialist' | 'operator',
    actorId: string | null,
    action: string,
    before: number,
    after: number,
    metadata: Record<string, unknown>,
  ) {
    await tx.query(
      `INSERT INTO aic.audit_events
      (id,organization_id,case_id,actor_type,actor_id,action,subject_id,revision_before,revision_after,metadata_json)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        randomUUID(),
        org,
        caseId,
        actorType,
        actorId,
        action,
        documentId,
        before,
        after,
        canonicalJson(metadata),
      ],
    )
  }

  private worker(workerId: string) {
    if (typeof workerId !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(workerId))
      throw new FoundationError(422, 'INVALID_INPUT')
  }

  async claim(
    workerId: string,
    leaseMs: number,
    maxAttempts: number,
  ): Promise<DocumentAttempt | null> {
    this.worker(workerId)
    positive(leaseMs)
    positive(maxAttempts)
    return this.db.transaction(async (tx) => {
      // Decide eligibility before selecting a case. A saturated/busy dossier
      // pool must not hide ready legacy jobs in a different case.
      const gate = (await tx.query("SELECT pg_try_advisory_xact_lock(hashtextextended('aic.dossier-extraction-capacity',0)) AS locked")).rows[0]
      const active = gate.locked ? (await tx.query(`SELECT count(*)::int AS n FROM aic.mvp_document_jobs j
        JOIN aic.mvp_documents d ON d.organization_id=j.organization_id AND d.case_id=j.case_id AND d.id=j.document_id
        JOIN aic.mvp_document_lineages l ON l.organization_id=d.organization_id AND l.case_id=d.case_id AND l.id=d.lineage
        WHERE l.capacity_class='dossier' AND j.state='running' AND j.lease_expires_at>clock_timestamp()`)).rows[0].n : 2
      const dossierAvailable = gate.locked && active < 2
      // Consistent case -> job lock order with acceptance/publication. Other workers skip
      // busy cases as well as jobs; no user/session identity is used for worker authority.
      const current = (
        await tx.query(`SELECT c.organization_id,c.id,c.revision,c.counterparty_id FROM aic.cases c
        WHERE c.dossier_intake_pending=0 AND NOT EXISTS (
          SELECT 1 FROM aic.mvp_document_jobs running JOIN aic.mvp_documents rd
            ON rd.organization_id=running.organization_id AND rd.case_id=running.case_id AND rd.id=running.document_id
          JOIN aic.mvp_document_lineages rl ON rl.organization_id=rd.organization_id AND rl.case_id=rd.case_id AND rl.id=rd.lineage
          WHERE running.organization_id=c.organization_id AND running.case_id=c.id AND rl.capacity_class='dossier'
            AND running.state='running' AND running.lease_expires_at>clock_timestamp())
        AND EXISTS (SELECT 1 FROM aic.mvp_document_jobs j
          JOIN aic.mvp_documents d ON d.organization_id=j.organization_id AND d.case_id=j.case_id AND d.id=j.document_id
          JOIN aic.mvp_document_lineages l ON l.organization_id=d.organization_id AND l.case_id=d.case_id AND l.id=d.lineage
          WHERE j.organization_id=c.organization_id AND j.case_id=c.id AND ($1::boolean OR l.capacity_class='legacy')
          AND ((j.state='queued' AND (j.attempts=0 OR j.retryable)) OR
            (j.state='running' AND j.lease_expires_at<=clock_timestamp())))
        ORDER BY c.updated_at,c.id LIMIT 1 FOR UPDATE OF c SKIP LOCKED`, [dossierAvailable])
      ).rows[0]
      if (!current) return null
      const job = (
        await tx.query(
          `SELECT j.* FROM aic.mvp_document_jobs j
        JOIN aic.mvp_documents d ON d.organization_id=j.organization_id AND d.case_id=j.case_id AND d.id=j.document_id
        JOIN aic.mvp_document_lineages l ON l.organization_id=d.organization_id AND l.case_id=d.case_id AND l.id=d.lineage
        WHERE j.organization_id=$1 AND j.case_id=$2 AND ($3::boolean OR l.capacity_class='legacy') AND
          ((j.state='queued' AND (j.attempts=0 OR j.retryable)) OR (j.state='running' AND j.lease_expires_at<=clock_timestamp()))
        ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
          [current.organization_id, current.id, dossierAvailable],
        )
      ).rows[0]
      if (!job) return null
      if (job.state === 'running')
        await this.outcome(tx, job, 'lease_expired', null, job.ai_mode, 'LEASE_EXPIRED', true)
      if (job.attempts >= maxAttempts || Number(job.fence) >= Number.MAX_SAFE_INTEGER) {
        await tx.query(
          `UPDATE aic.mvp_document_jobs SET state='failed',error_code='ATTEMPTS_EXHAUSTED',
          retryable=false,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE organization_id=$1 AND case_id=$2 AND id=$3`,
          [job.organization_id, job.case_id, job.id],
        )
        return null
      }
      const document = (
        await tx.query(
          `${documentSelect} WHERE d.organization_id=$1 AND d.case_id=$2 AND d.id=$3`,
          [job.organization_id, job.case_id, job.document_id],
        )
      ).rows[0]
      const counterparty = (
        await tx.query('SELECT * FROM aic.lock_case_source_counterparty($1,$2)', [
          current.organization_id,
          current.id,
        ])
      ).rows[0]
      if (
        !document?.active ||
        Number(counterparty?.revision) !== Number(job.snapshot_counterparty_revision)
      ) {
        await tx.query(
          `UPDATE aic.mvp_document_jobs SET state='stale',error_code='DOCUMENT_SUPERSEDED',
          retryable=false,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE organization_id=$1 AND case_id=$2 AND id=$3`,
          [job.organization_id, job.case_id, job.id],
        )
        return null
      }
      const object = (
        await tx.query(
          `SELECT bytes FROM aic.mvp_document_objects
        WHERE organization_id=$1 AND case_id=$2 AND document_id=$3`,
          [job.organization_id, job.case_id, job.document_id],
        )
      ).rows[0]
      this.verify(document, object?.bytes)
      const claimed = (
        await tx.query(
          `UPDATE aic.mvp_document_jobs SET state='running',attempts=attempts+1,
        fence=fence+1,worker_id=$4,snapshot_case_revision=$5,
        lease_expires_at=clock_timestamp()+($6::bigint*interval '1 millisecond'),
        error_code=NULL,retryable=false,updated_at=clock_timestamp()
        WHERE organization_id=$1 AND case_id=$2 AND id=$3 RETURNING *`,
          [job.organization_id, job.case_id, job.id, workerId, current.revision, leaseMs],
        )
      ).rows[0]
      return {
        jobId: job.id,
        organizationId: job.organization_id,
        caseId: job.case_id,
        documentId: job.document_id,
        fence: Number(claimed.fence),
        workerId,
        caseRevision: Number(current.revision),
        documentVersion: document.version,
        sha256: document.hash,
        type: document.type,
        bytes: object.bytes,
        pages: document.pages,
      }
    })
  }

  private validAttempt(attempt: DocumentAttempt): boolean {
    return (
      !!attempt &&
      [attempt.jobId, attempt.organizationId, attempt.caseId, attempt.documentId].every(
        validUuid,
      ) &&
      Number.isSafeInteger(attempt.fence) &&
      attempt.fence > 0 &&
      Number.isSafeInteger(attempt.caseRevision) &&
      attempt.caseRevision > 0 &&
      Number.isInteger(attempt.documentVersion) &&
      attempt.documentVersion > 0 &&
      typeof attempt.sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(attempt.sha256) &&
      typeof attempt.workerId === 'string' &&
      /^[\x21-\x7e]{1,200}$/.test(attempt.workerId)
    )
  }

  private attemptScope(attempt: DocumentAttempt): unknown[] {
    return [
      attempt.organizationId,
      attempt.caseId,
      attempt.jobId,
      attempt.workerId,
      attempt.fence,
      attempt.documentId,
      attempt.documentVersion,
      attempt.sha256,
      attempt.caseRevision,
    ]
  }

  async heartbeat(attempt: DocumentAttempt, leaseMs: number): Promise<boolean> {
    positive(leaseMs)
    if (!this.validAttempt(attempt)) return false
    return this.db.transaction(async (tx) => {
      if (!(await this.lockAttempt(tx, attempt))) return false
      const changed = await tx.query(
        `UPDATE aic.mvp_document_jobs
        SET lease_expires_at=clock_timestamp()+($10::bigint*interval '1 millisecond'),updated_at=clock_timestamp()
        WHERE organization_id=$1 AND case_id=$2 AND id=$3 AND worker_id=$4 AND fence=$5
          AND document_id=$6 AND document_version=$7 AND sha256=$8 AND snapshot_case_revision=$9
          AND state='running' AND lease_expires_at>clock_timestamp()`,
        [...this.attemptScope(attempt), leaseMs],
      )
      return changed.rowCount === 1
    })
  }

  private async lockAttempt(tx: SqlClient, attempt: DocumentAttempt) {
    const current = (
      await tx.query(
        `SELECT revision,counterparty_id FROM aic.cases
      WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [attempt.organizationId, attempt.caseId],
      )
    ).rows[0]
    if (!current) return null
    const job = (
      await tx.query(
        `SELECT * FROM aic.mvp_document_jobs
      WHERE organization_id=$1 AND case_id=$2 AND id=$3 AND worker_id=$4 AND fence=$5
        AND document_id=$6 AND document_version=$7 AND sha256=$8 AND snapshot_case_revision=$9
        AND state='running' AND lease_expires_at>clock_timestamp() FOR UPDATE`,
        this.attemptScope(attempt),
      )
    ).rows[0]
    if (!job) return null
    // A row-lock wait can cross expiry even when its earlier predicate was true.
    if (
      !(
        await tx.query(
          `SELECT 1 FROM aic.mvp_document_jobs WHERE organization_id=$1 AND case_id=$2
      AND id=$3 AND lease_expires_at>clock_timestamp()`,
          [attempt.organizationId, attempt.caseId, attempt.jobId],
        )
      ).rows[0]
    )
      return null
    const cp = (
      await tx.query('SELECT * FROM aic.lock_case_source_counterparty($1,$2)', [
        attempt.organizationId,
        attempt.caseId,
      ])
    ).rows[0]
    return {
      job,
      revision: Number(current.revision),
      sourceCurrent: Number(cp?.revision) === Number(job.snapshot_counterparty_revision),
    }
  }

  private async outcome(
    tx: SqlClient,
    job: any,
    outcome: string,
    raw: string | null,
    mode: 'live' | 'mock',
    code: string | null,
    retryable: boolean,
  ) {
    await tx.query(
      `INSERT INTO aic.mvp_document_results
      (id,organization_id,case_id,job_id,document_id,document_version,sha256,fence,worker_id,case_revision,
        outcome,raw_extraction,ai_mode,error_code,retryable)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)`,
      [
        randomUUID(),
        job.organization_id,
        job.case_id,
        job.id,
        job.document_id,
        job.document_version,
        job.sha256,
        job.fence,
        job.worker_id,
        job.snapshot_case_revision,
        outcome,
        raw,
        mode,
        code,
        retryable,
      ],
    )
  }

  async publish(
    attempt: DocumentAttempt,
    extraction: unknown,
    mode: 'live' | 'mock',
  ): Promise<boolean> {
    if (!this.validAttempt(attempt)) return false
    if (!['live', 'mock'].includes(mode)) throw new FoundationError(422, 'INVALID_INPUT')
    const raw = canonicalJson(extraction)
    // Persistence checks only the source binding. The transport owns extraction schema
    // validation; preserving this raw JSON does not assert that it passed that validation.
    const payload = JSON.parse(raw)
    const bound =
      payload !== null &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      payload.document_id === attempt.documentId &&
      payload.case_id === attempt.caseId &&
      payload.sha256 === attempt.sha256
    return this.db.transaction(async (tx) => {
      const locked = await this.lockAttempt(tx, attempt)
      if (!locked) return false
      const { job, revision } = locked
      const document = (
        await tx.query(
          `${documentSelect} WHERE d.organization_id=$1 AND d.case_id=$2 AND d.id=$3`,
          [attempt.organizationId, attempt.caseId, attempt.documentId],
        )
      ).rows[0]
      const valid =
        bound &&
        locked.sourceCurrent &&
        revision === attempt.caseRevision &&
        revision < Number.MAX_SAFE_INTEGER &&
        document?.active &&
        document.version === attempt.documentVersion &&
        document.hash === attempt.sha256 &&
        document.ai_mode === mode
      const code = valid
        ? null
        : !bound
          ? 'AI_CONTENT_MISMATCH'
          : document?.ai_mode !== mode
            ? 'AI_MODE_MISMATCH'
            : 'STALE_DOCUMENT_SNAPSHOT'
      // Transition first with a fresh real-time lease predicate; rollback preserves the
      // entire attempt if any immutable result/audit write subsequently fails.
      const changed = await tx.query(
        `UPDATE aic.mvp_document_jobs SET state=$10,error_code=$11,
        retryable=false,lease_expires_at=NULL,updated_at=clock_timestamp()
        WHERE organization_id=$1 AND case_id=$2 AND id=$3 AND worker_id=$4 AND fence=$5
          AND document_id=$6 AND document_version=$7 AND sha256=$8 AND snapshot_case_revision=$9
          AND state='running' AND lease_expires_at>clock_timestamp()`,
        [...this.attemptScope(attempt), valid ? 'succeeded' : 'stale', code],
      )
      if (changed.rowCount !== 1) return false
      await this.outcome(tx, job, valid ? 'published' : 'stale', raw, mode, code, false)
      if (!valid) return false
      await tx.query(
        `UPDATE aic.cases SET revision=$3,updated_at=clock_timestamp()
        WHERE organization_id=$1 AND id=$2 AND revision=$4`,
        [attempt.organizationId, attempt.caseId, revision + 1, revision],
      )
      await this.audit(
        tx,
        attempt.organizationId,
        attempt.caseId,
        attempt.documentId,
        'operator',
        null,
        'document.extraction_published',
        revision,
        revision + 1,
        {
          worker_authority: { worker_id: attempt.workerId, fence: attempt.fence },
          job_id: attempt.jobId,
          document_id: attempt.documentId,
          version: attempt.documentVersion,
          sha256: attempt.sha256,
          ai_mode: mode,
          subject_verification: 'unverified',
        },
      )
      return true
    })
  }

  async fail(
    attempt: DocumentAttempt,
    code: string,
    retryable: boolean,
    maxAttempts: number,
    automaticRetry = true,
  ): Promise<boolean> {
    positive(maxAttempts)
    if (!this.validAttempt(attempt)) return false
    if (
      typeof code !== 'string' ||
      !/^[A-Z0-9_]{1,100}$/.test(code) ||
      typeof retryable !== 'boolean' ||
      typeof automaticRetry !== 'boolean'
    )
      throw new FoundationError(422, 'INVALID_INPUT')
    return this.db.transaction(async (tx) => {
      const locked = await this.lockAttempt(tx, attempt)
      if (!locked) return false
      const again = retryable && locked.job.attempts < maxAttempts
      const changed = await tx.query(
        `UPDATE aic.mvp_document_jobs SET state=$10,error_code=$11,
        retryable=$12,lease_expires_at=NULL,updated_at=clock_timestamp()
        WHERE organization_id=$1 AND case_id=$2 AND id=$3 AND worker_id=$4 AND fence=$5
          AND document_id=$6 AND document_version=$7 AND sha256=$8 AND snapshot_case_revision=$9
          AND state='running' AND lease_expires_at>clock_timestamp()`,
        [...this.attemptScope(attempt), again && automaticRetry ? 'queued' : 'failed', code, again],
      )
      if (changed.rowCount !== 1) return false
      await this.outcome(tx, locked.job, 'failed', null, locked.job.ai_mode, code, retryable)
      return true
    })
  }
}
