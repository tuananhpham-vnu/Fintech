require('../helpers/register-typescript.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { counterpartyWriteProjection } = require('../../src/features/counterparties/api.ts')

test('counterparty write projection preserves declaration and text identifiers, drops server metadata and read refs', () => {
  const body = {
    name: 'Reported company',
    country: 'VN',
    tax_id: '0000123456',
    industry_code: '0010',
    reason: 'Record declaration',
    source: {
      kind: 'declaration',
      reported_by: 'counterparty',
      reported_reference: 'Call reference',
      statement: 'Reported attributes',
      source_id: 'server-only',
      actor_id: 'server-only',
      verification: 'verified',
    },
    id: 'server-only',
    organization_id: 'server-only',
    identity_status: 'confirmed',
    revision: 77,
    expected_revision: 76,
    source_refs: ['foreign-source'],
  }
  const expected = {
    name: body.name,
    country: body.country,
    tax_id: body.tax_id,
    industry_code: body.industry_code,
    reason: body.reason,
    source: {
      kind: 'declaration',
      reported_by: 'counterparty',
      reported_reference: 'Call reference',
      statement: 'Reported attributes',
    },
  }
  const projected = counterpartyWriteProjection(body)
  assert.deepEqual(projected, expected)
  body.source.statement = 'later mutation'
  assert.equal(projected.source.statement, 'Reported attributes')
  assert.deepEqual(
    counterpartyWriteProjection({ ...expected, tax_id: null, industry_code: null }),
    { ...expected, tax_id: null, industry_code: null },
  )
})
