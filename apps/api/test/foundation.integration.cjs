const test = require('node:test'),
  assert = require('node:assert/strict')
const { randomUUID, randomBytes, createHash } = require('node:crypto')
const { Client } = require('pg'),
  { spawn } = require('node:child_process'),
  net = require('node:net'),
  path = require('node:path')
const { migrate } = require('../dist/database/migrate')
const { loadConfig } = require('../dist/config/configuration')
const { createApplication } = require('../dist/main')
const { DatabaseService } = require('../dist/database/database.service')
const { SessionService, hashPassword } = require('../dist/auth')
const { CaseMutations } = require('../dist/foundation/case-mutations')
const { CoreRepository } = require('../dist/foundation/core.repository')
const { validateContract } = require('../dist/foundation/validation')
const { requestHash } = require('../dist/foundation/canonical')

test('Phase1 foundation: actual PostgreSQL and HTTP (no mock DB/auth)', async (t) => {
  const supplied = process.env.AIC_TEST_DATABASE_URL
  assert.ok(supplied, 'AIC_TEST_DATABASE_URL is required; no mock fallback')
  const source = new URL(supplied)
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname) &&
      process.env.AIC_ALLOW_LOCAL_DB_TESTS === 'true',
    'Explicit loopback-only disposable DB test opt-in required',
  )
  const suffix = randomBytes(6).toString('hex'),
    dbName = 'aic_phase1_test_' + suffix,
    role = 'aic_test_runtime_' + suffix
  const rolePassword = randomBytes(32).toString('hex'),
    admin = new Client({ connectionString: supplied })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${dbName}`)
  await admin.query(
    `CREATE ROLE ${role} LOGIN PASSWORD '${rolePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
  )
  const ownerUrl = new URL(supplied)
  ownerUrl.pathname = '/' + dbName
  const owner = new Client({ connectionString: ownerUrl.href })
  await owner.connect()
  const runtimeUrl = new URL(ownerUrl)
  runtimeUrl.username = role
  runtimeUrl.password = rolePassword
  let app
  try {
    await t.test('empty database readiness fails closed without auto-migrating', async () => {
      const empty = new DatabaseService({ databaseUrl: ownerUrl.href })
      await assert.rejects(empty.onModuleInit())
      assert.equal(
        (await owner.query("SELECT to_regclass('aic.schema_migrations') AS relation")).rows[0]
          .relation,
        null,
      )
    })
    await t.test(
      'migration checksum canonicalizes line endings but detects substantive edits',
      async () => {
        const { canonicalMigrationSource } = require('../dist/database/migration-source')
        assert.equal(
          canonicalMigrationSource('SELECT 1;\r\n').checksum,
          canonicalMigrationSource('SELECT 1;\n').checksum,
        )
        assert.notEqual(
          canonicalMigrationSource('SELECT 2;\n').checksum,
          canonicalMigrationSource('SELECT 1;\n').checksum,
        )
      },
    )
    await t.test('numbered migrations apply once with checksum ledger', async () => {
      assert.deepEqual((await migrate(ownerUrl.href)).applied, [
        '0001_foundation.sql',
        '0002_creator_membership_policy_immutability.sql',
        '0003_authorization_row_locks.sql',
        '0004_mvp_documents.sql',
        '0005_mvp_policy_exposure.sql',
        '0006_mvp_workflows.sql',
        '0007_mvp_source_lock_invariants.sql',
        '0008_mvp_document_human_decisions.sql',
        '0009_mvp_issue_decisions.sql',
        '0010_mvp_staff_questionnaires.sql',
        '0011_mvp_counterparty_versions.sql',
        '0012_mvp_native_capabilities.sql',
        '0013_mvp_questionnaire_source_bindings.sql',
        '0014_mvp_financial_registry.sql',
        '0015_mvp_field_verification.sql',
        '0016_mvp_source_payload_null_guards.sql',
        '0017_mvp_questionnaire_source_tuple.sql',
        '0018_mvp_dossier_intake.sql',
        '0019_assessments.sql',
        '0020_company_health_workspaces.sql',
        '0021_financial_import_sources.sql',
        '0022_company_financial_intake.sql',
        '0023_financial_reasoning.sql',
      ])
      assert.deepEqual((await migrate(ownerUrl.href)).applied, [])
      const row = (await owner.query('SELECT * FROM aic.schema_migrations ORDER BY name')).rows[0]
      await owner.query('UPDATE aic.schema_migrations SET checksum=$1 WHERE name=$2', [
        '0'.repeat(64),
        row.name,
      ])
      await assert.rejects(migrate(ownerUrl.href), /checksum mismatch/)
      await owner.query('UPDATE aic.schema_migrations SET checksum=$1 WHERE name=$2', [
        row.checksum,
        row.name,
      ])
    })
    await owner.query(`GRANT USAGE ON SCHEMA aic TO ${role}`)
    await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA aic TO ${role}`)
    await owner.query(
      `GRANT INSERT,UPDATE ON aic.sessions,aic.login_attempts,aic.idempotency_keys TO ${role}`,
    )
    await owner.query(`GRANT UPDATE ON aic.cases TO ${role}`)
    await owner.query(`GRANT INSERT ON aic.audit_events TO ${role}`)
    await owner.query(
      `GRANT EXECUTE ON FUNCTION aic.lock_login_user(text),aic.lock_case_access(uuid,uuid,uuid),aic.lock_active_session(uuid,uuid,uuid,bigint) TO ${role}`,
    )
    const ids = {
      orgA: randomUUID(),
      orgB: randomUUID(),
      alice: randomUUID(),
      anna: randomUUID(),
      bob: randomUUID(),
      cpA: randomUUID(),
      cpB: randomUUID(),
      caseA: randomUUID(),
      caseA2: randomUUID(),
      caseA3: randomUUID(),
      caseB: randomUUID(),
    }
    const password = 'Synthetic-' + randomUUID(),
      encoded = await hashPassword(password)
    for (const org of [ids.orgA, ids.orgB])
      await owner.query('INSERT INTO aic.organizations(id,name) VALUES($1,$2)', [
        org,
        'SYNTHETIC ' + org,
      ])
    for (const [id, org, name] of [
      [ids.alice, ids.orgA, 'alice'],
      [ids.anna, ids.orgA, 'anna'],
      [ids.bob, ids.orgB, 'bob'],
    ])
      await owner.query(
        "INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role) VALUES($1,$2,$3,$4,$3,'specialist')",
        [id, org, name, encoded],
      )
    for (const [cp, org] of [
      [ids.cpA, ids.orgA],
      [ids.cpB, ids.orgB],
    ])
      await owner.query(
        "INSERT INTO aic.counterparties(id,organization_id,name,country,tax_id) VALUES($1,$2,'SYNTHETIC','VN','0000000001')",
        [cp, org],
      )
    const exposure = {
      amount_vnd: '90071992547409930001',
      term_days: 30,
      organization_role: 'seller',
      counterparty_role: 'buyer',
      contract_ref: null,
      conditions: [],
      source_origin: 'staff_entered',
    }
    for (const [id, org, cp, user] of [
      [ids.caseA, ids.orgA, ids.cpA, ids.alice],
      [ids.caseA2, ids.orgA, ids.cpA, ids.anna],
      [ids.caseA3, ids.orgA, ids.cpA, ids.alice],
      [ids.caseB, ids.orgB, ids.cpB, ids.bob],
    ])
      await owner.query(
        "INSERT INTO aic.cases(id,organization_id,counterparty_id,exposure_kind,lifecycle_stage,exposure_json,policy_version,created_by) VALUES($1,$2,$3,'RECEIVABLE','proposed',$4,'TEST-FIXTURE-NOT-PRODUCTION-POLICY',$5)",
        [id, org, cp, exposure, user],
      )
    Object.assign(process.env, {
      NODE_ENV: 'test',
      AIC_RUNTIME_MODE: 'foundation',
      DATABASE_URL: runtimeUrl.href,
      AIC_FRONTEND_ORIGIN: 'http://127.0.0.1:3000',
      AIC_COOKIE_NAME: 'aic_phase1_test',
      AIC_IDEMPOTENCY_TTL_MS: '3600000',
    })
    const config = loadConfig()
    app = await createApplication(config, true)
    await app.listen(0, '127.0.0.1')
    let base = (await app.getUrl()) + '/api/v2'
    const db = app.get(DatabaseService),
      sessions = app.get(SessionService),
      mutations = app.get(CaseMutations)
    const origin = config.frontendOrigin
    async function request(route, opts = {}) {
      const response = await fetch(base + route, opts)
      const text = await response.text()
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
        headers: response.headers,
      }
    }
    async function login(username, pass = password) {
      return request('/auth/login', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: pass }),
      })
    }
    function cookie(loginResult) {
      return loginResult.headers.get('set-cookie').split(';')[0]
    }
    let a, b, aCookie, bCookie, auth
    await t.test(
      'invalid, unknown and disabled credentials fail uniformly; no prototype login',
      async () => {
        for (const [name, pass] of [
          ['alice', 'wrong-' + randomUUID()],
          ['does-not-exist', password],
          ['qa.specialist', 'TestOnly#2026'],
        ]) {
          const r = await login(name, pass)
          assert.equal(r.status, 401)
          assert.equal(r.body.code, 'INVALID_CREDENTIALS')
          validateContract('Error', r.body)
        }
        await owner.query('UPDATE aic.users SET disabled_at=now() WHERE id=$1', [ids.anna])
        assert.equal((await login('anna')).body.code, 'INVALID_CREDENTIALS')
        await owner.query('UPDATE aic.users SET disabled_at=NULL WHERE id=$1', [ids.anna])
      },
    )
    await t.test('strict LoginInput and same-origin enforcement', async () => {
      for (const body of [
        {},
        { username: 'alice', password, organization_id: ids.orgB },
        { username: 1, password },
      ]) {
        const r = await request('/auth/login', {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        assert.equal(r.status, 422)
        assert.equal(r.body.code, 'INVALID_INPUT')
      }
      assert.equal(
        (
          await request('/auth/login', {
            method: 'POST',
            headers: { origin: 'https://foreign.invalid', 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'alice', password }),
          })
        ).status,
        403,
      )
    })
    await t.test(
      'real password login, hash-only persistent session and configured cookie',
      async () => {
        a = await login('alice')
        b = await login('bob')
        assert.equal(a.status, 200)
        assert.equal(b.status, 200)
        validateContract('SessionOutput', a.body)
        aCookie = cookie(a)
        bCookie = cookie(b)
        assert.match(aCookie, /^aic_phase1_test=/)
        assert.match(a.headers.get('set-cookie'), /HttpOnly/)
        assert.match(a.headers.get('set-cookie'), /SameSite=Lax/)
        const token = aCookie.split('=')[1],
          rows = (
            await owner.query('SELECT * FROM aic.sessions WHERE token_hash=$1', [
              createHash('sha256').update(token).digest('hex'),
            ])
          ).rows
        assert.equal(rows.length, 1)
        assert.ok(!JSON.stringify(rows).includes(token))
        assert.ok(!JSON.stringify(rows).includes(a.body.csrf_token))
        assert.equal(Date.parse(a.body.expires_at) > Date.now() + 7 * 3600000, true)
        auth = await sessions.resolve(token)
        assert.ok(auth)
      },
    )
    await t.test(
      'missing/invalid session401, outsider404 across org and case membership',
      async () => {
        assert.equal((await request('/cases')).status, 401)
        assert.equal(
          (await request('/cases', { headers: { cookie: 'aic_phase1_test=invalid' } })).status,
          401,
        )
        for (const route of [
          '/cases/' + ids.caseB,
          '/cases/' + ids.caseB + '/history',
          '/cases/' + ids.caseA2,
          '/counterparties/' + ids.cpB,
        ]) {
          const r = await request(route, { headers: { cookie: aCookie } })
          assert.equal(r.status, 404)
          assert.equal(r.body.code, 'NOT_FOUND')
          assert.ok(!JSON.stringify(r.body).includes(ids.orgB))
        }
        assert.equal(
          (await request('/cases/' + ids.caseA, { headers: { cookie: bCookie } })).status,
          404,
        )
        const own = await request('/cases/' + ids.caseA, { headers: { cookie: aCookie } })
        assert.equal(own.status, 200)
        assert.equal(own.body.exposure.amount_vnd, exposure.amount_vnd)
        validateContract('Case', own.body)
      },
    )
    await t.test('scoped list/cursor pagination, no cross-case or cross-org rows', async () => {
      const first = await request('/cases?limit=1', { headers: { cookie: aCookie } })
      validateContract('CasePage', first.body)
      assert.equal(first.body.items.length, 1)
      assert.ok(first.body.next_cursor)
      const second = await request('/cases?limit=1&cursor=' + first.body.next_cursor, {
        headers: { cookie: aCookie },
      })
      assert.equal(second.body.items.length, 1)
      assert.notEqual(first.body.items[0].id, second.body.items[0].id)
      assert.equal(second.body.next_cursor, null)
      assert.deepEqual(
        new Set([first.body.items[0].id, second.body.items[0].id]),
        new Set([ids.caseA, ids.caseA3]),
      )
      const cp = await request('/counterparties', { headers: { cookie: aCookie } })
      validateContract('CounterpartyPage', cp.body)
      assert.deepEqual(
        cp.body.items.map((x) => x.id),
        [ids.cpA],
      )
      assert.equal(
        (await request('/cases?limit=101', { headers: { cookie: aCookie } })).status,
        422,
      )
      assert.equal(
        (await request('/cases?cursor=malformed', { headers: { cookie: aCookie } })).status,
        422,
      )
    })
    await t.test(
      'creator membership automatic and same transaction; policy version immutable',
      async () => {
        const rows = (
          await owner.query('SELECT * FROM aic.case_memberships WHERE case_id=$1', [ids.caseA])
        ).rows
        assert.equal(rows.length, 1)
        assert.equal(rows[0].user_id, ids.alice)
        await assert.rejects(
          owner.query('UPDATE aic.cases SET policy_version=$1 WHERE id=$2', [
            'new-policy',
            ids.caseA,
          ]),
        )
        const fixtureId = randomUUID()
        await assert.rejects(
          (async () => {
            await owner.query('BEGIN')
            try {
              await owner.query(
                "INSERT INTO aic.cases(id,organization_id,counterparty_id,exposure_kind,lifecycle_stage,exposure_json,policy_version,created_by) VALUES($1,$2,$3,'RECEIVABLE','proposed',$4,'TEST',$5)",
                [fixtureId, ids.orgA, ids.cpA, exposure, ids.alice],
              )
              assert.equal(
                (
                  await owner.query('SELECT * FROM aic.case_memberships WHERE case_id=$1', [
                    fixtureId,
                  ])
                ).rowCount,
                1,
              )
              throw Error('forced rollback')
            } catch (error) {
              await owner.query('ROLLBACK')
              throw error
            }
          })(),
          /forced rollback/,
        )
        assert.equal(
          (await owner.query('SELECT id FROM aic.cases WHERE id=$1', [fixtureId])).rowCount,
          0,
        )
      },
    )
    await t.test(
      'same-tenant composite FKs and resource/domain checks reject forged rows',
      async () => {
        await assert.rejects(
          owner.query(
            'INSERT INTO aic.case_memberships(organization_id,case_id,user_id,granted_by) VALUES($1,$2,$3,$3)',
            [ids.orgB, ids.caseA, ids.bob],
          ),
          (e) => e.code === '23503',
        )
        for (const update of [
          { ...exposure, amount_vnd: '1.5' },
          { ...exposure, organization_role: 'buyer' },
          { ...exposure, term_days: -1 },
        ])
          await assert.rejects(
            owner.query('UPDATE aic.cases SET exposure_json=$1 WHERE id=$2', [update, ids.caseA]),
            (e) => e.code === '23514',
          )
        assert.equal(
          (await owner.query('SELECT rolsuper FROM pg_roles WHERE rolname=$1', [role])).rows[0]
            .rolsuper,
          false,
        )
        await assert.rejects(
          db.query('CREATE TABLE aic.unapproved_admin_table(id int)'),
          (e) => e.code === '42501',
        )
      },
    )
    const operation = 'PATCH/cases/' + ids.caseA + '/foundation-test',
      key = randomUUID(),
      payload = { expected_revision: 1, delta: 'synthetic-transaction-only' }
    async function apply(tx, current, next) {
      await tx.query(
        "UPDATE aic.cases SET exposure_json=jsonb_set(exposure_json,'{amount_vnd}',$1::jsonb) WHERE id=$2",
        [JSON.stringify('12345678901234567890'), ids.caseA],
      )
      return {
        status: 200,
        body: { id: current.id, revision: next },
        action: 'foundation.transaction.test',
      }
    }
    const execute = (overrides = {}) =>
      mutations.execute(auth, ids.caseA, {
        operation,
        key,
        expectedRevision: 1,
        payload,
        work: apply,
        ...overrides,
      })
    let committed
    await t.test(
      'atomic revision/audit/idempotency commit; exact replay is side-effect free',
      async () => {
        committed = await execute()
        assert.equal(committed.replayed, false)
        assert.equal(committed.body.revision, 2)
        const again = await execute()
        assert.equal(again.replayed, true)
        assert.deepEqual(again.body, committed.body)
        assert.equal(
          (await owner.query('SELECT revision FROM aic.cases WHERE id=$1', [ids.caseA])).rows[0]
            .revision,
          '2',
        )
        assert.equal(
          (await owner.query('SELECT * FROM aic.audit_events WHERE case_id=$1', [ids.caseA]))
            .rowCount,
          1,
        )
      },
    )
    await t.test(
      'different payload/key scope and stale revision are409; canonical JSON stable',
      async () => {
        await assert.rejects(
          execute({ payload: { ...payload, delta: 'different' } }),
          (e) => e.getStatus() === 409 && e.getResponse().code === 'IDEMPOTENCY_CONFLICT',
        )
        await assert.rejects(
          execute({ key: randomUUID() }),
          (e) => e.getStatus() === 409 && e.getResponse().code === 'REVISION_CONFLICT',
        )
        assert.equal(requestHash({ b: [1, 2], a: null }), requestHash({ a: null, b: [1, 2] }))
        assert.notEqual(requestHash({ b: [2, 1], a: null }), requestHash({ a: null, b: [1, 2] }))
      },
    )
    await t.test(
      'failed transaction rolls back data/revision/audit/replay record together',
      async () => {
        const failedKey = randomUUID()
        await assert.rejects(
          execute({
            key: failedKey,
            expectedRevision: 2,
            payload: { expected_revision: 2 },
            work: async (tx) => {
              await tx.query(
                "UPDATE aic.cases SET exposure_json=jsonb_set(exposure_json,'{amount_vnd}','\"999\"') WHERE id=$1",
                [ids.caseA],
              )
              throw Error('injected-failure')
            },
          }),
          /injected-failure/,
        )
        const row = (
          await owner.query('SELECT revision,exposure_json FROM aic.cases WHERE id=$1', [ids.caseA])
        ).rows[0]
        assert.equal(row.revision, '2')
        assert.equal(row.exposure_json.amount_vnd, '12345678901234567890')
        assert.equal(
          (await owner.query('SELECT * FROM aic.idempotency_keys WHERE key=$1', [failedKey]))
            .rowCount,
          0,
        )
        assert.equal(
          (await owner.query('SELECT * FROM aic.audit_events WHERE case_id=$1', [ids.caseA]))
            .rowCount,
          1,
        )
      },
    )
    await t.test(
      'concurrent same scoped key yields one mutation and original response',
      async () => {
        const concurrentKey = randomUUID(),
          input = { key: concurrentKey, expectedRevision: 2, payload: { expected_revision: 2 } }
        const result = await Promise.all([execute(input), execute(input)])
        assert.deepEqual(result.map((x) => x.replayed).sort(), [false, true])
        assert.deepEqual(result[0].body, result[1].body)
        assert.equal(
          (await owner.query('SELECT revision FROM aic.cases WHERE id=$1', [ids.caseA])).rows[0]
            .revision,
          '3',
        )
      },
    )
    await t.test('current ACL and revocation checked before cached replay', async () => {
      await owner.query('DELETE FROM aic.case_memberships WHERE case_id=$1 AND user_id=$2', [
        ids.caseA,
        ids.alice,
      ])
      await assert.rejects(execute(), (e) => e.getStatus() === 404)
      await owner.query(
        'INSERT INTO aic.case_memberships(organization_id,case_id,user_id,granted_by) VALUES($1,$2,$3,$3)',
        [ids.orgA, ids.caseA, ids.alice],
      )
      await owner.query('UPDATE aic.sessions SET revoked_at=now() WHERE id=$1', [auth.id])
      await assert.rejects(execute(), (e) => e.getStatus() === 401)
      a = await login('alice')
      aCookie = cookie(a)
      auth = await sessions.resolve(aCookie.split('=')[1])
    })
    await t.test(
      'history is persisted audit under ACL; runtime cannot edit/delete audit',
      async () => {
        const r = await request('/cases/' + ids.caseA + '/history', {
          headers: { cookie: aCookie },
        })
        assert.equal(r.status, 200)
        assert.equal(r.body.items.length, 2)
        validateContract('HistoryEventPage', r.body)
        await assert.rejects(db.query('DELETE FROM aic.audit_events'), (e) => e.code === '42501')
        await assert.rejects(
          owner.query('UPDATE aic.audit_events SET reason=reason'),
          (e) => e.code === '55000',
        )
      },
    )
    await t.test('absolute expiry, idle expiry and account disable enforce actual401', async () => {
      for (const sql of [
        "expires_at=now()-interval '1 second'",
        "last_seen_at=now()-interval '31 minutes'",
      ]) {
        const r = await login('anna'),
          c = cookie(r)
        await owner.query('UPDATE aic.sessions SET ' + sql + ' WHERE token_hash=$1', [
          createHash('sha256').update(c.split('=')[1]).digest('hex'),
        ])
        assert.equal((await request('/auth/me', { headers: { cookie: c } })).status, 401)
      }
      const r = await login('anna')
      await owner.query('UPDATE aic.users SET disabled_at=now() WHERE id=$1', [ids.anna])
      assert.equal((await request('/auth/me', { headers: { cookie: cookie(r) } })).status, 401)
      await owner.query('UPDATE aic.users SET disabled_at=NULL WHERE id=$1', [ids.anna])
    })
    await t.test(
      'active logout rejects missing/wrong CSRF and foreign Origin; revoked logout204',
      async () => {
        for (const csrf of [undefined, 'wrong']) {
          const r = await request('/auth/logout', {
            method: 'POST',
            headers: { origin, cookie: aCookie, ...(csrf ? { 'x-csrf-token': csrf } : {}) },
          })
          assert.equal(r.status, 403)
        }
        assert.equal(
          (
            await request('/auth/logout', {
              method: 'POST',
              headers: {
                origin: 'https://foreign.invalid',
                cookie: aCookie,
                'x-csrf-token': a.body.csrf_token,
              },
            })
          ).status,
          403,
        )
        assert.equal(
          (
            await request('/auth/logout', {
              method: 'POST',
              headers: { origin, cookie: aCookie, 'x-csrf-token': a.body.csrf_token },
            })
          ).status,
          204,
        )
        assert.equal((await request('/auth/me', { headers: { cookie: aCookie } })).status, 401)
        assert.equal(
          (await request('/auth/logout', { method: 'POST', headers: { origin, cookie: aCookie } }))
            .status,
          204,
        )
        assert.equal(
          (await request('/auth/logout', { method: 'POST', headers: { origin } })).status,
          204,
        )
        a = await login('alice')
        aCookie = cookie(a)
      },
    )
    await t.test(
      'five failed account/IP attempts persist, then15min block; other IP separate',
      async () => {
        for (let i = 0; i < 5; i++)
          assert.equal((await login('throttle-unknown', 'wrong')).status, 401)
        const limited = await login('throttle-unknown', 'wrong')
        assert.equal(limited.status, 429)
        const { loginBucketHash } = require('../dist/auth')
        const row = (
          await owner.query('SELECT * FROM aic.login_attempts WHERE bucket_hash=$1', [
            loginBucketHash('throttle-unknown', '127.0.0.1'),
          ])
        ).rows[0]
        assert.equal(row.attempts, 5)
        assert.ok(row.blocked_until > Date.now())
        assert.ok(row.blocked_until.getTime() - Date.now() > 14 * 60 * 1000)
        await assert.rejects(
          sessions.login('throttle-unknown', 'wrong', '198.51.100.1'),
          (e) => e.getStatus() === 401,
        )
        await owner.query(
          "UPDATE aic.login_attempts SET blocked_until=now()-interval '1 second',window_started_at=now()-interval '16 minutes' WHERE bucket_hash=$1",
          [loginBucketHash('throttle-unknown', '127.0.0.1')],
        )
        assert.equal((await login('throttle-unknown', 'wrong')).status, 401)
      },
    )
    await t.test(
      'active access refreshes idle activity without extending absolute expiry',
      async () => {
        const token = aCookie.split('=')[1],
          hash = createHash('sha256').update(token).digest('hex')
        await owner.query(
          "UPDATE aic.sessions SET last_seen_at=now()-interval '10 minutes' WHERE token_hash=$1",
          [hash],
        )
        const before = (
          await owner.query(
            'SELECT expires_at,last_seen_at FROM aic.sessions WHERE token_hash=$1',
            [hash],
          )
        ).rows[0]
        assert.equal((await request('/auth/me', { headers: { cookie: aCookie } })).status, 200)
        const after = (
          await owner.query(
            'SELECT expires_at,last_seen_at FROM aic.sessions WHERE token_hash=$1',
            [hash],
          )
        ).rows[0]
        assert.equal(after.expires_at.getTime(), before.expires_at.getTime())
        assert.ok(after.last_seen_at > before.last_seen_at)
      },
    )
    await t.test('unreleased business writes/document/AI/scoring routes stay closed', async () => {
      const blocked = await request('/cases', {
        method: 'POST',
        headers: {
          origin,
          cookie: aCookie,
          'x-csrf-token': a.body.csrf_token,
          'content-type': 'application/json',
        },
        body: '{}',
      })
      assert.equal(blocked.status, 410)
      assert.equal(blocked.body.code, 'TRANSACTION_FEATURE_RETIRED')
      for (const route of [
        '/counterparties',
        '/cases/' + ids.caseA + '/documents',
        '/cases/' + ids.caseA + '/assessments',
        '/cases/' + ids.caseA + '/review-runs',
      ]) {
        const r = await request(route, {
          method: 'POST',
          headers: {
            origin,
            cookie: aCookie,
            'x-csrf-token': a.body.csrf_token,
            'content-type': 'application/json',
          },
          body: '{}',
        })
        assert.ok([404, 503].includes(r.status))
      }
    })
    await t.test('PostgreSQL data + sessions survive actual API process restart', async () => {
      const port = await new Promise((resolve) => {
        const s = net.createServer().listen(0, '127.0.0.1', () => {
          const p = s.address().port
          s.close(() => resolve(p))
        })
      })
      async function start() {
        const child = spawn(process.execPath, [path.resolve(__dirname, '../dist/main.js')], {
          env: { ...process.env, PORT: String(port) },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
        await new Promise((resolve, reject) => {
          let output = ''
          const timeout = setTimeout(() => {
            child.kill()
            reject(Error('API startup timeout'))
          }, 15000)
          child.stdout.on('data', (b) => {
            output += b.toString()
            if (output.includes('listening on loopback:')) {
              clearTimeout(timeout)
              resolve()
            }
          })
          child.once('exit', () => {
            clearTimeout(timeout)
            reject(Error('API exited before ready'))
          })
        })
        return child
      }
      for (let i = 0; i < 2; i++) {
        const child = await start()
        try {
          const r = await fetch('http://127.0.0.1:' + port + '/api/v2/cases/' + ids.caseA, {
            headers: { cookie: aCookie },
          })
          assert.equal(r.status, 200)
          assert.equal((await r.json()).revision, 3)
          const me = await fetch('http://127.0.0.1:' + port + '/api/v2/auth/me', {
            headers: { cookie: aCookie },
          })
          assert.equal(me.status, 200)
        } finally {
          child.kill()
          await new Promise((resolve) => child.once('exit', resolve))
        }
      }
    })
    await t.test(
      'production config requires HTTPS, forbids prototype and sets secure cookies',
      async () => {
        const previous = { ...process.env }
        try {
          process.env.NODE_ENV = 'production'
          process.env.INTERNAL_API_KEY = 'SYNTHETIC-production-config-test-only'
          process.env.AIC_IDEMPOTENCY_TTL_MS = '86400000'
          process.env.AIC_FRONTEND_ORIGIN = 'https://aic.example'
          assert.equal(loadConfig().secureCookies, true)
          process.env.AIC_RUNTIME_MODE = 'prototype'
          process.env.AIC_ENABLE_PROTOTYPE = 'true'
          assert.throws(() => loadConfig(), /Prototype/)
          process.env.AIC_RUNTIME_MODE = 'foundation'
          process.env.AIC_FRONTEND_ORIGIN = 'http://aic.example'
          assert.throws(() => loadConfig(), /HTTPS/)
        } finally {
          for (const key of Object.keys(process.env))
            if (!(key in previous)) delete process.env[key]
          Object.assign(process.env, previous)
        }
      },
    )
    await t.test(
      'Secure/HttpOnly/SameSite cookie flags are actually emitted with production transport config',
      async () => {
        const secure = await createApplication(
          {
            ...config,
            isProduction: true,
            secureCookies: true,
            frontendOrigin: 'https://aic.example',
            allowedOrigins: ['https://aic.example'],
          },
          true,
        )
        try {
          await secure.listen(0, '127.0.0.1')
          const r = await fetch((await secure.getUrl()) + '/api/v2/auth/login', {
            method: 'POST',
            headers: { origin: 'https://aic.example', 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'alice', password }),
          })
          assert.equal(r.status, 200)
          assert.match(r.headers.get('set-cookie'), /; Secure/)
          assert.match(r.headers.get('set-cookie'), /HttpOnly/)
          assert.match(r.headers.get('set-cookie'), /SameSite=Lax/)
        } finally {
          await secure.close()
        }
      },
    )
    await t.test(
      'same key is isolated by case, actor and operation, not a global replay Map',
      async () => {
        const ownSession = await sessions.resolve(aCookie.split('=')[1]),
          scopeInput = {
            operation,
            key,
            expectedRevision: 1,
            payload,
            work: async (_tx, current, next) => ({
              status: 200,
              body: { id: current.id, revision: next },
              action: 'foundation.scope.test',
            }),
          }
        const differentCase = await mutations.execute(ownSession, ids.caseA3, scopeInput)
        assert.equal(differentCase.replayed, false)
        assert.equal(differentCase.body.id, ids.caseA3)
        await assert.rejects(
          mutations.execute(ownSession, ids.caseA3, {
            ...scopeInput,
            operation: operation + '/different',
          }),
          (e) => e.getResponse().code === 'REVISION_CONFLICT',
        )
        await owner.query(
          'INSERT INTO aic.case_memberships(organization_id,case_id,user_id,granted_by) VALUES($1,$2,$3,$4)',
          [ids.orgA, ids.caseA3, ids.anna, ids.alice],
        )
        const anna = await login('anna'),
          annaSession = await sessions.resolve(cookie(anna).split('=')[1])
        await assert.rejects(
          mutations.execute(annaSession, ids.caseA3, scopeInput),
          (e) => e.getResponse().code === 'REVISION_CONFLICT',
        )
      },
    )
    await t.test(
      'absolute/idle expiry during a real PostgreSQL lock wait prevents both replay and fresh work',
      async () => {
        for (const expiration of ['absolute', 'idle'])
          for (const replay of [true, false]) {
            const r = await login('alice'),
              short = await sessions.resolve(cookie(r).split('=')[1])
            await owner.query(
              expiration === 'absolute'
                ? "UPDATE aic.sessions SET expires_at=clock_timestamp()+interval '200 milliseconds' WHERE id=$1"
                : "UPDATE aic.sessions SET last_seen_at=clock_timestamp()-interval '30 minutes'+interval '200 milliseconds' WHERE id=$1",
              [short.id],
            )
            let called = false
            await owner.query('BEGIN')
            await owner.query('SELECT id FROM aic.cases WHERE id=$1 FOR UPDATE', [ids.caseA])
            const pending = mutations
              .execute(short, ids.caseA, {
                operation,
                key: replay ? key : randomUUID(),
                expectedRevision: replay ? 1 : 3,
                payload: replay ? payload : { expected_revision: 3 },
                work: async () => {
                  called = true
                  return { status: 200, body: {}, action: 'must.not.run' }
                },
              })
              .then(
                (value) => ({ value }),
                (error) => ({ error }),
              )
            try {
              let waiting = false
              for (let i = 0; i < 30; i++) {
                const q = await admin.query(
                  "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",
                  [dbName],
                )
                if (q.rows[0].n) {
                  waiting = true
                  break
                }
                await new Promise((resolve) => setTimeout(resolve, 5))
              }
              assert.equal(waiting, true)
              await new Promise((resolve) => setTimeout(resolve, 250))
            } finally {
              await owner.query('ROLLBACK')
            }
            const result = await pending
            assert.equal(result.error?.getStatus(), 401)
            assert.equal(result.error?.getResponse().code, 'SESSION_EXPIRED')
            assert.equal(called, false)
            assert.equal(
              (await owner.query('SELECT revision FROM aic.cases WHERE id=$1', [ids.caseA])).rows[0]
                .revision,
              '3',
            )
          }
      },
    )
    process.stdout.write(
      'Actual PostgreSQL18 foundation checks completed; disposable DB ' +
        dbName +
        ' retained in isolated cluster.\n',
    )
  } finally {
    if (app) await app.close()
    await owner.end()
    await admin.end()
  }
})
