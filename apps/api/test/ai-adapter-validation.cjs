const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { test } = require('node:test')
// Deliberately exercise tsc output, not a copied validator or transport mock.
const {
  createLegacyAiValidationBoundary,
  LegacyAiValidationError,
  MAX_ADAPTER_VIOLATIONS,
} = require('../dist/ai-adapters/legacy-validation.js')

const contractDir = path.resolve(__dirname, '../../../packages/contracts')
function sampleBundle() {
  const sha256sums = readFileSync(path.join(contractDir, 'SHA256SUMS'), 'utf8')
  return {
    version: readFileSync(path.join(contractDir, 'VERSION'), 'utf8'),
    sha256sums,
    files: Object.fromEntries(
      sha256sums.trim().split(/\r?\n/).map((line) => {
        const name = line.split(/\s+/)[1]
        return [name, readFileSync(path.join(contractDir, name))]
      }),
    ),
  }
}
const examples = JSON.parse(readFileSync(path.join(contractDir, 'examples.json'), 'utf8'))
const vectors = JSON.parse(readFileSync(path.join(contractDir, 'validation-vectors.json'), 'utf8'))
const boundary = createLegacyAiValidationBoundary(sampleBundle())
const otherId = '00000000-0000-4000-8000-000000000001'
const otherHash = 'a'.repeat(64)

function inspection() {
  return {
    operation: 'inspect',
    request: structuredClone(examples.find((e) => e.schema === 'InspectionInput').value),
    body: structuredClone(examples.find((e) => e.schema === 'InspectionOutput').value),
    headers: { 'x-ai-mode': 'mock' },
    expectedMode: 'mock',
  }
}
function extraction(value = examples.find((e) => e.schema === 'ExtractionOutput').value) {
  const payload = structuredClone(value)
  return {
    operation: 'extract',
    request: {
      schema_version: '1.0.2',
      document_id: payload.document_id,
      case_id: payload.case_id,
      sha256: payload.sha256,
      type: payload.detected_type,
      storage_key: 'synthetic/input.pdf',
    },
    body: payload,
    headers: { 'x-ai-mode': 'mock' },
    expectedMode: 'mock',
  }
}
function rejects(fn, code, expectedPath) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof LegacyAiValidationError)
    assert.equal(error.code, code)
    assert.ok(error.violations.length > 0 && error.violations.length <= MAX_ADAPTER_VIOLATIONS)
    if (expectedPath) assert.ok(error.violations.some((v) => v.path === expectedPath))
    return true
  })
}
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

test('canonical sample bundles pass through the compiled boundary without remapping', () => {
  const values = JSON.parse(readFileSync(path.join(contractDir, 'fixtures/extraction-gold.json'), 'utf8'))
  for (const payload of values) {
    const exchange = deepFreeze(extraction(payload))
    const result = boundary.validate(exchange)
    assert.strictEqual(result.body, exchange.body)
    assert.deepEqual(result.body, payload)
    assert.equal(result.mode, 'mock')
    assert.equal(result.orchestrationBinding, 'pending')
    assert.equal(Object.hasOwn(result.body, 'mode'), false)
    assert.equal(Object.hasOwn(result.body.fields[0], 'evidence_refs'), false)
  }
  const exchange = deepFreeze(inspection())
  assert.strictEqual(boundary.validate(exchange).body, exchange.body)
})

test('diagnostics, provenance, nulls, quotes, bounding boxes and mode survive unchanged', () => {
  for (const mode of ['mock', 'live']) {
    const exchange = extraction()
    exchange.headers['x-ai-mode'] = exchange.expectedMode = mode
    exchange.body.diagnostics = [
      { code: 'SYNTHETIC_WARNING', message: 'Cần kiểm tra nguồn\nnguyên văn', document_id: null, field_key: null },
      { code: 'OTHER_WARNING', message: '', document_id: otherId, field_key: 'extension.key' },
    ]
    exchange.body.provenance = { model_id: 'synthetic-model', prompt_version: '', ocr_version: 'test-ocr', schema_version: '1.0.2' }
    exchange.body.evidence[0].bbox = [0.1, 0.2, 0.8, 0.9]
    exchange.body.evidence[0].precision = 'bbox'
    const before = structuredClone(exchange)
    const result = boundary.validate(deepFreeze(exchange))
    assert.strictEqual(result.body, exchange.body)
    assert.strictEqual(result.body.diagnostics, exchange.body.diagnostics)
    assert.strictEqual(result.body.provenance, exchange.body.provenance)
    assert.deepEqual(result.body, before.body)
    assert.equal(result.mode, mode)
  }
})

test('schema-permitted boundary values do not acquire upload or classification rules', () => {
  const exchange = inspection()
  exchange.body = structuredClone(vectors.find((v) => v.id === 'S04').value)
  exchange.body.byte_size = 0
  exchange.body.encrypted = true
  exchange.body.has_embedded_files = true
  assert.equal(boundary.validate(exchange).body.page_count, 11)

  const extract = extraction()
  extract.request.type = 'other'
  extract.request.storage_key = ''
  extract.body.classification_confident = false
  extract.body.fields[0].field_key = 'synthetic.extension'
  extract.body.fields[0].quality = 'unreadable'
  extract.body.fields[0].value = null
  extract.body.fields[0].raw_value = null
  extract.body.fields[0].evidence_ids = []
  extract.body.fields[0].missing_reason = 'unreadable'
  assert.strictEqual(boundary.validate(extract).body, extract.body)
  extract.body.pages = []
  extract.body.fields = []
  extract.body.evidence = []
  assert.strictEqual(boundary.validate(extract).body, extract.body)
})

test('bundle integrity covers every canonical artifact and cannot be replaced by a new manifest', async (t) => {
  for (const name of Object.keys(sampleBundle().files)) {
    await t.test(`tampered ${name}`, () => {
      const bundle = sampleBundle()
      bundle.files[name][0] ^= 1
      rejects(() => createLegacyAiValidationBoundary(bundle), 'INVALID_CONTRACT_BUNDLE', `/files/${name}`)
    })
    await t.test(`missing ${name}`, () => {
      const bundle = sampleBundle()
      delete bundle.files[name]
      rejects(() => createLegacyAiValidationBoundary(bundle), 'INVALID_CONTRACT_BUNDLE', `/files/${name}`)
    })
  }
  const replacement = sampleBundle()
  replacement.files['schemas.json'] = Buffer.from('{}')
  const digest = createHash('sha256').update(replacement.files['schemas.json']).digest('hex')
  replacement.sha256sums = replacement.sha256sums.replace(/^[a-f0-9]{64}(?= {2}schemas\.json$)/m, digest)
  rejects(() => createLegacyAiValidationBoundary(replacement), 'INVALID_CONTRACT_BUNDLE', '/sha256sums')
})

test('malformed, partial, duplicate, unknown and traversal manifests fail closed', () => {
  const lines = sampleBundle().sha256sums.trim().split(/\r?\n/)
  for (const manifest of [
    '', 'garbage', lines.slice(1).join('\n'),
    [lines[0], ...lines.slice(0, -1)].join('\n'),
    lines.join('\n') + '\n' + lines[0],
    lines.join('\n').replace('schemas.json', 'unknown.json'),
    lines.join('\n').replace('schemas.json', '../schemas.json'),
    lines.join('\n').replace('schemas.json', 'C:/schemas.json'),
  ]) {
    rejects(() => createLegacyAiValidationBoundary({ ...sampleBundle(), sha256sums: manifest }), 'INVALID_CONTRACT_BUNDLE')
  }
  for (const bundle of [null, {}, { ...sampleBundle(), version: '2.0.0' }, { ...sampleBundle(), files: null }])
    rejects(() => createLegacyAiValidationBoundary(bundle), 'INVALID_CONTRACT_BUNDLE')
})

test('missing, unknown or mismatched modes and unsupported operations fail closed', () => {
  for (const mode of [undefined, null, '', 'LIVE', 'test', 1, ['mock']]) {
    rejects(() => boundary.validate({ ...inspection(), headers: { 'x-ai-mode': mode } }), 'UNSUPPORTED_MODE', '/headers/x-ai-mode')
    rejects(() => boundary.validate({ ...inspection(), expectedMode: mode }), 'UNSUPPORTED_MODE', '/expectedMode')
  }
  for (const operation of [undefined, null, '', 'evaluate', 'toString', '__proto__'])
    rejects(() => boundary.validate({ ...inspection(), operation }), 'UNSUPPORTED_OPERATION', '/operation')
  for (const headers of [undefined, null, {}, { 'x-ai-mode': 'mock, live' }])
    rejects(() => boundary.validate({ ...inspection(), headers }), 'UNSUPPORTED_MODE', '/headers/x-ai-mode')
  rejects(() => boundary.validate(null), 'UNSUPPORTED_OPERATION')
  rejects(() => boundary.validate({ ...inspection(), expectedMode: 'live' }), 'MODE_MISMATCH', '/headers/x-ai-mode')
  rejects(() => boundary.validate({ ...inspection(), headers: { 'x-ai-mode': 'live' } }), 'MODE_MISMATCH', '/headers/x-ai-mode')
})

test('malformed response roots and requests are rejected without coercion or fallback', () => {
  for (const value of [null, undefined, [], 'not JSON', 42, {}, { fields: [] }]) {
    rejects(() => boundary.validate({ ...extraction(), body: value }), 'INVALID_LEGACY_RESPONSE')
    rejects(() => boundary.validate({ ...extraction(), request: value }), 'INVALID_LEGACY_REQUEST')
  }
  const exchange = inspection()
  exchange.body.page_count = '1'
  rejects(() => boundary.validate(deepFreeze(exchange)), 'INVALID_LEGACY_RESPONSE', '/body/page_count')
  assert.equal(exchange.body.page_count, '1')
})

test('unknown fields, versions, formats, enums and required nullable fields use canonical AJV validation', async (t) => {
  const mutations = [
    ['top-level unknown', (e) => { e.body.surprise = true }],
    ['mode in JSON', (e) => { e.body.mode = 'mock' }],
    ['body version', (e) => { e.body.schema_version = '2.0.0' }],
    ['provenance version', (e) => { e.body.provenance.schema_version = '1.0.1' }],
    ['unknown provenance', (e) => { e.body.provenance.provider = 'invented' }],
    ['missing provenance', (e) => { delete e.body.provenance }],
    ['missing diagnostics', (e) => { delete e.body.diagnostics }],
    ['unknown diagnostic', (e) => { e.body.diagnostics = [{ code: 'X', message: '', document_id: null, field_key: null, extra: 1 }] }],
    ['missing nullable diagnostic', (e) => { e.body.diagnostics = [{ code: 'X', message: '', document_id: null }] }],
    ['invalid UUID', (e) => { e.body.document_id = 'broken' }],
    ['invalid hash', (e) => { e.body.sha256 = 'A'.repeat(64) }],
    ['invalid classification', (e) => { e.body.detected_type = 'invented' }],
    ['invalid nested enum', (e) => { e.body.fields[0].quality = 'confident' }],
    ['missing nullable field', (e) => { delete e.body.fields[0].missing_reason }],
    ['numeric field value', (e) => { e.body.fields[0].value = 123 }],
    ['out-of-range bbox', (e) => { e.body.evidence[0].bbox = [0, 0, 2, 1] }],
    ['short bbox', (e) => { e.body.evidence[0].bbox = [0, 0] }],
    ['missing nullable bbox', (e) => { delete e.body.evidence[0].bbox }],
    ['unknown evidence', (e) => { e.body.evidence[0].source_hash = otherHash }],
    ['empty quote', (e) => { e.body.evidence[0].quote = '' }],
    ['non-finite width', (e) => { e.body.pages[0].width = Infinity }],
    ['unknown page', (e) => { e.body.pages[0].extra = true }],
  ]
  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const exchange = extraction()
      mutate(exchange)
      const before = structuredClone(exchange)
      rejects(() => boundary.validate(deepFreeze(exchange)), 'INVALID_LEGACY_RESPONSE')
      assert.deepEqual(exchange, before)
    })
  }
  for (const mutate of [
    (e) => { e.request.schema_version = '2.0.0' },
    (e) => { e.request.document_id = 'invalid' },
    (e) => { e.request.extra = true },
    (e) => { delete e.request.storage_key },
  ]) {
    const exchange = extraction()
    mutate(exchange)
    rejects(() => boundary.validate(exchange), 'INVALID_LEGACY_REQUEST')
  }
})

test('PaymentCondition uses the actual 2020-12 conditional schema without reinterpretation', () => {
  const exchange = extraction()
  const condition = structuredClone(vectors.find((v) => v.id === 'S03').value)
  exchange.body.fields[0].value = condition
  rejects(() => boundary.validate(exchange), 'INVALID_LEGACY_RESPONSE')
  condition.other_conditions_state = 'unknown'
  assert.strictEqual(boundary.validate(exchange).body.fields[0].value, condition)
  condition.other_conditions_state = 'present'
  rejects(() => boundary.validate(exchange), 'INVALID_LEGACY_RESPONSE')
  condition.other_conditions = ['Synthetic condition']
  assert.strictEqual(boundary.validate(exchange).body.fields[0].value, condition)
  condition.other_conditions_state = 'none'
  rejects(() => boundary.validate(exchange), 'INVALID_LEGACY_RESPONSE')
  condition.other_conditions = []
  assert.strictEqual(boundary.validate(exchange).body.fields[0].value, condition)
})

test('inspection enforces canonical numbers and source hash, without silently repairing them', () => {
  for (const patch of [{ page_count: 0 }, { page_count: 1.5 }, { byte_size: -1 }, { encrypted: 0 }, { surprise: true }])
    rejects(() => boundary.validate({ ...inspection(), body: { ...inspection().body, ...patch } }), 'INVALID_LEGACY_RESPONSE')
  const exchange = inspection()
  exchange.body.sha256 = otherHash
  rejects(() => boundary.validate(exchange), 'SOURCE_MISMATCH', '/body/sha256')
})

test('source mismatches and legacy evidence linkage guards reject actual payloads', async (t) => {
  const mutations = [
    ['document echo', '/body/document_id', (e) => { e.body.document_id = otherId }],
    ['case echo', '/body/case_id', (e) => { e.body.case_id = otherId }],
    ['hash echo', '/body/sha256', (e) => { e.body.sha256 = otherHash }],
    ['evidence document', '/body/evidence/0', (e) => { e.body.evidence[0].document_id = otherId }],
    ['evidence page', '/body/evidence/0', (e) => { e.body.evidence[0].page = 2 }],
    ['field document', '/body/fields/0', (e) => { e.body.fields[0].document_id = otherId }],
    ['dangling evidence ID', '/body/fields/0', (e) => { e.body.fields[0].evidence_ids = [otherId] }],
    ['duplicate evidence ID', '/body/evidence', (e) => { e.body.evidence.push(structuredClone(e.body.evidence[0])) }],
    ['noncontiguous pages', '/body/pages', (e) => { e.body.pages[0].page = 2 }],
  ]
  for (const [name, expectedPath, mutate] of mutations) {
    await t.test(name, () => {
      const exchange = extraction()
      mutate(exchange)
      const before = structuredClone(exchange)
      rejects(() => boundary.validate(deepFreeze(exchange)), 'SOURCE_MISMATCH', expectedPath)
      assert.deepEqual(exchange, before)
    })
  }
})

test('failure diagnostics are bounded, contain no source text, and do not poison later calls', () => {
  const exchange = extraction()
  const badEvidence = { ...exchange.body.evidence[0], document_id: otherId, quote: 'PRIVATE SYNTHETIC SENTINEL' }
  exchange.body.evidence = Array.from({ length: 100 }, () => ({ ...badEvidence }))
  assert.throws(() => boundary.validate(exchange), (error) => {
    assert.equal(error.code, 'SOURCE_MISMATCH')
    assert.equal(error.violations.length, MAX_ADAPTER_VIOLATIONS)
    assert.equal(JSON.stringify(error).includes(badEvidence.quote), false)
    return true
  })
  const valid = extraction()
  assert.strictEqual(boundary.validate(valid).body, valid.body)
})

test('schema and mode errors expose no raw values, unknown field names, or response bodies', () => {
  const sentinel = 'PRIVATE_SYNTHETIC_SENTINEL'
  const exchanges = [
    { ...inspection(), headers: { 'x-ai-mode': sentinel } },
    { ...inspection(), body: { ...inspection().body, [sentinel]: { text: sentinel } } },
    { ...inspection(), body: { ...inspection().body, schema_version: sentinel } },
  ]
  for (const exchange of exchanges) {
    assert.throws(() => boundary.validate(exchange), (error) => {
      assert.ok(error instanceof LegacyAiValidationError)
      assert.equal(String(error).includes(sentinel), false)
      assert.equal(JSON.stringify(error).includes(sentinel), false)
      assert.equal(Object.hasOwn(error, 'body'), false)
      assert.equal(Object.hasOwn(error, 'payload'), false)
      assert.equal(Object.hasOwn(error, 'request'), false)
      return true
    })
  }
})
