require('../helpers/register-typescript.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const dto = require('../../src/lib/api/decoders.ts')
const { isPublicApiRoute } = require('../../src/lib/api/proxy-policy.ts')
const { cases } = require('../fixtures/aic-api.cjs')

test('Company case discriminator accepts true absence of exposure without relaxing transaction decoding', () => {
  const company = {
    ...cases[0],
    purpose: 'company_health',
    exposure: null,
    exposure_kind: null,
    lifecycle_stage: null,
    policy_version: null,
    policy_artifact_hash: null,
  }
  assert.equal(dto.caseRecord(company).purpose, 'company_health')
  assert.equal(dto.caseRecord(cases[0]).exposure, cases[0].exposure)
  assert.equal(
    dto.page(dto.caseRecord)({ items: [company, cases[0]], next_cursor: null }).items.length,
    2,
  )
  for (const bad of [
    { ...company, purpose: undefined },
    { ...company, exposure: {} },
    { ...company, exposure_kind: 'RECEIVABLE' },
    { ...company, lifecycle_stage: 'proposed' },
    { ...company, policy_version: 'fake' },
    { ...company, policy_artifact_hash: undefined },
    { ...cases[0], purpose: 'unknown' },
  ])
    assert.throws(() => dto.caseRecord(bad), /INVALID_API_RESPONSE/)
})

test('Null transaction policy and review are valid only for an explicit company assessment', () => {
  const company = {
    id: 'a',
    case_id: 'c',
    case_revision: 1,
    method_version: 'AIC-FHI-1.0/1.0.0',
    purpose: 'company_health',
    policy_version: null,
    transaction_review: null,
    snapshot_hash: 's',
    state: 'completed',
    created_at: '2026-10-18T00:00:00Z',
    stale: false,
    overall_score: null,
    pd: null,
    grade: null,
    factors: [],
    strengths: [],
    weaknesses: [],
    red_flags: [],
    limitations: [],
  }
  assert.equal(dto.assessment(company).transaction_review, null)
  for (const bad of [
    { ...company, purpose: undefined },
    { ...company, policy_version: 'fake' },
    {
      ...company,
      transaction_review: { exposure_kind: 'RECEIVABLE', status: 'UNKNOWN', findings: [] },
    },
  ])
    assert.throws(() => dto.assessment(bad), /INVALID_API_RESPONSE/)
  assert.equal(isPublicApiRoute('POST', 'company-assessments'), true)
  assert.equal(isPublicApiRoute('GET', 'company-assessments/capabilities'), true)
  assert.equal(isPublicApiRoute('PATCH', 'company-assessments'), false)
})
