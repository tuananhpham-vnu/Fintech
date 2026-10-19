require('../helpers/register-typescript.cjs')
const { test } = require('node:test'),
  assert = require('node:assert/strict')
const {
  decodeAccountingProfile,
  isFullFiscalYear,
} = require('../../src/lib/api/accounting-profile.ts')
const { caseAggregation } = require('../../src/lib/api/decoders.ts')
const { factKeysForCountry } = require('../../src/features/financial/api.ts')
const { fhiMetrics } = require('../../src/features/assessments/fhi.ts')
const {
  CaseAggregationSources,
} = require('../../src/features/assessments/components/case-aggregation-sources.tsx')
const { renderToStaticMarkup } = require('react-dom/server'),
  { createElement } = require('react')
const profile = {
  id: 'US_GAAP_DISTRIBUTION_1',
  country: 'US',
  accounting_regime: 'US_GAAP',
  mapping_version: 'international-accounting-v1',
  method_version: '1.0.0-us-gaap-pilot.1',
}
function summary() {
  return {
    accounting_profile: profile,
    method: 'mean_metric_points_v1',
    included_set_ids: ['fy25'],
    excluded_sets: [],
    metrics: fhiMetrics.map((m) => ({
      metric_id: m.id,
      contributions: [
        {
          set_id: 'fy25',
          set_revision: 1,
          period: { kind: 'FY', start_date: '2024-12-01', end_date: '2025-11-30' },
          points: '0',
          raw_value: '0',
          source_fact_ids: ['fact'],
        },
      ],
      omitted_sets: [],
    })),
  }
}
test('international profile decoder binds country, standard, method and mapping versions together', () => {
  assert.deepEqual(decodeAccountingProfile(profile), profile)
  for (const change of [
    { country: 'CN' },
    { accounting_regime: 'IFRS' },
    { method_version: '1.0.0' },
    { id: 'other' },
    { extra: true },
  ])
    assert.throws(() => decodeAccountingProfile({ ...profile, ...change }))
})
test('shifted annual and 53-week contributors require an explicit compatible international profile', () => {
  assert.deepEqual(caseAggregation(summary()), summary())
  const legacy = summary()
  delete legacy.accounting_profile
  assert.throws(() => caseAggregation(legacy))
  const short = summary()
  short.metrics[0].contributions[0].period.start_date = '2025-06-01'
  assert.throws(() => caseAggregation(short))
  assert.equal(
    isFullFiscalYear({ kind: 'FY', start_date: '2023-09-24', end_date: '2024-09-28' }),
    true,
  )
})
test('aggregate cash field is available only for international review while VN stays at 14 inputs', () => {
  assert.equal(factKeysForCountry('VN').length, 14)
  assert.equal(factKeysForCountry('US').length, 15)
  assert.equal(factKeysForCountry('CN').length, 15)
  assert.ok(!factKeysForCountry().includes('eligible_cash_and_equivalents'))
})
test('international result exposes source standard and experimental comparability limitation', () => {
  for (const locale of ['vi', 'en', 'zh-CN']) {
    const html = renderToStaticMarkup(
      createElement(CaseAggregationSources, {
        value: summary(),
        registry: null,
        page: { items: [] },
        locale,
      }),
    )
    assert.match(html, /US_GAAP/)
    assert.match(html, /1\.0\.0-us-gaap-pilot\.1/)
    assert.match(html, /thử nghiệm|Experimental|试验性/)
  }
})
