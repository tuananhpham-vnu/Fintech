// Opt-in smoke against the isolated QA harness, never the production backend.
require('../helpers/register-typescript.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { writeReport } = require('../../scripts/lib/report.cjs')
const path = require('node:path')
const { authApi } = require('../../src/features/auth/api.ts')
const { counterpartiesApi } = require('../../src/features/counterparties/api.ts')
const { casesApi } = require('../../src/features/cases/api.ts')
const { documentsApi } = require('../../src/features/documents/api.ts')
const { evidenceApi } = require('../../src/features/evidence/api.ts')
const { reviewApi } = require('../../src/features/review/api.ts')
const { assessmentsApi } = require('../../src/features/assessments/api.ts')
const { historyApi } = require('../../src/features/history/api.ts')
const { questionnairesApi } = require('../../src/features/questionnaires/api.ts')
const { buildUploadForm } = require('../../src/features/documents/schemas.ts')
const { buildTransactionInput } = require('../../src/features/cases/schemas.ts')
const { setCsrfToken, MutationKey } = require('../../src/lib/api/client.ts')
const { origin: base, uiPort } = require('../../scripts/qa/config.cjs')
const originalFetch = global.fetch
const checks = []
async function check(name, fn) {
  await fn()
  checks.push({ name, passed: true })
  console.log('PASS ' + name)
}
async function main() {
  const probe = await originalFetch(base + '/api/v2/auth/me')
  assert.equal(
    probe.headers.get('x-aic-test-harness'),
    'SYNTHETIC-QA-ONLY',
    'Refuse non-QA service',
  )
  await check(
    'Actual Next proxy fails closed without an AIC backend and hides private AI routes',
    async () => {
      const origin = `http://127.0.0.1:${uiPort}`
      const unavailable = await originalFetch(origin + '/api/v2/auth/me')
      assert.equal(unavailable.status, 503)
      assert.equal((await unavailable.json()).code, 'BACKEND_NOT_CONFIGURED')
      const blocked = await originalFetch(origin + '/api/v2/auth/login', {
        method: 'POST',
        headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' },
        body: '{}',
      })
      assert.equal(blocked.status, 403)
      assert.equal((await blocked.json()).code, 'ORIGIN_REJECTED')
      const privateRoute = await originalFetch(origin + '/api/v2/internal/v2/analyze')
      assert.equal(privateRoute.status, 404)
    },
  )
  let cookie = ''
  global.fetch = async (url, options = {}) => {
    const headers = new Headers(options.headers)
    if (options.credentials !== 'omit' && cookie) headers.set('Cookie', cookie)
    if (options.method && options.method !== 'GET') headers.set('Origin', base)
    const res = await originalFetch(new URL(url, base), { ...options, headers })
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0]
    return res
  }
  await check('Next production login SSR and same-origin UI assets are served', async () => {
    const res = await originalFetch(base + '/login'),
      html = await res.text()
    assert.equal(res.status, 200)
    assert.ok(html.includes('Username') && html.includes('Sign in'))
    assert.ok(html.includes('/_next/static/'))
    const stylesheet = html.match(/href="([^" ]+\.css(?:\?[^" ]*)?)"/)
    assert.ok(stylesheet)
    assert.equal(
      (await originalFetch(new URL(stylesheet[1].replaceAll('&amp;', '&'), base))).status,
      200,
    )
  })
  await check(
    'Retired preview routes/assets return 404 and the local PDF worker remains available',
    async () => {
      for (const path of [
        '/public-sources',
        '/questionnaire/retired-case',
        '/placeholder-logo.png',
        '/demo-files/contract.pdf',
      ]) {
        assert.equal((await originalFetch(base + path)).status, 404, path)
      }
      const worker = await originalFetch(base + '/pdfjs/pdf.worker.min.mjs')
      assert.equal(worker.status, 200)
      assert.deepEqual(
        Buffer.from(await worker.arrayBuffer()),
        fs.readFileSync(path.join(__dirname, '../../public/pdfjs/pdf.worker.min.mjs')),
      )
    },
  )
  await check('Auth feature adapter accepts only QA session; wrong login rejected', async () => {
    await assert.rejects(authApi.login('invalid', 'invalid'), (e) => e.status === 401)
    const session = await authApi.login('qa.specialist', 'TestOnly#2026')
    assert.equal(session.user.role, 'specialist')
    setCsrfToken(session.csrf_token)
    assert.equal((await authApi.me()).user.id, session.user.id)
  })
  const tag = 'REFACTOR-' + Date.now(),
    keys = new MutationKey()
  let party, created, detail
  await check('Counterparty feature create/edit preserves leading-zero ID', async () => {
    const input = {
      name: tag,
      country: 'VN',
      tax_id: '0001234567',
      industry_code: null,
      source_refs: [],
    }
    party = await counterpartiesApi.createCounterparty(input, keys.for('party', input))
    assert.equal(party.tax_id, '0001234567')
    const update = { ...input, name: tag + ' edited', expected_revision: party.revision }
    party = await counterpartiesApi.updateCounterparty(party.id, update, keys.for('update', update))
    assert.equal(party.name, update.name)
  })
  await check('Cases adapter creates both core exposures with domain role pairs', async () => {
    for (const kind of ['RECEIVABLE', 'PREPAYMENT']) {
      const input = buildTransactionInput({
        kind,
        party: party.id,
        amount: '900719925474099312345',
        term: '30',
        reference: tag,
        stage: 'proposed',
      })
      created = await casesApi.createCase(input, keys.for('case-' + kind, input))
      assert.equal(created.exposure_kind, kind)
      assert.equal(created.exposure.amount_vnd, input.exposure.amount_vnd)
    }
    detail = await casesApi.detail(created.id)
  })
  await check('Exposure 409 requires a fresh revision and a manual second write', async () => {
    const exposure = { ...detail.exposure, amount_vnd: '300000000' }
    let body = { exposure, expected_revision: detail.revision }
    await assert.rejects(
      casesApi.exposure(detail.id, body, keys.for('exposure', body)),
      (e) => e.status === 409,
    )
    detail = await casesApi.detail(detail.id)
    body = { exposure, expected_revision: detail.revision }
    await casesApi.exposure(detail.id, body, keys.for('exposure', body))
    detail = await casesApi.detail(detail.id)
    assert.equal(detail.exposure.amount_vnd, '300000000')
  })
  await check(
    'Documents adapter uploads multipart; source bytes and extraction stay immutable',
    async () => {
      const bytes = fs.readFileSync(path.join(__dirname, '../fixtures/pdf/contract.pdf'))
      const file = new File([bytes], 'refactor-qa.pdf', { type: 'application/pdf' })
      const form = await buildUploadForm({
        file,
        type: 'contract',
        mode: 'new',
        sourceClass: 'SYNTHETIC_QA',
        target: '',
        revision: detail.revision,
      })
      await documentsApi.upload(detail.id, form, crypto.randomUUID())
      detail = await casesApi.detail(detail.id)
      const doc = detail.documents.at(-1)
      assert.equal(
        Buffer.compare(Buffer.from(await (await evidenceApi.source(doc.id)).arrayBuffer()), bytes),
        0,
      )
      const fields = await documentsApi.extraction(doc.id)
      assert.equal(fields[1].value, null)
      assert.equal(fields[1].raw_value, null)
      const source = await evidenceApi.evidence(fields[0].evidence_refs[0])
      assert.equal(source.document_version, doc.version)
      assert.equal(source.source_hash, doc.hash)
      // Wait is bounded test-service synchronization, not fabricated progress.
      await new Promise((resolve) => setTimeout(resolve, 550))
      detail = await casesApi.detail(detail.id)
    },
  )
  let run
  await check('Review runs independently while numeric method remains unconfigured', async () => {
    const readiness = await assessmentsApi.readiness(detail.id)
    assert.equal(readiness.numeric_assessment_allowed, false)
    await reviewApi.run(detail.id, { expected_revision: detail.revision }, keys)
    detail = await casesApi.detail(detail.id)
    await new Promise((resolve) => setTimeout(resolve, 550))
    run = await reviewApi.review(detail.latest_review_run_id)
    assert.equal(run.state, 'completed')
    assert.equal(run.findings[0].rule_id, 'AIC-R05')
    const finding = run.findings[0]
    await reviewApi.decide(
      finding.id,
      {
        expected_revision: detail.revision,
        action: 'resolve',
        reason: 'QA reference accepted',
        evidence_refs: finding.evidence_refs,
      },
      keys,
    )
    assert.equal((await reviewApi.review(run.id)).findings[0].finding_state, 'verified_resolved')
  })
  await check('Waiver/revocation and history keep factual findings separate', async () => {
    await reviewApi.waive(
      detail.id,
      {
        expected_revision: detail.revision,
        requirement_key: 'transaction.acceptance_record',
        reason: 'QA waiver',
      },
      crypto.randomUUID(),
    )
    detail = await casesApi.detail(detail.id)
    const waiver = detail.waivers.at(-1)
    assert.equal(detail.findings[0].handling_state, 'waived')
    await reviewApi.revoke(
      waiver.id,
      { expected_revision: detail.revision, reason: 'QA revoke' },
      keys,
    )
    detail = await casesApi.detail(detail.id)
    const history = await historyApi.history(detail.id)
    assert.ok(history.items.some((event) => event.action === 'waiver_revoked'))
  })
  await check(
    'Questionnaire capability adapter reads scoped fields and rejects invalid token',
    async () => {
      const form = await questionnairesApi.respondentForm('qa-capability-only')
      assert.equal(form.questions.length, 2)
      await assert.rejects(questionnairesApi.respondentForm('invalid'), (e) => e.status === 404)
    },
  )
  await check('Configured QA assessment returns result and records acknowledgement', async () => {
    const caseId = '00000000-0000-4000-8000-000000000013'
    const snapshot = await casesApi.detail(caseId)
    await assessmentsApi.run(caseId, { expected_revision: snapshot.revision }, keys)
    await new Promise((resolve) => setTimeout(resolve, 550))
    const next = await casesApi.detail(caseId),
      result = await assessmentsApi.assessment(next.latest_assessment_id)
    assert.equal(result.state, 'completed')
    assert.equal(result.financial_health.score, '73.7')
    assert.equal(result.financial_health.band, 'AIC-F2')
    assert.equal(result.grade, null)
    await assessmentsApi.acknowledge(
      result.id,
      { expected_revision: next.revision, reason: 'QA acknowledgement after module split' },
      keys,
    )
    assert.ok(
      (await historyApi.history(caseId)).items.some(
        (event) => event.reason === 'QA acknowledgement after module split',
      ),
    )
  })
  const output = {
    time: new Date().toISOString(),
    scope:
      'Real HTTP through refactored feature adapters against isolated synthetic QA API plus Next SSR; NOT browser interaction or real backend acceptance',
    checks,
  }
  writeReport('http-regression.json', output)
  await authApi.logout()
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    global.fetch = originalFetch
  })
