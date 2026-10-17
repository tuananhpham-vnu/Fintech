require('../helpers/register-typescript.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { documentFieldLabel } = require('../../src/features/documents/field-labels.ts')
const registry = require('../../../../packages/contracts/field-registry.json')

const locales = ['en', 'vi', 'zh-CN']
const prefix = 'legacy:1.0.2:'
const generic = {
  en: 'Extracted field',
  vi: 'Trường dữ liệu trích xuất',
  'zh-CN': '提取字段',
}
const keys = [
  ...new Set(
    Object.values(registry.document_types).flatMap((fields) =>
      fields.map((field) => field.field_key),
    ),
  ),
]

test('every actual registry field has a human label in all locales, bare and legacy 1.0.2', () => {
  assert.equal(registry.schema_version, '1.0.2')
  assert.ok(keys.length > 0)
  for (const key of keys) {
    const translations = []
    for (const locale of locales) {
      const bare = documentFieldLabel(key, locale)
      const raw = `${prefix}${key}`
      const namespaced = documentFieldLabel(raw, locale)
      assert.equal(bare.known, true, `${locale}: ${key}`)
      assert.equal(bare.raw, key)
      assert.equal(typeof bare.label, 'string')
      assert.ok(bare.label.trim().length > 0)
      assert.notEqual(bare.label, generic[locale])
      assert.notEqual(bare.label, key)
      assert.doesNotMatch(bare.label, /legacy:|[._]/)
      assert.deepEqual(namespaced, { label: bare.label, raw, known: true })
      translations.push(bare.label)
    }
    assert.equal(new Set(translations).size, locales.length, key)
  }
})

test('party labels express source seller/payee and buyer/payer roles in every locale', () => {
  const roles = {
    'parties.borrower.tax_id': [
      'Source seller / payee tax ID',
      'Mã số thuế bên bán / bên nhận tiền trên tài liệu',
      '来源文件中卖方 / 收款方税号',
    ],
    'parties.counterparty.tax_id': [
      'Source buyer / payer tax ID',
      'Mã số thuế bên mua / bên trả tiền trên tài liệu',
      '来源文件中买方 / 付款方税号',
    ],
    'parties.payee.tax_id': [
      'Source payee tax ID',
      'Mã số thuế bên nhận tiền trên tài liệu',
      '来源文件中收款方税号',
    ],
    'parties.payer.tax_id': [
      'Source payer tax ID',
      'Mã số thuế bên trả tiền trên tài liệu',
      '来源文件中付款方税号',
    ],
  }
  for (const [key, expected] of Object.entries(roles)) {
    for (const [index, locale] of locales.entries()) {
      assert.equal(documentFieldLabel(`${prefix}${key}`, locale).label, expected[index])
    }
  }
})

test('registration borrower fields identify the document entity without asserting application identity or verification', () => {
  const expected = {
    'borrower.name': ['Document entity name', 'Tên đơn vị trên tài liệu', '文件所载主体名称'],
    'borrower.tax_id': [
      'Document entity tax ID',
      'Mã số thuế đơn vị trên tài liệu',
      '文件所载主体税号',
    ],
  }
  for (const { field_key: key } of registry.document_types.registration) {
    assert.ok(Object.hasOwn(expected, key), key)
    for (const [index, locale] of locales.entries()) {
      assert.equal(documentFieldLabel(`${prefix}${key}`, locale).label, expected[key][index])
    }
  }
  for (const key of keys) {
    for (const locale of locales) {
      assert.doesNotMatch(
        documentFieldLabel(key, locale).label,
        /borrower|counterparty|organization|verified|bên vay|người vay|tổ chức của|đối tác|đã xác minh|借款人|交易对手|本机构|已核实|已验证/i,
      )
    }
  }
})

test('unknown fields and prototype properties have localized generic labels and retain raw bytes', () => {
  const unknown = [
    '',
    'future.field',
    `${prefix}future.field`,
    prefix,
    ...[
      '__proto__',
      'constructor',
      'prototype',
      'toString',
      'hasOwnProperty',
      'valueOf',
      '__defineGetter__',
    ].flatMap((key) => [key, `${prefix}${key}`]),
    ' legacy:1.0.2:borrower.name',
    `${prefix}borrower.name `,
    `${prefix}borrower.name\n`,
    `${prefix}borrower.name\u0000`,
    `${prefix}borr\u200bower.name`,
    `${prefix}Te\u0302n / 名称\r\n\t`,
    `${prefix}Tên / 名称`,
    `${prefix}${prefix}borrower.name`,
    'LEGACY:1.0.2:borrower.name',
    'legacy:1.0.2/borrower.name',
    'legacy:1.0.2：borrower.name',
  ]
  for (const raw of unknown) {
    for (const locale of locales) {
      const result = documentFieldLabel(raw, locale)
      assert.deepEqual(result, { label: generic[locale], raw, known: false })
      assert.deepEqual(Buffer.from(result.raw, 'utf8'), Buffer.from(raw, 'utf8'))
    }
  }
})

test('only the exact legacy 1.0.2 version is consumed for every registry field', () => {
  const namespaces = [
    'legacy:1.0.1:',
    'legacy:1.0.3:',
    'legacy:2.0.0:',
    'legacy:1.0.20:',
    'legacy:v1.0.2:',
    'legacy:01.0.2:',
    'legacy:1.0.2 :',
    'legacy:1.0.2',
    'native:1.0.2:',
  ]
  for (const namespace of namespaces) {
    for (const key of keys) {
      const raw = `${namespace}${key}`
      for (const locale of locales) {
        const result = documentFieldLabel(raw, locale)
        assert.deepEqual(result, { label: generic[locale], raw, known: false })
        assert.deepEqual(Buffer.from(result.raw, 'utf8'), Buffer.from(raw, 'utf8'))
      }
    }
  }
})
