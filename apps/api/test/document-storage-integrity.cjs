const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
// Exercise compiled TypeScript; no copied implementation or storage mock.
const {
  ByteIntegrityError,
  computeByteIntegrity,
  verifyByteIntegrity,
} = require('../dist/document-storage/byte-integrity.js')

const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const abcMetadata = Object.freeze({ sha256: ABC, byteLength: 3 })
const limit = Object.freeze({ maxBytes: 3 })

function rejects(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ByteIntegrityError)
    assert.equal(error.code, code)
    assert.equal(error.name, 'ByteIntegrityError')
    assert.equal(error.message, `Byte integrity check failed: ${code}`)
    assert.equal(Object.hasOwn(error, 'cause'), false)
    assert.deepEqual(Object.keys(error).sort(), ['code', 'name'])
    return true
  })
}

test('known SHA-256 vectors, uppercase expected hex and frozen result', () => {
  assert.deepEqual(computeByteIntegrity(Buffer.alloc(0), { maxBytes: 0 }), {
    sha256: EMPTY, byteLength: 0,
  })
  const result = computeByteIntegrity(Buffer.from('abc'), limit)
  assert.deepEqual(result, abcMetadata)
  assert.ok(Object.isFrozen(result))
  assert.deepEqual(verifyByteIntegrity(new Uint8Array([97, 98, 99]), {
    sha256: ABC.toUpperCase(), byteLength: 3,
  }, limit), result)
  assert.deepEqual(verifyByteIntegrity(Buffer.alloc(0), {
    sha256: EMPTY, byteLength: 0,
  }, { maxBytes: 0 }), { sha256: EMPTY, byteLength: 0 })
})

test('equal-length tampering fails digest comparison; different length fails length check', () => {
  const bytes = Buffer.from('abc')
  const expected = computeByteIntegrity(bytes, limit)
  bytes[1] ^= 1
  rejects(() => verifyByteIntegrity(bytes, expected, limit), 'SHA256_MISMATCH')
  rejects(() => verifyByteIntegrity(Buffer.from('ab'), expected, limit), 'BYTE_LENGTH_MISMATCH')
  rejects(() => verifyByteIntegrity(Buffer.from('abc'), {
    sha256: ABC, byteLength: 2,
  }, limit), 'BYTE_LENGTH_MISMATCH')
})

test('hashes exact Buffer slices, subarrays and offset Uint8Array views', () => {
  const buffer = Buffer.from('prefix-abc-suffix')
  const array = new Uint8Array([255, 97, 98, 99, 0, 128])
  const views = [
    buffer.slice(7, 10),
    buffer.subarray(7, 10),
    array.subarray(1, 4),
    new Uint8Array(array.buffer, 1, 3),
    new Uint8Array(buffer.buffer, buffer.byteOffset + 7, 3),
  ]
  for (const view of views) {
    assert.deepEqual(computeByteIntegrity(view, limit), abcMetadata)
    assert.deepEqual(verifyByteIntegrity(view, abcMetadata, limit), abcMetadata)
  }
  // Unrelated bytes in the backing allocation are outside the integrity scope.
  array[0] = 0
  array[4] = 255
  assert.deepEqual(verifyByteIntegrity(views[2], abcMetadata, limit), abcMetadata)
  assert.deepEqual(computeByteIntegrity(array.subarray(3, 3), { maxBytes: 0 }), {
    sha256: EMPTY, byteLength: 0,
  })
})

test('binary and text byte differences are preserved without normalization', () => {
  const binary = Buffer.from([0, 255, 192, 128, 13, 10, 0, 127])
  const expected = createHash('sha256').update(binary).digest('hex')
  assert.deepEqual(computeByteIntegrity(binary, { maxBytes: 8 }), {
    sha256: expected, byteLength: 8,
  })
  for (const [left, right] of [['a\r\nb', 'a\nb'], ['é', 'e\u0301'], ['a\0b', 'ab']]) {
    const a = computeByteIntegrity(Buffer.from(left), { maxBytes: 10 })
    const b = computeByteIntegrity(Buffer.from(right), { maxBytes: 10 })
    assert.notEqual(a.sha256, b.sha256)
  }
})

test('inclusive configured ceilings, zero, and safe-integer boundary', () => {
  assert.deepEqual(computeByteIntegrity(Buffer.from('abc'), { maxBytes: 4 }), abcMetadata)
  assert.deepEqual(verifyByteIntegrity(Buffer.from('abc'), abcMetadata, limit), abcMetadata)
  assert.deepEqual(computeByteIntegrity(Buffer.from('abc'), {
    maxBytes: Number.MAX_SAFE_INTEGER,
  }), abcMetadata)
  rejects(() => computeByteIntegrity(Buffer.from('abc'), { maxBytes: 2 }), 'BYTE_LIMIT_EXCEEDED')
  rejects(() => computeByteIntegrity(Buffer.from('a'), { maxBytes: 0 }), 'BYTE_LIMIT_EXCEEDED')
  rejects(() => verifyByteIntegrity(Buffer.from('abcd'), abcMetadata, limit), 'BYTE_LIMIT_EXCEEDED')
  rejects(() => verifyByteIntegrity(Buffer.from('ab'), abcMetadata, { maxBytes: 2 }), 'BYTE_LIMIT_EXCEEDED')
  rejects(() => verifyByteIntegrity(Buffer.alloc(0), {
    sha256: EMPTY, byteLength: Number.MAX_SAFE_INTEGER,
  }, limit), 'BYTE_LIMIT_EXCEEDED')
})

test('missing, coerced, nonfinite, fractional and unsafe limits fail closed', () => {
  const invalid = [undefined, null, {}, { maxBytes: null }, { maxBytes: '3' },
    ...[-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 3n, true]
      .map((maxBytes) => ({ maxBytes }))]
  for (const limits of invalid) {
    rejects(() => computeByteIntegrity(Buffer.from('abc'), limits), 'INVALID_LIMITS')
    rejects(() => verifyByteIntegrity(Buffer.from('abc'), abcMetadata, limits), 'INVALID_LIMITS')
  }
})

test('invalid expected digest/length metadata is rejected without coercion', () => {
  const invalid = [undefined, null, {}, { sha256: ABC }, { byteLength: 3 },
    ...[undefined, null, 3, Buffer.from(ABC), '', 'a'.repeat(63), 'a'.repeat(65),
      'g'.repeat(64), `${ABC}\n`, ` ${ABC}`, `${'a'.repeat(63)}\n`]
      .map((sha256) => ({ sha256, byteLength: 3 })),
    ...[undefined, null, '3', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 3n, true]
      .map((byteLength) => ({ sha256: ABC, byteLength }))]
  for (const expected of invalid) {
    rejects(() => verifyByteIntegrity(Buffer.from('abc'), expected, limit), 'INVALID_EXPECTED_INTEGRITY')
  }
})

test('unsupported byte containers and detached views are rejected', () => {
  const detached = new Uint8Array([97, 98, 99])
  structuredClone(detached.buffer, { transfer: [detached.buffer] })
  for (const bytes of [undefined, null, 'abc', [97, 98, 99], { byteLength: 3 },
    new ArrayBuffer(3), new DataView(new ArrayBuffer(3)), new Uint16Array([97]),
    new Uint8ClampedArray([97]), new Proxy(new Uint8Array(3), {}), detached]) {
    rejects(() => computeByteIntegrity(bytes, limit), 'INVALID_BYTES')
    rejects(() => verifyByteIntegrity(bytes, abcMetadata, limit), 'INVALID_BYTES')
  }
})

test('shared backing memory and out-of-bounds resizable views are rejected', () => {
  const shared = new SharedArrayBuffer(3)
  for (const bytes of [new Uint8Array(shared), Buffer.from(shared)]) {
    rejects(() => computeByteIntegrity(bytes, limit), 'INVALID_BYTES')
    rejects(() => verifyByteIntegrity(bytes, abcMetadata, limit), 'INVALID_BYTES')
  }
  const resizable = new ArrayBuffer(3, { maxByteLength: 6 })
  const fixed = new Uint8Array(resizable, 0, 3)
  resizable.resize(1)
  rejects(() => computeByteIntegrity(fixed, limit), 'INVALID_BYTES')
  rejects(() => verifyByteIntegrity(fixed, { sha256: EMPTY, byteLength: 0 }, limit), 'INVALID_BYTES')
})

test('cross-realm views and shadowed properties still use intrinsic bounds', () => {
  const foreign = runInNewContext('new Uint8Array([0, 97, 98, 99, 255]).subarray(1, 4)')
  assert.deepEqual(computeByteIntegrity(foreign, limit), abcMetadata)
  const bytes = new Uint8Array([0, 97, 98, 99, 255]).subarray(1, 4)
  Object.defineProperties(bytes, {
    buffer: { get() { throw new Error('synthetic-private-buffer') } },
    byteOffset: { value: 0 },
    byteLength: { value: 0 },
  })
  assert.deepEqual(verifyByteIntegrity(bytes, abcMetadata, limit), abcMetadata)
  rejects(() => computeByteIntegrity(bytes, { maxBytes: 2 }), 'BYTE_LIMIT_EXCEEDED')
})

test('success and failures do not mutate inputs or retain caller buffers', () => {
  const backing = Buffer.from('xabcx')
  const bytes = backing.subarray(1, 4)
  const before = Buffer.from(backing)
  const expected = Object.freeze({ ...abcMetadata })
  const limits = Object.freeze({ ...limit })
  const result = verifyByteIntegrity(bytes, expected, limits)
  computeByteIntegrity(bytes, limits)
  rejects(() => verifyByteIntegrity(bytes, { sha256: '0'.repeat(64), byteLength: 3 }, limits), 'SHA256_MISMATCH')
  rejects(() => computeByteIntegrity(bytes, { maxBytes: 2 }), 'BYTE_LIMIT_EXCEEDED')
  assert.deepEqual(backing, before)
  assert.deepEqual(expected, abcMetadata)
  assert.deepEqual(limits, limit)
  assert.notStrictEqual(result, expected)
  bytes[0] = 100
  assert.deepEqual(result, abcMetadata)
  rejects(() => verifyByteIntegrity(bytes, result, limits), 'SHA256_MISMATCH')
})

test('errors never include raw bytes, supplied metadata or accessor exceptions', () => {
  const secret = 'synthetic-private-data-/tenant/path?token=example'
  const bytes = Buffer.from(secret)
  const limits = { maxBytes: bytes.length }
  const cases = [
    [() => computeByteIntegrity(bytes, { maxBytes: 0 }), 'BYTE_LIMIT_EXCEEDED'],
    [() => computeByteIntegrity(secret, limits), 'INVALID_BYTES'],
    [() => verifyByteIntegrity(bytes, { sha256: secret, byteLength: bytes.length }, limits), 'INVALID_EXPECTED_INTEGRITY'],
    [() => verifyByteIntegrity(bytes, { sha256: '0'.repeat(64), byteLength: bytes.length }, limits), 'SHA256_MISMATCH'],
    [() => verifyByteIntegrity(bytes, { sha256: ABC, byteLength: 1 }, limits), 'BYTE_LENGTH_MISMATCH'],
    [() => computeByteIntegrity(bytes, { get maxBytes() { throw new Error(secret) } }), 'INVALID_LIMITS'],
    [() => verifyByteIntegrity(bytes, { get sha256() { throw new Error(secret) } }, limits), 'INVALID_EXPECTED_INTEGRITY'],
    [() => verifyByteIntegrity(bytes, { sha256: ABC, get byteLength() { throw new Error(secret) } }, limits), 'INVALID_EXPECTED_INTEGRITY'],
  ]
  for (const [fn, code] of cases) {
    rejects(fn, code)
    try { fn() } catch (error) {
      const exposed = `${error}\n${error.stack}\n${JSON.stringify(error)}`
      assert.ok(!exposed.includes(secret))
      assert.ok(!exposed.includes(bytes.toString('hex')))
      assert.ok(!exposed.includes(ABC))
      assert.ok(!exposed.includes('0'.repeat(64)))
    }
  }
})
