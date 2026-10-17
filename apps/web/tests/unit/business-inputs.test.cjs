require('../helpers/register-typescript.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildTransactionInput } = require('../../src/features/cases/schemas.ts')
const { buildUploadForm } = require('../../src/features/documents/schemas.ts')
const { validateRespondentAnswers } = require('../../src/features/questionnaires/schemas.ts')
const {
  currentReadiness,
  numericAssessmentAllowed,
  assessmentIsStale,
} = require('../../src/features/assessments/model.ts')
const fixtures = require('../fixtures/aic-api.cjs')

test('Exposure edits preserve opaque conditions/dates and string money on all four business roles', () => {
  const conditions = [{ unknown_contract_field: ['do not drop', 7] }]
  for (const [kind, pair] of Object.entries({
    RECEIVABLE: ['seller', 'buyer'],
    PREPAYMENT: ['buyer', 'seller'],
    LOAN: ['lender', 'borrower'],
    DEBT_INVESTMENT: ['investor', 'issuer'],
  })) {
    const result = buildTransactionInput(
      {
        kind,
        party: 'partner',
        amount: '900719925474099312345',
        term: '30',
        reference: ' REF ',
        stage: 'proposed',
      },
      { ...fixtures.cases[0].exposure, conditions, due_date: '2026-12-01' },
    )
    assert.equal(result.exposure.conditions, conditions)
    assert.equal(result.exposure.due_date, '2026-12-01')
    assert.equal(result.exposure.amount_vnd, '900719925474099312345')
    assert.deepEqual([result.exposure.organization_role, result.exposure.counterparty_role], pair)
    assert.equal(result.exposure.contract_ref, 'REF')
  }
  for (const amount of ['0', '-1', '1.2', '1e9'])
    assert.throws(
      () =>
        buildTransactionInput({
          kind: 'PREPAYMENT',
          party: 'p',
          amount,
          term: '30',
          reference: '',
          stage: 'proposed',
        }),
      (e) => e.status === 422,
    )
})
test('Readiness must match current case revision and configured method even if score flag is true', () => {
  const detail = fixtures.cases[0],
    ready = {
      ...fixtures.readiness,
      numeric_assessment_allowed: true,
      method_status: 'configured_pilot',
    }
  assert.equal(numericAssessmentAllowed(ready, detail.revision), true)
  assert.equal(
    numericAssessmentAllowed({ ...ready, method_status: 'unconfigured' }, detail.revision),
    false,
  )
  assert.equal(numericAssessmentAllowed({ ...ready, case_revision: 99 }, detail.revision), false)
  for (const method_status of ['configured', 'validated', 'research', 'retired'])
    assert.equal(numericAssessmentAllowed({ ...ready, method_status }, detail.revision), false)
  for (const kind of ['LOAN', 'DEBT_INVESTMENT'])
    assert.equal(numericAssessmentAllowed(ready, detail.revision, kind), false)
  assert.equal(currentReadiness(null, ready), null)
  assert.equal(
    currentReadiness({ ...detail, readiness: undefined }, { ...ready, case_revision: 99 }),
    null,
  )
  assert.equal(assessmentIsStale({ case_revision: 1, stale: false }, 2), true)
  assert.equal(assessmentIsStale({ case_revision: 2, stale: true }, 2), true)
})
test('Exposure rebase emits write projection without server aggregate or source identities', () => {
  const result = buildTransactionInput(
    { kind: 'RECEIVABLE', party: 'p', amount: '100', term: '30', reference: '', stage: 'proposed' },
    {
      ...fixtures.cases[0].exposure,
      schema_version: 'SERVER-ONLY',
      verification: 'unverified',
      source_refs: [{ server: 'only' }],
      claims: [
        {
          id: 'server-claim',
          verification: 'unverified',
          kind: 'received',
          source_refs: [
            {
              kind: 'declaration',
              reported_by: 'organization',
              binding_id: 'server-binding',
              source_id: 'server-source',
              source_revision: 7,
            },
          ],
        },
      ],
    },
  )
  assert.equal(result.exposure.schema_version, undefined)
  assert.equal(result.exposure.verification, undefined)
  assert.equal(result.exposure.source_refs, undefined)
  assert.deepEqual(result.exposure.claims, [
    { kind: 'received', source_refs: [{ kind: 'declaration', reported_by: 'organization' }] },
  ])
})
test('Upload mode creates only its own binding and retains server revision; invalid bytes never pass preflight', async () => {
  const file = new File(['%PDF-1.7\nQA'], 'qa.pdf', { type: 'application/pdf' })
  for (const mode of ['new', 'replace', 'response']) {
    const form = await buildUploadForm({
      file,
      type: 'contract',
      mode,
      sourceClass: ' QA ',
      target: 'target',
      revision: 7,
    })
    assert.equal(form.get('expected_revision'), '7')
    assert.equal(form.get('source_class'), 'QA')
    assert.equal(form.get('replaces_document_id'), mode === 'replace' ? 'target' : null)
    assert.equal(form.get('response_request_id'), mode === 'response' ? 'target' : null)
  }
  await assert.rejects(
    buildUploadForm({
      file: new File(['invalid'], 'bad.pdf'),
      type: 'contract',
      mode: 'new',
      sourceClass: 'QA',
      target: '',
      revision: 1,
    }),
    (e) => e.code === 'INVALID_PDF',
  )
  await assert.rejects(
    buildUploadForm({
      file,
      type: 'contract',
      mode: 'replace',
      sourceClass: 'QA',
      target: '',
      revision: 1,
    }),
    (e) => e.status === 422,
  )
})
test('Respondent requiredness, allowed skip and unsupported answer types remain distinct', () => {
  const question = {
    id: 'q',
    answer_type: 'text',
    requiredness: 'required',
    allowed_to_skip: false,
  }
  assert.throws(
    () => validateRespondentAnswers([question], {}),
    (e) => e.status === 422,
  )
  assert.throws(
    () => validateRespondentAnswers([question], { q: { state: 'skipped', value: '' } }),
    (e) => e.status === 422,
  )
  validateRespondentAnswers([{ ...question, allowed_to_skip: true }], {
    q: { state: 'skipped', value: '' },
  })
  validateRespondentAnswers([question], { q: { state: 'submitted', value: 'Original statement' } })
  for (const state of ['skipped', 'verified'])
    assert.throws(
      () => validateRespondentAnswers([question], { q: { state, value: 'Original statement' } }),
      (e) => e.status === 422,
    )
  assert.throws(
    () => validateRespondentAnswers([{ ...question, answer_type: 'unreleased' }], {}),
    (e) => e.code === 'CONTRACT_NOT_RELEASED',
  )
})
