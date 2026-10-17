const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { runRecoveryScenarios, _testing } = require('./recovery-scenarios.cjs')

// These are orchestration tests, not simulated browser acceptance. They never
// supply fake successful UI responses or reproduce the application's selectors.
function checks(recorder = async (_, action) => action()) {
  const result = { steps: [] }
  return { result, check: _testing.createChecks(recorder, result) }
}

test('a swallowed mutation failure is attempted once and blocks dependent work', async () => {
  let attempts = 0
  let dependent = 0
  const errors = []
  const { check, result } = checks(async (_, action) => {
    try {
      return await action()
    } catch (error) {
      errors.push(error.message)
      return true // A bad recorder cannot turn a failed action into PASS.
    }
  })
  const value = await check('mutation', [], async () => {
    attempts++
    throw new Error('password-SECRET #token=RAW https://host/?access_token=RAW')
  })
  await check('dependent', [value], async () => {
    dependent++
    return true
  })
  assert.equal(attempts, 1)
  assert.equal(dependent, 0)
  assert.deepEqual(
    result.steps.map((item) => item.status),
    ['FAIL', 'BLOCKED'],
  )
  assert.equal(errors.length, 1)
  assert.ok(!/SECRET|token=|https:/.test(errors[0]))
})

test('a recorder retry cannot invoke a mutation twice or erase the first failure', async () => {
  let attempts = 0
  const { check, result } = checks(async (_, action) => {
    try {
      await action()
    } catch {}
    try {
      return await action()
    } catch {
      return true
    }
  })
  assert.equal(
    await check('write', [], async () => {
      attempts++
      throw Error('private')
    }),
    undefined,
  )
  assert.equal(attempts, 1)
  assert.equal(result.steps[0].status, 'FAIL')
})

test('repeated callbacks after success are also rejected before duplicate side effects', async () => {
  let writes = 0
  const { check, result } = checks(async (_, action) => {
    const value = await action()
    try {
      await action()
    } catch {}
    return value
  })
  assert.equal(
    await check('write', [], async () => {
      writes++
      return true
    }),
    undefined,
  )
  assert.equal(writes, 1)
  assert.equal(result.steps[0].status, 'FAIL')
})

test('no callback, discarded result, and fabricated recorder result cannot count as PASS', async () => {
  for (const recorder of [
    async () => true,
    async (_, action) => {
      await action()
    },
    async (_, action) => {
      await action()
      return { fabricated: true }
    },
  ]) {
    const { check, result } = checks(recorder)
    assert.equal(await check('check', [], async () => ({ persisted: true })), undefined)
    assert.equal(result.steps[0].status, 'FAIL')
  }
})

test('empty/false action results fail and a valid result is returned without reinterpretation', async () => {
  const { check, result } = checks()
  for (const value of [undefined, null, false])
    assert.equal(await check('empty', [], async () => value), undefined)
  const nonempty = { id: 'synthetic-result' }
  assert.equal(await check('persisted', [], async () => nonempty), nonempty)
  assert.deepEqual(
    result.steps.map((item) => item.status),
    ['FAIL', 'FAIL', 'FAIL', 'PASS'],
  )
})

test('recorder failure after an action is retained and does not retry the action', async () => {
  let attempts = 0
  const { check, result } = checks(async (_, action) => {
    await action()
    throw Error('private recorder failure')
  })
  assert.equal(
    await check('persisted', [], async () => {
      attempts++
      return true
    }),
    undefined,
  )
  assert.equal(attempts, 1)
  assert.equal(result.steps[0].status, 'FAIL')
})

test('diagnostics expose only a controlled category/stage and attempt failure capture once', async () => {
  const result = { steps: [] }
  const messages = []
  let captures = 0
  const check = _testing.createChecks(
    async (_, action) => {
      try {
        return await action()
      } catch (error) {
        messages.push(error.message)
      }
    },
    result,
    {
      failure: async () => {
        captures++
        throw Error('private screenshot failure')
      },
    },
  )
  await check('diagnostic', [], async (phase) => {
    phase('empty-term-reason')
    const error = new Error('REDACTED #token=REDACTED private response')
    error.name = 'TimeoutError'
    throw error
  })
  assert.equal(captures, 1)
  assert.equal(result.steps[0].status, 'FAIL')
  assert.equal(result.steps[0].failure.category, 'UI_TIMEOUT')
  assert.equal(result.steps[0].failure.stage, 'empty-term-reason')
  assert.ok(messages[0].includes('UI_TIMEOUT stage=empty-term-reason'))
  assert.ok(!/token=|private response|REDACTED/.test(JSON.stringify({ result, messages })))
})

function suppliedBrowser({ failNewPage = false, failClose = false } = {}) {
  const state = { contexts: 0, navigations: 0, closes: 0 }
  const browser = {
    async newContext() {
      state.contexts++
      return {
        async newPage() {
          if (failNewPage) throw Error('private page creation failure')
          return {
            setDefaultTimeout() {},
            setDefaultNavigationTimeout() {},
            on() {},
            async goto() {
              state.navigations++
              throw Error('SECRET_PASSWORD #token=SECRET')
            },
          }
        },
        async close() {
          state.closes++
          if (failClose) throw Error('private cleanup failure')
        },
      }
    },
    close() {
      assert.fail('Caller-owned Browser must never be closed')
    },
  }
  return { browser, state }
}
function options(browser, step = async (_, action) => action()) {
  return {
    browser,
    step,
    origin: 'http://127.0.0.1:3000',
    username: 'synthetic-specialist',
    password: 'SECRET_PASSWORD',
    output: path.resolve(__dirname),
    cases: {
      RECEIVABLE: '00000000-0000-4000-8000-000000000001',
      PREPAYMENT: '00000000-0000-4000-8000-000000000002',
    },
  }
}

test('failed logins retain exact failure accounting, never retry navigation, and close owned contexts', async () => {
  const { browser, state } = suppliedBrowser()
  const errors = []
  const result = await runRecoveryScenarios(
    options(browser, async (_, action) => {
      try {
        return await action()
      } catch (error) {
        errors.push(error.message)
        return true
      }
    }),
  )
  assert.deepEqual(state, { contexts: 2, navigations: 2, closes: 2 })
  assert.equal(result.ok, false)
  assert.equal(result.complete, false)
  assert.equal(result.counts.FAIL, 2)
  assert.equal(result.counts.PASS, 2) // Cleanup only, never fake UI success.
  assert.ok(result.counts.BLOCKED > 0)
  assert.equal(
    result.steps.find((item) => item.name === 'RECEIVABLE.recovery.existing-case').status,
    'BLOCKED',
  )
  assert.equal(
    result.steps.find((item) => item.name === 'recovery.auth.logout-and-draft-isolation').status,
    'BLOCKED',
  )
  assert.equal(
    Object.values(result.counts).reduce((sum, value) => sum + value, 0),
    result.steps.length,
  )
  assert.equal(errors.length, 2)
  assert.ok(!/SECRET|token=/.test(JSON.stringify({ result, errors })))
  assert.deepEqual(result.screenshots, [])
})

test('context creation is cleaned up even if its page never becomes available', async () => {
  const { browser, state } = suppliedBrowser({ failNewPage: true })
  const result = await runRecoveryScenarios(options(browser))
  assert.deepEqual(state, { contexts: 2, navigations: 0, closes: 2 })
  assert.equal(result.counts.FAIL, 2)
  assert.equal(result.counts.PASS, 2)
})

test('cleanup failure stays FAIL and does not prevent closing the next context', async () => {
  const { browser, state } = suppliedBrowser({ failClose: true })
  const result = await runRecoveryScenarios(options(browser))
  assert.equal(state.closes, 2)
  assert.equal(result.counts.FAIL, 4)
  assert.equal(result.counts.PASS, 0)
  assert.equal(result.ok, false)
  assert.ok(
    result.steps
      .filter((item) => item.name.startsWith('recovery.cleanup.'))
      .every((item) => item.status === 'FAIL'),
  )
})

test('non-executing recorder allocates no contexts and every required action stays failed or blocked', async () => {
  const { browser, state } = suppliedBrowser()
  const result = await runRecoveryScenarios(options(browser, async () => undefined))
  assert.deepEqual(state, { contexts: 0, navigations: 0, closes: 0 })
  assert.equal(result.counts.FAIL, 2)
  assert.equal(result.counts.PASS, 0)
  assert.equal(result.ok, false)
})

test('null gates reject published rating/points and empty selected metrics', () => {
  const registry = {
    method_status: 'unconfigured',
    score: null,
    band: null,
    grade: null,
    pd: null,
    sets: [],
    metrics: Array.from({ length: 7 }, () => ({ points: null })),
  }
  assert.doesNotThrow(() => _testing.nullGate(registry, true))
  for (const key of ['score', 'band', 'grade', 'pd'])
    assert.throws(() => _testing.nullGate({ ...registry, [key]: 'published' }, true))
  assert.throws(() => _testing.nullGate({ ...registry, metrics: [{ points: '1' }] }))
  assert.throws(() => _testing.nullGate({ ...registry, metrics: [] }, true))
})

test('invalid configuration fails before allocating runtime and never echoes a credential URL', async () => {
  const { browser, state } = suppliedBrowser()
  await assert.rejects(
    runRecoveryScenarios({ ...options(browser), origin: 'http://user:REDACTED@host' }),
    (error) => !error.message.includes('REDACTED'),
  )
  assert.equal(state.contexts, 0)
})
