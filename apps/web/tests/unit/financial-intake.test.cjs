require('../helpers/register-typescript.cjs')
const { test } = require('node:test'),
  assert = require('node:assert/strict')
const { intakeProgress, pendingIntakes } = require('../../src/features/financial/intake-model.ts')
const { intakeWarnings } = require('../../src/features/financial/intake-model.ts')
const { intakeReviewMessage } = require('../../src/features/financial/intake-model.ts')

test('known reporting periods show missing figures rather than an unresolved period', () => {
  const period = {
    kind: 'FY',
    start_date: '2024-01-01',
    end_date: '2024-12-31',
    basis: 'standalone',
  }
  const item = {
    state: 'needs_review',
    error_code: 'FINANCIAL_PERIOD_OR_FIELDS_UNRESOLVED',
    origin: {},
    classification: { periods: [period], period_issues: [] },
    statements: [{ ...period, missing_keys: ['trade_receivables', 'depreciation_amortization'] }],
  }
  const message = intakeReviewMessage(item, 'vi')
  assert.match(message, /Đã xác định kỳ báo cáo/)
  assert.match(message, /Chưa đủ số liệu/)
  assert.doesNotMatch(message, /Chưa xác định|trade_receivables/)
  const { factKeys } = require('../../src/features/financial/api.ts')
  const corrected = intakeReviewMessage(
    { ...item, statements: [{ ...item.statements[0], set_id: 'corrected' }] },
    'vi',
    [{ id: 'corrected', facts: factKeys.map((key) => ({ key, raw_value: '0' })) }],
  )
  assert.doesNotMatch(corrected, /Chưa đủ số liệu/)
  for (const locale of ['vi', 'en', 'zh-CN']) assert.ok(intakeReviewMessage(item, locale))
  assert.equal(intakeReviewMessage({ ...item, statements: [] }, 'vi'), null)
  assert.equal(
    intakeReviewMessage(
      {
        ...item,
        classification: { ...item.classification, period_issues: [{ severity: 'blocking' }] },
      },
      'vi',
    ),
    null,
  )
  const overlapping = { ...item, origin: { period_candidates: [{ status: 'pending', period }] } }
  assert.match(intakeReviewMessage(overlapping, 'vi'), /2024-01-01 → 2024-12-31/)
  assert.match(
    intakeReviewMessage(overlapping, 'vi'),
    /cả hai tài liệu và các kỳ khác vẫn được giữ/,
  )
})

test('VN missing-field hints do not require the optional international aggregate cash field', () => {
  const period = {
    kind: 'FY',
    start_date: '2024-01-01',
    end_date: '2024-12-31',
    basis: 'standalone',
  }
  const { factKeysForCountry } = require('../../src/features/financial/api.ts')
  const item = {
    state: 'needs_review',
    error_code: 'FINANCIAL_PERIOD_OR_FIELDS_UNRESOLVED',
    origin: {},
    classification: { periods: [period], period_issues: [] },
    statements: [{ ...period, set_id: 'vn-set', missing_keys: [] }],
  }
  const message = intakeReviewMessage(item, 'vi', [
    {
      id: 'vn-set',
      scope: { country: 'VN' },
      facts: factKeysForCountry('VN').map((key) => ({ key, raw_value: '1' })),
    },
  ])
  assert.doesNotMatch(message, /Chưa đủ số liệu|trình bày gộp/)
})
const { isPublicApiRoute } = require('../../src/lib/api/proxy-policy.ts')
const { displayValue } = require('../../src/lib/utils/format.ts')
const { reviewedFacts } = require('../../src/features/financial/intake-model.ts')
const {
  factCitations,
  sameReviewScope,
  periodReviewFacts,
} = require('../../src/features/financial/intake-model.ts')
const { counterpartyWriteProjection } = require('../../src/features/counterparties/api.ts')
test('period warnings identify the unresolved comparative scope while retaining the recognized year', () => {
  const warnings = intakeWarnings({
    classification: {
      warnings: ['PERIOD_REVIEW_REQUIRED:2024-12-31:PERIOD_CONTEXT_REQUIRED'],
      periods: [{ end_date: '2025-12-31' }],
    },
    origin: {},
  })
  assert.match(warnings[0], /2024-12-31/)
  assert.match(warnings[0], /Các kỳ đã nhận diện vẫn được giữ/)
  assert.ok(!warnings[0].includes('PERIOD_CONTEXT_REQUIRED'))
})
test('failed work completes progress but never counts as a successful extraction', () => {
  const items = [
    { state: 'ready', content_type: 'application/pdf' },
    { state: 'failed', content_type: 'application/pdf' },
    { state: 'running', content_type: 'application/pdf' },
    { state: 'expanded', content_type: 'application/zip' },
    { state: 'ready', content_type: 'application/pdf', superseded_by: 'replacement' },
  ]
  assert.deepEqual(intakeProgress(items), {
    total: 3,
    success: 1,
    failed: 1,
    completed: 2,
    percent: 67,
    active: true,
  })
  assert.equal(pendingIntakes(items).length, 2)
})

test('outside-scope ZIP members count as processed without becoming financial successes', () => {
  const items = [
    { state: 'ready', content_type: 'application/pdf' },
    {
      state: 'skipped',
      content_type: 'application/pdf',
      classification: { document_type: 'other' },
    },
    {
      state: 'needs_review',
      content_type: 'application/pdf',
      classification: { document_type: 'other' },
    },
    { state: 'expanded', content_type: 'application/zip' },
  ]
  const progress = intakeProgress(items)
  assert.equal(progress.total, 3)
  assert.equal(progress.completed, 3)
  assert.equal(progress.success, 1)
  assert.equal(pendingIntakes(items).length, 0)
})
test('new company forms omit declaration/reason, preserve tax ID and actual zero', () => {
  const input = {
    name: 'Company',
    country: 'VN',
    tax_id: '000123',
    industry_code: null,
    identity_status: 'confirmed',
  }
  assert.deepEqual(counterpartyWriteProjection(input), {
    name: 'Company',
    country: 'VN',
    tax_id: '000123',
    industry_code: null,
  })
  assert.equal(displayValue(null), 'N/A')
  assert.equal(displayValue(0), '0')
  assert.equal(displayValue('0'), '0')
})
test('financial intake routes are exposed; new transaction creation is retired', () => {
  for (const [verb, path] of [
    ['GET', 'cases/c/financial-intakes'],
    ['POST', 'cases/c/financial-intakes'],
    ['POST', 'cases/c/financial-intakes/j/decision'],
    ['POST', 'cases/c/financial-review-confirmations'],
    ['GET', 'financial-intakes/j/original'],
  ])
    assert.equal(isPublicApiRoute(verb, path), true)
  assert.equal(isPublicApiRoute('POST', 'cases'), false)
  assert.equal(isPublicApiRoute('DELETE', 'financial-intakes/j'), false)
})

test('a missing input needs an explicit BCTC citation, and a sourced zero remains zero', () => {
  const source = {
    kind: 'financial_import',
    receipt_id: 'r',
    source_kind: 'financial_file',
    source_id: 's',
    source_hash: 'a'.repeat(64),
    page: 1,
    quote: 'Net revenue 100',
  }
  const set = {
    facts: [
      {
        key: 'net_revenue',
        raw_value: '100',
        raw_label: 'Net revenue',
        source: { ...source, fact_key: 'net_revenue' },
      },
    ],
  }
  assert.equal(reviewedFacts(set, { net_revenue: '100' }, {}, 'Reviewed').length, 1)
  assert.throws(
    () => reviewedFacts(set, { net_revenue: '100', cash: '0' }, {}, 'Reviewed'),
    /Trang nguồn/,
  )
  const facts = reviewedFacts(
    set,
    { net_revenue: '100', cash: '0' },
    { cash: { page: 2, quote: 'Cash 0' } },
    'Read original',
  )
  assert.equal(facts.find((f) => f.key === 'cash').raw_value, '0')
  assert.equal(facts.find((f) => f.key === 'cash').source.kind, 'statement_entry')
  assert.equal(facts.find((f) => f.key === 'cash').source.page, 2)
  assert.equal(set.facts.length, 1)
})

test('period review preserves a calculated source and its full proof receipt when facts and financial scope are unchanged', () => {
  const source = {
      kind: 'calculated',
      receipt_id: 'proof',
      calculation_id: 'sum_debt',
      fact_key: 'interest_bearing_debt',
      source_kind: 'financial_file',
      source_id: 'file',
      source_hash: 'a'.repeat(64),
      page: 3,
      quote: 'Loans 40 + 20',
    },
    set = {
      scope: {
        period: { kind: 'FY', start_date: '2025-01-01', end_date: '2025-12-31' },
        basis: 'standalone',
        accounting_regime: 'VN_TT200',
        currency: 'VND',
        unit_multiplier: '1',
      },
      facts: [
        {
          key: 'interest_bearing_debt',
          raw_value: '60',
          raw_label: 'Số tính ra: interest_bearing_debt',
          missing_reason: null,
          source,
        },
      ],
    },
    scope = {
      kind: 'FY',
      start: '2025-01-01',
      end: '2025-12-31',
      basis: 'standalone',
      regime: 'VN_TT200',
      currency: 'VND',
      unit: '1',
    },
    file = { receipt_id: 'new-review', source_id: 'file', source_hash: 'a'.repeat(64) },
    citations = factCitations(set),
    before = JSON.stringify(set)
  assert.deepEqual(citations.interest_bearing_debt, { page: 3, quote: 'Loans 40 + 20' })
  assert.equal(sameReviewScope(set, scope), true)
  const facts = periodReviewFacts(
    set,
    true,
    { interest_bearing_debt: '60' },
    citations,
    file,
    'Review industry only',
    (k) => k,
  )
  assert.deepEqual(facts[0].source, source)
  assert.equal(facts[0].raw_label, 'Số tính ra: interest_bearing_debt')
  assert.equal(sameReviewScope(set, { ...scope, currency: 'USD' }), false)
  assert.equal(sameReviewScope(set, { ...scope, start: '2025-04-01' }), false)
  assert.throws(
    () =>
      periodReviewFacts(
        set,
        false,
        { interest_bearing_debt: '60' },
        citations,
        file,
        'Explicit new source',
        (k) => k,
      ),
    /Số tính toán/,
  )
  assert.throws(
    () =>
      periodReviewFacts(set, true, { interest_bearing_debt: '61' }, {}, file, 'Changed', (k) => k),
    /Số tính toán/,
  )
  assert.equal(JSON.stringify(set), before)
})
