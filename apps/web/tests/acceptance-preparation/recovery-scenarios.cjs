const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const kinds = ['RECEIVABLE', 'PREPAYMENT']
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const referenceLabel = 'Contract reference, if available'
const amountReasonLabel = 'Missing information reason · Transaction amount (VND) *'
const termReasonSelect = (dialog) =>
  dialog.getByRole('combobox', {
    name: /^Missing information reason · Term \(calendar days\) \*/,
  })
const actionStages = new Set([
  'action',
  'open-case',
  'frozen-roles',
  'unknown-controls',
  'empty-amount-reason',
  'whitespace-amount-reason',
  'empty-term-reason',
  'persist-exposure',
  'reopen-exposure',
  'create-financial-set',
  'unselected-financial-gate',
  'select-financial-set',
  'keyboard-tabs',
  'keyboard-dialog',
])

// No exception text, assertion values, URLs, response bodies or credentials are
// sent to the recorder. Even a recorder that swallows errors cannot erase FAIL.
function createChecks(step, result, hooks = {}) {
  return async function check(name, dependencies, action) {
    if (dependencies.some((value) => value === undefined)) {
      result.steps.push({ name, status: 'BLOCKED', reason: 'Prerequisite did not pass' })
      return undefined
    }
    let invoked = false
    let completed = false
    let failed = false
    let value
    let failure
    let stage = 'action'
    hooks.begin?.()
    try {
      const recorded = await step(name, async () => {
        if (invoked) {
          failed = true
          throw new Error(`${name}: duplicate invocation refused; sensitive details suppressed`)
        }
        invoked = true
        try {
          value = await action((next) => {
            assert.ok(actionStages.has(next))
            stage = next
          })
          assert.ok(value !== undefined && value !== null && value !== false)
          completed = true
          return value
        } catch (error) {
          failed = true
          // Only numeric coordinates in this owned module may leave a raw stack.
          const location = String(error?.stack ?? '').match(/recovery-scenarios\.cjs:(\d+):(\d+)/)
          const where = location ? ` at helper line ${location[1]}` : ''
          const category =
            error?.name === 'TimeoutError'
              ? 'UI_TIMEOUT'
              : error?.code === 'ERR_ASSERTION'
                ? 'ASSERTION'
                : 'ACTION_ERROR'
          failure = { category, stage, ...(location ? { line: Number(location[1]) } : {}) }
          throw new Error(
            `${name}: ${category} stage=${stage}${where}; sensitive details suppressed`,
          )
        }
      })
      if (!completed || failed || recorded !== value) failed = true
    } catch {
      failed = true
    }
    if (failed && invoked) {
      try {
        await hooks.failure?.(name)
      } catch {
        /* optional artifact must not erase FAIL */
      }
    }
    result.steps.push({
      name,
      status: failed ? 'FAIL' : 'PASS',
      ...(failed ? { failure: failure ?? { category: 'RECORDER_ERROR', stage: 'recorder' } } : {}),
    })
    return failed ? undefined : value
  }
}

function roles(detail, kind, baseline) {
  assert.equal(detail.exposure_kind, kind)
  assert.equal(detail.exposure.organization_role, kind === 'RECEIVABLE' ? 'seller' : 'buyer')
  assert.equal(detail.exposure.counterparty_role, kind === 'RECEIVABLE' ? 'buyer' : 'seller')
  assert.ok(uuid.test(detail.counterparty_id))
  if (baseline) {
    for (const key of [
      'id',
      'organization_id',
      'counterparty_id',
      'lifecycle_stage',
      'policy_version',
    ])
      assert.equal(detail[key], baseline[key])
  }
}

function nullGate(registry, selected = false) {
  assert.equal(registry.method_status, 'unconfigured')
  for (const key of ['score', 'band', 'grade', 'pd']) assert.equal(registry[key], null)
  assert.ok(Array.isArray(registry.sets))
  assert.ok(Array.isArray(registry.metrics))
  if (selected) assert.equal(registry.metrics.length, 7)
  for (const metric of registry.metrics) assert.equal(metric.points, null)
}

// ExposureRead appends new IDs/binding provenance on every write. Compare the
// editable business values and exact source identities, not regenerated IDs.
function editableExposure(exposure) {
  const pick = (value, keys) => Object.fromEntries(keys.map((key) => [key, value[key] ?? null]))
  const source = (value) =>
    pick(
      value,
      value.kind === 'declaration'
        ? ['kind', 'reported_by']
        : value.kind === 'document'
          ? [
              'kind',
              'reported_by',
              'document_id',
              'document_version',
              'document_sha256',
              'evidence_ref',
            ]
          : [
              'kind',
              'reported_by',
              'questionnaire_id',
              'question_id',
              'response_id',
              'response_revision',
            ],
    )
  const record = (value, keys) => ({
    ...pick(value, keys),
    source_refs: value.source_refs.map(source),
  })
  return {
    ...pick(exposure, [
      'amount_vnd',
      'amount_missing_reason',
      'term_days',
      'term_null_reason',
      'organization_role',
      'counterparty_role',
      'contract_ref',
      'due_date',
      'source_origin',
    ]),
    claims: (exposure.claims ?? []).map((value) =>
      record(value, [
        'kind',
        'event_state',
        'claimant_party',
        'payer_party',
        'payee_party',
        'currency',
        'amount_vnd',
        'amount_missing_reason',
        'occurred_on',
        'planned_on',
        'date_missing_reason',
        'obligation_ref',
      ]),
    ),
    conditions: exposure.conditions.map((value) =>
      record(value, [
        'kind',
        'scope',
        'trigger_text',
        'reported_state',
        'due_on',
        'missing_reason',
      ]),
    ),
  }
}

/**
 * Caller supplies an existing Playwright Browser, existing synthetic case IDs
 * ({ RECEIVABLE: id, PREPAYMENT: id }, or {id} values), private absolute output,
 * and step(name, fn) that awaits fn ONCE and returns its value/undefined.
 * Fresh disposable tenant only; this deliberately changes the supplied cases.
 * No imports/startup of Playwright, services, DB, provider, seeds or interception.
 * UI writes only. request.get is supplemental and always same-origin.
 */
async function runRecoveryScenarios({ browser, origin, username, password, output, step, cases }) {
  assert.ok(browser && typeof browser.newContext === 'function', 'Supplied Browser required')
  let base
  try {
    base = new URL(origin)
  } catch {
    throw new Error('Valid HTTP origin required')
  }
  assert.ok(['http:', 'https:'].includes(base.protocol), 'HTTP origin required')
  assert.ok(!base.username && !base.password && !base.search && !base.hash, 'Plain origin required')
  assert.ok(base.pathname === '/', 'Origin must have no path')
  assert.ok(
    typeof username === 'string' && username && typeof password === 'string' && password,
    'Explicit synthetic credentials required',
  )
  assert.ok(typeof step === 'function', 'Step recorder required')
  assert.ok(
    typeof output === 'string' && path.isAbsolute(output),
    'Private absolute output required',
  )
  assert.ok(cases && typeof cases === 'object', 'Explicit existing cases required')
  const run = randomUUID().replaceAll('-', '')
  const result = {
    run,
    steps: [],
    cases: {},
    screenshots: [],
    screenshotOmissions: [],
    counts: {},
    ok: false,
    complete: false,
  }
  let observedPage
  const check = createChecks(step, result, {
    begin: () => {
      observedPage = undefined
    },
    failure: async (name) => {
      if (!observedPage) return
      try {
        await screenshot(observedPage, `failure-${name.replaceAll('.', '-')}`)
      } catch {
        result.screenshotOmissions.push({ name, reason: 'Safe screenshot unavailable' })
      }
    },
  })
  const contexts = []
  const visible = (locator) => locator.waitFor({ state: 'visible' })
  const hidden = (locator) => locator.waitFor({ state: 'hidden' })
  const modal = (page, name) => page.getByRole('dialog', { name, exact: true })
  // A wrapped textarea's label text can include its persisted default text on
  // remount. Match the stable label prefix, including literal punctuation.
  const field = (dialog, label) =>
    dialog.getByLabel(new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  const button = (scope, name) => scope.getByRole('button', { name, exact: true })
  const save = (dialog) => button(dialog, 'Save')
  const reason = (dialog) => field(dialog, 'Reason / findings *')
  const note = (name, status, explanation) =>
    result.steps.push({ name, status, reason: explanation })

  async function newPage() {
    const context = await browser.newContext({
      baseURL: base.origin,
      viewport: { width: 1280, height: 800 },
      acceptDownloads: false,
    })
    contexts.push(context) // Track before newPage: partial initialization also cleans up.
    const page = await context.newPage()
    observedPage = page
    page.setDefaultTimeout(12_000)
    page.setDefaultNavigationTimeout(25_000)
    page.on('dialog', (dialog) => {
      void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()).catch(() => {})
    })
    return page
  }
  async function readResponse(page, route) {
    assert.ok(route.startsWith('/'))
    const url = new URL(`/api/v2${route}`, base.origin)
    assert.equal(url.origin, base.origin)
    const response = await page.request.get(url.href, { maxRedirects: 0 })
    return response
  }
  async function read(page, route) {
    const response = await readResponse(page, route)
    assert.equal(response.status(), 200)
    return response.json()
  }
  function matches(response, route, method) {
    const url = new URL(response.url())
    return (
      url.origin === base.origin &&
      url.pathname === `/api/v2${route}` &&
      response.request().method() === method
    )
  }
  async function uiWrite(page, route, method, action, expected = [200, 201]) {
    observedPage = page
    // One action only. Response waiting is observation, never a mutation retry.
    const [response] = await Promise.all([
      page.waitForResponse((r) => matches(r, route, method)),
      action(),
    ])
    assert.ok(expected.includes(response.status()))
    return response
  }
  async function english(page) {
    await page.locator('.top-actions .locale-select select').selectOption('en')
    await page.locator('html[lang="en"]').waitFor({ state: 'attached' })
  }
  async function login(page) {
    observedPage = page
    await page.goto('/login')
    await page.locator('.login-locale select').selectOption('en')
    await page.locator('input[name="username"]').fill(username)
    await page.locator('input[name="password"]').fill(password)
    await uiWrite(page, '/auth/login', 'POST', () => page.locator('button.login-enter').click())
    await page.waitForURL((url) => url.origin === base.origin && url.pathname === '/cases')
    await visible(page.locator('.app-shell'))
    const session = await read(page, '/auth/me')
    assert.equal(session.user.role, 'specialist')
    assert.ok(uuid.test(session.user.id) && uuid.test(session.user.organization_id))
    // The session object includes CSRF; retain only identity in memory.
    return { userId: session.user.id, organizationId: session.user.organization_id }
  }
  async function openCase(page, id, tab = 'overview') {
    observedPage = page
    await page.goto(`/cases/${id}#${tab}`)
    await page.reload() // Same-case hash changes do not reload resources.
    await visible(page.locator(`#panel-${tab}`))
    await english(page)
  }
  async function edit(page) {
    await button(page.locator('#panel-overview'), 'Edit').click()
    const dialog = modal(page, 'Edit')
    await visible(dialog)
    return dialog
  }
  async function screenshot(page, name) {
    const url = new URL(page.url())
    assert.equal(url.origin, base.origin)
    assert.ok(
      !url.search && /^(#(overview|files|review|information|assessment|history))?$/.test(url.hash),
    )
    assert.ok(/^\/(login|cases(\/[0-9a-f-]{36})?)$/i.test(url.pathname))
    // No respondent/invitation pages are used. Refuse arbitrary fragments/queries;
    // mask all readonly fields and password/username fields, including textareas.
    const filename = `recovery-${run}-${name}.png`
    await fs.mkdir(output, { recursive: true })
    await page.screenshot({
      path: path.join(output, filename),
      fullPage: true,
      mask: [
        page.locator(
          '[readonly], [role="alert"], input[type="password"], input[name="password"], input[name="username"]',
        ),
      ],
    })
    result.screenshots.push(filename)
  }
  async function discard(page, dialog) {
    await button(dialog, 'Close').click()
    const prompt = page.locator('dialog.leave-prompt')
    await visible(prompt)
    await button(prompt, 'Discard changes').click()
    await hidden(dialog)
  }
  async function saveExposure(page, id, dialog) {
    await uiWrite(page, `/cases/${id}/exposure`, 'PATCH', () => save(dialog).click())
    await hidden(dialog)
    return read(page, `/cases/${id}`)
  }
  async function frozenEditor(dialog, kind) {
    assert.equal(
      await dialog.getByRole('combobox', { name: /^Transaction type/ }).isDisabled(),
      true,
    )
    assert.equal(
      await dialog.getByRole('combobox', { name: /^Transaction stage/ }).isDisabled(),
      true,
    )
    const pair = await dialog.locator('.metadata-grid').first().locator('strong').allTextContents()
    assert.deepEqual(
      pair,
      kind === 'RECEIVABLE'
        ? ['Seller / service provider', 'Buyer / customer']
        : ['Buyer / customer', 'Seller / service provider'],
    )
  }
  function watchPatches(page, id) {
    let count = 0
    const listener = (request) => {
      const url = new URL(request.url())
      if (
        url.origin === base.origin &&
        url.pathname === `/api/v2/cases/${id}/exposure` &&
        request.method() === 'PATCH'
      )
        count++
    }
    page.on('request', listener)
    return { count: () => count, stop: () => page.off('request', listener) }
  }
  const financialPanel = (page) =>
    page.locator('#panel-assessment > section.panel.aic-section').first()
  const financialCard = (page, label) =>
    financialPanel(page)
      .locator('article.panel.aic-section')
      .filter({ has: page.getByText(label, { exact: true }) })
  const assets = (dialog) =>
    dialog.locator('section.panel.aic-section').filter({ hasText: 'current_assets' })
  async function selectedRegistry(page, id, setId) {
    const registry = await read(page, `/cases/${id}/financial-sets?set_id=${setId}`)
    nullGate(registry, true)
    assert.equal(registry.selected_set_id, setId)
    return registry
  }
  async function selectSet(page, id, setId) {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          matches(r, `/cases/${id}/financial-sets`, 'GET') &&
          new URL(r.url()).searchParams.get('set_id') === setId,
      ),
      financialPanel(page)
        .getByRole('combobox', { name: /^Select one statement set for ratios/ })
        .selectOption(setId),
    ])
    assert.equal(response.status(), 200)
    const registry = await response.json()
    nullGate(registry, true)
    assert.equal(registry.selected_set_id, setId)
    return registry
  }
  async function assertNumericUI(page) {
    assert.equal(
      await button(page.locator('#panel-assessment'), 'Run assessment').isDisabled(),
      true,
    )
    const scores = await page.locator('#panel-assessment .aic-score').allTextContents()
    // Score cards exist only if an assessment already exists. The seven FHI
    // component buttons always render, including when assessment creation is gated.
    for (const value of scores) assert.equal(value.trim(), '—')
    const points = await page
      .locator('#panel-assessment .aic-factor-grid')
      .last()
      .locator('button.aic-factor > span')
      .allTextContents()
    assert.equal(points.length, 7)
    assert.ok(points.every((value) => /^—\s*\/\s*\d+$/.test(value.trim())))
  }

  try {
    let pageA, pageB
    const signedA = await check('recovery.auth.specialist-A', [], async () => {
      pageA = await newPage()
      return login(pageA)
    })
    const signedB = await check('recovery.auth.specialist-B', [], async () => {
      pageB = await newPage()
      const identity = await login(pageB)
      if (signedA) assert.deepEqual(identity, signedA)
      return identity
    })
    const baselines = {}
    for (const kind of kinds) {
      const supplied = typeof cases[kind] === 'string' ? cases[kind] : cases[kind]?.id
      const id = typeof supplied === 'string' && uuid.test(supplied) ? supplied : undefined
      if (id) result.cases[kind] = id
      const baseline = await check(`${kind}.recovery.existing-case`, [signedA, id], async () => {
        const detail = await read(pageA, `/cases/${id}`)
        assert.equal(detail.id, id)
        assert.equal(detail.organization_id, signedA.organizationId)
        assert.ok(Number.isSafeInteger(detail.revision) && detail.revision > 0)
        roles(detail, kind)
        return detail
      })
      baselines[kind] = baseline

      const exposure = await check(
        `${kind}.recovery.unknown-exposure-and-reasons`,
        [baseline],
        async (phase) => {
          phase('open-case')
          await openCase(pageA, id)
          const dialog = await edit(pageA)
          phase('frozen-roles')
          await frozenEditor(dialog, kind)
          phase('unknown-controls')
          await dialog
            .getByRole('checkbox', { name: 'Transaction amount (VND) · Unknown', exact: true })
            .check()
          await dialog
            .getByRole('checkbox', { name: 'Term (calendar days) · Unknown', exact: true })
            .check()
          assert.equal(await field(dialog, 'Transaction amount (VND) *').isDisabled(), true)
          assert.equal(await field(dialog, 'Term (calendar days) *').isDisabled(), true)
          const amountReason = field(dialog, amountReasonLabel)
          const termReason = termReasonSelect(dialog)
          const watch = watchPatches(pageA, id)
          try {
            // Empty amount reason: native validation, no writes and same persisted revision.
            phase('empty-amount-reason')
            await amountReason.fill('')
            await termReason.selectOption('source_missing')
            await save(dialog).click()
            assert.equal(await amountReason.evaluate((node) => node.validity.valueMissing), true)
            assert.equal((await read(pageA, `/cases/${id}`)).revision, baseline.revision)
            // Whitespace passes native required, but the actual builder must reject it.
            phase('whitespace-amount-reason')
            await amountReason.fill('   ')
            await save(dialog).click()
            await visible(dialog.locator('[role="alert"]').first())
            assert.equal((await read(pageA, `/cases/${id}`)).revision, baseline.revision)
            const amountText = `Synthetic unknown amount ${run}`
            phase('empty-term-reason')
            await amountReason.fill(amountText)
            await termReason.selectOption('')
            await save(dialog).click()
            assert.equal(await termReason.evaluate((node) => node.validity.valueMissing), true)
            assert.equal(watch.count(), 0)
            assert.equal((await read(pageA, `/cases/${id}`)).revision, baseline.revision)
            await termReason.selectOption('source_missing')
            phase('persist-exposure')
            const ref = `REC-${kind}-${run}`
            await field(dialog, referenceLabel).fill(ref)
            const saved = await saveExposure(pageA, id, dialog)
            assert.equal(watch.count(), 1)
            assert.equal(saved.revision, baseline.revision + 1)
            assert.equal(saved.exposure.amount_vnd, null)
            assert.equal(saved.exposure.amount_missing_reason, amountText)
            assert.equal(saved.exposure.term_days, null)
            assert.equal(saved.exposure.term_null_reason, 'source_missing')
            assert.equal(saved.exposure.contract_ref, ref)
            roles(saved, kind, baseline)
            phase('reopen-exposure')
            await openCase(pageA, id)
            const reopened = await edit(pageA)
            assert.equal(await field(reopened, amountReasonLabel).inputValue(), amountText)
            assert.equal(await termReasonSelect(reopened).inputValue(), 'source_missing')
            await button(reopened, 'Close').click()
            await hidden(reopened)
            return saved
          } finally {
            watch.stop()
          }
        },
      )

      await check(`${kind}.recovery.claim-unknown-is-declaration`, [exposure], async () => {
        await openCase(pageA, id)
        const before = await read(pageA, `/cases/${id}`)
        const dialog = await edit(pageA)
        const priorCount = before.exposure.claims?.length ?? 0
        await button(dialog, 'Add claim').click()
        const claim = dialog.getByRole('region', {
          name: `Payment claims ${priorCount + 1}`,
          exact: true,
        })
        await claim.getByRole('combobox', { name: /^Transaction stage/ }).selectOption('actual')
        const amountText = `Synthetic claim amount unknown ${run}`
        const dateText = `Synthetic actual date unknown ${run}`
        await field(claim, 'Missing information reason *').fill(amountText)
        await field(claim, 'Missing information reason · Actual date *').fill(dateText)
        const obligation = `REC-CLAIM-${run}`
        await field(claim, 'Obligation reference').fill(obligation)
        const saved = await saveExposure(pageA, id, dialog)
        assert.equal(saved.revision, before.revision + 1)
        assert.equal(saved.exposure.claims.length, priorCount + 1)
        const item = saved.exposure.claims.find((value) => value.obligation_ref === obligation)
        assert.ok(item)
        assert.equal(item.amount_vnd, null)
        assert.equal(item.amount_missing_reason, amountText)
        assert.equal(item.occurred_on, null)
        assert.equal(item.date_missing_reason, dateText)
        assert.equal(item.event_state, 'actual')
        assert.equal(item.kind, 'paid')
        const payer = kind === 'RECEIVABLE' ? 'counterparty' : 'organization'
        assert.equal(item.payer_party, payer)
        assert.equal(item.payee_party, payer === 'organization' ? 'counterparty' : 'organization')
        assert.equal(item.claimant_party, payer)
        assert.equal(item.verification, 'unverified')
        assert.equal(item.source_refs.length, 1)
        const source = item.source_refs[0]
        assert.equal(source.kind, 'declaration')
        assert.equal(source.reported_by, payer)
        assert.ok(uuid.test(source.source_id) && uuid.test(source.binding_id))
        assert.equal(source.source_revision, saved.revision)
        roles(saved, kind, baseline)
        return true
      })

      await check(`${kind}.recovery.real-409-keeps-draft`, [exposure, signedB], async () => {
        await openCase(pageA, id)
        await openCase(pageB, id)
        const beforeA = await read(pageA, `/cases/${id}`)
        const beforeB = await read(pageB, `/cases/${id}`)
        assert.equal(beforeA.revision, beforeB.revision)
        const editorA = await edit(pageA)
        const editorB = await edit(pageB)
        const winner = `REC-WINNER-${kind}-${run}`
        const draft = `REC-DRAFT-${kind}-${run}`
        await field(editorA, referenceLabel).fill(winner)
        await field(editorB, referenceLabel).fill(draft)
        const savedA = await saveExposure(pageA, id, editorA)
        assert.equal(savedA.revision, beforeA.revision + 1)
        assert.equal(savedA.exposure.contract_ref, winner)
        const watch = watchPatches(pageB, id)
        try {
          const rejected = await uiWrite(
            pageB,
            `/cases/${id}/exposure`,
            'PATCH',
            () => save(editorB).click(),
            [409],
          )
          assert.equal(rejected.request().postDataJSON().expected_revision, beforeB.revision)
          await visible(editorB.locator('.aic-recovery'))
          assert.equal(await field(editorB, referenceLabel).inputValue(), draft)
          const after = await read(pageA, `/cases/${id}`)
          assert.equal(after.revision, savedA.revision)
          assert.deepEqual(after.exposure, savedA.exposure)
          assert.equal(watch.count(), 1)
          await button(editorB.locator('.aic-recovery'), 'Refresh').click()
          const rebase = button(editorB, 'Use this revision and keep my inputs')
          await visible(rebase)
          assert.ok((await editorB.locator('.aic-recovery pre').innerText()).includes(winner))
          assert.equal(await field(editorB, referenceLabel).inputValue(), draft)
          await rebase.click()
          assert.equal(await field(editorB, referenceLabel).inputValue(), draft)
          assert.equal(watch.count(), 1) // Neither refresh nor accepting revision writes.
          const savedB = await saveExposure(pageB, id, editorB)
          assert.equal(watch.count(), 2) // Explicit resubmit only.
          assert.equal(savedB.revision, savedA.revision + 1)
          assert.equal(savedB.exposure.contract_ref, draft)
          const expected = { ...editableExposure(beforeB.exposure), contract_ref: draft }
          assert.deepEqual(editableExposure(savedB.exposure), expected)
          roles(savedB, kind, baseline)
          await openCase(pageB, id)
          assert.ok((await pageB.locator('.aic-transaction-strip').innerText()).includes(draft))
          await screenshot(pageB, `${kind.toLowerCase()}-rebased`)
          return savedB
        } finally {
          watch.stop()
        }
      })

      const financial = await check(
        `${kind}.recovery.financial-second-set-selection`,
        [baseline],
        async (phase) => {
          phase('open-case')
          await openCase(pageA, id, 'assessment')
          const initial = await read(pageA, `/cases/${id}/financial-sets`)
          nullGate(initial)
          // Usually the existing browser flow supplied one set. If absent, create
          // a baseline through UI as well; never fabricate a GET or API-write seed.
          const count = initial.sets.length ? 1 : 2
          let label, version, statement
          for (let index = 0; index < count; index++) {
            phase('create-financial-set')
            label = `REC_assets_${kind}_${run}_${index}`
            version = `REC-${run}-${index}`
            statement = `Synthetic manually entered assets, personally checked: 1000.25 VND; ${version}`
            await button(financialPanel(pageA), 'Create').click()
            const dialog = modal(pageA, 'Financial facts')
            await field(dialog, 'Start').fill(index === 0 ? '2024-01-01' : '2025-01-01')
            await field(dialog, 'End').fill(index === 0 ? '2024-12-31' : '2025-12-31')
            await dialog
              .getByRole('combobox', { name: /^Accounting regime/ })
              .selectOption('VN_TT133')
            await field(dialog, 'Source statement version').fill(version)
            await field(dialog, 'Manual entry provenance / source statement').fill(statement)
            await field(assets(dialog), 'Original label').fill(label)
            await field(assets(dialog), 'Raw decimal (blank means unknown)').fill('1000.25')
            await reason(dialog).fill(
              'Synthetic manual financial entry; method remains unconfigured.',
            )
            await uiWrite(pageA, `/cases/${id}/financial-sets`, 'POST', () => save(dialog).click())
            await hidden(dialog)
            await visible(financialCard(pageA, label))
            // Resource reload and parent case reload are independent. Remount
            // before a second create so its expected_revision is freshly read.
            if (index + 1 < count) await openCase(pageA, id, 'assessment')
          }
          phase('unselected-financial-gate')
          const unselected = await read(pageA, `/cases/${id}/financial-sets`)
          nullGate(unselected)
          assert.equal(unselected.sets.length, initial.sets.length + count)
          assert.ok(unselected.sets.length >= 2)
          assert.equal(unselected.selected_set_id, null)
          assert.equal(unselected.metrics.length, 0)
          assert.ok(unselected.blockers.includes('EXPLICIT_STATEMENT_SET_SELECTION_REQUIRED'))
          const owned = unselected.sets.filter((set) => set.metadata.statement_version === version)
          assert.equal(owned.length, 1)
          const set = owned[0]
          assert.ok(uuid.test(set.id))
          assert.equal(set.facts.length, 1)
          const fact = set.facts[0]
          assert.equal(fact.key, 'current_assets')
          assert.equal(fact.raw_label, label)
          assert.equal(fact.raw_value, '1000.25')
          assert.equal(fact.normalized_decimal, '1000.25')
          assert.deepEqual(fact.source, { kind: 'manual_entry', statement })
          assert.equal(fact.verification.status, 'unverified')
          phase('select-financial-set')
          await selectSet(pageA, id, set.id)
          const other = unselected.sets.find((entry) => entry.id !== set.id)
          assert.ok(other)
          await selectSet(pageA, id, other.id)
          await selectSet(pageA, id, set.id)
          await assertNumericUI(pageA)
          return { set, label, statement }
        },
      )

      const verified = await check(
        `${kind}.recovery.financial-manual-verification`,
        [financial],
        async () => {
          await openCase(pageA, id, 'assessment')
          await selectSet(pageA, id, financial.set.id)
          await button(financialCard(pageA, financial.label), 'Review verification').click()
          const dialog = modal(pageA, 'Review verification')
          // Check the displayed original manual entry; this is not document/identity verification.
          assert.equal(financial.set.facts[0].raw_value, '1000.25')
          assert.ok(
            (
              await financialCard(pageA, financial.label).locator('blockquote').textContent()
            ).includes(financial.statement),
          )
          await dialog
            .getByRole('checkbox', { name: `${financial.label}: 1000.25 → 1000.25`, exact: true })
            .check()
          await field(dialog, 'Status').selectOption('verified')
          await reason(dialog).fill(
            'Checked this synthetic manual entry and original declared 1000.25 VND; no document or identity claim.',
          )
          await uiWrite(pageA, `/financial-sets/${financial.set.id}/verification`, 'POST', () =>
            save(dialog).click(),
          )
          await hidden(dialog)
          const registry = await selectedRegistry(pageA, id, financial.set.id)
          const set = registry.sets.find((entry) => entry.id === financial.set.id)
          assert.ok(set && set.facts.length === 1)
          assert.equal(set.verification_stale, false)
          const fact = set.facts[0]
          assert.equal(fact.verification.status, 'verified')
          assert.equal(fact.verification.verified_by, signedA.userId)
          assert.equal(fact.verification.verified_revision, fact.revision)
          assert.deepEqual(fact.source, financial.set.facts[0].source)
          assert.equal(fact.raw_value, '1000.25')
          await assertNumericUI(pageA)
          return { ...financial, set }
        },
      )

      const stale = await check(
        `${kind}.recovery.financial-snapshot-stale`,
        [verified],
        async () => {
          // The released snapshot includes Exposure. A real reference edit makes
          // verification stale without uploading or dispatching any provider job.
          await openCase(pageA, id)
          const before = await read(pageA, `/cases/${id}`)
          const dialog = await edit(pageA)
          const ref = `REC-STALE-${run}`
          await field(dialog, referenceLabel).fill(ref)
          const after = await saveExposure(pageA, id, dialog)
          assert.equal(after.revision, before.revision + 1)
          assert.equal(after.exposure.contract_ref, ref)
          roles(after, kind, baseline)
          const registry = await selectedRegistry(pageA, id, verified.set.id)
          const set = registry.sets.find((entry) => entry.id === verified.set.id)
          assert.ok(set && set.facts.length === 1)
          assert.equal(set.verification_stale, true)
          assert.equal(set.facts[0].verification.status, 'stale')
          assert.equal(set.facts[0].raw_value, '1000.25')
          assert.deepEqual(set.facts[0].source, verified.set.facts[0].source)
          await openCase(pageA, id, 'assessment')
          await selectSet(pageA, id, set.id)
          await visible(financialCard(pageA, verified.label).locator('.tag.amber'))
          await assertNumericUI(pageA)
          return verified
        },
      )

      await check(
        `${kind}.recovery.financial-source-edit-requires-reverification`,
        [stale],
        async () => {
          await openCase(pageA, id, 'assessment')
          await button(financialCard(pageA, stale.label), 'Edit').click()
          const dialog = modal(pageA, 'Financial facts')
          const changed = `Corrected synthetic manual provenance ${run}; original amount remains 1000.25 VND.`
          await field(dialog, 'Manual entry provenance / source statement').fill(changed)
          await reason(dialog).fill('Source statement changed; require a fresh human verification.')
          await uiWrite(pageA, `/financial-sets/${stale.set.id}`, 'PATCH', () =>
            save(dialog).click(),
          )
          await hidden(dialog)
          const registry = await selectedRegistry(pageA, id, stale.set.id)
          const set = registry.sets.find((entry) => entry.id === stale.set.id)
          assert.ok(set && set.facts.length === 1)
          assert.equal(set.revision, stale.set.revision + 1)
          const fact = set.facts[0]
          assert.equal(fact.id, stale.set.facts[0].id)
          assert.equal(fact.revision, stale.set.facts[0].revision + 1)
          assert.deepEqual(fact.source, { kind: 'manual_entry', statement: changed })
          assert.equal(fact.raw_value, '1000.25')
          assert.equal(fact.normalized_decimal, '1000.25')
          assert.equal(fact.verification.status, 'unverified')
          assert.equal(fact.verification.verified_by, null)
          await visible(financialCard(pageA, stale.label).getByText(changed, { exact: true }))
          await assertNumericUI(pageA)
          roles(await read(pageA, `/cases/${id}`), kind, baseline)
          await screenshot(pageA, `${kind.toLowerCase()}-financial-unverified`)
          return true
        },
      )

      await check(`${kind}.recovery.keyboard-tabs-and-clean-dialog`, [baseline], async (phase) => {
        phase('open-case')
        await openCase(pageA, id)
        phase('keyboard-tabs')
        const start = pageA.locator('#tab-overview')
        await start.focus()
        for (const [key, tab] of [
          ['ArrowRight', 'files'],
          ['ArrowLeft', 'overview'],
          ['End', 'history'],
          ['Home', 'overview'],
        ]) {
          await pageA.keyboard.press(key)
          const selected = pageA.locator(`#tab-${tab}`)
          assert.equal(await selected.getAttribute('aria-selected'), 'true')
          assert.equal(await selected.evaluate((node) => node === document.activeElement), true)
          await visible(pageA.locator(`#panel-${tab}`))
          assert.equal(await pageA.getByRole('tab', { selected: true }).count(), 1)
        }
        phase('keyboard-dialog')
        const dialog = await edit(pageA)
        assert.equal(await dialog.evaluate((node) => node.contains(document.activeElement)), true)
        await pageA.keyboard.press('Escape')
        await hidden(dialog)
        assert.equal(
          await button(pageA.locator('#panel-overview'), 'Edit').evaluate(
            (node) => node === document.activeElement,
          ),
          true,
        )
        return true
      })
      // Conflict failure does not block independent financial/keyboard coverage.
      note(
        `${kind}.recovery.source-match-field-verify`,
        'NOT RUN',
        'Classification and field verification exist in JSX/DTO; cases alone provide no reviewed source-to-party identity oracle. Never assert a false match.',
      )
      note(
        `${kind}.recovery.document-replace-and-request-supplement`,
        'NOT RUN',
        'Upload replace/response modes exist. They dispatch extraction; this provider-independent module has no approved source/replacement oracle or provider-call authorization.',
      )
    }

    await check(
      'recovery.auth.logout-and-draft-isolation',
      [signedA, baselines.RECEIVABLE, baselines.PREPAYMENT],
      async () => {
        const first = baselines.RECEIVABLE.id
        const second = baselines.PREPAYMENT.id
        await openCase(pageA, first)
        const before = await read(pageA, `/cases/${first}`)
        const draft = `UNSAVED-${run}`
        const dialog = await edit(pageA)
        await field(dialog, referenceLabel).fill(draft)
        await pageA.keyboard.press('Escape')
        const prompt = pageA.locator('dialog.leave-prompt')
        await visible(prompt)
        await pageA.keyboard.press('Escape') // Native cancel means stay, preserving input.
        await hidden(prompt)
        assert.equal(await field(dialog, referenceLabel).inputValue(), draft)
        await discard(pageA, dialog)
        await openCase(pageA, second)
        const other = await read(pageA, `/cases/${second}`)
        const otherDialog = await edit(pageA)
        assert.equal(
          await field(otherDialog, referenceLabel).inputValue(),
          other.exposure.contract_ref ?? '',
        )
        assert.notEqual(await field(otherDialog, referenceLabel).inputValue(), draft)
        await button(otherDialog, 'Close').click()
        await hidden(otherDialog)
        await uiWrite(
          pageA,
          '/auth/logout',
          'POST',
          () => button(pageA.locator('.top-actions'), 'Sign out').click(),
          [200, 204],
        )
        await pageA.waitForURL((url) => url.pathname === '/login')
        assert.equal((await readResponse(pageA, '/auth/me')).status(), 401)
        assert.equal((await readResponse(pageA, `/cases/${first}`)).status(), 401)
        assert.equal(await pageA.locator('dialog[open]').count(), 0)
        assert.deepEqual(await login(pageA), signedA)
        await openCase(pageA, first)
        const after = await read(pageA, `/cases/${first}`)
        assert.equal(after.revision, before.revision)
        assert.deepEqual(after.exposure, before.exposure)
        const fresh = await edit(pageA)
        assert.equal(
          await field(fresh, referenceLabel).inputValue(),
          before.exposure.contract_ref ?? '',
        )
        assert.notEqual(await field(fresh, referenceLabel).inputValue(), draft)
        await button(fresh, 'Close').click()
        await hidden(fresh)
        return true
      },
    )
    note(
      'recovery.auth.expiry-and-cross-identity-isolation',
      'NOT RUN',
      'No short-lived session or second identity supplied. Logout/relogin proves discarded drafts only; no synthetic expiry event or tenant-isolation claim.',
    )
  } finally {
    // Close every owned context exactly once even if recorder never runs callbacks.
    // Preserve caller Browser and report cleanup failure rather than swallowing it.
    for (const [index, context] of contexts.entries()) {
      let closed = false
      try {
        await context.close()
        closed = true
      } catch {}
      await check(`recovery.cleanup.context-${index + 1}`, [], async () => {
        assert.equal(closed, true)
        return true
      })
    }
  }
  for (const status of ['PASS', 'FAIL', 'BLOCKED', 'NOT RUN'])
    result.counts[status] = result.steps.filter((item) => item.status === status).length
  result.ok = result.counts.FAIL === 0 && result.counts.BLOCKED === 0
  result.complete = result.ok && result.counts['NOT RUN'] === 0
  return result
}

module.exports = { runRecoveryScenarios, _testing: { createChecks, nullGate } }
