const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')

/**
 * Lead-owned runtime only: no browser/service launch, install, seed or DB access.
 * Each invocation requires a fresh disposable tenant/DB and a private output dir.
 * Do not enable Playwright API debug logging, tracing, HAR or video for these
 * contexts: authentication bodies and one-time capability URLs are sensitive.
 * step(name, fn) must await fn, record failure, and return its result or undefined.
 * Returned coverage describes attempted checks, not a live-AI acceptance claim.
 */
async function runBrowserAcceptance({
  browser,
  origin,
  username,
  password,
  output,
  step,
  providerAvailable,
  readLegacy,
  allowLive = () => true,
  allowProviderRetry = () => true,
}) {
  assert.ok(browser && typeof browser.newContext === 'function', 'A supplied Browser is required')
  const base = new URL(origin)
  assert.ok(
    ['http:', 'https:'].includes(base.protocol) && !base.username && !base.password,
    'An HTTP origin without credentials is required',
  )
  assert.ok(base.pathname === '/' && !base.search && !base.hash, 'Supply an origin without a path')
  assert.ok(
    typeof username === 'string' && username && typeof password === 'string' && password,
    'Explicit synthetic credentials are required',
  )
  assert.ok(typeof step === 'function', 'A step recorder is required')
  assert.ok(
    typeof output === 'string' && path.isAbsolute(output),
    'Private absolute artifact dir required',
  )
  await fs.mkdir(output, { recursive: true })
  const run = randomUUID().replaceAll('-', '').slice(0, 16)
  let observedPage
  const result = {
    run,
    steps: [],
    cases: {},
    screenshots: [],
    exports: [],
    providerConfigured: providerAvailable === true,
    providerAvailability:
      'Must be established by a completed live job; configuration is insufficient',
    missingCoverage: [
      'Positive field verification with matched source, and replacement/source invalidation',
      '409 concurrency, issue resolve/dismiss/reopen, waiver/revoke and request supplements',
      'Financial human verification, multi-set selection and source-change staleness',
      'Capability expiry/reissue/close, skipped answers and duplicate-submit races',
      'Logout, reauthentication/draft isolation and cross-tenant authorization',
    ],
  }
  // Every successful callback returns a value. An undefined recorder result
  // blocks dependents; it is never interpreted as a successful empty response.
  async function check(name, dependencies, fn) {
    if (dependencies.some((value) => value === undefined)) {
      result.steps.push({ name, status: 'BLOCKED', reason: 'Prerequisite step did not succeed' })
      return undefined
    }
    let value
    try {
      value = await step(name, async () => {
        try {
          return (await fn()) ?? true
        } catch (error) {
          if (
            typeof observedPage?.url === 'function' &&
            !new URL(observedPage.url()).hash.includes('token=')
          ) {
            try {
              await screenshot(observedPage, `failure-${name.replaceAll('.', '-')}.png`)
            } catch {}
          }
          // Never propagate Playwright call logs, URLs, request bodies, page
          // content, assertion actual values, or invitation tokens to recorder.
          const summary = String(error?.message ?? 'Action failed')
            .split('\n')[0]
            .replaceAll(password, '<redacted>')
            .replaceAll(username, '<user>')
            .replace(/#token=[^\s]+/g, '<capability-redacted>')
            .slice(0, 300)
          throw new Error(`${name}: ${summary}; sensitive details suppressed`)
        }
      })
    } catch {
      value = undefined
    }
    result.steps.push({ name, status: value === undefined ? 'FAIL' : 'PASS' })
    return value
  }
  const contexts = []
  async function newPage() {
    const context = await browser.newContext({
      baseURL: base.origin,
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
    })
    contexts.push(context)
    const page = await context.newPage()
    observedPage = page
    page.setDefaultTimeout(12_000)
    page.setDefaultNavigationTimeout(25_000)
    page.on('dialog', (prompt) => {
      // These contexts contain only this invocation's synthetic drafts. Allow
      // navigation away from a failed draft without logging the prompt text.
      void (prompt.type() === 'beforeunload' ? prompt.accept() : prompt.dismiss()).catch(() => {})
    })
    return { context, page }
  }
  async function poll(fn, accept, timeout = 35_000) {
    const deadline = Date.now() + timeout
    do {
      const value = await fn()
      if (accept(value)) return value
      await new Promise((resolve) => setTimeout(resolve, 350))
    } while (Date.now() < deadline)
    throw new Error('Expected state was not reached before bounded deadline')
  }
  const visible = (locator) => locator.waitFor({ state: 'visible' })
  const closed = (locator) => locator.waitFor({ state: 'hidden' })
  const dialog = (page, name) => page.getByRole('dialog', { name, exact: true })
  const reason = (modal) => modal.getByLabel('Reason / findings *', { exact: true })
  const save = (modal) => modal.getByRole('button', { name: 'Save', exact: true })
  async function read(page, route) {
    // Only authenticated same-origin GETs. No token-bearing respondent reads.
    const response = await page.request.get(`${base.origin}/api/v2${route}`)
    assert.ok(
      response.ok(),
      `Authenticated GET ${route.split('?')[0]} returned ${response.status()}`,
    )
    return response.json()
  }
  async function mutate(page, route, method, action) {
    const [response] = await Promise.all([
      page.waitForResponse((r) => {
        const url = new URL(r.url())
        return (
          url.origin === base.origin &&
          url.pathname === `/api/v2${route}` &&
          r.request().method() === method
        )
      }),
      action(),
    ])
    assert.ok(response.ok(), `UI ${method} ${route} returned ${response.status()}`)
    return response.json()
  }
  async function english(page) {
    await page.locator('.top-actions .locale-select select').selectOption('en')
    await poll(
      () => page.locator('html').getAttribute('lang'),
      (value) => value === 'en',
    )
  }
  async function openCase(page, id, tab) {
    await page.goto(`/cases/${id}#${tab}`)
    // goto between hashes of the same case need not remount its resource.
    // Start independent checks from a fresh read, especially after respondent writes.
    await page.reload()
    await visible(page.locator(`#panel-${tab}`))
    await english(page)
  }
  async function screenshot(page, filename) {
    // Mask password and ALL readonly inputs, including first-delivery invitation
    // links. Screenshots are never taken in a token-bearing respondent URL.
    assert.ok(!new URL(page.url()).hash.includes('token='), 'Token URL cannot be captured')
    await page.screenshot({
      path: path.join(output, filename),
      fullPage: true,
      mask: [page.locator('input[name="password"], input[type="password"], input[readonly]')],
    })
    result.screenshots.push(filename)
  }
  function nullGate(registry) {
    assert.ok(registry.method_status === 'unconfigured', 'Method must stay unconfigured')
    for (const key of ['score', 'band', 'grade', 'pd'])
      assert.ok(registry[key] === null, `Public ${key} must be null`)
    assert.ok(Array.isArray(registry.metrics), 'Metrics projection must exist')
    for (const metric of registry.metrics)
      assert.ok(metric.points === null, 'Every unsupported metric points value must be null')
  }
  async function runReview(page, id) {
    await openCase(page, id, 'review')
    const readiness = await read(page, `/cases/${id}/readiness`)
    assert.ok(
      readiness.method_status === 'unconfigured' && readiness.document_review_allowed === true,
      'Document review must be allowed independently of numeric FHI',
    )
    const button = page
      .locator('#panel-review')
      .getByRole('button', { name: 'Run document review', exact: true })
    await poll(() => button.isEnabled(), Boolean)
    await mutate(page, `/cases/${id}/review-runs`, 'POST', () => button.click())
    const detail = await poll(
      () => read(page, `/cases/${id}`),
      (d) => Boolean(d.latest_review_run_id),
    )
    const review = await poll(
      () => read(page, `/review-runs/${detail.latest_review_run_id}`),
      (r) => r.state === 'completed',
    )
    assert.ok(review.findings.length > 0, 'Synthetic empty case must have review findings')
    await visible(page.locator('#panel-review .question-list article').first())
    nullGate(await read(page, `/cases/${id}/financial-sets`))
    return { id, runId: detail.latest_review_run_id }
  }

  try {
    const { page } = await newPage()
    // Invalid login is independent of the successful-login step and creates no
    // fixtures. Password clearing on 401 is reported separately by source review.
    await check('auth.invalid-credentials', [], async () => {
      await page.goto('/login')
      await page.locator('.login-locale select').selectOption('en')
      await page.locator('input[name="username"]').fill(`absent-${run}`)
      await page.locator('input[name="password"]').fill('InvalidAcceptanceOnly123!')
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === '/api/v2/auth/login' && r.request().method() === 'POST',
        ),
        page.locator('button.login-enter').click(),
      ])
      assert.ok(response.status() === 401, 'Invalid login must return generic 401')
      await visible(page.locator('p.form-error[role="alert"]'))
      assert.ok(
        !(await page.locator('.app-shell').isVisible()),
        'Invalid login cannot open workspace',
      )
      await page.locator('input[name="password"]').fill('')
      return true
    })
    const signedIn = await check('auth.specialist-login', [], async () => {
      await page.goto('/login')
      await page.locator('.login-locale select').selectOption('en')
      await page.locator('input[name="username"]').fill(username)
      await page.locator('input[name="password"]').fill(password)
      await page.locator('button.login-enter').click()
      await page.waitForURL((url) => url.pathname === '/cases')
      await visible(page.locator('.app-shell'))
      await read(page, '/auth/me')
      return true
    })
    const partyName = `Acceptance_RAW_Company_${run}`
    const party = await check('counterparty.create-unresolved', [signedIn], async () => {
      await page.goto('/counterparties')
      await english(page)
      await page.getByRole('button', { name: 'Add counterparty', exact: true }).click()
      const modal = dialog(page, 'Add counterparty')
      await modal.getByLabel('Legal name *', { exact: true }).fill(partyName)
      await modal.getByLabel('Country *', { exact: true }).fill('VN')
      await modal.getByLabel('Tax / registration ID', { exact: true }).fill(`SYN-${run}`)
      await modal.getByLabel('Industry code', { exact: true }).fill('4690')
      await modal.getByLabel('Declaration reference *', { exact: true }).fill(`DECL-${run}`)
      await modal
        .getByLabel('Reported information *', { exact: true })
        .fill('Synthetic declaration only; legal identity is unconfirmed.')
      await modal
        .getByLabel('Reason for saving *', { exact: true })
        .fill('Isolated synthetic acceptance setup.')
      const created = await mutate(page, '/counterparties', 'POST', () => save(modal).click())
      await closed(modal)
      assert.ok(
        typeof created.id === 'string' && created.identity_status === 'unresolved',
        'Saving declaration must retain unresolved identity',
      )
      await page.getByRole('textbox', { name: 'Search this page', exact: true }).fill(partyName)
      await visible(page.locator('article.aic-party-row').filter({ hasText: partyName }))
      return { id: created.id, revision: created.revision }
    })
    await check('counterparty.edit-preserves-unresolved', [party], async () => {
      const row = page.locator('article.aic-party-row').filter({ hasText: partyName })
      await row.getByRole('button', { name: 'Edit', exact: true }).click()
      const modal = dialog(page, 'Edit')
      await modal.getByLabel('Declaration reference *', { exact: true }).fill(`EDIT-${run}`)
      await modal
        .getByLabel('Reported information *', { exact: true })
        .fill('Updated synthetic source declaration; identity remains unresolved.')
      await modal
        .getByLabel('Reason for saving *', { exact: true })
        .fill('Acceptance verifies persistent edit.')
      await mutate(page, `/counterparties/${party.id}`, 'PATCH', () => save(modal).click())
      await closed(modal)
      const updated = await read(page, `/counterparties/${party.id}`)
      assert.ok(
        updated.name === partyName &&
          updated.identity_status === 'unresolved' &&
          updated.revision > party.revision,
        'Edit must persist without confirming identity',
      )
      return true
    })

    const reviews = {}
    for (const kind of ['RECEIVABLE', 'PREPAYMENT']) {
      const record = await check(`${kind}.create-and-roles`, [party], async () => {
        await page.goto('/cases')
        await english(page)
        await page.getByRole('button', { name: 'New transaction', exact: true }).click()
        const modal = dialog(page, 'New transaction')
        // Wrapped native selects include their option text in their label text.
        // Match the observed stable prefix, without assuming an empty option list.
        await modal.getByRole('combobox', { name: /^Counterparty \*/ }).selectOption(party.id)
        await modal.getByRole('combobox', { name: /^Transaction type/ }).selectOption(kind)
        const roles =
          kind === 'RECEIVABLE'
            ? ['Seller / service provider', 'Buyer / customer']
            : ['Buyer / customer', 'Seller / service provider']
        const pair = await modal.locator('.metadata-grid strong').allTextContents()
        assert.ok(
          pair.length === 2 && pair.every((v, i) => v === roles[i]),
          'Dialog must bind each party to its correct role',
        )
        await modal.getByRole('combobox', { name: /^Transaction stage/ }).selectOption('proposed')
        const amount = kind === 'RECEIVABLE' ? '500000000' : '250000000'
        await modal.getByLabel('Transaction amount (VND) *', { exact: true }).fill(amount)
        await modal.getByLabel('Term (calendar days) *', { exact: true }).fill('60')
        await modal
          .getByLabel('Contract reference, if available', { exact: true })
          .fill(`${kind}-${run}`)
        const created = await mutate(page, '/cases', 'POST', () =>
          modal.getByRole('button', { name: 'Create', exact: true }).click(),
        )
        await page.waitForURL((url) => url.pathname === `/cases/${created.id}`)
        await visible(page.locator('.aic-parties'))
        const detail = await read(page, `/cases/${created.id}`)
        const wireRoles = kind === 'RECEIVABLE' ? ['seller', 'buyer'] : ['buyer', 'seller']
        assert.ok(
          detail.exposure_kind === kind &&
            detail.counterparty_id === party.id &&
            detail.exposure.organization_role === wireRoles[0] &&
            detail.exposure.counterparty_role === wireRoles[1] &&
            detail.exposure.amount_vnd === amount &&
            detail.exposure.term_days === 60,
          'Persisted case must preserve workflow, party roles, integer amount and term',
        )
        const strip = await page.locator('.aic-parties > div span').allTextContents()
        assert.ok(
          strip.length === 2 && strip.every((v, i) => v === roles[i]),
          'Workspace roles must agree with stored case',
        )
        result.cases[kind] = created.id
        return { id: created.id, amount }
      })
      await check(
        `${kind}.browser-upload-live-source-and-correction`,
        [record, allowLive(kind) ? true : undefined],
        async () => {
          assert.ok(providerAvailable === true, 'Live provider required; no mock fallback')
          await openCase(page, record.id, 'files')
          await page
            .locator('#panel-files')
            .getByRole('button', { name: 'Upload PDF', exact: true })
            .click()
          const upload = dialog(page, 'Upload PDF')
          await upload.getByRole('combobox', { name: /^Document type/ }).selectOption('contract')
          await upload
            .getByLabel('Source class *', { exact: true })
            .fill('synthetic_browser_acceptance')
          const sourcePath = path.resolve(
            __dirname,
            '../../../..',
            'packages/contracts/fixtures/04_contract.pdf',
          )
          const sourceBytes = await fs.readFile(sourcePath)
          await upload.locator('input[type="file"]').setInputFiles(sourcePath)
          const accepted = await mutate(page, `/cases/${record.id}/documents`, 'POST', () =>
            upload.getByRole('button', { name: 'Upload PDF', exact: true }).click(),
          )
          await fs.writeFile(
            path.join(output, `${kind.toLowerCase()}-upload-binding.json`),
            JSON.stringify(
              {
                case_id: record.id,
                document_id: accepted.document.id,
                document_version: accepted.document.version,
                source_hash: accepted.document.hash,
                job_id: accepted.job.id,
                mode: 'live',
              },
              null,
              2,
            ),
          )
          await closed(upload)
          let job = await poll(
            () => read(page, `/jobs/${accepted.job.id}`),
            (j) => !['queued', 'running'].includes(j.state),
            150_000,
          )
          await fs.writeFile(
            path.join(output, `${kind.toLowerCase()}-browser-job.json`),
            JSON.stringify(
              {
                state: job.state,
                retryable: job.retryable,
                errors: job.errors?.map((e) => ({ code: e.code })),
              },
              null,
              2,
            ),
          )
          if (
            job.state === 'failed' &&
            job.retryable === true &&
            job.errors?.some((e) => e.code === 'PROVIDER_UNAVAILABLE') &&
            allowProviderRetry(accepted.document.id)
          ) {
            // Keep the first failure in the global acceptance gate, even if the
            // separately exercised, explicit operator recovery succeeds.
            await step(`${kind}.initial-provider-attempt`, async () => {
              throw new Error(
                'PROVIDER_UNAVAILABLE; first attempt remains FAIL despite any recovery',
              )
            })
            await openCase(page, record.id, 'files')
            await page
              .locator('#panel-files .aic-job')
              .filter({ hasText: accepted.job.id })
              .getByRole('button', { name: 'Try again', exact: true })
              .click()
            const retry = dialog(page, 'Try again')
            await reason(retry).fill(
              'Synthetic acceptance: one explicit operator retry of known failed provider attempt.',
            )
            const retried = await mutate(page, `/jobs/${accepted.job.id}/retry`, 'POST', () =>
              save(retry).click(),
            )
            await closed(retry)
            assert.ok(retried.job.id === accepted.job.id, 'Retry must target the existing job')
            const currentDocument = (await read(page, `/cases/${record.id}`)).documents.find(
              (d) => d.id === accepted.document.id,
            )
            assert.ok(
              currentDocument &&
                currentDocument.version === accepted.document.version &&
                currentDocument.hash === accepted.document.hash,
              'Explicit retry must preserve document identity/version/hash',
            )
            job = await poll(
              () => read(page, `/jobs/${accepted.job.id}`),
              (j) => !['queued', 'running'].includes(j.state),
              150_000,
            )
            await fs.writeFile(
              path.join(output, `${kind.toLowerCase()}-explicit-retry.json`),
              JSON.stringify(
                {
                  state: job.state,
                  retryable: job.retryable,
                  errors: job.errors?.map((e) => ({ code: e.code })),
                },
                null,
                2,
              ),
            )
          }
          assert.ok(
            job.state === 'completed',
            `Real worker must complete the live extraction (state=${job.state}, codes=${job.errors?.map((e) => e.code).join(',') ?? ''})`,
          )
          // Legacy diagnostics are intentionally outside the public Next proxy.
          // The lead-owned runtime checks them through its authenticated Nest
          // session; do not widen the frontend proxy allowlist for a test.
          assert.ok(
            typeof readLegacy === 'function',
            'Authenticated runtime provenance reader required',
          )
          const legacy = await readLegacy(accepted.document.id)
          assert.ok(
            legacy.ai_mode === 'live' &&
              legacy.raw.schema_version === '1.0.2' &&
              !legacy.raw.provenance.model_id.includes('MOCK') &&
              legacy.raw.sha256 === createHash('sha256').update(sourceBytes).digest('hex'),
            'Live provenance and immutable original hash required',
          )
          await openCase(page, record.id, 'files')
          const row = page.locator('article.document-row').filter({ hasText: '04_contract.pdf' })
          await row.getByRole('button', { name: 'View source', exact: true }).click()
          const viewer = dialog(page, 'Evidence & sources')
          await visible(viewer.locator('.pdf-canvas-wrap canvas:not([hidden])'))
          assert.ok(
            (await viewer.locator('.aic-hash').innerText()).includes(legacy.raw.sha256),
            'Viewer must show the source hash it verified',
          )
          await viewer.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('125')
          await screenshot(page, `${kind.toLowerCase()}-source-live.png`)
          await viewer.getByRole('button', { name: 'Close', exact: true }).click()
          await row.getByRole('button', { name: 'Review extracted fields', exact: true }).click()
          const fields = dialog(page, 'Review extracted fields')
          const before = await read(page, `/documents/${accepted.document.id}/extraction`)
          const field = before.find((f) => f.value !== null && f.evidence_refs.length)
          assert.ok(field, 'Live extraction must contain at least one grounded field')
          for (const language of ['en', 'vi', 'zh-CN']) {
            if (language !== 'en') {
              await page.locator('dialog.modal:open .modal-header button').click()
              await page.locator('.top-actions .locale-select select').selectOption(language)
              await row.locator('.document-actions button').nth(1).click()
            }
            const titles = await page
              .locator('dialog.modal:open article.field-card > h3')
              .allTextContents()
            assert.ok(
              titles.length > 0 &&
                !titles.some((t) => /legacy:|tax_id|scope_ref|payment_condition/.test(t)),
              'Primary extraction labels must be readable in every locale',
            )
            await screenshot(page, `${kind.toLowerCase()}-extraction-${language}.png`)
          }
          await page.locator('dialog.modal:open .modal-header button').click()
          await english(page)
          await row.getByRole('button', { name: 'Review extracted fields', exact: true }).click()
          const card = fields
            .locator('article.field-card')
            .filter({ has: page.getByText(field.field_key, { exact: true }) })
          await card.getByRole('button', { name: 'Correct a field', exact: true }).click()
          const correction = dialog(page, 'Correct a field')
          // A supported null correction proves separation of raw and effective
          // facts without inventing a replacement fact or confirming identity.
          await correction.locator('input[type="checkbox"]').check()
          await reason(correction).fill(
            'Synthetic acceptance: withhold effective value; retain original extraction and source.',
          )
          await mutate(page, `/documents/${accepted.document.id}/corrections`, 'POST', () =>
            save(correction).click(),
          )
          await closed(correction)
          const after = await read(page, `/documents/${accepted.document.id}/extraction`)
          const changed = after.find((f) => f.field_key === field.field_key)
          assert.ok(
            changed &&
              changed.value === null &&
              JSON.stringify(changed.raw_value) === JSON.stringify(field.raw_value),
            'Correction must retain immutable raw value',
          )
          assert.deepEqual(
            (await readLegacy(accepted.document.id)).raw,
            legacy.raw,
            'Human decision must not modify legacy raw output',
          )
          await screenshot(page, `${kind.toLowerCase()}-correction-raw-preserved.png`)
          await fields.getByRole('button', { name: 'Close', exact: true }).click()
          return true
        },
      )
      reviews[kind] = await check(`${kind}.review-without-FHI`, [record], () =>
        runReview(page, record.id),
      )
      await check(`${kind}.request-draft-approve-export`, [reviews[kind]], async () => {
        const id = record.id
        await openCase(page, id, 'history')
        await page
          .locator('#panel-history')
          .getByRole('button', { name: 'Request supplement', exact: true })
          .click()
        const modal = dialog(page, 'Request supplement')
        const detail = await read(page, `/cases/${id}`)
        const finding = detail.findings.find((f) => f.rule_id === 'counterparty_identity_source')
        assert.ok(finding, 'A current identity-source finding is required')
        await modal.getByRole('combobox', { name: /^Findings/ }).selectOption(finding.id)
        await modal
          .getByRole('combobox', { name: /^Transaction type \*/ })
          .selectOption('registration')
        const purpose = `Synthetic registration request ${run}`
        await modal.getByLabel('Purpose *', { exact: true }).fill(purpose)
        await modal
          .getByLabel('Content *', { exact: true })
          .fill('Please provide synthetic registration evidence. No real customer records.')
        await mutate(page, `/cases/${id}/requests`, 'POST', () => save(modal).click())
        await closed(modal)
        const after = await read(page, `/cases/${id}`)
        const request = after.requests.find((r) => r.purpose === purpose && r.status === 'draft')
        assert.ok(request, 'Draft must be persisted and bound to current finding')
        const card = page
          .locator('#panel-history article.request-card')
          .filter({ hasText: request.id })
        await card.getByRole('button', { name: 'Approve request', exact: true }).click()
        const approval = dialog(page, 'Approve request')
        await reason(approval).fill(
          'Synthetic acceptance approval; no automatic financial decision.',
        )
        await mutate(page, `/requests/${request.id}/approve`, 'POST', () => save(approval).click())
        await closed(approval)
        const approved = (await read(page, `/cases/${id}`)).requests.find(
          (r) => r.id === request.id,
        )
        assert.ok(
          approved.status === 'approved' && approved.approved_payload !== undefined,
          'Approval must persist a frozen payload',
        )
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          card.getByRole('button', { name: 'Download approved text', exact: true }).click(),
        ])
        assert.ok(
          download.suggestedFilename() === `request-${request.id}.txt`,
          'Expected request TXT download',
        )
        const file = `${kind.toLowerCase()}-request.txt`
        await download.saveAs(path.join(output, file))
        const bytes = await fs.readFile(path.join(output, file))
        const reexport = await page.request.get(
          `${base.origin}/api/v2/requests/${request.id}/export`,
        )
        assert.ok(
          reexport.ok() && bytes.length > 0 && bytes.equals(await reexport.body()),
          'Downloaded export must equal subsequent immutable authenticated export',
        )
        result.exports.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') })
        return true
      })
      // Locale checks are independent of request completion; each starts from
      // the known case. Each viewport/locale has a separate recorded outcome.
      for (const language of ['en', 'vi', 'zh-CN']) {
        for (const [viewport, width, height] of [
          ['desktop', 1280, 800],
          ['mobile', 390, 844],
        ]) {
          await check(`${kind}.locale.${language}.${viewport}`, [reviews[kind]], async () => {
            await openCase(page, record.id, 'review')
            await page.setViewportSize({ width, height })
            await page.locator('.top-actions .locale-select select').selectOption(language)
            await poll(
              () => page.locator('html').getAttribute('lang'),
              (lang) => lang === language,
            )
            await visible(page.locator('#panel-review .question-list article').first())
            try {
              await poll(
                () => page.locator('.aic-page-title h1').innerText(),
                (name) => name === partyName,
              )
              assert.ok(
                (await read(page, `/cases/${record.id}`)).exposure.amount_vnd === record.amount,
                'Underlying money must remain exact across locales',
              )
              const labels = await page
                .locator(
                  '#panel-review .question-card-heading .eyebrow, #panel-review .question-card-heading h3, #panel-review .question-card-heading > .tag',
                )
                .allTextContents()
              assert.ok(
                labels.length > 0 &&
                  !labels.some((text) =>
                    /counterparty_identity_source|financial_minimum|missing_document|identity_pending|source_uncertainty/.test(
                      text,
                    ),
                  ),
                'Known technical codes must not leak through primary finding labels',
              )
              if (language !== 'en')
                assert.ok(
                  !labels.some((text) =>
                    /Missing documentary support:|remains unresolved|\bwarning\b|\binfo\b/.test(
                      text,
                    ),
                  ),
                  'Known finding text and severity must be localized',
                )
              const bodyWidth = await page.evaluate(() => ({
                scroll: document.documentElement.scrollWidth,
                client: document.documentElement.clientWidth,
              }))
              assert.ok(
                bodyWidth.scroll <= bodyWidth.client + 1,
                'Page must fit viewport; tab strip may scroll internally',
              )
              return true
            } finally {
              await screenshot(page, `${kind.toLowerCase()}-${language}-${viewport}.png`)
              await page.setViewportSize({ width: 1280, height: 800 })
            }
          })
        }
      }
    }

    const primaryId = result.cases.RECEIVABLE
    const form = await check('native.questionnaire-create', [primaryId], async () => {
      await openCase(page, primaryId, 'information')
      await page
        .locator('#panel-information')
        .getByRole('button', { name: 'Questionnaire', exact: true })
        .click()
      const modal = dialog(page, 'Questionnaire')
      const label = `Synthetic payment terms ${run}`
      await modal.getByLabel('Content *', { exact: true }).fill(label)
      await reason(modal).fill('Synthetic optional questionnaire for acceptance.')
      await mutate(page, `/cases/${primaryId}/questionnaires`, 'POST', () => save(modal).click())
      await closed(modal)
      const detail = await read(page, `/cases/${primaryId}`)
      const form = detail.questionnaires.find((q) => q.questions.some((v) => v.label === label))
      assert.ok(
        form && form.questions.length === 1,
        'Persisted immutable one-question form required',
      )
      return { id: form.id, label }
    })
    let invitationUrl = '' // Ephemeral only. Never returned from a recorded step.
    const invited = await check('native.invitation-create', [form], async () => {
      const section = page
        .locator('#panel-information section.question-list')
        .filter({ hasText: form.label })
      await section.getByRole('button', { name: 'Create scoped invitation', exact: true }).click()
      const modal = dialog(page, 'Create scoped invitation')
      await modal
        .getByLabel('Recipient reference (self-reported)', { exact: true })
        .fill(`synthetic-contact-${run}`)
      await reason(modal).fill('Create one scoped synthetic capability.')
      const created = await mutate(page, `/questionnaires/${form.id}/invitations`, 'POST', () =>
        save(modal).click(),
      )
      await closed(modal)
      const link = section.locator('input[readonly]')
      await visible(link)
      invitationUrl = await link.inputValue()
      const url = new URL(invitationUrl)
      assert.ok(
        url.origin === base.origin &&
          url.pathname === '/respondent' &&
          /^#token=[A-Za-z0-9_-]{43}$/.test(url.hash),
        'Expected scoped one-time invitation format',
      )
      await screenshot(page, 'invitation-specialist-masked.png')
      return { invitationId: created.invitation.id }
    })
    await check('native.separate-context-submit-and-receipt', [invited], async () => {
      const native = await newPage()
      assert.ok(
        (await native.context.cookies()).length === 0,
        'Respondent starts without specialist cookies',
      )
      await native.page.goto(invitationUrl)
      await poll(
        () => native.page.url(),
        (url) => new URL(url).pathname === '/respondent' && !new URL(url).hash,
      )
      await native.page.locator('header.questionnaire-header select').selectOption('en')
      await screenshot(native.page, 'respondent-open-before-input.png')
      await native.page
        .getByLabel('Your name/contact reference (self-reported)', { exact: true })
        .fill('Synthetic CFO contact')
      const question = native.page
        .locator('section.questionnaire-question')
        .filter({ hasText: form.label })
      await question.getByRole('combobox', { name: /^Status/ }).selectOption('submitted')
      await question
        .getByLabel('Response', { exact: true })
        .fill('RAW_answer_45 calendar days; synthetic declaration only.')
      await native.page
        .getByRole('button', { name: 'Review before submitting', exact: true })
        .click()
      const receipt = await mutate(native.page, '/respondent/responses', 'POST', () =>
        native.page.getByRole('button', { name: 'Submit responses', exact: true }).click(),
      )
      assert.ok(
        receipt.identity_assurance === 'self_reported_capability_only' &&
          receipt.answer_count === 1,
        'Receipt confirms capability access only, never identity',
      )
      await visible(native.page.getByRole('heading', { name: 'Submission receipt', exact: true }))
      assert.ok(
        (await native.context.cookies()).length === 0,
        'Submission must not create specialist session',
      )
      await screenshot(native.page, 'respondent-receipt.png')
      const detail = await read(page, `/cases/${primaryId}`)
      const response = detail.questionnaires
        .find((q) => q.id === form.id)
        .responses.find((r) => r.invitation_id === invited.invitationId)
      assert.ok(
        response &&
          response.origin === 'SME_direct' &&
          response.entered_by === null &&
          response.answer_json === 'RAW_answer_45 calendar days; synthetic declaration only.',
        'Specialist must see direct origin, no staff actor, and exact original answer',
      )
      return true
    })
    await check('native.revoke-and-deny-original-link', [invited], async () => {
      await openCase(page, primaryId, 'information')
      const section = page
        .locator('#panel-information section.question-list')
        .filter({ hasText: form.label })
      await section.getByRole('button', { name: 'Revoke', exact: true }).click()
      const modal = dialog(page, 'Revoke')
      await reason(modal).fill('Acceptance completes capability lifecycle with explicit revoke.')
      await mutate(page, `/invitations/${invited.invitationId}/revoke`, 'POST', () =>
        save(modal).click(),
      )
      await closed(modal)
      const native = await newPage()
      await native.page.goto(invitationUrl)
      await poll(
        () => native.page.url(),
        (url) => !new URL(url).hash,
      )
      await native.page.locator('header.questionnaire-header select').selectOption('en')
      await visible(
        native.page.getByText(
          'Invitation expired, revoked or unavailable. Ask the specialist for a new scoped invitation.',
          { exact: true },
        ),
      )
      assert.ok(
        (await native.page.locator('section.questionnaire-question').count()) === 0,
        'Revoked capability must not expose questions or stored receipt',
      )
      return true
    })
    invitationUrl = ''

    for (const kind of ['RECEIVABLE', 'PREPAYMENT']) {
      const id = result.cases[kind]
      await check(`${kind}.financial-create-and-null-gate`, [id], async () => {
        await openCase(page, id, 'assessment')
        const registry = page.locator('#panel-assessment > section.panel.aic-section').first()
        await registry.getByRole('button', { name: 'Create', exact: true }).click()
        const modal = dialog(page, 'Financial facts')
        await modal.getByLabel('Start', { exact: true }).fill('2025-01-01')
        await modal.getByLabel('End', { exact: true }).fill('2025-12-31')
        await modal.getByRole('combobox', { name: /^Accounting regime/ }).selectOption('VN_TT133')
        await modal.getByLabel('Source statement version', { exact: true }).fill(`SYN-${run}`)
        await modal
          .getByLabel('Manual entry provenance / source statement', { exact: true })
          .fill('Attributable synthetic staff declaration; no verified financial facts.')
        const fact = modal
          .locator('section.panel.aic-section')
          .filter({ has: page.getByText('current_assets', { exact: true }) })
        const rawLabel = `RAW_assets_${run}`
        await fact.getByLabel('Original label', { exact: true }).fill(rawLabel)
        await fact.getByLabel('Raw decimal (blank means unknown)', { exact: true }).fill('1000.25')
        await reason(modal).fill(
          'Synthetic financial registry acceptance, method remains unconfigured.',
        )
        await mutate(page, `/cases/${id}/financial-sets`, 'POST', () => save(modal).click())
        await closed(modal)
        const saved = await read(page, `/cases/${id}/financial-sets`)
        nullGate(saved)
        assert.ok(saved.metrics.length === 7, 'Saved registry must expose all seven gated metrics')
        const set = saved.sets.find((s) => s.metadata.statement_version === `SYN-${run}`)
        const value = set?.facts.find((f) => f.raw_label === rawLabel)
        assert.ok(
          value &&
            value.raw_value === '1000.25' &&
            value.normalized_decimal === '1000.25' &&
            value.source.kind === 'manual_entry' &&
            value.verification.status === 'unverified',
          'Raw decimal, explicit unit normalization and unverified provenance must persist',
        )
        await visible(page.locator('#panel-assessment').getByText(rawLabel, { exact: true }))
        assert.ok(
          !(await page
            .locator('#panel-assessment')
            .getByRole('button', {
              name: 'Run assessment',
              exact: true,
            })
            .isEnabled()),
          'Numeric assessment action must remain disabled',
        )
        const scores = await page.locator('#panel-assessment .aic-score').allTextContents()
        assert.ok(
          scores.every((s) => s.trim() === '—'),
          'Numeric financial output must remain gated',
        )
        await screenshot(page, `${kind.toLowerCase()}-financial-null-gate.png`)
        for (const language of ['vi', 'zh-CN']) {
          await page.locator('.top-actions .locale-select select').selectOption(language)
          await poll(
            () => page.locator('html').getAttribute('lang'),
            (lang) => lang === language,
          )
          const primary = await page.locator('#panel-assessment').innerText()
          assert.ok(
            !/current_assets|VN_TT133|FHI_METHOD_UNCONFIGURED|EXPLICIT_STATEMENT_SET_SELECTION_REQUIRED/.test(
              primary,
            ),
            'Financial codes must appear only in closed technical details',
          )
          assert.ok(
            primary.includes(rawLabel),
            'Original financial source label must not be translated',
          )
          await page.setViewportSize({ width: 390, height: 844 })
          const width = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
          }))
          assert.ok(width.scroll <= width.client + 1, 'Financial screen must fit mobile viewport')
          await screenshot(page, `${kind.toLowerCase()}-financial-${language}-mobile.png`)
          await page.setViewportSize({ width: 1280, height: 800 })
        }
        return true
      })
    }
    return result
  } finally {
    // Contexts own their downloads/cookies/in-memory capabilities. Never close
    // the caller's Browser or log cleanup errors with secret-bearing URLs.
    for (const context of contexts) {
      try {
        await context.close()
      } catch {
        /* bounded caller-owned runtime */
      }
    }
  }
}

module.exports = { runBrowserAcceptance }
