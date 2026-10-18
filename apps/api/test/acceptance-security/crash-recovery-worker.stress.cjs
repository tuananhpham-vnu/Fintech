const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { fork } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { fixture, hash, privateDirectory } = require('./harness.cjs')
const { PostgresDocumentRepository } = require('../../dist/documents/postgres-document.repository')
const { PrivateDocumentFiles } = require('../../dist/document-storage/private-files')

// Repository-only, labelled synthetic payload. This suite does not claim live AI/schema acceptance.
const extraction = (a) => ({ schema_version: '1.0.2', document_id: a.documentId,
  case_id: a.caseId, sha256: a.sha256, pages: [{ page: 1 }], fields: [], evidence: [] })

function pauseChild(f, root) {
  const child = fork(path.join(__dirname, 'crash-child.cjs'), [], {
    windowsHide: true, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  let closed = false
  const exited = new Promise((resolve) => child.once('close', () => { closed = true; resolve() }))
  // Parent tracks the exact ChildProcess object; never enumerate/kill other Node or PostgreSQL PIDs.
  const stop = async () => {
    if (!closed) child.kill('SIGKILL')
    let timer
    try { await Promise.race([exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Owned crash child did not close')), 10000)
    })]) } finally { clearTimeout(timer) }
  }
  const paused = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Crash child did not reach extraction checkpoint')), 20000)
    const finish = (error, message) => { clearTimeout(timer); error ? reject(error) : resolve(message) }
    child.once('error', () => finish(Error('Crash child failed to start')))
    child.once('close', () => finish(Error('Crash child exited before extraction checkpoint')))
    child.once('message', (message) => message.type === 'paused-at-extract'
      ? finish(null, message) : finish(Error('Crash child failed before extraction checkpoint')))
  })
  child.send({ connectionString: f.runtimeUrl(f.workerRole), root, config: f.config })
  return { paused, stop }
}

test('ACCEPT-BE crash/fence/cache under actual worker grants', { timeout: 180000 }, async (t) => {
  const f = await fixture(t)
  const api = new PostgresDocumentRepository(f.apiDb, f.config)
  const worker = new PostgresDocumentRepository(f.workerDb, f.config)
  const root = privateDirectory(), files = new PrivateDocumentFiles(root)
  t.diagnostic('Private synthetic crash artifacts retained at ' + root)
  const leaseMs = 60000
  async function upload(kind = 'RECEIVABLE') {
    const caseId = await f.newCase(kind), bytes = Buffer.from('%PDF-1.7\nSYNTHETIC ACCEPTANCE ' + randomUUID() + '\n%%EOF')
    const accepted = await api.accept(f.session, caseId, randomUUID(), {
      mode: 'new', type: 'other', sourceClass: 'synthetic', expectedRevision: await f.revision(caseId),
      displayName: 'synthetic.pdf', bytes, sha256: hash(bytes), pageCount: 1, aiMode: 'mock',
    })
    assert.equal(accepted.status, 202)
    return { caseId, bytes, jobId: accepted.body.job.id, documentId: accepted.body.document.id }
  }
  const job = async (x) => (await f.owner.query('SELECT * FROM aic.mvp_document_jobs WHERE id=$1', [x.jobId])).rows[0]
  const expire = (x) => f.owner.query("UPDATE aic.mvp_document_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [x.jobId])
  const results = async (x) => (await f.owner.query('SELECT * FROM aic.mvp_document_results WHERE job_id=$1 ORDER BY fence,outcome', [x.jobId])).rows
  async function snapshot(x) {
    return { job: await job(x), results: await results(x), revision: await f.revision(x.caseId),
      audit: (await f.owner.query('SELECT * FROM aic.audit_events WHERE case_id=$1 ORDER BY id', [x.caseId])).rows }
  }
  for (const kind of ['RECEIVABLE', 'PREPAYMENT']) {
    await t.test(`${kind}: active lease prevents takeover; expired lease fences a live zombie`, async () => {
      const x = await upload(kind)
      const old = await worker.claim('old-worker', leaseMs, 3)
      assert.equal(old.jobId, x.jobId)
      assert.equal(old.fence, 1)
      assert.equal(await worker.claim('early-worker', leaseMs, 3), null)
      await expire(x)
      const current = await worker.claim('recovery-worker', leaseMs, 3)
      assert.equal(current.jobId, x.jobId)
      assert.equal(current.fence, 2)
      assert.deepEqual(current.bytes, x.bytes)
      const before = await snapshot(x)
      assert.equal(await worker.heartbeat(old, leaseMs), false)
      assert.equal(await worker.publish(old, extraction(old), 'mock'), false)
      assert.equal(await worker.fail(old, 'SYNTHETIC_FAILURE', true, 3), false)
      assert.deepEqual(await snapshot(x), before, 'Zombie calls must not mutate running replacement/audit/results')
      assert.equal(await worker.publish(current, extraction(current), 'mock'), true)
      assert.equal((await job(x)).state, 'succeeded')
      const published = await snapshot(x)
      assert.equal(await worker.publish(current, extraction(current), 'mock'), false)
      assert.equal(await worker.fail(old, 'SYNTHETIC_FAILURE', false, 3), false)
      assert.deepEqual(await snapshot(x), published)
      const outcomes = await results(x)
      assert.equal(outcomes.filter((r) => r.outcome === 'lease_expired' && Number(r.fence) === 1).length, 1)
      assert.equal(outcomes.filter((r) => r.outcome === 'published' && Number(r.fence) === 2).length, 1)
    })
    await t.test(`${kind}: three abandoned attempts become nonretryable ATTEMPTS_EXHAUSTED`, async () => {
      const x = await upload(kind)
      for (let i = 1; i <= 3; i++) {
        const a = await worker.claim('abandoned-' + i, leaseMs, 3)
        assert.equal(a.jobId, x.jobId)
        assert.equal(a.fence, i)
        await expire(x)
      }
      assert.equal(await worker.claim('fourth-attempt', leaseMs, 3), null)
      const state = await job(x)
      assert.equal(state.state, 'failed')
      assert.equal(state.error_code, 'ATTEMPTS_EXHAUSTED')
      assert.equal(state.attempts, 3)
      assert.equal(Number(state.fence), 3)
      assert.equal(state.retryable, false)
      assert.equal(state.lease_expires_at, null)
      assert.equal((await results(x)).filter((r) => r.outcome === 'lease_expired').length, 3)
      const before = await snapshot(x)
      assert.equal(await worker.claim('still-quarantined', leaseMs, 3), null)
      assert.deepEqual(await snapshot(x), before)
    })
    await t.test(`${kind}: real DocumentWorker child dies after materialize/heartbeat; committed job recovers`, async () => {
      const x = await upload(kind), child = pauseChild(f, root)
      let paused
      try {
        paused = await child.paused
        assert.equal(paused.attempt.jobId, x.jobId)
        assert.equal((await job(x)).state, 'running')
        const orphan = path.resolve(root, paused.storageKey)
        assert.ok(path.relative(root, orphan).startsWith('cache' + path.sep), 'Child cache must be confined')
        assert.deepEqual(fs.readFileSync(orphan), x.bytes)
        assert.equal(await worker.claim('before-child-crash', leaseMs, 3), null)
      } finally { await child.stop() }
      assert.equal((await job(x)).state, 'running', 'SIGKILL must leave the committed claim intact')
      await expire(x)
      const recovered = await worker.claim('after-child-crash', leaseMs, 3)
      assert.equal(recovered.jobId, x.jobId)
      assert.equal(recovered.fence, 2)
      const canonical = (await f.owner.query('SELECT bytes FROM aic.mvp_document_objects WHERE document_id=$1', [x.documentId])).rows[0].bytes
      assert.deepEqual(canonical, x.bytes)
      const materialized = await files.materialize(recovered.bytes, recovered.sha256)
      try {
        assert.notEqual(materialized.storageKey, paused.storageKey)
        assert.deepEqual(fs.readFileSync(path.join(root, materialized.storageKey)), x.bytes)
        assert.equal(await worker.publish(recovered, extraction(recovered), 'mock'), true)
      } finally { await materialized.release() }
      assert.deepEqual(fs.readFileSync(path.join(root, paused.storageKey)), x.bytes, 'Orphan remains untouched; no implicit retention policy')
      assert.equal((await job(x)).state, 'succeeded')
      assert.equal((await results(x)).filter((r) => r.outcome === 'published').length, 1)
    })
  }
  await t.test('cache restart tolerates orphan .tmp and read-only .pdf without modifying either', async () => {
    const tmp = path.join(root, 'cache', '.' + randomUUID() + '.tmp')
    const pdf = path.join(root, 'cache', randomUUID() + '.pdf')
    fs.writeFileSync(tmp, 'Synthetic partial bytes', { flag: 'wx', mode: 0o600 })
    fs.writeFileSync(pdf, 'Synthetic completed orphan', { flag: 'wx', mode: 0o400 })
    fs.chmodSync(pdf, 0o400)
    const before = [hash(fs.readFileSync(tmp)), hash(fs.readFileSync(pdf))]
    const bytes = Buffer.from('%PDF-1.7\nSynthetic restart\n%%EOF')
    const m = await new PrivateDocumentFiles(root).materialize(bytes, hash(bytes))
    assert.deepEqual(fs.readFileSync(path.join(root, m.storageKey)), bytes)
    await m.release()
    assert.equal(fs.existsSync(path.join(root, m.storageKey)), false)
    assert.deepEqual([hash(fs.readFileSync(tmp)), hash(fs.readFileSync(pdf))], before)
  })
})
