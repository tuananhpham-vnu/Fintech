const { test } = require('node:test'),
  assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto'),
  { Client } = require('pg')
const { migrate } = require('../dist/database/migrate')
const { bootstrapSandbox } = require('../dist/database/bootstrap-sandbox')
const { verifyPassword } = require('../dist/auth')
test('insert-only operator bootstrap on a fresh disposable sandbox', async (t) => {
  assert.equal(process.env.AIC_ALLOW_LOCAL_DB_TESTS, 'true')
  const url = new URL(process.env.AIC_TEST_DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  const admin = new Client({ connectionString: url.href })
  await admin.connect()
  const name = 'aic_mvp_bootstrap_' + randomBytes(6).toString('hex')
  let db
  try {
    await admin.query('CREATE DATABASE ' + name)
    url.pathname = '/' + name
    await migrate(url.href)
    db = new Client({ connectionString: url.href })
    await db.connect()
    const org = randomUUID(),
      password = randomBytes(24).toString('hex'),
      username = 'synthetic-' + randomUUID()
    Object.assign(process.env, {
      DATABASE_URL: url.href,
      NODE_ENV: 'test',
      AIC_SANDBOX_BOOTSTRAP: 'true',
      AIC_SANDBOX_ORGANIZATION_ID: org,
      AIC_SANDBOX_USERNAME: username,
      AIC_SANDBOX_PASSWORD: password,
    })
    await t.test(
      'real hashed identity, two unresolved counterparties, two scoped assignments and no seeded case',
      async () => {
        await bootstrapSandbox()
        const users = (await db.query('SELECT * FROM aic.users')).rows
        assert.equal(users.length, 1)
        assert.equal(users[0].username, username)
        assert.notEqual(users[0].password_hash, password)
        assert.equal(await verifyPassword(password, users[0].password_hash), true)
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int n FROM aic.counterparties WHERE organization_id=$1 AND identity_status=$2',
              [org, 'unresolved'],
            )
          ).rows[0].n,
          2,
        )
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int n FROM aic.mvp_policy_assignments WHERE organization_id=$1',
              [org],
            )
          ).rows[0].n,
          2,
        )
        assert.equal((await db.query('SELECT count(*)::int n FROM aic.cases')).rows[0].n, 0)
        const policy = (await db.query('SELECT * FROM aic.mvp_policy_artifacts')).rows[0]
        assert.equal(policy.artifact_json.financial_method_boundary.activate_fhi_pilot, false)
        assert.ok(policy.effective_from >= policy.approved_at)
      },
    )
    await t.test(
      'existing organization refuses bootstrap and preserves old credentials/assignments',
      async () => {
        const before = (await db.query('SELECT password_hash FROM aic.users')).rows[0].password_hash
        process.env.AIC_SANDBOX_PASSWORD = randomBytes(24).toString('hex')
        await assert.rejects(bootstrapSandbox(), (error) => error.code === '23505')
        assert.equal(
          (await db.query('SELECT password_hash FROM aic.users')).rows[0].password_hash,
          before,
        )
        assert.equal(
          (await db.query('SELECT count(*)::int n FROM aic.mvp_policy_assignments')).rows[0].n,
          2,
        )
      },
    )
    await t.test('missing opt-in and production refuse without changing the database', async () => {
      delete process.env.AIC_SANDBOX_BOOTSTRAP
      await assert.rejects(bootstrapSandbox())
      process.env.AIC_SANDBOX_BOOTSTRAP = 'true'
      process.env.NODE_ENV = 'production'
      await assert.rejects(bootstrapSandbox())
      assert.equal((await db.query('SELECT count(*)::int n FROM aic.organizations')).rows[0].n, 1)
    })
  } finally {
    if (db) await db.end()
    await admin.query('DROP DATABASE ' + name)
    await admin.end()
  }
})
