import { createHash } from 'node:crypto'
import { types } from 'node:util'

/** Internal technical metadata, not a document/source identity or public DTO. */
export interface ByteIntegrity {
  readonly sha256: string
  readonly byteLength: number
}

/** Explicit per-call ceiling; no default or business quota is supplied here. */
export interface ByteIntegrityLimits {
  readonly maxBytes: number
}

export type ByteIntegrityErrorCode =
  | 'INVALID_BYTES'
  | 'INVALID_LIMITS'
  | 'INVALID_EXPECTED_INTEGRITY'
  | 'BYTE_LIMIT_EXCEEDED'
  | 'BYTE_LENGTH_MISMATCH'
  | 'SHA256_MISMATCH'
  | 'HASH_FAILED'

export class ByteIntegrityError extends Error {
  constructor(readonly code: ByteIntegrityErrorCode) {
    super(`Byte integrity check failed: ${code}`)
    this.name = 'ByteIntegrityError'
  }
}

function fail(code: ByteIntegrityErrorCode): never {
  throw new ByteIntegrityError(code)
}

function isByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function readLimit(limits: ByteIntegrityLimits): number {
  let maxBytes: unknown
  try {
    maxBytes = limits?.maxBytes
  } catch {
    fail('INVALID_LIMITS')
  }
  if (!isByteCount(maxBytes)) fail('INVALID_LIMITS')
  return maxBytes
}

function readExpected(expected: ByteIntegrity): ByteIntegrity {
  let byteLength: unknown
  let sha256: unknown
  try {
    byteLength = expected?.byteLength
    sha256 = expected?.sha256
  } catch {
    fail('INVALID_EXPECTED_INTEGRITY')
  }
  if (!isByteCount(byteLength) || typeof sha256 !== 'string'
    || sha256.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(sha256)) {
    fail('INVALID_EXPECTED_INTEGRITY')
  }
  return { byteLength, sha256: sha256.toLowerCase() }
}

// Read intrinsic view bounds, including for Buffer, cross-realm views and subclasses.
// Own properties on a view must not widen the bytes hashed or bypass the ceiling.
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get
const offsetOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset').get
const lengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength').get

function exactView(bytes: Uint8Array): Uint8Array {
  if (!types.isUint8Array(bytes)) fail('INVALID_BYTES')
  try {
    // Also rejects detached and out-of-bounds resizable views, even if length is 0.
    Uint8Array.prototype.values.call(bytes)
    const buffer = bufferOf.call(bytes)
    // Concurrent shared-memory writers cannot provide a stable source snapshot.
    if (types.isSharedArrayBuffer(buffer)) fail('INVALID_BYTES')
    return new Uint8Array(buffer, offsetOf.call(bytes), lengthOf.call(bytes))
  } catch {
    fail('INVALID_BYTES')
  }
}

function hash(view: Uint8Array): ByteIntegrity {
  try {
    return Object.freeze({
      sha256: createHash('sha256').update(view).digest('hex'),
      byteLength: view.byteLength,
    })
  } catch {
    fail('HASH_FAILED')
  }
}

/** Hash only this view's bytes, without text decoding, normalization or input mutation. */
export function computeByteIntegrity(
  bytes: Uint8Array,
  limits: ByteIntegrityLimits,
): ByteIntegrity {
  const maxBytes = readLimit(limits)
  const view = exactView(bytes)
  if (view.byteLength > maxBytes) fail('BYTE_LIMIT_EXCEEDED')
  return hash(view)
}

/** Verify both length and digest against caller-supplied, independently trusted metadata. */
export function verifyByteIntegrity(
  bytes: Uint8Array,
  expected: ByteIntegrity,
  limits: ByteIntegrityLimits,
): ByteIntegrity {
  const maxBytes = readLimit(limits)
  const metadata = readExpected(expected)
  if (metadata.byteLength > maxBytes) fail('BYTE_LIMIT_EXCEEDED')
  const view = exactView(bytes)
  if (view.byteLength > maxBytes) fail('BYTE_LIMIT_EXCEEDED')
  if (view.byteLength !== metadata.byteLength) fail('BYTE_LENGTH_MISMATCH')
  const actual = hash(view)
  if (actual.sha256 !== metadata.sha256) fail('SHA256_MISMATCH')
  return actual
}
