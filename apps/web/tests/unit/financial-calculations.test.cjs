require('../helpers/register-typescript.cjs')
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const {
  CalculationProposals,
  calculationFormula,
  relationFormula,
} = require('../../src/features/financial/components/calculation-proposals.tsx')
const { LocaleProvider } = require('../../src/lib/i18n/locale-provider.tsx')
const { financialApi } = require('../../src/features/financial/api.ts')
const { MutationKey } = require('../../src/lib/api/client.ts')
const { isPublicApiRoute } = require('../../src/lib/api/proxy-policy.ts')
const proposal = {
  id: 'current_debt',
  key: 'current_liabilities',
  computed_value: '25',
  blocked_reason: null,
  reason: 'SYNTHETIC complete liability breakdown',
  assumptions: [],
  expression: ['total', 'long', '-'],
  receipt_id: 'receipt',
  source_kind: 'financial_file',
  source_id: 'file',
  source_hash: 'a'.repeat(64),
  inputs: [
    ['total', '60'],
    ['long', '35'],
  ].map(([id, value]) => ({
    id,
    value,
    label: id,
    raw_token: value,
    page: 1,
    quote: id + ' ' + value,
    period_start: '2025-01-01',
    period_end: '2025-12-31',
    basis: 'standalone',
    currency: 'VND',
    unit_multiplier: '1',
    dimension: 'money',
  })),
}
function set(p = proposal) {
  return {
    id: 'set',
    revision: 1,
    verification_stale: false,
    created_at: '2026-10-19T00:00:00Z',
    scope: {
      entity_id: 'entity',
      country: 'VN',
      industry: 'RETAIL',
      period: { kind: 'FY', start_date: '2025-01-01', end_date: '2025-12-31' },
      basis: 'standalone',
      currency: 'VND',
      unit_multiplier: '1',
      accounting_regime: 'VN_TT200',
      pilot_scope: 'RETAIL',
    },
    metadata: {
      calculations: [p],
      observation_kind: 'actual',
      audit_status: 'unknown',
      statement_version: 'v1',
    },
    facts: [],
  }
}
function render(value, locale = 'vi') {
  return renderToStaticMarkup(
    React.createElement(
      LocaleProvider,
      { initialLocale: locale },
      React.createElement(CalculationProposals, {
        set: value,
        revision: 1,
        caseId: 'case',
        reload() {},
      }),
    ),
  )
}
test('proposal review shows the exact expression and sources with application disabled initially', () => {
  assert.equal(calculationFormula(proposal), '(total (60) - long (35))')
  const html = render(set(), 'vi')
  assert.match(html, /AI đề xuất số liệu tính toán/)
  assert.match(html, /total 60/)
  assert.match(html, /<button[^>]*disabled=""[^>]*>Áp dụng đề xuất đã rà soát/)

  // Multilingual localization verified for en and zh-CN
  const htmlEn = render(set(), 'en')
  assert.match(htmlEn, /AI Calculation Proposals/)
  assert.match(htmlEn, /Apply reviewed proposals/)

  const htmlZh = render(set(), 'zh-CN')
  assert.match(htmlZh, /AI 计算指标建议/)
  assert.match(htmlZh, /应用已核查建议/)
})
test('uncertain proposal displays assumptions and cannot be selected as usable', () => {
  const p = {
    ...proposal,
    computed_value: null,
    blocked_reason: 'UNRESOLVED_ASSUMPTIONS',
    assumptions: ['Ownership of provision is unknown'],
  }
  const html = render(set(p))
  assert.match(html, /Ownership of provision is unknown/)
  assert.match(html, /Còn giả định chưa được chứng minh/)
  assert.match(html, /<input[^>]*disabled=""/)
})
test('calculated facts retain their explicit source kind and calculation ID through the write projection', async () => {
  const before = global.fetch,
    value = set(),
    source = {
      kind: 'calculated',
      receipt_id: 'receipt',
      calculation_id: proposal.id,
      fact_key: proposal.key,
      source_kind: 'financial_file',
      source_id: 'file',
      source_hash: 'a'.repeat(64),
      page: 1,
      quote: 'total 60',
    }
  const fact = {
    key: proposal.key,
    raw_value: '25',
    raw_label: 'Số tính ra: ' + proposal.key,
    missing_reason: null,
    source,
  }
  let sent
  global.fetch = async (_, o) => {
    sent = JSON.parse(o.body)
    return Response.json({ revision: 2, set: value })
  }
  try {
    await financialApi.save(
      'case',
      'set',
      {
        expected_revision: 1,
        reason: 'Reviewed formula',
        period: value.scope.period,
        basis: 'standalone',
        accounting_regime: 'VN_TT200',
        currency: 'VND',
        unit_multiplier: '1',
        industry_scope: 'RETAIL',
        observation_kind: 'actual',
        audit_status: 'unknown',
        statement_version: 'v1',
        facts: [fact],
      },
      new MutationKey(),
    )
    assert.deepEqual(sent.facts[0].source, source)
    assert.equal(sent.facts[0].raw_value, '25')
    assert.ok(!('calculations' in sent))
  } finally {
    global.fetch = before
  }
})

test('reasoning UI shows intermediate relations and concrete unresolved reasons without inventing values', () => {
  const proof = {
    variable_id: 'current',
    leaf_ids: ['total', 'long'],
    relation_ids: ['partition'],
    depth: 1,
    exact_value: { numerator: '25', denominator: '1', decimal: '25' },
    variables: [
      { id: 'current', label: 'Nợ ngắn hạn', key: 'current_liabilities' },
      { id: 'total', label: 'Tổng nợ', key: null },
      { id: 'long', label: 'Nợ dài hạn', key: null },
    ],
    steps: [
      {
        id: 'partition',
        label: 'Phân loại nợ',
        reason: 'Đủ các thành phần cùng kỳ',
        kind: 'identity',
        terms: [
          { variable_id: 'total', coefficient: '1' },
          { variable_id: 'current', coefficient: '-1' },
          { variable_id: 'long', coefficient: '-1' },
        ],
        evidence: [{ page: 1, quote: 'Tổng nợ = nợ ngắn hạn + nợ dài hạn' }],
      },
    ],
    intermediate_values: [
      { variable_id: 'current', value: { numerator: '25', denominator: '1', decimal: '25' } },
    ],
  }
  const p = { ...proposal, reasoning_version: 'AIC-FINANCIAL-REASONING-1', proof }
  const html = render(set(p))
  assert.match(html, /Chuỗi tính và các số trung gian/)
  assert.match(html, /Phân loại nợ/)
  assert.match(html, /Nợ ngắn hạn/)
  const unknown = render(
    set({ ...p, computed_value: null, blocked_reason: 'UNDERDETERMINED', inputs: [], proof: null }),
  )
  assert.match(unknown, /chưa đủ xác định duy nhất/)
  assert.doesNotMatch(unknown, /undefined/)
  assert.match(
    relationFormula(
      {
        ...proof.steps[0],
        kind: 'expression',
        output_variable_id: 'current',
        expression: ['total', 'long', '-'],
      },
      proof,
    ),
    /Nợ ngắn hạn = \(Tổng nợ - Nợ dài hạn\)/,
  )
})

test('reasoning read and scoped review routes are permitted but arbitrary internal paths stay blocked', () => {
  // Route helper uses method/path catalog; no direct AI or database access from the browser.
  assert.equal(isPublicApiRoute('GET', 'cases/case1/financial-reasoning/run1'), true)
  assert.equal(isPublicApiRoute('POST', 'cases/case1/financial-reasoning/run1/decisions'), true)
  assert.equal(isPublicApiRoute('POST', 'cases/case1/financial-reasoning/run1/execute'), false)
  assert.equal(isPublicApiRoute('GET', 'internal/financial-reasoning'), false)
})
