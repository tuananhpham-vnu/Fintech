const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomBytes, randomUUID, createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')

const project = path.resolve(__dirname, '../../../..')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const code = (error) => error?.getResponse?.()?.code ?? error?.code
const rejects = (promise, expected) => assert.rejects(promise, (error) => code(error) === expected)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function selectedSource(env) {
  if (env.AIC_ALLOW_LOCAL_DB_TESTS !== 'true') throw Error('Disposable database opt-in required')
  let url
  try { url = new URL(env.AIC_TEST_DATABASE_URL) } catch { throw Error('Launcher database URL required') }
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '15432' ||
      url.pathname !== '/postgres' || url.username !== 'aic_test_owner' ||
      !/^[0-9a-f]{64}$/.test(url.password) || url.search || url.hash)
    throw Error('Database must be supplied by scripts/test-local-postgres.cjs')
  return url
}

// Fail closed before CREATE DATABASE/ROLE. Loopback alone does not identify a test cluster.
function verifyClusterFiles(row, source, files = fs) {
  const data = path.resolve(row.data_directory)
  const root = path.dirname(data)
  assert.equal(path.basename(data), 'data', 'Unexpected cluster data directory')
  assert.match(path.basename(root), /^aic-pg-check-[A-Za-z0-9]+$/)
  assert.equal(files.realpathSync.native(path.dirname(root)), files.realpathSync.native(os.tmpdir()))
  // macOS: os.tmpdir() itself sits behind the system /var -> /private/var link; only links below it are refused.
  const tmp = os.tmpdir(), realTmp = files.realpathSync.native(tmp)
  for (const name of [root, data]) {
    assert.ok(!files.lstatSync(name).isSymbolicLink(), 'Cluster directory must not be a link')
    assert.equal(files.realpathSync.native(name).toLowerCase(),
      path.join(realTmp, path.relative(tmp, name)).toLowerCase())
  }
  const proof = files.readFileSync(path.join(root, 'password'), 'utf8')
  // Never put passwords into assertion actual/expected output.
  assert.ok(proof === source.password, 'Launcher credential proof mismatch')
  const pid = files.readFileSync(path.join(data, 'postmaster.pid'), 'utf8').trim().split(/\r?\n/)
  assert.match(pid[0], /^[1-9][0-9]*$/)
  assert.equal(path.resolve(pid[1]).toLowerCase(), data.toLowerCase())
  assert.equal(pid[3], '15432')
  assert.equal(row.port, '15432')
  assert.equal(row.username, 'aic_test_owner')
  assert.equal(row.database, 'postgres')
  return root
}

async function until(check, message, ms = 6000) {
  const deadline = Date.now() + ms
  do {
    if (await check()) return
    await delay(20)
  } while (Date.now() < deadline)
  throw Error(message)
}

function database(pool) {
  let gate
  return {
    query: (sql, args) => pool.query(sql, args),
    holdCommit(pattern) {
      assert.ok(!gate, 'Only one commit gate per runtime connection pool')
      let entered, release
      const reached = new Promise((resolve) => { entered = resolve })
      const resume = new Promise((resolve) => { release = resolve })
      gate = { pattern, entered, resume }
      return { reached, release }
    },
    async transaction(work) {
      const client = await pool.connect()
      let selected
      const tx = { query: async (sql, args) => {
        const result = await client.query(sql, args)
        if (gate?.pattern.test(sql)) { selected = gate; gate = undefined }
        return result
      } }
      try {
        await client.query('BEGIN')
        const result = await work(tx)
        if (selected) {
          selected.entered()
          let timer
          try {
            await Promise.race([selected.resume, new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error('Commit gate timed out')), 10000)
            })])
          } finally { clearTimeout(timer) }
        }
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally { client.release() }
    },
  }
}

function privateDirectory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aic-accept-security-'))
  if (process.platform !== 'win32') fs.chmodSync(root, 0o700)
  else execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference='Stop'; $me=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($me); $acl.SetAccessRuleProtection($true,$false)
foreach($sid in @($me.Value,'S-1-5-18','S-1-5-32-544')) {
  $identity=New-Object Security.Principal.SecurityIdentifier($sid)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
}
[IO.Directory]::SetAccessControl($env:AIC_ACCEPT_CACHE,$acl)
`], { env: { ...process.env, AIC_ACCEPT_CACHE: root }, windowsHide: true, timeout: 15000, stdio: 'pipe' })
  // Retain synthetic crash artifacts for inspection; never recursively delete a supplied directory.
  return root
}

async function fixture(t) {
  const source = selectedSource(process.env)
  const { Client, Pool } = require('pg')
  const { migrate } = require('../../dist/database/migrate')
  const suffix = randomBytes(8).toString('hex')
  const name = 'aic_accept_sec_' + suffix
  const apiRole = 'aic_accept_api_' + suffix, workerRole = 'aic_accept_worker_' + suffix
  const password = randomBytes(32).toString('hex')
  const admin = new Client({ connectionString: source.href, connectionTimeoutMillis: 5000,
    statement_timeout: 15000, application_name: 'accept-security-admin' })
  let owner, apiPool, workerPool, created = false, connected = false
  const roles = []
  t.after(async () => {
    const errors = []
    for (const connection of [apiPool, workerPool, owner]) {
      if (connection) try { await connection.end() } catch { errors.push('Connection cleanup failed') }
    }
    // No FORCE, pg_terminate_backend, process enumeration, or service shutdown.
    if (created) try { await admin.query(`DROP DATABASE ${name}`) } catch { errors.push('Owned database cleanup failed') }
    for (const role of roles) try { await admin.query(`DROP ROLE ${role}`) } catch { errors.push('Owned role cleanup failed') }
    if (connected) try { await admin.end() } catch { errors.push('Admin cleanup failed') }
    assert.deepEqual(errors, [], 'Cleanup must succeed; failures are not swallowed')
  })
  await admin.connect()
  connected = true
  const identity = (await admin.query(`SELECT current_setting('data_directory') AS data_directory,
    current_setting('port') AS port,current_user AS username,current_database() AS database`)).rows[0]
  verifyClusterFiles(identity, source)
  await admin.query(`CREATE DATABASE ${name}`)
  created = true
  for (const role of [apiRole, workerRole]) {
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`)
    roles.push(role)
  }
  const ownerUrl = new URL(source)
  ownerUrl.pathname = '/' + name
  await migrate(ownerUrl.href)
  owner = new Client({ connectionString: ownerUrl.href, statement_timeout: 15000 })
  await owner.connect()
  await owner.query(fs.readFileSync(path.join(project, 'scripts/sandbox-runtime-grants.sql'), 'utf8')
    .replaceAll(':"api_role"', '"' + apiRole + '"').replaceAll(':"worker_role"', '"' + workerRole + '"'))
  const runtimeUrl = (role) => {
    const u = new URL(ownerUrl); u.username = role; u.password = password; return u.href
  }
  const poolOptions = { max: 25, connectionTimeoutMillis: 5000, statement_timeout: 15000,
    options: '-c lock_timeout=10000', application_name: 'accept-security-' + suffix }
  apiPool = new Pool({ ...poolOptions, connectionString: runtimeUrl(apiRole) })
  workerPool = new Pool({ ...poolOptions, connectionString: runtimeUrl(workerRole) })
  const apiDb = database(apiPool), workerDb = database(workerPool)
  for (const role of roles) {
    const r = (await owner.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls
      FROM pg_roles WHERE rolname=$1`, [role])).rows[0]
    assert.ok(Object.values(r).every((v) => v === false), 'Runtime roles must be unprivileged')
    assert.equal((await owner.query('SELECT count(*)::int AS n FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=$1)', [role])).rows[0].n, 0)
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM pg_class WHERE relnamespace='aic'::regnamespace AND relowner=(SELECT oid FROM pg_roles WHERE rolname=$1)", [role])).rows[0].n, 0)
  }
  for (const pool of [apiPool, workerPool])
    await assert.rejects(pool.query('DELETE FROM aic.audit_events WHERE false'), (e) => e.code === '42501')
  for (const table of ['users', 'sessions', 'mvp_invitations'])
    await assert.rejects(workerPool.query(`SELECT * FROM aic.${table} LIMIT 0`), (e) => e.code === '42501')
  const config = { sessionTtlMs: 3600000, sessionIdleMs: 3600000, loginMaxAttempts: 5,
    loginWindowMs: 900000, loginBlockMs: 900000, idempotencyTtlMs: 86400000,
    invitationTtlMs: 3600000, respondentRequestsPerMinute: 1200 }
  const { CoreRepository } = require('../../dist/foundation/core.repository')
  const { CaseMutations } = require('../../dist/foundation/case-mutations')
  const { MvpCaseService } = require('../../dist/foundation/mvp-case.service')
  const { MvpCapabilityService } = require('../../dist/foundation/mvp-capability.service')
  const { MvpQuestionnaireService } = require('../../dist/foundation/mvp-questionnaire.service')
  const { SessionService } = require('../../dist/auth/session.service')
  const { hashPassword } = require('../../dist/auth/password')
  const { requestHash } = require('../../dist/foundation/canonical')
  const core = new CoreRepository(apiDb), mutations = new CaseMutations(apiDb, config, core)
  const capabilities = new MvpCapabilityService(apiDb, config, core, mutations)
  const questionnaires = new MvpQuestionnaireService(apiDb, config, core, mutations, capabilities)
  const cases = new MvpCaseService(apiDb, config, core, mutations)
  const org = randomUUID(), user = randomUUID(), cp = randomUUID()
  const policy = JSON.parse(fs.readFileSync(path.join(project, 'docs/implementation/policies/AIC-MVP-SANDBOX-2026-10-17.1.json'), 'utf8'))
  await owner.query(`INSERT INTO aic.mvp_policy_artifacts(version,sha256,artifact_json,approved_at,effective_from)
    VALUES($1,$2,$3,$4,$5)`, [policy.policy_version, requestHash(policy), policy, policy.approval.recorded_at, policy.effective_from])
  await owner.query("INSERT INTO aic.organizations(id,name) VALUES($1,'SYNTHETIC ACCEPTANCE SECURITY')", [org])
  const username = 'accept_' + suffix, secret = randomBytes(24).toString('hex')
  await owner.query(`INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role)
    VALUES($1,$2,$3,$4,'Synthetic specialist','specialist')`, [user, org, username, await hashPassword(secret)])
  await owner.query("INSERT INTO aic.counterparties(id,organization_id,name,country) VALUES($1,$2,'SYNTHETIC','VN')", [cp, org])
  for (const kind of ['RECEIVABLE', 'PREPAYMENT'])
    await owner.query(`INSERT INTO aic.mvp_policy_assignments(id,organization_id,policy_version,artifact_hash,exposure_kind,effective_from)
      VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(), org, policy.policy_version, requestHash(policy), kind, policy.effective_from])
  const sessions = new SessionService(apiDb, config)
  const login = await sessions.login(username, secret, '127.0.0.1')
  const session = await sessions.resolve(login.token)
  assert.ok(session)
  async function newCase(kind = 'RECEIVABLE') {
    const result = await cases.create(session, randomUUID(), { counterparty_id: cp, exposure_kind: kind,
      lifecycle_stage: 'active', exposure: { amount_vnd: null, amount_missing_reason: 'Synthetic stress',
        term_days: null, term_null_reason: 'source_missing', organization_role: kind === 'RECEIVABLE' ? 'seller' : 'buyer',
        counterparty_role: kind === 'RECEIVABLE' ? 'buyer' : 'seller', contract_ref: null,
        conditions: [], claims: [], source_origin: 'staff_entered' } })
    assert.equal(result.status, 201)
    return result.body.id
  }
  const revision = async (caseId) => Number((await owner.query('SELECT revision FROM aic.cases WHERE id=$1', [caseId])).rows[0].revision)
  async function invitation(kind = 'RECEIVABLE') {
    const caseId = await newCase(kind)
    const form = (await questionnaires.create(session, caseId, randomUUID(), {
      expected_revision: await revision(caseId), reason: 'Synthetic stress form', questions: [{ label: 'Tax reference' }, { label: 'Revenue reference' }],
    })).body
    const input = { expected_revision: await revision(caseId), reason: 'Synthetic invitation',
      question_ids: form.questions.map((q) => q.id), reported_by: 'counterparty', recipient_reference: randomUUID() + '@synthetic.invalid' }
    const result = await capabilities.create(session, form.id, randomUUID(), input)
    assert.ok(result.rawToken)
    const answers = { reported_reference: 'Self-reported synthetic contact', answers: form.questions.map((q) => ({
      question_id: q.id, question_version: q.version, answer_state: 'submitted', answer_json: 'Synthetic response', skip_reason: null,
    })) }
    return { caseId, form, input, token: result.rawToken, id: result.body.invitation.id, answers }
  }
  async function waitBlocked(n) {
    await until(async () => Number((await owner.query(`SELECT count(*) AS n FROM pg_stat_activity
      WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Lock'`, [poolOptions.application_name])).rows[0].n) >= n,
    'Expected concurrent database lock wait was not observed')
  }
  return { owner, apiDb, workerDb, workerPool, runtimeUrl, workerRole, config, session, core, capabilities,
    questionnaires, newCase, invitation, revision, waitBlocked, org, user, cp }
}

module.exports = { project, hash, code, rejects, selectedSource, verifyClusterFiles, until, database, privateDirectory, fixture }
