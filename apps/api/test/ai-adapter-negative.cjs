const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const {
  createLegacyAiValidationBoundary,
  LegacyAiValidationError,
} = require('../dist/ai-adapters/legacy-validation.js')

// Incremental coverage of the compiled boundary, independent of the existing suite.
// All exchanges below are synthetic. No service, server, environment or DB access.
const contractDir = path.resolve(__dirname, '../../../packages/contracts')
function bundleBytes() {
  const sha256sums = readFileSync(path.join(contractDir, 'SHA256SUMS'), 'utf8')
  return {
    version: readFileSync(path.join(contractDir, 'VERSION'), 'utf8'),
    sha256sums,
    files: Object.fromEntries(sha256sums.trim().split(/\r?\n/).map((line) => {
      const name = line.split(/\s+/)[1]
      return [name, readFileSync(path.join(contractDir, name))]
    })),
  }
}

const boundary = createLegacyAiValidationBoundary(bundleBytes())
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const documentId = id(1)
const foreignDocumentId = id(2)
const foreignEvidenceId = id(30)

function inspection() {
  return {
    operation: 'inspect',
    request: { schema_version: '1.0.2', storage_key: 'synthetic/negative.pdf', sha256: 'b'.repeat(64) },
    body: {
      schema_version: '1.0.2', sha256: 'b'.repeat(64), page_count: 1,
      byte_size: 0, encrypted: false, has_embedded_files: false,
    },
    headers: { 'x-ai-mode': 'mock' },
    expectedMode: 'mock',
  }
}

function extraction(doc = documentId, evidenceId = id(20)) {
  return {
    operation: 'extract',
    request: {
      schema_version: '1.0.2', document_id: doc, case_id: id(3),
      type: 'contract', storage_key: 'synthetic/negative.pdf', sha256: 'b'.repeat(64),
    },
    body: {
      schema_version: '1.0.2', document_id: doc, case_id: id(3), sha256: 'b'.repeat(64),
      detected_type: 'contract', classification_confident: true,
      pages: [{ page: 1, text: 'SYNTHETIC amount 1000', method: 'text', width: 595, height: 842 }],
      fields: [{
        id: id(10), document_id: doc, field_key: 'synthetic.amount', raw_value: '1000',
        value: '1000', quality: 'readable', evidence_ids: [evidenceId], missing_reason: null,
      }],
      evidence: [{
        id: evidenceId, document_id: doc, page: 1, quote: 'SYNTHETIC amount 1000',
        bbox: null, precision: 'page',
      }],
      diagnostics: [{ code: 'SYNTHETIC', message: '', document_id: null, field_key: null }],
      provenance: {
        model_id: 'synthetic-model', prompt_version: '', ocr_version: '', schema_version: '1.0.2',
      },
    },
    headers: { 'x-ai-mode': 'mock' },
    expectedMode: 'mock',
  }
}

function paymentExtraction() {
  const exchange = extraction()
  exchange.body.fields[0].value = {
    event_type: 'unknown', offset_days: null, calendar_basis: 'unknown', scope_ref: null,
    other_conditions: [], counting_convention: 'unknown', other_conditions_state: 'unknown',
  }
  return exchange
}

function acceptsUnchanged(exchange, validator = boundary) {
  const before = structuredClone(exchange)
  const result = validator.validate(exchange)
  assert.strictEqual(result.body, exchange.body)
  assert.equal(result.mode, exchange.expectedMode)
  assert.equal(result.orchestrationBinding, 'pending')
  assert.deepEqual(exchange, before)
  return result
}

function rejectsUnchanged(exchange, code, expectedPaths, validator = boundary) {
  // structuredClone deliberately preserves NaN, infinities, undefined and missing keys.
  const before = structuredClone(exchange)
  assert.throws(() => validator.validate(exchange), (error) => {
    assert.ok(error instanceof LegacyAiValidationError)
    assert.equal(error.code, code)
    assert.deepEqual(error.violations.map((violation) => violation.path), expectedPaths)
    return true
  })
  assert.deepEqual(exchange, before)
  // Exercise all four compiled schemas again after every rejected exchange.
  acceptsUnchanged(inspection(), validator)
  acceptsUnchanged(extraction(), validator)
}

test('mutating caller bundle bytes after compilation cannot replace the retained schemas', () => {
  const bundle = bundleBytes()
  const validator = createLegacyAiValidationBoundary(bundle)
  bundle.files['schemas.json'].fill(0)
  bundle.files['schemas.json'] = Buffer.from('{"$defs":{}}')
  bundle.sha256sums = ''
  bundle.version = '2.0.0'
  acceptsUnchanged(extraction(), validator)
  const exchange = extraction()
  exchange.body.provenance.model_id = null
  rejectsUnchanged(exchange, 'INVALID_LEGACY_RESPONSE', ['/body/provenance/model_id'], validator)
})

test('mutating a previously returned body is revalidated and restoring it recovers the same object', () => {
  const exchange = extraction()
  const original = structuredClone(exchange)
  const result = acceptsUnchanged(exchange)
  // README promises identity, not an immutable snapshot or a cached approval.
  result.body.provenance.schema_version = '2.0.0'
  rejectsUnchanged(exchange, 'INVALID_LEGACY_RESPONSE', ['/body/provenance/schema_version'])
  result.body.provenance.schema_version = original.body.provenance.schema_version
  acceptsUnchanged(exchange)
  result.body.fields[0].evidence_ids.push(foreignEvidenceId)
  rejectsUnchanged(exchange, 'SOURCE_MISMATCH', ['/body/fields/0'])
  result.body.fields[0].evidence_ids.pop()
  assert.strictEqual(acceptsUnchanged(exchange).body, result.body)
  assert.deepEqual(exchange, original)
})

for (const [name, mutate] of [
  ['valid reference before a dangling reference', (e) => { e.body.fields[0].evidence_ids.push(foreignEvidenceId) }],
  ['valid reference after a dangling reference', (e) => { e.body.fields[0].evidence_ids.unshift(foreignEvidenceId) }],
  ['foreign field after a valid field using local evidence', (e) => {
    e.body.fields.push({ ...structuredClone(e.body.fields[0]), id: id(11), document_id: foreignDocumentId })
  }],
]) {
  test(`source mixtures reject ${name}`, () => {
    const exchange = extraction()
    acceptsUnchanged(exchange)
    mutate(exchange)
    const index = exchange.body.fields.length - 1
    rejectsUnchanged(exchange, 'SOURCE_MISMATCH', [`/body/fields/${index}`])
  })
}

for (const referenced of [false, true]) {
  test(`foreign evidence after valid evidence is rejected when ${referenced ? 'referenced beside local evidence' : 'unreferenced'}`, () => {
    const exchange = extraction()
    exchange.body.evidence.push({
      ...structuredClone(exchange.body.evidence[0]), id: foreignEvidenceId, document_id: foreignDocumentId,
    })
    if (referenced) exchange.body.fields[0].evidence_ids.push(foreignEvidenceId)
    // A globally known ID does not make the foreign evidence valid. The existing
    // guard rejects the exchange at evidence/1; no extra per-field rule is assumed.
    rejectsUnchanged(exchange, 'SOURCE_MISMATCH', ['/body/evidence/1'])
  })
}

test('a duplicate local evidence ID cannot conceal a later foreign evidence record', () => {
  const exchange = extraction()
  exchange.body.evidence.push({ ...structuredClone(exchange.body.evidence[0]), document_id: foreignDocumentId })
  rejectsUnchanged(exchange, 'SOURCE_MISMATCH', ['/body/evidence', '/body/evidence/1'])
})

test('evidence IDs accepted for one document do not leak into the next call', () => {
  const first = extraction(documentId, id(20))
  const second = extraction(foreignDocumentId, foreignEvidenceId)
  acceptsUnchanged(first)
  acceptsUnchanged(second)
  second.body.fields[0].evidence_ids.push(first.body.evidence[0].id)
  rejectsUnchanged(second, 'SOURCE_MISMATCH', ['/body/fields/0'])
  second.body.fields[0].evidence_ids.pop()
  acceptsUnchanged(second)
  acceptsUnchanged(first)
})

test('page numbers accepted on a previous call do not authorize missing pages later', () => {
  const first = extraction()
  first.body.pages.push({ ...first.body.pages[0], page: 2 })
  first.body.evidence[0].page = 2
  acceptsUnchanged(first)
  const second = extraction()
  second.body.evidence[0].page = 2
  rejectsUnchanged(second, 'SOURCE_MISMATCH', ['/body/evidence/0'])
})

// These are required nullable properties; null is valid, omission is not.
for (const [name, factory, select, key, errorPath] of [
  ['field raw_value', extraction, (e) => e.body.fields[0], 'raw_value', '/body/fields/0'],
  ['field value', extraction, (e) => e.body.fields[0], 'value', '/body/fields/0'],
  ['diagnostic document_id', extraction, (e) => e.body.diagnostics[0], 'document_id', '/body/diagnostics/0'],
  ['payment offset_days', paymentExtraction, (e) => e.body.fields[0].value, 'offset_days', '/body/fields/0/value'],
  ['payment scope_ref', paymentExtraction, (e) => e.body.fields[0].value, 'scope_ref', '/body/fields/0/value'],
]) {
  test(`required nullable ${name} accepts null and rejects omission`, () => {
    const exchange = factory()
    select(exchange)[key] = null
    acceptsUnchanged(exchange)
    delete select(exchange)[key]
    rejectsUnchanged(exchange, 'INVALID_LEGACY_RESPONSE', [errorPath])
    select(exchange)[key] = null
    acceptsUnchanged(exchange)
  })
}

for (const key of ['model_id', 'prompt_version', 'ocr_version']) {
  for (const absent of [false, true]) {
    test(`provenance ${key} rejects ${absent ? 'omission' : 'null'} while allowing an empty string`, () => {
      const exchange = extraction()
      exchange.body.provenance[key] = ''
      acceptsUnchanged(exchange)
      if (absent) delete exchange.body.provenance[key]
      else exchange.body.provenance[key] = null
      rejectsUnchanged(exchange, 'INVALID_LEGACY_RESPONSE', [absent ? '/body/provenance' : `/body/provenance/${key}`])
      exchange.body.provenance[key] = ''
      acceptsUnchanged(exchange)
    })
  }
}

for (const key of ['provenance', 'pages', 'fields', 'evidence', 'diagnostics']) {
  test(`required ${key} rejects a null ${key === 'provenance' ? 'object' : 'array member'}`, () => {
    const exchange = extraction()
    if (key === 'provenance') exchange.body[key] = null
    else exchange.body[key][0] = null
    rejectsUnchanged(exchange, 'INVALID_LEGACY_RESPONSE', [`/body/${key}${key === 'provenance' ? '' : '/0'}`])
  })
}

for (const [name, headers, claimedMode] of [
  ['title-case key without a lowercase raw key', { 'X-AI-Mode': 'mock' }],
  ['body mode without a raw header', {}, 'mock'],
  ['body headers without a raw header', {}, { 'x-ai-mode': 'mock' }],
  ['mixed raw header values', { 'x-ai-mode': ['mock', 'live'] }],
  ['duplicate raw header values', { 'x-ai-mode': ['mock', 'mock'] }],
  ['comma-joined duplicate values', { 'x-ai-mode': 'mock, mock' }],
  ['whitespace-padded mode', { 'x-ai-mode': ' mock ' }],
  ['header injection text', { 'x-ai-mode': 'mock\r\nX-AI-Mode: live' }],
]) {
  test(`raw header rejects ${name}`, () => {
    const exchange = extraction()
    exchange.headers = headers
    if (typeof claimedMode === 'string') exchange.body.mode = claimedMode
    else if (claimedMode) exchange.body.headers = claimedMode
    rejectsUnchanged(exchange, 'UNSUPPORTED_MODE', ['/headers/x-ai-mode'])
  })
}

test('a body claim and a differently cased header cannot override a mismatched lowercase header', () => {
  const exchange = extraction()
  exchange.body.mode = 'mock'
  exchange.headers = { 'x-ai-mode': 'live', 'X-AI-Mode': 'mock' }
  rejectsUnchanged(exchange, 'MODE_MISMATCH', ['/headers/x-ai-mode'])
})

// Canonical numbers are not coerced; field values are strings, not parsed money.
for (const [name, factory, mutate, errorPath] of [
  ['byte_size numeric string', inspection, (e) => { e.body.byte_size = '0' }, '/body/byte_size'],
  ['page width numeric string', extraction, (e) => { e.body.pages[0].width = '595' }, '/body/pages/0/width'],
  ['page number numeric string', extraction, (e) => { e.body.pages[0].page = '1' }, '/body/pages/0/page'],
  ['evidence page numeric string', extraction, (e) => { e.body.evidence[0].page = '1' }, '/body/evidence/0/page'],
  ['bbox coordinate numeric string', extraction, (e) => { e.body.evidence[0].bbox = ['0', 0, 1, 1] }, '/body/evidence/0/bbox/0'],
  ['payment offset numeric string', paymentExtraction, (e) => { e.body.fields[0].value.offset_days = '0' }, '/body/fields/0/value'],
  ['payment offset fraction', paymentExtraction, (e) => { e.body.fields[0].value.offset_days = 0.5 }, '/body/fields/0/value'],
  ['payment offset below zero', paymentExtraction, (e) => { e.body.fields[0].value.offset_days = -1 }, '/body/fields/0/value'],
  ['page height zero', extraction, (e) => { e.body.pages[0].height = 0 }, '/body/pages/0/height'],
]) {
  test(`canonical numeric constraint rejects ${name}`, () => {
    const exchange = factory()
    acceptsUnchanged(exchange)
    mutate(exchange)
    rejectsUnchanged(exchange, 'INVALID_LEGACY_RESPONSE', [errorPath])
  })
}

// Non-finite values are in-memory robustness probes, not JSON wire payloads.
for (const value of [NaN, Infinity, -Infinity]) {
  for (const [name, factory, mutate, errorPath] of [
    ['page height', extraction, (e) => { e.body.pages[0].height = value }, '/body/pages/0/height'],
    ['byte_size', inspection, (e) => { e.body.byte_size = value }, '/body/byte_size'],
    ['bbox coordinate', extraction, (e) => { e.body.evidence[0].bbox = [0, value, 1, 1] }, '/body/evidence/0/bbox/1'],
    ['payment offset', paymentExtraction, (e) => { e.body.fields[0].value.offset_days = value }, '/body/fields/0/value'],
  ]) {
    test(`canonical ${name} rejects ${String(value)} without repair`, () => {
      const exchange = factory()
      mutate(exchange)
      rejectsUnchanged(exchange, 'INVALID_LEGACY_RESPONSE', [errorPath])
    })
  }
}

test('finite schema boundaries and numeric field strings retain their exact values', () => {
  const exchange = paymentExtraction()
  exchange.body.pages[0].width = Number.MIN_VALUE
  exchange.body.pages[0].height = 0.5
  exchange.body.evidence[0].bbox = [0, 1, 0, 1]
  exchange.body.fields[0].value.offset_days = 0
  acceptsUnchanged(exchange)
  const numericText = '000123456789012345678901234567890.0100'
  exchange.body.fields[0].value = numericText
  exchange.body.fields[0].raw_value = numericText
  assert.equal(acceptsUnchanged(exchange).body.fields[0].value, numericText)
})

// Limits: plain lowercase header records are caller-supplied transport captures;
// this boundary does not authenticate header origin or integrate with the client.
// No service accuracy, registry semantics, orchestration, ACL or readiness claim.
