const test = require('node:test')
const assert = require('node:assert/strict')
const { runBrowserAcceptance } = require('./browser-flows.cjs')

function suppliedBrowser() {
  let closed = 0
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    on() {},
    async goto() {
      throw new Error('synthetic-password #token=synthetic-secret must never escape')
    },
  }
  return {
    async newContext() {
      return {
        newPage: async () => page,
        close: async () => {
          closed++
        },
      }
    },
    closed: () => closed,
  }
}
function options(browser, step) {
  return {
    browser,
    step,
    origin: 'http://127.0.0.1:3000',
    username: 'synthetic-test',
    password: 'synthetic-password',
    output: __dirname,
    providerAvailable: false,
  }
}

test('undefined recorder outcomes block every dependent browser action', async () => {
  const browser = suppliedBrowser()
  const names = []
  const result = await runBrowserAcceptance(
    options(browser, async (name) => {
      names.push(name)
      return undefined
    }),
  )
  assert.deepEqual(names, ['auth.invalid-credentials', 'auth.specialist-login'])
  assert.equal(result.steps.filter((s) => s.status === 'FAIL').length, 2)
  assert.equal(result.steps.filter((s) => s.status === 'BLOCKED').length, 28)
  assert.deepEqual(result.cases, {})
  assert.equal(browser.closed(), 1)
})

test('recorder receives sanitized action errors and contexts always close', async () => {
  const browser = suppliedBrowser()
  const messages = []
  await runBrowserAcceptance(
    options(browser, async (name, fn) => {
      try {
        return await fn()
      } catch (error) {
        messages.push(error.message)
        return undefined
      }
    }),
  )
  assert.equal(messages.length, 2)
  assert.ok(messages.every((message) => message.includes('sensitive details suppressed')))
  assert.ok(
    messages.every(
      (message) => !message.includes('synthetic-password') && !message.includes('#token='),
    ),
  )
  assert.equal(browser.closed(), 1)
})
