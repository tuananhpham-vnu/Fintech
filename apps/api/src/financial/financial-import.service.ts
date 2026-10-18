import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { FOUNDATION_DB, FOUNDATION_CONFIG } from '../foundation/ports'
import type { AuthSession, FoundationDatabase, SqlClient } from '../foundation/ports'
import type { AppConfig } from '../config/configuration'
import { CoreRepository, requireUuid } from '../foundation/core.repository'
import { CaseMutations } from '../foundation/case-mutations'
import { FoundationError, notFound } from '../foundation/errors'
import { validateContract } from '../foundation/validation'
import { requestHash } from '../foundation/canonical'
import { IMPORT_VERSION, importSource, importReceipt, countryCode, sha } from './financial-import-source'

const safeCodes = new Set(['PDF_TOO_LARGE', 'PDF_TOO_MANY_PAGES', 'PDF_INVALID', 'PDF_ENCRYPTED',
  'INVALID_MODEL_OUTPUT', 'PROVIDER_UNAVAILABLE', 'SHA256_MISMATCH', 'FINANCIAL_PAGE_SELECTION_REQUIRED',
  'FINANCIAL_SCOPE_MISMATCH', 'FINANCIAL_TEXT_LIMIT', 'FINANCIAL_OCR_PAGE_LIMIT', 'FINANCIAL_IMPORT_BUSY'])

@Injectable()
export class FinancialImportService {
  private active = 0
  constructor(@Inject(FOUNDATION_DB) private db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) private config: AppConfig,
    private core: CoreRepository, private mutations: CaseMutations) {}

  private async access(tx: SqlClient, session: AuthSession, caseId: string) {
    requireUuid(caseId)
    const check = async () => {
      if (!(await tx.query('SELECT * FROM aic.lock_active_session($1,$2,$3,$4)',
        [session.id, session.user.id, session.user.organization_id, this.config.sessionIdleMs])).rows[0])
        throw new FoundationError(401, 'SESSION_EXPIRED')
    }
    await check()
    const current = await this.core.assertCaseAccess(tx, session.user, caseId, true)
    await check()
    return current
  }
  private async replay(session:AuthSession,caseId:string,operation:string,key:string,expected:number,payload:unknown) {
    if(!/^[\x21-\x7e]{1,200}$/.test(key||'')||!Number.isSafeInteger(expected)||expected<1)
      throw new FoundationError(422,'INVALID_INPUT')
    return this.db.transaction(async tx=>{
      const current=await this.access(tx,session,caseId)
      const cached=(await tx.query(`SELECT *,expires_at>clock_timestamp() AS active FROM aic.idempotency_keys
        WHERE organization_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4`,
        [current.organization_id,session.user.id,operation+':case:'+caseId,key])).rows[0]
      if(cached){
        if(!cached.active||cached.request_hash!==requestHash({case_id:caseId,expected_revision:expected,payload}))
          throw new FoundationError(409,'IDEMPOTENCY_CONFLICT')
        return cached
      }
      if(Number(current.revision)!==expected)throw new FoundationError(409,'REVISION_CONFLICT')
      return null
    })
  }
  async list(session: AuthSession, caseId: string) {
    return this.db.transaction(async tx => {
      const current = await this.access(tx, session, caseId)
      const sources = (await tx.query(`SELECT d.id,'document' AS kind,d.name,d.hash AS sha256,d.pages AS page_count
        FROM aic.mvp_documents d JOIN aic.mvp_document_lineages l ON l.organization_id=d.organization_id
        AND l.case_id=d.case_id AND l.id=d.lineage AND l.current_document_id=d.id
        WHERE d.organization_id=$1 AND d.case_id=$2
        UNION ALL SELECT m.id,'dossier_member',m.entry_path,m.sha256,m.page_count FROM aic.mvp_dossier_members m
        JOIN aic.mvp_dossier_member_objects o ON o.organization_id=m.organization_id AND o.case_id=m.case_id AND o.member_id=m.id
        WHERE m.organization_id=$1 AND m.case_id=$2 AND m.document_id IS NULL AND m.detected_mime='application/pdf'
        UNION ALL SELECT id,'financial_file',name,sha256,page_count FROM aic.financial_import_sources
        WHERE organization_id=$1 AND case_id=$2`, [current.organization_id, current.id])).rows
      return { contract_version: IMPORT_VERSION, revision: Number(current.revision), sources }
    })
  }
  private async ai(bytes: Buffer, hash: string, operation: string, pages: number[], scope?: any) {
    if (this.config.documentAiMode !== 'live') throw new FoundationError(503, 'FINANCIAL_IMPORT_LIVE_REQUIRED')
    if (this.active >= 2) throw new FoundationError(503, 'FINANCIAL_IMPORT_BUSY')
    this.active++
    try {
      const base = new URL(this.config.aiServiceUrl)
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
        throw new FoundationError(503, 'AI_INVALID_CONFIG')
      const response = await fetch(base.href.replace(/\/$/, '') + '/internal/v2/financial-import', {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Internal-Key': this.config.internalApiKey },
        signal: AbortSignal.timeout(255_000), body: JSON.stringify({ contract_version: IMPORT_VERSION,
          operation, sha256: hash, pdf_base64: bytes.toString('base64'), pages, ...(scope ? { requested_scope: scope } : {}) }),
      })
      const reader = response.body?.getReader(), parts: Uint8Array[] = []
      let size = 0
      try {
        if (!reader) throw new FoundationError(502, 'AI_INVALID_RESPONSE')
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > 1_000_000) { await reader.cancel(); throw new FoundationError(502, 'AI_INVALID_RESPONSE') }
          parts.push(chunk.value)
        }
      } finally { reader?.releaseLock() }
      const data = JSON.parse(Buffer.concat(parts).toString('utf8'))
      if (!response.ok) throw new FoundationError(response.status >= 500 ? 503 : 422,
        safeCodes.has(data?.error?.code) ? data.error.code : 'AI_SERVICE_UNAVAILABLE')
      if (response.headers.get('X-AI-Mode') !== 'live' || data?.contract_version !== IMPORT_VERSION || data.sha256 !== hash ||
        !Number.isInteger(data.page_count) || data.page_count < 1 || data.page_count > 600)
        throw new FoundationError(502, 'AI_INVALID_RESPONSE')
      validateContract(operation === 'index' ? 'FinancialImportAiIndex' : 'FinancialImportAiCandidates', data, true)
      return data
    } catch (error) {
      if (error instanceof FoundationError) throw error
      throw new FoundationError(503, 'FINANCIAL_IMPORT_UNAVAILABLE')
    } finally { this.active-- }
  }
  async upload(session: AuthSession, caseId: string, key: string, file: Express.Multer.File, expected: number) {
    await this.db.transaction(tx => this.access(tx, session, caseId))
    if (!file?.buffer || file.buffer.length > 25_000_000 || file.buffer.subarray(0,5).toString() !== '%PDF-')
      throw new FoundationError(422, 'FINANCIAL_PDF_REQUIRED')
    const bytes = Buffer.from(file.buffer), hash = sha(bytes)
    const name = file.originalname.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0,255) || 'financial.pdf'
    const payload = { sha256: hash, name, expected_revision: expected }
    const cached=await this.replay(session,caseId,'financial.import_upload',key,expected,payload)
    if(cached)return {body:cached.response_body,status:cached.response_status,replayed:true}
    const index = await this.ai(bytes, hash, 'index', [])
    return this.mutations.execute(session, caseId, { operation: 'financial.import_upload', key,
      expectedRevision: expected, payload, work: async (tx,current,next) => {
        const count = (await tx.query(`SELECT count(*)::int AS n,COALESCE(sum(octet_length(bytes)),0)::bigint AS bytes
          FROM aic.financial_import_sources WHERE organization_id=$1 AND case_id=$2`, [current.organization_id,current.id])).rows[0]
        if (count.n >= 24 || Number(count.bytes) + bytes.length > 150_000_000)
          throw new FoundationError(409, 'FINANCIAL_SOURCE_CASE_LIMIT')
        const id = randomUUID()
        await tx.query(`INSERT INTO aic.financial_import_sources(id,organization_id,case_id,actor_id,name,sha256,bytes,page_count)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id,current.organization_id,current.id,session.user.id,name,hash,bytes,index.page_count])
        return { status:201, body: { ...index, source: { id,kind:'financial_file',name,sha256:hash,page_count:index.page_count },
          revision: next }, action:'financial.import_uploaded', subjectId:id, metadata:{sha256:hash,page_count:index.page_count} }
      } })
  }
  async run(session: AuthSession, caseId: string, key: string, body: unknown) {
    validateContract('FinancialImportRequest', body)
    const input = JSON.parse(JSON.stringify(body))
    if(input.operation==='extract'){
      const cached=await this.replay(session,caseId,'financial.import_extract',key,input.expected_revision,input)
      if(cached)return cached.response_body
    }
    const source = await this.db.transaction(async tx => {
      const current = await this.access(tx,session,caseId)
      if (Number(current.revision) !== input.expected_revision) throw new FoundationError(409,'REVISION_CONFLICT')
      return importSource(tx,current,input.source_kind,input.source_id,true)
    })
    const result = await this.ai(source.bytes,source.sha256,input.operation,input.pages,input.requested_scope)
    const { bytes, ...publicSource } = source
    if (input.operation === 'index') return { ...result, source: publicSource, revision:input.expected_revision }
    const receiptId = randomUUID()
    return (await this.mutations.execute(session,caseId,{operation:'financial.import_extract',key,
      expectedRevision:input.expected_revision,payload:input,work:async(tx,current,next)=>{
        const active = await importSource(tx,current,input.source_kind,input.source_id)
        if (active.sha256 !== result.sha256) throw new FoundationError(409,'STALE_FINANCIAL_SOURCE')
        const cp = (await tx.query('SELECT country,revision FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE',
          [current.organization_id,current.counterparty_id])).rows[0]
        if (countryCode(cp.country) !== result.scope.country) throw new FoundationError(422,'FINANCIAL_COUNTRY_MISMATCH')
        const receipt = {...result, receipt_id:receiptId,source:publicSource,counterparty_revision:Number(cp.revision)}
        return {status:201,body:{...receipt,revision:next},action:'financial.import_extracted',subjectId:receiptId,metadata:receipt}
      }})).body
  }
  async receipt(session: AuthSession, caseId: string, id: string) {
    requireUuid(id)
    return this.db.transaction(async tx => importReceipt(tx,await this.access(tx,session,caseId),id))
  }
  async file(session: AuthSession, id: string) {
    requireUuid(id)
    return this.db.transaction(async tx => {
      const found = (await tx.query('SELECT case_id FROM aic.financial_import_sources WHERE organization_id=$1 AND id=$2',
        [session.user.organization_id,id])).rows[0]
      if (!found) throw notFound()
      const current = await this.access(tx,session,found.case_id)
      return importSource(tx,current,'financial_file',id,true)
    })
  }
}
