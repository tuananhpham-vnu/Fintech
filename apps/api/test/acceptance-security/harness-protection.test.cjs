const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const os = require('node:os')
const { selectedSource, verifyClusterFiles } = require('./harness.cjs')
const { launcherEnv } = require('./run-security-tests.cjs')
const secret = 'a'.repeat(64)
const url = 'postgresql://aic_test_owner:' + secret + '@127.0.0.1:15432/postgres'
const selected = { AIC_ALLOW_LOCAL_DB_TESTS: 'true', AIC_TEST_DATABASE_URL: url }

test('no DB: explicit launcher opt-in and URL are mandatory; no normal DB fallback', () => {
  for (const env of [{}, { DATABASE_URL: url }, { AIC_TEST_DATABASE_URL: url },
    { AIC_ALLOW_LOCAL_DB_TESTS: 'true' }, { ...selected, AIC_ALLOW_LOCAL_DB_TESTS: 'false' }])
    assert.throws(() => selectedSource(env))
  assert.equal(selectedSource(selected).port, '15432')
})
test('no DB: remote/user/alternate-port/alternate-owner/query URLs fail without exposing credentials', () => {
  for (const changed of [url.replace('127.0.0.1', 'localhost'), url.replace('127.0.0.1', 'example.invalid'),
    url.replace('15432', '5432'), url.replace('aic_test_owner', 'postgres'), url.replace('/postgres', '/customer'),
    url + '?options=unsafe', url + '#fragment', 'invalid:' + secret]) {
    assert.throws(() => selectedSource({ ...selected, AIC_TEST_DATABASE_URL: changed }), (error) => !String(error).includes(secret))
  }
})
test('no DB: plausible loopback URL cannot authorize a user data directory', () => {
  assert.throws(() => verifyClusterFiles({ data_directory: path.join(__dirname, 'user-db'),
    username: 'aic_test_owner', database: 'postgres', port: '15432' }, selectedSource(selected)))
})
test('no DB: cluster identity requires actual owner, database, port, temporary boundary and unlinked paths', () => {
  const data = path.join(os.tmpdir(), 'aic-pg-check-unit', 'data')
  const row = { data_directory: data, username: 'aic_test_owner', database: 'postgres', port: '15432' }
  const files = {
    realpathSync: { native: (name) => path.resolve(name) },
    lstatSync: () => ({ isSymbolicLink: () => false }),
    readFileSync: (name) => path.basename(name) === 'password' ? secret : ['1234', data, '0', '15432'].join('\n'),
  }
  assert.equal(verifyClusterFiles(row, selectedSource(selected), files), path.dirname(data))
  for (const change of [{ username: 'postgres' }, { database: 'customer' }, { port: '5432' },
    { data_directory: path.join(__dirname, 'aic-pg-check-unit', 'data') },
    { data_directory: path.join(os.tmpdir(), 'normal-postgres', 'data') }])
    assert.throws(() => verifyClusterFiles({ ...row, ...change }, selectedSource(selected), files))
  assert.throws(() => verifyClusterFiles(row, selectedSource(selected), { ...files,
    lstatSync: () => ({ isSymbolicLink: () => true }) }))
})
test('no DB: missing/mismatched launcher password proof and wrong postmaster data/port fail closed', () => {
  const data = path.join(os.tmpdir(), 'aic-pg-check-unit', 'data')
  const row = { data_directory: data, username: 'aic_test_owner', database: 'postgres', port: '15432' }
  const files = { realpathSync: { native: (name) => path.resolve(name) },
    lstatSync: () => ({ isSymbolicLink: () => false }) }
  for (const proof of ['wrong-password', null, secret]) {
    const readFileSync = (name) => {
      if (path.basename(name) === 'password') {
        if (proof === null) throw Error('Missing launcher proof')
        return proof
      }
      return ['1234', data, '0', proof === secret ? '5432' : '15432'].join('\n')
    }
    assert.throws(() => verifyClusterFiles(row, selectedSource(selected), { ...files, readFileSync }),
      (error) => !String(error).includes(secret))
  }
  assert.throws(() => verifyClusterFiles(row, selectedSource(selected), { ...files,
    readFileSync: (name) => path.basename(name) === 'password' ? secret : ['1234', __dirname, '0', '15432'].join('\n'),
  }))
})
test('no DB: child environment strips inherited secrets and implicit connection/runtime options', () => {
  assert.deepEqual(launcherEnv({ PATH: 'bin', TEMP: 'temp', AIC_POSTGRES_BIN: 'pg-bin', DATABASE_URL: secret,
    AIC_TEST_DATABASE_URL: secret, AIC_ALLOW_LOCAL_DB_TESTS: 'true', PGHOST: secret, PGPASSWORD: secret,
    GEMINI_API_KEY: secret, INTERNAL_API_KEY: secret, NODE_OPTIONS: '--env-file=.env', NODE_PATH: 'untrusted' }),
  { PATH: 'bin', TEMP: 'temp', AIC_POSTGRES_BIN: 'pg-bin' })
})
test('no DB: unapproved runner invocation exits 2 before any network/launcher action', () => {
  for (const args of [[], ['--other'], ['--run', 'untrusted-test.cjs']]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'run-security-tests.cjs'), ...args], {
      env: launcherEnv(process.env), encoding: 'utf8', timeout: 5000, windowsHide: true,
    })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /Explicit opt-in required/)
    assert.equal(result.stdout, '')
  }
})
