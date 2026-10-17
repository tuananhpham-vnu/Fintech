'use strict'
// Harness tests only. No provider response is fabricated or submitted.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { runLiveSubset } = require('./live-subset.cjs')

test('refuses repository evidence output before materializing/calling provider', async () => {
  const forbidden = () => { throw new Error('must not be called') }
  await assert.rejects(runLiveSubset({ transport: { inspect: forbidden, extract: forbidden },
    files: { materialize: forbidden }, output: __dirname, step: forbidden }), /outside the repository/)
})

test('all failed provider calls remain FAIL with zero evaluated fields and no invented accuracy', async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'accept-ai-harness-unit-'))
  let attempts = 0, releases = 0
  const steps = []
  const summary = await runLiveSubset({ output,
    transport: {
      inspect: async () => { attempts++; throw Object.assign(new Error('unit-only unavailable transport'), { code: 'PROVIDER_UNAVAILABLE' }) },
      extract: async () => { throw new Error('extract must not be reached') },
    },
    files: { materialize: async () => ({ storageKey: 'unit-placeholder', release: async () => { releases++ } }) },
    step: async (label, fn) => {
      try { return await fn() }
      catch { steps.push({ label, status: 'FAIL' }); return undefined }
    },
  })
  assert.equal(attempts, 3)
  assert.equal(releases, 3)
  assert.equal(summary.status, 'FAIL')
  assert.equal(summary.expected_scored_fields, 15)
  assert.equal(summary.evaluated_fields, 0)
  assert.equal(summary.correct + summary.missing + summary.incorrect, 0)
  assert.equal(steps.length, 4) // three document failures plus aggregate
  assert.ok(summary.documents.every((d) => d.status === 'FAIL'))
  for (const kind of ['text', 'scan', 'injection']) {
    const result = JSON.parse(fs.readFileSync(path.join(summary.private_evidence_directory, kind + '.json'), 'utf8'))
    assert.equal(result.response, undefined)
    assert.equal(result.measurements, undefined)
  }
})
