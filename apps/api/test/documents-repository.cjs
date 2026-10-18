const test = require('node:test'),
  assert = require('node:assert/strict')
const { randomUUID, randomBytes, createHash } = require('node:crypto')
const { Client, Pool } = require('pg')
const { migrate } = require('../dist/database/migrate')
const { PostgresDocumentRepository } = require('../dist/documents/postgres-document.repository')

test('MVP document repository: actual PostgreSQL with separate least-privileged roles', async (t) => {
  assert.ok(process.env.AIC_TEST_DATABASE_URL, 'Explicit disposable PostgreSQL URL required')
  const source = new URL(process.env.AIC_TEST_DATABASE_URL)
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname) &&
      process.env.AIC_ALLOW_LOCAL_DB_TESTS === 'true',
    'Loopback test opt-in required',
  )
  const suffix = randomBytes(8).toString('hex')
  const database = 'aic_document_test_' + suffix,
    apiRole = 'aic_doc_api_' + suffix,
    workerRole = 'aic_doc_worker_' + suffix
  const password = randomBytes(32).toString('hex'),
    admin = new Client({ connectionString: source.href })
  let owner,
    apiPool,
    workerPool,
    databaseCreated = false,
    rolesCreated = false
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE ${database}`)
    databaseCreated = true
    await admin.query(
      `CREATE ROLE ${apiRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
    )
    await admin.query(
      `CREATE ROLE ${workerRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
    )
    rolesCreated = true
    const ownerUrl = new URL(source)
    ownerUrl.pathname = '/' + database
    await migrate(ownerUrl.href)
    owner = new Client({ connectionString: ownerUrl.href })
    await owner.connect()
    for (const role of [apiRole, workerRole]) {
      await owner.query(`GRANT USAGE ON SCHEMA aic TO ${role}`)
      if (role === apiRole) await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA aic TO ${role}`)
      else
        await owner.query(
          `GRANT SELECT ON aic.cases,aic.counterparties,aic.mvp_document_objects,aic.mvp_document_lineages,aic.mvp_documents,aic.mvp_document_jobs,aic.mvp_document_results,aic.mvp_document_decisions TO ${role}`,
        )
      await owner.query(`GRANT UPDATE(revision,updated_at) ON aic.cases TO ${role}`)
      await owner.query(`GRANT INSERT ON aic.audit_events TO ${role}`)
      await owner.query(
        `GRANT EXECUTE ON FUNCTION aic.lock_case_source_counterparty(uuid,uuid) TO ${role}`,
      )
    }
    await owner.query(
      `GRANT INSERT ON aic.mvp_document_objects,aic.mvp_document_lineages,aic.mvp_documents,aic.mvp_document_jobs,aic.mvp_document_replays TO ${apiRole}`,
    )
    await owner.query(
      `GRANT UPDATE(current_document_id) ON aic.mvp_document_lineages TO ${apiRole}`,
    )
    await owner.query(`GRANT INSERT ON aic.mvp_response_bindings TO ${apiRole}`)
    await owner.query(`GRANT UPDATE(revision) ON aic.mvp_document_requests TO ${apiRole}`)
    await owner.query(
      `GRANT EXECUTE ON FUNCTION aic.lock_active_session(uuid,uuid,uuid,bigint),aic.lock_case_access(uuid,uuid,uuid) TO ${apiRole}`,
    )
    await owner.query(`GRANT INSERT ON aic.mvp_document_results TO ${workerRole}`)
    await owner.query(`GRANT UPDATE ON aic.mvp_document_jobs TO ${workerRole}`)
    const runtimeUrl = (role) => {
      const url = new URL(ownerUrl)
      url.username = role
      url.password = password
      return url.href
    }
    apiPool = new Pool({ connectionString: runtimeUrl(apiRole) })
    workerPool = new Pool({ connectionString: runtimeUrl(workerRole) })
    const db = (pool) => ({
      query: (sql, values) => pool.query(sql, values),
      transaction: async (work) => {
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const result = await work(client)
          await client.query('COMMIT')
          return result
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
      },
    })
    const config = { idempotencyTtlMs: 3600000, sessionIdleMs: 3600000 }
    const api = new PostgresDocumentRepository(db(apiPool), config),
      worker = new PostgresDocumentRepository(db(workerPool), config)
    const org = randomUUID(),
      otherOrg = randomUUID(),
      user = randomUUID(),
      outsider = randomUUID(),
      otherUser = randomUUID(),
      cp = randomUUID(),
      caseId = randomUUID()
    for (const id of [org, otherOrg])
      await owner.query('INSERT INTO aic.organizations(id,name) VALUES($1,$2)', [
        id,
        'SYNTHETIC TECH TEST',
      ])
    for (const [id, organization] of [
      [user, org],
      [outsider, org],
      [otherUser, otherOrg],
    ])
      await owner.query(
        "INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role) VALUES($1,$2,$3,'unused-no-login','SYNTHETIC','specialist')",
        [id, organization, randomUUID()],
      )
    await owner.query(
      "INSERT INTO aic.counterparties(id,organization_id,name,country) VALUES($1,$2,'SYNTHETIC','VN')",
      [cp, org],
    )
    // Operator-only synthetic case; this fixture explicitly asserts no business policy approval.
    await owner.query(
      "INSERT INTO aic.cases(id,organization_id,counterparty_id,exposure_kind,lifecycle_stage,exposure_json,policy_version,created_by) VALUES($1,$2,$3,'RECEIVABLE','proposed',$4,'SYNTHETIC-UNAPPROVED-TECH-ONLY',$5)",
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
    async function sessionFor(id = user, organization = org, ttl = 3600000) {
      const sid = randomUUID()
      await owner.query(
        "INSERT INTO aic.sessions(id,organization_id,user_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+($6*interval '1 millisecond'))",
        [
          sid,
          organization,
          id,
          randomBytes(32).toString('hex'),
          randomBytes(32).toString('hex'),
          ttl,
        ],
      )
      return {
        id: sid,
        user: { id, organization_id: organization, display_name: 'SYNTHETIC', role: 'specialist' },
        csrfToken: 'unused',
        expiresAt: new Date(Date.now() + ttl).toISOString(),
      }
    }
    const session = await sessionFor(),
      noAccess = await sessionFor(outsider),
      crossTenant = await sessionFor(otherUser, otherOrg)
    const revision = async () =>
      Number(
        (await owner.query('SELECT revision FROM aic.cases WHERE id=$1', [caseId])).rows[0]
          .revision,
      )
    const upload = (rev, changes = {}) => {
      const bytes = Buffer.from('%PDF-1.7\nSYNTHETIC ' + rev)
      return {
        mode: 'new',
        type: 'other',
        sourceClass: 'synthetic',
        expectedRevision: rev,
        displayName: 'synthetic.pdf',
        bytes,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        pageCount: 2,
        aiMode: 'mock',
        ...changes,
      }
    }
    const evidenceId = randomUUID()
    const extraction = (attempt, changes = {}) => ({
      document_id: attempt.documentId,
      case_id: attempt.caseId,
      sha256: attempt.sha256,
      raw: { nested: ['all', 'preserved'] },
      evidence: [{ id: evidenceId }],
      ...changes,
    })
    const httpError = (status) => (error) => error.getStatus?.() === status
    let accepted, first, attempt, replaced, replacementAttempt

    await t.test(
      'atomic acceptance, exact frozen replay before revision check, full DTO and changed metadata conflict',
      async () => {
        first = upload(1)
        accepted = await api.accept(session, caseId, 'first', first)
        assert.equal(accepted.status, 202)
        assert.equal(accepted.body.revision, 2)
        assert.equal(accepted.body.document.source.subject_verification, 'unverified')
        assert.deepEqual(
          Object.keys(accepted.body.job).sort(),
          [
            'id',
            'case_id',
            'document_id',
            'state',
            'attempts',
            'errors',
            'retryable',
            'mode',
            'created_at',
          ].sort(),
        )
        const replay = await api.accept(session, caseId, 'first', first)
        assert.equal(replay.replayed, true)
        assert.deepEqual(replay.body, accepted.body)
        for (const changed of [
          { displayName: 'other.pdf' },
          { type: 'invoice' },
          { sourceClass: 'different' },
          { expectedRevision: 2 },
        ])
          await assert.rejects(
            api.accept(session, caseId, 'first', { ...first, ...changed }),
            httpError(409),
          )
        const { pageCount, aiMode, ...clientInput } = first
        assert.deepEqual(
          (await api.replay(session, caseId, 'first', clientInput)).body,
          accepted.body,
        )
        assert.equal(await api.replay(session, caseId, 'absent', clientInput), null)
        await assert.rejects(
          api.replay(session, caseId, 'first', { ...clientInput, displayName: 'changed.pdf' }),
          httpError(409),
        )
        assert.equal(
          (await api.accept(session, caseId, 'first', { ...first, pageCount: 3, aiMode: 'live' }))
            .replayed,
          true,
        )
        assert.equal(await revision(), 2)
      },
    )
    await t.test(
      'source bytes/hash, active list, safe invalid UUID and current tenant/membership/session ACL',
      async () => {
        const read = await api.read(session, accepted.body.document.id)
        assert.deepEqual(read.bytes, first.bytes)
        assert.equal(read.document.hash, first.sha256)
        assert.equal((await api.list(session, caseId)).length, 1)
        await assert.rejects(api.read(session, 'not-a-uuid'), httpError(404))
        for (const actor of [noAccess, crossTenant]) {
          await assert.rejects(api.read(actor, accepted.body.document.id), httpError(404))
          await assert.rejects(api.job(actor, accepted.body.job.id), httpError(404))
          await assert.rejects(api.accept(actor, caseId, 'first', first), httpError(404))
        }
        const revoked = await sessionFor()
        await owner.query('UPDATE aic.sessions SET revoked_at=clock_timestamp() WHERE id=$1', [
          revoked.id,
        ])
        await assert.rejects(api.list(revoked, caseId), httpError(401))
      },
    )
    await t.test(
      'accept rolls back canonical bytes, metadata, pointer, job, revision and replay when audit fails',
      async () => {
        const before = (await owner.query('SELECT count(*)::int n FROM aic.mvp_document_objects'))
          .rows[0].n
        await owner.query(`REVOKE INSERT ON aic.audit_events FROM ${apiRole}`)
        try {
          await assert.rejects(
            api.accept(session, caseId, 'rollback', upload(2)),
            (error) => error.code === '42501',
          )
        } finally {
          await owner.query(`GRANT INSERT ON aic.audit_events TO ${apiRole}`)
        }
        assert.equal(
          (await owner.query('SELECT count(*)::int n FROM aic.mvp_document_objects')).rows[0].n,
          before,
        )
        assert.equal(await revision(), 2)
        assert.equal((await api.list(session, caseId)).length, 1)
      },
    )
    await t.test(
      'worker claims canonical snapshot; owner/fence checks; publish full raw once with operator audit',
      async () => {
        attempt = await worker.claim('synthetic-worker', 60000, 3)
        assert.ok(attempt)
        assert.equal(attempt.caseRevision, 2)
        assert.deepEqual(attempt.bytes, first.bytes)
        assert.equal(await worker.heartbeat(attempt, 60000), true)
        assert.equal(
          await worker.publish(
            { ...attempt, fence: attempt.fence + 1 },
            extraction(attempt),
            'mock',
          ),
          false,
        )
        assert.equal(await worker.publish(attempt, extraction(attempt), 'mock'), true)
        assert.equal(await worker.publish(attempt, extraction(attempt), 'mock'), false)
        const read = await api.read(session, attempt.documentId)
        assert.deepEqual(read.document.extraction, extraction(attempt))
        assert.equal(read.document.status, 'completed')
        assert.equal((await api.job(session, attempt.jobId)).state, 'completed')
        assert.equal(await revision(), 3)
        const event = (
          await owner.query(
            "SELECT * FROM aic.audit_events WHERE action='document.extraction_published'",
          )
        ).rows[0]
        assert.equal(event.actor_type, 'operator')
        assert.equal(event.actor_id, null)
        assert.equal(event.metadata_json.worker_authority.worker_id, 'synthetic-worker')
        assert.equal((await api.accept(session, caseId, 'first', first)).body.job.state, 'queued')
      },
    )
    await t.test(
      'replace CAS creates immutable version/new ID/same lineage; old exact bytes remain readable',
      async () => {
        replaced = await api.accept(
          session,
          caseId,
          'replace',
          upload(3, { mode: 'replace', replacesDocumentId: attempt.documentId }),
        )
        assert.equal(replaced.body.document.version, 2)
        assert.notEqual(replaced.body.document.id, attempt.documentId)
        assert.equal(replaced.body.document.lineage, accepted.body.document.lineage)
        assert.equal((await api.read(session, attempt.documentId)).document.active, false)
        assert.deepEqual((await api.read(session, attempt.documentId)).bytes, first.bytes)
        await assert.rejects(
          api.accept(
            session,
            caseId,
            'old-target',
            upload(4, { mode: 'replace', replacesDocumentId: attempt.documentId }),
          ),
          httpError(404),
        )
      },
    )
    await t.test(
      'published evidence lookup returns exact old version and hides other tenants/case nonmembers',
      async () => {
        const document = await api.evidenceDocument(session, evidenceId)
        assert.equal(document.id, attempt.documentId)
        assert.equal(document.active, false)
        for (const actor of [noAccess, crossTenant])
          await assert.rejects(api.evidenceDocument(actor, evidenceId), httpError(404))
        await assert.rejects(api.evidenceDocument(session, randomUUID()), httpError(404))
        await assert.rejects(api.evidenceDocument(session, 'invalid'), httpError(404))
      },
    )
    await t.test(
      'superseded source cannot publish; full historical output retained; public stale maps to failed',
      async () => {
        replacementAttempt = await worker.claim('synthetic-worker', 60000, 3)
        await api.accept(
          session,
          caseId,
          'replace-again',
          upload(4, { mode: 'replace', replacesDocumentId: replacementAttempt.documentId }),
        )
        assert.equal(
          await worker.publish(replacementAttempt, extraction(replacementAttempt), 'mock'),
          false,
        )
        const result = (
          await owner.query('SELECT * FROM aic.mvp_document_results WHERE job_id=$1', [
            replacementAttempt.jobId,
          ])
        ).rows[0]
        assert.equal(result.outcome, 'stale')
        assert.deepEqual(result.raw_extraction, extraction(replacementAttempt))
        const job = await api.job(session, replacementAttempt.jobId)
        assert.equal(job.state, 'failed')
        assert.equal(job.errors[0].code, 'STALE_DOCUMENT_SNAPSHOT')
        assert.equal(
          (await api.read(session, replacementAttempt.documentId)).document.status,
          'failed',
        )
        assert.equal(await revision(), 5)
      },
    )
    await t.test(
      'retryable bounded retries increment fences; obsolete worker cannot heartbeat/publish/fail',
      async () => {
        const failed = await worker.claim('synthetic-worker', 60000, 3)
        assert.equal(await worker.fail(failed, 'TEMPORARY', true, 3), true)
        const retried = await worker.claim('synthetic-worker-2', 60000, 3)
        assert.equal(retried.fence, failed.fence + 1)
        assert.equal(await worker.heartbeat(failed, 60000), false)
        assert.equal(await worker.publish(failed, extraction(failed), 'mock'), false)
        assert.equal(await worker.fail(failed, 'LATE', false, 3), false)
        assert.equal(await worker.fail(retried, 'SCHEMA_INVALID', false, 3), true)
        assert.equal(await worker.claim('synthetic-worker', 60000, 3), null)
      },
    )
    await t.test(
      'publish rejects wrong source IDs/hash and mode even if transport is bypassed',
      async () => {
        for (const mismatch of [
          { case_id: randomUUID() },
          { document_id: randomUUID() },
          { sha256: '0'.repeat(64) },
          { wrongMode: true },
        ]) {
          await api.accept(session, caseId, randomUUID(), upload(await revision()))
          const work = await worker.claim('synthetic-worker', 60000, 3),
            before = await revision()
          const raw = mismatch.wrongMode ? extraction(work) : extraction(work, mismatch)
          assert.equal(await worker.publish(work, raw, mismatch.wrongMode ? 'live' : 'mock'), false)
          assert.equal(await revision(), before)
          const job = await api.job(session, work.jobId)
          assert.equal(job.state, 'failed')
          assert.equal(
            job.errors[0].code,
            mismatch.wrongMode ? 'AI_MODE_MISMATCH' : 'AI_CONTENT_MISMATCH',
          )
        }
      },
    )
    await t.test(
      'expired leases never revive and reclaim records expiry with incremented fence',
      async () => {
        await api.accept(session, caseId, 'lease', upload(await revision()))
        const work = await worker.claim('synthetic-worker', 60000, 3)
        await owner.query(
          "UPDATE aic.mvp_document_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [work.jobId],
        )
        assert.equal(await worker.heartbeat(work, 60000), false)
        assert.equal(await worker.publish(work, extraction(work), 'mock'), false)
        assert.equal(await worker.fail(work, 'LATE', true, 3), false)
        const reclaimed = await worker.claim('synthetic-worker-2', 60000, 3)
        assert.equal(reclaimed.fence, work.fence + 1)
        assert.equal(
          (
            await owner.query(
              'SELECT outcome FROM aic.mvp_document_results WHERE job_id=$1 AND fence=$2',
              [work.jobId, work.fence],
            )
          ).rows[0].outcome,
          'lease_expired',
        )
        assert.equal(await worker.fail(reclaimed, 'LAST_FAILURE', true, 2), true)
        assert.equal((await api.job(session, work.jobId)).retryable, false)
      },
    )
    await t.test(
      'response acceptance freezes approved request atomically; cancellation blocks new acceptance but permits exact replay',
      async () => {
        const policy = 'SYNTHETIC-UNAPPROVED-RESPONSE-CONSTRAINT-TEST',
          runId = randomUUID(),
          requestId = randomUUID()
        await owner.query(
          'INSERT INTO aic.mvp_policy_artifacts(version,sha256,artifact_json,approved_at,effective_from) VALUES($1,$2,$3,clock_timestamp(),clock_timestamp())',
          [
            policy,
            'e'.repeat(64),
            { synthetic: true, approval_status: 'unapproved', purpose: 'SQL-constraint-test-only' },
          ],
        )
        await owner.query(
          'INSERT INTO aic.mvp_review_runs(id,organization_id,case_id,case_revision,snapshot_hash,policy_version,payload_json) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            runId,
            org,
            caseId,
            await revision(),
            'f'.repeat(64),
            policy,
            { synthetic: true, conclusion: 'unknown' },
          ],
        )
        const exported = Buffer.from('SYNTHETIC UNVERIFIED DOCUMENT REQUEST'),
          requestHash = createHash('sha256').update(exported).digest('hex')
        await owner.query(
          `INSERT INTO aic.mvp_document_requests
        (id,organization_id,case_id,run_id,issue_id,purpose,content,document_types,status,revision,approved_payload,approved_export,approved_hash,created_by)
        VALUES($1,$2,$3,$4,$5,'synthetic','synthetic',$6,'approved',1,$7,$8,$9,$10)`,
          [
            requestId,
            org,
            caseId,
            runId,
            randomUUID(),
            JSON.stringify(['other']),
            { synthetic: true, verification: 'unverified' },
            exported,
            requestHash,
            user,
          ],
        )
        const input = upload(await revision(), { mode: 'response', responseRequestId: requestId })
        await assert.rejects(
          api.accept(session, caseId, 'response-bad-type', { ...input, type: 'invoice' }),
          httpError(409),
        )
        await assert.rejects(
          api.accept(session, caseId, 'response-extra', {
            ...input,
            replacesDocumentId: accepted.body.document.id,
          }),
          httpError(422),
        )
        await assert.rejects(
          api.accept(session, caseId, 'new-extra', { ...input, mode: 'new' }),
          httpError(422),
        )
        const before = await revision(),
          objects = (await owner.query('SELECT count(*)::int n FROM aic.mvp_document_objects'))
            .rows[0].n
        await owner.query(`REVOKE INSERT ON aic.mvp_response_bindings FROM ${apiRole}`)
        try {
          await assert.rejects(
            api.accept(session, caseId, 'response-rollback', input),
            (error) => error.code === '42501',
          )
        } finally {
          await owner.query(`GRANT INSERT ON aic.mvp_response_bindings TO ${apiRole}`)
        }
        assert.equal(await revision(), before)
        assert.equal(
          (await owner.query('SELECT count(*)::int n FROM aic.mvp_document_objects')).rows[0].n,
          objects,
        )
        const response = await api.accept(session, caseId, 'response', input)
        const binding = (
          await owner.query('SELECT * FROM aic.mvp_response_bindings WHERE document_id=$1', [
            response.body.document.id,
          ])
        ).rows[0]
        assert.equal(binding.request_id, requestId)
        assert.equal(Number(binding.request_revision), 1)
        assert.equal(binding.request_hash, requestHash)
        assert.equal(response.body.document.version, 1)
        assert.notEqual(response.body.document.lineage, accepted.body.document.lineage)
        await owner.query(
          "UPDATE aic.mvp_document_requests SET status='cancelled',revision=revision+1 WHERE id=$1",
          [requestId],
        )
        const { pageCount, aiMode, ...clientInput } = input
        assert.deepEqual(
          (await api.replay(session, caseId, 'response', clientInput)).body,
          response.body,
        )
        assert.equal((await api.accept(session, caseId, 'response', input)).replayed, true)
        await assert.rejects(
          api.replay(session, caseId, 'response', {
            ...clientInput,
            responseRequestId: randomUUID(),
          }),
          httpError(409),
        )
        await assert.rejects(
          api.accept(session, caseId, 'cancelled-new', {
            ...input,
            expectedRevision: await revision(),
          }),
          httpError(409),
        )
        assert.equal(await revision(), before + 1)
      },
    )
    await t.test(
      'case-scoped job listing projects only public states and enforces membership',
      async () => {
        const jobs = await api.listJobs(session, caseId)
        assert.ok(jobs.length > 1)
        assert.ok(
          jobs.every(
            (job) =>
              job.case_id === caseId &&
              ['queued', 'running', 'completed', 'partial', 'failed'].includes(job.state),
          ),
        )
        for (const actor of [noAccess, crossTenant])
          await assert.rejects(api.listJobs(actor, caseId), httpError(404))
      },
    )
    await t.test(
      'case quotas count only current versions and reject oversized files/pages/hash',
      async () => {
        while ((await api.list(session, caseId)).length < 10)
          await api.accept(session, caseId, randomUUID(), upload(await revision()))
        await assert.rejects(
          api.accept(session, caseId, 'eleventh', upload(await revision())),
          httpError(409),
        )
        await assert.rejects(
          api.accept(
            session,
            caseId,
            'large',
            upload(await revision(), { bytes: Buffer.alloc(10485761) }),
          ),
          httpError(413),
        )
        await assert.rejects(
          api.accept(session, caseId, 'pages', upload(await revision(), { pageCount: 11 })),
          httpError(422),
        )
        await assert.rejects(
          api.accept(session, caseId, 'hash', upload(await revision(), { sha256: '0'.repeat(64) })),
          httpError(422),
        )
        const active = await api.list(session, caseId)
        for (let n = 0; n < 2; n++)
          await api.accept(
            session,
            caseId,
            randomUUID(),
            upload(await revision(), {
              mode: 'replace',
              replacesDocumentId: active[n].id,
              pageCount: 10,
            }),
          )
        const current = await api.list(session, caseId)
        await assert.rejects(
          api.accept(
            session,
            caseId,
            'page-quota',
            upload(await revision(), {
              mode: 'replace',
              replacesDocumentId: current.find((d) => d.pages === 2).id,
              pageCount: 10,
            }),
          ),
          httpError(409),
        )
      },
    )
    await t.test(
      'identical concurrent accepts create one version/revision; expiry is rechecked after case lock wait',
      async () => {
        const target = (await api.list(session, caseId)).find((d) => d.pages === 2)
        const input = upload(await revision(), { mode: 'replace', replacesDocumentId: target.id })
        const both = await Promise.all([
          api.accept(session, caseId, 'parallel', input),
          api.accept(session, caseId, 'parallel', input),
        ])
        assert.deepEqual(both[0].body, both[1].body)
        assert.equal(both.filter((r) => r.replayed).length, 1)
        const short = await sessionFor(user, org, 250),
          blocker = await owner.query('BEGIN')
        try {
          await owner.query('SELECT id FROM aic.cases WHERE id=$1 FOR UPDATE', [caseId])
          const pending = assert.rejects(api.list(short, caseId), httpError(401))
          await new Promise((resolve) => setTimeout(resolve, 350))
          await owner.query('COMMIT')
          await pending
        } catch (error) {
          await owner.query('ROLLBACK')
          throw error
        }
      },
    )
    await t.test(
      'immutable object/document/raw/replay/audit triggers and tenant composite FK enforcement',
      async () => {
        for (const table of [
          'mvp_document_objects',
          'mvp_documents',
          'mvp_document_results',
          'mvp_document_replays',
          'audit_events',
        ])
          await assert.rejects(
            owner.query(`UPDATE aic.${table} SET created_at=created_at`),
            (error) => error.code === '55000',
          )
        const bytes = Buffer.from('synthetic'),
          hash = createHash('sha256').update(bytes).digest('hex')
        await assert.rejects(
          owner.query(
            'INSERT INTO aic.mvp_document_objects(organization_id,case_id,document_id,sha256,byte_size,bytes) VALUES($1,$2,$3,$4,$5,$6)',
            [otherOrg, caseId, randomUUID(), hash, bytes.length, bytes],
          ),
          (error) => error.code === '23503',
        )
        assert.equal(
          (
            await owner.query('SELECT has_table_privilege($1,$2,$3) allowed', [
              apiRole,
              'aic.users',
              'UPDATE',
            ])
          ).rows[0].allowed,
          false,
        )
        assert.equal(
          (
            await owner.query('SELECT has_function_privilege($1,$2,$3) allowed', [
              workerRole,
              'aic.lock_active_session(uuid,uuid,uuid,bigint)',
              'EXECUTE',
            ])
          ).rows[0].allowed,
          false,
        )
      },
    )
    await t.test(
      'expired replay cannot be reused or purged and current membership is checked before cached replay',
      async () => {
        const target = (await api.list(session, caseId)).find((d) => d.pages === 2)
        const shortApi = new PostgresDocumentRepository(db(apiPool), {
          ...config,
          idempotencyTtlMs: 1,
        })
        const input = upload(await revision(), { mode: 'replace', replacesDocumentId: target.id })
        await shortApi.accept(session, caseId, 'expired-key', input)
        await new Promise((resolve) => setTimeout(resolve, 10))
        await assert.rejects(shortApi.accept(session, caseId, 'expired-key', input), httpError(409))
        await assert.rejects(
          owner.query("DELETE FROM aic.mvp_document_replays WHERE key='expired-key'"),
          (error) => error.code === '55000',
        )
        await owner.query('DELETE FROM aic.case_memberships WHERE case_id=$1 AND user_id=$2', [
          caseId,
          user,
        ])
        await assert.rejects(api.accept(session, caseId, 'first', first), httpError(404))
      },
    )
  } finally {
    if (apiPool) await apiPool.end()
    if (workerPool) await workerPool.end()
    if (owner) await owner.end()
    if (databaseCreated) await admin.query(`DROP DATABASE ${database}`)
    if (rolesCreated) {
      await admin.query(`DROP ROLE ${apiRole}`)
      await admin.query(`DROP ROLE ${workerRole}`)
    }
    await admin.end()
  }
})
