const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { fixture, project, hash } = require('./acceptance-security/harness.cjs')
const { launcherEnv } = require('./acceptance-security/run-security-tests.cjs')
const { DossierRepository } = require('../dist/documents/dossier.repository')
const { PostgresDocumentRepository } = require('../dist/documents/postgres-document.repository')
const { readZipArchive } = require('../dist/documents/document-archive')
const { validateContract } = require('../dist/foundation/validation')

// Actual PG/SQL/grants/fencing; inspection metadata is deliberately supplied by
// this test. The separate HTTP suite exercises the actual PyMuPDF inspector.
test('dossier repository: actual PostgreSQL source capacity, atomicity, fencing and scheduler', { timeout: 180000 }, async (t) => {
  const f = await fixture(t)
  const config = { ...f.config, documentAiMode: 'mock' }
  const apiRole = (await f.apiDb.query('SELECT current_user AS name')).rows[0].name
  await f.owner.query(fs.readFileSync(path.join(project, 'apps/api/src/documents/dossier-runtime-grants.sql'), 'utf8')
    .replaceAll(':"api_role"', '"' + apiRole + '"'))
  const repo = new DossierRepository(f.apiDb, config)
  const docs = new PostgresDocumentRepository(f.apiDb, config)
  const worker = new PostgresDocumentRepository(f.workerDb, config)
  const python = path.join(project, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  const fixtureBytes = JSON.parse(execFileSync(python, ['-I', '-B', path.join(__dirname, 'dossier-fixtures.py'), '--include-pdf'],
    { windowsHide: true, env: launcherEnv(process.env), maxBuffer: 4 * 1024 * 1024 }))
  const zip = Buffer.from(fixtureBytes.thirty, 'base64'), pdf = Buffer.from(fixtureBytes.pdf, 'base64')
  const entries = await readZipArchive(zip, 'dossier')
  const enqueue = async (caseId, key = randomUUID(), data = zip) => repo.enqueue(f.session, caseId, key, data, await f.revision(caseId))
  const inspect = (a, pages = 1) => repo.inspected(a, { sha256: a.sha256, byte_size: a.bytes.length,
    page_count: pages, encrypted: false, has_embedded_files: false, mode: 'mock' })
  const caseId = await f.newCase()
  let accepted
  await t.test('raw admission/replay owns exact bytes; no synchronous manifest or extraction', async () => {
    accepted = await enqueue(caseId, 'first')
    validateContract('DossierAccepted', accepted)
    assert.equal(accepted.intake_state, 'queued')
    const source = (await f.owner.query('SELECT bytes FROM aic.mvp_dossier_archive_objects WHERE archive_id=$1', [accepted.archive_id])).rows[0].bytes
    assert.deepEqual(source, zip)
    assert.equal((await repo.get(f.session, accepted.archive_id)).members.length, 0)
    assert.deepEqual(await repo.enqueue(f.session, caseId, 'first', zip, 1), accepted)
    await assert.rejects(repo.enqueue(f.session, caseId, 'first', zip, 2), (e) => e.getResponse().code === 'IDEMPOTENCY_CONFLICT')
  })
  await t.test('manifest audit fault rolls back every member and byte; expired owner cannot publish after reclaim', async () => {
    const old = await repo.claim('old', 60000)
    assert.equal(old.archiveId, accepted.archive_id)
    const broken = new DossierRepository({ query: f.apiDb.query, transaction: (work) => f.apiDb.transaction((tx) => work({
      query: (sql, values) => { if (sql.includes('INSERT INTO aic.audit_events')) throw Error('Synthetic audit failure'); return tx.query(sql, values) },
    })) }, config)
    await assert.rejects(broken.manifest(old, entries), /Synthetic audit failure/)
    assert.equal((await repo.get(f.session, accepted.archive_id)).members.length, 0)
    await f.owner.query("UPDATE aic.mvp_dossier_archives SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [old.archiveId])
    const current = await repo.claim('current')
    assert.ok(current.fence > old.fence)
    assert.equal(await repo.manifest(old, entries), false)
    assert.equal(await repo.manifest(current, entries), true)
    const snapshot = await repo.get(f.session, accepted.archive_id)
    validateContract('DossierArchive', snapshot)
    assert.equal(snapshot.counters.registered, 30)
    assert.equal(snapshot.counters.awaiting_inspection, 30)
    assert.equal(snapshot.members.filter((m) => m.document_id).length, 0)
    assert.equal(new Set(snapshot.members.map((m) => m.id)).size, 30)
    assert.equal(new Set(snapshot.members.map((m) => m.sha256)).size, 29)
    assert.equal(await worker.claim('early-extraction', 60000, 3), null)
  })
  await t.test('thirty sources promote without bypassing old10/40 pool; source paths/years/subjects retained', async () => {
    for (let i = 0; i < 30; i++) {
      const attempt = await repo.claim('inspect')
      assert.equal(attempt.kind, 'member')
      assert.equal(await inspect(attempt), true)
    }
    const result = await repo.get(f.session, accepted.archive_id)
    validateContract('DossierArchive', result)
    assert.equal(result.intake_state, 'accepted')
    assert.equal(result.counters.queued, 30)
    assert.equal(result.counters.registered, 30)
    assert.equal(new Set(result.members.map((m) => m.period_suggestion.year)).size, 3)
    assert.ok(result.members.every((m) => m.subject_verification === 'unresolved' && m.classification_verification === 'unverified'))
    for (let i = 0; i < 10; i++) await docs.accept(f.session, caseId, 'legacy-' + i, {
      mode: 'new', type: 'other', sourceClass: 'synthetic', expectedRevision: await f.revision(caseId),
      displayName: 'legacy.pdf', bytes: pdf, sha256: hash(pdf), pageCount: 1, aiMode: 'mock',
    })
    await assert.rejects(docs.accept(f.session, caseId, 'legacy-over', {
      mode: 'new', type: 'other', sourceClass: 'synthetic', expectedRevision: await f.revision(caseId),
      displayName: 'legacy.pdf', bytes: pdf, sha256: hash(pdf), pageCount: 1, aiMode: 'mock',
    }), (e) => e.getResponse().code === 'DOCUMENT_CASE_QUOTA_EXCEEDED')
    assert.equal((await docs.list(f.session, caseId)).length, 40)
  })
  await t.test('128-source and 1024-page case boundaries retain review sources; replacement cannot bypass pages', async () => {
    const budgetCase = await f.newCase()
    let lastDocument, lastArchive
    for (const [archiveIndex, count] of [64, 39, 25, 1].entries()) {
      const ack = await enqueue(budgetCase)
      lastArchive = ack
      const items = Array.from({ length: count }, (_, index) => ({ ...entries[1], entry_index: index,
        entry_path: `2024/budget-${archiveIndex}-${index}.pdf` }))
      assert.equal(await repo.manifest(await repo.claim('budget-manifest'), items), true)
      if (archiveIndex < 3) for (let i = 0; i < count; i++) {
        const attempt = await repo.claim('budget-inspect')
        const pages = archiveIndex === 1 && i === 38 ? 4 : archiveIndex === 2 && i === 0 ? 11 :
          archiveIndex === 2 && i === 1 ? 500 : archiveIndex === 2 && i === 2 ? 501 : 10
        assert.equal(await inspect(attempt, pages), true)
      }
      if (archiveIndex === 3) await repo.claim('budget-finalize')
      const result = await repo.get(f.session, ack.archive_id)
      validateContract('DossierArchive', result)
      if (archiveIndex === 1) lastDocument = result.members.at(-1).document_id
      if (archiveIndex === 2) {
        assert.equal(result.intake_state, 'accepted')
        assert.equal(result.processing_state, 'finished_with_errors')
        assert.equal(result.counters.registered, 25)
        assert.equal(result.counters.needs_review, 25)
        assert.deepEqual(result.members.slice(0, 3).map((m) => m.error_code),
          ['PDF_REQUIRES_CHUNKED_PROCESSING', 'PDF_REQUIRES_CHUNKED_PROCESSING', 'PDF_PAGE_BUDGET'])
        for (const member of result.members) {
          assert.equal(member.document_id, null)
          assert.equal(member.job_id, null)
          assert.deepEqual((await repo.source(f.session, member.id)).bytes, Buffer.from(entries[1].data, 'base64'))
        }
      }
    }
    const rejected = await repo.get(f.session, lastArchive.archive_id)
    assert.equal(rejected.intake_state, 'rejected')
    assert.equal(rejected.members[0].error_code, 'DOSSIER_CASE_MEMBER_LIMIT')
    const snapshot = (await f.owner.query(`SELECT count(*)::int AS n,sum(d.pages)::int AS pages
      FROM aic.mvp_documents d WHERE case_id=$1`, [budgetCase])).rows[0]
    assert.deepEqual(snapshot, { n: 103, pages: 1024 })
    await assert.rejects(docs.accept(f.session, budgetCase, 'over-page-replacement', {
      mode: 'replace', replacesDocumentId: lastDocument, type: 'other', sourceClass: 'synthetic',
      expectedRevision: await f.revision(budgetCase), displayName: 'replacement.pdf', bytes: pdf,
      sha256: hash(pdf), pageCount: 10, aiMode: 'mock',
    }), (e) => e.getResponse().code === 'PDF_PAGE_BUDGET')
  })
  await t.test('dossier extraction globally2/percase1; leases expire and can recover', async () => {
    const make = async () => {
      const id = await f.newCase()
      await enqueue(id)
      const parse = await repo.claim('capacity-parse')
      assert.equal(await repo.manifest(parse, entries.slice(0, 1)), true)
      assert.equal(await inspect(await repo.claim('capacity-inspect')), true)
      return id
    }
    await make(); await make()
    const first = await worker.claim('one', 60000, 3)
    const second = await worker.claim('two', 60000, 3)
    assert.ok(first && second)
    assert.notEqual(first.caseId, second.caseId)
    await make() // A waiting dossier precedes the ready legacy case.
    const legacyCase = await f.newCase()
    await docs.accept(f.session, legacyCase, 'legacy-capacity', {
      mode: 'new', type: 'other', sourceClass: 'synthetic', expectedRevision: await f.revision(legacyCase),
      displayName: 'legacy.pdf', bytes: pdf, sha256: hash(pdf), pageCount: 1, aiMode: 'mock',
    })
    const legacy = await worker.claim('legacy-while-dossier-full', 60000, 3)
    assert.ok(legacy, 'Full dossier pool must not starve an unrelated legacy case')
    assert.equal(legacy.caseId, legacyCase)
    await worker.fail(legacy, 'PROVIDER_UNAVAILABLE', false, 3, false)
    assert.equal(await worker.claim('three', 60000, 3), null)
    await f.owner.query("UPDATE aic.mvp_document_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [first.jobId])
    const recovered = await worker.claim('recovered', 60000, 3)
    assert.ok(recovered)
    assert.equal(recovered.jobId, first.jobId)
    assert.ok(recovered.fence > first.fence)
    assert.equal(await worker.heartbeat(first, 60000), false)
    await worker.fail(recovered, 'PROVIDER_UNAVAILABLE', false, 3, false)
    await worker.fail(second, 'PROVIDER_UNAVAILABLE', false, 3, false)
  })
  await t.test('intake globally2/percase1; three attempts exhaust without unbounded retry', async () => {
    const one = await f.newCase(), two = await f.newCase(), three = await f.newCase()
    const ack = await enqueue(one)
    await enqueue(one); await enqueue(two); await enqueue(three)
    const first = await repo.claim('a'), second = await repo.claim('b')
    assert.ok(first && second)
    assert.notEqual(first.caseId, second.caseId)
    assert.equal(await repo.claim('c'), null)
    await repo.fail(first, 'ARCHIVE_READER_UNAVAILABLE', true)
    await repo.fail(second, 'ARCHIVE_INVALID_ZIP', false)
    // Exact named archive has a durable attempt budget regardless of restarts.
    await f.owner.query("UPDATE aic.mvp_dossier_archives SET parse_attempts=3,state='queued',worker_id=NULL,lease_expires_at=NULL WHERE id=$1", [ack.archive_id])
    for (let i = 0; i < 8; i++) {
      const a = await repo.claim('drain')
      if (a) await repo.fail(a, 'ARCHIVE_INVALID_ZIP', false)
    }
    assert.equal((await repo.get(f.session, ack.archive_id)).intake_state, 'rejected')
  })
  await t.test('128 MiB immutable member reservation rejects the next byte even after inspection rejection', async () => {
    const id = await f.newCase()
    const large = Buffer.alloc(10 * 1024 * 1024)
    large.write('%PDF-1.4 synthetic capacity fixture')
    const entry = (bytes, index) => ({ entry_index: index, entry_path: `capacity-${index}.pdf`,
      byte_size: bytes.length, sha256: hash(bytes), data: bytes.toString('base64'), rejection_code: null })
    const largeEntry = entry(large, 0)
    for (let part = 0; part < 3; part++) {
      const ack = await enqueue(id)
      const items = part < 2 ? Array.from({ length: 6 }, (_, index) => ({ ...largeEntry,
        entry_index: index, entry_path: `capacity-${index}.pdf` })) :
        [entry(large.subarray(0, 8 * 1024 * 1024), 0), entry(Buffer.from('%PDF-'), 1)]
      assert.equal(await repo.manifest(await repo.claim('byte-manifest'), items), true)
      const snapshot = await repo.get(f.session, ack.archive_id)
      if (part === 2) {
        assert.equal(snapshot.counters.registered, 1)
        assert.equal(snapshot.members[1].error_code, 'DOSSIER_CASE_BYTE_LIMIT')
        assert.equal(snapshot.members[1].source_url, null)
      }
      // Rejected parser output keeps its immutable reservation; the next
      // archive cannot reclaim those bytes by resetting logical counters.
      for (let n = 0; n < items.length + 2; n++) {
        if (['accepted', 'partially_accepted', 'rejected'].includes((await repo.get(f.session, ack.archive_id)).intake_state)) break
        const attempt = await repo.claim('byte-inspect')
        if (attempt) await repo.fail(attempt, 'PDF_INVALID', false)
      }
      assert.equal((await repo.get(f.session, ack.archive_id)).intake_state, 'rejected')
    }
    const stored = (await f.owner.query(`SELECT count(*)::int AS n,sum(octet_length(bytes))::int AS bytes
      FROM aic.mvp_dossier_member_objects WHERE case_id=$1`, [id])).rows[0]
    assert.deepEqual(stored, { n: 13, bytes: 128 * 1024 * 1024 })
  })
  await t.test('archive4/case remains bounded and every rejected archive is recoverable by GET', async () => {
    const id = await f.newCase()
    for (let i = 0; i < 4; i++) await enqueue(id)
    await assert.rejects(enqueue(id), (e) => e.getResponse().code === 'DOSSIER_CASE_ARCHIVE_LIMIT')
    const list = await repo.list(f.session, id)
    validateContract('DossierArchiveList', list)
    assert.equal(list.length, 4)
  })
})
