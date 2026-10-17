const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  { createHash } = require('node:crypto'),
  { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..'),
  req = createRequire(path.join(root, 'apps/api/package.json')),
  Ajv = req('ajv'),
  formats = req('ajv-formats')
const dir = path.join(root, 'packages/contracts/aic-foundation'),
  read = (f) => fs.readFileSync(path.join(dir, f), 'utf8'),
  schemas = JSON.parse(read('schemas.json')),
  api = JSON.parse(read('openapi.json'))
test('published request examples validate without acting as server IDs, verification or approval', () => {
  const ajv = new Ajv({ strict: false })
  formats(ajv)
  for (const sample of JSON.parse(read('examples.json'))) {
    const validate = ajv.compile({
      definitions: schemas.definitions,
      $ref: '#/definitions/' + sample.schema,
    })
    assert.equal(
      validate(sample.value),
      true,
      sample.schema + ': ' + JSON.stringify(validate.errors),
    )
  }
})
test('released capability security matches runtime: bearer without session/CSRF, origin+key on submit and one-time header', () => {
  assert.equal(api.info.version, '0.4.0-mvp-sandbox')
  for (const route of ['/respondent/form', '/respondent/responses'])
    for (const op of Object.values(api.paths[route])) {
      assert.deepEqual(op.security, [{ respondentCapability: [] }])
      assert.equal(op.parameters?.some((p) => p.name === 'X-CSRF-Token') ?? false, false)
    }
  const p = api.paths['/respondent/responses'].post.parameters
  for (const name of ['Origin', 'Idempotency-Key'])
    assert.ok(p.some((p) => p.name === name && p.required))
  assert.ok(
    api.paths['/questionnaires/{id}/invitations'].post.responses[201].headers['X-Invitation-Token'],
  )
  assert.ok(
    api.paths['/cases/{id}/financial-sets'].get.parameters.some(
      (p) => p.name === 'set_id' && p.in === 'query',
    ),
  )
  for (const line of read('SHA256SUMS').trim().split('\n')) {
    const [sha, name] = line.split(/\s+/)
    assert.equal(
      createHash('sha256')
        .update(fs.readFileSync(path.join(dir, name)))
        .digest('hex'),
      sha,
    )
  }
})
test('source request schema requires exact kind-specific tuple and rejects mixed or server-owned fields', () => {
  const ajv = new Ajv({ strict: false })
  formats(ajv)
  const valid = ajv.compile({
      definitions: schemas.definitions,
      $ref: '#/definitions/SourceInput',
    }),
    id = '11111111-1111-4111-8111-111111111111'
  const q = {
    kind: 'questionnaire',
    reported_by: 'counterparty',
    questionnaire_id: id,
    question_id: id,
    response_id: id,
    response_revision: 3,
  }
  assert.equal(valid(q), true)
  for (const k of ['questionnaire_id', 'question_id', 'response_id', 'response_revision']) {
    const v = { ...q }
    delete v[k]
    assert.equal(valid(v), false)
  }
  for (const v of [
    { ...q, origin: 'SME_direct' },
    { ...q, verification: 'verified' },
    { ...q, document_id: id },
    { ...q, response_revision: null },
    { ...q, kind: 'declaration' },
  ])
    assert.equal(valid(v), false)
  assert.equal(valid({ kind: 'declaration', reported_by: 'organization' }), true)
  assert.equal(
    valid({
      kind: 'document',
      reported_by: 'organization',
      document_id: id,
      evidence_ref: id,
      document_version: 1,
      document_sha256: 'a'.repeat(64),
    }),
    true,
  )
})
