const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { readZipArchive, suggestDocumentGroup } = require('../dist/documents/document-archive')
const { extractionSummary } = require('../dist/documents/extraction-summary')
const { validateContract } = require('../dist/foundation/validation')
const { EvidenceProjectionError } = require('../dist/documents/evidence-projection')
const contracts = path.resolve(__dirname, '../../../packages/contracts')
const examples = JSON.parse(fs.readFileSync(path.join(contracts, 'examples.json')))

function source() {
  const raw = structuredClone(examples.find((x) => x.schema === 'ExtractionOutput').value)
  return { id: raw.document_id, case_id: raw.case_id, hash: raw.sha256, pages: raw.pages.length,
    version: 1, ai_mode: 'mock', name: 'BCTC_2025.pdf', status: 'completed', extraction: raw }
}

test('completed with all-null values remains explicit zero_usable_fields and preserves diagnostic codes only', () => {
  const doc = source()
  for (const field of doc.extraction.fields) {
    field.value = null; field.missing_reason = 'ambiguous'; field.quality = 'uncertain'
  }
  doc.extraction.diagnostics = [{ code: 'QUOTE_NOT_FOUND', field_key: 'financial.equity', message: 'PRIVATE-SYNTHETIC-DOCUMENT-TEXT' }]
  const summary = extractionSummary(doc)
  validateContract('ExtractionSummary', summary)
  assert.equal(summary.outcome, 'zero_usable_fields')
  assert.equal(summary.non_null_fields, 0)
  assert.equal(summary.usable_fields, 0)
  assert.equal(summary.verification, 'unverified')
  assert.equal(summary.classification_verification, 'unverified')
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE-SYNTHETIC-DOCUMENT-TEXT/)
  assert.ok(summary.fields.every((field) => field.missing_reason === 'ambiguous'))
})

test('unreadable and unknown values cannot be counted as usable; exact source binding is mandatory', () => {
  const doc = source()
  for (const field of doc.extraction.fields) { field.value = 'unknown'; field.quality = 'uncertain' }
  assert.equal(extractionSummary(doc).usable_fields, 0)
  doc.hash = 'f'.repeat(64)
  assert.throws(() => extractionSummary(doc), (error) => error instanceof EvidenceProjectionError && error.code === 'SOURCE_MISMATCH')
})

test('queued and failed summaries distinguish processing and failure without inventing extraction', () => {
  const doc = source()
  doc.extraction = null
  doc.status = 'queued'
  const queued = extractionSummary(doc)
  validateContract('ExtractionSummary', queued)
  assert.equal(queued.outcome, 'processing')
  doc.status = 'failed'
  assert.equal(extractionSummary(doc).outcome, 'failed')
})

test('groups remain suggestions; tax is legacy other and invoice is never a payment', () => {
  assert.deepEqual(suggestDocumentGroup('BCTC_2025.pdf'), { group: 'financial_statements', suggested_type: 'financial_statement' })
  assert.deepEqual(suggestDocumentGroup('Hợp đồng.pdf'), { group: 'contracts', suggested_type: 'contract' })
  assert.deepEqual(suggestDocumentGroup('Tờ khai thuế.pdf'), { group: 'tax', suggested_type: 'other' })
  assert.deepEqual(suggestDocumentGroup('BCTC_2024-2025/Tờ khai thuế.pdf'), { group: 'tax', suggested_type: 'other' })
  assert.deepEqual(suggestDocumentGroup('BCTC_2024-2025/T1-2024.pdf'), { group: 'other', suggested_type: 'other' })
  assert.deepEqual(suggestDocumentGroup('BCTC_2024-2025\\T1-2024.pdf'), { group: 'other', suggested_type: 'other' })
  assert.deepEqual(suggestDocumentGroup('invoice.pdf'), { group: 'other', suggested_type: 'invoice' })
  assert.deepEqual(suggestDocumentGroup('Ủy nhiệm chi UNC.pdf'), { group: 'payments', suggested_type: 'payment_record' })
})

test('downloadable ZIP fixture actually decompresses with unchanged per-PDF hashes and explicit rejections', async () => {
  const bytes = fs.readFileSync(path.join(contracts, 'aic-demo-48h/fixtures/synthetic-4pdf-plus-rejections.zip'))
  const entries = await readZipArchive(bytes)
  assert.equal(entries.length, 6)
  assert.equal(entries[4].rejection_code, 'ARCHIVE_UNSUPPORTED_FORMAT')
  // The reader does not inspect PDF pages; actual page rejection is covered by HTTP integration.
  assert.equal(entries[5].rejection_code, null)
  for (const entry of entries.filter((item) => item.data)) {
    const decoded = Buffer.from(entry.data, 'base64')
    assert.equal(decoded.length, entry.byte_size)
    assert.equal(createHash('sha256').update(decoded).digest('hex'), entry.sha256)
  }
})

test('subprocess reader concurrency is bounded before starting a third parser', async () => {
  const bytes = fs.readFileSync(path.join(contracts, 'aic-demo-48h/fixtures/synthetic-4pdf.zip'))
  const a = readZipArchive(bytes), b = readZipArchive(bytes)
  await assert.rejects(readZipArchive(bytes), (error) => error.getResponse().code === 'ARCHIVE_READER_BUSY')
  assert.equal((await a).length, 4)
  assert.equal((await b).length, 4)
})
