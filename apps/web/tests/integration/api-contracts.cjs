const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
require('../helpers/register-typescript.cjs')
const root = path.resolve(__dirname, '../..')
const sourceRoot = path.join(root, 'src')
const { writeReport } = require('../../scripts/lib/report.cjs')
const { authApi } = require('../../src/features/auth/api.ts')
const { casesApi } = require('../../src/features/cases/api.ts')
const { requestsApi } = require('../../src/features/requests/api.ts')
const dto = require('../../src/lib/api/decoders.ts'),
  model = {
    ...require('../../src/lib/api/contracts.ts'),
    ...require('../../src/lib/domain/cases.ts'),
    ...require('../../src/lib/utils/money.ts'),
    ...require('../../src/lib/utils/navigation.ts'),
  },
  policy = require('../../src/lib/api/proxy-policy.ts'),
  client = require('../../src/lib/api/client.ts'),
  route = require('../../src/app/api/v2/[...path]/route.ts')
const fixtures = require('../fixtures/aic-api.cjs')
const originalFetch = global.fetch,
  originalBackend = process.env.AIC_BACKEND_URL
const results = []
async function check(name, fn) {
  await fn()
  results.push({ name, passed: true })
  console.log('PASS ' + name)
}
async function main() {
  await check(
    'VND amounts preserve integers above Number.MAX_SAFE_INTEGER and reject decimals',
    () => {
      const text = '900719925474099312345'
      assert.ok(model.validAmount(text))
      assert.ok(model.formatMoney(text, 'en').includes('900,719,925,474,099,312,345'))
      for (const v of ['0', '-1', '1.2', '1e8', '01', 'NaN', '1,000'])
        assert.equal(model.validAmount(v), false)
    },
  )
  await check('Each of four exposures has the specified party-role pair', () =>
    assert.deepEqual(model.rolePairs, {
      RECEIVABLE: ['seller', 'buyer'],
      PREPAYMENT: ['buyer', 'seller'],
      LOAN: ['lender', 'borrower'],
      DEBT_INVESTMENT: ['investor', 'issuer'],
    }),
  )
  await check('Session decoder rejects old reviewer/contributor roles and expired sessions', () => {
    dto.session(fixtures.session)
    for (const role of ['reviewer', 'contributor', 'admin'])
      assert.throws(() =>
        dto.session({ ...fixtures.session, user: { ...fixtures.session.user, role } }),
      )
    assert.throws(() => dto.session({ ...fixtures.session, expires_at: '2000-01-01' }))
  })
  await check(
    'Draft case/readiness decoders do not manufacture a score or convert null to zero',
    () => {
      const c = dto.detail(fixtures.cases[0])
      assert.equal(c.assessment, null)
      assert.equal(c.method_version, null)
      assert.equal(dto.readiness(fixtures.readiness).numeric_assessment_allowed, false)
      assert.throws(() =>
        dto.caseRecord({ ...c, exposure: { ...c.exposure, amount_vnd: 500000000 } }),
      )
      assert.throws(() => dto.page(dto.caseRecord)({ data: [c] }))
    },
  )
  await check('Safe return route rejects external redirects and backslashes', () => {
    for (const p of [
      'https://evil.test',
      '//evil.test',
      '/cases\\evil',
      '/login',
      '/public-sources',
    ])
      assert.equal(model.safeReturnTo(p), '/cases')
    assert.equal(model.safeReturnTo('/cases/123#files'), '/cases/123#files')
  })
  await check(
    'Proxy permits catalogued public routes only; blocks private AI and traversal',
    () => {
      assert.ok(policy.isPublicApiRoute('POST', 'cases/c1/documents'))
      assert.ok(policy.isPublicApiRoute('POST', 'cases/c1/document-archives'))
      assert.ok(policy.isPublicApiRoute('POST', 'cases/c1/dossier-archives'))
      assert.ok(policy.isPublicApiRoute('GET', 'cases/c1/dossier-archives'))
      assert.ok(policy.isPublicApiRoute('GET', 'dossier-archives/a1'))
      assert.ok(policy.isPublicApiRoute('GET', 'dossier-members/m1/source'))
      assert.ok(policy.isPublicApiRoute('GET', 'dossier-members/m1/extraction-summary'))
      assert.ok(policy.isPublicApiRoute('GET', 'documents/d1/source'))
      assert.ok(policy.isPublicApiRoute('GET', 'documents/d1/extraction-summary'))
      assert.ok(policy.isPublicApiRoute('POST', 'cases/c1/assistant/messages'))
      assert.ok(policy.isPublicApiRoute('GET', 'cases/c1/assistant/search'))
      assert.equal(policy.isPublicApiRoute('GET', 'cases/c1/assistant/messages'), false)
      assert.equal(policy.isPublicApiRoute('POST', 'cases/c1/assistant/search'), false)
      for (const p of [
        'internal/v2/analyze',
        '../auth/me',
        'documents/%2e%2e/source',
        'cases/c1/approve-loan',
        'documents/d1/manual-review',
        'cases/c1/scorecard',
        'dossier-members/m1/delete',
        'dossier-archives/%2e%2e/source',
      ])
        assert.equal(policy.isPublicApiRoute('POST', p), false)
      assert.equal(policy.isPublicApiRoute('DELETE', 'cases/c1'), false)
    },
  )
  await check(
    'Backend URL rejects embedded credentials, query, fragment and non-http schemes',
    () => {
      assert.equal(
        policy.backendBase('https://backend.test/api/v2/'),
        'https://backend.test/api/v2',
      )
      for (const u of [
        'file:///etc/passwd',
        'https://u:p@test/api',
        'https://test/api?q=x',
        'https://test/#x',
      ])
        assert.throws(() => policy.backendBase(u))
    },
  )
  await check('One idempotency key belongs to one unchanged payload; edits get a new key', () => {
    const keys = new client.MutationKey(),
      key = keys.for('/cases', { amount: '100' })
    assert.equal(keys.for('/cases', { amount: '100' }), key)
    assert.notEqual(keys.for('/cases', { amount: '200' }), key)
    keys.clear()
    assert.notEqual(keys.for('/cases', { amount: '100' }), key)
  })
  await check(
    'JSON transport sends CSRF, same-origin cookies and exact string money; no data envelope',
    async () => {
      client.setCsrfToken('csrf')
      let calls = 0
      global.fetch = async (url, init) => {
        calls++
        assert.equal(url, '/api/v2/cases')
        assert.equal(init.credentials, 'same-origin')
        assert.equal(init.headers.get('X-CSRF-Token'), 'csrf')
        assert.equal(init.headers.get('Idempotency-Key'), 'stable-key')
        assert.equal(JSON.parse(init.body).exposure.amount_vnd, '500000000')
        return Response.json(fixtures.cases[0], { status: 201 })
      }
      await casesApi.createCase(fixtures.cases[0], 'stable-key')
      assert.equal(calls, 1)
    },
  )
  await check(
    '409 preserves server code/reference and is never automatically retried',
    async () => {
      let calls = 0
      global.fetch = async () => {
        calls++
        return Response.json(
          { code: 'REVISION_CONFLICT', message: 'changed', request_id: 'support-id', details: {} },
          { status: 409 },
        )
      }
      await assert.rejects(
        client.request('/cases/x/exposure', client.unknownResponse, {
          method: 'PATCH',
          body: {},
          idempotencyKey: 'key',
        }),
        (e) => e.status === 409 && e.requestId === 'support-id',
      )
      assert.equal(calls, 1)
    },
  )
  await check('204 logout is not JSON parsed; approved export bytes are unchanged', async () => {
    global.fetch = async () => new Response(null, { status: 204 })
    await authApi.logout()
    const text = 'Đã duyệt\r\n原文\n'
    global.fetch = async () => new Response(text, { headers: { 'content-type': 'text/plain' } })
    assert.equal(await (await requestsApi.export('r1')).text(), text)
  })
  await check(
    'Multipart upload keeps browser boundary and respondent has no specialist cookie credentials',
    async () => {
      const form = new FormData()
      form.set('file', new Blob(['%PDF-']), 'test.pdf')
      global.fetch = async (url, init) => {
        assert.equal(init.headers.has('Content-Type'), false)
        assert.equal(init.body, form)
        return Response.json({})
      }
      await client.request('/cases/c1/documents', client.unknownResponse, {
        method: 'POST',
        body: form,
      })
      global.fetch = async (url, init) => {
        assert.equal(init.credentials, 'omit')
        assert.equal(init.headers.get('Authorization'), 'Bearer capability')
        assert.equal(init.headers.has('X-CSRF-Token'), false)
        return Response.json({ questions: [] })
      }
      await client.request('/respondent/form', client.unknownResponse, {
        respondentToken: 'capability',
      })
    },
  )
  await check(
    'Proxy fails closed without backend; rejects cross-origin mutation before upstream',
    async () => {
      delete process.env.AIC_BACKEND_URL
      let calls = 0
      global.fetch = async () => {
        calls++
        throw new Error('Must not call upstream')
      }
      const res = await route.GET(new Request('http://app.test/api/v2/auth/me'), {
        params: Promise.resolve({ path: ['auth', 'me'] }),
      })
      assert.equal(res.status, 503)
      assert.equal((await res.json()).code, 'BACKEND_NOT_CONFIGURED')
      const cross = await route.POST(
        new Request('http://app.test/api/v2/auth/login', {
          method: 'POST',
          headers: { Origin: 'https://evil.test' },
        }),
        { params: Promise.resolve({ path: ['auth', 'login'] }) },
      )
      assert.equal(cross.status, 403)
      assert.equal(calls, 0)
    },
  )
  await check(
    'Proxy requires CSRF and idempotency and never forwards a private service key',
    async () => {
      process.env.AIC_BACKEND_URL = 'https://backend.test/api/v2'
      const missing = await route.POST(
        new Request('http://app.test/api/v2/cases', {
          method: 'POST',
          headers: { Origin: 'http://app.test' },
        }),
        { params: Promise.resolve({ path: ['cases'] }) },
      )
      assert.equal(missing.status, 403)
      global.fetch = async (url, init) => {
        assert.equal(url, 'https://backend.test/api/v2/cases')
        assert.equal(init.headers.has('x-service-key'), false)
        return Response.json(fixtures.cases[0], {
          status: 201,
          headers: { 'set-cookie': 'aic_session=x; HttpOnly; SameSite=Lax; Path=/' },
        })
      }
      const good = await route.POST(
        new Request('http://app.test/api/v2/cases', {
          method: 'POST',
          headers: {
            Origin: 'http://app.test',
            'X-CSRF-Token': 'x',
            'Idempotency-Key': 'k',
            'x-service-key': 'never-forward',
            'content-type': 'application/json',
          },
          body: '{}',
        }),
        { params: Promise.resolve({ path: ['cases'] }) },
      )
      assert.equal(good.status, 201)
      assert.ok(good.headers.get('set-cookie').includes('HttpOnly'))
      assert.equal(good.headers.get('cache-control'), 'no-store')
    },
  )
  await check(
    'Origin validation accepts the public Host when Next uses a different listen hostname',
    async () => {
      delete process.env.AIC_BACKEND_URL
      const res = await route.POST(
        new Request('http://localhost:3000/api/v2/auth/login', {
          method: 'POST',
          headers: { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000' },
        }),
        { params: Promise.resolve({ path: ['auth', 'login'] }) },
      )
      assert.equal(res.status, 503)
      assert.equal((await res.json()).code, 'BACKEND_NOT_CONFIGURED')
    },
  )
  await check(
    '401 signals session expiry exactly once without automatically replaying the write',
    async () => {
      const originalWindow = global.window
      let events = 0,
        calls = 0
      global.window = {
        dispatchEvent: (e) => {
          assert.equal(e.type, 'aic:session-expired')
          events++
          return true
        },
      }
      global.fetch = async () => {
        calls++
        return Response.json(
          { code: 'SESSION_EXPIRED', message: 'expired', request_id: 'r' },
          { status: 401 },
        )
      }
      try {
        await assert.rejects(
          client.request('/cases/x/exposure', client.unknownResponse, {
            method: 'PATCH',
            body: {},
            idempotencyKey: 'same',
          }),
          (e) => e.status === 401,
        )
        assert.equal(events, 1)
        assert.equal(calls, 1)
      } finally {
        if (originalWindow === undefined) delete global.window
        else global.window = originalWindow
      }
    },
  )
  await check(
    'Malformed extraction and mismatched party roles fail decoding instead of becoming usable evidence',
    () => {
      assert.throws(() =>
        dto.extraction([{ field_key: 'financial.assets', value: null, quality: 'unreadable' }]),
      )
      assert.throws(() =>
        dto.detail({ ...fixtures.cases[0], findings: [{ summary: 'missing identity' }] }),
      )
      assert.throws(() =>
        dto.caseRecord({
          ...fixtures.cases[0],
          exposure: { ...fixtures.cases[0].exposure, organization_role: 'buyer' },
        }),
      )
      assert.throws(() => policy.backendBase('https://backend.test/api/v1'))
    },
  )
  await check(
    'Proxy enforces exact 33 MiB body limit for dossier archives and 21 MiB for legacy archives',
    async () => {
      process.env.AIC_BACKEND_URL = 'https://backend.test/api/v2'
      const headers = {
        Origin: 'http://app.test',
        'X-CSRF-Token': 'token',
        'Idempotency-Key': 'key',
      }
      // Dossier archive: 33 MiB = 34,603,008 bytes
      const overDossier = await route.POST(
        new Request('http://app.test/api/v2/cases/c1/dossier-archives', {
          method: 'POST',
          headers: { ...headers, 'content-length': String(33 * 1024 * 1024 + 1) },
        }),
        { params: Promise.resolve({ path: ['cases', 'c1', 'dossier-archives'] }) },
      )
      assert.equal(overDossier.status, 413)

      // Legacy archive: 21 MiB = 22,020,096 bytes
      const overLegacy = await route.POST(
        new Request('http://app.test/api/v2/cases/c1/document-archives', {
          method: 'POST',
          headers: { ...headers, 'content-length': String(21 * 1024 * 1024 + 1) },
        }),
        { params: Promise.resolve({ path: ['cases', 'c1', 'document-archives'] }) },
      )
      assert.equal(overLegacy.status, 413)

      // Single PDF document: 11 MiB = 11,534,336 bytes
      const overDoc = await route.POST(
        new Request('http://app.test/api/v2/cases/c1/documents', {
          method: 'POST',
          headers: { ...headers, 'content-length': String(11 * 1024 * 1024 + 1) },
        }),
        { params: Promise.resolve({ path: ['cases', 'c1', 'documents'] }) },
      )
      assert.equal(overDoc.status, 413)
    },
  )
  await check(
    'Dossier DTO decoders validate all seven merged schemas and reject malformed/tampered payloads',
    () => {
      const counters = {
        discovered: 60,
        registered: 60,
        rejected: 0,
        awaiting_inspection: 0,
        queued: 0,
        running: 0,
        completed_with_usable_data: 53,
        completed_zero_usable: 3,
        failed: 3,
        needs_review: 1,
      }
      assert.deepEqual(dto.dossierCounters(counters), counters)
      assert.throws(() => dto.dossierCounters({ ...counters, discovered: 129 })) // > 128
      assert.throws(() => dto.dossierCounters({ ...counters, registered: -1 })) // < 0

      const accepted = {
        archive_id: '00000000-0000-4000-8000-000000000301',
        case_id: '00000000-0000-4000-8000-000000000001',
        archive_sha256: 'a'.repeat(64),
        revision: 12,
        intake_state: 'queued',
        manifest_url: '/api/v2/dossier-archives/00000000-0000-4000-8000-000000000301',
      }
      assert.deepEqual(dto.dossierAccepted(accepted), accepted)
      assert.throws(() => dto.dossierAccepted({ ...accepted, intake_state: 'accepted' })) // must be queued
      assert.throws(() => dto.dossierAccepted({ ...accepted, archive_sha256: 'short' }))

      const member = {
        id: '00000000-0000-4000-8000-000000000401',
        archive_id: '00000000-0000-4000-8000-000000000301',
        entry_index: 0,
        entry_path: '2024/financial-statements.pdf',
        byte_size: 4096,
        sha256: 'b'.repeat(64),
        detected_mime: 'application/pdf',
        group: 'financial_statements',
        suggested_type: 'financial_statement',
        classification_verification: 'unverified',
        period_suggestion: {
          year: 2024,
          kind: 'unresolved',
          basis: 'unresolved',
          verification: 'unverified',
        },
        subject_verification: 'unresolved',
        intake_state: 'registered',
        processing_state: 'queued',
        page_count: 4,
        document_id: '00000000-0000-4000-8000-000000000201',
        job_id: '00000000-0000-4000-8000-000000000101',
        error_code: null,
        retryable: false,
        source_url: '/api/v2/dossier-members/00000000-0000-4000-8000-000000000401/source',
      }
      assert.deepEqual(dto.dossierMember(member), member)
      assert.throws(() => dto.dossierMember({ ...member, classification_verification: 'verified' })) // must be unverified
      assert.throws(() => dto.dossierMember({ ...member, entry_index: 128 })) // max 127

      const archive = {
        id: '00000000-0000-4000-8000-000000000301',
        case_id: '00000000-0000-4000-8000-000000000001',
        archive_sha256: 'a'.repeat(64),
        intake_state: 'accepted',
        processing_state: 'processing',
        created_at: '2026-10-17T09:00:00.000Z',
        counters,
        error_code: null,
        members: [member],
      }
      assert.deepEqual(dto.dossierArchive(archive), archive)
      const { members: archiveMembers, ...archiveSummary } = archive
      assert.deepEqual(dto.dossierArchiveList([archiveSummary]), [archiveSummary])
      assert.throws(
        () => dto.dossierArchiveList([archive]),
        'List summaries cannot contain detail-only members',
      )

      const memberSummary = {
        member_id: '00000000-0000-4000-8000-000000000402',
        archive_id: '00000000-0000-4000-8000-000000000301',
        document_id: null,
        job_id: null,
        intake_state: 'needs_review',
        processing_state: 'needs_review',
        error_code: 'PDF_REQUIRES_CHUNKED_PROCESSING',
        extraction: null,
      }
      assert.deepEqual(dto.dossierMemberSummary(memberSummary), memberSummary)
    },
  )
  await check(
    'Active route import graph excludes preview fixtures, score engine and public samples',
    () => {
      const seen = new Set()
      function visit(file) {
        if (seen.has(file)) return
        seen.add(file)
        const text = fs.readFileSync(file, 'utf8')
        assert.ok(
          !/demo-provider|demo-model|scorecard-config|public-samples|seedCases|calculateScorecard|Demo2026!/.test(
            text,
          ),
          file,
        )
        for (const match of text.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
          if (!match[1].startsWith('@/') && !match[1].startsWith('.')) continue
          const base = match[1].startsWith('@/')
            ? path.join(sourceRoot, match[1].slice(2))
            : path.resolve(path.dirname(file), match[1])
          const next = ['', '.ts', '.tsx']
            .map((ext) => base + ext)
            .find((p) => fs.existsSync(p) && fs.statSync(p).isFile())
          if (next && /\.tsx?$/.test(next)) visit(next)
        }
      }
      for (const f of [
        'app/layout.tsx',
        'app/(workspace)/cases/page.tsx',
        'app/(workspace)/cases/[caseId]/page.tsx',
        'app/(workspace)/counterparties/page.tsx',
        'app/(auth)/login/page.tsx',
        'app/respondent/page.tsx',
      ])
        visit(path.join(sourceRoot, f))
    },
  )
  writeReport('consumer-checks.json', {
    time: new Date().toISOString(),
    scope: 'frontend consumer / proxy tests only; not backend/live OCR/rating acceptance',
    passed: results.length,
    results,
  })
  console.log(`\n${results.length} frontend integration checks passed.`)
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    global.fetch = originalFetch
    if (originalBackend === undefined) delete process.env.AIC_BACKEND_URL
    else process.env.AIC_BACKEND_URL = originalBackend
  })
