const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { test } = require('node:test')
const { createReporter } = require('../feasibility-results.cjs')
const { parseFeasibilityOutput } = require('../check-regression-prerequisites.cjs')
const runnerPath = path.resolve(__dirname, '../test-e2e-feasibility.cjs')

// Exercise the actual runner entry point in real child processes, with an injected
// synthetic suite. No HTTP fixtures/API assertion or production behavior is mocked.
function child(suite) {
  const code = `const {main}=require(${JSON.stringify(runnerPath)});` +
    `main(async(logResult)=>{${suite}}).then(code=>{process.exitCode=code})`
  const result = spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 5000, shell: false,
  })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  return result
}
const records = (status = 'PASS', count = 25) =>
  `for(let id=1;id<=${count};id++)logResult(id+'. Synthetic '+id,${JSON.stringify(status)});`

test('25 unique PASS outcomes return child exit0 and matching summary', () => {
  const result = child(records())
  assert.equal(result.status, 0)
  assert.match(result.stdout, /PASS=25 FAIL=0 BLOCKED=0; complete=true; exit=0/)
  assert.equal(parseFeasibilityOutput(result.stdout).ok, true)
  assert.equal(result.stderr, '')
})
test('caught assertion logged FAIL returns child exit1', () => {
  const result = child(`for(let id=1;id<=25;id++){try{if(id===18)require('node:assert/strict').equal(400,409);logResult(id+'. Synthetic '+id,'PASS')}catch{logResult(id+'. Synthetic '+id,'FAIL')}}`)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /PASS=24 FAIL=1 BLOCKED=0; complete=true; exit=1/)
})
test('BLOCKED outcome cannot produce a successful child exit', () => {
  const result = child(records('BLOCKED'))
  assert.equal(result.status, 1)
  assert.match(result.stdout, /PASS=0 FAIL=0 BLOCKED=25; complete=true; exit=1/)
})
for (const [name, suite] of [
  ['missing result', records('PASS', 24)],
  ['empty suite', ''],
  ['duplicate and missing IDs', records('PASS', 24) + "logResult('24. Duplicate','PASS')"],
  ['out-of-range ID', records('PASS', 24) + "logResult('26. Out of range','PASS')"],
  ['extra result', records() + "logResult('25. Extra','PASS')"],
]) test(`${name} returns child exit1 even with only PASS records`, () => {
  const result = child(suite)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /complete=false; exit=1/)
})
test('unexpected rejection after 25 PASS returns child exit2 and sanitized error', () => {
  const result = child(records() + "throw new Error('SENSITIVE_TEST_SENTINEL')")
  assert.equal(result.status, 2)
  assert.match(result.stdout, /RUNNER RESULT: ERROR/)
  assert.equal(parseFeasibilityOutput(result.stdout).ok, false)
  assert.doesNotMatch(result.stdout + result.stderr, /SENSITIVE_TEST_SENTINEL/)
})
test('invalid status fails closed as runner error', () => {
  const result = child("logResult('1. Invalid','UNKNOWN')")
  assert.equal(result.status, 2)
})
test('reporter derives exit from recorded outcomes without consulting log text', () => {
  const output = []
  const reporter = createReporter((line) => output.push(line))
  for (let id = 1; id <= 25; id++) reporter.record(`${id}. Synthetic`, 'PASS', '[FAIL] detail text')
  assert.equal(reporter.finish(), 0)
  assert.ok(output.some((line) => line.includes('[FAIL] detail text')))
})
test('importing actual runner performs no suite/network work', () => {
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(runnerPath)})`], {
    encoding: 'utf8', timeout: 5000, shell: false,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})
test('result parser rejects a historical PASS log without current exit accounting', () => {
  const result = child(records())
  const withoutMarker = result.stdout.split('\n').filter((line) => !line.startsWith('RUNNER RESULT:')).join('\n')
  assert.equal(parseFeasibilityOutput(withoutMarker).ok, false)
  assert.equal(parseFeasibilityOutput(result.stdout + result.stdout.split('\n').find((line) => line.startsWith('RUNNER RESULT:'))).ok, false)
})
