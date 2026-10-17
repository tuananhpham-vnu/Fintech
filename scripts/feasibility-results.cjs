// Result accounting only. API assertions remain in test-e2e-feasibility.cjs.
const EXPECTED_TEST_COUNT = 25

function createReporter(write = console.log) {
  const results = []
  function record(name, status, details) {
    if (!['PASS', 'FAIL', 'BLOCKED'].includes(status)) throw new Error('Invalid test status')
    write(`[${status}] ${name}`)
    if (details) write(`  -> ${details}`)
    results.push({ name, status })
  }
  function finish(fatal = false) {
    write('\n====================================================')
    write('SUMMARY OF RESULTS:')
    write('====================================================')
    for (const result of results) write(`[${result.status}] ${result.name}`)
    const ids = results.map((result) => Number(/^(\d+)\. /.exec(result.name)?.[1]))
    const complete = results.length === EXPECTED_TEST_COUNT &&
      new Set(ids).size === EXPECTED_TEST_COUNT &&
      ids.every((id) => Number.isInteger(id) && id >= 1 && id <= EXPECTED_TEST_COUNT)
    const counts = Object.fromEntries(['PASS', 'FAIL', 'BLOCKED'].map((status) =>
      [status, results.filter((result) => result.status === status).length]))
    const code = fatal ? 2 : complete && counts.PASS === EXPECTED_TEST_COUNT ? 0 : 1
    write(`RUNNER RESULT: ${code === 0 ? 'PASS' : code === 2 ? 'ERROR' : 'FAIL'}; ` +
      `PASS=${counts.PASS} FAIL=${counts.FAIL} BLOCKED=${counts.BLOCKED}; complete=${complete}; exit=${code}`)
    return code
  }
  return { record, finish }
}

module.exports = { createReporter }
