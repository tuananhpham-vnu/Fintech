import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { TextDecoder } from 'node:util'
import Ajv2020 from 'ajv/dist/2020'
import type { ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import type { DocumentInspector } from '../documents/ports'
import {
  createLegacyAiValidationBoundary,
  LEGACY_SCHEMA_VERSION,
  LegacyAiValidationError,
} from './legacy-validation'
import type { LegacyAiMode, LegacyAiOperation, ValidatedLegacyResponse } from './legacy-validation'
import { captureLegacyAiResponse, LegacyAiResponseCaptureError } from './raw-response'

export interface DocumentAiTransportOptions {
  /** AI service root, before /internal/v1; no credentials, query or fragment. */
  readonly baseURL: string
  readonly internalKey: string
  readonly expectedMode: LegacyAiMode
  readonly contractsDirectory: string
  /** Whole HTTP exchange budgets, including headers and body; defaults 30s/240s. */
  readonly inspectTimeoutMs?: number
  readonly extractTimeoutMs?: number
  /** Delivered response bytes, on both success and failure; default 2 MiB. */
  readonly maxResponseBytes?: number
}

/** Authoritative attempt metadata supplied by the caller; no storage/DB access. */
export interface DocumentAiExtractionAttempt {
  readonly storageKey: string
  readonly documentId: string
  readonly caseId: string
  readonly type: string
  readonly sha256: string
}

// Only these literal upstream codes may leave the transport. Error.message,
// details and request_id are never copied, even from a schema-valid envelope.
const SERVICE_CODES = [
  'FORBIDDEN',
  'INVALID_REQUEST',
  'INVALID_MODEL_OUTPUT',
  'PROVIDER_UNAVAILABLE',
  'INTERNAL_ERROR',
  'PDF_NOT_FOUND',
  'SHA256_MISMATCH',
  'PDF_INVALID',
  'PDF_ENCRYPTED',
  'PDF_TOO_LARGE',
  'PDF_TOO_MANY_PAGES',
  'PDF_NO_TEXT',
] as const
export type DocumentAiErrorCode =
  | (typeof SERVICE_CODES)[number]
  | 'AI_INVALID_CONFIG'
  | 'AI_INVALID_CONTRACT_BUNDLE'
  | 'AI_INVALID_REQUEST'
  | 'AI_UNSUPPORTED_DOCUMENT_TYPE'
  | 'AI_SERVICE_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'AI_INVALID_RESPONSE'
  | 'AI_MODE_MISMATCH'
  | 'AI_CONTENT_MISMATCH'
  | 'AI_RESPONSE_TOO_LARGE'
  | 'AI_HTTP_ERROR'

/** Internal error, deliberately not FoundationError. Composition owns public mapping. */
export class DocumentAiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: DocumentAiErrorCode,
    readonly retryable: boolean,
  ) {
    super(code)
    this.name = 'DocumentAiError'
  }
}

const ARTIFACTS = [
  'examples.json',
  'field-registry.json',
  'internal-openapi.json',
  'openapi.json',
  'schemas.json',
  'validation-vectors.json',
] as const
const MAX_TIMER_MS = 2_147_483_647
const JSON_CONTENT_TYPE =
  /^application\/json(?:[\t ]*;[\t ]*charset[\t ]*=[\t ]*(?:utf-8|"utf-8"))?[\t ]*$/i

function configError(): never {
  throw new DocumentAiError(500, 'AI_INVALID_CONFIG', false)
}

function positiveInteger(value: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) configError()
  return value
}

function cancel(body: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void body.cancel().catch(() => {})
  } catch {
    /* No raw source errors. */
  }
}

/**
 * Opt-in native HTTP transport. No Nest registration, env lookup, logging,
 * retries, mock fallback, public projection or application persistence.
 * Mode labels validate a binding; they do not establish live AI accuracy.
 */
export class DocumentAiTransport implements DocumentInspector {
  readonly #baseURL: string
  readonly #internalKey: string
  readonly #expectedMode: LegacyAiMode
  readonly #inspectTimeoutMs: number
  readonly #extractTimeoutMs: number
  readonly #maxResponseBytes: number
  readonly #boundary: ReturnType<typeof createLegacyAiValidationBoundary>
  readonly #inputs: Record<LegacyAiOperation, ValidateFunction>
  readonly #errorSchema: ValidateFunction
  readonly #types: ReadonlySet<string>

  constructor(options: DocumentAiTransportOptions) {
    if (
      !options ||
      typeof options.baseURL !== 'string' ||
      typeof options.internalKey !== 'string' ||
      !/^[\x21-\x7e]+$/.test(options.internalKey) ||
      (options.expectedMode !== 'mock' && options.expectedMode !== 'live') ||
      typeof options.contractsDirectory !== 'string' ||
      !options.contractsDirectory
    )
      configError()
    let url: URL
    try {
      url = new URL(options.baseURL)
    } catch {
      configError()
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      configError()
    this.#baseURL = url.href.replace(/\/+$/, '')
    this.#internalKey = options.internalKey
    this.#expectedMode = options.expectedMode
    this.#inspectTimeoutMs = positiveInteger(
      options.inspectTimeoutMs === undefined ? 30_000 : options.inspectTimeoutMs,
      MAX_TIMER_MS,
    )
    this.#extractTimeoutMs = positiveInteger(
      options.extractTimeoutMs === undefined ? 240_000 : options.extractTimeoutMs,
      MAX_TIMER_MS,
    )
    this.#maxResponseBytes = positiveInteger(
      options.maxResponseBytes === undefined ? 2 * 1024 * 1024 : options.maxResponseBytes,
    )

    try {
      // Fixed filenames only: an unverified manifest never supplies file paths.
      const bundle = {
        version: readFileSync(join(options.contractsDirectory, 'VERSION'), 'utf8'),
        sha256sums: readFileSync(join(options.contractsDirectory, 'SHA256SUMS'), 'utf8'),
        files: Object.fromEntries(
          ARTIFACTS.map((name) => [name, readFileSync(join(options.contractsDirectory, name))]),
        ),
      }
      this.#boundary = createLegacyAiValidationBoundary(bundle)
      // Compile only canonical definitions, after the factory verifies all bytes.
      const schema = JSON.parse(bundle.files['schemas.json'].toString('utf8'))
      const ajv = new Ajv2020({
        strict: true,
        strictTypes: false,
        allErrors: false,
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: false,
        ownProperties: true,
      })
      addFormats(ajv)
      const compile = (name: string) =>
        ajv.compile({
          $schema: schema.$schema,
          $defs: schema.$defs,
          $ref: `#/$defs/${name}`,
        })
      this.#inputs = { inspect: compile('InspectionInput'), extract: compile('ExtractionInput') }
      this.#errorSchema = compile('Error')
      this.#types = new Set(schema.$defs.ExtractionInput.properties.type.enum)
    } catch {
      throw new DocumentAiError(500, 'AI_INVALID_CONTRACT_BUNDLE', false)
    }
  }

  async inspect(storageKey: string, sha256: string, timeoutMs?: number): ReturnType<DocumentInspector['inspect']> {
    const validated = await this.exchange(
      'inspect',
      {
        schema_version: LEGACY_SCHEMA_VERSION,
        storage_key: storageKey,
        sha256,
      },
      timeoutMs === undefined ? this.#inspectTimeoutMs : Math.min(this.#inspectTimeoutMs, positiveInteger(timeoutMs, MAX_TIMER_MS)),
    )
    const body = validated.body
    return {
      sha256: body.sha256 as string,
      page_count: body.page_count as number,
      byte_size: body.byte_size as number,
      encrypted: body.encrypted as boolean,
      has_embedded_files: body.has_embedded_files as boolean,
      mode: validated.mode,
    }
  }

  async extract(attempt: DocumentAiExtractionAttempt): Promise<ValidatedLegacyResponse> {
    if (!attempt) throw new DocumentAiError(400, 'AI_INVALID_REQUEST', false)
    const { storageKey, documentId, caseId, type, sha256 } = attempt
    if (!this.#types.has(type))
      throw new DocumentAiError(400, 'AI_UNSUPPORTED_DOCUMENT_TYPE', false)
    return this.exchange(
      'extract',
      {
        schema_version: LEGACY_SCHEMA_VERSION,
        storage_key: storageKey,
        document_id: documentId,
        case_id: caseId,
        type,
        sha256,
      },
      this.#extractTimeoutMs,
    )
  }

  private async exchange(
    operation: LegacyAiOperation,
    request: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<ValidatedLegacyResponse> {
    if (!this.#inputs[operation](request))
      throw new DocumentAiError(400, 'AI_INVALID_REQUEST', false)
    const expiresAt = performance.now() + timeoutMs
    const controller = new AbortController()
    const timeoutError = new DocumentAiError(504, 'AI_TIMEOUT', true)
    let timer: ReturnType<typeof setTimeout>
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(timeoutError)
      }, timeoutMs)
    })
    const run = async () => {
      const response = await fetch(`${this.#baseURL}/internal/v1/${operation}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Key': this.#internalKey },
        body: JSON.stringify(request),
        signal: controller.signal,
        // Never forward the internal key or request to a redirect destination.
        redirect: 'manual',
      })
      if (performance.now() >= expiresAt) {
        if (response.body) cancel(response.body)
        throw timeoutError
      }
      if (response.status !== 200) throw await this.responseError(response, expiresAt)
      const remainingMs = Math.floor(expiresAt - performance.now())
      if (remainingMs <= 0) {
        if (response.body) cancel(response.body)
        throw timeoutError
      }
      // The actual Response and raw Headers go directly to existing capture.
      const result = await captureLegacyAiResponse({
        boundary: this.#boundary,
        response,
        operation,
        request,
        expectedMode: this.#expectedMode,
        maxBytes: this.#maxResponseBytes,
        readTimeoutMs: remainingMs,
      })
      if (performance.now() >= expiresAt) throw timeoutError
      return result
    }
    try {
      return await Promise.race([run(), deadline])
    } catch (error) {
      if (controller.signal.aborted || performance.now() >= expiresAt) throw timeoutError
      if (error instanceof DocumentAiError) throw error
      if (error instanceof LegacyAiValidationError) {
        const code =
          error.code === 'MODE_MISMATCH' || error.code === 'UNSUPPORTED_MODE'
            ? 'AI_MODE_MISMATCH'
            : error.code === 'SOURCE_MISMATCH'
              ? 'AI_CONTENT_MISMATCH'
              : 'AI_INVALID_RESPONSE'
        throw new DocumentAiError(502, code, false)
      }
      if (error instanceof LegacyAiResponseCaptureError) {
        if (error.code === 'READ_DEADLINE_EXCEEDED') throw timeoutError
        throw new DocumentAiError(
          502,
          error.code === 'BODY_TOO_LARGE' ? 'AI_RESPONSE_TOO_LARGE' : 'AI_INVALID_RESPONSE',
          false,
        )
      }
      throw new DocumentAiError(503, 'AI_SERVICE_UNAVAILABLE', true)
    } finally {
      clearTimeout(timer)
      // Release any in-flight network work on failure as well as on timeout.
      controller.abort()
    }
  }

  private async responseError(response: Response, expiresAt: number): Promise<DocumentAiError> {
    const statusCode = response.status >= 400 && response.status <= 599 ? response.status : 502
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500
    const fallback = new DocumentAiError(statusCode, 'AI_HTTP_ERROR', retryable)
    const body = response.body
    if (!body) return fallback
    if (!JSON_CONTENT_TYPE.test(response.headers.get('content-type') ?? '')) {
      cancel(body)
      return fallback
    }
    const reader = body.getReader()
    try {
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        if (performance.now() >= expiresAt) throw new DocumentAiError(504, 'AI_TIMEOUT', true)
        const chunk = await reader.read()
        if (performance.now() >= expiresAt) throw new DocumentAiError(504, 'AI_TIMEOUT', true)
        if (chunk.done) break
        if (chunk.value.byteLength > this.#maxResponseBytes - size)
          throw new DocumentAiError(502, 'AI_RESPONSE_TOO_LARGE', false)
        size += chunk.value.byteLength
        chunks.push(chunk.value)
      }
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        Buffer.concat(chunks, size),
      )
      const parsed = JSON.parse(text)
      if (this.#errorSchema(parsed)) {
        const code = (parsed as { error: { code: string } }).error.code
        if ((SERVICE_CODES as readonly string[]).includes(code))
          return new DocumentAiError(statusCode, code as (typeof SERVICE_CODES)[number], retryable)
      }
      return fallback
    } catch (error) {
      if (error instanceof DocumentAiError) throw error
      return fallback
    } finally {
      cancel(reader)
      reader.releaseLock()
    }
  }
}
