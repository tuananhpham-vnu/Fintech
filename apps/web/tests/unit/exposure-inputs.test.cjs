require('../helpers/register-typescript.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildTransactionInput } = require('../../src/features/cases/schemas.ts')
const {
  claimRoles,
  documentSourceOptions,
  newClaim,
  newCondition,
  rebaseTransaction,
  transactionDraft,
  validateClaim,
  validateCondition,
} = require('../../src/features/cases/helpers/exposure-inputs.ts')
const { exposureText } = require('../../src/features/cases/helpers/exposure-text.ts')
const fixtures = require('../fixtures/aic-api.cjs')

const documentId = '11111111-1111-4111-8111-111111111111'
const evidenceId = '22222222-2222-4222-8222-222222222222'
const hash = 'a'.repeat(64)
const source = (reported_by = 'counterparty') => ({
  kind: 'document',
  reported_by,
  document_id: documentId,
  document_version: 3,
  document_sha256: hash,
  evidence_ref: evidenceId,
})
function draft(kind = 'RECEIVABLE') {
  return {
    ...transactionDraft(),
    kind,
    party: 'partner',
    amount: '999999999999999999999999',
    term: '0',
    reference: ' REF ',
  }
}
function claim(kind = 'RECEIVABLE', observation = 'paid') {
  return {
    ...newClaim(kind).input,
    kind: observation,
    ...claimRoles(kind, observation),
    amount_vnd: '0',
    source_refs: [
      { kind: 'declaration', reported_by: claimRoles(kind, observation).claimant_party },
    ],
  }
}
const row = (input, historical = false) => ({ input, historical })
const invalid = (operation) => assert.throws(operation, (error) => error.status === 422)
function detail(exposure, revision = 7, documents = []) {
  return { ...fixtures.cases[0], exposure_kind: 'RECEIVABLE', exposure, revision, documents }
}

test('core claim roles derive from direction and observation; source reporting must match claimant', () => {
  for (const [kind, payer, payee] of [
    ['RECEIVABLE', 'counterparty', 'organization'],
    ['PREPAYMENT', 'organization', 'counterparty'],
  ]) {
    for (const observation of ['paid', 'received']) {
      const input = claim(kind, observation)
      // Ignore caller-supplied role guesses, derive only from kind/observation.
      const output = validateClaim(
        { ...input, payer_party: 'forged', claimant_party: 'forged' },
        kind,
      )
      assert.equal(output.payer_party, payer)
      assert.equal(output.payee_party, payee)
      assert.equal(output.claimant_party, observation === 'paid' ? payer : payee)
      assert.equal(output.amount_vnd, '0')
      assert.deepEqual(output.source_refs, [
        { kind: 'declaration', reported_by: output.claimant_party },
      ])
      invalid(() =>
        validateClaim(
          {
            ...input,
            source_refs: [
              {
                kind: 'declaration',
                reported_by:
                  output.claimant_party === 'organization' ? 'counterparty' : 'organization',
              },
            ],
          },
          kind,
        ),
      )
    }
  }
})

test('unknown base amount and each null-term reason serialize as null, never zero or an empty string', () => {
  for (const termNullReason of ['not_agreed', 'source_missing', 'ambiguous']) {
    const output = buildTransactionInput({
      ...draft(),
      amount: null,
      amountMissingReason: ' Awaiting amount ',
      term: null,
      termNullReason,
      dueDate: '2026-12-31',
    }).exposure
    assert.equal(output.amount_vnd, null)
    assert.equal(output.amount_missing_reason, 'Awaiting amount')
    assert.equal(output.term_days, null)
    assert.equal(output.term_null_reason, termNullReason)
    assert.equal(output.due_date, '2026-12-31')
  }
  const base = {
    ...fixtures.cases[0].exposure,
    amount_missing_reason: 'server reason',
    term_null_reason: 'ambiguous',
  }
  invalid(() =>
    buildTransactionInput({ ...draft(), amount: null, amountMissingReason: null }, base),
  )
  invalid(() => buildTransactionInput({ ...draft(), term: null, termNullReason: null }, base))
  for (const patch of [
    { amount: '0' },
    { amount: '-1' },
    { amount: '1e9' },
    { amount: '1.2' },
    { amount: '1'.repeat(25) },
    { amount: null, amountMissingReason: ' ' },
    { term: '' },
    { term: '-1' },
    { term: '1.5' },
    { term: '9007199254740992' },
    { term: null, termNullReason: 'unknown' },
    { dueDate: '2026-02-30' },
  ])
    invalid(() => buildTransactionInput({ ...draft(), ...patch }))
  assert.equal(
    buildTransactionInput({ ...draft(), amountMissingReason: 'stale', termNullReason: 'ambiguous' })
      .exposure.amount_missing_reason,
    undefined,
  )
  assert.equal(buildTransactionInput(draft()).exposure.term_days, 0)
})

test('claim amounts allow zero/string precision and require reasons only for null', () => {
  const input = claim()
  for (const amount_vnd of ['0', '999999999999999999999999'])
    assert.equal(validateClaim({ ...input, amount_vnd }, 'RECEIVABLE').amount_vnd, amount_vnd)
  const unknown = validateClaim(
    { ...input, amount_vnd: null, amount_missing_reason: 'Not supplied' },
    'RECEIVABLE',
  )
  assert.equal(unknown.amount_vnd, null)
  for (const patch of [
    { amount_vnd: null, amount_missing_reason: null },
    { amount_vnd: null, amount_missing_reason: ' ' },
    { amount_vnd: '01' },
    { amount_vnd: '-1' },
    { amount_vnd: '1.1' },
    { amount_vnd: '1e9' },
    { amount_vnd: '1'.repeat(25) },
    { amount_missing_reason: 'stale' },
  ])
    invalid(() => validateClaim({ ...input, ...patch }, 'RECEIVABLE'))
})

test('actual/proposed dates obey released semantics and valid calendar dates', () => {
  const input = claim()
  assert.equal(
    validateClaim(
      { ...input, event_state: 'actual', occurred_on: '2026-10-17', planned_on: '2026-10-16' },
      'RECEIVABLE',
    ).occurred_on,
    '2026-10-17',
  )
  assert.equal(
    validateClaim(
      { ...input, event_state: 'actual', date_missing_reason: 'Date withheld' },
      'RECEIVABLE',
    ).occurred_on,
    null,
  )
  assert.equal(validateClaim(input, 'RECEIVABLE').planned_on, null)
  for (const patch of [
    { occurred_on: '2026-10-17' },
    { event_state: 'actual', occurred_on: null, date_missing_reason: null },
    { event_state: 'actual', occurred_on: '2026-10-17', date_missing_reason: 'stale' },
    { event_state: 'actual', occurred_on: '2026-02-30' },
    { planned_on: '2026-10-17T00:00:00Z' },
  ])
    invalid(() => validateClaim({ ...input, ...patch }, 'RECEIVABLE'))
})

test('condition kinds/states support staff declarations without any document', () => {
  for (const kind of ['payment', 'delivery', 'acceptance', 'refund', 'guarantee', 'other']) {
    for (const reported_state of ['proposed', 'reported_satisfied', 'unknown']) {
      for (const reported_by of ['organization', 'counterparty']) {
        const input = {
          ...newCondition().input,
          kind,
          scope: 'Invoice 1',
          reported_state,
          missing_reason: reported_state === 'unknown' ? 'Awaiting details' : null,
          source_refs: [{ kind: 'declaration', reported_by }],
        }
        const output = buildTransactionInput({ ...draft(), conditions: [row(input)] }).exposure
          .conditions[0]
        assert.deepEqual(output, input)
        assert.equal(output.verification, undefined)
      }
    }
  }
  for (const patch of [
    { scope: ' ' },
    { reported_state: 'unknown', missing_reason: null },
    { kind: 'unsupported' },
    { due_on: '2026-02-30' },
    { trigger_text: 'x'.repeat(4001) },
    { source_refs: [] },
    { source_refs: [{ kind: 'declaration', reported_by: 'SME_direct' }] },
  ])
    invalid(() => validateCondition({ ...newCondition().input, scope: 'Valid scope', ...patch }))
})

test('write projection whitelists aggregate, record and source fields with or without read identities', () => {
  const forbidden = {
    id: 'server-id',
    verification: 'verified',
    binding_id: 'binding',
    source_id: 'source',
    source_revision: 8,
    revision: 9,
    actor: { id: 'forged' },
    entered_by: 'actor',
    arbitrary_extra: 'drop',
  }
  for (const includeIds of [false, true]) {
    const extras = includeIds ? forbidden : { arbitrary_extra: 'drop', actor: 'forged' }
    const input = claim()
    const condition = {
      ...newCondition().input,
      scope: 'Invoice 1',
      source_refs: [{ ...source('organization'), ...extras }],
    }
    const body = buildTransactionInput({
      ...draft(),
      claims: [row({ ...input, ...extras, source_refs: [{ ...source(), ...extras }] })],
      conditions: [row({ ...condition, ...extras })],
    })
    const cleanClaim = body.exposure.claims[0],
      cleanCondition = body.exposure.conditions[0]
    for (const record of [
      cleanClaim,
      cleanCondition,
      ...cleanClaim.source_refs,
      ...cleanCondition.source_refs,
    ])
      for (const key of Object.keys(forbidden)) assert.equal(Object.hasOwn(record, key), false, key)
    assert.deepEqual(cleanClaim.source_refs, [source()])
    assert.deepEqual(cleanCondition.source_refs, [source('organization')])
    assert.equal(body.exposure.source_refs, undefined)
  }
  const declaration = validateClaim(
    { ...claim(), source_refs: [{ ...source(), kind: 'declaration', ...forbidden }] },
    'RECEIVABLE',
  ).source_refs[0]
  assert.deepEqual(declaration, { kind: 'declaration', reported_by: 'counterparty' })
})

test('document source options come only from extraction evidence and preserve exact version/hash/ref', () => {
  const doc = {
    id: documentId,
    name: 'Original.pdf',
    version: 3,
    hash,
    extraction: [{ field_key: 'amount', value: '0', evidence_refs: [evidenceId, evidenceId] }],
  }
  const options = documentSourceOptions([
    doc,
    { ...doc, id: 'invalid' },
    { ...doc, hash: 'invalid' },
    { ...doc, version: 4, extraction: [] },
    { ...doc, version: 5, extraction: [{ evidence_refs: ['not-evidence'] }] },
  ])
  assert.equal(options.length, 1)
  assert.deepEqual({ ...options[0].source, reported_by: 'counterparty' }, source())
  assert.equal(doc.extraction[0].evidence_refs.length, 2)
  assert.deepEqual(documentSourceOptions(), [])
  for (const patch of [
    { document_version: 0 },
    { document_sha256: 'bad' },
    { evidence_ref: '' },
    { document_id: { actor: 'forged' } },
  ])
    invalid(() =>
      validateClaim({ ...claim(), source_refs: [{ ...source(), ...patch }] }, 'RECEIVABLE'),
    )
})

test('historical source tuples survive hydration and explicit rebase even when current documents differ', () => {
  const exposure = buildTransactionInput({
    ...draft(),
    claims: [row({ ...claim(), source_refs: [source()] })],
  }).exposure
  exposure.claims[0].id = 'server-claim'
  exposure.claims[0].verification = 'unverified'
  exposure.claims[0].source_refs[0].source_revision = 3
  const editor = transactionDraft(detail(exposure))
  editor.amount = '123456'
  editor.reference = 'My unsaved edit'
  editor.claims[0].input.amount_vnd = '55'
  editor.conditions.push(row({ ...newCondition().input, scope: 'My new condition' }))
  const before = structuredClone(editor)
  const latest = detail({ ...exposure, amount_vnd: '999', claims: [], conditions: [] }, 22, [
    {
      id: documentId,
      version: 4,
      hash: 'b'.repeat(64),
      extraction: [{ evidence_refs: [evidenceId] }],
    },
  ])
  const rebased = rebaseTransaction(editor, latest)
  assert.equal(rebased.draft, editor)
  assert.deepEqual(rebased.draft, before)
  assert.equal(rebased.revision, 22)
  assert.equal(rebased.baseExposure, latest.exposure)
  assert.equal(rebased.documents, latest.documents)
  const output = buildTransactionInput(rebased.draft, rebased.baseExposure).exposure
  assert.equal(output.amount_vnd, '123456')
  assert.equal(output.claims[0].amount_vnd, '55')
  assert.equal(output.conditions[0].scope, 'My new condition')
  assert.deepEqual(output.claims[0].source_refs, [source()])
  assert.equal(editor.claims[0].historical, true)
  assert.equal(exposure.claims[0].source_refs[0].source_revision, 3)
})

test('unsupported historical rows stay visible and cannot silently become declarations', () => {
  const original = { kind: 'legacy', source_refs: [{ source_id: 'old-source' }] }
  const editor = transactionDraft(detail({ ...fixtures.cases[0].exposure, conditions: [original] }))
  assert.equal(editor.conditions[0].input, null)
  assert.equal(editor.conditions[0].original, original)
  assert.throws(
    () => buildTransactionInput(editor),
    (error) => error.code === 'EXPOSURE_HISTORY_UNSUPPORTED',
  )
  editor.conditions = [] // explicit row removal
  assert.deepEqual(buildTransactionInput(editor).exposure.conditions, [])
})

test('record and source cardinality limits are enforced', () => {
  invalid(() =>
    buildTransactionInput({ ...draft(), claims: Array.from({ length: 51 }, () => row(claim())) }),
  )
  invalid(() =>
    buildTransactionInput({
      ...draft(),
      conditions: Array.from({ length: 51 }, () =>
        row({ ...newCondition().input, scope: 'Scope' }),
      ),
    }),
  )
  invalid(() =>
    validateClaim(
      {
        ...claim(),
        source_refs: Array.from({ length: 21 }, () => ({
          kind: 'declaration',
          reported_by: 'counterparty',
        })),
      },
      'RECEIVABLE',
    ),
  )
})

test('local editor copy covers the three locales actually released by LocaleProvider', () => {
  const copies = ['en', 'vi', 'zh-CN'].map((locale) => exposureText(locale)('addClaim'))
  assert.equal(new Set(copies).size, 3)
  assert.ok(copies.every((value) => typeof value === 'string' && value.length > 0))
})
