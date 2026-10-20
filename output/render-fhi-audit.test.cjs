'use strict'
// Offline tests: real deployed-loader code, synthetic in-memory files and DB only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const ROOT = path.resolve(__dirname, '..')
const ORG = '11111111-1111-4111-8111-111111111111'
const CASE = '22222222-2222-4222-8222-222222222222'
const SECRET = 'SYNTHETIC_SECRET_DO_NOT_PRINT'
const source = fs.readFileSync(path.join(__dirname, 'render-fhi-audit.cjs'), 'utf8')
const realFhi = require('../apps/api/dist/financial/fhi-policy')
const realIntl = require('../apps/api/dist/financial/accounting-profiles')
const method = require('../apps/api/dist/financial/fhi-method')
const approval = { by: SECRET, source: SECRET, scope: SECRET, recorded_at: '2026-10-19T00:00:00Z' }
const common = { policy_id: SECRET, status: 'configured_pilot', organization_ids: [ORG], approval,
  effective_from: '2026-10-19T00:00:00Z', effective_until: null }
const validFhi = { ...common, method_id: method.FHI_METHOD_ID, method_version: method.FHI_METHOD_VERSION,
  method_hash: realFhi.fhiMethodHash(), industry_scope: method.FHI_PILOT_SCOPE }
const validIntl = { ...common, profiles: realIntl.ACCOUNTING_PROFILES.map(p =>
  ({ profile_id: p.id, method_hash: realIntl.profileMethodHash(p) })) }

function harness(options = {}) {
  const files = { '/etc/secrets/fhi.json': JSON.stringify({ ...validFhi, ...options.patch }),
    '/etc/secrets/international.json': JSON.stringify({ ...validIntl, ...options.intlPatch }) }
  const env = { DATABASE_URL: SECRET, AIC_FHI_POLICY_PATH: '/etc/secrets/fhi.json',
    AIC_INTERNATIONAL_POLICY_PATH: '/etc/secrets/international.json', ...options.env }
  const reads = [], queries = [], printed = []
  let ended = false, writes = 0
  const fakeFs = {
    readFileSync(name) {
      reads.push(name)
      if (options.fileError) throw Object.assign(Error(SECRET), { code: options.fileError })
      if (!(name in files)) throw Object.assign(Error(SECRET), { code: 'ENOENT' })
      if (options.invalidJson) return SECRET
      return files[name]
    },
    writeFileSync() { writes++; throw Error('Write forbidden') },
  }
  function loadLoader(relative) {
    const filename = path.join(ROOT, 'apps/api/dist/financial', relative + '.js')
    const localRequire = createRequire(filename), exports = {}
    // Keep the loader's objects in canonicalJson's realm; isolate I/O via require.
    const wrapper = vm.runInThisContext('(function(require,module,exports){\n' +
      fs.readFileSync(filename, 'utf8') + '\n})', { filename })
    wrapper(name => name === 'node:fs' ? fakeFs : localRequire(name), { exports }, exports)
    return exports
  }
  const fhi = loadLoader('fhi-policy'), intl = loadLoader('accounting-profiles')
  const context = { organization_id: ORG, country: 'VN', purpose: 'company_health',
    at: '2026-10-20T00:00:00Z', ...options.context }
  class Client {
    async connect() { if (options.dbError) throw Error(SECRET) }
    async query(sql, args) {
      queries.push({ sql, args })
      assert.match(sql, /^(BEGIN TRANSACTION .* READ ONLY|SET LOCAL statement_timeout|SELECT c\.organization_id|ROLLBACK)/)
      if (sql.startsWith('SELECT')) {
        assert.deepEqual(Array.from(args), [CASE])
        return { rows: options.noCase ? [] : [context] }
      }
      return { rows: [] }
    }
    async end() { ended = true }
  }
  const exports = {}, module = { exports }
  function mockedRequire(name) {
    if (name === 'node:fs') return fakeFs
    if (name === 'node:path') return path.posix
    if (name.endsWith('/financial/fhi-policy')) return fhi
    if (name.endsWith('/financial/accounting-profiles')) return intl
    if (name.endsWith('/financial/fhi-method')) return method
    if (name.endsWith('/financial/financial-import-source')) return { countryCode: x => x }
    if (name.endsWith('/db-url.cjs')) return { databaseUrlProblem: () => options.tlsError ? SECRET : null }
    if (name.endsWith('/node_modules/pg')) return { Client }
    throw Error('Unexpected import')
  }
  mockedRequire.main = options.cli ? module : null
  vm.runInNewContext(source, {
    module, exports, require: mockedRequire,
    process: { env, argv: ['node', 'audit', CASE] },
    console: { log: x => printed.push(x), error: x => printed.push(x) },
  })
  return { main: module.exports.main, reads, queries, printed, ended: () => ended, writes: () => writes }
}

test('valid policies, real loaders, only parameterized context SELECT and rollback', async () => {
  const h = harness(), result = await h.main(CASE)
  assert.equal(result.fhi.loaded_valid, true)
  assert.equal(result.international.loaded_valid, true)
  assert.equal(result.case_policy.eligible_now, true)
  assert.equal(result.case_policy.selected, 'fhi')
  assert.equal(h.queries.filter(q => q.sql.startsWith('SELECT')).length, 1)
  assert.equal(h.queries[0].sql, 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(h.queries.at(-1).sql, 'ROLLBACK')
  assert.ok(h.ended())
  assert.equal(h.writes(), 0)
  for (const forbidden of [SECRET, ORG, CASE, 'intakes', 'calculations', 'postgres', 'method_hash":'])
    assert.ok(!JSON.stringify(result).includes(forbidden), forbidden)
})

for (const [patch, failure] of [
  [{ method_hash: 'incorrect' }, 'METHOD_HASH_MISMATCH'],
  [{ method_version: 'other' }, 'METHOD_VERSION_MISMATCH'],
  [{ method_id: 'other' }, 'METHOD_ID_MISMATCH'],
  [{ industry_scope: 'other' }, 'INDUSTRY_SCOPE_MISMATCH'],
  [{ status: 'validated' }, 'POLICY_STATUS_INVALID'],
  [{ organization_ids: [CASE] }, 'CASE_ORGANIZATION_NOT_AUTHORIZED'],
  [{ organization_ids: [] }, 'ORGANIZATION_IDS_INVALID'],
  [{ approval: { ...approval, by: '' } }, 'APPROVAL_BY_REQUIRED'],
  [{ approval: { ...approval, source: '' } }, 'APPROVAL_SOURCE_REQUIRED'],
  [{ approval: { ...approval, scope: '' } }, 'APPROVAL_SCOPE_REQUIRED'],
  [{ approval: { ...approval, recorded_at: 'invalid' } }, 'APPROVAL_RECORDED_AT_INVALID'],
  [{ approval: { ...approval, recorded_at: '2026-10-21T00:00:00Z' }, effective_from: '2026-10-21T00:00:00Z' }, 'APPROVAL_IN_FUTURE'],
  [{ effective_from: '2026-10-21T00:00:00Z' }, 'POLICY_NOT_YET_EFFECTIVE'],
  [{ effective_from: '2026-10-18T00:00:00Z' }, 'EFFECTIVE_BEFORE_APPROVAL'],
  [{ effective_until: '2026-10-20T00:00:00Z' }, 'POLICY_EXPIRED'],
  [{ effective_until: '2026-10-18T00:00:00Z' }, 'EFFECTIVE_INTERVAL_INVALID'],
]) test(failure, async () => {
  const r = await harness({ patch }).main(CASE)
  assert.equal(r.case_policy.eligible_now, false)
  assert.ok(r.case_policy.failures.includes(failure))
})

for (const [options, failure] of [
  [{ env: { AIC_FHI_POLICY_PATH: '' } }, 'POLICY_PATH_UNSET'],
  [{ fileError: 'ENOENT' }, 'POLICY_FILE_NOT_FOUND'],
  [{ fileError: 'EACCES' }, 'POLICY_FILE_NOT_READABLE'],
  [{ invalidJson: true }, 'POLICY_JSON_INVALID'],
]) test(failure, async () => {
  const r = await harness(options).main(CASE)
  assert.ok(r.fhi.failures.includes(failure))
  assert.equal(r.fhi.loaded_valid, false)
  assert.ok(!JSON.stringify(r).includes(SECRET))
})

test('country profile selection does not authorize unsupported countries', async () => {
  for (const country of ['US', 'CN', 'KR']) {
    const r = await harness({ context: { country } }).main(CASE)
    assert.equal(r.case_policy.selected, 'international')
    assert.equal(r.case_policy.eligible_now, country !== 'KR')
    if (country === 'KR') assert.ok(r.case_policy.failures.includes('COUNTRY_PROFILE_NOT_AUTHORIZED'))
  }
})
test('international method hash failure uses the actual profile loader', async () => {
  const r = await harness({ context: { country: 'US' },
    intlPatch: { profiles: [{ profile_id: 'US_GAAP_DISTRIBUTION_1', method_hash: 'wrong' }] } }).main(CASE)
  assert.equal(r.international.loaded_valid, false)
  assert.ok(r.case_policy.failures.includes('PROFILE_METHOD_HASH_MISMATCH'))
})
test('invalid case, missing case and TLS rejection cannot query financial data', async () => {
  const h = harness()
  assert.equal((await h.main('bad')).failure, 'CASE_UUID_INVALID')
  assert.equal(h.queries.length, 0)
  assert.equal((await harness({ noCase: true }).main(CASE)).failure, 'CASE_NOT_FOUND')
  const tls = harness({ tlsError: true })
  assert.equal((await tls.main(CASE)).failure, 'DATABASE_TLS_CONFIGURATION_REJECTED')
  assert.equal(tls.queries.length, 0)
})
test('CLI error boundary redacts DB exception messages and closes connection', async () => {
  const h = harness({ cli: true, dbError: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.printed, ['{"failure":"AUDIT_EXECUTION_FAILED"}'])
  assert.ok(h.ended())
  assert.equal(h.writes(), 0)
})
