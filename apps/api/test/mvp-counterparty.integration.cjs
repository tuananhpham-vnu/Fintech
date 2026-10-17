const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const { Client } = require('pg')
const { migrate } = require('../dist/database/migrate')
const { DatabaseService } = require('../dist/database/database.service')
const { SessionService, hashPassword } = require('../dist/auth')
const { CoreRepository } = require('../dist/foundation/core.repository')
const { MvpCounterpartyService } = require('../dist/foundation/mvp-counterparty.service')
const { CounterpartiesController } = require('../dist/controllers/counterparties.controller')
const { canonicalJson } = require('../dist/foundation/canonical')

const input = (overrides = {}) => ({
  name: 'SYNTHETIC reported company',
  country: 'VN',
  tax_id: '0000123456',
  industry_code: '0010',
  source: {
    kind: 'declaration',
    reported_by: 'counterparty',
    reported_reference: 'Staff call 17 October',
    statement: 'Counterparty reported these attributes; representation has not been verified.',
  },
  reason: 'Record reported information for specialist review',
  ...overrides,
})
async function reject(promise, status, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.getStatus(), status)
    if (code) assert.equal(error.getResponse().code, code)
    return true
  })
}

// Starts no app/HTTP/AI server. The existing launcher supplies a fresh private PG cluster.
test('MVP counterparty: actual PostgreSQL, sessions, restricted grants and immutable provenance', async (t) => {
  const supplied = process.env.AIC_TEST_DATABASE_URL
  assert.ok(supplied, 'Use scripts/test-local-postgres.cjs; no database/auth mocks')
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(supplied).hostname))
  assert.equal(process.env.AIC_ALLOW_LOCAL_DB_TESTS, 'true')
  const suffix = randomBytes(6).toString('hex'),
    databaseName = `aic_cp_test_${suffix}`,
    role = `aic_cp_runtime_${suffix}`,
    runtimePassword = randomBytes(32).toString('hex')
  const admin = new Client({ connectionString: supplied })
  await admin.connect()
  let owner, db
  try {
    await admin.query(`CREATE DATABASE ${databaseName}`)
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
    )
    const ownerURL = new URL(supplied)
    ownerURL.pathname = `/${databaseName}`
    await migrate(ownerURL.href)
    owner = new Client({ connectionString: ownerURL.href })
    await owner.connect()
    assert.ok(
      (await owner.query("SELECT to_regclass('aic.mvp_counterparty_versions') AS name")).rows[0]
        .name,
      'Lead-owned migration0011 must be published; never synthesize a substitute table',
    )
    await owner.query(`GRANT USAGE ON SCHEMA aic TO ${role}`)
    await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA aic TO ${role}`)
    await owner.query(`GRANT INSERT,UPDATE ON aic.sessions,aic.login_attempts TO ${role}`)
    await owner.query(`GRANT INSERT ON aic.idempotency_keys TO ${role}`)
    await owner.query(
      `GRANT INSERT ON aic.counterparties,aic.mvp_counterparty_versions,aic.audit_events TO ${role}`,
    )
    await owner.query(
      `GRANT UPDATE(name,country,tax_id,industry_code,source_refs,identity_status,revision,updated_at) ON aic.counterparties TO ${role}`,
    )
    await owner.query(
      `GRANT EXECUTE ON FUNCTION aic.lock_login_user(text),aic.lock_active_session(uuid,uuid,uuid,bigint) TO ${role}`,
    )
    const runtimeURL = new URL(ownerURL)
    runtimeURL.username = role
    runtimeURL.password = runtimePassword
    const config = {
      databaseUrl: runtimeURL.href,
      frontendOrigin: 'http://127.0.0.1',
      allowedOrigins: ['http://127.0.0.1'],
      cookieName: 'synthetic_counterparty',
      secureCookies: false,
      isProduction: false,
      sessionTtlMs: 8 * 3600000,
      sessionIdleMs: 30 * 60000,
      loginMaxAttempts: 5,
      loginWindowMs: 15 * 60000,
      loginBlockMs: 15 * 60000,
      idempotencyTtlMs: 24 * 3600000,
    }
    db = new DatabaseService(config)
    await db.onModuleInit()
    const service = new MvpCounterpartyService(db, config),
      core = new CoreRepository(db),
      auth = new SessionService(db, config),
      controller = new CounterpartiesController(core, service)
    const password = `SYNTHETIC-${randomUUID()}`,
      encoded = await hashPassword(password)
    async function tenant(org = randomUUID()) {
      const actor = randomUUID(),
        username = randomUUID()
      await owner.query(
        "INSERT INTO aic.organizations(id,name) VALUES($1,'SYNTHETIC tenant') ON CONFLICT DO NOTHING",
        [org],
      )
      await owner.query(
        `INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role)
        VALUES($1,$2,$3,$4,'SYNTHETIC specialist','specialist')`,
        [actor, org, username, encoded],
      )
      const login = await auth.login(username, password, '127.0.0.1')
      const session = await auth.resolve(login.token)
      assert.ok(session)
      return { org, actor, session, token: login.token }
    }
    const alice = await tenant(),
      bob = await tenant(),
      colleague = await tenant(alice.org)
    const create = (who = alice, body = input({ tax_id: null }), key = randomUUID()) =>
      service.create(who.session, key, body)
    const update = (id, revision, overrides = {}, who = alice, key = randomUUID()) =>
      service.update(who.session, id, key, {
        ...input({ tax_id: null }),
        ...overrides,
        expected_revision: revision,
      })
    const current = async (id) =>
      (await owner.query('SELECT * FROM aic.counterparties WHERE id=$1', [id])).rows[0]
    const version = async (id, revision) =>
      (
        await owner.query(
          'SELECT * FROM aic.mvp_counterparty_versions WHERE counterparty_id=$1 AND revision=$2',
          [id, revision],
        )
      ).rows[0]
    async function counts() {
      const result = {}
      for (const table of [
        'counterparties',
        'mvp_counterparty_versions',
        'audit_events',
        'idempotency_keys',
        'case_memberships',
        'cases',
      ])
        result[table] = (await owner.query(`SELECT count(*)::int AS n FROM aic.${table}`)).rows[0].n
      return result
    }
    async function waitForLock(fragment) {
      for (let n = 0; n < 200; n++) {
        const found = await admin.query(
          `SELECT 1 FROM pg_stat_activity WHERE datname=$1
          AND wait_event_type='Lock' AND query LIKE $2`,
          [databaseName, `%${fragment}%`],
        )
        if (found.rowCount) return
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      assert.fail(`Expected lock wait: ${fragment}`)
    }
    async function advisory(who, operation, key, start, whileWaiting = async () => {}) {
      let pending
      await owner.query('BEGIN')
      try {
        await owner.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          canonicalJson([who.org, who.actor, operation, key]),
        ])
        pending = start().then(
          (value) => ({ value }),
          (error) => ({ error }),
        )
        await waitForLock('pg_advisory_xact_lock')
        await whileWaiting()
      } finally {
        await owner.query('ROLLBACK')
      }
      return pending
    }

    let first, firstKey, firstBody
    await t.test(
      'create through controller persists server IDs, text identifiers, staff declaration and null-case audit',
      async () => {
        firstKey = randomUUID()
        firstBody = input()
        first = await controller.create(
          { session: alice.session, user: alice.session.user },
          firstKey,
          firstBody,
        )
        assert.equal(first.organization_id, alice.org)
        assert.equal(first.revision, 1)
        assert.equal(first.identity_status, 'unresolved')
        assert.equal(first.tax_id, '0000123456')
        assert.equal(first.industry_code, '0010')
        assert.equal(first.source_refs.length, 1)
        const saved = await version(first.id, 1)
        assert.equal(saved.id, first.source_refs[0])
        assert.equal(saved.actor_id, alice.actor)
        assert.equal(saved.reason, firstBody.reason)
        assert.deepEqual(saved.payload_json, first)
        assert.deepEqual(saved.source_json, {
          ...firstBody.source,
          id: saved.id,
          organization_id: alice.org,
          counterparty_id: first.id,
          source_revision: 1,
          origin: 'staff_transcribed',
          entered_by: alice.actor,
          actor_id: alice.actor,
          recorded_at: saved.created_at.toISOString(),
          verification: 'unverified',
        })
        const audit = (
          await owner.query('SELECT * FROM aic.audit_events WHERE subject_id=$1', [first.id])
        ).rows[0]
        assert.equal(audit.case_id, null)
        assert.equal(audit.action, 'counterparty.created')
        assert.equal(audit.revision_before, null)
        assert.equal(audit.revision_after, '1')
        assert.equal(audit.reason, firstBody.reason)
        assert.deepEqual(await core.counterparty(alice.session.user, first.id), first)
        assert.ok(
          (await core.counterparties(alice.session.user, {})).items.some(
            (row) => row.id === first.id,
          ),
        )
        const replay = (
          await owner.query('SELECT * FROM aic.idempotency_keys WHERE key=$1', [firstKey])
        ).rows[0]
        assert.ok(replay.expires_at - replay.created_at >= 24 * 3600000 - 1000)
        assert.ok(replay.expires_at - replay.created_at < 24 * 3600000 + 1000)
      },
    )
    await t.test(
      'strict input rejects server metadata, arbitrary sources, whitespace, bounds and invalid revisions atomically',
      async () => {
        const bad = [
          null,
          {},
          input({ name: ' ' }),
          input({ country: '' }),
          input({ reason: ' ' }),
          input({ name: 'x'.repeat(251) }),
          input({ country: 'x'.repeat(101) }),
          input({ tax_id: 123 }),
          input({ tax_id: 'x'.repeat(101) }),
          input({ industry_code: 'x'.repeat(51) }),
          input({ reason: 'x'.repeat(4001) }),
          input({ source_refs: ['foreign-document'] }),
          input({ identity_status: 'confirmed' }),
          input({ organization_id: bob.org }),
          input({ actor_id: bob.actor }),
          input({ id: randomUUID() }),
          input({ revision: 1 }),
        ]
        for (const change of [
          { kind: 'document' },
          { reported_by: 'staff' },
          { reported_reference: ' ' },
          { statement: '' },
          { statement: 'x'.repeat(4001) },
          { reported_reference: 'x'.repeat(501) },
          { source_id: randomUUID() },
          { verification: 'verified' },
          { entered_by: bob.actor },
        ])
          bad.push(input({ source: { ...input().source, ...change } }))
        const before = await counts()
        for (const body of bad)
          await reject(service.create(alice.session, randomUUID(), body), 422, 'INVALID_INPUT')
        for (const revision of [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1])
          await reject(
            service.update(alice.session, first.id, randomUUID(), {
              ...input(),
              expected_revision: revision,
            }),
            422,
          )
        for (const key of ['', 'x'.repeat(201), 'bad key', undefined])
          await reject(service.create(alice.session, key, input()), 422)
        assert.deepEqual(await counts(), before)
      },
    )
    await t.test(
      'attribute and source-only edits reset confirmed identity, append versions and keep history',
      async () => {
        await owner.query("UPDATE aic.counterparties SET identity_status='confirmed' WHERE id=$1", [
          first.id,
        ])
        const old = await version(first.id, 1)
        const changed = await controller.update(
          { session: alice.session, user: alice.session.user },
          first.id,
          randomUUID(),
          {
            ...firstBody,
            name: 'Updated reported company',
            expected_revision: 1,
          },
        )
        assert.equal(changed.identity_status, 'unresolved')
        assert.equal(changed.revision, 2)
        assert.equal(changed.created_at, first.created_at)
        assert.notDeepEqual(changed.source_refs, first.source_refs)
        await owner.query("UPDATE aic.counterparties SET identity_status='confirmed' WHERE id=$1", [
          first.id,
        ])
        const sourceOnly = await service.update(alice.session, first.id, randomUUID(), {
          ...firstBody,
          name: changed.name,
          source: { ...firstBody.source, statement: 'New reported source' },
          expected_revision: 2,
        })
        assert.equal(sourceOnly.body.identity_status, 'unresolved')
        assert.equal(sourceOnly.body.revision, 3)
        assert.deepEqual(await version(first.id, 1), old)
        const audit = (
          await owner.query(
            "SELECT * FROM aic.audit_events WHERE subject_id=$1 AND action='counterparty.updated' ORDER BY revision_after",
            [first.id],
          )
        ).rows
        assert.deepEqual(
          audit.map((row) => [row.case_id, row.revision_before, row.revision_after]),
          [
            [null, '1', '2'],
            [null, '2', '3'],
          ],
        )
      },
    )
    await t.test(
      'create replay freezes old body without reverting current data or extending retention',
      async () => {
        const before = await counts(),
          row = await current(first.id)
        const prior = (
          await owner.query('SELECT * FROM aic.idempotency_keys WHERE key=$1', [firstKey])
        ).rows[0]
        const replay = await service.create(alice.session, firstKey, firstBody)
        assert.equal(replay.status, 201)
        assert.equal(replay.replayed, true)
        assert.deepEqual(replay.body, first)
        assert.deepEqual(await current(first.id), row)
        assert.deepEqual(
          (await owner.query('SELECT * FROM aic.idempotency_keys WHERE key=$1', [firstKey]))
            .rows[0],
          prior,
        )
        await reject(
          service.create(alice.session, firstKey, {
            ...firstBody,
            reason: 'changed',
          }),
          409,
          'IDEMPOTENCY_CONFLICT',
        )
        assert.deepEqual(await counts(), before)
      },
    )
    await t.test(
      'update replay is exact, target-bound, does not require old revision to remain current',
      async () => {
        const key = randomUUID(),
          body = { ...input({ tax_id: null }), expected_revision: 3 }
        const changed = await service.update(alice.session, first.id, key, body)
        await update(first.id, 4, { name: 'Later record' })
        const replay = await service.update(alice.session, first.id, key, body)
        assert.equal(replay.replayed, true)
        assert.deepEqual(replay.body, changed.body)
        const other = await create()
        await reject(
          service.update(alice.session, other.body.id, key, body),
          409,
          'IDEMPOTENCY_CONFLICT',
        )
        await reject(
          service.update(alice.session, first.id, key, {
            ...body,
            expected_revision: 5,
          }),
          409,
          'IDEMPOTENCY_CONFLICT',
        )
      },
    )
    await t.test('expired idempotency key remains reserved and unchanged', async () => {
      const key = randomUUID(),
        body = input({ tax_id: null })
      await service.create(alice.session, key, body)
      await owner.query(
        "UPDATE aic.idempotency_keys SET expires_at=clock_timestamp()-interval '1 second' WHERE key=$1",
        [key],
      )
      const prior = (await owner.query('SELECT * FROM aic.idempotency_keys WHERE key=$1', [key]))
          .rows[0],
        before = await counts()
      await reject(service.create(alice.session, key, body), 409, 'IDEMPOTENCY_CONFLICT')
      assert.deepEqual(
        (await owner.query('SELECT * FROM aic.idempotency_keys WHERE key=$1', [key])).rows[0],
        prior,
      )
      assert.deepEqual(await counts(), before)
    })
    await t.test('same key is separately scoped to organization, actor and operation', async () => {
      const key = randomUUID(),
        body = input({ tax_id: null })
      const a = await create(alice, body, key),
        b = await create(bob, body, key),
        c = await create(colleague, body, key)
      assert.equal(new Set([a.body.id, b.body.id, c.body.id]).size, 3)
      assert.equal((await update(a.body.id, 1, {}, alice, key)).replayed, false)
    })
    await t.test(
      'foreign organization and forged principal cannot read, update or replay; current org specialist can edit',
      async () => {
        const before = await counts(),
          row = await current(first.id)
        await reject(core.counterparty(bob.session.user, first.id), 404, 'NOT_FOUND')
        await reject(update(first.id, 5, {}, bob), 404, 'NOT_FOUND')
        await reject(
          service.create(
            {
              ...alice.session,
              user: { ...alice.session.user, organization_id: bob.org },
            },
            firstKey,
            firstBody,
          ),
          401,
        )
        await reject(
          service.create(
            {
              ...alice.session,
              user: { ...alice.session.user, id: colleague.actor },
            },
            firstKey,
            firstBody,
          ),
          401,
        )
        assert.deepEqual(await counts(), before)
        assert.deepEqual(await current(first.id), row)
        assert.equal((await update(first.id, 5, {}, colleague)).body.revision, 6)
      },
    )
    await t.test(
      'duplicate tax identity produces409 and rolls back update/create intent',
      async () => {
        const uniqueTax = randomUUID(),
          existing = await create(alice, input({ tax_id: uniqueTax }))
        const other = await create(),
          before = await counts(),
          row = await current(other.body.id)
        await reject(
          create(alice, input({ tax_id: uniqueTax })),
          409,
          'COUNTERPARTY_TAX_ID_CONFLICT',
        )
        await reject(
          update(other.body.id, 1, { tax_id: uniqueTax }),
          409,
          'COUNTERPARTY_TAX_ID_CONFLICT',
        )
        assert.deepEqual(await counts(), before)
        assert.deepEqual(await current(other.body.id), row)
        assert.equal((await current(existing.body.id)).revision, '1')
      },
    )
    await t.test(
      'concurrent same-key create/update publish once; competing revisions yield one409',
      async () => {
        const key = randomUUID(),
          body = input({ tax_id: null }),
          before = await counts()
        const results = await Promise.all([create(alice, body, key), create(alice, body, key)])
        assert.deepEqual(results.map((row) => row.replayed).sort(), [false, true])
        assert.equal(results[0].body.id, results[1].body.id)
        assert.equal(
          (await counts()).mvp_counterparty_versions,
          before.mvp_counterparty_versions + 1,
        )
        const id = results[0].body.id,
          updateKey = randomUUID()
        const same = await Promise.all([
          update(id, 1, {}, alice, updateKey),
          update(id, 1, {}, alice, updateKey),
        ])
        assert.deepEqual(same.map((row) => row.replayed).sort(), [false, true])
        const competing = await Promise.allSettled([
          update(id, 2, { name: 'One' }),
          update(id, 2, { name: 'Two' }, colleague),
        ])
        assert.equal(competing.filter((row) => row.status === 'fulfilled').length, 1)
        const error = competing.find((row) => row.status === 'rejected').reason
        assert.equal(error.getStatus(), 409)
        assert.equal(error.getResponse().code, 'REVISION_CONFLICT')
        assert.equal((await current(id)).revision, '3')
      },
    )
    await t.test(
      'waiting input and principal are snapshots, including nested declaration',
      async () => {
        const who = await tenant(),
          session = structuredClone(who.session),
          key = randomUUID(),
          body = input({ tax_id: null })
        const expected = structuredClone(body)
        const result = await advisory(
          who,
          'counterparty.create',
          key,
          () => service.create(session, key, body),
          async () => {
            body.name = 'MUTATED'
            body.source.statement = 'MUTATED'
            body.source.reported_by = 'organization'
            session.user.id = bob.actor
            session.user.organization_id = bob.org
          },
        )
        assert.ok(result.value)
        assert.equal(result.value.body.name, expected.name)
        const saved = await version(result.value.body.id, 1)
        assert.equal(saved.source_json.statement, expected.source.statement)
        assert.equal(saved.source_json.reported_by, expected.source.reported_by)
        assert.equal(saved.actor_id, who.actor)
        assert.equal(saved.organization_id, who.org)
      },
    )
    await t.test(
      'session expiry during advisory wait blocks fresh mutation and frozen replay',
      async () => {
        for (const replay of [false, true]) {
          const who = await tenant(),
            key = randomUUID(),
            body = input({ tax_id: null })
          if (replay) await create(who, body, key)
          const before = await counts()
          await owner.query(
            "UPDATE aic.sessions SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE id=$1",
            [who.session.id],
          )
          const result = await advisory(
            who,
            'counterparty.create',
            key,
            () => service.create(who.session, key, body),
            () => owner.query('SELECT pg_sleep(0.35)'),
          )
          assert.equal(result.error?.getStatus(), 401)
          assert.deepEqual(await counts(), before)
        }
      },
    )
    await t.test(
      'session expiry during counterparty row wait is rechecked before mutation',
      async () => {
        const who = await tenant(),
          item = await create(who),
          before = await counts()
        await owner.query(
          "UPDATE aic.sessions SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE id=$1",
          [who.session.id],
        )
        let pending
        await owner.query('BEGIN')
        try {
          await owner.query('SELECT id FROM aic.counterparties WHERE id=$1 FOR UPDATE', [
            item.body.id,
          ])
          pending = update(item.body.id, 1, {}, who).then(
            (value) => ({ value }),
            (error) => ({ error }),
          )
          await waitForLock('FOR UPDATE OF c')
          await owner.query('SELECT pg_sleep(0.35)')
        } finally {
          await owner.query('ROLLBACK')
        }
        assert.equal((await pending).error?.getStatus(), 401)
        assert.equal((await current(item.body.id)).revision, '1')
        assert.deepEqual(await counts(), before)
      },
    )
    await t.test(
      'revoked/disabled/idle/expired auth rejects replay before returning saved body',
      async () => {
        for (const state of ['revoked', 'disabled', 'idle', 'expired']) {
          const who = await tenant(),
            key = randomUUID(),
            body = input({ tax_id: null })
          await create(who, body, key)
          if (state === 'disabled')
            await owner.query('UPDATE aic.users SET disabled_at=clock_timestamp() WHERE id=$1', [
              who.actor,
            ])
          else
            await owner.query(
              `UPDATE aic.sessions SET ${
                state === 'revoked'
                  ? 'revoked_at=clock_timestamp()'
                  : state === 'idle'
                    ? "last_seen_at=clock_timestamp()-interval '31 minutes'"
                    : "expires_at=clock_timestamp()-interval '1 second'"
              } WHERE id=$1`,
              [who.session.id],
            )
          const before = await counts()
          assert.equal(await auth.resolve(who.token), null)
          await reject(service.create(who.session, key, body), 401, 'SESSION_EXPIRED')
          assert.deepEqual(await counts(), before)
        }
      },
    )
    await t.test('disable committed while initial session lock waits is rechecked', async () => {
      const who = await tenant(),
        before = await counts()
      let pending
      await owner.query('BEGIN')
      try {
        await owner.query('UPDATE aic.users SET disabled_at=clock_timestamp() WHERE id=$1', [
          who.actor,
        ])
        pending = create(who).then(
          (value) => ({ value }),
          (error) => ({ error }),
        )
        await waitForLock('lock_active_session')
        await owner.query('COMMIT')
      } finally {
        await owner.query('ROLLBACK')
      }
      assert.equal((await pending).error?.getStatus(), 401)
      assert.deepEqual(await counts(), before)
    })
    await t.test(
      'real database audit failure atomically rolls back counterparty/version/replay; same key retries',
      async () => {
        const existing = await create(),
          row = await current(existing.body.id)
        for (const editing of [false, true]) {
          const before = await counts(),
            key = randomUUID(),
            body = input({ tax_id: null })
          await owner.query(`CREATE FUNCTION aic.synthetic_cp_failure() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='SYNTHETIC audit fault'; END; $$`)
          try {
            await owner.query(
              'CREATE TRIGGER synthetic_cp_fault BEFORE INSERT ON aic.audit_events FOR EACH ROW EXECUTE FUNCTION aic.synthetic_cp_failure()',
            )
            await assert.rejects(
              editing ? update(existing.body.id, 1, {}, alice, key) : create(alice, body, key),
              (error) => error.code === 'P0001',
            )
            assert.deepEqual(await counts(), before)
            assert.deepEqual(await current(existing.body.id), row)
          } finally {
            await owner.query('DROP TRIGGER IF EXISTS synthetic_cp_fault ON aic.audit_events')
            await owner.query('DROP FUNCTION aic.synthetic_cp_failure()')
          }
          assert.equal(
            (
              await (editing
                ? update(existing.body.id, 1, {}, alice, key)
                : create(alice, body, key))
            ).replayed,
            false,
          )
        }
      },
    )
    await t.test(
      'tenant FKs, append-only versions and least privilege enforce database boundary',
      async () => {
        const saved = await version(first.id, 1)
        await assert.rejects(
          owner.query(
            `INSERT INTO aic.mvp_counterparty_versions
        (id,organization_id,counterparty_id,revision,source_json,payload_json,actor_id,reason)
        VALUES($1,$2,$3,999,'{}','{}',$4,'synthetic wrong tenant')`,
            [randomUUID(), bob.org, first.id, bob.actor],
          ),
          (error) => error.code === '23503',
        )
        await assert.rejects(
          owner.query(
            `INSERT INTO aic.mvp_counterparty_versions
        (id,organization_id,counterparty_id,revision,source_json,payload_json,actor_id,reason)
        VALUES($1,$2,$3,999,'{}','{}',$4,'synthetic wrong actor')`,
            [randomUUID(), alice.org, first.id, bob.actor],
          ),
          (error) => error.code === '23503',
        )
        for (const sql of [
          'UPDATE aic.mvp_counterparty_versions SET reason=reason',
          'DELETE FROM aic.mvp_counterparty_versions',
        ])
          await assert.rejects(owner.query(sql), (error) => error.code === '55000')
        for (const sql of [
          'UPDATE aic.counterparties SET organization_id=organization_id',
          'UPDATE aic.counterparties SET id=id',
          'UPDATE aic.counterparties SET created_at=created_at',
          'UPDATE aic.users SET disabled_at=NULL',
          'DELETE FROM aic.counterparties',
          'UPDATE aic.mvp_counterparty_versions SET reason=reason',
          'UPDATE aic.audit_events SET reason=reason',
          'UPDATE aic.cases SET revision=revision',
          'DELETE FROM aic.case_memberships',
          'UPDATE aic.idempotency_keys SET expires_at=clock_timestamp()',
          'DELETE FROM aic.idempotency_keys',
        ])
          await assert.rejects(db.query(sql), (error) => error.code === '42501')
        assert.deepEqual(await version(first.id, 1), saved)
      },
    )
    await t.test(
      'foundation controller remains503 without optional service, scoped404 before disabled update',
      async () => {
        const foundation = new CounterpartiesController(core)
        await reject(
          foundation.create({ session: alice.session }, randomUUID(), input()),
          503,
          'CONTRACT_NOT_RELEASED',
        )
        await reject(
          foundation.update(
            { session: alice.session, user: alice.session.user },
            first.id,
            randomUUID(),
            input(),
          ),
          503,
          'CONTRACT_NOT_RELEASED',
        )
        await reject(
          foundation.update(
            { session: bob.session, user: bob.session.user },
            first.id,
            randomUUID(),
            input(),
          ),
          404,
          'NOT_FOUND',
        )
      },
    )
  } finally {
    if (db) await db.onModuleDestroy()
    if (owner) await owner.end()
    await admin.end()
  }
})
