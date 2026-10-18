const { test } = require('node:test')
const assert = require('node:assert/strict')
const { MODEL, mayDispatch, assertModel } = require('./model-retest-policy.cjs')

test('only continue after a successful extraction without a fatal provider diagnostic', () => {
  assert.equal(mayDispatch([], true), true)
  assert.equal(mayDispatch([], false), false)
  for (const category of [
    'RATE_LIMIT_OR_QUOTA', 'UPSTREAM_AUTH_REJECTED', 'UPSTREAM_NOT_FOUND',
    'PROVIDER_CONFIGURATION_MISSING',
  ]) assert.equal(mayDispatch([{ category }], true), false)
})

test('requested model must match actual live provenance exactly', () => {
  assert.doesNotThrow(() => assertModel(MODEL))
  for (const actual of [undefined, '', 'gemini-3.8-flash', 'MOCK', MODEL + '-preview'])
    assert.throws(() => assertModel(actual), /provenance/)
})
