const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { test } = require('node:test')
// Compiled TS and genuine WHATWG primitives only; no fetch, servers or AI calls.
const {
  captureLegacyAiResponse,
  LegacyAiResponseCaptureError,
} = require('../dist/ai-adapters/raw-response.js')
const {
  createLegacyAiValidationBoundary,
  LegacyAiValidationError,
} = require('../dist/ai-adapters/legacy-validation.js')

const contractDir = path.resolve(__dirname, '../../../packages/contracts')
const sha256sums = readFileSync(path.join(contractDir, 'SHA256SUMS'), 'utf8')
const boundary = createLegacyAiValidationBoundary({
  version: readFileSync(path.join(contractDir, 'VERSION'), 'utf8'),
  sha256sums,
  files: Object.fromEntries(sha256sums.trim().split(/\r?\n/).map((line) => {
    const name = line.split(/\s+/)[1]
    return [name, readFileSync(path.join(contractDir, name))]
  })),
})
const examples = JSON.parse(readFileSync(path.join(contractDir, 'examples.json'), 'utf8'))
const sample = (schema) => structuredClone(examples.find((e) => e.schema === schema).value)
const sentinel = 'PRIVATE_SYNTHETIC_SECRET'
const jsonHeaders = { 'content-type': 'application/json', 'x-ai-mode': 'mock' }

function inspection() {
  return { operation: 'inspect', request: sample('InspectionInput'), body: sample('InspectionOutput') }
}
function extraction() {
  const body = sample('ExtractionOutput')
  return {
    operation: 'extract', body,
    request: {
      schema_version: '1.0.2', document_id: body.document_id, case_id: body.case_id,
      sha256: body.sha256, type: body.detected_type, storage_key: 'synthetic/capture.pdf',
    },
  }
}
function options(response, exchange = inspection(), overrides = {}) {
  return {
    boundary, response, operation: exchange.operation, request: exchange.request,
    expectedMode: 'mock', maxBytes: 65536, readTimeoutMs: 1000, ...overrides,
  }
}
function responseFor(body, headers = jsonHeaders) {
  return new Response(JSON.stringify(body), { status: 200, headers })
}
function source(chunks, { headers = jsonHeaders, status = 200, stall = false, cancel, error } = {}) {
  const state = { pulls: 0, cancellations: 0, reasons: [] }
  let index = 0
  const stream = new ReadableStream({
    pull(controller) {
      state.pulls++
      if (index < chunks.length) controller.enqueue(chunks[index++])
      else if (error) controller.error(error)
      else if (!stall) controller.close()
    },
    cancel(reason) {
      state.cancellations++
      state.reasons.push(reason)
      return cancel?.()
    },
  }, { highWaterMark: 0 })
  return { response: new Response(stream, { status, headers }), state, stream }
}
function sanitized(error) {
  for (const text of [String(error), error.stack, JSON.stringify(error)])
    assert.equal(text.includes(sentinel), false)
  for (const key of ['cause', 'body', 'payload', 'request', 'response', 'url', 'headers'])
    assert.equal(Object.hasOwn(error, key), false)
}
async function rejectsCapture(input, code) {
  await assert.rejects(captureLegacyAiResponse(input), (error) => {
    assert.ok(error instanceof LegacyAiResponseCaptureError)
    assert.equal(error.code, code)
    assert.equal(error.message, `Legacy AI response capture failed: ${code}`)
    assert.deepEqual(Object.keys(error).sort(), ['code', 'name'])
    sanitized(error)
    return true
  })
}
async function rejectsValidation(input, code, expectedPath) {
  await assert.rejects(captureLegacyAiResponse(input), (error) => {
    assert.ok(error instanceof LegacyAiValidationError)
    assert.equal(error.code, code)
    assert.ok(error.violations.some((v) => v.path === expectedPath))
    sanitized(error)
    return true
  })
}

test('bytewise UTF-8 capture preserves the actual extraction body and delegates unchanged bindings', async () => {
  const exchange = extraction()
  exchange.body.pages[0].text = 'Nguồn tổng hợp 🧾\nSYNTHETIC'
  exchange.body.evidence[0].quote = 'Nguồn tổng hợp 🧾'
  exchange.body.evidence[0].bbox = [0.1, 0.2, 0.8, 0.9]
  exchange.body.evidence[0].precision = 'bbox'
  exchange.body.diagnostics = [
    { code: 'SYNTHETIC', message: 'Cần kiểm tra 🧾\nnguyên văn', document_id: null, field_key: null },
    { code: 'OTHER', message: '', document_id: '00000000-0000-4000-8000-000000000099', field_key: 'extension.key' },
  ]
  exchange.body.provenance = {
    model_id: 'synthetic-model', prompt_version: '', ocr_version: '', schema_version: '1.0.2',
  }
  const before = structuredClone(exchange)
  const bytes = Buffer.from(JSON.stringify(exchange.body))
  assert.ok(bytes.length > JSON.stringify(exchange.body).length)
  const { response, state } = source(Array.from(bytes, (b) => Uint8Array.of(b)))
  let captured, delegated
  const observer = { validate(value) { captured = value; return (delegated = boundary.validate(value)) } }
  const result = await captureLegacyAiResponse(options(response, exchange, {
    boundary: observer, maxBytes: bytes.length,
  }))
  assert.strictEqual(result, delegated)
  assert.strictEqual(result.body, captured.body)
  assert.strictEqual(result.body.provenance, captured.body.provenance)
  assert.strictEqual(result.body.diagnostics, captured.body.diagnostics)
  assert.strictEqual(captured.request, exchange.request)
  assert.equal(captured.operation, exchange.operation)
  assert.equal(captured.expectedMode, 'mock')
  assert.deepEqual(captured.headers, { 'x-ai-mode': 'mock' })
  assert.deepEqual(result, { body: before.body, mode: 'mock', orchestrationBinding: 'pending' })
  assert.equal(Object.hasOwn(result.body, 'mode'), false)
  assert.equal(response.bodyUsed, true)
  assert.equal(response.body.locked, false)
  assert.equal(state.cancellations, 0)
  assert.deepEqual(exchange, before)
})

test('ordinary WHATWG Response accepts inspection and explicit live label without a live service', async () => {
  const exchange = inspection()
  const response = responseFor(exchange.body, { 'Content-Type': 'application/json', 'X-AI-Mode': 'live' })
  const result = await captureLegacyAiResponse(options(response, exchange, { expectedMode: 'live' }))
  assert.deepEqual(result.body, exchange.body)
  assert.equal(result.mode, 'live')
})

test('plain response lookalikes and forged Response prototypes are rejected without invoking json', async () => {
  let calls = 0
  const fake = { status: 200, headers: new Headers(jsonHeaders), json() { calls++; throw Error(sentinel) } }
  for (const response of [fake, Object.create(Response.prototype), null, {}])
    await rejectsCapture(options(response), 'INVALID_RESPONSE')
  assert.equal(calls, 0)
})

test('both explicit limits require positive safe integers and deadline respects the native timer range', async () => {
  for (const key of ['maxBytes', 'readTimeoutMs']) {
    for (const value of [undefined, null, 0, -1, 0.5, NaN, Infinity, -Infinity, '100', 2 ** 53]) {
      const { response, state } = source([], { stall: true })
      await rejectsCapture(options(response, undefined, { [key]: value }), 'INVALID_CAPTURE_CONFIG')
      assert.equal(response.bodyUsed, false)
      assert.equal(state.pulls, 0)
      assert.equal(state.cancellations, 0)
    }
  }
  await rejectsCapture(options(responseFor(inspection().body), undefined, { readTimeoutMs: 2_147_483_648 }), 'INVALID_CAPTURE_CONFIG')
  await rejectsCapture(undefined, 'INVALID_CAPTURE_CONFIG')
  await rejectsCapture(options(responseFor(inspection().body), undefined, { boundary: {} }), 'INVALID_CAPTURE_CONFIG')
  const result = await captureLegacyAiResponse(options(responseFor(inspection().body), undefined, {
    maxBytes: Number.MAX_SAFE_INTEGER, readTimeoutMs: 2_147_483_647,
  }))
  assert.deepEqual(result.body, inspection().body)
})

test('application/json permits case-insensitive optional UTF-8 charset and HTTP whitespace', async () => {
  for (const contentType of ['application/json', 'Application/JSON', 'application/json; charset=utf-8',
    'APPLICATION/JSON ; CHARSET="UTF-8"', 'application/json;\tcharset = utf-8\t']) {
    const exchange = inspection()
    const result = await captureLegacyAiResponse(options(responseFor(exchange.body, {
      ...jsonHeaders, 'content-type': contentType,
    }), exchange))
    assert.deepEqual(result.body, exchange.body)
  }
})

test('missing, non-contract, malformed, extra and duplicate Content-Type parameters fail before reading', async () => {
  for (const contentType of [null, '', 'text/json', 'text/plain', 'application/problem+json',
    'application/jsonp', 'application/json; charset=latin1', 'application/json; charset=utf8',
    'application/json; charset="utf-8', 'application/json; charset=utf-8; charset=utf-8',
    'application/json; profile=synthetic', 'application/json;', 'application/json, application/json']) {
    const headers = new Headers(jsonHeaders)
    if (contentType === null) headers.delete('content-type')
    else headers.set('content-type', contentType)
    const { response, state } = source([], { headers, stall: true })
    await rejectsCapture(options(response), 'INVALID_CONTENT_TYPE')
    assert.equal(state.pulls, 0)
    assert.equal(state.cancellations, 1)
    assert.deepEqual(state.reasons, [undefined])
  }
})

test('native Headers joined equal Content-Type duplicates are rejected', async () => {
  const headers = new Headers(jsonHeaders)
  headers.append('Content-Type', 'application/json')
  assert.equal(headers.get('content-type'), 'application/json, application/json')
  await rejectsCapture(options(responseFor(inspection().body, headers)), 'INVALID_CONTENT_TYPE')
})

test('only status 200 is accepted and rejected status bodies are cancelled without reading or leaking', async () => {
  for (const status of [201, 202, 206, 301, 400, 500]) {
    const { response, state } = source([Buffer.from(sentinel)], { status, stall: true })
    Object.defineProperty(response, 'url', { value: `https://synthetic.invalid/${sentinel}` })
    await rejectsCapture(options(response), 'UNEXPECTED_STATUS')
    assert.equal(state.pulls, 0)
    assert.equal(state.cancellations, 1)
    assert.deepEqual(state.reasons, [undefined])
  }
  await rejectsCapture(options(new Response(null, { status: 204 })), 'UNEXPECTED_STATUS')
})

test('joined equal X-AI-Mode duplicates reach and are rejected by the existing validator', async () => {
  const headers = new Headers(jsonHeaders)
  headers.append('X-AI-Mode', 'mock')
  assert.equal(headers.get('x-ai-mode'), 'mock, mock')
  await rejectsValidation(options(responseFor(inspection().body, headers)), 'UNSUPPORTED_MODE', '/headers/x-ai-mode')
})

test('missing mode and body claims cannot supply or override the authoritative header binding', async () => {
  const exchange = inspection()
  exchange.body.mode = 'mock'
  await rejectsValidation(options(responseFor(exchange.body, { 'content-type': 'application/json' }), exchange),
    'UNSUPPORTED_MODE', '/headers/x-ai-mode')
  await rejectsValidation(options(responseFor(exchange.body, { ...jsonHeaders, 'x-ai-mode': 'live' }), exchange),
    'MODE_MISMATCH', '/headers/x-ai-mode')
  await rejectsValidation(options(responseFor(inspection().body), undefined, { expectedMode: undefined }),
    'UNSUPPORTED_MODE', '/expectedMode')
})

test('body transport metadata and unexpected nested keys are not stripped before canonical validation', async () => {
  for (const mutate of [
    (body) => { body.mode = 'mock' },
    (body) => { body[sentinel] = sentinel },
    (body) => { body.provenance[sentinel] = sentinel },
  ]) {
    const exchange = extraction()
    mutate(exchange.body)
    await rejectsValidation(options(responseFor(exchange.body), exchange), 'INVALID_LEGACY_RESPONSE',
      Object.hasOwn(exchange.body.provenance, sentinel) ? '/body/provenance' : '/body')
  }
})

test('caller operation and request source remain authoritative through capture', async () => {
  const exchange = inspection()
  exchange.request.sha256 = exchange.body.sha256 === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64)
  await rejectsValidation(options(responseFor(exchange.body), exchange), 'SOURCE_MISMATCH', '/body/sha256')
  await rejectsValidation(options(responseFor(exchange.body), exchange, { operation: 'evaluate' }),
    'UNSUPPORTED_OPERATION', '/operation')
})

test('malformed UTF-8 is rejected immediately and cancels an unfinished stream', async () => {
  for (const chunks of [
    [Buffer.from('{"x":"'), Uint8Array.of(0xc3), Uint8Array.of(0x28)],
    [Uint8Array.of(0xc0, 0xaf)],
    [Uint8Array.of(0xed, 0xa0, 0x80)],
  ]) {
    const { response, state } = source(chunks, { stall: true })
    await rejectsCapture(options(response), 'INVALID_UTF8')
    assert.equal(state.cancellations, 1)
    assert.equal(response.body.locked, false)
  }
})

test('truncated UTF-8 at end of stream fails the decoder flush', async () => {
  const { response } = source([Buffer.from('{"x":"'), Uint8Array.of(0xf0, 0x9f)])
  await rejectsCapture(options(response), 'INVALID_UTF8')
  assert.equal(response.body.locked, false)
})

test('strict JSON rejects truncation, trailing data, empty input, BOM and non-JSON syntax without parser leakage', async () => {
  for (const text of ['', `{"${sentinel}":`, '{"x":1,}', '{} {}', 'NaN', '\ufeff{}', '{/*comment*/}']) {
    const { response } = source([Buffer.from(text)])
    await rejectsCapture(options(response), 'INVALID_JSON')
    assert.equal(response.body.locked, false)
  }
})

test('exact byte cap succeeds despite a dishonest Content-Length and one extra byte fails', async () => {
  const exchange = inspection()
  const bytes = Buffer.from(JSON.stringify(exchange.body))
  for (const length of ['1', '999999999']) {
    const result = await captureLegacyAiResponse(options(responseFor(exchange.body, {
      ...jsonHeaders, 'content-length': length,
    }), exchange, { maxBytes: bytes.length }))
    assert.deepEqual(result.body, exchange.body)
  }
  const { response, state } = source([bytes, Buffer.from(' ')], { stall: true })
  await rejectsCapture(options(response, exchange, { maxBytes: bytes.length }), 'BODY_TOO_LARGE')
  assert.equal(state.pulls, 2)
  assert.equal(state.cancellations, 1)
  assert.equal(response.body.locked, false)
})

test('a valid JSON prefix cannot bypass streamed byte limits and cancellation stops further pulls', async () => {
  const exchange = inspection()
  const prefix = Buffer.from(JSON.stringify(exchange.body))
  const { response, state } = source([prefix, Buffer.alloc(8, 32), Buffer.from(sentinel)], {
    headers: { ...jsonHeaders, 'content-length': '1' }, stall: true,
  })
  await rejectsCapture(options(response, exchange, { maxBytes: prefix.length + 4 }), 'BODY_TOO_LARGE')
  assert.equal(state.pulls, 2)
  assert.equal(state.cancellations, 1)
  assert.deepEqual(state.reasons, [undefined])
})

test('size is checked before decoding an oversized chunk and counts bytes rather than characters', async () => {
  const { response, state } = source([Uint8Array.of(0xff, 0xff, 0xff)], { stall: true })
  await rejectsCapture(options(response, undefined, { maxBytes: 2 }), 'BODY_TOO_LARGE')
  assert.equal(state.cancellations, 1)
  const exchange = extraction()
  exchange.body.pages[0].text = '🧾'.repeat(10)
  const text = JSON.stringify(exchange.body)
  await rejectsCapture(options(responseFor(exchange.body), exchange, { maxBytes: text.length }), 'BODY_TOO_LARGE')
})

test('stalled reads expire and cancel, including after a complete valid JSON prefix', { timeout: 3000 }, async () => {
  for (const chunks of [[], [Buffer.from(JSON.stringify(inspection().body))]]) {
    const { response, state } = source(chunks, { stall: true })
    const start = performance.now()
    await rejectsCapture(options(response, undefined, { readTimeoutMs: 30 }), 'READ_DEADLINE_EXCEEDED')
    assert.ok(performance.now() - start < 2000)
    assert.equal(state.pulls, chunks.length + 1)
    assert.equal(state.cancellations, 1)
    assert.equal(response.body.locked, false)
  }
})

test('read deadline is a total budget even while zero-byte chunks keep arriving', { timeout: 3000 }, async () => {
  let pulls = 0, cancellations = 0
  const response = new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(0)) },
    cancel() { cancellations++ },
  }, { highWaterMark: 0 }), { headers: jsonHeaders })
  await rejectsCapture(options(response, undefined, { readTimeoutMs: 30 }), 'READ_DEADLINE_EXCEEDED')
  assert.ok(pulls > 1)
  assert.equal(cancellations, 1)
  assert.equal(response.body.locked, false)
})

test('hanging or rejecting cancellation cannot defeat a deadline or leak source errors', { timeout: 3000 }, async () => {
  for (const cancel of [() => new Promise(() => {}), () => Promise.reject(Error(sentinel)), () => { throw Error(sentinel) }]) {
    const { response, state } = source([], { stall: true, cancel })
    await rejectsCapture(options(response, undefined, { readTimeoutMs: 20 }), 'READ_DEADLINE_EXCEEDED')
    assert.equal(state.cancellations, 1)
    assert.equal(response.body.locked, false)
  }
})

test('stream errors and invalid byte chunks are sanitized and release the reader', async () => {
  const broken = source([Buffer.from('{')], { error: Error(`https://synthetic.invalid/${sentinel}`) })
  await rejectsCapture(options(broken.response), 'BODY_READ_FAILED')
  assert.equal(broken.response.body.locked, false)
  // WHATWG errored streams cannot call the underlying cancel hook; cancellation
  // is attempted by the helper but the stream is already terminal.
  assert.equal(broken.state.cancellations, 0)
  const wrongChunk = source([sentinel], { stall: true })
  await rejectsCapture(options(wrongChunk.response), 'BODY_READ_FAILED')
  assert.equal(wrongChunk.state.cancellations, 1)
  assert.equal(wrongChunk.response.body.locked, false)
})

test('absent, consumed and locked bodies fail without taking another reader ownership', async () => {
  await rejectsCapture(options(new Response(null, { headers: jsonHeaders })), 'BODY_UNAVAILABLE')
  const consumed = responseFor(inspection().body)
  await consumed.text()
  await rejectsCapture(options(consumed), 'BODY_UNAVAILABLE')
  const locked = source([], { stall: true })
  const reader = locked.response.body.getReader()
  await rejectsCapture(options(locked.response), 'BODY_UNAVAILABLE')
  assert.equal(locked.state.cancellations, 0)
  assert.equal(locked.response.body.locked, true)
  await reader.cancel()
  reader.releaseLock()
})

test('unexpected boundary exceptions are fixed capture errors without retaining the original exception', async () => {
  await rejectsCapture(options(responseFor(inspection().body), undefined, {
    boundary: { validate() { throw Error(sentinel) } },
  }), 'VALIDATION_FAILED')
})

test('capture state and timers do not poison a later valid response', async () => {
  await rejectsCapture(options(new Response(sentinel, { headers: jsonHeaders })), 'INVALID_JSON')
  const exchange = inspection()
  const response = responseFor(exchange.body)
  assert.deepEqual((await captureLegacyAiResponse(options(response, exchange))).body, exchange.body)
  await rejectsCapture(options(response, exchange), 'BODY_UNAVAILABLE')
})

test('mutating caller options during a pending read cannot raise the validated byte cap or replace bindings', async () => {
  let controller, cancellations = 0
  const response = new Response(new ReadableStream({
    start(value) { controller = value },
    cancel() { cancellations++ },
  }, { highWaterMark: 0 }), { headers: jsonHeaders })
  const input = options(response, undefined, { maxBytes: 1 })
  const pending = rejectsCapture(input, 'BODY_TOO_LARGE')
  input.maxBytes = Infinity
  controller.enqueue(Buffer.from('{}'))
  await pending
  assert.equal(cancellations, 1)

  const exchange = inspection()
  let deliver
  const goodResponse = new Response(new ReadableStream({ start(value) { deliver = value } }), { headers: jsonHeaders })
  const goodInput = options(goodResponse, exchange)
  const goodPending = captureLegacyAiResponse(goodInput)
  goodInput.operation = 'evaluate'
  goodInput.expectedMode = 'live'
  goodInput.request = {}
  goodInput.boundary = { validate() { throw Error(sentinel) } }
  deliver.enqueue(Buffer.from(JSON.stringify(exchange.body)))
  deliver.close()
  assert.deepEqual((await goodPending).body, exchange.body)
})
