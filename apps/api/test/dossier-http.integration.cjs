// Lead runs this with scripts/test-local-postgres.cjs --test-concurrency=1.
// Real Nest/FastAPI/PyMuPDF/SQL/workers; synthetic fixtures and explicitly mock proposer.
// No standalone DB launcher, .env reads, live provider, FHI ingestion or browser claim.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn, execFileSync } = require('node:child_process')
const { randomBytes, randomUUID } = require('node:crypto')
const { performance } = require('node:perf_hooks')
const { fixture, privateDirectory, project, hash } = require('./acceptance-security/harness.cjs')
const { launcherEnv } = require('./acceptance-security/run-security-tests.cjs')
const { createApplication } = require('../dist/main')
const { loadConfig } = require('../dist/config/configuration')
const { hashPassword } = require('../dist/auth/password')
const { SessionService } = require('../dist/auth/session.service')
const { DossierRepository } = require('../dist/documents/dossier.repository')
const { DossierWorker } = require('../dist/documents/dossier-worker')
const { PostgresDocumentRepository } = require('../dist/documents/postgres-document.repository')
const { DocumentWorker } = require('../dist/documents/document-worker')
const { DocumentAiTransport } = require('../dist/ai-adapters/document-ai-transport')
const { PrivateDocumentFiles } = require('../dist/document-storage/private-files')
const { validateContract } = require('../dist/foundation/validation')

const terminalIntake = new Set(['accepted', 'partially_accepted', 'rejected'])
const intakeOutcomes = new Set(['idle', 'manifested', 'registered', 'review', 'rejected', 'failed', 'discarded', 'finished'])

test('dossier HTTP: durable 30/60-PDF intake, actual extraction/evidence, mixed outcomes and ACL',
  { timeout: 300000 }, async (t) => {
    const started = performance.now()
    let peakNodeRss = process.memoryUsage().rss
    const sampleRss = () => { peakNodeRss = Math.max(peakNodeRss, process.memoryUsage().rss) }
    const f = await fixture(t)
    const root = privateDirectory()
    const python = path.join(project, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    const runtime = path.join(__dirname, 'demo-zip-runtime.py')
    const childEnv = launcherEnv(process.env)
    const pythonJson = (args, input) => JSON.parse(execFileSync(python, ['-I', '-B', ...args], {
      input, env: childEnv, windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 30000,
    }))
    const encoded = pythonJson([path.join(__dirname, 'dossier-fixtures.py')])
    const fixtures = Object.fromEntries(Object.entries(encoded).map(([name, data]) => [name, Buffer.from(data, 'base64')]))
    // Independent stdlib ZIP reads provide byte-exact expected source data.
    function zipMembers(bytes) {
      const members = pythonJson(['-c',
        'import base64,io,json,sys,zipfile\n' +
        'with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:\n' +
        ' print(json.dumps({i.filename:base64.b64encode(z.read(i)).decode("ascii") for i in z.infolist() if not i.is_dir()}))'], bytes)
      return new Map(Object.entries(members).map(([name, data]) => [name, Buffer.from(data, 'base64')]))
    }
    const expected = { thirty: zipMembers(fixtures.thirty), sixty: zipMembers(fixtures.sixty), mixed: zipMembers(fixtures.mixed) }
    const apiRole = (await f.apiDb.query('SELECT current_user AS name')).rows[0].name
    assert.match(apiRole, /^aic_accept_api_[0-9a-f]+$/)
    await f.owner.query(fs.readFileSync(path.join(project, 'apps/api/src/documents/dossier-runtime-grants.sql'), 'utf8')
      .replaceAll(':"api_role"', '"' + apiRole + '"'))
    // Intake uses the API role; the existing extraction worker grants stay untouched.
    const password = 'Synthetic-' + randomUUID()
    await f.owner.query('UPDATE aic.users SET password_hash=$2 WHERE id=$1', [f.user, await hashPassword(password)])
    const username = (await f.owner.query('SELECT username FROM aic.users WHERE id=$1', [f.user])).rows[0].username
    const reservation = net.createServer()
    await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve) })
    const port = reservation.address().port
    await new Promise((resolve) => reservation.close(resolve))
    const internalKey = randomBytes(32).toString('hex')
    const ai = spawn(python, ['-I', '-B', runtime, 'serve', String(port), root], {
      env: { ...childEnv, INTERNAL_API_KEY: internalKey }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    })
    let aiError = '', spawnError = false, aiClosed = false
    ai.on('error', () => { spawnError = true })
    ai.stderr.on('data', (chunk) => { aiError = (aiError + chunk.toString()).slice(-1500) })
    const aiExit = new Promise((resolve) => ai.once('close', () => { aiClosed = true; resolve() }))
    const overrides = {
      NODE_ENV: 'test', DATABASE_URL: f.runtimeUrl(apiRole), AIC_RUNTIME_MODE: 'foundation',
      AIC_DOCUMENT_RUNTIME: 'local', AIC_DOCUMENT_AI_MODE: 'mock', AIC_STORAGE_DIR: root,
      AIC_AI_SERVICE_URL: 'http://127.0.0.1:' + port, INTERNAL_API_KEY: internalKey,
      AIC_FRONTEND_ORIGIN: 'http://127.0.0.1:3000', AIC_COOKIE_NAME: 'aic_dossier_http',
      AIC_IDEMPOTENCY_TTL_MS: '86400000', AIC_SESSION_TTL_MS: '3600000', AIC_SESSION_IDLE_MS: '3600000',
    }
    const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]))
    let app, base, config, cookie, auth, session
    try {
      let ready = false
      for (let i = 0; i < 100; i++) {
        if (spawnError || aiClosed) throw Error('Offline FastAPI failed to start: ' + aiError)
        try {
          const health = await fetch('http://127.0.0.1:' + port + '/healthz', { signal: AbortSignal.timeout(1000) })
          await health.arrayBuffer()
          if (health.status === 200) { ready = true; break }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.ok(ready, 'Actual loopback FastAPI listener must start')
      Object.assign(process.env, overrides)
      config = loadConfig()
      async function startApp() {
        app = await createApplication(config, true)
        await app.listen(0, '127.0.0.1')
        base = (await app.getUrl()) + '/api/v2'
      }
      function url(route) {
        assert.ok(route.startsWith('/') && !route.startsWith('//'))
        return route.startsWith('/api/v2/') ? new URL(base).origin + route : base + route
      }
      const request = (route, options = {}) => {
        sampleRss()
        return fetch(url(route), { signal: AbortSignal.timeout(60000), ...options,
          headers: { cookie, ...options.headers } })
      }
      async function json(response, status, schema) {
        const body = await response.json()
        assert.equal(response.status, status, JSON.stringify(body))
        if (schema) validateContract(schema, body)
        return body
      }
      const get = async (route, schema) => json(await request(route), 200, schema)
      async function login() {
        const response = await request('/auth/login', { method: 'POST', headers: {
          origin: config.frontendOrigin, 'content-type': 'application/json',
        }, body: JSON.stringify({ username, password }) })
        auth = await json(response, 200)
        cookie = response.headers.get('set-cookie').split(';')[0]
        session = await app.get(SessionService).resolve(cookie.slice(cookie.indexOf('=') + 1))
        assert.ok(session)
      }
      function upload(caseId, bytes, revision, key = randomUUID(), options = {}) {
        const form = new FormData()
        form.set('file', new Blob([bytes], { type: options.mime || 'application/zip' }), options.name || 'synthetic.zip')
        form.set('expected_revision', String(revision))
        return request('/cases/' + caseId + '/dossier-archives', { method: 'POST', headers: {
          origin: config.frontendOrigin, 'x-csrf-token': auth.csrf_token, 'idempotency-key': key,
          ...options.headers,
        }, body: form })
      }
      const accept = async (caseId, bytes, revision, key) =>
        json(await upload(caseId, bytes, revision, key), 202, 'DossierAccepted')
      async function count(table, caseId) {
        assert.ok(['mvp_dossier_archives', 'mvp_dossier_archive_objects', 'mvp_dossier_members',
          'mvp_dossier_member_objects', 'mvp_documents', 'mvp_document_jobs', 'mvp_document_results'].includes(table))
        return (await f.owner.query(`SELECT count(*)::int AS n FROM aic.${table} WHERE case_id=$1`, [caseId])).rows[0].n
      }
      await startApp()
      await login()
      const intakeRepo = new DossierRepository(f.apiDb, config)
      const documentRepo = new PostgresDocumentRepository(f.workerDb, config)
      const files = new PrivateDocumentFiles(root)
      const transport = new DocumentAiTransport({ baseURL: config.aiServiceUrl, internalKey,
        expectedMode: 'mock', contractsDirectory: path.join(project, 'packages/contracts') })
      const intake = new DossierWorker(intakeRepo, files, transport)
      const extraction = new DocumentWorker(documentRepo, files, transport,
        { leaseMs: 300000, maxAttempts: 3, automaticRetry: false })

      function assertCounters(archive) {
        const members = archive.members
        const counters = { discovered: members.length,
          registered: members.filter((m) => m.sha256 && m.intake_state !== 'rejected').length,
          rejected: members.filter((m) => m.intake_state === 'rejected').length,
          awaiting_inspection: members.filter((m) => ['awaiting_inspection', 'inspecting'].includes(m.intake_state)).length,
          queued: 0, running: 0, completed_with_usable_data: 0, completed_zero_usable: 0, failed: 0,
          needs_review: members.filter((m) => m.intake_state === 'needs_review' || m.processing_state === 'needs_review').length }
        for (const state of ['queued', 'running', 'completed_with_usable_data', 'completed_zero_usable', 'failed'])
          counters[state] = members.filter((m) => m.processing_state === state).length
        assert.deepEqual(archive.counters, counters, 'Counters describe the same complete member snapshot')
      }
      async function archive(ack) {
        const result = await get('/dossier-archives/' + ack.archive_id, 'DossierArchive')
        assert.equal(result.id, ack.archive_id)
        assert.equal(result.case_id, ack.case_id)
        assert.equal(result.archive_sha256, ack.archive_sha256)
        assertCounters(result)
        return result
      }
      async function finishIntake(ack) {
        for (let n = 0; n < 140; n++) {
          const progress = await archive(ack)
          if (terminalIntake.has(progress.intake_state)) return progress
          const outcome = await intake.once('dossier-http-intake')
          assert.ok(intakeOutcomes.has(outcome), outcome)
          // `idle` may perform durable finalization. Always poll the target again.
        }
        assert.fail('Intake did not reach a durable terminal state within 140 units')
      }
      async function source(member, expectedBytes) {
        assert.equal(member.source_url, '/api/v2/dossier-members/' + member.id + '/source')
        const response = await request(member.source_url)
        assert.equal(response.status, 200)
        assert.match(response.headers.get('content-type'), /^application\/pdf/)
        assert.equal(response.headers.get('x-source-sha256'), member.sha256)
        const bytes = Buffer.from(await response.arrayBuffer())
        assert.deepEqual(bytes, expectedBytes)
        assert.equal(hash(bytes), member.sha256)
        assert.equal(bytes.length, member.byte_size)
      }
      async function assertDurable(ack, progress) {
        const rows = (await f.owner.query(`SELECT id,entry_index,entry_path,state,sha256,document_id,job_id
          FROM aic.mvp_dossier_members WHERE archive_id=$1 ORDER BY entry_index`, [ack.archive_id])).rows
        assert.deepEqual(rows, progress.members.map((m) => ({ id: m.id, entry_index: m.entry_index,
          entry_path: m.entry_path, state: m.intake_state, sha256: m.sha256, document_id: m.document_id, job_id: m.job_id })))
        const list = await get('/cases/' + ack.case_id + '/dossier-archives', 'DossierArchiveList')
        const { members, ...summary } = progress
        assert.deepEqual(list.find((a) => a.id === ack.archive_id), summary)
      }
      async function drainExtraction(expectedCount) {
        let published = 0
        for (let n = 0; n <= expectedCount; n++) {
          const outcome = await extraction.once('dossier-http-extraction')
          sampleRss()
          if (outcome === 'idle') { assert.equal(published, expectedCount); return }
          assert.equal(outcome, 'published')
          published++
        }
        assert.fail('Extraction drain exceeded its exact expected job count')
      }

      let thirty, sixty, thirtyFinal, sixtyFinal, reviewed
      await t.test('CSRF, case ACL, request revision and 32 MiB limit fail without raw persistence', async () => {
        const caseId = await f.newCase()
        await json(await upload(caseId, fixtures.thirty, 1, 'csrf', { headers: { 'x-csrf-token': '' } }), 403)
        await json(await upload(caseId, fixtures.thirty, 2, 'revision'), 409)
        await json(await upload(caseId, fixtures.thirty, 1, 'mime', { mime: 'application/pdf' }), 422)
        await json(await upload(randomUUID(), fixtures.thirty, 1, 'absent-case'), 404)
        const tooLarge = Buffer.alloc(32 * 1024 * 1024 + 1)
        fixtures.unsafe.copy(tooLarge)
        const oversized = await upload(caseId, tooLarge, 1, 'over-32-mib')
        assert.equal(oversized.status, 413)
        await oversized.arrayBuffer()
        assert.equal(await count('mvp_dossier_archives', caseId), 0)
        assert.equal(await f.revision(caseId), 1)
      })
      await t.test('30-PDF concurrent first POST is raw-only, replay survives actual Nest restart', async () => {
        const caseId = await f.newCase()
        const responses = await Promise.all([upload(caseId, fixtures.thirty, 1, 'first-race'),
          upload(caseId, fixtures.thirty, 1, 'first-race')])
        thirty = await json(responses[0], 202, 'DossierAccepted')
        assert.deepEqual(await json(responses[1], 202, 'DossierAccepted'), thirty)
        assert.equal(thirty.archive_sha256, hash(fixtures.thirty))
        assert.equal(thirty.intake_state, 'queued')
        assert.equal(thirty.revision, 2)
        for (const table of ['mvp_dossier_members', 'mvp_dossier_member_objects', 'mvp_documents', 'mvp_document_jobs'])
          assert.equal(await count(table, caseId), 0, 'POST must persist only the raw archive')
        assert.equal(await count('mvp_dossier_archives', caseId), 1)
        const raw = (await f.owner.query('SELECT bytes,sha256 FROM aic.mvp_dossier_archive_objects WHERE archive_id=$1', [thirty.archive_id])).rows
        assert.equal(raw.length, 1)
        assert.deepEqual(raw[0].bytes, fixtures.thirty)
        assert.equal(raw[0].sha256, hash(raw[0].bytes))
        assert.equal((await archive(thirty)).members.length, 0)
        await app.close()
        app = undefined
        await startApp()
        session = await app.get(SessionService).resolve(cookie.slice(cookie.indexOf('=') + 1))
        assert.ok(session, 'Session must survive an actual app restart')
        const revision = await f.revision(caseId)
        assert.deepEqual(await accept(caseId, fixtures.thirty, 1, 'first-race'), thirty)
        assert.equal(await f.revision(caseId), revision, 'Replay must not advance the current revision')
        await json(await upload(caseId, fixtures.sixty, 1, 'first-race'), 409)
        await json(await upload(caseId, fixtures.thirty, revision, 'first-race'), 409)
        await json(await upload(caseId, fixtures.thirty, 1, 'stale-new-key'), 409)
      })
      for (const [name, total, jobs] of [['thirty', 30, 30], ['sixty', 60, 59]]) {
        await t.test(`${name}: complete durable manifest, exact sources, canonical IDs and honest queued labels`, async () => {
          const ack = name === 'thirty' ? thirty : await accept(await f.newCase(), fixtures.sixty, 1, 'sixty-main')
          if (name === 'sixty') sixty = ack
          assert.equal(await intake.once('manifest-' + name), 'manifested')
          const pending = await archive(ack)
          assert.equal(pending.members.length, total)
          assert.equal(pending.counters.registered, total)
          assert.equal(pending.counters.awaiting_inspection, total)
          assert.equal(pending.counters.queued, 0)
          assert.ok(pending.members.every((m) => !m.document_id && !m.job_id && m.processing_state === 'waiting'))
          await source(pending.members[0], expected[name].get(pending.members[0].entry_path))
          if (name === 'thirty') {
            // Real filesystem/loopback adapters may return a retryable failure.
            // Exercise the bounded durable retry instead of abandoning this
            // shared scenario and cascading failures into later archives.
            for (let attempt = 0; attempt < 3; attempt++) {
              const outcome = await intake.once('first-inspect')
              if (outcome === 'registered') break
              const retry = (await archive(ack)).members[0]
              assert.equal(outcome, 'failed', JSON.stringify(retry))
              assert.equal(retry.retryable, true, JSON.stringify(retry))
              assert.equal(retry.intake_state, 'awaiting_inspection', JSON.stringify(retry))
              t.diagnostic('First inspection recovered through durable retry: ' + retry.error_code)
              assert.ok(attempt < 2, 'First inspection must recover within its three-attempt budget')
            }
            assert.equal(await extraction.once('blocked-by-intake'), 'idle', 'Pending dossier intake blocks extraction in its case')
          }
          const result = await finishIntake(ack)
          assert.equal(result.intake_state, 'accepted')
          assert.equal(result.counters.discovered, total)
          assert.equal(result.counters.registered, total)
          assert.equal(result.counters.queued, jobs)
          assert.equal(result.counters.needs_review, total - jobs)
          assert.equal(result.counters.completed_with_usable_data + result.counters.completed_zero_usable, 0)
          assert.equal(await count('mvp_documents', ack.case_id), jobs)
          assert.equal(await count('mvp_document_jobs', ack.case_id), jobs)
          assert.equal(await count('mvp_document_results', ack.case_id), 0)
          const objects = (await f.owner.query(`SELECT o.member_id,o.bytes FROM aic.mvp_dossier_member_objects o
            JOIN aic.mvp_dossier_members m ON m.organization_id=o.organization_id AND m.case_id=o.case_id AND m.id=o.member_id
            WHERE m.archive_id=$1`, [ack.archive_id])).rows
          assert.equal(objects.length, total)
          const byId = new Map(objects.map((o) => [o.member_id, o.bytes]))
          for (const member of result.members) {
            assert.deepEqual(byId.get(member.id), expected[name].get(member.entry_path))
            assert.equal(hash(byId.get(member.id)), member.sha256)
            assert.equal(member.classification_verification, 'unverified')
            assert.equal(member.subject_verification, 'unresolved')
            assert.equal(member.period_suggestion.verification, 'unverified')
            if (member.page_count <= 10) {
              assert.ok(member.document_id && member.job_id)
              assert.equal(member.processing_state, 'queued')
            } else {
              assert.equal(member.page_count, 12)
              assert.equal(member.intake_state, 'needs_review')
              assert.equal(member.processing_state, 'needs_review')
              assert.equal(member.error_code, 'PDF_REQUIRES_CHUNKED_PROCESSING')
              assert.equal(member.document_id, null)
              assert.equal(member.job_id, null)
              await source(member, expected[name].get(member.entry_path))
              const summary = await get('/dossier-members/' + member.id + '/extraction-summary', 'DossierMemberSummary')
              assert.equal(summary.extraction, null)
            }
          }
          const duplicate = result.members.filter((m) => m.sha256 === result.members[0].sha256)
          assert.equal(duplicate.length, 2)
          assert.notEqual(duplicate[0].id, duplicate[1].id)
          assert.notEqual(duplicate[0].document_id, duplicate[1].document_id)
          assert.notEqual(duplicate[0].job_id, duplicate[1].job_id)
          await assertDurable(ack, result)
          const currentRevision = await f.revision(ack.case_id)
          assert.deepEqual(await accept(ack.case_id, fixtures[name], 1, name === 'thirty' ? 'first-race' : 'sixty-main'), ack)
          assert.equal(await f.revision(ack.case_id), currentRevision)
          if (name === 'thirty') thirtyFinal = result
          else sixtyFinal = result
        })
      }
      await t.test('89 real extraction jobs publish both usable and zero-usable results; evidence is source-bound', async () => {
        await drainExtraction(89)
        for (const ack of [thirty, sixty]) {
          const progress = await archive(ack)
          assert.equal(progress.intake_state, 'accepted')
          assert.equal(progress.processing_state, ack === sixty ? 'finished_with_errors' : 'finished')
          assert.ok(progress.counters.completed_with_usable_data > 0)
          assert.ok(progress.counters.completed_zero_usable > 0)
          assert.equal(progress.counters.queued + progress.counters.running + progress.counters.failed, 0)
          assert.equal(progress.counters.completed_with_usable_data + progress.counters.completed_zero_usable,
            ack === sixty ? 59 : 30)
          await assertDurable(ack, progress)
          for (const member of progress.members.filter((m) => m.document_id)) {
            const summary = await get('/dossier-members/' + member.id + '/extraction-summary', 'DossierMemberSummary')
            assert.equal(summary.document_id, member.document_id)
            assert.equal(summary.job_id, member.job_id)
            assert.equal(summary.extraction.source_hash, member.sha256)
            assert.equal(summary.extraction.document_version, 1)
            assert.equal(summary.extraction.ai_mode, 'mock')
            assert.equal(summary.extraction.verification, 'unverified')
            assert.equal(summary.extraction.outcome, member.processing_state === 'completed_zero_usable' ? 'zero_usable_fields' : 'ready_for_review')
          }
          const usable = progress.members.find((m) => m.processing_state === 'completed_with_usable_data' && m.suggested_type === 'contract')
          assert.ok(usable)
          const fields = await get('/documents/' + usable.document_id + '/extraction')
          const field = fields.find((item) => item.value !== null && item.evidence_refs.length)
          assert.ok(field)
          assert.notEqual(field.quality, 'human_reviewed')
          const evidence = await get('/evidence/' + field.evidence_refs[0])
          assert.equal(evidence.source_hash, usable.sha256)
          assert.equal(evidence.document_version, 1)
          assert.equal(evidence.page, 1)
          await source(usable, expected[ack === thirty ? 'thirty' : 'sixty'].get(usable.entry_path))
          if (ack === thirty) reviewed = { member: usable, field }
        }
        assert.deepEqual(fs.readdirSync(path.join(root, 'cache')), [])
      })
      await t.test('human verification requires explicit source review; usable extraction never verifies itself', async () => {
        const { member, field } = reviewed
        async function mutate(suffix, body, status = 200) {
          return json(await request('/documents/' + member.document_id + suffix, { method: 'POST', headers: {
            origin: config.frontendOrigin, 'x-csrf-token': auth.csrf_token, 'idempotency-key': randomUUID(),
            'content-type': 'application/json',
          }, body: JSON.stringify({ ...body, expected_revision: await f.revision(thirty.case_id) }) }), status,
          status === 200 ? 'DocumentDecisionOutput' : undefined)
        }
        const evidence_refs = field.evidence_refs
        const denied = await mutate('/verification', { field_key: field.field_key, evidence_refs,
          reason: 'Synthetic explicit verification before source review' }, 422)
        assert.equal(denied.code, 'FIELD_SOURCE_REVIEW_REQUIRED')
        await mutate('/classification', { declared_type: 'contract', subject_match: 'match', reviewed_pages: [1],
          evidence_refs, reason: 'Synthetic human reviewed original source and subject' })
        const accepted = await mutate('/verification', { field_key: field.field_key, evidence_refs,
          reason: 'Synthetic human confirms the cited source field' })
        assert.equal(accepted.decision.verification, 'human_reviewed')
        const after = await get('/documents/' + member.document_id + '/extraction')
        assert.equal(after.find((item) => item.field_key === field.field_key).quality, 'human_reviewed')
        assert.equal((await get('/dossier-members/' + member.id + '/extraction-summary', 'DossierMemberSummary')).extraction.verification, 'unverified')
        assert.equal((await f.owner.query('SELECT count(*)::int AS n FROM aic.mvp_financial_sets WHERE case_id=$1', [thirty.case_id])).rows[0].n, 0)
      })
      await t.test('mixed ZIP lists all 12 members: six unsupported, isolated malformed PDF and retained long source', async () => {
        const ack = await accept(await f.newCase(), fixtures.mixed, 1, 'mixed-main')
        const progress = await finishIntake(ack)
        assert.equal(progress.intake_state, 'partially_accepted')
        assert.deepEqual(progress.members.map((m) => m.entry_path), [...expected.mixed.keys()])
        assert.equal(progress.counters.discovered, 12)
        assert.equal(progress.counters.registered, 5)
        assert.equal(progress.counters.rejected, 7)
        assert.equal(progress.counters.needs_review, 1)
        assert.equal(progress.counters.queued, 4)
        for (const suffix of ['.xlsx', '.xls', '.jpg', '.png', '.rar', '.zip']) {
          const member = progress.members.find((m) => m.entry_path.endsWith(suffix))
          assert.ok(member, suffix)
          assert.equal(member.intake_state, 'rejected')
          assert.equal(member.processing_state, 'not_applicable')
          assert.equal(member.error_code, 'ARCHIVE_UNSUPPORTED_FORMAT')
          assert.equal(member.source_url, null)
          assert.equal(member.document_id, null)
          assert.equal(member.job_id, null)
        }
        const broken = progress.members.find((m) => m.entry_path.endsWith('contract_corrupt.pdf'))
        assert.equal(broken.intake_state, 'rejected')
        assert.equal(broken.error_code, 'PDF_INVALID')
        assert.equal(broken.document_id, null)
        assert.equal(broken.job_id, null)
        const long = progress.members.find((m) => m.page_count === 12)
        assert.ok(long)
        await source(long, expected.mixed.get(long.entry_path))
        await assertDurable(ack, progress)
        await drainExtraction(4)
        assert.equal((await archive(ack)).processing_state, 'finished_with_errors')
        t.diagnostic('Mixed member paths: ' + progress.members.map((m) => m.entry_path).join(', '))
      })
      await t.test('ZIP slip, corrupted PDF CRC, duplicate normalized paths and depth reject asynchronously without members', async () => {
        for (const [name, error] of [['unsafe', 'ARCHIVE_UNSAFE_PATH'], ['crc', 'ARCHIVE_INVALID_ZIP'],
          ['duplicate', 'ARCHIVE_DUPLICATE_PATH'], ['depth', 'ARCHIVE_UNSAFE_PATH']]) {
          const ack = await accept(await f.newCase(), fixtures[name], 1, 'attack-' + name)
          assert.equal((await archive(ack)).intake_state, 'queued')
          const rejected = await finishIntake(ack)
          assert.equal(rejected.intake_state, 'rejected')
          assert.equal(rejected.error_code, error)
          assert.equal(rejected.members.length, 0)
          for (const table of ['mvp_dossier_members', 'mvp_dossier_member_objects', 'mvp_documents', 'mvp_document_jobs'])
            assert.equal(await count(table, ack.case_id), 0)
        }
      })
      await t.test('background intake survives session logout; membership revocation hides replay, manifest, source and summary', async () => {
        const ack = await accept(await f.newCase(), fixtures.mixed, 1, 'logout-intake')
        await f.owner.query('UPDATE aic.sessions SET revoked_at=clock_timestamp() WHERE id=$1', [session.id])
        await json(await request('/dossier-archives/' + ack.archive_id), 401)
        // Worker authority is trusted database role + current account/case membership, not a browser session.
        for (let n = 0; n < 140; n++) {
          const state = (await f.owner.query('SELECT state FROM aic.mvp_dossier_archives WHERE id=$1', [ack.archive_id])).rows[0].state
          if (terminalIntake.has(state)) break
          assert.ok(intakeOutcomes.has(await intake.once('logged-out-intake')))
          if (n === 139) assert.fail('Logged-out background intake exceeded its bounded drain')
        }
        await login()
        const progress = await archive(ack)
        assert.equal(progress.intake_state, 'partially_accepted')
        assert.equal(progress.counters.queued, 4)
        await drainExtraction(4)
        const member = progress.members.find((m) => m.intake_state === 'needs_review')
        await source(member, expected.mixed.get(member.entry_path))
        await f.owner.query('DELETE FROM aic.case_memberships WHERE case_id=$1 AND user_id=$2', [ack.case_id, f.user])
        for (const route of ['/dossier-archives/' + ack.archive_id, '/cases/' + ack.case_id + '/dossier-archives',
          member.source_url, '/dossier-members/' + member.id + '/extraction-summary'])
          await json(await request(route), 404)
        await json(await upload(ack.case_id, fixtures.mixed, 1, 'logout-intake'), 404)
        await json(await request('/dossier-archives/' + thirty.archive_id, { headers: { cookie: '' } }), 401)
      })
      t.diagnostic(JSON.stringify({ mode: 'mock', synthetic_only: true, main_extraction_jobs: 89,
        thirty_sources: thirtyFinal.members.length, sixty_sources: sixtyFinal.members.length,
        duration_ms: Math.round(performance.now() - started), observed_peak_node_rss_bytes: peakNodeRss,
        note: 'Observed Node RSS only; excludes FastAPI/PostgreSQL and is not a process-tree peak.' }))
    } finally {
      try { if (app) await app.close() }
      finally {
        if (!aiClosed) ai.kill()
        let timer
        try { await Promise.race([aiExit, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Owned offline FastAPI child did not close')), 10000)
        })]) } finally {
          clearTimeout(timer)
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
          }
        }
      }
    }
  })
