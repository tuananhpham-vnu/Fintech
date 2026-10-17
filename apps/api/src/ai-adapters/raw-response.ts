import { performance } from 'node:perf_hooks'
import { TextDecoder } from 'node:util'
import { LegacyAiValidationError } from './legacy-validation'
import type {
  createLegacyAiValidationBoundary,
  LegacyAiExchange,
  ValidatedLegacyResponse,
} from './legacy-validation'

export interface LegacyAiResponseCapture extends Pick<LegacyAiExchange, 'operation' | 'request' | 'expectedMode'> {
  readonly boundary: ReturnType<typeof createLegacyAiValidationBoundary>
  readonly response: Response
  /** Maximum delivered body bytes, not a document/upload or retention policy. */
  readonly maxBytes: number
  /** Total body-read budget in milliseconds, not a per-chunk or job timeout. */
  readonly readTimeoutMs: number
}

export type ResponseCaptureErrorCode =
  | 'INVALID_CAPTURE_CONFIG'
  | 'INVALID_RESPONSE'
  | 'UNEXPECTED_STATUS'
  | 'INVALID_CONTENT_TYPE'
  | 'BODY_UNAVAILABLE'
  | 'BODY_TOO_LARGE'
  | 'READ_DEADLINE_EXCEEDED'
  | 'BODY_READ_FAILED'
  | 'INVALID_UTF8'
  | 'INVALID_JSON'
  | 'VALIDATION_FAILED'

export class LegacyAiResponseCaptureError extends Error {
  constructor(readonly code: ResponseCaptureErrorCode) {
    super(`Legacy AI response capture failed: ${code}`)
    this.name = 'LegacyAiResponseCaptureError'
  }
}

function fail(code: ResponseCaptureErrorCode): never {
  throw new LegacyAiResponseCaptureError(code)
}

// Node timers clamp larger delays to 1 ms. This is a timer constraint, not policy.
const MAX_TIMER_MS = 2_147_483_647
const JSON_CONTENT_TYPE = /^application\/json(?:[\t ]*;[\t ]*charset[\t ]*=[\t ]*(?:utf-8|"utf-8"))?[\t ]*$/i

/** Best effort only: an underlying source's cancel promise may never settle. */
function cancel(target: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array>): void {
  try { void target.cancel().catch(() => {}) } catch { /* Never expose source errors. */ }
}

async function readBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
  expiresAt: number,
  deadlineError: LegacyAiResponseCaptureError,
): Promise<string> {
  // Preserve a BOM for JSON.parse to reject, rather than silently stripping it.
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const parts: string[] = []
  let bytes = 0
  for (;;) {
    if (performance.now() >= expiresAt) throw deadlineError
    let chunk: ReadableStreamReadResult<Uint8Array>
    try { chunk = await reader.read() } catch { fail('BODY_READ_FAILED') }
    if (performance.now() >= expiresAt) throw deadlineError
    if (chunk.done) break
    if (!(chunk.value instanceof Uint8Array)) fail('BODY_READ_FAILED')
    if (chunk.value.byteLength > maxBytes - bytes) fail('BODY_TOO_LARGE')
    bytes += chunk.value.byteLength
    try {
      const part = decoder.decode(chunk.value, { stream: true })
      if (part) parts.push(part)
    } catch { fail('INVALID_UTF8') }
  }
  try {
    const tail = decoder.decode()
    if (tail) parts.push(tail)
  } catch { fail('INVALID_UTF8') }
  return parts.join('')
}

/**
 * Opt-in, unwired capture of an already obtained WHATWG Response. No transport,
 * bundle loading, persistence, public error mapping or orchestration is provided.
 */
export async function captureLegacyAiResponse(input: LegacyAiResponseCapture): Promise<ValidatedLegacyResponse> {
  if (!input) fail('INVALID_CAPTURE_CONFIG')
  const { maxBytes, readTimeoutMs, boundary, response, operation, request, expectedMode } = input
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 ||
      !Number.isSafeInteger(readTimeoutMs) || readTimeoutMs <= 0 ||
      readTimeoutMs > MAX_TIMER_MS || typeof boundary?.validate !== 'function')
    fail('INVALID_CAPTURE_CONFIG')

  // Native getters perform the Response brand check, including for objects that
  // merely inherit Response.prototype. Do not accept response.json() lookalikes.
  let status: number
  let headers: Headers
  let body: ReadableStream<Uint8Array> | null
  let bodyUsed: boolean
  try {
    if (!(response instanceof Response)) fail('INVALID_RESPONSE')
    status = Reflect.get(Response.prototype, 'status', response)
    headers = Reflect.get(Response.prototype, 'headers', response)
    body = Reflect.get(Response.prototype, 'body', response)
    bodyUsed = Reflect.get(Response.prototype, 'bodyUsed', response)
  } catch { fail('INVALID_RESPONSE') }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (status !== 200) fail('UNEXPECTED_STATUS')
    const contentType = Headers.prototype.get.call(headers, 'content-type')
    if (contentType === null || !JSON_CONTENT_TYPE.test(contentType)) fail('INVALID_CONTENT_TYPE')
    const mode = Headers.prototype.get.call(headers, 'x-ai-mode')
    if (!body || bodyUsed || body.locked) fail('BODY_UNAVAILABLE')
    reader = body.getReader()

    const deadlineError = new LegacyAiResponseCaptureError('READ_DEADLINE_EXCEEDED')
    const expiresAt = performance.now() + readTimeoutMs
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(deadlineError), readTimeoutMs)
    })
    // Race once for the whole read, avoiding one retained deadline reaction per
    // chunk (especially for arbitrarily many empty chunks).
    const text = await Promise.race([readBody(reader, maxBytes, expiresAt, deadlineError), deadline])
    clearTimeout(timer)

    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { fail('INVALID_JSON') }
    try {
      return boundary.validate({
        operation,
        request,
        expectedMode,
        headers: { 'x-ai-mode': mode },
        body: parsed,
      })
    } catch (error) {
      if (error instanceof LegacyAiValidationError) throw error
      fail('VALIDATION_FAILED')
    }
  } catch (error) {
    if (reader) cancel(reader)
    else if (body && !bodyUsed && !body.locked) cancel(body)
    if (error instanceof LegacyAiResponseCaptureError || error instanceof LegacyAiValidationError) throw error
    fail('BODY_READ_FAILED')
  } finally {
    clearTimeout(timer)
    reader?.releaseLock()
  }
}
