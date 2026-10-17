const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const {
  LEGACY_FIELD_KEY_PREFIX,
  EvidenceProjectionError,
  projectLegacyExtraction,
  resolveLegacyEvidence,
} = require('../dist/documents/evidence-projection.js')
const { createLegacyAiValidationBoundary } = require('../dist/ai-adapters/legacy-validation.js')

// Only static reviewed contract bytes are read. All source documents, responses
// and repository rows below are synthetic; no services, DB, live AI or FS mocks.
const contractDir = path.resolve(__dirname, '../../../packages/contracts')
const sha256sums = readFileSync(path.join(contractDir, 'SHA256SUMS'), 'utf8')
const boundary = createLegacyAiValidationBoundary({
  version: '1.0.2',
  sha256sums,
  files: Object.fromEntries(
    sha256sums
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const name = line.split(/\s+/)[1]
        return [name, readFileSync(path.join(contractDir, name))]
      }),
  ),
})
const DOCUMENT = '00000000-0000-4000-8000-000000000001'
const CASE = '00000000-0000-4000-8000-000000000002'
const OTHER_DOCUMENT = '00000000-0000-4000-8000-000000000003'
const SOURCE_A = 'ab000000-0000-4000-8000-000000000004'
const SOURCE_B = 'ab000000-0000-4000-8000-000000000005'
const SOURCE_UNUSED = 'ab000000-0000-4000-8000-000000000006'
const UNKNOWN_SOURCE = 'ab000000-0000-4000-8000-000000000007'
const HASH = 'a'.repeat(64)
const payment = () => ({
  event_type: 'unknown',
  offset_days: null,
  calendar_basis: 'unknown',
  scope_ref: 'party_a_unresolved',
  other_conditions: ['Cần kiểm tra\r\nđiều kiện giả lập'],
  counting_convention: 'unknown',
  other_conditions_state: 'unknown',
})
function fixture() {
  const body = {
    schema_version: '1.0.2',
    document_id: DOCUMENT,
    case_id: CASE,
    sha256: HASH,
    detected_type: 'contract',
    classification_confident: false,
    pages: [1, 2].map((page) => ({
      page,
      text: `Trang giả lập ${page}\r\n\0`,
      method: page === 1 ? 'text' : 'ocr',
      width: 595,
      height: 842,
    })),
    fields: [
      {
        id: '00000000-0000-4000-8000-000000000010',
        document_id: DOCUMENT,
        field_key: 'contract.party_a.name',
        raw_value: 'Bên A: tên giả lập',
        value: 'Tên giả lập',
        quality: 'readable',
        evidence_ids: [SOURCE_A, SOURCE_B],
        missing_reason: null,
      },
      {
        id: '00000000-0000-4000-8000-000000000011',
        document_id: DOCUMENT,
        field_key: 'contract.payment_condition',
        raw_value: 'Điều kiện chưa rõ',
        value: payment(),
        quality: 'uncertain',
        evidence_ids: [SOURCE_B],
        missing_reason: 'ambiguous',
      },
      {
        id: '00000000-0000-4000-8000-000000000012',
        document_id: DOCUMENT,
        field_key: 'unknown.future_extension',
        raw_value: null,
        value: null,
        quality: 'unreadable',
        evidence_ids: [],
        missing_reason: 'unreadable',
      },
    ],
    evidence: [
      {
        id: SOURCE_A,
        document_id: DOCUMENT,
        page: 1,
        quote: 'Bên A: tên giả lập\r\n\0',
        bbox: null,
        precision: 'page',
      },
      {
        id: SOURCE_B,
        document_id: DOCUMENT,
        page: 2,
        quote: 'Điều kiện chưa rõ',
        bbox: [0, 0.2, 0.9, 1],
        precision: 'bbox',
      },
      {
        id: SOURCE_UNUSED,
        document_id: DOCUMENT,
        page: 1,
        quote: 'Nguồn độc lập chưa gắn trường',
        bbox: null,
        precision: 'page',
      },
    ],
    diagnostics: [
      {
        code: 'UNCERTAIN',
        message: 'Cần người xem lại',
        document_id: DOCUMENT,
        field_key: 'contract.payment_condition',
      },
      // Diagnostics are retained as raw data, never promoted into source refs.
      {
        code: 'LEGACY_DIAGNOSTIC',
        message: 'Unrelated diagnostic',
        document_id: OTHER_DOCUMENT,
        field_key: null,
      },
    ],
    provenance: {
      model_id: 'SYNTHETIC-NOT-LIVE',
      prompt_version: 'synthetic-1',
      ocr_version: 'none',
      schema_version: '1.0.2',
    },
  }
  const validated = boundary.validate({
    operation: 'extract',
    request: {
      schema_version: '1.0.2',
      document_id: DOCUMENT,
      case_id: CASE,
      sha256: HASH,
      type: 'contract',
      storage_key: 'synthetic/input.pdf',
    },
    body,
    headers: { 'x-ai-mode': 'mock' },
    expectedMode: 'mock',
  })
  assert.strictEqual(validated.body, body)
  const document = {
    id: DOCUMENT,
    organization_id: '00000000-0000-4000-8000-000000000020',
    case_id: CASE,
    lineage: '00000000-0000-4000-8000-000000000021',
    version: 7,
    hash: HASH,
    byte_size: 321,
    pages: 2,
    name: 'synthetic.pdf',
    type: 'other',
    source_class: 'unresolved',
    status: 'extracted',
    created_at: '2026-10-17T00:00:00Z',
    created_by: '00000000-0000-4000-8000-000000000022',
    active: false,
    ai_mode: 'mock',
    extraction: validated.body,
  }
  return { document, raw: validated.body, validated }
}
function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
function rejects(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof EvidenceProjectionError)
    assert.equal(error.code, code)
    assert.equal(error.message, `Legacy evidence projection failed: ${code}`)
    assert.deepEqual(Object.keys(error).sort(), ['code', 'name'])
    return true
  })
}

test('projects canonically validated .body with explicit legacy keys and unchanged raw provenance/diagnostics', () => {
  const { document, raw } = fixture()
  const before = structuredClone(raw)
  const result = projectLegacyExtraction(freeze(document), freeze(raw))
  assert.deepEqual(Object.keys(result).sort(), ['evidence', 'fields', 'raw'])
  assert.strictEqual(result.raw, raw)
  assert.strictEqual(result.raw.provenance, raw.provenance)
  assert.strictEqual(result.raw.diagnostics, raw.diagnostics)
  assert.strictEqual(result.raw.pages, raw.pages)
  assert.deepEqual(raw, before)
  assert.equal(result.fields.length, raw.fields.length)
  for (let index = 0; index < raw.fields.length; index++) {
    const field = result.fields[index]
    const original = raw.fields[index]
    assert.equal(field.field_key, `${LEGACY_FIELD_KEY_PREFIX}${original.field_key}`)
    assert.deepEqual(field.value, original.value)
    assert.deepEqual(field.raw_value, original.raw_value)
    assert.equal(field.quality, original.quality)
    assert.equal(field.missing_reason, original.missing_reason)
    assert.deepEqual(field.evidence_refs, original.evidence_ids)
    assert.deepEqual(Object.keys(field).sort(), [
      'evidence_refs',
      'field_key',
      'missing_reason',
      'quality',
      'raw_value',
      'value',
    ])
  }
})

test('preserves uncertainty, unresolved party labels and structured conditions without identity/verification inference', () => {
  const { document, raw } = fixture()
  const { fields, evidence } = projectLegacyExtraction(document, raw)
  assert.equal(fields[0].field_key, 'legacy:1.0.2:contract.party_a.name')
  assert.equal(fields[1].quality, 'uncertain')
  assert.equal(fields[1].missing_reason, 'ambiguous')
  assert.deepEqual(fields[1].value, payment())
  assert.equal(fields[2].value, null)
  assert.equal(fields[2].raw_value, null)
  assert.deepEqual(fields[2].evidence_refs, [])
  for (const record of [...fields, ...evidence]) {
    for (const key of [
      'party_role',
      'owner_party_ref',
      'verified',
      'verification',
      'verification_state',
      'classification_confident',
      'period',
      'currency',
      'unit_multiplier',
      'score',
      'grade',
      'pd',
    ]) {
      assert.equal(Object.hasOwn(record, key), false, key)
    }
  }
  assert.equal(document.type, 'other')
  assert.equal(raw.detected_type, 'contract') // Detection is never an approved classification.
  assert.equal(raw.classification_confident, false)
})

test('every own source resolves exactly, including unused evidence, bound to the authoritative version/hash', () => {
  const { document, raw } = fixture()
  const result = projectLegacyExtraction(document, raw)
  assert.equal(result.evidence.length, raw.evidence.length)
  for (let index = 0; index < raw.evidence.length; index++) {
    const source = result.evidence[index]
    assert.deepEqual(source, {
      id: raw.evidence[index].id,
      document_id: document.id,
      document_version: 7,
      page: raw.evidence[index].page,
      quote: raw.evidence[index].quote,
      source_hash: document.hash,
      bbox: raw.evidence[index].bbox,
    })
    assert.deepEqual(resolveLegacyEvidence(document, raw, source.id), source)
  }
  assert.equal(resolveLegacyEvidence(document, raw, SOURCE_UNUSED).id, SOURCE_UNUSED)
  assert.equal(
    projectLegacyExtraction({ ...document, version: 19 }, raw).evidence[0].document_version,
    19,
  )
  assert.equal(document.active, false) // Historical exact versions remain resolvable.
})

test('output arrays, boxes and structured values cannot mutate the unchanged raw response', () => {
  const { document, raw } = fixture()
  const before = structuredClone(raw)
  const result = projectLegacyExtraction(document, raw)
  result.fields[0].evidence_refs.push(UNKNOWN_SOURCE)
  result.fields[1].value.other_conditions[0] = 'changed projection only'
  result.evidence[1].bbox[0] = 0.5
  result.evidence[0].quote = 'changed projection only'
  result.fields.pop()
  assert.deepEqual(raw, before)
  const source = resolveLegacyEvidence(document, raw, SOURCE_B)
  source.bbox[0] = 0.75
  assert.deepEqual(raw, before)
})

test('unknown legacy keys, exact strings, nulls and decimal strings are preserved without a registry lookup', () => {
  const { document, raw } = fixture()
  for (const key of [
    'unregistered.new_field',
    '__proto__',
    'borrower.name',
    '',
    'financial.unit_multiplier',
  ]) {
    raw.fields[0].field_key = key
    raw.fields[0].value = '0001.230000'
    assert.equal(projectLegacyExtraction(document, raw).fields[0].field_key, `legacy:1.0.2:${key}`)
    assert.equal(projectLegacyExtraction(document, raw).fields[0].value, '0001.230000')
  }
})

test('document, case and hash echoes must match exactly before any source IDs are exposed', () => {
  for (const [key, value] of [
    ['document_id', OTHER_DOCUMENT],
    ['case_id', OTHER_DOCUMENT],
    ['sha256', 'b'.repeat(64)],
    ['sha256', HASH.toUpperCase()],
    ['document_id', null],
  ]) {
    const { document, raw } = fixture()
    raw[key] = value
    const before = structuredClone(raw)
    rejects(() => projectLegacyExtraction(document, raw), 'SOURCE_MISMATCH')
    rejects(() => resolveLegacyEvidence(document, raw, SOURCE_A), 'SOURCE_MISMATCH')
    assert.deepEqual(raw, before)
  }
})

test('field/evidence cross-document sources fail the entire projection; no partial or diagnostic fallback', () => {
  for (const location of ['fields', 'evidence']) {
    const { document, raw } = fixture()
    raw[location][0].document_id = OTHER_DOCUMENT
    rejects(() => projectLegacyExtraction(document, raw), 'SOURCE_MISMATCH')
    rejects(() => resolveLegacyEvidence(document, raw, SOURCE_UNUSED), 'SOURCE_MISMATCH')
  }
  const { document, raw } = fixture()
  rejects(() => resolveLegacyEvidence(document, raw, OTHER_DOCUMENT), 'EVIDENCE_NOT_FOUND')
  rejects(() => resolveLegacyEvidence(document, raw, document.lineage), 'EVIDENCE_NOT_FOUND')
  rejects(() => resolveLegacyEvidence(document, raw, raw.fields[0].id), 'EVIDENCE_NOT_FOUND')
})

test('missing refs are rejected, never dropped or searched for in another document', () => {
  const { document, raw } = fixture()
  raw.fields[0].evidence_ids = [SOURCE_A, UNKNOWN_SOURCE]
  rejects(() => projectLegacyExtraction(document, raw), 'MISSING_EVIDENCE_REFERENCE')
  rejects(() => resolveLegacyEvidence(document, raw, SOURCE_A), 'MISSING_EVIDENCE_REFERENCE')
  const own = fixture()
  rejects(() => resolveLegacyEvidence(own.document, own.raw, UNKNOWN_SOURCE), 'EVIDENCE_NOT_FOUND')
})

test('duplicate source/field UUIDs and repeated refs reject instead of silently deduplicating', () => {
  for (const location of ['fields', 'evidence']) {
    for (const uppercase of [false, true]) {
      const { document, raw } = fixture()
      raw[location][1].id = uppercase ? raw[location][0].id.toUpperCase() : raw[location][0].id
      rejects(() => projectLegacyExtraction(document, raw), 'DUPLICATE_ID')
    }
  }
  for (const duplicate of [SOURCE_A, SOURCE_A.toUpperCase()]) {
    const { document, raw } = fixture()
    raw.fields[0].evidence_ids = [SOURCE_A, duplicate]
    rejects(() => projectLegacyExtraction(document, raw), 'DUPLICATE_EVIDENCE_REFERENCE')
  }
  // Different fields may legitimately cite the very same evidence.
  const { document, raw } = fixture()
  assert.ok(
    projectLegacyExtraction(document, raw)
      .fields.slice(0, 2)
      .every((field) => field.evidence_refs.includes(SOURCE_B)),
  )
})

test('duplicate field keys cannot select an arbitrary human correction target', () => {
  const { document, raw } = fixture()
  raw.fields.push({ ...raw.fields[0], id: '00000000-0000-4000-8000-999999999999' })
  rejects(() => projectLegacyExtraction(document, raw), 'DUPLICATE_ID')
})
test('source IDs preserve spelling and resolution/ref lookup requires the exact source ID', () => {
  const { document, raw } = fixture()
  rejects(() => resolveLegacyEvidence(document, raw, SOURCE_A.toUpperCase()), 'EVIDENCE_NOT_FOUND')
  raw.fields[0].evidence_ids[0] = SOURCE_A.toUpperCase()
  rejects(() => projectLegacyExtraction(document, raw), 'MISSING_EVIDENCE_REFERENCE')
  raw.evidence[0].id = SOURCE_A.toUpperCase()
  assert.equal(
    projectLegacyExtraction(document, raw).fields[0].evidence_refs[0],
    SOURCE_A.toUpperCase(),
  )
  assert.equal(
    resolveLegacyEvidence(document, raw, SOURCE_A.toUpperCase()).id,
    SOURCE_A.toUpperCase(),
  )
})

test('UUIDs are required for every projected field/source/ref and resolver input', () => {
  for (const value of ['', '../escape', 'tenant/source', '1', `${SOURCE_A}\n`, null, 1]) {
    for (const location of ['fields', 'evidence']) {
      const { document, raw } = fixture()
      raw[location][0].id = value
      rejects(() => projectLegacyExtraction(document, raw), 'INVALID_ID')
    }
    const { document, raw } = fixture()
    raw.fields[0].evidence_ids = [value]
    rejects(() => projectLegacyExtraction(document, raw), 'INVALID_ID')
    rejects(() => resolveLegacyEvidence(document, raw, value), 'INVALID_ID')
  }
})

test('evidence page must exist in extraction and fit the authoritative document page count', () => {
  for (const page of [0, -1, 3, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const { document, raw } = fixture()
    raw.evidence[0].page = page
    rejects(() => projectLegacyExtraction(document, raw), 'INVALID_PAGE')
  }
  const { document, raw } = fixture()
  raw.pages.pop() // A page <= document.pages still needs to actually exist.
  rejects(() => projectLegacyExtraction(document, raw), 'INVALID_PAGE')
  const other = fixture()
  other.document.pages = 1
  rejects(() => projectLegacyExtraction(other.document, other.raw), 'INVALID_PAGE')
})

test('duplicate, gapped, unordered and invalid extraction pages fail closed', () => {
  for (const pages of [[1, 1], [1, 3], [2, 1], [0], [1.5], ['1']]) {
    const { document, raw } = fixture()
    raw.pages = pages.map((page) => ({ ...raw.pages[0], page }))
    rejects(() => projectLegacyExtraction(document, raw), 'INVALID_PAGE')
  }
})

test('empty canonical extraction remains empty and creates no inferred field or source', () => {
  const { document, raw } = fixture()
  raw.pages = []
  raw.fields = []
  raw.evidence = []
  const result = projectLegacyExtraction(document, raw)
  assert.deepEqual(result.fields, [])
  assert.deepEqual(result.evidence, [])
  assert.strictEqual(result.raw, raw)
  rejects(() => resolveLegacyEvidence(document, raw, SOURCE_A), 'EVIDENCE_NOT_FOUND')
})

test('invalid document binding and unsafe version/page/hash metadata are rejected', () => {
  for (const [key, value] of [
    ['id', 'not-uuid'],
    ['case_id', null],
    ['hash', `sha256:${HASH}`],
    ['hash', `${HASH}\n`],
    ['hash', HASH.toUpperCase()],
    ['version', 0],
    ['version', 1.5],
    ['version', '7'],
    ['version', Number.MAX_SAFE_INTEGER + 1],
    ['pages', 0],
    ['pages', '2'],
  ]) {
    const { document, raw } = fixture()
    document[key] = value
    rejects(() => projectLegacyExtraction(document, raw), 'INVALID_DOCUMENT')
  }
  rejects(() => projectLegacyExtraction(null, fixture().raw), 'INVALID_DOCUMENT')
})

test('wrong envelopes, missing values, malformed refs, quotes and boxes are not repaired', () => {
  const { document, validated } = fixture()
  for (const raw of [
    null,
    undefined,
    [],
    {},
    validated,
    { ...validated.body, schema_version: '2.0.0' },
    { ...validated.body, evidence: null },
    { ...validated.body, fields: {} },
  ]) {
    rejects(() => projectLegacyExtraction(document, raw), 'INVALID_EXTRACTION')
  }
  for (const mutate of [
    (raw) => {
      delete raw.fields[0].value
    },
    (raw) => {
      raw.fields[0].evidence_ids = null
    },
    (raw) => {
      raw.fields[0].quality = 'verified'
    },
    (raw) => {
      raw.evidence[0].quote = ''
    },
    (raw) => {
      raw.evidence[0].bbox = [0, 1, 2, 3]
    },
    (raw) => {
      raw.evidence[0].bbox = [0, 0, NaN, 1]
    },
    (raw) => {
      raw.evidence[0].bbox = [0, 1]
    },
    (raw) => {
      raw.evidence[0].precision = 'inferred'
    },
  ]) {
    const { document, raw } = fixture()
    mutate(raw)
    rejects(() => projectLegacyExtraction(document, raw), 'INVALID_EXTRACTION')
  }
})

test('projection is deterministic and failures do not leak quotes, metadata or private source identifiers', () => {
  const { document, raw } = fixture()
  assert.deepEqual(projectLegacyExtraction(document, raw), projectLegacyExtraction(document, raw))
  const before = structuredClone(raw)
  raw.fields[0].evidence_ids.push(UNKNOWN_SOURCE)
  try {
    projectLegacyExtraction(document, freeze(raw))
    assert.fail('Expected a projection error')
  } catch (error) {
    assert.ok(error instanceof EvidenceProjectionError)
    const exposed = `${error}\n${error.stack}\n${JSON.stringify(error)}`
    for (const secret of [SOURCE_A, UNKNOWN_SOURCE, DOCUMENT, HASH, before.evidence[0].quote]) {
      assert.equal(exposed.includes(secret), false)
    }
  }
  assert.deepEqual(raw.fields[0].evidence_ids, [...before.fields[0].evidence_ids, UNKNOWN_SOURCE])
  assert.deepEqual(raw.provenance, before.provenance)
})
