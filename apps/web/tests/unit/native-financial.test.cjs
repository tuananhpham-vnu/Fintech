require('../helpers/register-typescript.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { questionnairesApi } = require('../../src/features/questionnaires/api.ts')
const { financialApi } = require('../../src/features/financial/api.ts')
const { MutationKey, setCsrfToken } = require('../../src/lib/api/client.ts')
const { validateNativeAnswers } = require('../../src/features/questionnaires/schemas.ts')
const {
  questionnaireSourceOptions,
  validateClaim,
  claimRoles,
  newClaim,
} = require('../../src/features/cases/helpers/exposure-inputs.ts')
const { nativeCopy } = require('../../src/features/questionnaires/native-copy.ts')
const q = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 1,
  answer_type: 'text',
  requiredness: 'optional',
  allowed_to_skip: true,
  label: 'Original source question',
  source_requirements: {},
  verification_policy: {},
}
const receipt = {
  receipt_id: 'receipt',
  submitted_at: '2026-10-17T00:00:00Z',
  answer_count: 1,
  identity_assurance: 'self_reported_capability_only',
}

test('native transport omits specialist credentials, scopes payload, decodes receipt and preserves one retry intent', async () => {
  const old = global.fetch,
    calls = []
  setCsrfToken('specialist-csrf')
  global.fetch = async (url, o) => {
    calls.push({ url, ...o })
    return Response.json(
      url.endsWith('/form')
        ? { questions: [q], questionnaire_version: 1, expires_at: '2026-10-18T00:00:00Z' }
        : receipt,
    )
  }
  try {
    const token = 'x'.repeat(43),
      keys = new MutationKey(),
      input = {
        reported_reference: 'Self-reported person',
        answers: [
          {
            question_id: q.id,
            question_version: 1,
            answer_state: 'skipped',
            answer_json: null,
            skip_reason: 'Not known',
            verified: true,
          },
        ],
        organization_id: 'injected',
        verified: true,
      }
    assert.equal((await questionnairesApi.respondentForm(token)).questions[0].label, q.label)
    const key = keys.for('/respondent/responses', input)
    assert.deepEqual(await questionnairesApi.submitRespondent(token, input, key), receipt)
    await questionnairesApi.submitRespondent(token, input, key)
    for (const call of calls) {
      assert.equal(call.credentials, 'omit')
      assert.equal(call.headers.get('authorization'), 'Bearer ' + token)
      assert.equal(call.headers.has('x-csrf-token'), false)
      assert.ok(!call.url.includes(token))
      assert.equal(call.cache, 'no-store')
    }
    assert.equal(calls[1].headers.get('idempotency-key'), calls[2].headers.get('idempotency-key'))
    const body = JSON.parse(calls[1].body)
    assert.equal(body.verified, undefined)
    assert.equal(body.organization_id, undefined)
    assert.equal(body.answers[0].verified, undefined)
    for (const malformed of [
      { ...receipt, identity_assurance: 'verified_entity' },
      { ...receipt, answer_count: 0 },
    ]) {
      global.fetch = async () => Response.json(malformed)
      await assert.rejects(
        questionnairesApi.submitRespondent(token, input, key),
        (e) => e.code === 'INVALID_API_RESPONSE',
      )
    }
  } finally {
    global.fetch = old
    setCsrfToken(null)
  }
})

test('invitation delivers ephemeral header secret only on first response; replay metadata cannot fabricate it', async () => {
  const old = global.fetch,
    tokens = [],
    calls = []
  const invitation = {
    id: 'invite',
    questionnaire_id: 'form',
    questionnaire_version: 1,
    question_ids: [q.id],
    reported_by: 'counterparty',
    recipient_reference: 'Self-reported recipient',
    expires_at: '2026-10-18T00:00:00Z',
    created_at: '2026-10-17T00:00:00Z',
    status: 'active',
    token_delivery: 'one_time_response_header',
  }
  global.fetch = async (url, o) => {
    calls.push({ url, ...o })
    return Response.json(
      { invitation, revision: 2 },
      { status: 201, headers: calls.length === 1 ? { 'x-invitation-token': 'x'.repeat(43) } : {} },
    )
  }
  try {
    const input = {
      expected_revision: 1,
      reason: 'Invite',
      question_ids: [q.id],
      reported_by: 'counterparty',
      recipient_reference: 'Recipient',
      token: 'injected',
      organization_id: 'injected',
    }
    await questionnairesApi.createInvitation('form', input, 'stable-key', (t) => tokens.push(t))
    await questionnairesApi.createInvitation('form', input, 'stable-key', (t) => tokens.push(t))
    assert.deepEqual(tokens, ['x'.repeat(43)])
    assert.equal(calls[0].credentials, 'same-origin')
    assert.equal(calls[0].headers.has('authorization'), false)
    assert.deepEqual(calls[0].body, calls[1].body)
    assert.equal(JSON.parse(calls[0].body).token, undefined)
  } finally {
    global.fetch = old
  }
})

test('native optional questions require either actual text or explicit skip reason; all locales keep identity limitation', () => {
  for (const answers of [
    {},
    { [q.id]: { state: 'submitted', value: ' ' } },
    { [q.id]: { state: 'skipped', value: '', reason: ' ' } },
  ])
    assert.throws(() => validateNativeAnswers([q], answers))
  validateNativeAnswers([q], { [q.id]: { state: 'skipped', value: '', reason: 'Unknown' } })
  validateNativeAnswers([q], { [q.id]: { state: 'submitted', value: 'Original statement' } })
  const labels = ['en', 'vi', 'zh-CN'].map((l) => nativeCopy(l)('limitation'))
  assert.equal(new Set(labels).size, 3)
})

test('questionnaire source projection pins response revision and strips server verification/provenance from writes', () => {
  const response = {
    id: '22222222-2222-4222-8222-222222222222',
    question_id: q.id,
    revision: 3,
    reported_by: 'counterparty',
    origin: 'SME_direct',
    answer_state: 'submitted',
    verification_status: 'verified',
  }
  const [option] = questionnaireSourceOptions([
    {
      id: '33333333-3333-4333-8333-333333333333',
      questions: [q],
      responses: [response, { ...response, id: 'skip', answer_state: 'skipped' }],
    },
  ])
  assert.equal(option.source.response_revision, 3)
  assert.equal(option.source.verification_status, undefined)
  const claim = {
    ...newClaim('RECEIVABLE').input,
    ...claimRoles('RECEIVABLE', 'paid'),
    kind: 'paid',
    amount_vnd: '10',
    source_refs: [{ ...option.source, verification: 'verified', entered_by: 'forged' }],
  }
  const out = validateClaim(claim, 'RECEIVABLE')
  assert.deepEqual(out.source_refs, [option.source])
  assert.equal(out.verification, undefined)
})

test('financial consumer gates all numeric scores and retains exact input projection and set selection', async () => {
  const old = global.fetch,
    calls = []
  const set = {
    id: 'set',
    revision: 1,
    created_at: '2026-10-17T00:00:00Z',
    scope: {
      entity_id: 'entity',
      country: 'VN',
      industry: 'WHOLESALE',
      pilot_scope: 'DISTRIBUTION_WHOLESALE_PILOT',
      period: { kind: 'FY', start_date: '2025-01-01', end_date: '2025-12-31' },
      basis: 'standalone',
      accounting_regime: 'IFRS',
      currency: 'VND',
      unit_multiplier: '1000',
    },
    metadata: { observation_kind: 'actual', audit_status: 'unaudited', statement_version: 'v1' },
    facts: [],
    verification_stale: false,
  }
  const read = {
    sets: [set],
    selected_set_id: 'set',
    method_status: 'unconfigured',
    score: null,
    band: null,
    grade: null,
    pd: null,
    metrics: [],
    blockers: ['FHI_METHOD_UNCONFIGURED'],
    limitations: [],
  }
  global.fetch = async (url, o) => {
    calls.push({ url, ...o })
    return Response.json(o.method === 'GET' ? read : { set, revision: 2 })
  }
  try {
    assert.equal((await financialApi.get('case', undefined, 'set')).selected_set_id, 'set')
    assert.equal(calls[0].url, '/api/v2/cases/case/financial-sets?set_id=set')
    const input = {
      expected_revision: 1,
      reason: 'Preserve original',
      period: set.scope.period,
      basis: 'standalone',
      accounting_regime: 'IFRS',
      currency: 'VND',
      unit_multiplier: '1000',
      industry_scope: 'UNKNOWN',
      observation_kind: 'actual',
      audit_status: 'unaudited',
      statement_version: 'v1',
      entity_id: 'forged',
      verification: 'verified',
      facts: [
        {
          key: 'current_assets',
          raw_value: '1.250',
          raw_label: 'Original',
          missing_reason: null,
          normalized_decimal: '999',
          verification: 'verified',
          source: { kind: 'manual_entry', statement: 'Actual provenance', actor_id: 'forged' },
        },
      ],
    }
    await financialApi.save('case', undefined, input, new MutationKey())
    const body = JSON.parse(calls[1].body)
    assert.equal(body.entity_id, undefined)
    assert.equal(body.verification, undefined)
    assert.equal(body.facts[0].normalized_decimal, undefined)
    assert.equal(body.facts[0].verification, undefined)
    assert.equal(body.facts[0].source.actor_id, undefined)
    assert.equal(body.facts[0].raw_value, '1.250')
    for (const bad of [
      { ...read, score: 73.7 },
      { ...read, band: 'AIC-F2' },
      { ...read, selected_set_id: 'foreign' },
      { ...read, sets: [{ ...set, facts: [{ id: 'a' }] }] },
    ]) {
      global.fetch = async () => Response.json(bad)
      await assert.rejects(financialApi.get('case'), (e) => e.code === 'INVALID_API_RESPONSE')
    }
  } finally {
    global.fetch = old
  }
})
