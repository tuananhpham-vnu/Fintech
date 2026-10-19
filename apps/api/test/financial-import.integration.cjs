const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),http=require('node:http')
const {Client}=require('pg')
const {migrate}=require('../dist/database/migrate')
const {DatabaseService}=require('../dist/database/database.service')
const {SessionService,hashPassword}=require('../dist/auth')
const {CoreRepository}=require('../dist/foundation/core.repository')
const {CaseMutations}=require('../dist/foundation/case-mutations')
const {MvpCounterpartyService}=require('../dist/foundation/mvp-counterparty.service')
const {MvpCaseService}=require('../dist/foundation/mvp-case.service')
const {FinancialRegistry}=require('../dist/financial/financial-registry.service')
const {FinancialImportService}=require('../dist/financial/financial-import.service')
const {financialDiagnostics}=require('../dist/financial/financial-diagnostics')
const {sha}=require('../dist/financial/financial-import-source')
const uuid=()=>crypto.randomUUID()
const reject=async(p,code)=>assert.rejects(p,e=>e.getResponse?.().code===code)

test('international import: PostgreSQL provenance, tenant ACL, human review, exact normalization and stale-source gates',async t=>{
  assert.equal(process.env.AIC_ALLOW_LOCAL_DB_TESTS,'true')
  const base=new URL(process.env.AIC_TEST_DATABASE_URL)
  assert.ok(['127.0.0.1','localhost'].includes(base.hostname))
  const name='aic_fin_import_'+crypto.randomBytes(6).toString('hex'),admin=new Client({connectionString:base.href})
  await admin.connect();let owner,db,server
  try{
    await admin.query('CREATE DATABASE '+name);base.pathname='/'+name;await migrate(base.href)
    owner=new Client({connectionString:base.href});await owner.connect()
    // Explicit isolated transport double. Real provider/PDF acceptance is a separate suite.
    let country='US',calls=0,mode='live'
    server=http.createServer(async(req,res)=>{
      let body='';for await(const part of req)body+=part
      const input=JSON.parse(body);assert.equal(sha(Buffer.from(input.pdf_base64,'base64')),input.sha256)
      assert.equal(req.headers['x-internal-key'],'synthetic-internal-key');calls++
      const scope={entity_name:'SYNTHETIC company',country,period_kind:'FY',start_date:'2025-01-01',end_date:'2025-12-31',basis:'consolidated',
        accounting_regime:country==='US'?'US_GAAP':'CN_ASBE',currency:country==='US'?'USD':'CNY',unit_multiplier:'1000000'}
      const common={contract_version:'AIC-FINANCIAL-IMPORT-1',sha256:input.sha256,page_count:30,suggested_pages:[20]}
      const values={total_assets:'100',total_liabilities:'60',total_equity:'40',current_assets:'50',current_liabilities:'25',
        operating_profit:'-5',net_revenue:'100',cash_from_operations:'-2',interest_expense:'1'}
      const output=input.operation==='index'?{...common,pages:Array.from({length:30},(_,n)=>({page:n+1,preview:'Synthetic page',needs_ocr:false,statement_title:n===19}))}:
        {...common,document_type:'financial_statement',scope,scope_evidence:[{page:20,quote:'SYNTHETIC company USD millions 2025'}],selected_pages:[20],
          facts:Object.entries(values).map(([key,value])=>({key,value,raw_token:value,label:key,page:20,quote:key+' '+value,period_end:'2025-12-31',basis:'consolidated',method:'native',verification:'unverified'})),
          missing_keys:['cash','unrestricted_short_term_equivalents','trade_receivables','interest_bearing_debt','depreciation_amortization'],rejected:[],warnings:['HUMAN_SOURCE_REVIEW_REQUIRED'],
          ocr_failures:[],provenance:{model_id:'SYNTHETIC-TRANSPORT-DOUBLE',prompt_version:'financial-import-v2',ocr_version:'none'}}
      res.writeHead(200,{'Content-Type':'application/json','X-AI-Mode':mode});res.end(JSON.stringify(output))
    })
    await new Promise(r=>server.listen(0,'127.0.0.1',r))
    const config={databaseUrl:base.href,frontendOrigin:'http://127.0.0.1',allowedOrigins:['http://127.0.0.1'],cookieName:'synthetic_import',
      secureCookies:false,isProduction:false,sessionTtlMs:3600000,sessionIdleMs:3600000,loginMaxAttempts:5,loginWindowMs:900000,loginBlockMs:900000,
      idempotencyTtlMs:86400000,documentAiMode:'live',internalApiKey:'synthetic-internal-key',aiServiceUrl:'http://127.0.0.1:'+server.address().port}
    db=new DatabaseService(config);await db.onModuleInit()
    const core=new CoreRepository(db),mutations=new CaseMutations(db,config,core),auth=new SessionService(db,config)
    const registry=new FinancialRegistry(db,config,core,mutations),imports=new FinancialImportService(db,config,core,mutations)
    const cp=new MvpCounterpartyService(db,config),cases=new MvpCaseService(db,config,core,mutations)
    const password='SYNTHETIC-'+uuid(),encoded=await hashPassword(password)
    async function tenant(){const org=uuid(),id=uuid(),username=uuid();await owner.query("INSERT INTO aic.organizations(id,name) VALUES($1,'SYNTHETIC import test')",[org]);
      await owner.query("INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role) VALUES($1,$2,$3,$4,'SYNTHETIC test','specialist')",[id,org,username,encoded]);
      const login=await auth.login(username,password,'127.0.0.1');return auth.resolve(login.token)}
    const alice=await tenant(),bob=await tenant()
    const company=(await cp.create(alice,uuid(),{name:'SYNTHETIC company',country:'US',tax_id:null,industry_code:'RETAIL',
      source:{kind:'declaration',reported_by:'organization',reported_reference:'SYNTHETIC test',statement:'SYNTHETIC imported company'},reason:'SYNTHETIC test'})).body
    const workspace=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:company.id,reason:'SYNTHETIC international import'})).body
    let revision=workspace.revision
    const file={originalname:'SYNTHETIC-long.pdf',buffer:Buffer.from('%PDF-SYNTHETIC isolated transport fixture')},key=uuid()
    const uploaded=(await imports.upload(alice,workspace.id,key,file,revision)).body;revision=uploaded.revision
    assert.equal(uploaded.source.kind,'financial_file');assert.equal(uploaded.page_count,30)
    const count=calls;assert.deepEqual((await imports.upload(alice,workspace.id,key,file,1)).body,uploaded);assert.equal(calls,count)
    await reject(imports.file(bob,uploaded.source.id),'NOT_FOUND')
    const input={expected_revision:revision,source_kind:'financial_file',source_id:uploaded.source.id,operation:'extract',pages:[20],
      requested_scope:{country:'US',basis:'consolidated',end_date:'2025-12-31'}}
    const extractKey=uuid(),receipt=await imports.run(alice,workspace.id,extractKey,input);revision=receipt.revision
    const after=calls;assert.deepEqual(await imports.run(alice,workspace.id,extractKey,input),receipt);assert.equal(calls,after)
    await reject(imports.receipt(bob,workspace.id,receipt.receipt_id),'NOT_FOUND')
    const body={expected_revision:revision,reason:'SYNTHETIC source reviewed',period:{kind:'FY',start_date:'2025-01-01',end_date:'2025-12-31'},
      basis:'consolidated',accounting_regime:'US_GAAP',currency:'USD',unit_multiplier:'1000000',industry_scope:'RETAIL',observation_kind:'actual',audit_status:'unknown',statement_version:'synthetic-v1',
      facts:receipt.facts.map(f=>({key:f.key,raw_value:f.value,raw_label:f.label,missing_reason:null,source:{kind:'financial_import',receipt_id:receipt.receipt_id,fact_key:f.key,
        source_kind:'financial_file',source_id:uploaded.source.id,source_hash:receipt.sha256,page:f.page,quote:f.quote}}))}
    const tampered=structuredClone(body);tampered.facts[0].raw_value='101'
    await reject(registry.save(alice,workspace.id,undefined,uuid(),tampered),'FINANCIAL_IMPORT_VALUE_OR_SCOPE_CHANGED')
    const saved=(await registry.save(alice,workspace.id,undefined,uuid(),body)).body;revision=saved.revision
    assert.equal(saved.set.facts.find(f=>f.key==='total_assets').normalized_decimal,'100000000')
    assert.ok(saved.set.facts.every(f=>f.verification.status==='unverified'))
    const verify={expected_revision:revision,set_revision:1,status:'verified',reason:'SYNTHETIC verify exact source',fact_ids:saved.set.facts.map(f=>f.id),
      bridge_assertions:{quick_assets_non_overlapping:false,quick_assets_eligible:false,da_addback_to_operating_profit:false}}
    await reject(registry.verify(alice,saved.set.id,uuid(),verify),'FINANCIAL_SOURCE_REVIEW_REQUIRED')
    body.expected_revision=revision;body.import_review={receipt_id:receipt.receipt_id,confirmed:true}
    const reviewed=(await registry.save(alice,workspace.id,saved.set.id,uuid(),body)).body;revision=reviewed.revision
    verify.expected_revision=revision;verify.set_revision=2;verify.fact_ids=reviewed.set.facts.map(f=>f.id)
    const verified=(await registry.verify(alice,reviewed.set.id,uuid(),verify)).body;revision=verified.revision
    assert.ok(verified.set.facts.every(f=>f.verification.status==='verified'))
    const diagnostics=financialDiagnostics(verified.set)
    assert.equal(diagnostics.metrics.find(m=>m.id==='current_ratio').display,'2.000000')
    assert.ok(diagnostics.observations.some(o=>o.code==='NEGATIVE_OPERATING_PROFIT'))
    const read=await registry.get(alice,workspace.id,reviewed.set.id)
    assert.ok(read.blockers.includes('COUNTRY_METHOD_NOT_VALIDATED'));assert.equal(read.score,null);assert.equal(read.pd,null)
    // A real counterparty revision invalidates downstream financial verification.
    await cp.update(alice,company.id,uuid(),{expected_revision:1,name:'SYNTHETIC changed entity',country:'US',tax_id:null,industry_code:'RETAIL',
      source:{kind:'declaration',reported_by:'organization',reported_reference:'SYNTHETIC update',statement:'SYNTHETIC changed subject'},reason:'SYNTHETIC source change'})
    const stale=await registry.get(alice,workspace.id,reviewed.set.id)
    assert.ok(stale.sets[0].facts.every(f=>f.verification.status==='stale'))
    for(const sql of ['UPDATE aic.financial_import_sources SET name=name WHERE false','DELETE FROM aic.financial_import_sources WHERE false','TRUNCATE aic.financial_import_sources'])
      await assert.rejects(owner.query(sql),e=>['55000','0A000'].includes(e.code))
    await t.test('live-mode mismatch is rejected before accepting an AI receipt',async()=>{
      mode='mock';await reject(imports.run(alice,workspace.id,uuid(),{...input,expected_revision:revision,operation:'index'}),'AI_INVALID_RESPONSE')
    })
  }finally{
    if(server)await new Promise(r=>server.close(r));if(db)await db.onModuleDestroy();if(owner)await owner.end()
    await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)');await admin.end()
  }
})
