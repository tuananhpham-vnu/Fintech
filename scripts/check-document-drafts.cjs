// Offline proposal consistency only. Never imported by API, migrations or workers.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const apiRequire = createRequire(path.resolve(__dirname, '../apps/api/package.json'))
const Ajv2020 = apiRequire('ajv/dist/2020').default
const addFormats = apiRequire('ajv-formats').default
const dir = path.resolve(__dirname, '../docs/implementation/drafts')
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))

// These are proposed semantic examples, NOT production authorization/verification.
function proposalGuards(record) {
  const errors = []
  const sources = [...record.exposure.source_refs,
    ...record.exposure.conditions.flatMap((condition) => condition.source_refs),
    ...record.exposure.claims.flatMap((claim) => claim.source_refs)]
  for (const source of sources) for (const key of ['organization_id', 'case_id', 'counterparty_id'])
    if (source[key] !== record[key]) errors.push('source ownership')
  const payer = record.exposure_kind === 'RECEIVABLE' ? 'counterparty' : 'organization'
  const payee = payer === 'organization' ? 'counterparty' : 'organization'
  for (const claim of record.exposure.claims) {
    if (claim.payer_party !== payer || claim.payee_party !== payee) errors.push('payment direction')
    if (claim.claimant_party !== (claim.kind === 'paid' ? payer : payee)) errors.push('claim perspective')
  }
  return errors
}
function changed(base, changes) {
  const record = structuredClone(base)
  for (const { path: pointer, value } of changes) {
    const keys = pointer.slice(1).split('/')
    assert.ok(keys.every((key) => !['__proto__', 'constructor', 'prototype'].includes(key)))
    let target = record
    for (const key of keys.slice(0, -1)) target = target[key]
    target[keys.at(-1)] = value
  }
  return record
}

const policy = load('case-policy.draft.json')
assert.equal(policy.status, 'draft')
assert.equal(policy.runtime_eligible, false)
assert.equal(policy.approval, null)
assert.equal(policy.effective_from, null)
assert.equal(policy.financial_method_boundary.activate_fhi_pilot, false)
assert.equal(policy.financial_method_boundary.method_version, null)
assert.match(policy.policy_version, /^AIC-CASE-DRAFT-/)
assert.equal(new Set(policy.checklist_proposal.map((row) => row.requirement_key)).size, policy.checklist_proposal.length)
for (const row of policy.checklist_proposal) {
  assert.ok(['required', 'conditional', 'optional'].includes(row.classification))
  assert.equal(typeof row.waivable, 'boolean')
  assert.ok(row.when.length > 0 && row.missing_behavior.length > 0)
  if (row.waivable) assert.ok(typeof row.waiver_scope === 'string' && row.waiver_scope.length > 0)
  else assert.equal(row.waiver_scope, null)
}
assert.equal(policy.checklist_proposal.find((row) => row.requirement_key === 'financial_minimum').waivable, false)
const ajv = new Ajv2020({ strict: true, strictTypes: false, coerceTypes: false, removeAdditional: false, useDefaults: false })
addFormats(ajv)
const validate = ajv.compile(load('exposure.schema.draft.json'))
const examples = load('exposure.examples.draft.json')
const bases = new Map(examples.valid.map((example) => [example.name, example.value]))
for (const example of examples.valid) {
  assert.equal(validate(example.value), true, example.name)
  assert.equal(proposalGuards(example.value).length, 0, example.name)
}
for (const example of examples.missing_data) {
  const value = changed(bases.get(example.base), example.changes)
  assert.equal(validate(value), true, example.name)
  assert.equal(proposalGuards(value).length, 0, example.name)
}
for (const example of examples.invalid) {
  const value = changed(bases.get(example.base), example.changes)
  if (example.reject === 'schema') assert.equal(validate(value), false, example.name)
  else {
    assert.equal(validate(value), true, example.name)
    assert.ok(proposalGuards(value).length > 0, example.name)
  }
}
process.stdout.write(`PASS draft consistency: policy stays inactive; ${examples.valid.length} valid, ${examples.missing_data.length} incomplete, ${examples.invalid.length} invalid vectors. NOT production API/ACL tests.\n`)
