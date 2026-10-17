const test = require('node:test')
const assert = require('node:assert/strict')
require('../helpers/register-typescript.cjs')
const { documentsApi } = require('../../src/features/documents/api.ts')
const { MutationKey, setCsrfToken } = require('../../src/lib/api/client.ts')
const { translate } = require('../../src/lib/i18n/messages.ts')

test('retry consumer sends exact reason/revision, scoped key and CSRF; decodes frozen job/revision', async () => {
  const originalFetch = global.fetch
  const calls = [],
    keys = new MutationKey()
  const output = { job: { id: 'job-1', state: 'queued', retryable: true }, revision: 4 }
  setCsrfToken('synthetic-csrf')
  global.fetch = async (url, options) => {
    calls.push({ url, ...options })
    return Response.json(output)
  }
  try {
    const input = { expected_revision: 3, reason: 'Known transient provider failure' }
    assert.deepEqual(await documentsApi.retry('job-1', input, keys), output)
    assert.deepEqual(await documentsApi.retry('job-1', input, keys), output)
    await documentsApi.retry('job-1', { ...input, reason: 'Changed retry intent' }, keys)
    await documentsApi.retry('job-2', input, keys)
    assert.equal(calls[0].url, '/api/v2/jobs/job-1/retry')
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].credentials, 'same-origin')
    assert.equal(calls[0].headers.get('x-csrf-token'), 'synthetic-csrf')
    assert.deepEqual(JSON.parse(calls[0].body), input)
    assert.equal(calls[0].headers.get('idempotency-key'), calls[1].headers.get('idempotency-key'))
    assert.notEqual(
      calls[1].headers.get('idempotency-key'),
      calls[2].headers.get('idempotency-key'),
    )
    assert.notEqual(
      calls[2].headers.get('idempotency-key'),
      calls[3].headers.get('idempotency-key'),
    )
  } finally {
    global.fetch = originalFetch
    setCsrfToken(null)
  }
})

test('retry rejects malformed output; 409 and lost response retain intent for explicit retry', async () => {
  const originalFetch = global.fetch
  const input = { expected_revision: 2, reason: 'Retry provider failure' },
    keys = new MutationKey()
  try {
    for (const output of [
      null,
      [],
      {},
      { revision: 0, job: { id: 'a', state: 'queued' } },
      { revision: '3', job: { id: 'a', state: 'queued' } },
      { revision: 3 },
      { revision: 3, job: { state: 'queued' } },
      { revision: 3, job: { id: 'a', state: 'succeeded' } },
    ]) {
      global.fetch = async () => Response.json(output)
      await assert.rejects(
        documentsApi.retry('job-1', input, keys),
        (error) => error.code === 'INVALID_API_RESPONSE',
      )
    }
    const delivered = []
    global.fetch = async (_url, options) => {
      delivered.push(options.headers.get('idempotency-key'))
      if (delivered.length === 1) throw new Error('Lost response')
      return Response.json({ code: 'REVISION_CONFLICT', message: 'Conflict' }, { status: 409 })
    }
    await assert.rejects(
      documentsApi.retry('job-1', input, keys),
      (error) => error.code === 'NETWORK_ERROR',
    )
    assert.equal(delivered.length, 1)
    await assert.rejects(
      documentsApi.retry('job-1', input, keys),
      (error) => error.status === 409 && error.code === 'REVISION_CONFLICT',
    )
    assert.equal(delivered.length, 2)
    assert.equal(delivered[0], delivered[1])
  } finally {
    global.fetch = originalFetch
  }
})

test('retry reason and conflict recovery copy is available in en/vi/zh-CN', () => {
  for (const key of ['retry', 'reason', 'conflict', 'refresh', 'keepEditing', 'working', 'save']) {
    const labels = ['en', 'vi', 'zh-CN'].map((locale) => translate(locale, key))
    assert.ok(
      labels.every((label) => typeof label === 'string' && label.length > 0 && label !== key),
    )
    assert.equal(new Set(labels).size, 3)
  }
})
