import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { FOUNDATION_DB, FOUNDATION_CONFIG } from '../foundation/ports'
import type { AuthSession, FoundationDatabase, SqlClient } from '../foundation/ports'
import type { AppConfig } from '../config/configuration'
import { CoreRepository, requireUuid } from '../foundation/core.repository'
import { CaseMutations } from '../foundation/case-mutations'
import { FoundationError, notFound } from '../foundation/errors'
import { validateContract } from '../foundation/validation'
import { requestHash, canonicalJson } from '../foundation/canonical'
import { IMPORT_VERSION, importSource, importReceipt, countryCode, sha, currentFinancialFile } from './financial-import-source'
import { persistReasoning } from './financial-reasoning.repository'
import { reasoningSummary, solveReasoning } from './financial-reasoning'
import { calculationMetadata } from './financial-calculations'

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
  private async ai(bytes: Buffer, hash: string, operation: string, pages: number[], scope?: any, cacheScope = 'standalone') {
    if (this.config.documentAiMode !== 'live') throw new FoundationError(503, 'FINANCIAL_IMPORT_LIVE_REQUIRED')
    if (this.active >= 2) throw new FoundationError(503, 'FINANCIAL_IMPORT_BUSY')
    this.active++
    try {
      const base = new URL(this.config.aiServiceUrl)
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
        throw new FoundationError(503, 'AI_INVALID_CONFIG')
      const response = await fetch(base.href.replace(/\/$/, '') + '/internal/v2/financial-import', {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Internal-Key': this.config.internalApiKey, 'X-AIC-Cache-Scope':cacheScope },
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
    const result = await this.ai(source.bytes,source.sha256,input.operation,input.pages,input.requested_scope,sha(Buffer.from(session.user.organization_id)))
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
        await persistReasoning(tx,current,receipt)
        return {status:201,body:{...receipt,revision:next},action:'financial.import_extracted',subjectId:receiptId,metadata:receipt}
      }})).body
  }
  async receipt(session: AuthSession, caseId: string, id: string) {
    requireUuid(id)
    return this.db.transaction(async tx => importReceipt(tx,await this.access(tx,session,caseId),id))
  }
  async reasoning(session:AuthSession,caseId:string,id:string,offset:number) {
    requireUuid(id)
    if(!Number.isSafeInteger(offset)||offset<0)throw new FoundationError(422,'INVALID_INPUT')
    return this.db.transaction(async tx=>{
      const current=await this.access(tx,session,caseId)
      const run=(await tx.query('SELECT summary_json FROM aic.financial_reasoning_runs WHERE organization_id=$1 AND case_id=$2 AND id=$3',
        [current.organization_id,current.id,id])).rows[0]
      if(!run)throw notFound()
      const entries=(await tx.query(`SELECT payload_json->'variable' AS variable,o.item AS observation FROM aic.financial_reasoning_observations,
        LATERAL jsonb_array_elements(payload_json->'observations') WITH ORDINALITY AS o(item,position)
        WHERE organization_id=$1 AND case_id=$2 AND run_id=$3 ORDER BY ordinal,o.position OFFSET $4 LIMIT 50`,
        [current.organization_id,current.id,id,offset])).rows
      const grouped=new Map<string,any>()
      for(const entry of entries){const row=grouped.get(entry.variable.id)??{variable:entry.variable,observations:[]};row.observations.push(entry.observation);grouped.set(entry.variable.id,row)}
      const relationRows=(await tx.query(`SELECT payload_json FROM aic.financial_reasoning_relations WHERE organization_id=$1 AND case_id=$2 AND run_id=$3
        ORDER BY relation_id OFFSET $4 LIMIT 10`,[current.organization_id,current.id,id,Math.floor(offset/50)*10])).rows
      return validateContract('FinancialReasoningPage',{summary:run.summary_json,rows:[...grouped.values()],relations:relationRows.map(r=>r.payload_json),
        next_offset:entries.length===50||relationRows.length===10?offset+50:null},true)
    })
  }
  async reviewReasoning(session:AuthSession,caseId:string,id:string,key:string,body:any) {
    requireUuid(id)
    validateContract('FinancialReasoningReviewRequest',body)
    if(!body || Object.keys(body).some(k=>!['set_id','expected_revision','reason','excluded_observation_ids','excluded_relation_ids'].includes(k)) ||
      typeof body.reason!=='string' || !body.reason.trim() || body.reason.length>1000 ||
      !Number.isSafeInteger(body.expected_revision) || !Array.isArray(body.excluded_observation_ids) ||
      (!body.excluded_observation_ids.length&&!body.excluded_relation_ids?.length) || body.excluded_observation_ids.length>500 ||
      body.excluded_observation_ids.some((s:any)=>typeof s!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(s)) ||
      new Set(body.excluded_observation_ids).size!==body.excluded_observation_ids.length) throw new FoundationError(422,'INVALID_INPUT')
    requireUuid(body.set_id)
    return (await this.mutations.execute(session,caseId,{operation:'financial.reasoning_review',key,expectedRevision:body.expected_revision,payload:{receipt_id:id,...body},
      work:async(tx,current,next)=>{
        const before=await importReceipt(tx,current,id), source=await importSource(tx,current,before.source.kind,before.source.id)
        if(current.purpose!=='company_health'||!before.reasoning||source.sha256!==before.sha256||!(await currentFinancialFile(tx,current,source.id)))
          throw new FoundationError(409,'STALE_FINANCIAL_SOURCE')
        const prior=(await tx.query(`SELECT * FROM aic.mvp_financial_sets WHERE organization_id=$1 AND case_id=$2 AND id=$3 ORDER BY revision DESC LIMIT 1`,
          [current.organization_id,current.id,body.set_id])).rows[0]
        if(!prior||prior.metadata_json.reasoning?.receipt_id!==id) throw new FoundationError(409,'REVISION_CONFLICT')
        const excluded=before.reasoning.observations.filter((o:any)=>body.excluded_observation_ids.includes(o.id))
        if(excluded.length!==body.excluded_observation_ids.length)throw new FoundationError(422,'INVALID_INPUT')
        const excludedRelations=body.excluded_relation_ids??[]
        if(before.reasoning.relations.filter((r:any)=>excludedRelations.includes(r.id)).length!==excludedRelations.length)throw new FoundationError(422,'INVALID_INPUT')
        const graph=structuredClone(before.reasoning)
        graph.observations=graph.observations.filter((o:any)=>!body.excluded_observation_ids.includes(o.id))
        graph.relations=graph.relations.filter((r:any)=>!excludedRelations.includes(r.id))
        graph.diagnostics=[...graph.diagnostics,{code:'SOURCE_REVIEW_EXCLUSIONS',detail:body.reason.trim()}].slice(-100)
        const resolved=solveReasoning(graph,before.scope).resolutions
        const retained=before.facts.filter((f:any)=>resolved.some((r:any)=>r.key===f.key&&r.value===f.value) &&
          !excluded.some((o:any)=>o.page===f.page&&o.quote===f.quote&&o.raw_token===f.raw_token))
        const receipt={...before,receipt_id:randomUUID(),reasoning:graph,facts:retained,
          reasoning_review:{parent_receipt_id:id,excluded_observation_ids:body.excluded_observation_ids,excluded_relation_ids:excludedRelations,reason:body.reason.trim(),actor_id:session.user.id}}
        await tx.query(`INSERT INTO aic.audit_events(id,organization_id,case_id,actor_type,actor_id,action,subject_id,revision_before,revision_after,reason,metadata_json)
          VALUES($1,$2,$3,'specialist',$4,'financial.reasoning_reviewed',$5,$6,$7,$8,$9::jsonb)`,
          [randomUUID(),current.organization_id,current.id,session.user.id,receipt.receipt_id,current.revision,next,body.reason,canonicalJson(receipt)])
        await persistReasoning(tx,current,receipt)
        const revision=Number(prior.revision)+1
        await tx.query(`INSERT INTO aic.mvp_financial_sets(id,revision,organization_id,case_id,scope_json,metadata_json,bridges_json,case_revision,actor_id,reason)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,'{}'::jsonb,$7,$8,$9)`,[prior.id,revision,current.organization_id,current.id,
          canonicalJson(prior.scope_json),canonicalJson({...prior.metadata_json,calculations:calculationMetadata(receipt),reasoning:reasoningSummary(receipt)}),
          next,session.user.id,body.reason])
        const priorFacts=(await tx.query('SELECT * FROM aic.mvp_financial_facts WHERE set_id=$1 AND set_revision=$2',[prior.id,prior.revision])).rows
        for(const fact of priorFacts) {
          const payload=fact.payload_json
          if(payload.source.receipt_id===id && (payload.source.kind==='calculated'||!retained.some((f:any)=>f.key===fact.fact_key))) continue
          await tx.query(`INSERT INTO aic.mvp_financial_facts(id,revision,organization_id,case_id,set_id,set_revision,fact_key,payload_json)
            VALUES($1,$2,$3,$4,$5,$2,$6,$7::jsonb)`,[fact.id,revision,current.organization_id,current.id,prior.id,fact.fact_key,canonicalJson(payload)])
        }
        return {status:201,body:{revision:next,set_id:prior.id,receipt_id:receipt.receipt_id},action:'financial.reasoning_review_applied',subjectId:receipt.receipt_id,reason:body.reason}
      }})).body
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
