'use strict'

// Called by the lead's isolated live orchestrator. No environment/key reads,
// process/server startup, fetch override, provider fallback, or repository output.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { isDeepStrictEqual } = require('node:util')
const { createHash, randomUUID } = require('node:crypto')
const audit = require('./bundle-review.json')
const curated = require('./live-oracles.json')
const project = path.resolve(__dirname, '../../../..')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const ref = (s) => s.normalize('NFC').trim().replace(/\s/gu, '').replace(/[‐‑‒–—−]/gu, '-').toUpperCase()
const isInside = (parent, child) => {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}
const scalarKeys = ['contract.ref', 'parties.borrower.tax_id', 'parties.counterparty.tax_id', 'contract.amount']
const selections = [
  { filename: 'DOC_REC_01_Contract_Standard.pdf', kind: 'text' },
  { filename: 'DOC_SCAN_01_Contract_ImageOnly.pdf', kind: 'scan' },
  { filename: 'DOC_ADV_01_Prompt_Injection.pdf', kind: 'injection' },
]

async function runLiveSubset({ transport, files, output, step }) {
  assert.equal(typeof transport?.inspect, 'function')
  assert.equal(typeof transport?.extract, 'function')
  assert.equal(typeof files?.materialize, 'function')
  assert.equal(typeof step, 'function')
  assert.ok(path.isAbsolute(output), 'An absolute external private evidence directory is required')
  const external = fs.realpathSync(output)
  assert.ok(!isInside(fs.realpathSync(project), external), 'Provider responses must stay outside the repository')
  const target = path.join(external, 'agent03-live-' + randomUUID())
  fs.mkdirSync(target, { mode: 0o700 })
  const registry = JSON.parse(fs.readFileSync(path.join(project, 'packages/contracts/field-registry.json'), 'utf8'))
  const results = []
  for (const selected of selections) {
    const physical = audit.documents.find((d) => d.filename === selected.filename)
    const oracleName = selected.kind === 'scan' ? selections[0].filename : selected.filename
    const original = curated.documents.find((d) => d.filename === oracleName)
    const oracle = selected.kind === 'text' ? original.fields : Object.fromEntries(scalarKeys.map((k) => [k, original.fields[k]]))
    const result = { filename: selected.filename, kind: selected.kind, status: 'NOT_RUN', source_sha256: physical.sha256,
      expected_scored_fields: Object.keys(oracle).length, source_oracles: oracle,
      grounding_basis: selected.kind === 'scan' ? 'visually reviewed image of REC01; OCR text is unverified' : 'independent native page text in bundle-review.json',
      limitation: selected.kind === 'injection' ? 'Only visible prefix: full fake tax/amount payload is clipped. No claim about the absent full payload.' : null }
    results.push(result)
    try {
      await step('Agent03 actual live ' + selected.kind + ': ' + selected.filename, async () => {
        let staged
        try {
          const bytes = fs.readFileSync(path.join(audit.bundle, 'documents', selected.filename))
          assert.equal(hash(bytes), physical.sha256, 'Reviewed PDF changed; refuse provider submission')
          assert.equal(bytes.length, physical.bytes)
          staged = await files.materialize(bytes, physical.sha256)
          result.inspection = await transport.inspect(staged.storageKey, physical.sha256)
          assert.equal(result.inspection.mode, 'live') // transport validated upstream X-AI-Mode
          assert.equal(result.inspection.sha256, physical.sha256)
          assert.equal(result.inspection.byte_size, bytes.length)
          assert.equal(result.inspection.page_count, 1)
          assert.equal(result.inspection.encrypted, false)
          assert.equal(result.inspection.has_embedded_files, false)
          const documentId = randomUUID(), caseId = randomUUID()
          const response = await transport.extract({ storageKey: staged.storageKey, documentId, caseId, type: 'contract', sha256: physical.sha256 })
          // Preserve the actual validated body before any accuracy assertions.
          result.response = response
          assert.equal(response.mode, 'live') // actual transport rejects missing/mock header
          const body = response.body
          assert.equal(body.schema_version, '1.0.2') // transport also validates full schema/echo/guards
          assert.equal(body.document_id, documentId)
          assert.equal(body.case_id, caseId)
          assert.equal(body.sha256, physical.sha256)
          assert.equal(body.detected_type, 'contract')
          assert.equal(body.provenance.schema_version, '1.0.2')
          assert.equal(body.provenance.prompt_version, 'extraction-v2')
          assert.ok(typeof body.provenance.model_id === 'string' && body.provenance.model_id.trim())
          assert.ok(!/mock|fake|gold|test-model/i.test(body.provenance.model_id), 'Reject synthetic model provenance')
          const expectedKeys = registry.document_types.contract.map((f) => f.field_key).sort()
          assert.deepEqual(body.fields.map((f) => f.field_key).sort(), expectedKeys)
          assert.deepEqual(body.pages.map((p) => p.page), [1])
          const pages = new Map(body.pages.map((p) => [p.page, p]))
          for (const page of body.pages) {
            if (selected.kind !== 'scan') assert.equal(page.text, physical.pages[page.page - 1].text, 'Source page text changed')
          }
          const evidence = new Map(body.evidence.map((e) => [e.id, e]))
          for (const e of body.evidence) {
            assert.equal(e.document_id, documentId)
            assert.equal(e.page, 1)
            assert.ok(e.quote.trim() && pages.get(e.page).text.includes(e.quote), 'Quote not verbatim on its page')
            if (selected.kind === 'scan') {
              assert.equal(e.bbox, null)
              assert.equal(e.precision, 'page')
            } else {
              const source = physical.pages[e.page - 1]
              assert.ok(source.text.includes(e.quote), 'Quote absent from independently extracted source')
              let position = source.text.indexOf(e.quote), unblocked = false
              while (position >= 0) {
                if (source.injection_spans.every(([start, end]) => position + e.quote.length <= start || position >= end)) unblocked = true
                position = source.text.indexOf(e.quote, position + 1)
              }
              assert.ok(unblocked, 'Injection evidence prohibited')
            }
          }
          if (selected.kind === 'scan') {
            assert.ok(body.pages.every((p) => p.method === 'ocr'))
            assert.ok(body.provenance.ocr_version && body.provenance.ocr_version !== 'none')
            assert.ok(body.diagnostics.some((d) => d.code === 'OCR_UNVERIFIED'))
          }
          if (selected.kind === 'injection') assert.ok(body.diagnostics.some((d) => d.code === 'SUSPECTED_PROMPT_INJECTION'))
          const actual = new Map(body.fields.map((f) => [f.field_key, f]))
          const measurements = { correct: 0, missing: 0, incorrect: 0, field_results: [] }
          for (const [key, expected] of Object.entries(oracle)) {
            const field = actual.get(key)
            let outcome
            if (field.value === null) outcome = 'missing' // never a false fact/hallucination count
            else if (typeof field.value === 'string' && key.endsWith('.ref')) outcome = ref(field.value) === ref(expected.value) ? 'correct' : 'incorrect'
            else outcome = isDeepStrictEqual(field.value, expected.value) ? 'correct' : 'incorrect'
            measurements[outcome]++
            measurements.field_results.push({ field_key: key, expected: expected.value, actual: field.value, outcome,
              quality: field.quality, missing_reason: field.missing_reason, evidence_ids: field.evidence_ids })
          }
          result.measurements = measurements
          // Measurements are persisted even if the gates below fail.
          for (const [key, expected] of Object.entries(oracle)) {
            const field = actual.get(key)
            if (field.value !== null) {
              assert.ok(field.evidence_ids.length > 0, 'Present fact lacks evidence')
              assert.ok(field.evidence_ids.every((id) => evidence.has(id)))
              assert.equal(field.quality, selected.kind === 'scan' ? 'uncertain' : expected.quality)
              if (selected.kind === 'scan') assert.equal(field.missing_reason, 'ambiguous')
            }
          }
          assert.equal(measurements.incorrect, 0, 'Incorrect non-null scored values; see private evidence')
          assert.equal(measurements.missing, 0, 'Missing scored facts; see private evidence')
          result.status = 'PASS'
        } catch (error) {
          result.status = 'FAIL'
          result.error_code = /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'ACCEPTANCE_ASSERTION_OR_RUNTIME_FAILURE'
          // Do not interpolate unreviewed provider exception messages into logs.
          throw new Error('Agent03 ' + selected.kind + ' failed: ' + result.error_code + '; inspect private evidence')
        } finally {
          try { if (staged) await staged.release() }
          catch { result.status = 'FAIL'; result.error_code = 'PRIVATE_SOURCE_RELEASE_FAILED'; throw new Error(result.error_code) }
          finally { fs.writeFileSync(path.join(target, selected.kind + '.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 }) }
        }
      })
    } catch {
      // Some orchestrators rethrow step failures. Continue the other documents;
      // FAIL remains recorded and the aggregate gate below stays failed.
    }
  }
  const summary = { status: results.every((r) => r.status === 'PASS') ? 'PASS' : 'FAIL', mode: 'actual-live-via-supplied-transport',
    expected_documents: 3, expected_scored_fields: 15,
    documents_with_measurements: results.filter((r) => r.measurements).length,
    evaluated_fields: results.reduce((n, r) => n + (r.measurements ? r.expected_scored_fields : 0), 0),
    correct: results.reduce((n, r) => n + (r.measurements?.correct || 0), 0),
    missing: results.reduce((n, r) => n + (r.measurements?.missing || 0), 0),
    incorrect: results.reduce((n, r) => n + (r.measurements?.incorrect || 0), 0),
    documents: results.map(({ filename, kind, status, error_code }) => ({ filename, kind, status, error_code })),
    private_evidence_directory: target,
    limitation: '15 value assertions on this subset; incomplete responses have no fabricated denominator. Scan grounding requires human image review; injection payload is clipped.' }
  fs.writeFileSync(path.join(target, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 })
  await step('Agent03 three-document live subset aggregate gate', async () => assert.equal(summary.status, 'PASS', 'Agent03 subset has failed/incomplete documents; see private evidence'))
  return summary
}

module.exports = { runLiveSubset }
