const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn, execFileSync } = require('node:child_process')
const { randomUUID, randomBytes } = require('node:crypto')
const { fixture, privateDirectory, project, hash } = require('./acceptance-security/harness.cjs')
const { launcherEnv } = require('./acceptance-security/run-security-tests.cjs')
const { createApplication } = require('../dist/main')
const { loadConfig } = require('../dist/config/configuration')
const { hashPassword } = require('../dist/auth/password')
const { SessionService } = require('../dist/auth/session.service')
const { PostgresDocumentRepository } = require('../dist/documents/postgres-document.repository')
const { DocumentWorker } = require('../dist/documents/document-worker')
const { DocumentAiTransport } = require('../dist/ai-adapters/document-ai-transport')
const { PrivateDocumentFiles } = require('../dist/document-storage/private-files')
const { validateContract } = require('../dist/foundation/validation')

test('ZIP -> actual Nest/FastAPI/PDF/worker/PostgreSQL, labelled offline proposer, least-privilege roles',
  { timeout: 180000 }, async (t) => {
    const f = await fixture(t)
    const root = privateDirectory()
    const python = path.join(project, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    const runtime = path.join(__dirname, 'demo-zip-runtime.py')
    const encoded = JSON.parse(execFileSync(python, ['-I', '-B', runtime, 'fixtures'], {
      env: launcherEnv(process.env), windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    }))
    const fixtures = Object.fromEntries(Object.entries(encoded).map(([key, bytes]) => [key, Buffer.from(bytes, 'base64')]))
    const reservation = net.createServer()
    await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve))
    const port = reservation.address().port
    await new Promise((resolve) => reservation.close(resolve))
    const internalKey = randomBytes(32).toString('hex')
    let ai = spawn(python, ['-I', '-B', runtime, 'serve', String(port), root], {
      env: { ...launcherEnv(process.env), INTERNAL_API_KEY: internalKey },
      windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    })
    let aiError = ''
    ai.stderr.on('data', (chunk) => { aiError += chunk.toString().slice(0, 500) })
    let app
    try {
      let ready = false
      for (let i = 0; i < 100; i++) {
        if (ai.exitCode !== null) throw Error('Offline FastAPI startup failed: ' + aiError)
        try {
          const health = await fetch('http://127.0.0.1:' + port + '/healthz')
          if (health.status === 200) { ready = true; break }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.ok(ready, 'Actual offline FastAPI listener')
      const apiRole = (await f.apiDb.query('SELECT current_user AS name')).rows[0].name
      const password = 'Synthetic-' + randomUUID()
      await f.owner.query('UPDATE aic.users SET password_hash=$2 WHERE id=$1', [f.user, await hashPassword(password)])
      const username = (await f.owner.query('SELECT username FROM aic.users WHERE id=$1', [f.user])).rows[0].username
      Object.assign(process.env, {
        NODE_ENV: 'test', DATABASE_URL: f.runtimeUrl(apiRole), AIC_RUNTIME_MODE: 'foundation',
        AIC_DOCUMENT_RUNTIME: 'local', AIC_DOCUMENT_AI_MODE: 'mock', AIC_STORAGE_DIR: root,
        AIC_AI_SERVICE_URL: 'http://127.0.0.1:' + port, INTERNAL_API_KEY: internalKey,
        AIC_IDEMPOTENCY_TTL_MS: '86400000',
      })
      const config = loadConfig()
      app = await createApplication(config, true)
      await app.listen(0, '127.0.0.1')
      const base = (await app.getUrl()) + '/api/v2'
      const login = await fetch(base + '/auth/login', { method: 'POST',
        headers: { origin: config.frontendOrigin, 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }) })
      assert.equal(login.status, 200)
      const auth = await login.json()
      const cookie = login.headers.get('set-cookie').split(';')[0]
      const session = await app.get(SessionService).resolve(cookie.split('=')[1])
      const repository = new PostgresDocumentRepository(f.apiDb, config)
      const workerRepository = new PostgresDocumentRepository(f.workerDb, config)
      const files = new PrivateDocumentFiles(root)
      const transport = new DocumentAiTransport({ baseURL: config.aiServiceUrl, internalKey,
        expectedMode: 'mock', contractsDirectory: path.join(project, 'packages/contracts') })
      const worker = new DocumentWorker(workerRepository, files, transport, { leaseMs: 300000, maxAttempts: 3, automaticRetry: false })
      function upload(caseId, bytes, revision = 1, key = randomUUID(), options = {}) {
        const form = new FormData()
        form.set('file', new Blob([bytes], { type: options.mime || 'application/zip' }), options.name || 'synthetic.zip')
        form.set('expected_revision', String(revision))
        return fetch(base + '/cases/' + caseId + '/document-archives', { method: 'POST',
          headers: { cookie, origin: config.frontendOrigin, 'x-csrf-token': auth.csrf_token,
            'idempotency-key': key, ...options.headers }, body: form })
      }
      async function get(route) {
        const response = await fetch(base + route, { headers: { cookie } })
        assert.equal(response.status, 200, route)
        return response.json()
      }
      let receipt, mainCase
      await t.test('4 PDFs + unsupported XLSX + 11-page PDF; per-file reasons and no model call during upload', async () => {
        mainCase = await f.newCase()
        const response = await upload(mainCase, fixtures.zip, 1, 'zip-main')
        assert.equal(response.status, 202, JSON.stringify(await response.clone().json()))
        receipt = await response.json()
        validateContract('ArchiveImportOutput', receipt)
        assert.equal(receipt.archive_sha256, hash(fixtures.zip))
        assert.equal(receipt.state, 'partial')
        assert.equal(receipt.revision, 5)
        assert.equal(receipt.items.length, 6)
        assert.deepEqual(receipt.items.map((i) => i.status), ['accepted', 'accepted', 'accepted', 'accepted', 'rejected', 'rejected'])
        assert.deepEqual(receipt.items.slice(0, 4).map((i) => i.group), ['financial_statements', 'contracts', 'tax', 'payments'])
        assert.equal(receipt.items[4].rejection.code, 'ARCHIVE_UNSUPPORTED_FORMAT')
        assert.equal(receipt.items[5].rejection.code, 'DOCUMENT_PAGE_LIMIT')
        assert.ok(receipt.items.slice(0, 4).every((i) => i.job.state === 'queued' && i.job.mode === 'mock'))
        assert.equal((await f.owner.query('SELECT count(*)::int n FROM aic.mvp_document_results')).rows[0].n, 0)
        const objects = (await f.owner.query('SELECT bytes,sha256 FROM aic.mvp_document_objects WHERE case_id=$1', [mainCase])).rows
        assert.equal(objects.length, 4)
        assert.ok(objects.every((o) => hash(o.bytes) === o.sha256))
        assert.deepEqual(fs.readdirSync(path.join(root, 'cache')), [])
      })
      await t.test('same-key concurrent replay is exact; changed bytes/revision conflict', async () => {
        const replies = await Promise.all([upload(mainCase, fixtures.zip, 1, 'zip-main'), upload(mainCase, fixtures.zip, 1, 'zip-main')])
        for (const reply of replies) { assert.equal(reply.status, 202); assert.deepEqual(await reply.json(), receipt) }
        assert.equal((await upload(mainCase, fixtures.safe, 1, 'zip-main')).status, 409)
        assert.equal((await upload(mainCase, fixtures.zip, 5, 'zip-main')).status, 409)
        assert.equal((await upload(mainCase, fixtures.safe, 1, 'stale-revision')).status, 409)
        assert.equal((await repository.list(session, mainCase)).length, 4)
      })
      await t.test('unsafe archive is atomic; CSRF, MIME and case ACL fail before persistence', async () => {
        const caseId = await f.newCase('PREPAYMENT')
        for (const [data, expected, options] of [
          [fixtures.unsafe, 422, {}], [fixtures.zip, 403, { headers: { 'x-csrf-token': '' } }],
          [fixtures.zip, 422, { mime: 'application/pdf' }],
        ]) assert.equal((await upload(caseId, data, 1, randomUUID(), options)).status, expected)
        assert.equal((await upload(randomUUID(), fixtures.zip)).status, 404)
        assert.equal((await repository.list(session, caseId)).length, 0)
        assert.equal(await f.revision(caseId), 1)
      })
      await t.test('worker crosses actual HTTP/native PDF/guard/publication; zero fields is explicit; sources/evidence bound', async () => {
        for (let i = 0; i < 4; i++) assert.equal(await worker.once('zip-offline-worker'), 'published')
        assert.equal(await worker.once('zip-offline-worker'), 'idle')
        for (const item of receipt.items.slice(0, 4)) {
          const job = await get('/jobs/' + item.job.id)
          assert.equal(job.state, 'completed')
          const summary = await get('/documents/' + item.document.id + '/extraction-summary')
          validateContract('ExtractionSummary', summary)
          assert.equal(summary.source_hash, item.document.hash)
          assert.equal(summary.document_version, 1)
          assert.equal(summary.verification, 'unverified')
          assert.equal(summary.outcome, ['contracts', 'payments'].includes(item.group) ? 'ready_for_review' : 'zero_usable_fields')
          const source = await fetch(base + '/documents/' + item.document.id + '/source', { headers: { cookie } })
          assert.equal(source.status, 200)
          assert.equal(source.headers.get('x-source-sha256'), item.document.hash)
          assert.equal(hash(Buffer.from(await source.arrayBuffer())), item.document.hash)
          const fields = await get('/documents/' + item.document.id + '/extraction')
          for (const field of fields.filter((f) => f.value !== null)) {
            assert.ok(field.evidence_refs.length)
            const evidence = await get('/evidence/' + field.evidence_refs[0])
            assert.equal(evidence.document_version, 1)
            assert.equal(evidence.source_hash, item.document.hash)
            assert.equal(evidence.page, 1)
          }
        }
        const detail = await get('/cases/' + mainCase)
        validateContract('Case', detail)
        assert.equal(detail.documents.length, 4)
        assert.deepEqual(fs.readdirSync(path.join(root, 'cache')), [])
      })
      await t.test('all rejected is an explicit frozen receipt and preserves case revision', async () => {
        const caseId = await f.newCase()
        const response = await upload(caseId, fixtures.rejected, 1, 'all-rejected')
        assert.equal(response.status, 202)
        const result = await response.json()
        validateContract('ArchiveImportOutput', result)
        assert.equal(result.state, 'rejected')
        assert.equal(result.revision, 1)
        assert.equal(result.items[1].rejection.code, 'PDF_INVALID')
        assert.equal((await repository.list(session, caseId)).length, 0)
      })
      await t.test('simultaneous first imports with same key create exactly one batch', async () => {
        const caseId = await f.newCase()
        const responses = await Promise.all([upload(caseId, fixtures.safe, 1, 'first-race'), upload(caseId, fixtures.safe, 1, 'first-race')])
        const receipts = []
        for (const response of responses) { assert.equal(response.status, 202); receipts.push(await response.json()) }
        assert.deepEqual(receipts[0], receipts[1])
        assert.equal((await repository.list(session, caseId)).length, 4)
        assert.equal(await f.revision(caseId), 5)
        // ACL is rechecked before replay and summary, even with a valid session.
        await f.owner.query('DELETE FROM aic.case_memberships WHERE case_id=$1 AND user_id=$2', [caseId, f.user])
        assert.equal((await upload(caseId, fixtures.safe, 1, 'first-race')).status, 404)
        assert.equal((await fetch(base + '/documents/' + receipts[0].items[0].document.id + '/extraction-summary', { headers: { cookie } })).status, 404)
      })
      await t.test('receipt persistence failure rolls back bytes, jobs, audit and revisions together', async () => {
        const caseId = await f.newCase()
        const brokenDb = { query: f.apiDb.query,
          transaction: (work) => f.apiDb.transaction((tx) => work({ query: (sql, values) => {
            if (/INSERT INTO aic\.idempotency_keys/.test(sql)) throw Error('Synthetic receipt storage fault')
            return tx.query(sql, values)
          } })) }
        const broken = new PostgresDocumentRepository(brokenDb, config)
        const input = { sha256: hash(fixtures.safe), expectedRevision: 1 }
        await assert.rejects(broken.acceptArchive(session, caseId, 'rollback', input, [{
          entry_index: 0, entry_path: 'source.pdf', group: 'other', suggested_type: 'other',
          classification_verification: 'unverified', rejection: null,
          upload: { mode: 'new', type: 'other', sourceClass: 'synthetic', expectedRevision: 1,
            displayName: 'source.pdf', bytes: fixtures.pdf, sha256: hash(fixtures.pdf), pageCount: 1, aiMode: 'mock' },
        }]), /Synthetic receipt storage fault/)
        assert.equal(await f.revision(caseId), 1)
        for (const table of ['mvp_documents', 'mvp_document_objects', 'mvp_document_jobs'])
          assert.equal((await f.owner.query(`SELECT count(*)::int n FROM aic.${table} WHERE case_id=$1`, [caseId])).rows[0].n, 0)
        assert.equal(await repository.replayArchive(session, caseId, 'rollback', input), null)
        assert.equal((await f.owner.query("SELECT count(*)::int n FROM aic.audit_events WHERE case_id=$1 AND action LIKE 'document.%'", [caseId])).rows[0].n, 0)
      })
      await t.test('case document/page caps remain enforced per member', async () => {
        const caseId = await f.newCase('PREPAYMENT')
        const prepared = Array.from({ length: 7 }, (_, index) => ({
          entry_index: index, entry_path: 'quota-' + index + '.pdf', group: 'other', suggested_type: 'other',
          classification_verification: 'unverified', rejection: null,
          upload: { mode: 'new', type: 'other', sourceClass: 'synthetic', expectedRevision: 1,
            displayName: 'quota-' + index + '.pdf', bytes: fixtures.pdf, sha256: hash(fixtures.pdf), pageCount: 1, aiMode: 'mock' },
        }))
        const prefill = await repository.acceptArchive(session, caseId, 'quota-prefill', { sha256: hash(Buffer.from('quota')), expectedRevision: 1 }, prepared)
        const response = await upload(caseId, fixtures.safe, prefill.revision)
        const result = await response.json()
        assert.equal(response.status, 202, JSON.stringify(result))
        assert.deepEqual(result.items.map((i) => i.status), ['accepted', 'accepted', 'accepted', 'rejected'])
        assert.equal(result.items[3].rejection.code, 'DOCUMENT_CASE_QUOTA_EXCEEDED')
        assert.equal((await repository.list(session, caseId)).length, 10)
      })
      await t.test('40 active pages/case is enforced using actual eight-page PDFs', async () => {
        const caseId = await f.newCase()
        const response = await upload(caseId, fixtures.pages)
        const result = await response.json()
        assert.equal(response.status, 202, JSON.stringify(result))
        validateContract('ArchiveImportOutput', result)
        assert.deepEqual(result.items.map((i) => i.status), ['accepted', 'accepted', 'accepted', 'accepted', 'accepted', 'rejected'])
        assert.equal(result.items[5].rejection.code, 'DOCUMENT_CASE_QUOTA_EXCEEDED')
        assert.equal((await repository.list(session, caseId)).reduce((n, d) => n + d.pages, 0), 40)
      })
      await t.test('provider unavailable stays failure with bounded retry; replay survives actual service restart', async () => {
        // Drain the quota test's jobs through the same actual extraction path.
        let drained = 0
        while (true) {
          const state = await worker.once('quota-offline-worker')
          if (state === 'idle') break
          assert.equal(state, 'published')
          assert.ok(++drained <= 20, 'Bounded worker drain')
        }
        assert.equal(drained, 19)
        const caseId = await f.newCase()
        const response = await upload(caseId, fixtures.safe, 1, 'provider-stop')
        const result = await response.json()
        assert.equal(response.status, 202)
        ai.kill()
        await new Promise((resolve) => ai.once('exit', resolve))
        ai = undefined
        assert.equal(await worker.once('unavailable-worker'), 'failed')
        const failed = await get('/jobs/' + result.items[0].job.id)
        assert.equal(failed.state, 'failed')
        assert.equal(failed.errors[0].code, 'AI_SERVICE_UNAVAILABLE')
        assert.equal(failed.attempts, 1)
        const summary = await get('/documents/' + result.items[0].document.id + '/extraction-summary')
        assert.equal(summary.outcome, 'failed')
        const replay = await upload(caseId, fixtures.safe, 1, 'provider-stop')
        assert.equal(replay.status, 202)
        assert.deepEqual(await replay.json(), result)
        const rejected = await upload(await f.newCase(), fixtures.safe)
        assert.equal(rejected.status, 202)
        const rejectedBody = await rejected.json()
        assert.equal(rejectedBody.state, 'rejected')
        assert.ok(rejectedBody.items.every((i) => i.rejection.code === 'AI_SERVICE_UNAVAILABLE' && i.rejection.retryable))
      })
      t.diagnostic('Synthetic offline HTTP evidence: 4 PDFs accepted, 2 rejections; actual worker/SQL/source/hash/zero/provider tests. No live model or browser claim.')
    } finally {
      if (app) await app.close()
      if (ai) { ai.kill(); await new Promise((resolve) => ai.once('exit', resolve)) }
    }
  })
