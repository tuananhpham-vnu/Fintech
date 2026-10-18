// Transport test fixtures only. Never imported by app/, components/ or lib/.
const crypto = require('node:crypto')
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const now = '2026-10-16T04:00:00Z'
const parties = [1, 2].map((n) => ({
  id: id(n),
  organization_id: id(100),
  name: n === 1 ? 'API CONTRACT TEST · CUSTOMER' : 'API CONTRACT TEST · SUPPLIER',
  country: 'VN',
  tax_id: '000000000' + n,
  industry_code: null,
  source_refs: [],
  revision: 1,
  identity_status: 'unresolved',
  created_at: now,
  updated_at: now,
}))
const readiness = {
  case_revision: 1,
  document_review_allowed: true,
  numeric_assessment_allowed: false,
  method_status: 'unconfigured',
  blockers: [
    { code: 'METHOD_UNCONFIGURED', message: 'Method is not configured' },
    { code: 'FINANCIAL_INPUT_REQUIRED', message: 'Financial evidence is required' },
  ],
  limitations: [],
  waivable_requirements: [
    { requirement_key: 'transaction.acceptance_record', label: 'Acceptance record' },
  ],
}
const cases = parties.map((p, i) => ({
  id: id(i + 11),
  organization_id: id(100),
  counterparty_id: p.id,
  exposure_kind: i === 0 ? 'RECEIVABLE' : 'PREPAYMENT',
  lifecycle_stage: 'proposed',
  revision: 1,
  policy_version: 'AIC-TRANSPORT-TEST',
  method_version: null,
  latest_review_run_id: null,
  latest_assessment_id: null,
  created_at: now,
  updated_at: now,
  exposure: {
    amount_vnd: i === 0 ? '500000000' : '200000000',
    term_days: 30,
    organization_role: i === 0 ? 'seller' : 'buyer',
    counterparty_role: i === 0 ? 'buyer' : 'seller',
    contract_ref: null,
    conditions: [],
    source_origin: 'staff_entered',
  },
  documents: [],
  jobs: [],
  findings: [],
  waivers: [],
  requests: [],
  questionnaires: [],
  financial_metrics: [],
  readiness: structuredClone(readiness),
  assessment: null,
}))
module.exports = {
  // Notion 13 §4.3 values exercise rendering, not an implementation of the scorer.
  financialHealth: {
    status: 'PREVIEW_ELIGIBLE',
    score: '73.7',
    band: 'AIC-F2',
    score_quality: 'experimental_not_validated',
    pd: null,
    components: [
      ['AIC-M01', '1.5', '11.5', '15'],
      ['AIC-M02', '1', '7.5', '10'],
      ['AIC-M03', '0.4', '16', '20'],
      ['AIC-M04', '2', '7', '10'],
      ['AIC-M05', '3', '9.375', '15'],
      ['AIC-M06', '0.1', '6.25', '10'],
      ['AIC-M07', '0.1333333333', '16.1111', '20'],
    ].map(([metric_id, raw_value, points, max_points]) => ({
      metric_id,
      raw_value,
      points,
      max_points,
      source_facts: ['SYNTHETIC-QA-FACT'],
      formula_id: metric_id,
      verification_state: 'unverified',
      blockers: [],
    })),
    blockers: [],
    missing_facts: [],
  },
  id,
  parties,
  cases,
  readiness,
  session: {
    user: {
      id: id(101),
      organization_id: id(100),
      display_name: 'API CONTRACT TEST · Specialist',
      role: 'specialist',
    },
    csrf_token: 'test-only-csrf',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  },
}
