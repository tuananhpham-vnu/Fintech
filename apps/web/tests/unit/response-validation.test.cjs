require('../helpers/register-typescript.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const dto = require('../../src/lib/api/decoders.ts')
const fixtures = require('../fixtures/aic-api.cjs')
const { hasCompleteFhi } = require('../../src/features/assessments/fhi.ts')
const { contractPending } = require('../helpers/pending-contract.ts')

test('Staff questionnaire policy/provenance and stale verification fail closed at the consumer', () => {
  const form = {
    id: 'form',
    policy_version: 'MVP-OPTIONAL-TEXT-1',
    questions: [
      {
        id: 'q',
        version: 1,
        answer_type: 'text',
        requiredness: 'optional',
        allowed_to_skip: true,
        source_requirements: { skip_reason_required: true },
      },
    ],
    responses: [
      {
        id: 'r',
        question_id: 'q',
        revision: 1,
        answer_state: 'submitted',
        answer_json: 'Original statement',
        origin: 'staff_transcribed',
        source_refs: [],
        entered_by: 'actor',
        reported_by: 'counterparty',
        reported_reference: 'Reporter',
        created_at: '2026-10-17T01:28:48Z',
        reason: 'Recorded declaration',
        verification_status: 'unverified',
        verification_stale: false,
      },
    ],
  }
  const decode = (q) => dto.detail({ ...fixtures.cases[0], questionnaires: [q] })
  assert.equal(decode(form).questionnaires[0].responses[0].origin, 'staff_transcribed')
  for (const patch of [
    { origin: 'SME_direct' },
    { entered_by: undefined },
    { answer_state: 'verified' },
    { question_id: 'foreign' },
    { verification_status: 'verified', verification_stale: true },
  ])
    assert.throws(() => decode({ ...form, responses: [{ ...form.responses[0], ...patch }] }))
  for (const patch of [
    { requiredness: 'required' },
    { allowed_to_skip: false },
    { source_requirements: {} },
  ])
    assert.throws(() => decode({ ...form, questions: [{ ...form.questions[0], ...patch }] }))
  assert.equal(
    decode({
      ...form,
      responses: [{ ...form.responses[0], answer_state: 'skipped', answer_json: null }],
    }).questionnaires[0].responses[0].answer_json,
    null,
  )
})
test('Historical issue dispositions decode separately from current detector findings', () => {
  const finding = {
    id: 'i',
    issue_key: 'missing',
    rule_id: 'missing',
    category: 'missing_document',
    severity: 'warning',
    summary: 'Previous finding',
    evidence_refs: [],
    limitations: [],
    finding_state: 'verified_resolved',
    handling_state: 'none',
  }
  const current = {
    id: 'run',
    case_id: fixtures.cases[0].id,
    case_revision: 1,
    rules_version: 'rules',
    policy_version: 'policy',
    snapshot_hash: 'hash',
    state: 'completed',
    stale: false,
    findings: [],
    issue_history: [finding],
  }
  assert.equal(dto.review(current).issue_history[0].finding_state, 'verified_resolved')
  assert.throws(() =>
    dto.review({ ...current, issue_history: [{ ...finding, finding_state: 'waived' }] }),
  )
})
test('Sandbox source review and creation history decode without inventing a prior revision', () => {
  const event = {
    id: 'event',
    actor: 'actor',
    action: 'case.created',
    time: '2026-10-17T00:30:25Z',
    revision_before: null,
    revision_after: 1,
    subject_refs: [],
  }
  assert.equal(dto.history(event).revision_before, null)
  assert.throws(() => dto.history({ ...event, revision_before: undefined }))
  const document = {
    id: 'd',
    lineage: 'l',
    version: 1,
    hash: 'h',
    owner_party_ref: 'unresolved',
    type: 'other',
    status: 'completed',
    pages: 1,
    source_review: {
      declared_type: 'other',
      subject_match: 'unresolved',
      reviewed_pages: [1],
      reason: 'Read source',
      actor_id: 'actor',
      created_at: '2026-10-17T00:30:25Z',
    },
  }
  assert.equal(
    dto.detail({ ...fixtures.cases[0], documents: [document] }).documents[0].source_review
      .subject_match,
    'unresolved',
  )
  assert.throws(() =>
    dto.detail({
      ...fixtures.cases[0],
      documents: [
        { ...document, source_review: { ...document.source_review, reviewed_pages: [2] } },
      ],
    }),
  )
})

test('International counterparties remain distinct from the VN demo organization', () => {
  const partner = { ...fixtures.parties[0], country: 'US', tax_id: '000123' }
  assert.equal(dto.counterparty(partner).country, 'US')
  assert.equal(dto.counterparty(partner).tax_id, '000123')
  assert.throws(() => dto.counterparty({ ...partner, country: '' }))
})

test('Current method lifecycle is accepted; superseded lifecycle cannot authorize a score', () => {
  for (const method_status of [
    'unconfigured',
    'configured_pilot',
    'validation_pending',
    'validated_for_limited_use',
    'retired',
  ])
    assert.equal(
      dto.readiness({ ...fixtures.readiness, method_status }).method_status,
      method_status,
    )
  for (const method_status of ['configured', 'validated', 'research'])
    assert.throws(() => dto.readiness({ ...fixtures.readiness, method_status }))
  assert.throws(() => dto.readiness({ ...fixtures.readiness, limitations: [{}] }))
})

test('Malformed optional expansions fail at the API boundary, before rendering', () => {
  const detail = fixtures.cases[0]
  for (const patch of [
    { waivers: [{ id: 'w', active: 'yes' }] },
    { financial_metrics: [{ metric_id: 'm', input_refs: null }] },
    {
      financial_metrics: [
        {
          metric_id: 'm',
          formula_id: 'f',
          period: 'FY',
          value: {},
          status: 'available',
          input_refs: [],
          adjustments: [],
        },
      ],
    },
  ])
    assert.throws(() => dto.detail({ ...detail, ...patch }))
})

test('FHI requires all seven components and preserves transaction UNKNOWN independently', () => {
  const result = {
    id: 'a',
    case_id: fixtures.cases[0].id,
    case_revision: 1,
    method_version: 'QA-AIC-FHI-1.0',
    policy_version: 'QA',
    snapshot_hash: 'QA',
    state: 'completed',
    stale: false,
    factors: [],
    strengths: [],
    weaknesses: [],
    red_flags: [],
    limitations: ['SYNTHETIC QA ONLY'],
    created_at: '2026-10-16T04:00:00Z',
    financial_health: structuredClone(fixtures.financialHealth),
    transaction_review: { exposure_kind: 'PREPAYMENT', status: 'UNKNOWN', findings: [] },
  }
  assert.equal(dto.assessment(result).transaction_review.status, 'UNKNOWN')
  assert.equal(hasCompleteFhi(result), true)
  const missing = structuredClone(result)
  missing.financial_health.components.pop()
  assert.equal(hasCompleteFhi(missing), false)
  const duplicate = structuredClone(result)
  duplicate.financial_health.components.push(duplicate.financial_health.components[0])
  assert.equal(hasCompleteFhi(duplicate), false)
  const extra = structuredClone(result)
  extra.financial_health.components.push({
    ...extra.financial_health.components[0],
    metric_id: 'BA-LEGAL',
  })
  assert.equal(hasCompleteFhi(extra), false)
  const blocked = structuredClone(result)
  blocked.financial_health.blockers = ['MISSING_SOURCE']
  assert.equal(hasCompleteFhi(blocked), false)
  for (const patch of [{ pd: '0.1' }, { score: {} }, { components: [{}] }, { band: 'Aaa' }])
    assert.throws(() =>
      dto.assessment({ ...result, financial_health: { ...result.financial_health, ...patch } }),
    )
  assert.throws(() =>
    dto.assessment({ ...result, transaction_review: { status: 'APPROVED', findings: [] } }),
  )
})

test('Extracted fields strictly require evidence_refs array and reject raw evidence_ids', () => {
  const valid = [
    {
      field_key: 'contract.amount',
      value: '500000000',
      raw_value: '500.000.000 VND',
      quality: 'verified',
      evidence_refs: ['ev-1', 'ev-2'],
    },
  ]
  assert.equal(dto.extraction(valid)[0].field_key, 'contract.amount')
  assert.deepEqual(dto.extraction(valid)[0].evidence_refs, ['ev-1', 'ev-2'])

  // Empty array is valid
  assert.deepEqual(dto.extraction([{ ...valid[0], evidence_refs: [] }])[0].evidence_refs, [])

  // Raw FastAPI 1.0.2 schema uses evidence_ids without evidence_refs -> MUST reject
  assert.throws(() =>
    dto.extraction([
      {
        field_key: 'contract.amount',
        value: '500000000',
        quality: 'verified',
        evidence_ids: ['ev-1'],
      },
    ]),
  )

  // Non-string or null evidence_refs -> MUST reject
  assert.throws(() => dto.extraction([{ ...valid[0], evidence_refs: null }]))
  assert.throws(() => dto.extraction([{ ...valid[0], evidence_refs: [123] }]))
})

test('Pending contract operations reject with CONTRACT_NOT_RELEASED to prevent unreleased mutations', async () => {
  await assert.rejects(
    () => contractPending(),
    (err) => {
      assert.equal(err.name, 'ApiError')
      assert.equal(err.code, 'CONTRACT_NOT_RELEASED')
      assert.equal(err.status, 0)
      assert.match(err.message, /AIC-B01/)
      return true
    },
  )
})
