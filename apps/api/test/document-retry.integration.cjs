const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID, randomBytes, createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { Client, Pool } = require('pg')
const { migrate } = require('../dist/database/migrate')
const { CoreRepository } = require('../dist/foundation/core.repository')
const { CaseMutations } = require('../dist/foundation/case-mutations')
const { DocumentRetryService } = require('../dist/documents/document-retry.service')
const { PostgresDocumentRepository } = require('../dist/documents/postgres-document.repository')
const { DocumentWorker } = require('../dist/documents/document-worker')
const { DocumentAiError } = require('../dist/ai-adapters/document-ai-transport')
const {
  DOCUMENT_REPOSITORY,
  DOCUMENT_FILES,
  DOCUMENT_INSPECTOR,
  DOCUMENT_RETRY_DEADLINE_MS,
  DOCUMENT_RETRY_MIN_REMAINING_MS,
} = require('../dist/documents/ports')
const { DocumentDecisions } = require('../dist/documents/document-decisions.service')
const { DocumentsController } = require('../dist/documents/documents.controller')
const { FoundationSessionGuard } = require('../dist/auth/session.guard')
const { SessionService } = require('../dist/auth/session.service')
const { deriveCsrfToken } = require('../dist/auth/security')
const { FoundationExceptionFilter } = require('../dist/foundation/http')
const { FoundationOutputInterceptor } = require('../dist/foundation/validation')
const { validateContract } = require('../dist/foundation/validation')
const { Module } = require('@nestjs/common')
const { NestFactory, APP_GUARD, APP_INTERCEPTOR, Reflector } = require('@nestjs/core')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const errorCode = (code) => (error) => error.getResponse?.().code === code

test('manual document retry: actual PostgreSQL, runtime roles and guarded HTTP', async (t) => {
  assert.equal(process.env.AIC_ALLOW_LOCAL_DB_TESTS, 'true')
  const source = new URL(process.env.AIC_TEST_DATABASE_URL)
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname))
  const suffix = randomBytes(8).toString('hex')
  const name = 'aic_retry_' + suffix,
    apiRole = 'aic_retry_api_' + suffix,
    workerRole = 'aic_retry_worker_' + suffix,
    password = randomBytes(32).toString('hex')
  const admin = new Client({ connectionString: source.href })
  let owner,
    apiPool,
    workerPool,
    app,
    created = false,
    apiCreated = false,
    workerCreated = false
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE ${name}`)
    created = true
    for (const role of [apiRole, workerRole]) {
      await admin.query(
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
      )
      if (role === apiRole) apiCreated = true
      else workerCreated = true
    }
    const ownerUrl = new URL(source)
    ownerUrl.pathname = '/' + name
    await migrate(ownerUrl.href)
    owner = new Client({ connectionString: ownerUrl.href })
    await owner.connect()
    const grants = readFileSync(
      path.resolve(__dirname, '../../../scripts/sandbox-runtime-grants.sql'),
      'utf8',
    )
      .replaceAll(':"api_role"', '"' + apiRole + '"')
      .replaceAll(':"worker_role"', '"' + workerRole + '"')
    await owner.query(grants)
    function runtimeUrl(role) {
      const url = new URL(ownerUrl)
      url.username = role
      url.password = password
      return url.href
    }
    apiPool = new Pool({ connectionString: runtimeUrl(apiRole) })
    workerPool = new Pool({ connectionString: runtimeUrl(workerRole) })
    function database(pool) {
      return {
        activeTransactions: 0,
        query: (sql, args) => pool.query(sql, args),
        async transaction(work) {
          const tx = await pool.connect()
          this.activeTransactions++
          try {
            await tx.query('BEGIN')
            const result = await work(tx)
            await tx.query('COMMIT')
            return result
          } catch (error) {
            await tx.query('ROLLBACK')
            throw error
          } finally {
            this.activeTransactions--
            tx.release()
          }
        },
      }
    }
    const apiDb = database(apiPool),
      workerDb = database(workerPool)
    const config = {
      idempotencyTtlMs: 86400000,
      sessionIdleMs: 3600000,
      cookieName: 'aic_retry',
      allowedOrigins: ['http://127.0.0.1:3000'],
      secureCookies: false,
      sessionTtlMs: 3600000,
      loginWindowMs: 900000,
      loginBlockMs: 900000,
      loginMaxAttempts: 5,
    }
    const api = new PostgresDocumentRepository(apiDb, config)
    const worker = new PostgresDocumentRepository(workerDb, config)
    const core = new CoreRepository(apiDb),
      mutations = new CaseMutations(apiDb, config, core)
    const retry = new DocumentRetryService(api, mutations)
    const org = randomUUID(),
      user = randomUUID(),
      outsider = randomUUID(),
      otherOrg = randomUUID(),
      otherUser = randomUUID(),
      cp = randomUUID()
    for (const organization of [org, otherOrg])
      await owner.query("INSERT INTO aic.organizations(id,name) VALUES($1,'SYNTHETIC RETRY')", [
        organization,
      ])
    for (const [id, organization] of [
      [user, org],
      [outsider, org],
      [otherUser, otherOrg],
    ])
      await owner.query(
        "INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role) VALUES($1,$2,$3,'unused','SYNTHETIC','specialist')",
        [id, organization, randomUUID()],
      )
    await owner.query(
      "INSERT INTO aic.counterparties(id,organization_id,name,country) VALUES($1,$2,'SYNTHETIC','VN')",
      [cp, org],
    )
    async function sessionFor(id = user, organization = org) {
      const sessionId = randomUUID(),
        token = randomBytes(32).toString('base64url'),
        csrf = deriveCsrfToken(token)
      await owner.query(
        "INSERT INTO aic.sessions(id,organization_id,user_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour')",
        [sessionId, organization, id, hash(token), hash(csrf)],
      )
      return {
        id: sessionId,
        user: { id, organization_id: organization, display_name: 'SYNTHETIC', role: 'specialist' },
        csrfToken: csrf,
        token,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }
    }
    const session = await sessionFor(),
      noAccess = await sessionFor(outsider),
      crossTenant = await sessionFor(otherUser, otherOrg)
    async function newJob() {
      const caseId = randomUUID(),
        bytes = Buffer.from('%PDF-1.7\nSYNTHETIC ' + randomUUID())
      await owner.query(
        "INSERT INTO aic.cases(id,organization_id,counterparty_id,exposure_kind,lifecycle_stage,exposure_json,policy_version,created_by) VALUES($1,$2,$3,'RECEIVABLE','proposed',$4,'SYNTHETIC-UNAPPROVED',$5)",
        [
          caseId,
          org,
          cp,
          {
            amount_vnd: '1',
            term_days: null,
            organization_role: 'seller',
            counterparty_role: 'buyer',
          },
          user,
        ],
      )
      const accepted = await api.accept(session, caseId, randomUUID(), {
        mode: 'new',
        type: 'other',
        sourceClass: 'synthetic',
        expectedRevision: 1,
        displayName: 'synthetic.pdf',
        bytes,
        sha256: hash(bytes),
        pageCount: 1,
        aiMode: 'mock',
      })
      return { caseId, jobId: accepted.body.job.id, documentId: accepted.body.document.id, bytes }
    }
    const row = async (fixture) =>
      (await owner.query('SELECT * FROM aic.mvp_document_jobs WHERE id=$1', [fixture.jobId]))
        .rows[0]
    const revision = async (fixture) =>
      Number(
        (await owner.query('SELECT revision FROM aic.cases WHERE id=$1', [fixture.caseId])).rows[0]
          .revision,
      )
    const input = async (fixture) => ({
      expected_revision: await revision(fixture),
      reason: 'Retry known transient provider failure',
    })
    async function failed(code = 'PROVIDER_UNAVAILABLE', retryable = true) {
      const fixture = await newJob()
      fixture.attempt = await worker.claim('synthetic-worker', 300000, 3)
      assert.equal(fixture.attempt.jobId, fixture.jobId)
      assert.equal(await worker.fail(fixture.attempt, code, retryable, 3, false), true)
      return fixture
    }
    // This transport fixture is deterministic mock execution, not live AI evidence.
    const files = {
      materialize: async () => ({ storageKey: 'synthetic-cache', release: async () => {} }),
    }
    const provider = {
      extract: async () => {
        throw new Error('provider unavailable during API/replay')
      },
    }
    const sessions = new SessionService(apiDb, config)
    class RetryTestModule {}
    Module({
      controllers: [DocumentsController],
      providers: [
        { provide: CoreRepository, useValue: core },
        { provide: DOCUMENT_REPOSITORY, useValue: api },
        { provide: DOCUMENT_FILES, useValue: files },
        { provide: DOCUMENT_INSPECTOR, useValue: provider },
        { provide: DocumentDecisions, useValue: {} },
        { provide: DocumentRetryService, useValue: retry },
        {
          provide: APP_GUARD,
          useValue: new FoundationSessionGuard(new Reflector(), sessions, config),
        },
        { provide: APP_INTERCEPTOR, useValue: new FoundationOutputInterceptor() },
      ],
    })(RetryTestModule)
    app = await NestFactory.create(RetryTestModule, { logger: false, abortOnError: false })
    app.use(require('cookie-parser')())
    app.useGlobalFilters(new FoundationExceptionFilter())
    app.setGlobalPrefix('api/v2')
    await app.listen(0, '127.0.0.1')
    const base = await app.getUrl()
    async function post(fixture, body, key = randomUUID(), options = {}) {
      return fetch(base + '/api/v2/jobs/' + fixture.jobId + '/retry', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: config.allowedOrigins[0],
          cookie: config.cookieName + '=' + session.token,
          'x-csrf-token': session.csrfToken,
          'idempotency-key': key,
          ...options,
        },
        body: JSON.stringify(body),
      })
    }

    await t.test(
      'automatic default remains queued; explicit worker option leaves known retryable failure',
      async () => {
        for (const automaticRetry of [undefined, false]) {
          const fixture = await newJob()
          const runner = new DocumentWorker(
            worker,
            files,
            {
              extract: async () => {
                assert.equal(workerDb.activeTransactions, 0)
                throw new DocumentAiError(503, 'PROVIDER_UNAVAILABLE', true)
              },
            },
            {
              leaseMs: 300000,
              maxAttempts: 3,
              ...(automaticRetry === undefined ? {} : { automaticRetry }),
            },
          )
          assert.equal(await runner.once('actual-worker'), 'failed')
          assert.equal((await row(fixture)).state, automaticRetry === false ? 'failed' : 'queued')
          assert.equal((await row(fixture)).retryable, true)
          assert.equal((await row(fixture)).attempts, 1)
          if (automaticRetry === undefined) {
            const claim = await worker.claim('consume-default', 300000, 3)
            await worker.fail(claim, 'PDF_INVALID', false, 3)
          }
        }
      },
    )

    await t.test(
      'known transient failure -> manual retry -> actual worker claim/publish; frozen provider-independent replay',
      async () => {
        const fixture = await failed(),
          body = await input(fixture),
          before = await row(fixture),
          key = randomUUID()
        const response = await post(fixture, body, key)
        assert.equal(response.status, 200)
        const output = await response.json()
        validateContract('DocumentRetryOutput', output, true)
        assert.equal(output.job.id, fixture.jobId)
        assert.equal(output.job.state, 'queued')
        assert.equal(output.revision, body.expected_revision + 1)
        const queued = await row(fixture)
        for (const field of [
          'attempts',
          'fence',
          'document_id',
          'document_version',
          'sha256',
          'snapshot_case_revision',
        ])
          assert.equal(queued[field], before[field])
        const extraction = {
          schema_version: '1.0.2',
          document_id: fixture.documentId,
          case_id: fixture.caseId,
          sha256: before.sha256,
          pages: [{ page: 1 }],
          fields: [],
          evidence: [],
        }
        const runner = new DocumentWorker(worker, files, {
          extract: async () => {
            assert.equal(workerDb.activeTransactions, 0)
            const claimed = await row(fixture)
            assert.equal(claimed.attempts, before.attempts + 1)
            assert.equal(Number(claimed.fence), Number(before.fence) + 1)
            assert.equal(Number(claimed.snapshot_case_revision), output.revision)
            return { body: extraction, mode: 'mock' }
          },
        })
        assert.equal(await runner.once('publish-after-manual'), 'published')
        const replay = await post(fixture, body, key)
        assert.equal(replay.status, 200)
        assert.deepEqual(await replay.json(), output)
        assert.equal((await row(fixture)).state, 'succeeded')
        assert.equal(await worker.publish(fixture.attempt, extraction, 'mock'), false)
        assert.equal(
          await worker.fail(fixture.attempt, 'PROVIDER_UNAVAILABLE', true, 3, false),
          false,
        )
        const audit = (
          await owner.query(
            "SELECT * FROM aic.audit_events WHERE case_id=$1 AND action='document.retry_requested'",
            [fixture.caseId],
          )
        ).rows
        assert.equal(audit.length, 1)
        assert.equal(audit[0].reason, body.reason)
        assert.equal(audit[0].subject_id, fixture.jobId)
        assert.equal(
          (
            await owner.query('SELECT * FROM aic.mvp_document_results WHERE job_id=$1', [
              fixture.jobId,
            ])
          ).rows.length,
          2,
        )
        const changedBody = await post(fixture, { ...body, reason: 'Changed intent' }, key)
        assert.equal(changedBody.status, 409)
        assert.equal((await changedBody.json()).code, 'IDEMPOTENCY_CONFLICT')
      },
    )

    await t.test(
      'parallel duplicate returns one intent; different concurrent keys cannot requeue twice',
      async () => {
        const fixture = await failed(),
          body = await input(fixture),
          key = randomUUID()
        const duplicates = await Promise.all([
          retry.retry(session, fixture.jobId, key, body),
          retry.retry(session, fixture.jobId, key, body),
        ])
        assert.deepEqual(duplicates[0].body, duplicates[1].body)
        assert.equal(duplicates.filter((x) => x.replayed).length, 1)
        const claim = await worker.claim('after-duplicate', 300000, 3)
        await worker.fail(claim, 'PROVIDER_UNAVAILABLE', true, 3, false)
        const next = await input(fixture)
        const concurrent = await Promise.allSettled([
          retry.retry(session, fixture.jobId, randomUUID(), next),
          retry.retry(session, fixture.jobId, randomUUID(), next),
        ])
        assert.equal(concurrent.filter((x) => x.status === 'fulfilled').length, 1)
        const last = await worker.claim('last-budget', 300000, 3)
        assert.equal(last.fence, 3)
        await worker.fail(last, 'PROVIDER_UNAVAILABLE', true, 3, false)
        assert.equal((await row(fixture)).attempts, 3)
        assert.equal((await row(fixture)).retryable, false)
        await assert.rejects(
          retry.retry(session, fixture.jobId, randomUUID(), await input(fixture)),
          errorCode('JOB_RETRY_BUDGET_EXHAUSTED'),
        )
      },
    )

    await t.test(
      'Origin/CSRF/session/ACL and strict reason DTO are enforced at HTTP boundary',
      async () => {
        const fixture = await failed(),
          body = await input(fixture)
        for (const [headers, status] of [
          [{ origin: 'https://foreign.invalid' }, 403],
          [{ 'x-csrf-token': 'wrong' }, 403],
          [{ cookie: '' }, 401],
        ])
          assert.equal((await post(fixture, body, randomUUID(), headers)).status, status)
        for (const bad of [
          { expected_revision: body.expected_revision },
          { ...body, reason: '   ' },
          { ...body, reason: 'x'.repeat(4001) },
          { ...body, attempts: 0 },
          { ...body, document_id: randomUUID() },
        ])
          assert.equal((await post(fixture, bad)).status, 422)
        for (const principal of [noAccess, crossTenant])
          await assert.rejects(
            retry.retry(principal, fixture.jobId, randomUUID(), body),
            errorCode('NOT_FOUND'),
          )
        const second = await newJob()
        await owner.query('DELETE FROM aic.case_memberships WHERE case_id=$1 AND user_id=$2', [
          second.caseId,
          user,
        ])
        await assert.rejects(
          retry.retry(session, second.jobId, randomUUID(), {
            expected_revision: 2,
            reason: 'Cross-case',
          }),
          errorCode('NOT_FOUND'),
        )
        const claim = await worker.claim('consume-other-case', 300000, 3)
        await worker.fail(claim, 'PDF_INVALID', false, 3)
        assert.equal((await row(fixture)).state, 'failed')
      },
    )

    await t.test('stale revision and stale job snapshot are rejected independently', async () => {
      const fixture = await failed(),
        body = await input(fixture)
      await assert.rejects(
        retry.retry(session, fixture.jobId, randomUUID(), { ...body, expected_revision: 1 }),
        errorCode('REVISION_CONFLICT'),
      )
      await owner.query('UPDATE aic.cases SET revision=revision+1 WHERE id=$1', [fixture.caseId])
      await assert.rejects(
        retry.retry(session, fixture.jobId, randomUUID(), await input(fixture)),
        errorCode('STALE_DOCUMENT_SNAPSHOT'),
      )
    })

    await t.test(
      'running/live lease, expired lease and unreconciled/unknown failure cannot be manually queued',
      async () => {
        for (const code of [
          'AI_TIMEOUT',
          'AI_SERVICE_UNAVAILABLE',
          'AI_HTTP_ERROR',
          'PDF_INVALID',
        ]) {
          const fixture = await failed(code, code !== 'PDF_INVALID')
          await assert.rejects(
            retry.retry(session, fixture.jobId, randomUUID(), await input(fixture)),
            errorCode(
              code === 'PDF_INVALID'
                ? 'JOB_RETRY_BUDGET_EXHAUSTED'
                : 'JOB_OUTCOME_RECONCILIATION_REQUIRED',
            ),
          )
        }
        const fixture = await newJob(),
          claim = await worker.claim('in-flight', 300000, 3)
        await assert.rejects(
          retry.retry(session, fixture.jobId, randomUUID(), await input(fixture)),
          errorCode('JOB_NOT_RETRYABLE'),
        )
        await owner.query(
          "UPDATE aic.mvp_document_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [fixture.jobId],
        )
        await assert.rejects(
          retry.retry(session, fixture.jobId, randomUUID(), await input(fixture)),
          errorCode('JOB_NOT_RETRYABLE'),
        )
        assert.equal(await worker.fail(claim, 'PROVIDER_UNAVAILABLE', true, 3, false), false)
        // A failed-looking row without an exact current-fence outcome is unknown.
        await owner.query(
          "UPDATE aic.mvp_document_jobs SET state='failed',retryable=true,lease_expires_at=NULL,error_code='PROVIDER_UNAVAILABLE' WHERE id=$1",
          [fixture.jobId],
        )
        await assert.rejects(
          retry.retry(session, fixture.jobId, randomUUID(), await input(fixture)),
          errorCode('JOB_OUTCOME_RECONCILIATION_REQUIRED'),
        )
        const leased = await failed()
        await owner.query(
          "UPDATE aic.mvp_document_jobs SET lease_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",
          [leased.jobId],
        )
        await assert.rejects(
          retry.retry(session, leased.jobId, randomUUID(), await input(leased)),
          errorCode('JOB_NOT_RETRYABLE'),
        )
      },
    )

    await t.test('superseded source and mismatched outcome source/fence are rejected', async () => {
      const fixture = await failed(),
        body = await input(fixture)
      const bytes = Buffer.from('%PDF-1.7\nreplacement')
      await api.accept(session, fixture.caseId, randomUUID(), {
        mode: 'replace',
        replacesDocumentId: fixture.documentId,
        type: 'other',
        sourceClass: 'synthetic',
        expectedRevision: body.expected_revision,
        displayName: 'replacement.pdf',
        bytes,
        sha256: hash(bytes),
        pageCount: 1,
        aiMode: 'mock',
      })
      await assert.rejects(
        retry.retry(session, fixture.jobId, randomUUID(), await input(fixture)),
        errorCode('STALE_DOCUMENT_SNAPSHOT'),
      )
      // A corrupted job snapshot cannot replace the immutable attempt snapshot.
      await owner.query('UPDATE aic.mvp_document_jobs SET snapshot_case_revision=$2 WHERE id=$1', [
        fixture.jobId,
        await revision(fixture),
      ])
      await assert.rejects(
        retry.retry(session, fixture.jobId, randomUUID(), await input(fixture)),
        errorCode('JOB_OUTCOME_RECONCILIATION_REQUIRED'),
      )
      const replacement = await worker.claim('consume-replacement', 300000, 3)
      await worker.fail(replacement, 'PDF_INVALID', false, 3)
      const mismatch = await failed()
      await owner.query('UPDATE aic.mvp_document_jobs SET fence=fence+1 WHERE id=$1', [
        mismatch.jobId,
      ])
      await assert.rejects(
        retry.retry(session, mismatch.jobId, randomUUID(), await input(mismatch)),
        errorCode('JOB_OUTCOME_RECONCILIATION_REQUIRED'),
      )
    })

    await t.test(
      'deadline and minimum remaining worker budget are bounded by original creation time',
      async () => {
        for (const age of [
          DOCUMENT_RETRY_DEADLINE_MS + 1000,
          DOCUMENT_RETRY_DEADLINE_MS - DOCUMENT_RETRY_MIN_REMAINING_MS + 1000,
        ]) {
          const fixture = await failed()
          await owner.query(
            "UPDATE aic.mvp_document_jobs SET created_at=clock_timestamp()-($2::bigint*interval '1 millisecond') WHERE id=$1",
            [fixture.jobId, age],
          )
          await assert.rejects(
            retry.retry(session, fixture.jobId, randomUUID(), await input(fixture)),
            errorCode('JOB_RETRY_DEADLINE_EXCEEDED'),
          )
          assert.equal((await row(fixture)).state, 'failed')
        }
      },
    )

    await t.test('audit/replay failure rolls back job, revision and command intent', async () => {
      for (const table of ['audit_events', 'idempotency_keys']) {
        const fixture = await failed(),
          body = await input(fixture),
          before = await row(fixture),
          key = randomUUID()
        await owner.query(`REVOKE INSERT ON aic.${table} FROM ${apiRole}`)
        try {
          await assert.rejects(
            retry.retry(session, fixture.jobId, key, body),
            (error) => error.code === '42501',
          )
        } finally {
          await owner.query(`GRANT INSERT ON aic.${table} TO ${apiRole}`)
        }
        assert.deepEqual(await row(fixture), before)
        assert.equal(await revision(fixture), body.expected_revision)
        assert.equal(
          (await owner.query('SELECT * FROM aic.idempotency_keys WHERE key=$1', [key])).rows.length,
          0,
        )
        const result = await retry.retry(session, fixture.jobId, key, body)
        assert.equal(result.replayed, false)
        const claim = await worker.claim('consume-rollback', 300000, 3)
        await worker.fail(claim, 'PDF_INVALID', false, 3)
      }
    })

    await t.test(
      'frozen replay precedes source/deadline checks but still requires current session and ACL; expired keys conflict',
      async () => {
        const fixture = await failed(),
          body = await input(fixture),
          key = randomUUID()
        const result = await retry.retry(session, fixture.jobId, key, body)
        const claim = await worker.claim('after-frozen', 300000, 3)
        await worker.fail(claim, 'PDF_INVALID', false, 3)
        await owner.query(
          "UPDATE aic.mvp_document_jobs SET created_at=clock_timestamp()-interval '2 days' WHERE id=$1",
          [fixture.jobId],
        )
        assert.deepEqual((await retry.retry(session, fixture.jobId, key, body)).body, result.body)
        await owner.query('DELETE FROM aic.case_memberships WHERE case_id=$1 AND user_id=$2', [
          fixture.caseId,
          user,
        ])
        await assert.rejects(retry.retry(session, fixture.jobId, key, body), errorCode('NOT_FOUND'))
        const expired = await failed(),
          short = new DocumentRetryService(
            api,
            new CaseMutations(apiDb, { ...config, idempotencyTtlMs: 1 }, core),
          ),
          expiredBody = await input(expired)
        await short.retry(session, expired.jobId, 'expires', expiredBody)
        await new Promise((resolve) => setTimeout(resolve, 15))
        await assert.rejects(
          short.retry(session, expired.jobId, 'expires', expiredBody),
          errorCode('IDEMPOTENCY_CONFLICT'),
        )
        const final = await worker.claim('consume-expired', 300000, 3)
        await worker.fail(final, 'PDF_INVALID', false, 3)
        const revoked = await sessionFor()
        await owner.query('UPDATE aic.sessions SET revoked_at=clock_timestamp() WHERE id=$1', [
          revoked.id,
        ])
        await assert.rejects(
          retry.retry(revoked, fixture.jobId, key, body),
          errorCode('SESSION_EXPIRED'),
        )
      },
    )

    await t.test(
      'API grants cannot reset attempt/fence/source or forge results; worker has no session authority',
      async () => {
        const fixture = await failed()
        for (const update of [
          'attempts=0',
          'fence=0',
          "sha256=repeat('a',64)",
          'worker_id=NULL',
          'lease_expires_at=NULL',
        ])
          await assert.rejects(
            apiPool.query('UPDATE aic.mvp_document_jobs SET ' + update + ' WHERE id=$1', [
              fixture.jobId,
            ]),
            (error) => error.code === '42501',
          )
        assert.equal(
          (
            await owner.query(
              "SELECT has_table_privilege($1,'aic.mvp_document_results','INSERT') allowed",
              [apiRole],
            )
          ).rows[0].allowed,
          false,
        )
        assert.equal(
          (
            await owner.query(
              "SELECT has_function_privilege($1,'aic.lock_active_session(uuid,uuid,uuid,bigint)','EXECUTE') allowed",
              [workerRole],
            )
          ).rows[0].allowed,
          false,
        )
      },
    )
  } finally {
    if (app) await app.close()
    if (apiPool) await apiPool.end()
    if (workerPool) await workerPool.end()
    if (owner) await owner.end()
    if (created) await admin.query(`DROP DATABASE ${name}`)
    if (apiCreated) await admin.query(`DROP ROLE ${apiRole}`)
    if (workerCreated) await admin.query(`DROP ROLE ${workerRole}`)
    await admin.end()
  }
})
