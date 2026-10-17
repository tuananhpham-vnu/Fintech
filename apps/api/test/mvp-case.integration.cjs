const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID, randomBytes, createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')
const { migrate } = require('../dist/database/migrate')
const { DatabaseService } = require('../dist/database/database.service')
const { SessionService, hashPassword } = require('../dist/auth')
const { CoreRepository } = require('../dist/foundation/core.repository')
const { CaseMutations } = require('../dist/foundation/case-mutations')
const { MvpCaseService } = require('../dist/foundation/mvp-case.service')
const { FoundationError } = require('../dist/foundation/errors')
const { canonicalJson, requestHash } = require('../dist/foundation/canonical')
const { validateContract } = require('../dist/foundation/validation')
const { PostgresDocumentRepository } = require('../dist/documents/postgres-document.repository')

const root = path.resolve(__dirname, '../../..')
const policyBytes = readFileSync(
  path.join(root, 'docs/implementation/policies/AIC-MVP-SANDBOX-2026-10-17.1.json'),
)
const approvedPolicy = JSON.parse(policyBytes)
const clone = (value) => structuredClone(value)
const declaration = (reported_by) => ({ kind: 'declaration', reported_by })
function exposure(kind = 'RECEIVABLE') {
  return {
    amount_vnd: '90071992547409930001',
    amount_missing_reason: null,
    term_days: null,
    term_null_reason: 'not_agreed',
    organization_role: kind === 'RECEIVABLE' ? 'seller' : 'buyer',
    counterparty_role: kind === 'RECEIVABLE' ? 'buyer' : 'seller',
    contract_ref: null,
    due_date: null,
    conditions: [],
    source_origin: 'staff_entered',
  }
}
function claim(kind = 'RECEIVABLE', observation = 'paid') {
  const payer = kind === 'RECEIVABLE' ? 'counterparty' : 'organization'
  const payee = kind === 'RECEIVABLE' ? 'organization' : 'counterparty'
  const claimant = observation === 'paid' ? payer : payee
  return {
    kind: observation,
    event_state: 'actual',
    claimant_party: claimant,
    payer_party: payer,
    payee_party: payee,
    currency: 'VND',
    amount_vnd: '10000000',
    amount_missing_reason: null,
    occurred_on: null,
    planned_on: null,
    date_missing_reason: 'Actual date not supplied by the reporting party',
    obligation_ref: null,
    source_refs: [declaration(claimant)],
  }
}
function condition(reported_by = 'organization') {
  return {
    kind: 'payment',
    scope: 'SYNTHETIC payment trigger',
    trigger_text: null,
    reported_state: 'unknown',
    due_on: null,
    missing_reason: 'Trigger not agreed',
    source_refs: [declaration(reported_by)],
  }
}
function createBody(tenant, kind = 'RECEIVABLE', input = exposure(kind), stage = 'proposed') {
  return {
    counterparty_id: tenant.cp,
    exposure_kind: kind,
    lifecycle_stage: stage,
    exposure: input,
  }
}
async function reject(promise, status, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof FoundationError)
    assert.equal(error.getStatus(), status)
    if (code) assert.equal(error.getResponse().code, code)
    return true
  })
}

// The main runner supplies an explicitly opted-in disposable loopback cluster.
// This suite starts no PostgreSQL, HTTP, Next.js, AI or persistent server. It
// creates a unique database/runtime role and retains them for runner disposal.
test('MVP case/Exposure service: actual PostgreSQL transactions and source guards', async (t) => {
  const supplied = process.env.AIC_TEST_DATABASE_URL
  assert.ok(supplied, 'AIC_TEST_DATABASE_URL is required; no mock fallback')
  const url = new URL(supplied)
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      process.env.AIC_ALLOW_LOCAL_DB_TESTS === 'true',
    'Explicit disposable loopback DB opt-in required',
  )
  const suffix = randomBytes(6).toString('hex')
  const databaseName = `aic_mvp_case_test_${suffix}`,
    role = `aic_mvp_case_runtime_${suffix}`
  const admin = new Client({ connectionString: supplied })
  await admin.connect()
  let owner, db
  try {
    await admin.query(`CREATE DATABASE ${databaseName}`)
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${randomBytes(32).toString('hex')}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
    )
    const ownerURL = new URL(supplied)
    ownerURL.pathname = `/${databaseName}`
    owner = new Client({ connectionString: ownerURL.href })
    await owner.connect()
    await migrate(ownerURL.href)
    assert.ok(
      (await owner.query("SELECT 1 FROM aic.schema_migrations WHERE name LIKE '0005_%'")).rowCount,
      'The sole migration writer must publish 0005 before executing this suite',
    )
    const runtimePassword = randomBytes(32).toString('hex')
    await owner.query(`ALTER ROLE ${role} PASSWORD '${runtimePassword}'`)
    const runtimeURL = new URL(ownerURL)
    runtimeURL.username = role
    runtimeURL.password = runtimePassword
    await owner.query(`GRANT USAGE ON SCHEMA aic TO ${role}`)
    await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA aic TO ${role}`)
    await owner.query(
      `GRANT INSERT,UPDATE ON aic.sessions,aic.login_attempts,aic.idempotency_keys TO ${role}`,
    )
    await owner.query(`GRANT INSERT,UPDATE ON aic.cases TO ${role}`)
    // PostgreSQL row locks require UPDATE privilege on at least one column.
    // Policy rows need no UPDATE privilege; registry resolution uses a shared
    // advisory lock. No users or case_memberships INSERT/UPDATE grant is made.
    await owner.query(
      `GRANT EXECUTE ON FUNCTION aic.lock_case_counterparty(uuid,uuid,uuid) TO ${role}`,
    )
    await owner.query(
      `GRANT EXECUTE ON FUNCTION aic.lock_case_source_counterparty(uuid,uuid) TO ${role}`,
    )
    await owner.query(
      `GRANT INSERT ON aic.audit_events,aic.mvp_exposure_versions,aic.mvp_exposure_source_bindings TO ${role}`,
    )
    await owner.query(
      `GRANT EXECUTE ON FUNCTION aic.lock_login_user(text),aic.lock_case_access(uuid,uuid,uuid),aic.lock_active_session(uuid,uuid,uuid,bigint) TO ${role}`,
    )
    await owner.query(
      `GRANT INSERT ON aic.mvp_document_objects,aic.mvp_document_lineages,aic.mvp_documents,aic.mvp_document_jobs,aic.mvp_document_replays,aic.mvp_document_results TO ${role}`,
    )
    await owner.query(`GRANT UPDATE ON aic.mvp_document_lineages,aic.mvp_document_jobs TO ${role}`)
    const config = {
      databaseUrl: runtimeURL.href,
      frontendOrigin: 'http://127.0.0.1',
      allowedOrigins: ['http://127.0.0.1'],
      cookieName: 'synthetic_mvp_case',
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
    const core = new CoreRepository(db),
      mutations = new CaseMutations(db, config, core)
    const service = new MvpCaseService(db, config, core, mutations)
    const auth = new SessionService(db, config)
    const documents = new PostgresDocumentRepository(db, config)
    const password = `SYNTHETIC-${randomUUID()}`,
      encoded = await hashPassword(password)

    async function register(artifact, digest = requestHash(artifact)) {
      await owner.query(
        `INSERT INTO aic.mvp_policy_artifacts(version,sha256,artifact_json,approved_at,effective_from)
        VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(version) DO NOTHING`,
        [
          artifact.policy_version,
          digest,
          canonicalJson(artifact),
          approvedPolicy.approval.recorded_at,
          artifact.effective_from,
        ],
      )
      return { version: artifact.policy_version, hash: digest }
    }
    async function assign(
      tenant,
      policy,
      kind,
      from = approvedPolicy.effective_from,
      until = null,
    ) {
      await owner.query(
        `INSERT INTO aic.mvp_policy_assignments
        (id,organization_id,policy_version,artifact_hash,exposure_kind,effective_from,effective_until)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), tenant.org, policy.version, policy.hash, kind, from, until],
      )
    }
    const pinned = await register(approvedPolicy)
    async function tenant(withPolicy = true) {
      const fixture = {
        org: randomUUID(),
        actor: randomUUID(),
        cp: randomUUID(),
        username: randomUUID(),
      }
      await owner.query("INSERT INTO aic.organizations(id,name) VALUES($1,'SYNTHETIC tenant')", [
        fixture.org,
      ])
      await owner.query(
        `INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role)
        VALUES($1,$2,$3,$4,'SYNTHETIC specialist','specialist')`,
        [fixture.actor, fixture.org, fixture.username, encoded],
      )
      await owner.query(
        "INSERT INTO aic.counterparties(id,organization_id,name,country) VALUES($1,$2,'SYNTHETIC counterparty','VN')",
        [fixture.cp, fixture.org],
      )
      if (withPolicy)
        for (const kind of ['RECEIVABLE', 'PREPAYMENT']) await assign(fixture, pinned, kind)
      const login = await auth.login(fixture.username, password, '127.0.0.1')
      fixture.token = login.token
      fixture.session = await auth.resolve(login.token)
      assert.ok(fixture.session)
      return fixture
    }
    async function counts(caseId) {
      const result = {}
      for (const table of [
        'cases',
        'case_memberships',
        'audit_events',
        'mvp_exposure_versions',
        'mvp_exposure_source_bindings',
      ]) {
        const field = table === 'cases' ? 'id' : 'case_id'
        result[table] = (
          await owner.query(
            `SELECT count(*)::int AS n FROM aic.${table}${caseId ? ` WHERE ${field}=$1` : ''}`,
            caseId ? [caseId] : [],
          )
        ).rows[0].n
      }
      result.idempotency_keys = (
        await owner.query('SELECT count(*)::int AS n FROM aic.idempotency_keys')
      ).rows[0].n
      return result
    }
    async function current(caseId) {
      return (await owner.query('SELECT * FROM aic.cases WHERE id=$1', [caseId])).rows[0]
    }
    async function newCase(who = alice, kind = 'RECEIVABLE', input = exposure(kind)) {
      return service.create(who.session, randomUUID(), createBody(who, kind, input))
    }
    async function update(caseId, input, key = randomUUID(), who = alice) {
      return service.update(who.session, caseId, key, {
        expected_revision: Number((await current(caseId)).revision),
        exposure: input,
      })
    }
    const alice = await tenant(),
      bob = await tenant()
    let created, createdKey, createdInput, documentCase, sourceDocument, documentSource

    await t.test('fixture artifact bytes equal the shared canonical policy hash', () => {
      assert.equal(
        createHash('sha256').update(policyBytes).digest('hex'),
        requestHash(approvedPolicy),
      )
    })

    await t.test(
      'least-privilege runtime cannot insert users/memberships or mutate/register policy rows',
      async () => {
        for (const [table, privilege] of [
          ['users', 'INSERT'],
          ['case_memberships', 'INSERT'],
          ['mvp_policy_artifacts', 'UPDATE'],
          ['mvp_policy_assignments', 'UPDATE'],
          ['mvp_policy_artifacts', 'INSERT'],
        ])
          assert.equal(
            (
              await db.query('SELECT has_table_privilege(current_user,$1,$2) AS allowed', [
                `aic.${table}`,
                privilege,
              ])
            ).rows[0].allowed,
            false,
          )
        const trigger = (
          await owner.query(`SELECT p.prosecdef,p.proconfig FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='aic' AND p.proname='grant_case_creator_membership'`)
        ).rows[0]
        assert.equal(
          trigger.prosecdef,
          true,
          'Creator membership must use the narrowly scoped migration-owned trigger',
        )
        assert.ok(trigger.proconfig.some((value) => value.startsWith('search_path=')))
      },
    )

    await t.test(
      'create atomically pins policy, grants creator-only access and writes one audit/version/replay',
      async () => {
        createdKey = randomUUID()
        createdInput = createBody(alice)
        created = await service.create(alice.session, createdKey, createdInput)
        assert.equal(created.status, 201)
        assert.equal(created.replayed, false)
        validateContract('Case', created.body)
        assert.equal(created.body.revision, 1)
        assert.equal(created.body.policy_version, pinned.version)
        assert.equal(created.body.policy_artifact_hash, pinned.hash)
        assert.equal(created.body.method_version, null)
        assert.equal(created.body.lifecycle_stage, 'proposed')
        assert.equal(created.body.exposure.amount_vnd, createdInput.exposure.amount_vnd)
        assert.deepEqual(created.body.exposure.claims, [])
        assert.equal(created.body.exposure.verification, 'unverified')
        assert.equal('entered_by' in created.body.exposure, false)
        const state = await counts(created.body.id)
        assert.deepEqual(
          [state.cases, state.case_memberships, state.audit_events, state.mvp_exposure_versions],
          [1, 1, 1, 1],
        )
        assert.equal((await core.case(alice.session.user, created.body.id)).id, created.body.id)
        await reject(core.case(bob.session.user, created.body.id), 404)
        const member = (
          await owner.query('SELECT * FROM aic.case_memberships WHERE case_id=$1', [
            created.body.id,
          ])
        ).rows[0]
        assert.equal(member.user_id, alice.actor)
        assert.equal(member.granted_by, alice.actor)
      },
    )

    await t.test('create exact replay is frozen, side-effect free and non-sliding', async () => {
      const before = await counts(created.body.id)
      const expiry = (
        await owner.query('SELECT expires_at FROM aic.idempotency_keys WHERE key=$1', [createdKey])
      ).rows[0].expires_at
      const result = await service.create(alice.session, createdKey, clone(createdInput))
      assert.equal(result.replayed, true)
      assert.deepEqual(result.body, created.body)
      assert.deepEqual(await counts(created.body.id), before)
      assert.deepEqual(
        (
          await owner.query('SELECT expires_at FROM aic.idempotency_keys WHERE key=$1', [
            createdKey,
          ])
        ).rows[0].expires_at,
        expiry,
      )
      await reject(
        service.create(alice.session, createdKey, { ...createdInput, lifecycle_stage: 'active' }),
        409,
        'IDEMPOTENCY_CONFLICT',
      )
    })

    await t.test(
      'concurrent identical creates commit one case/audit/version and replay one frozen result',
      async () => {
        const key = randomUUID(),
          body = createBody(alice, 'PREPAYMENT')
        const results = await Promise.all(
          Array.from({ length: 6 }, () => service.create(alice.session, key, clone(body))),
        )
        assert.equal(results.filter((result) => !result.replayed).length, 1)
        assert.equal(new Set(results.map((result) => result.body.id)).size, 1)
        results.forEach((result) => assert.deepEqual(result.body, results[0].body))
        const state = await counts(results[0].body.id)
        assert.deepEqual([state.cases, state.audit_events, state.mvp_exposure_versions], [1, 1, 1])
      },
    )

    await t.test('same key is isolated by actor/org, never a tenant-wide credential', async () => {
      const result = await service.create(bob.session, createdKey, createBody(bob))
      assert.equal(result.replayed, false)
      assert.notEqual(result.body.id, created.body.id)
      assert.equal(result.body.organization_id, bob.org)
    })

    await t.test(
      'cross-org counterparty and forged session principal are rejected before writes',
      async () => {
        const before = await counts()
        await reject(
          service.create(alice.session, randomUUID(), {
            ...createBody(alice),
            counterparty_id: bob.cp,
          }),
          404,
        )
        await reject(
          service.create(
            { ...alice.session, user: { ...alice.session.user, organization_id: bob.org } },
            randomUUID(),
            createBody(bob),
          ),
          401,
        )
        assert.deepEqual(await counts(), before)
      },
    )

    await t.test('revoked case access blocks frozen create replay', async () => {
      const own = await newCase(),
        key = randomUUID(),
        body = createBody(alice)
      const replayTarget = await service.create(alice.session, key, body)
      await owner.query('DELETE FROM aic.case_memberships WHERE case_id=$1', [replayTarget.body.id])
      await reject(service.create(alice.session, key, body), 404)
      assert.equal((await current(own.body.id)).revision, '1')
    })

    await t.test(
      'revoked/disabled/expired/idle sessions cannot obtain cached create responses',
      async () => {
        for (const invalidation of ['revoked', 'disabled', 'expired', 'idle']) {
          const who = await tenant(),
            key = randomUUID(),
            body = createBody(who)
          await service.create(who.session, key, body)
          if (invalidation === 'disabled')
            await owner.query('UPDATE aic.users SET disabled_at=clock_timestamp() WHERE id=$1', [
              who.actor,
            ])
          else {
            const expression = {
              revoked: 'revoked_at=clock_timestamp()',
              expired: "expires_at=clock_timestamp()-interval '1 second'",
              idle: "last_seen_at=clock_timestamp()-interval '1 hour'",
            }[invalidation]
            await owner.query(`UPDATE aic.sessions SET ${expression} WHERE id=$1`, [who.session.id])
          }
          await reject(service.create(who.session, key, body), 401, 'SESSION_EXPIRED')
        }
      },
    )

    await t.test(
      'expired create key conflicts without deletion, key reuse or a new case',
      async () => {
        const key = randomUUID(),
          body = createBody(alice)
        await service.create(alice.session, key, body)
        await owner.query(
          "UPDATE aic.idempotency_keys SET expires_at=clock_timestamp()-interval '1 second' WHERE key=$1",
          [key],
        )
        const before = await counts()
        await reject(service.create(alice.session, key, body), 409, 'IDEMPOTENCY_CONFLICT')
        assert.deepEqual(await counts(), before)
        assert.equal(
          (
            await owner.query('SELECT count(*)::int AS n FROM aic.idempotency_keys WHERE key=$1', [
              key,
            ])
          ).rows[0].n,
          1,
        )
      },
    )

    await t.test(
      '24h default and configured replay duration are honored without automatic cleanup',
      async () => {
        for (const duration of [undefined, 5000]) {
          const customConfig = { ...config, idempotencyTtlMs: duration }
          const custom = new MvpCaseService(
            db,
            customConfig,
            core,
            new CaseMutations(db, customConfig, core),
          )
          const key = randomUUID()
          await custom.create(alice.session, key, createBody(alice))
          const row = (
            await owner.query(
              'SELECT created_at,expires_at FROM aic.idempotency_keys WHERE key=$1',
              [key],
            )
          ).rows[0]
          const span = row.expires_at - row.created_at
          assert.ok(span >= (duration ?? 86400000) && span < (duration ?? 86400000) + 2000)
        }
      },
    )

    await t.test(
      'unknown exposure amount remains null with its reason and is never zero-filled',
      async () => {
        const input = {
          ...exposure(),
          amount_vnd: null,
          amount_missing_reason: 'Amount has not been agreed',
        }
        const result = await newCase(alice, 'RECEIVABLE', input)
        assert.equal(result.body.exposure.amount_vnd, null)
        assert.equal(result.body.exposure.amount_missing_reason, input.amount_missing_reason)
        assert.equal((await current(result.body.id)).exposure_json.amount_vnd, null)
      },
    )

    await t.test(
      'both core roles preserve actual/proposed unverified declarations without summing observations',
      async () => {
        for (const kind of ['RECEIVABLE', 'PREPAYMENT']) {
          const input = exposure(kind)
          input.claims = [claim(kind, 'paid'), claim(kind, 'received')]
          input.conditions = [condition()]
          input.claims[0].amount_vnd = null
          input.claims[0].amount_missing_reason = 'Reporting party cannot read amount'
          const proposed = claim(kind, 'paid')
          proposed.event_state = 'proposed'
          proposed.date_missing_reason = null
          input.claims.push(proposed)
          const result = await newCase(alice, kind, input)
          const output = result.body.exposure
          assert.equal(result.body.lifecycle_stage, 'proposed')
          assert.equal(output.amount_vnd, input.amount_vnd)
          assert.equal(output.claims[0].amount_vnd, null)
          assert.equal(output.claims[0].date_missing_reason, input.claims[0].date_missing_reason)
          assert.equal(output.claims[2].event_state, 'proposed')
          assert.ok(output.claims.every((value) => value.verification === 'unverified'))
          assert.equal('settlement' in output, false)
          assert.equal('outstanding_vnd' in output, false)
          const version = (
            await owner.query('SELECT * FROM aic.mvp_exposure_versions WHERE case_id=$1', [
              result.body.id,
            ])
          ).rows[0]
          assert.equal(version.entered_by, alice.actor)
          assert.equal(version.aggregate_json.entered_by, alice.actor)
          assert.equal(version.aggregate_json.created_at, version.created_at.toISOString())
          assert.equal(version.aggregate_json.source_id, version.source_id)
          const bindings = (
            await owner.query('SELECT * FROM aic.mvp_exposure_source_bindings WHERE case_id=$1', [
              result.body.id,
            ])
          ).rows
          assert.equal(bindings.length, 4)
          for (const binding of bindings) {
            assert.equal(binding.source_id, version.source_id)
            assert.equal(binding.source_kind, 'declaration')
            assert.equal(binding.document_version, null)
            assert.equal(binding.evidence_ref, null)
          }
          assert.equal(
            (
              await owner.query(
                'SELECT count(*)::int AS n FROM aic.mvp_documents WHERE case_id=$1',
                [result.body.id],
              )
            ).rows[0].n,
            0,
          )
        }
      },
    )

    const negatives = [
      [
        'numeric amount',
        (body) => {
          body.exposure.amount_vnd = 100
        },
      ],
      [
        'unknown amount without reason',
        (body) => {
          body.exposure.amount_vnd = null
          body.exposure.amount_missing_reason = null
        },
      ],
      [
        'known amount with missing reason',
        (body) => {
          body.exposure.amount_missing_reason = 'not missing'
        },
      ],
      [
        'null term without explanation',
        (body) => {
          delete body.exposure.term_null_reason
        },
      ],
      [
        'known term with null-term explanation',
        (body) => {
          body.exposure.term_days = 30
        },
      ],
      [
        'reversed PREPAYMENT roles',
        (body) => {
          body.exposure_kind = 'PREPAYMENT'
        },
      ],
      [
        'auxiliary exposure kind',
        (body) => {
          body.exposure_kind = 'LOAN'
        },
      ],
      [
        'client policy override',
        (body) => {
          body.policy_version = pinned.version
        },
      ],
      [
        'client actor injection',
        (body) => {
          body.exposure.entered_by = alice.actor
        },
      ],
      [
        'client verification',
        (body) => {
          body.exposure.verification = 'verified'
        },
      ],
      [
        'SME direct origin',
        (body) => {
          body.exposure.source_origin = 'SME_direct'
        },
      ],
      [
        'client claim identity',
        (body) => {
          body.exposure.claims = [{ ...claim(), id: randomUUID() }]
        },
      ],
      [
        'client claim verification',
        (body) => {
          body.exposure.claims = [{ ...claim(), verification: 'verified' }]
        },
      ],
      [
        'client source identity',
        (body) => {
          const value = claim()
          value.source_refs[0].source_id = randomUUID()
          body.exposure.claims = [value]
        },
      ],
      [
        'questionnaire source unsupported',
        (body) => {
          const value = claim()
          value.source_refs = [{ kind: 'questionnaire', reported_by: 'counterparty' }]
          body.exposure.claims = [value]
        },
      ],
      [
        'third-party payment unsupported',
        (body) => {
          body.exposure.claims = [{ ...claim(), payer_party: 'third_party' }]
        },
      ],
      [
        'paid reported by payee',
        (body) => {
          body.exposure.claims = [{ ...claim(), claimant_party: 'organization' }]
        },
      ],
      [
        'declaration source from wrong reporting party',
        (body) => {
          const value = claim()
          value.source_refs = [declaration('organization')]
          body.exposure.claims = [value]
        },
      ],
      [
        'missing claim source',
        (body) => {
          body.exposure.claims = [{ ...claim(), source_refs: [] }]
        },
      ],
      [
        'null claim amount without reason',
        (body) => {
          body.exposure.claims = [{ ...claim(), amount_vnd: null }]
        },
      ],
      [
        'proposed claim with actual date',
        (body) => {
          body.exposure.claims = [
            {
              ...claim(),
              event_state: 'proposed',
              occurred_on: '2026-10-01',
              date_missing_reason: null,
            },
          ]
        },
      ],
      [
        'actual claim without date or reason',
        (body) => {
          body.exposure.claims = [{ ...claim(), date_missing_reason: null }]
        },
      ],
      [
        'unknown condition without reason',
        (body) => {
          body.exposure.conditions = [{ ...condition(), missing_reason: null }]
        },
      ],
      [
        'invalid calendar date',
        (body) => {
          body.exposure.due_date = '2026-02-30'
        },
      ],
    ]
    for (const [name, change] of negatives)
      await t.test(`reject ${name}, with no committed side effect`, async () => {
        const body = createBody(alice)
        change(body)
        const before = await counts()
        await reject(service.create(alice.session, randomUUID(), body), 422)
        assert.deepEqual(await counts(), before)
      })

    await t.test('no matching policy and future assignments fail closed', async () => {
      const who = await tenant(false)
      await reject(
        service.create(who.session, randomUUID(), createBody(who)),
        503,
        'POLICY_NOT_CONFIGURED',
      )
      const future = (await owner.query("SELECT clock_timestamp()+interval '1 day' AS time"))
        .rows[0].time
      await assign(who, pinned, 'RECEIVABLE', future)
      await reject(
        service.create(who.session, randomUUID(), createBody(who)),
        503,
        'POLICY_NOT_CONFIGURED',
      )
    })

    await t.test('registry rejects overlapping organization/kind policy intervals', async () => {
      await assert.rejects(assign(alice, pinned, 'RECEIVABLE'), (error) => error.code === '23P01')
    })

    for (const [name, change, corruptDigest] of [
      [
        'draft',
        (value) => {
          value.status = 'draft'
        },
      ],
      [
        'ineligible',
        (value) => {
          value.runtime_eligible = false
        },
      ],
      [
        'missing approval evidence',
        (value) => {
          value.approval = null
        },
      ],
      [
        'wrong core scope',
        (value) => {
          value.scope.exposure_kinds = ['PREPAYMENT']
        },
      ],
      [
        'wrong currency scope',
        (value) => {
          value.scope.currency = 'USD'
        },
      ],
      [
        'numeric method activation',
        (value) => {
          value.financial_method_boundary.activate_fhi_pilot = true
        },
      ],
      ['artifact hash mismatch', () => {}, true],
    ])
      await t.test(`policy ${name} is rejected even with an assignment`, async () => {
        const who = await tenant(false),
          artifact = clone(approvedPolicy)
        artifact.policy_version = `SYNTHETIC-NOT-PRODUCTION-${randomUUID()}`
        change(artifact)
        const policy = await register(
          artifact,
          corruptDigest ? 'f'.repeat(64) : requestHash(artifact),
        )
        await assign(who, policy, 'RECEIVABLE')
        const before = await counts()
        await reject(
          service.create(who.session, randomUUID(), createBody(who)),
          503,
          'INVALID_POLICY_ARTIFACT',
        )
        assert.deepEqual(await counts(), before)
      })

    await t.test(
      'update uses CaseMutations, preserves lifecycle/policy and advances immutable source history',
      async () => {
        const input = exposure()
        input.claims = [claim()]
        const result = await update(created.body.id, input)
        assert.equal(result.status, 200)
        assert.equal(result.replayed, false)
        assert.equal(result.body.revision, 2)
        assert.equal(result.body.lifecycle_stage, 'proposed')
        assert.equal(result.body.policy_version, pinned.version)
        assert.equal(result.body.policy_artifact_hash, pinned.hash)
        const rows = (
          await owner.query(
            'SELECT * FROM aic.mvp_exposure_versions WHERE case_id=$1 ORDER BY revision',
            [created.body.id],
          )
        ).rows
        assert.deepEqual(
          rows.map((row) => row.revision),
          ['1', '2'],
        )
        assert.notEqual(rows[0].source_id, rows[1].source_id)
        assert.deepEqual(rows[0].aggregate_json.exposure, created.body.exposure)
        assert.deepEqual(rows[1].aggregate_json.exposure, result.body.exposure)
        assert.equal((await current(created.body.id)).revision, '2')
        assert.equal(result.body.exposure.claims[0].verification, 'unverified')
      },
    )

    await t.test(
      'create replay after updates still returns the original case snapshot',
      async () => {
        const result = await service.create(alice.session, createdKey, createdInput)
        assert.equal(result.replayed, true)
        assert.deepEqual(result.body, created.body)
        assert.equal(result.body.revision, 1)
        assert.equal((await current(created.body.id)).revision, '2')
      },
    )

    await t.test(
      'update replay precedes revision check, preserves generated IDs and adds no audit/version',
      async () => {
        const item = await newCase(),
          key = randomUUID()
        const body = { expected_revision: 1, exposure: { ...exposure(), claims: [claim()] } }
        const first = await service.update(alice.session, item.body.id, key, body)
        const before = await counts(item.body.id)
        const replay = await service.update(alice.session, item.body.id, key, clone(body))
        assert.equal(replay.replayed, true)
        assert.deepEqual(replay.body, first.body)
        assert.deepEqual(await counts(item.body.id), before)
        await reject(
          service.update(alice.session, item.body.id, key, { ...body, exposure: exposure() }),
          409,
          'IDEMPOTENCY_CONFLICT',
        )
        await reject(
          service.update(alice.session, item.body.id, randomUUID(), body),
          409,
          'REVISION_CONFLICT',
        )
      },
    )

    await t.test('concurrent updates on one expected revision commit once', async () => {
      const item = await newCase()
      const body = { expected_revision: 1, exposure: exposure() }
      const results = await Promise.allSettled(
        [1, 2].map(() => service.update(alice.session, item.body.id, randomUUID(), body)),
      )
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
      const failed = results.find((result) => result.status === 'rejected').reason
      assert.equal(failed.getResponse().code, 'REVISION_CONFLICT')
      assert.equal((await counts(item.body.id)).mvp_exposure_versions, 2)
      assert.equal((await counts(item.body.id)).audit_events, 2)
    })

    await t.test('current session/case ACL are checked before update replay', async () => {
      const who = await tenant(),
        item = await newCase(who),
        key = randomUUID()
      const body = { expected_revision: 1, exposure: exposure() }
      await service.update(who.session, item.body.id, key, body)
      await reject(service.update(bob.session, item.body.id, key, body), 404)
      await owner.query('DELETE FROM aic.case_memberships WHERE case_id=$1', [item.body.id])
      await reject(service.update(who.session, item.body.id, key, body), 404)
      await owner.query('UPDATE aic.sessions SET revoked_at=clock_timestamp() WHERE id=$1', [
        who.session.id,
      ])
      await reject(service.update(who.session, item.body.id, key, body), 401)
    })

    await t.test('expired update key cannot execute or reuse its reservation', async () => {
      const item = await newCase(),
        key = randomUUID(),
        body = { expected_revision: 1, exposure: exposure() }
      await service.update(alice.session, item.body.id, key, body)
      await owner.query(
        "UPDATE aic.idempotency_keys SET expires_at=clock_timestamp()-interval '1 second' WHERE key=$1",
        [key],
      )
      const before = await counts(item.body.id)
      await reject(
        service.update(alice.session, item.body.id, key, body),
        409,
        'IDEMPOTENCY_CONFLICT',
      )
      assert.deepEqual(await counts(item.body.id), before)
    })

    await t.test(
      'historical cases without an approved pinned hash remain closed to MVP updates',
      async () => {
        const id = randomUUID()
        await owner.query(
          `INSERT INTO aic.cases(id,organization_id,counterparty_id,exposure_kind,lifecycle_stage,
        exposure_json,policy_version,created_by) VALUES($1,$2,$3,'RECEIVABLE','proposed',$4::jsonb,'SYNTHETIC-UNAPPROVED-LEGACY',$5)`,
          [id, alice.org, alice.cp, canonicalJson(exposure()), alice.actor],
        )
        await reject(update(id, exposure()), 409, 'POLICY_BINDING_REQUIRED')
        assert.equal((await current(id)).revision, '1')
        assert.equal((await counts(id)).mvp_exposure_versions, 0)
      },
    )

    await t.test(
      'valid historical binding is checked at creation, without reselecting current assignment',
      async () => {
        const who = await tenant(false),
          id = randomUUID()
        const createdAt = new Date(Date.parse(approvedPolicy.effective_from) + 1000).toISOString()
        const endedAt = new Date(Date.parse(approvedPolicy.effective_from) + 2000).toISOString()
        await assign(who, pinned, 'RECEIVABLE', approvedPolicy.effective_from, endedAt)
        await owner.query(
          `INSERT INTO aic.cases(id,organization_id,counterparty_id,exposure_kind,lifecycle_stage,
        exposure_json,policy_version,policy_artifact_hash,created_by,created_at)
        VALUES($1,$2,$3,'RECEIVABLE','proposed',$4::jsonb,$5,$6,$7,$8)`,
          [
            id,
            who.org,
            who.cp,
            canonicalJson(exposure()),
            pinned.version,
            pinned.hash,
            who.actor,
            createdAt,
          ],
        )
        await reject(
          service.create(who.session, randomUUID(), createBody(who)),
          503,
          'POLICY_NOT_CONFIGURED',
        )
        const result = await update(id, exposure(), randomUUID(), who)
        assert.equal(result.body.policy_version, pinned.version)
        assert.equal(result.body.policy_artifact_hash, pinned.hash)
        assert.equal(result.body.revision, 2)
      },
    )

    await t.test(
      'real audit failure rolls back case/membership/version/bindings/replay; same intent can retry',
      async () => {
        await owner.query(`CREATE FUNCTION aic.synthetic_case_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='SYNTHETIC audit fault'; END; $$`)
        const key = randomUUID(),
          input = createBody(alice, 'RECEIVABLE', { ...exposure(), claims: [claim()] })
        const before = await counts()
        try {
          await owner.query(
            'CREATE TRIGGER synthetic_case_fault BEFORE INSERT ON aic.audit_events FOR EACH ROW EXECUTE FUNCTION aic.synthetic_case_failure()',
          )
          await assert.rejects(
            service.create(alice.session, key, input),
            (error) => error.code === 'P0001',
          )
          assert.deepEqual(await counts(), before)
        } finally {
          await owner.query('DROP TRIGGER IF EXISTS synthetic_case_fault ON aic.audit_events')
          await owner.query('DROP FUNCTION aic.synthetic_case_failure()')
        }
        assert.equal((await service.create(alice.session, key, input)).replayed, false)
      },
    )

    await t.test(
      'real audit failure rolls back an update and its immutable version/source bindings',
      async () => {
        const item = await newCase(),
          before = await counts(item.body.id),
          row = await current(item.body.id)
        await owner.query(`CREATE FUNCTION aic.synthetic_update_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='SYNTHETIC update audit fault'; END; $$`)
        try {
          await owner.query(
            'CREATE TRIGGER synthetic_update_fault BEFORE INSERT ON aic.audit_events FOR EACH ROW EXECUTE FUNCTION aic.synthetic_update_failure()',
          )
          await assert.rejects(
            update(item.body.id, { ...exposure(), claims: [claim()] }),
            (error) => error.code === 'P0001',
          )
          assert.deepEqual(await counts(item.body.id), before)
          assert.deepEqual(await current(item.body.id), row)
        } finally {
          await owner.query('DROP TRIGGER IF EXISTS synthetic_update_fault ON aic.audit_events')
          await owner.query('DROP FUNCTION aic.synthetic_update_failure()')
        }
      },
    )

    await t.test(
      'session expiry during advisory lock wait is rechecked before create work',
      async () => {
        const who = await tenant(),
          key = randomUUID(),
          before = await counts()
        const scope = [who.org, who.actor, 'case.create', key]
        await owner.query(
          "UPDATE aic.sessions SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE id=$1",
          [who.session.id],
        )
        let pending
        await owner.query('BEGIN')
        try {
          await owner.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            canonicalJson(scope),
          ])
          pending = service.create(who.session, key, createBody(who)).then(
            (value) => ({ value }),
            (error) => ({ error }),
          )
          let waiting = false
          for (let n = 0; n < 100; n++) {
            waiting =
              (
                await admin.query(
                  "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",
                  [databaseName],
                )
              ).rows[0].n > 0
            if (waiting) break
            await new Promise((resolve) => setTimeout(resolve, 5))
          }
          assert.equal(waiting, true)
          await owner.query('SELECT pg_sleep(0.35)')
        } finally {
          await owner.query('ROLLBACK')
        }
        const result = await pending
        assert.equal(result.error?.getStatus(), 401)
        assert.equal(result.error?.getResponse().code, 'SESSION_EXPIRED')
        assert.deepEqual(await counts(), before)
      },
    )

    await t.test(
      'document sources bind an actual published exact document/version/hash/evidence',
      async () => {
        documentCase = await newCase(alice, 'PREPAYMENT')
        const bytes = readFileSync(
          path.join(root, 'packages/contracts/fixtures/01_registration.pdf'),
        )
        const hash = createHash('sha256').update(bytes).digest('hex')
        const accepted = await documents.accept(alice.session, documentCase.body.id, randomUUID(), {
          mode: 'new',
          type: 'registration',
          sourceClass: 'synthetic_case_source_test',
          expectedRevision: 1,
          displayName: 'SYNTHETIC registration.pdf',
          bytes,
          sha256: hash,
          pageCount: 1,
          aiMode: 'mock',
        })
        sourceDocument = accepted.body.document
        const attempt = await documents.claim('synthetic-case-test-worker', 10000, 3)
        assert.equal(attempt.documentId, sourceDocument.id)
        // Canonical synthetic output is published through the real repository.
        // This fixture does not execute a model or establish live AI correctness.
        const fixture = clone(
          JSON.parse(readFileSync(path.join(root, 'packages/contracts/examples.json'))).find(
            (value) => value.schema === 'ExtractionOutput',
          ).value,
        )
        fixture.document_id = sourceDocument.id
        fixture.case_id = documentCase.body.id
        fixture.sha256 = hash
        for (const value of [...fixture.fields, ...fixture.evidence])
          value.document_id = sourceDocument.id
        assert.equal(await documents.publish(attempt, fixture, 'mock'), true)
        documentSource = {
          kind: 'document',
          reported_by: 'organization',
          document_id: sourceDocument.id,
          document_version: sourceDocument.version,
          document_sha256: hash,
          evidence_ref: fixture.evidence[0].id,
        }
        const input = {
          ...exposure('PREPAYMENT'),
          claims: [{ ...claim('PREPAYMENT'), source_refs: [documentSource] }],
        }
        const result = await update(documentCase.body.id, input)
        assert.equal(result.body.revision, 4)
        assert.equal(result.body.exposure.source_origin, 'staff_entered')
        assert.equal(result.body.exposure.claims[0].verification, 'unverified')
        const binding = (
          await owner.query(
            `SELECT * FROM aic.mvp_exposure_source_bindings
        WHERE case_id=$1 AND exposure_revision=4`,
            [documentCase.body.id],
          )
        ).rows[0]
        assert.equal(binding.source_kind, 'document')
        assert.equal(binding.source_id, documentSource.document_id)
        assert.equal(binding.document_version, documentSource.document_version)
        assert.equal(binding.document_sha256, documentSource.document_sha256)
        assert.equal(binding.evidence_ref, documentSource.evidence_ref)
      },
    )

    for (const [name, change] of [
      [
        'invented document',
        (value) => {
          value.document_id = randomUUID()
        },
      ],
      [
        'wrong document version',
        (value) => {
          value.document_version++
        },
      ],
      [
        'wrong document hash',
        (value) => {
          value.document_sha256 = '0'.repeat(64)
        },
      ],
      [
        'invented evidence',
        (value) => {
          value.evidence_ref = randomUUID()
        },
      ],
    ])
      await t.test(`reject ${name} without advancing case/source revision`, async () => {
        const source = clone(documentSource)
        change(source)
        const before = await counts(documentCase.body.id),
          row = await current(documentCase.body.id)
        await reject(
          update(documentCase.body.id, {
            ...exposure('PREPAYMENT'),
            claims: [{ ...claim('PREPAYMENT'), source_refs: [source] }],
          }),
          422,
          'INVALID_EXPOSURE_SOURCE',
        )
        assert.deepEqual(await counts(documentCase.body.id), before)
        assert.deepEqual(await current(documentCase.body.id), row)
      })

    await t.test('published evidence cannot be borrowed from another case or tenant', async () => {
      for (const who of [alice, bob]) {
        const item = await newCase(who, 'PREPAYMENT'),
          before = await counts(item.body.id)
        await reject(
          update(
            item.body.id,
            {
              ...exposure('PREPAYMENT'),
              claims: [{ ...claim('PREPAYMENT'), source_refs: [documentSource] }],
            },
            randomUUID(),
            who,
          ),
          422,
          'INVALID_EXPOSURE_SOURCE',
        )
        assert.deepEqual(await counts(item.body.id), before)
      }
    })

    await t.test(
      'Exposure revision invalidates an in-flight document dependency snapshot and retains stale output',
      async () => {
        const item = await newCase()
        const bytes = readFileSync(
          path.join(root, 'packages/contracts/fixtures/01_registration.pdf'),
        )
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        const accepted = await documents.accept(alice.session, item.body.id, randomUUID(), {
          mode: 'new',
          type: 'registration',
          sourceClass: 'synthetic_dependency',
          expectedRevision: 1,
          displayName: 'SYNTHETIC dependency.pdf',
          bytes,
          sha256,
          pageCount: 1,
          aiMode: 'mock',
        })
        const attempt = await documents.claim('synthetic-stale-worker', 10000, 3)
        assert.equal(attempt.documentId, accepted.body.document.id)
        const changed = await update(item.body.id, exposure())
        assert.equal(changed.body.revision, attempt.caseRevision + 1)
        assert.equal(
          await documents.publish(
            attempt,
            { document_id: attempt.documentId, case_id: item.body.id, sha256 },
            'mock',
          ),
          false,
        )
        const row = (
          await owner.query(
            'SELECT outcome,raw_extraction FROM aic.mvp_document_results WHERE job_id=$1',
            [attempt.jobId],
          )
        ).rows[0]
        assert.equal(row.outcome, 'stale')
        assert.ok(row.raw_extraction)
        assert.equal((await current(item.body.id)).revision, String(changed.body.revision))
      },
    )

    await t.test(
      'declaration FK rejects binding one exposure revision to another revision source',
      async () => {
        const versions = (
          await owner.query(
            'SELECT * FROM aic.mvp_exposure_versions WHERE case_id=$1 ORDER BY revision',
            [created.body.id],
          )
        ).rows
        await assert.rejects(
          owner.query(
            `INSERT INTO aic.mvp_exposure_source_bindings
        (organization_id,case_id,exposure_revision,binding_id,source_kind,source_id,reported_by)
        VALUES($1,$2,$3,$4,'declaration',$5,'organization')`,
            [alice.org, created.body.id, versions[1].revision, randomUUID(), versions[0].source_id],
          ),
          (error) => ['23503', '23514'].includes(error.code),
        )
      },
    )

    await t.test(
      'policy, exposure snapshots and source bindings are immutable at the database boundary',
      async () => {
        for (const [table, field] of [
          ['mvp_policy_artifacts', 'artifact_json'],
          ['mvp_exposure_versions', 'aggregate_json'],
        ])
          await assert.rejects(
            owner.query(`UPDATE aic.${table} SET ${field}=${field}`),
            (error) => error.code === '55000',
          )
        for (const table of ['mvp_policy_assignments', 'mvp_exposure_source_bindings'])
          await assert.rejects(
            owner.query(`DELETE FROM aic.${table}`),
            (error) => error.code === '55000',
          )
        await assert.rejects(
          owner.query('UPDATE aic.cases SET policy_artifact_hash=NULL WHERE id=$1', [
            created.body.id,
          ]),
          (error) => error.code === '23514',
        )
      },
    )
  } finally {
    if (db) await db.onModuleDestroy()
    if (owner) await owner.end()
    await admin.end()
  }
})
