const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const { readFileSync, readdirSync } = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')
const { migrate } = require('../dist/database/migrate')
const { canonicalMigrationSource } = require('../dist/database/migration-source')
const { DatabaseService } = require('../dist/database/database.service')
const { SessionService, hashPassword } = require('../dist/auth')
const { CoreRepository } = require('../dist/foundation/core.repository')
const { CaseMutations } = require('../dist/foundation/case-mutations')
const { MvpCaseService } = require('../dist/foundation/mvp-case.service')

test('0019 transaction compatibility and fail-closed company availability, then additive 0020 preservation', async () => {
  assert.equal(process.env.AIC_ALLOW_LOCAL_DB_TESTS, 'true')
  const source = new URL(process.env.AIC_TEST_DATABASE_URL)
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(source.hostname))
  const name='aic_company_upgrade_'+randomBytes(8).toString('hex')
  const admin=new Client({connectionString:source.href}); await admin.connect()
  let owner,service,created=false
  try {
    await admin.query(`CREATE DATABASE ${name}`);created=true
    const url=new URL(source);url.pathname='/'+name
    owner=new Client({connectionString:url.href});await owner.connect()
    await owner.query('CREATE SCHEMA aic; CREATE TABLE aic.schema_migrations(name text PRIMARY KEY,checksum char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())')
    const directory=path.resolve(__dirname,'../migrations')
    for(const file of readdirSync(directory).filter(n=>/^\d{4}_.*\.sql$/.test(n)&&n<'0020_').sort()) {
      const value=canonicalMigrationSource(readFileSync(path.join(directory,file),'utf8'))
      await owner.query('BEGIN');await owner.query(value.sql)
      await owner.query('INSERT INTO aic.schema_migrations(name,checksum) VALUES($1,$2)',[file,value.checksum]);await owner.query('COMMIT')
    }
    const org=randomUUID(),user=randomUUID(),cp=randomUUID(),caseId=randomUUID(),password=randomUUID(),username=randomUUID()
    await owner.query('INSERT INTO aic.organizations(id,name) VALUES($1,$2)',[org,'SYNTHETIC UPGRADE'])
    await owner.query("INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role) VALUES($1,$2,$3,$4,'SYNTHETIC specialist','specialist')",[user,org,username,await hashPassword(password)])
    await owner.query("INSERT INTO aic.counterparties(id,organization_id,name,country) VALUES($1,$2,'SYNTHETIC company','VN')",[cp,org])
    const exposure={amount_vnd:'123',term_days:15,organization_role:'seller',counterparty_role:'buyer',contract_ref:'SYNTHETIC legacy',conditions:[],source_origin:'staff_entered'}
    await owner.query("INSERT INTO aic.cases(id,organization_id,counterparty_id,exposure_kind,lifecycle_stage,exposure_json,policy_version,created_by) VALUES($1,$2,$3,'RECEIVABLE','active',$4::jsonb,'SYNTHETIC-LEGACY',$5)",[caseId,org,cp,JSON.stringify(exposure),user])
    const before=(await owner.query('SELECT row_to_json(c) AS value FROM aic.cases c WHERE id=$1',[caseId])).rows[0].value
    const config={databaseUrl:url.href,isProduction:false,sessionTtlMs:3600000,sessionIdleMs:3600000,loginMaxAttempts:5,loginWindowMs:900000,loginBlockMs:900000,idempotencyTtlMs:86400000}
    service=new DatabaseService(config);await service.onModuleInit()
    const sessions=new SessionService(service,config),login=await sessions.login(username,password,'127.0.0.1'),session=await sessions.resolve(login.token)
    const core=new CoreRepository(service),cases=new MvpCaseService(service,config,core,new CaseMutations(service,config,core))
    assert.equal((await cases.companyCapabilities(session)).available,false)
    await assert.rejects(cases.createCompany(session,randomUUID(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:cp,reason:'SYNTHETIC'}),e=>e.getResponse?.().code==='COMPANY_HEALTH_SCHEMA_REQUIRED')
    assert.deepEqual((await core.case(session.user,caseId)).exposure,exposure)
    assert.deepEqual((await migrate(url.href)).applied,['0020_company_health_workspaces.sql'])
    const after=(await owner.query('SELECT row_to_json(c) AS value FROM aic.cases c WHERE id=$1',[caseId])).rows[0].value
    const {purpose,...legacy}=after
    assert.equal(purpose,'transaction');assert.deepEqual(legacy,before)
    await service.onModuleInit()
    assert.equal((await cases.companyCapabilities(session)).available,true)
    for(const update of ["exposure_json=NULL","policy_version=NULL","exposure_kind=NULL","lifecycle_stage=NULL","exposure_json='{}'::jsonb"])
      await assert.rejects(owner.query(`UPDATE aic.cases SET ${update} WHERE id=$1`,[caseId]),e=>e.code==='23514')
    assert.deepEqual((await migrate(url.href)).applied,[])
    const corrupt=new DatabaseService(config)
    await owner.query("UPDATE aic.schema_migrations SET checksum=repeat('0',64) WHERE name='0020_company_health_workspaces.sql'")
    await assert.rejects(corrupt.onModuleInit(),/Company workspace migration checksum/)
  } finally {
    if(service)await service.onModuleDestroy()
    if(owner)await owner.end()
    if(created)await admin.query(`DROP DATABASE ${name}`)
    await admin.end()
  }
})
