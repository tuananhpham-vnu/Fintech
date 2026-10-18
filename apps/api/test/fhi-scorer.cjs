const { test } = require('node:test'),
  assert = require('node:assert/strict')
const { Decimal } = require('../dist/financial/decimal'),
  { FHI_METRICS, interpolateFhiMetric, fhiBandForTotal } = require('../dist/financial/fhi-method'),
  { scoreFhi } = require('../dist/financial/fhi-scorer')
function sample() {
  const scope = {
    country: 'VN',
    entity_id: 'synthetic-entity',
    industry: 'wholesale',
    pilot_scope: 'DISTRIBUTION_WHOLESALE_PILOT',
    period: { kind: 'FY', start_date: '2025-01-01', end_date: '2025-12-31' },
    basis: 'standalone',
    accounting_regime: 'IFRS',
    currency: 'VND',
    unit_multiplier: '1',
  }
  const verification = {
    status: 'verified',
    verified_revision: 1,
    verified_by: 'synthetic-specialist',
    verified_at: '2026-10-17T01:28:48Z',
  }
  // Notion §4.3 values; 10+10+20=quick40 is an authored component
  // decomposition for the bridge guard, not a separate canonical fixture.
  const values = {
    current_assets: '60',
    current_liabilities: '40',
    cash: '10',
    unrestricted_short_term_equivalents: '10',
    trade_receivables: '20',
    total_assets: '100',
    total_liabilities: '60',
    total_equity: '40',
    interest_bearing_debt: '50',
    operating_profit: '15',
    depreciation_amortization: '10',
    interest_expense: '5',
    net_revenue: '150',
    cash_from_operations: '20',
  }
  const facts = Object.entries(values).map(([key, value]) => ({
    id: 'fact-' + key,
    revision: 1,
    key,
    statement_set_id: 'set',
    statement_set_revision: 1,
    scope: structuredClone(scope),
    value,
    verification: structuredClone(verification),
    current_source: true,
    source_refs: [{ kind: 'verified_entry', entry_id: 'entry-' + key, entry_revision: 1 }],
  }))
  const bridge = (kind, keys) => ({
    id: 'bridge-' + kind,
    revision: 1,
    kind,
    statement_set_id: 'set',
    statement_set_revision: 1,
    verification: structuredClone(verification),
    current_source: true,
    source_refs: [{ kind: 'verified_entry', entry_id: 'bridge-' + kind, entry_revision: 1 }],
    components: keys.map((key) => ({ key, fact_id: 'fact-' + key, fact_revision: 1 })),
    non_overlapping: true,
  })
  return {
    statement_set: { id: 'set', revision: 1, scope },
    facts,
    quick_assets_bridge: {
      ...bridge('quick_assets', [
        'cash',
        'unrestricted_short_term_equivalents',
        'trade_receivables',
      ]),
      acceptable_per_source: true,
    },
    ebitda_bridge: {
      ...bridge('ebitda', ['operating_profit', 'depreciation_amortization']),
      da_is_addback_to_ebit: true,
    },
  }
}
test('Notion §4.3 exact manual example:73.736111...,73.7,F2; runtime publication remains null', () => {
  const input = sample(),
    result = scoreFhi(input)
  assert.equal(result.calculation.status, 'complete')
  assert.deepEqual(result.calculation.exact_total, {
    numerator: '5309',
    denominator: '72',
    decimal: null,
  })
  assert.equal(result.calculation.display_total, '73.7')
  assert.equal(result.calculation.candidate_band, 'AIC-F2')
  assert.deepEqual(
    result.metrics.map((m) => m.points?.decimal),
    ['11.5', '7.5', '16', '7', '9.375', '6.25', null],
  )
  for (const k of ['score', 'band', 'grade', 'pd']) assert.equal(result[k], null)
  assert.equal(result.runtime.method_status, 'unconfigured')
  assert.equal(result.runtime.pilot_authorized, false)
  assert.deepEqual(scoreFhi(input), result)
})
test('Every canonical anchor, segment interpolation and endpoint clamp uses exact Decimal', () => {
  for (const metric of FHI_METRICS) {
    for (const anchor of metric.anchors)
      assert.equal(
        interpolateFhiMetric(metric.id, Decimal.parse(anchor.value)).points.toString(),
        Decimal.parse(anchor.credit).mul(Decimal.parse(metric.max_points)).toString(),
      )
    for (let i = 1; i < metric.anchors.length; i++) {
      const a = metric.anchors[i - 1],
        b = metric.anchors[i],
        ratio = Decimal.parse(a.value).add(Decimal.parse(b.value)).div(Decimal.parse('2'))
      assert.equal(
        interpolateFhiMetric(metric.id, ratio).credit.toString(),
        Decimal.parse(a.credit).add(Decimal.parse(b.credit)).div(Decimal.parse('2')).toString(),
      )
    }
    assert.equal(
      interpolateFhiMetric(metric.id, Decimal.parse('-100')).credit.toString(),
      Decimal.parse(metric.anchors[0].credit).toString(),
    )
    assert.equal(
      interpolateFhiMetric(metric.id, Decimal.parse('100')).credit.toString(),
      Decimal.parse(metric.anchors.at(-1).credit).toString(),
    )
  }
  for (const [value, band] of [
    ['85', 'AIC-F1'],
    ['84.99999', 'AIC-F2'],
    ['70', 'AIC-F2'],
    ['55', 'AIC-F3'],
    ['40', 'AIC-F4'],
    ['39.9999', 'AIC-F5'],
  ])
    assert.equal(fhiBandForTotal(Decimal.parse(value)), band)
  assert.equal(
    Decimal.parse('900719925474099312345.123').mul(Decimal.parse('1000')).toString(),
    '900719925474099312345123',
  )
  assert.equal(Decimal.parse('-0.00001').format(1), '0.0')
})
test('Missing/unverified/stale/foreign scope and decimal inputs block; no reweight or financial proxies', () => {
  for (const patch of [
    (i) => i.facts.splice(0, 1),
    (i) => (i.facts[0].verification.status = 'unverified'),
    (i) => (i.facts[0].current_source = false),
    (i) => (i.facts[0].value = null),
    (i) => (i.facts[0].scope.currency = 'USD'),
    (i) => (i.facts[0].scope.period.kind = 'TTM'),
    (i) => (i.facts[0].scope.basis = 'consolidated'),
    (i) => (i.facts[0].scope.unit_multiplier = '1000'),
    (i) => (i.facts[0].value = '1e9'),
    (i) => (i.facts[0].verification.verified_revision = 2),
    (i) => (i.statement_set.scope.pilot_scope = 'MANUFACTURING'),
    (i) => (i.quick_assets_bridge = null),
    (i) => (i.ebitda_bridge = null),
    (i) => i.facts.push({ ...i.facts[0] }),
  ]) {
    const input = sample()
    patch(input)
    const result = scoreFhi(input)
    assert.equal(result.calculation.exact_total, null)
    assert.equal(result.calculation.candidate_band, null)
    assert.ok(result.blockers.length)
  }
  const proxy = sample()
  proxy.facts.find((f) => f.key === 'interest_bearing_debt').key = 'total_liabilities'
  assert.equal(scoreFhi(proxy).calculation.exact_total, null)
})
test('Zero interest exception needs verified zero debt; EBITDA still positive, negatives preserved', () => {
  const i = sample(),
    set = (key, value) => (i.facts.find((f) => f.key === key).value = value)
  set('interest_expense', '0')
  assert.equal(scoreFhi(i).calculation.exact_total, null)
  set('interest_bearing_debt', '0')
  assert.equal(scoreFhi(i).metrics[4].points.decimal, '15')
  set('operating_profit', '-10')
  set('depreciation_amortization', '10')
  assert.ok(scoreFhi(i).blockers.some((b) => b.code === 'EBITDA_NON_POSITIVE'))
  const negative = sample()
  negative.facts.find((f) => f.key === 'cash_from_operations').value = '-15'
  assert.equal(scoreFhi(negative).metrics[6].raw_ratio.decimal, '-0.1')
  for (const [key, value] of [
    ['current_liabilities', '0'],
    ['interest_bearing_debt', '-1'],
    ['interest_expense', '-1'],
    ['trade_receivables', '100'],
    ['total_liabilities', '50'],
  ]) {
    const x = sample()
    x.facts.find((f) => f.key === key).value = value
    assert.equal(scoreFhi(x).calculation.exact_total, null)
  }
})
module.exports = { sample }
