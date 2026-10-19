require('../helpers/register-typescript.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { partialAssessment } = require('../../src/lib/api/decoders.ts')
const { companyResult } = require('../../src/features/assessments/company-result.ts')
const {
  DataLimitedScore,
} = require('../../src/features/assessments/components/data-limited-score.tsx')
const { renderToStaticMarkup } = require('react-dom/server')
const { createElement } = require('react')
const { Radar } = require('../../src/features/assessments/components/company-financial-report.tsx')
function summary() {
  return {
    kind: 'data_limited_bounds',
    available_points: '66.00',
    available_max_points: '80',
    unresolved_max_points: '20',
    lower_bound: '66.0',
    upper_bound: '86.0',
    total_metric_count: 7,
    components: [
      ['AIC-M01', '15', '15'],
      ['AIC-M03', '16', '20'],
      ['AIC-M05', '12', '15'],
      ['AIC-M06', '10', '10'],
      ['AIC-M07', '13', '20'],
    ].map(([metric_id, points, max_points]) => ({ metric_id, points, max_points })),
    unresolved_metric_ids: ['AIC-M02', 'AIC-M04'],
  }
}
test('decoder accepts bounded partial summary and rejects duplicated IDs, inflated weights and scores', () => {
  assert.deepEqual(partialAssessment(summary()), summary())
  for (const patch of [
    { available_max_points: '100' },
    { upper_bound: 'NaN' },
    { available_points: '81' },
    { lower_bound: '90' },
    { total_metric_count: 5 },
    { unresolved_metric_ids: ['AIC-M01', 'AIC-M04'] },
  ])
    assert.throws(() => partialAssessment({ ...summary(), ...patch }))
  const bad = summary()
  bad.components[0].points = '16'
  assert.throws(() => partialAssessment(bad))
})
test('current approved reviewed company shows partials; refresh/stale/error/scope/case changes hide them', () => {
  const result = {
    id: 'assessment',
    purpose: 'company_health',
    state: 'completed',
    case_id: 'case',
    case_revision: 2,
    checked_case_revision: 2,
    stale: false,
    financial_set_id: 'set',
    financial_health: {
      status: 'blocked',
      score: null,
      band: null,
      components: [],
      partial_assessment: summary(),
    },
  }
  const context = {
    caseId: 'case',
    revision: 2,
    setId: 'set',
    confirmed: true,
    loading: false,
    readiness: {
      case_revision: 2,
      method_status: 'configured_pilot',
      assessment_allowed: true,
      numeric_assessment_allowed: false,
      blockers: [{ code: 'MISSING_FACT' }],
    },
  }
  assert.deepEqual(companyResult(result, context).partial, summary())
  for (const patch of [
    { revision: 3 },
    { caseId: 'other' },
    { setId: 'other' },
    { confirmed: false },
    { loading: true },
    { readiness: null },
  ])
    assert.equal(companyResult(result, { ...context, ...patch }).partial, null)
  for (const code of ['OUT_OF_PILOT_SCOPE', 'INVALID_SCOPE', 'SOURCE_PROCESSING', 'STALE_FACT'])
    assert.equal(
      companyResult(result, {
        ...context,
        readiness: { ...context.readiness, blockers: [{ code }] },
      }).partial,
      null,
    )
  assert.equal(companyResult({ ...result, stale: true }, context).partial, null)
  assert.equal(companyResult({ ...result, purpose: undefined }, context).partial, null)
  assert.equal(companyResult({ ...result, state: 'failed' }, context).partial, null)
  assert.equal(
    companyResult(result, {
      ...context,
      readiness: { ...context.readiness, method_status: 'unconfigured' },
    }).partial,
    null,
  )
  assert.equal(companyResult(result, context).complete, false)
})
test('partial UI labels the denominator, uncertainty and absence of a single total in all locales', () => {
  for (const locale of ['vi', 'en', 'zh-CN']) {
    const html = renderToStaticMarkup(createElement(DataLimitedScore, { value: summary(), locale }))
    assert.match(html, /66/)
    assert.match(html, /80/)
    assert.match(html, /66\.0–86\.0/)
    assert.match(html, /5\/7/)
    assert.match(html, /PD|违约概率/)
    assert.doesNotMatch(html, /AIC-F[1-5]/)
  }
})

test('partial radar plots available values including zero without filling missing axes with zero', () => {
  const points=Array.from({length:7},(_,i)=>({id:'AIC-M0'+(i+1),label:'Metric '+(i+1),value:i<5?i/5:null}))
  for (const locale of ['vi','en','zh-CN']) {
    const html=renderToStaticMarkup(createElement(Radar,{points,locale}))
    assert.match(html,/5\/7/)
    assert.equal((html.match(/<circle /g)||[]).length,5)
    assert.equal((html.match(/<polygon /g)||[]).length,4,'Only background rings; no polygon through missing values')
    assert.match(html,/Metric 1: 0%/)
    assert.match(html,/Metric 7:\s*N\/A/)
  }
})
