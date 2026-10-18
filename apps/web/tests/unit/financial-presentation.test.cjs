require('../helpers/register-typescript.cjs')
const { test } = require('node:test'),
  assert = require('node:assert/strict')
const {
  formatRatio,
  formatExactRatio,
  zeroDebtException,
} = require('../../src/features/financial/presentation.ts')
test('financial units preserve decimal precision, sign and unknown state across locales', () => {
  assert.equal(formatRatio('2.000', 'AIC-M01', 'vi'), '2 lần')
  assert.equal(formatRatio('0.08', 'AIC-M07', 'vi'), '8%')
  assert.equal(formatRatio('-0.01234567890123456789', 'AIC-M06', 'en'), '-1.234567890123456789%')
  assert.equal(formatRatio('2', 'AIC-M04', 'zh-CN'), '2 倍')
  assert.equal(formatRatio(null, 'AIC-M03', 'vi'), '—')
})
test('repeating ratios are approximate displays, never zero-debt exceptions', () => {
  const input = { numerator: '5', denominator: '3', decimal: null }
  const copy = JSON.stringify(input)
  assert.equal(formatExactRatio(input, 'AIC-M05', 'en'), '≈ 1.666666 times')
  assert.equal(JSON.stringify(input), copy)
  assert.equal(zeroDebtException({ metric_id: 'AIC-M05', status: 'available' }), false)
  assert.equal(
    zeroDebtException({
      metric_id: 'AIC-M05',
      status: 'available',
      flags: ['VERIFIED_ZERO_INTEREST_ZERO_DEBT'],
    }),
    true,
  )
  assert.equal(
    zeroDebtException({
      metric_id: 'AIC-M04',
      status: 'available',
      flags: ['VERIFIED_ZERO_INTEREST_ZERO_DEBT'],
    }),
    false,
  )
})
