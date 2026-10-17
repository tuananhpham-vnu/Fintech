import { createHash } from 'node:crypto'
import Ajv2020 from 'ajv/dist/2020'
import type { ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

// Reviewed bytes from packages/contracts/SHA256SUMS, owned by Lead. A supplied
// manifest cannot authorize replacement schemas merely by recomputing its hashes.
const CONTRACT_HASHES = {
  'examples.json': 'ee8a7cb94e862b1a2bf4539f0c8f4e49b9adbd3afb1fb7aff96fa34612ce3b06',
  'field-registry.json': '5d8720bd825c8a0189d8e13c12c49ecf0756671b3929e49a63da2709ba68a181',
  'internal-openapi.json': 'c21d161147ef536c7bcfd4ed8728b1280e0e108b23104d0f8a2c0c6cb693d3dc',
  'openapi.json': '62de0bdb3fce46074233de0e353d867fdbf35b38a8efd5d86a3a44f0737595b4',
  'schemas.json': '01489a7f64f904fed66fce67b5cdfa55a9a3647989b6f0072a7c0d94e4fe4d49',
  'validation-vectors.json': '2b6a377e0382e30c5f9d0338c5549b6a0d023cb4ecda2d3dc5db02fd8c55bb0e',
} as const

export const LEGACY_SCHEMA_VERSION = '1.0.2'
export const MAX_ADAPTER_VIOLATIONS = 20
export type LegacyAiMode = 'mock' | 'live'
export type LegacyAiOperation = 'inspect' | 'extract'

/** Transport captures headers under lowercase keys, as Fetch Headers does. */
export interface LegacyAiResponseHeaders {
  readonly 'x-ai-mode'?: unknown
}

/** In-memory bundle only. The eventual composition owner supplies these bytes. */
export interface LegacyContractBundle {
  readonly version: string
  readonly sha256sums: string
  readonly files: Readonly<Record<string, Uint8Array>>
}

export interface LegacyAiExchange {
  readonly operation: LegacyAiOperation
  readonly request: unknown
  /** Unmodified parsed response body, without transport metadata. */
  readonly body: unknown
  readonly headers: LegacyAiResponseHeaders
  readonly expectedMode: LegacyAiMode
}

/** Internal validation result only; never an AIC2 public response or readiness gate. */
export interface ValidatedLegacyResponse {
  readonly body: Readonly<Record<string, unknown>>
  readonly mode: LegacyAiMode
  readonly orchestrationBinding: 'pending'
}

export interface AdapterViolation {
  readonly path: string
  readonly message: string
}

export type AdapterErrorCode =
  | 'INVALID_CONTRACT_BUNDLE'
  | 'UNSUPPORTED_OPERATION'
  | 'UNSUPPORTED_MODE'
  | 'MODE_MISMATCH'
  | 'INVALID_LEGACY_REQUEST'
  | 'INVALID_LEGACY_RESPONSE'
  | 'SOURCE_MISMATCH'

export class LegacyAiValidationError extends Error {
  readonly violations: readonly AdapterViolation[]

  constructor(
    readonly code: AdapterErrorCode,
    violations: readonly AdapterViolation[],
  ) {
    super(`Legacy AI validation failed: ${code}`)
    this.name = 'LegacyAiValidationError'
    this.violations = violations.slice(0, MAX_ADAPTER_VIOLATIONS)
  }
}

function fail(code: AdapterErrorCode, path: string, message: string): never {
  throw new LegacyAiValidationError(code, [{ path, message }])
}

function verifyBundle(bundle: LegacyContractBundle): void {
  if (!bundle || typeof bundle.version !== 'string' || bundle.version.trim() !== LEGACY_SCHEMA_VERSION)
    fail('INVALID_CONTRACT_BUNDLE', '/version', 'Only the reviewed legacy 1.0.2 bundle is supported')
  if (typeof bundle.sha256sums !== 'string' || !bundle.files || typeof bundle.files !== 'object')
    fail('INVALID_CONTRACT_BUNDLE', '/', 'Bundle bytes and SHA256SUMS are required')

  const seen = new Set<string>()
  const lines = bundle.sha256sums.trim().split(/\r?\n/)
  if (lines.length !== Object.keys(CONTRACT_HASHES).length)
    fail('INVALID_CONTRACT_BUNDLE', '/sha256sums', 'Manifest must cover all six canonical artifacts')
  for (const line of lines) {
    const entry = /^([a-f0-9]{64}) {2}([a-z-]+\.json)$/.exec(line)
    if (!entry)
      fail('INVALID_CONTRACT_BUNDLE', '/sha256sums', 'Malformed manifest entry')
    const [, digest, name] = entry
    if (!Object.hasOwn(CONTRACT_HASHES, name) || seen.has(name))
      fail('INVALID_CONTRACT_BUNDLE', '/sha256sums', 'Unknown or duplicate manifest artifact')
    seen.add(name)
    if (digest !== CONTRACT_HASHES[name])
      fail('INVALID_CONTRACT_BUNDLE', '/sha256sums', 'Manifest differs from the reviewed 1.0.2 bundle')
    const bytes = Object.hasOwn(bundle.files, name) ? bundle.files[name] : undefined
    if (!(bytes instanceof Uint8Array) || createHash('sha256').update(bytes).digest('hex') !== digest)
      fail('INVALID_CONTRACT_BUNDLE', `/files/${name}`, 'Artifact is missing or fails SHA-256 integrity')
  }
}

function validateSchema(validator: ValidateFunction, value: unknown, side: 'request' | 'body') {
  if (!validator(value)) {
    // AJV stops at the first error. Do not copy error params or raw case data.
    const error = validator.errors?.[0]
    fail(
      side === 'request' ? 'INVALID_LEGACY_REQUEST' : 'INVALID_LEGACY_RESPONSE',
      `/${side}${error?.instancePath ?? ''}`,
      `${error?.keyword ?? 'schema'}: ${error?.message ?? 'Schema validation failed'}`,
    )
  }
}

function isMode(value: unknown): value is LegacyAiMode {
  return value === 'mock' || value === 'live'
}

/**
 * No file/network/environment access, Nest registration, persistence or fallback.
 * Factory verifies one fixed bundle and compiles four fixed 2020-12 validators.
 * Validation leaves the caller's JSON objects untouched, including on failure.
 */
export function createLegacyAiValidationBoundary(bundle: LegacyContractBundle): {
  validate(exchange: LegacyAiExchange): ValidatedLegacyResponse
} {
  verifyBundle(bundle)
  let validators: Record<LegacyAiOperation, [ValidateFunction, ValidateFunction]>
  try {
    const schema = JSON.parse(Buffer.from(bundle.files['schemas.json']).toString('utf8'))
    const ajv = new Ajv2020({
      strict: true,
      // Canonical PaymentCondition uses maxItems/minItems in conditional
      // subschemas, inheriting the array type from its parent property.
      strictTypes: false,
      allErrors: false,
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: false,
      ownProperties: true,
    })
    addFormats(ajv)
    const compile = (name: string) =>
      ajv.compile({ $schema: schema.$schema, $defs: schema.$defs, $ref: `#/$defs/${name}` })
    validators = {
      inspect: [compile('InspectionInput'), compile('InspectionOutput')],
      extract: [compile('ExtractionInput'), compile('ExtractionOutput')],
    }
  } catch {
    fail('INVALID_CONTRACT_BUNDLE', '/files/schemas.json', 'Canonical schemas could not be compiled')
  }

  return {
    validate(exchange): ValidatedLegacyResponse {
      if (!exchange || (exchange.operation !== 'inspect' && exchange.operation !== 'extract'))
        fail('UNSUPPORTED_OPERATION', '/operation', 'Only inspect and extract are supported')
      if (!isMode(exchange.expectedMode))
        fail('UNSUPPORTED_MODE', '/expectedMode', 'An explicit mock or live binding is required')
      const mode = exchange.headers?.['x-ai-mode']
      if (!isMode(mode))
        fail('UNSUPPORTED_MODE', '/headers/x-ai-mode', 'X-AI-Mode must be mock or live')
      if (mode !== exchange.expectedMode)
        fail('MODE_MISMATCH', '/headers/x-ai-mode', 'X-AI-Mode differs from the expected transport mode')

      const [input, output] = validators[exchange.operation]
      validateSchema(input, exchange.request, 'request')
      validateSchema(output, exchange.body, 'body')
      // Casts follow canonical validation; these structures are not new contracts.
      const request = exchange.request as Record<string, any>
      const payload = exchange.body as Record<string, any>
      const violations: AdapterViolation[] = []
      const add = (path: string, message: string) => {
        if (violations.length < MAX_ADAPTER_VIOLATIONS) violations.push({ path, message })
      }
      const echoes = exchange.operation === 'inspect' ? ['sha256'] : ['document_id', 'case_id', 'sha256']
      for (const key of echoes)
        if (payload[key] !== request[key]) add(`/body/${key}`, `Must echo request ${key}`)

      if (exchange.operation === 'extract') {
        // Source guards match services/ai/runner/guards.py extraction checks.
        // No declared/detected type equality, field registry or model-name rule.
        const pages = new Set<number>()
        for (let i = 0; i < payload.pages.length; i++) {
          const page = payload.pages[i].page
          pages.add(page)
          if (page !== i + 1) add('/body/pages', 'Pages must be contiguous 1..N')
        }
        const evidenceIds = new Set<string>()
        for (let i = 0; i < payload.evidence.length; i++) {
          const evidence = payload.evidence[i]
          if (evidenceIds.has(evidence.id)) add('/body/evidence', 'Evidence IDs must be unique')
          evidenceIds.add(evidence.id)
          if (evidence.document_id !== request.document_id || !pages.has(evidence.page))
            add(`/body/evidence/${i}`, 'Evidence must reference this document and an existing page')
        }
        for (let i = 0; i < payload.fields.length; i++) {
          const field = payload.fields[i]
          if (field.document_id !== request.document_id || field.evidence_ids.some((id: string) => !evidenceIds.has(id)))
            add(`/body/fields/${i}`, 'Field must reference this document and its own evidence')
        }
      }
      if (violations.length) throw new LegacyAiValidationError('SOURCE_MISMATCH', violations)
      return { body: payload, mode, orchestrationBinding: 'pending' }
    },
  }
}
