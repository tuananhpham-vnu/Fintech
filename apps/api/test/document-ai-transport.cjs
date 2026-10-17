const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { once } = require('node:events')
const { performance } = require('node:perf_hooks')
const { test } = require('node:test')
const { inspect: format } = require('node:util')
const {
  DocumentAiTransport,
  DocumentAiError,
} = require('../dist/ai-adapters/document-ai-transport.js')
const { FoundationError } = require('../dist/foundation/errors.js')

// These are synthetic canonical examples served by disposable native HTTP
// servers. A server's X-AI-Mode label is NOT evidence of actual live AI.
const contractsDirectory = path.resolve(__dirname, '../../../packages/contracts')
const examples = JSON.parse(readFileSync(path.join(contractsDirectory, 'examples.json'), 'utf8'))
const sample = (name) => structuredClone(examples.find((example) => example.schema === name).value)
const inspectRequest = sample('InspectionInput')
const inspectBody = sample('InspectionOutput')
const extractBody = sample('ExtractionOutput')
const attempt = {
  storageKey: 'synthetic/private.pdf',
  documentId: extractBody.document_id,
  caseId: extractBody.case_id,
  type: extractBody.detected_type,
  sha256: extractBody.sha256,
}
const otherId = '00000000-0000-4000-8000-000000000001'
const secret = 'synthetic-private-key-DO-NOT-EXPOSE'
const sentinel = 'RAW-PRIVATE-RESPONSE-DO-NOT-EXPOSE'
const types = [
  'registration',
  'loan_request',
  'financial_statement',
  'contract',
  'acceptance_record',
  'payment_record',
  'invoice',
  'other',
]

function options(baseURL, extra = {}) {
  return { baseURL, internalKey: secret, expectedMode: 'mock', contractsDirectory, ...extra }
}
function inspect(transport) {
  return transport.inspect(inspectRequest.storage_key, inspectRequest.sha256)
}

test('archive inspect uses the remaining batch deadline without extending its configured ceiling', async (t) => {
  const endpoint = await server(t, async () => {})
  const transport = new DocumentAiTransport(options(endpoint.baseURL, { inspectTimeoutMs: 5000 }))
  const start = performance.now()
  await rejects(transport.inspect(inspectRequest.storage_key, inspectRequest.sha256, 75), 'AI_TIMEOUT', 504, true)
  assert.ok(performance.now() - start < 1500, 'Remaining deadline bounds stalled inspection')
  const bounded = new DocumentAiTransport(options(endpoint.baseURL, { inspectTimeoutMs: 75 }))
  const second = performance.now()
  await rejects(bounded.inspect(inspectRequest.storage_key, inspectRequest.sha256, 5000), 'AI_TIMEOUT', 504, true)
  assert.ok(performance.now() - second < 1500, 'A caller cannot extend the configured ceiling')
})
function json(res, body, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'X-AI-Mode': 'mock', ...headers })
  res.end(JSON.stringify(body))
}
function errorBody(code) {
  return {
    error: {
      code,
      message: sentinel,
      request_id: otherId,
      details: [{ path: '/private', message: sentinel }],
    },
  }
}
async function rejects(promise, code, statusCode = 502, retryable = false) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof DocumentAiError)
    assert.equal(error instanceof FoundationError, false)
    assert.equal(error.code, code)
    assert.equal(error.statusCode, statusCode)
    assert.equal(error.retryable, retryable)
    assert.equal(error.message, code)
    assert.equal('cause' in error, false)
    assert.doesNotMatch(format(error), new RegExp(`${secret}|${sentinel}`))
    assert.doesNotMatch(JSON.stringify(error), new RegExp(`${secret}|${sentinel}`))
    return true
  })
}

async function server(t, handler) {
  const requests = [],
    failures = []
  const instance = http.createServer(async (req, res) => {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const request = {
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }
      requests.push(request)
      await handler(request, res)
    } catch (error) {
      failures.push(error)
      res.destroy()
    }
  })
  instance.listen(0, '127.0.0.1')
  await once(instance, 'listening')
  const baseURL = `http://127.0.0.1:${instance.address().port}`
  async function close() {
    if (!instance.listening) return
    await new Promise((resolve, reject) => {
      instance.close((error) => (error ? reject(error) : resolve()))
      instance.closeAllConnections()
    })
  }
  t.after(async () => {
    await close()
    assert.deepEqual(failures, [])
  })
  return { baseURL, requests, close }
}

test('inspect sends actual canonical POST/key and projects only the DocumentInspector port', async (t) => {
  const host = await server(t, (request, res) => json(res, inspectBody))
  const transport = new DocumentAiTransport(options(`${host.baseURL}/`))
  assert.deepEqual(await inspect(transport), {
    sha256: inspectBody.sha256,
    page_count: inspectBody.page_count,
    byte_size: inspectBody.byte_size,
    encrypted: inspectBody.encrypted,
    has_embedded_files: inspectBody.has_embedded_files,
    mode: 'mock',
  })
  assert.equal(host.requests.length, 1)
  assert.equal(host.requests[0].url, '/internal/v1/inspect')
  assert.equal(host.requests[0].method, 'POST')
  assert.equal(host.requests[0].headers['x-internal-key'], secret)
  assert.equal(host.requests[0].headers['content-type'], 'application/json')
  assert.deepEqual(host.requests[0].body, inspectRequest)
  assert.equal(JSON.stringify(transport), '{}')
  assert.doesNotMatch(format(transport), new RegExp(secret))
})

test('extract returns the full validated 1.0.2 body and separate mode without fabricated fields', async (t) => {
  const original = structuredClone(extractBody)
  const host = await server(t, (request, res) => json(res, original))
  const transport = new DocumentAiTransport(options(host.baseURL))
  const input = { ...attempt, jobId: otherId, fence: 42, bytes: Buffer.from('not sent') }
  const result = await transport.extract(input)
  assert.deepEqual(result, { body: original, mode: 'mock', orchestrationBinding: 'pending' })
  assert.equal('mode' in result.body, false)
  assert.equal('owner_party_ref' in result.body, false)
  assert.deepEqual(extractBody, original)
  assert.deepEqual(host.requests[0].body, {
    schema_version: '1.0.2',
    storage_key: attempt.storageKey,
    document_id: attempt.documentId,
    case_id: attempt.caseId,
    type: attempt.type,
    sha256: attempt.sha256,
  })
  assert.equal(host.requests[0].url, '/internal/v1/extract')
})

test('all eight canonical declared types are sent unchanged; detected type may differ', async (t) => {
  const host = await server(t, (request, res) => json(res, extractBody))
  const transport = new DocumentAiTransport(options(host.baseURL))
  for (const type of types) {
    const result = await transport.extract({ ...attempt, type })
    assert.equal(result.body.detected_type, extractBody.detected_type)
  }
  assert.deepEqual(
    host.requests.map((request) => request.body.type),
    types,
  )
})

test('unsupported types and malformed requests fail before making any HTTP request', async (t) => {
  const host = await server(t, (request, res) => json(res, extractBody))
  const transport = new DocumentAiTransport(options(host.baseURL))
  for (const type of [
    'financials',
    'acceptance',
    'contract.pdf',
    'REGISTRATION',
    '',
    null,
    undefined,
  ])
    await rejects(transport.extract({ ...attempt, type }), 'AI_UNSUPPORTED_DOCUMENT_TYPE', 400)
  await rejects(transport.extract(null), 'AI_INVALID_REQUEST', 400)
  for (const change of [
    { documentId: 'not-a-uuid' },
    { caseId: 5 },
    { storageKey: null },
    { sha256: 'A'.repeat(64) },
  ])
    await rejects(transport.extract({ ...attempt, ...change }), 'AI_INVALID_REQUEST', 400)
  await rejects(transport.inspect(null, inspectRequest.sha256), 'AI_INVALID_REQUEST', 400)
  await rejects(transport.inspect('synthetic.pdf', 'bad-hash'), 'AI_INVALID_REQUEST', 400)
  assert.equal(host.requests.length, 0)
})

test('constructor rejects missing/unsafe configuration and invalid explicit limits', () => {
  const good = options('http://127.0.0.1:1')
  for (const extra of [
    { expectedMode: undefined },
    { expectedMode: 'auto' },
    { expectedMode: 'LIVE' },
    { internalKey: '' },
    { internalKey: '\r\n' },
    { internalKey: ' key ' },
    { baseURL: `${sentinel}://invalid` },
    { baseURL: 'file:///private' },
    { baseURL: 'http://user:password@localhost' },
    { baseURL: 'http://localhost?secret' },
    { baseURL: 'http://localhost#private' },
    { contractsDirectory: '' },
    ...['inspectTimeoutMs', 'extractTimeoutMs', 'maxResponseBytes'].flatMap((key) =>
      [0, -1, NaN, Infinity, 1.5, null].map((value) => ({ [key]: value })),
    ),
    { inspectTimeoutMs: 2_147_483_648 },
    { extractTimeoutMs: 2_147_483_648 },
  ]) {
    assert.throws(
      () => new DocumentAiTransport({ ...good, ...extra }),
      (error) => {
        assert.ok(error instanceof DocumentAiError)
        assert.equal(error.code, 'AI_INVALID_CONFIG')
        assert.equal(error.statusCode, 500)
        assert.equal(error.retryable, false)
        assert.doesNotMatch(format(error), new RegExp(`${secret}|${sentinel}`))
        return true
      },
    )
  }
})

test('missing or noncanonical contract directory fails closed with a sanitized configuration error', () => {
  for (const directory of [
    path.join(contractsDirectory, 'absent-private-directory'),
    path.join(contractsDirectory, 'aic-foundation'),
  ]) {
    assert.throws(
      () =>
        new DocumentAiTransport(options('http://127.0.0.1:1', { contractsDirectory: directory })),
      (error) => {
        assert.ok(error instanceof DocumentAiError)
        assert.equal(error.code, 'AI_INVALID_CONTRACT_BUNDLE')
        assert.equal(error.statusCode, 500)
        assert.equal(error.retryable, false)
        assert.equal('cause' in error, false)
        assert.doesNotMatch(error.message, /directory|ENOENT/)
        return true
      },
    )
  }
})

test('synthetic live header is accepted only with explicit live binding, for both operations', async (t) => {
  const host = await server(t, (request, res) =>
    json(res, request.url.endsWith('/inspect') ? inspectBody : extractBody, 200, {
      'X-AI-Mode': 'live',
    }),
  )
  const transport = new DocumentAiTransport(options(host.baseURL, { expectedMode: 'live' }))
  assert.equal((await inspect(transport)).mode, 'live')
  assert.equal((await transport.extract(attempt)).mode, 'live')
})

for (const [label, header, expectedMode] of [
  ['missing', undefined, 'mock'],
  ['unknown', 'auto', 'mock'],
  ['wrong live binding', 'mock', 'live'],
  ['wrong mock binding', 'live', 'mock'],
  ['case changed', 'MOCK', 'mock'],
  ['duplicate same', ['mock', 'mock'], 'mock'],
  ['duplicate conflicting', ['mock', 'live'], 'mock'],
]) {
  test(`raw mode ${label} is rejected without fallback`, async (t) => {
    const host = await server(t, (request, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        ...(header === undefined ? {} : { 'X-AI-Mode': header }),
      })
      res.end(JSON.stringify(extractBody))
    })
    await rejects(
      new DocumentAiTransport(options(host.baseURL, { expectedMode })).extract(attempt),
      'AI_MODE_MISMATCH',
    )
    assert.equal(host.requests.length, 1)
  })
}

for (const [label, operation, change] of [
  [
    'inspection hash',
    'inspect',
    (body) => {
      body.sha256 = 'a'.repeat(64)
    },
  ],
  [
    'extraction hash',
    'extract',
    (body) => {
      body.sha256 = 'a'.repeat(64)
    },
  ],
  [
    'document echo',
    'extract',
    (body) => {
      body.document_id = otherId
    },
  ],
  [
    'case echo',
    'extract',
    (body) => {
      body.case_id = otherId
    },
  ],
  [
    'noncontiguous pages',
    'extract',
    (body) => {
      body.pages[0].page = 2
    },
  ],
  [
    'foreign evidence',
    'extract',
    (body) => {
      body.evidence[0].document_id = otherId
    },
  ],
  [
    'nonexistent evidence page',
    'extract',
    (body) => {
      body.evidence[0].page = 2
    },
  ],
  [
    'duplicate evidence',
    'extract',
    (body) => {
      body.evidence.push(structuredClone(body.evidence[0]))
    },
  ],
  [
    'foreign field',
    'extract',
    (body) => {
      body.fields[0].document_id = otherId
    },
  ],
  [
    'missing field evidence',
    'extract',
    (body) => {
      body.fields[0].evidence_ids = [otherId]
    },
  ],
]) {
  test(`${label} fails canonical content/source validation`, async (t) => {
    const body = structuredClone(operation === 'inspect' ? inspectBody : extractBody)
    change(body)
    const host = await server(t, (request, res) => json(res, body))
    const transport = new DocumentAiTransport(options(host.baseURL))
    await rejects(
      operation === 'inspect' ? inspect(transport) : transport.extract(attempt),
      'AI_CONTENT_MISMATCH',
    )
  })
}

for (const [label, change] of [
  [
    'extra public field',
    (body) => {
      body.owner_party_ref = 'verified'
    },
  ],
  [
    'fake body mode',
    (body) => {
      body.mode = 'mock'
    },
  ],
  [
    'old schema version',
    (body) => {
      body.schema_version = '1.0.1'
    },
  ],
  [
    'invalid page count',
    (body) => {
      body.page_count = 0
    },
  ],
  [
    'string page count',
    (body) => {
      body.page_count = '1'
    },
  ],
  [
    'missing embedded-file flag',
    (body) => {
      delete body.has_embedded_files
    },
  ],
]) {
  test(`${label} is rejected without repairing the payload`, async (t) => {
    const body = structuredClone(inspectBody)
    change(body)
    const host = await server(t, (request, res) => json(res, body))
    await rejects(inspect(new DocumentAiTransport(options(host.baseURL))), 'AI_INVALID_RESPONSE')
  })
}

for (const [label, bytes, contentType] of [
  ['HTML', Buffer.from(`<html>${sentinel}</html>`), 'text/html'],
  ['invalid JSON', Buffer.from(`{${sentinel}`), 'application/json'],
  ['trailing JSON', Buffer.from(`${JSON.stringify(inspectBody)} {}`), 'application/json'],
  ['invalid UTF-8', Buffer.from([0xff]), 'application/json'],
  [
    'JSON BOM',
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(inspectBody))]),
    'application/json',
  ],
  ['wrong charset', Buffer.from(JSON.stringify(inspectBody)), 'application/json; charset=latin1'],
  [
    'duplicate content type',
    Buffer.from(JSON.stringify(inspectBody)),
    ['application/json', 'application/json'],
  ],
]) {
  test(`${label} from actual HTTP fails safe response capture`, async (t) => {
    const host = await server(t, (request, res) => {
      res.writeHead(200, { 'Content-Type': contentType, 'X-AI-Mode': 'mock' })
      res.end(bytes)
    })
    await rejects(inspect(new DocumentAiTransport(options(host.baseURL))), 'AI_INVALID_RESPONSE')
  })
}

test('200 is required even when another 2xx status carries valid JSON', async (t) => {
  const host = await server(t, (request, res) => json(res, inspectBody, 201))
  await rejects(inspect(new DocumentAiTransport(options(host.baseURL))), 'AI_HTTP_ERROR')
})

test('redirects are not followed and internal credentials reach only the requested server', async (t) => {
  const destination = await server(t, (request, res) => json(res, inspectBody))
  const host = await server(t, (request, res) => {
    res.writeHead(307, { Location: `${destination.baseURL}/internal/v1/inspect` })
    res.end()
  })
  await rejects(inspect(new DocumentAiTransport(options(host.baseURL))), 'AI_HTTP_ERROR')
  assert.equal(host.requests.length, 1)
  assert.equal(destination.requests.length, 0)
})

for (const [status, code, retryable] of [
  [403, 'FORBIDDEN', false],
  [404, 'PDF_NOT_FOUND', false],
  [413, 'PDF_TOO_LARGE', false],
  [422, 'SHA256_MISMATCH', false],
  [422, 'INVALID_MODEL_OUTPUT', false],
  [503, 'PROVIDER_UNAVAILABLE', true],
  [500, 'INTERNAL_ERROR', true],
]) {
  test(`canonical error ${status}/${code} keeps only fixed code/status/retryability`, async (t) => {
    const host = await server(t, (request, res) => json(res, errorBody(code), status))
    await rejects(inspect(new DocumentAiTransport(options(host.baseURL))), code, status, retryable)
    assert.equal(host.requests.length, 1)
  })
}

for (const [label, body, contentType, status] of [
  ['unknown code', errorBody(sentinel), 'application/json', 422],
  ['invalid envelope', { code: 'SHA256_MISMATCH', message: sentinel }, 'application/json', 422],
  [
    'invalid error UUID',
    { error: { ...errorBody('FORBIDDEN').error, request_id: 'invalid' } },
    'application/json',
    403,
  ],
  [
    'extra error properties',
    { ...errorBody('FORBIDDEN'), secret: sentinel },
    'application/json',
    403,
  ],
  ['non-JSON error', sentinel, 'text/html', 503],
  ['malformed JSON error', sentinel, 'application/json', 500],
  ['rate limit', {}, 'application/json', 429],
  ['request timeout', {}, 'application/json', 408],
]) {
  test(`${label} maps to a fixed sanitized HTTP error`, async (t) => {
    const host = await server(t, (request, res) => {
      res.writeHead(status, { 'Content-Type': contentType })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    })
    await rejects(
      inspect(new DocumentAiTransport(options(host.baseURL))),
      'AI_HTTP_ERROR',
      status,
      status >= 500 || status === 429 || status === 408,
    )
  })
}

test('delivered-byte limit accepts the exact success size and rejects one byte less', async (t) => {
  const bytes = Buffer.from(JSON.stringify(extractBody))
  const host = await server(t, (request, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-AI-Mode': 'mock' })
    // Native chunked HTTP, with multibyte Vietnamese text in the fixture.
    res.write(bytes.subarray(0, 99))
    res.end(bytes.subarray(99))
  })
  assert.deepEqual(
    (
      await new DocumentAiTransport(
        options(host.baseURL, { maxResponseBytes: bytes.length }),
      ).extract(attempt)
    ).body,
    extractBody,
  )
  await rejects(
    new DocumentAiTransport(options(host.baseURL, { maxResponseBytes: bytes.length - 1 })).extract(
      attempt,
    ),
    'AI_RESPONSE_TOO_LARGE',
  )
})

test('oversized chunked error bodies are bounded by the same response limit', async (t) => {
  const host = await server(t, (request, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.write(' '.repeat(64))
    res.end(JSON.stringify(errorBody('PROVIDER_UNAVAILABLE')))
  })
  await rejects(
    inspect(new DocumentAiTransport(options(host.baseURL, { maxResponseBytes: 64 }))),
    'AI_RESPONSE_TOO_LARGE',
  )
})

test('unreachable loopback service yields one sanitized retryable failure with no fallback', async (t) => {
  const host = await server(t, (request, res) => json(res, inspectBody))
  await host.close()
  await rejects(
    inspect(new DocumentAiTransport(options(host.baseURL))),
    'AI_SERVICE_UNAVAILABLE',
    503,
    true,
  )
  assert.equal(host.requests.length, 0)
})

test('truncated HTTP success body fails safely', async (t) => {
  const host = await server(t, (request, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-AI-Mode': 'mock',
      'Content-Length': '99999',
      Connection: 'close',
    })
    res.write('{')
    res.end()
  })
  await rejects(inspect(new DocumentAiTransport(options(host.baseURL))), 'AI_INVALID_RESPONSE')
})

test('deadline covers waiting for response headers', async (t) => {
  const host = await server(t, () => {})
  await rejects(
    inspect(new DocumentAiTransport(options(host.baseURL, { inspectTimeoutMs: 100 }))),
    'AI_TIMEOUT',
    504,
    true,
  )
  assert.equal(host.requests.length, 1)
})

for (const operation of ['inspect', 'extract']) {
  test(`${operation} deadline covers a stalled success body`, async (t) => {
    const host = await server(t, (request, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-AI-Mode': 'mock' })
      res.flushHeaders()
      res.write('{')
    })
    const transport = new DocumentAiTransport(
      options(host.baseURL, {
        inspectTimeoutMs: operation === 'inspect' ? 100 : 5000,
        extractTimeoutMs: operation === 'extract' ? 100 : 5000,
      }),
    )
    await rejects(
      operation === 'inspect' ? inspect(transport) : transport.extract(attempt),
      'AI_TIMEOUT',
      504,
      true,
    )
  })
}

test('deadline also covers a stalled canonical error body', async (t) => {
  const host = await server(t, (request, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.flushHeaders()
    res.write('{')
  })
  await rejects(
    inspect(new DocumentAiTransport(options(host.baseURL, { inspectTimeoutMs: 100 }))),
    'AI_TIMEOUT',
    504,
    true,
  )
})

test('headers consume the same budget as body capture; the deadline never resets', async (t) => {
  const host = await server(t, (request, res) => {
    const first = setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-AI-Mode': 'mock' })
      res.flushHeaders()
    }, 200)
    const last = setTimeout(() => res.end(JSON.stringify(inspectBody)), 600)
    res.on('close', () => {
      clearTimeout(first)
      clearTimeout(last)
    })
  })
  const transport = new DocumentAiTransport(options(host.baseURL, { inspectTimeoutMs: 500 }))
  const started = performance.now()
  await rejects(inspect(transport), 'AI_TIMEOUT', 504, true)
  assert.ok(performance.now() - started < 1500)
})

test('trickling chunks do not renew either success or error deadlines', async (t) => {
  for (const status of [200, 503]) {
    const host = await server(t, (request, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'X-AI-Mode': 'mock' })
      res.flushHeaders()
      const timer = setInterval(() => res.write(' '), 20)
      res.on('close', () => clearInterval(timer))
    })
    await rejects(
      inspect(new DocumentAiTransport(options(host.baseURL, { inspectTimeoutMs: 130 }))),
      'AI_TIMEOUT',
      504,
      true,
    )
  }
})

test('caller mutations cannot change constructor mode/limits or in-flight attempt bindings', async (t) => {
  const host = await server(t, (request, res) => json(res, extractBody))
  const config = options(host.baseURL)
  const transport = new DocumentAiTransport(config)
  config.expectedMode = 'live'
  config.internalKey = 'changed'
  config.maxResponseBytes = 1
  const input = structuredClone(attempt)
  const pending = transport.extract(input)
  input.documentId = otherId
  input.sha256 = 'a'.repeat(64)
  assert.deepEqual((await pending).body, extractBody)
  assert.equal(host.requests[0].headers['x-internal-key'], secret)
  assert.equal(host.requests[0].body.document_id, attempt.documentId)
})
