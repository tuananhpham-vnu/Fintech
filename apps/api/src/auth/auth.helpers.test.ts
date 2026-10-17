import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { FoundationError } from '../foundation/errors'
import type { AuthSession } from '../foundation/ports'
import { hashPassword, MAX_PASSWORD_BYTES, MAX_PASSWORD_LENGTH, verifyPassword } from './password'
import {
  deriveCsrfToken,
  hashToken,
  hasSessionCookie,
  isSessionToken,
  isUnsafeMethod,
  loginBucketHash,
  MAX_COOKIE_HEADER_BYTES,
  MAX_USERNAME_BYTES,
  MAX_USERNAME_LENGTH,
  readCookie,
  sessionOutput,
  validateCsrf,
  validateLogin,
  validateOrigin,
} from './security'

const TOKEN = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE'
const CSRF = 'MHu7escXp3QdTdH4nc2-SpbCPauDtLLsD559vu0KjP0'
const config = { cookieName: 'custom_session', allowedOrigins: ['https://aic.example'] }
const session: AuthSession = {
  id: 'session-id',
  user: {
    id: 'user-id',
    organization_id: 'org-id',
    display_name: 'Specialist',
    role: 'specialist',
  },
  csrfToken: CSRF,
  expiresAt: '2026-10-16T08:00:00.000Z',
}

function error(status: number, code: string): (caught: unknown) => boolean {
  return (caught) =>
    caught instanceof FoundationError &&
    caught.getStatus() === status &&
    (caught.getResponse() as { code: string }).code === code
}

test('scrypt v1 round trips, salts differ, and password whitespace is significant', async () => {
  const first = await hashPassword('  correct password  ')
  const second = await hashPassword('  correct password  ')
  assert.match(first, /^scrypt\$v1\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/)
  assert.notEqual(first, second)
  assert.equal(await verifyPassword('  correct password  ', first), true)
  assert.equal(await verifyPassword('correct password', first), false)
  assert.equal(await verifyPassword('wrong password', first), false)
})

test('missing, malformed, noncanonical and attacker-selected KDF costs fail closed', async () => {
  const encoded = await hashPassword('password')
  const pieces = encoded.split('$')
  // Last base64url salt character has four unused bits: reject equivalent encodings.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const last = pieces[5].at(-1)!
  pieces[5] = pieces[5].slice(0, -1) + alphabet[alphabet.indexOf(last) + 1]
  for (const candidate of [
    '',
    'x'.repeat(20000),
    pieces.join('$'),
    encoded.replace('$32768$', '$1073741824$'),
    encoded.replace('$v1$', '$v2$'),
  ]) {
    assert.equal(await verifyPassword('password', candidate), false)
  }
  assert.equal(await verifyPassword('AIC dummy password v1', ''), false)
})

test('password byte limits bound work before the KDF', async () => {
  await assert.rejects(hashPassword(''), RangeError)
  await assert.rejects(hashPassword('x'.repeat(MAX_PASSWORD_LENGTH + 1)), RangeError)
  await assert.rejects(hashPassword('x'.repeat(MAX_PASSWORD_BYTES + 1)), RangeError)
  await assert.rejects(hashPassword('é'.repeat(MAX_PASSWORD_BYTES)), RangeError)
  assert.equal(await verifyPassword('x'.repeat(MAX_PASSWORD_BYTES + 1), ''), false)
})

test('published transport byte limits handle Unicode without coercion or truncation', async () => {
  const body = {
    username: '😀'.repeat(MAX_USERNAME_BYTES / 4),
    password: '😀'.repeat(MAX_PASSWORD_BYTES / 4),
  }
  assert.deepEqual(validateLogin(body), body)
  assert.equal(await verifyPassword(body.password, await hashPassword(body.password)), true)
  assert.throws(
    () => validateLogin({ ...body, username: `${body.username}x` }),
    error(422, 'INVALID_INPUT'),
  )
  assert.throws(
    () => validateLogin({ ...body, password: `${body.password}x` }),
    error(422, 'INVALID_INPUT'),
  )
  assert.deepEqual(
    validateLogin({
      username: 'u'.repeat(MAX_USERNAME_LENGTH),
      password: 'p'.repeat(MAX_PASSWORD_LENGTH),
    }),
    { username: 'u'.repeat(MAX_USERNAME_LENGTH), password: 'p'.repeat(MAX_PASSWORD_LENGTH) },
  )
})

test('login accepts only the exact two nonblank, bounded string fields', () => {
  assert.deepEqual(validateLogin({ username: ' user ', password: ' pass ' }), {
    username: ' user ',
    password: ' pass ',
  })
  for (const body of [
    null,
    [],
    'text',
    1,
    {},
    { username: 'u' },
    { username: 'u', password: 'p', role: 'admin' },
    { username: 'u', password: ' \t\n' },
    { username: ' ', password: 'p' },
    { username: 'u', password: 123 },
    { username: 'x'.repeat(MAX_USERNAME_LENGTH + 1), password: 'p' },
    { username: 'x'.repeat(MAX_USERNAME_BYTES + 1), password: 'p' },
    { username: 'é'.repeat(MAX_USERNAME_BYTES), password: 'p' },
    { username: 'u', password: 'é'.repeat(MAX_PASSWORD_BYTES) },
    Object.create({ username: 'u', password: 'p' }),
    { username: 'u', password: 'p', [Symbol('unexpected')]: true },
  ]) {
    assert.throws(() => validateLogin(body), error(422, 'INVALID_INPUT'))
  }
})

test('hash and versioned CSRF have stable vectors and use the opaque token as HMAC key', () => {
  assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(deriveCsrfToken(TOKEN), CSRF)
  assert.notEqual(deriveCsrfToken('B'.repeat(43)), CSRF)
})

test('account+IP hashes separate both dimensions and cannot collide through delimiters', () => {
  const hash = loginBucketHash('account', '127.0.0.1')
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.notEqual(hash, loginBucketHash('other-account', '127.0.0.1'))
  assert.notEqual(hash, loginBucketHash('account', '127.0.0.2'))
  assert.notEqual(loginBucketHash('a:b', 'c'), loginBucketHash('a', 'b:c'))
})

test('wire cookies honor the configured name and reject ambiguous or malformed tokens', () => {
  assert.equal(
    readCookie({ headers: { cookie: `other=value; custom_session=${TOKEN}` } }, config),
    TOKEN,
  )
  for (const cookie of [
    undefined,
    `other=${TOKEN}`,
    `custom_session=${TOKEN}; custom_session=${TOKEN}`,
    `custom_session=${TOKEN}; custom_session=bad`,
    `custom_session="${TOKEN}"`,
    'custom_session=bad',
    `custom_session=${TOKEN}=`,
    `custom_session=${TOKEN.slice(0, -1)}F`,
    `other=${'x'.repeat(MAX_COOKIE_HEADER_BYTES)}; custom_session=${TOKEN}`,
  ]) {
    assert.equal(readCookie({ headers: { cookie } }, config), undefined)
  }
  assert.equal(isSessionToken(TOKEN), true)
  assert.equal(isSessionToken(`${TOKEN}\n`), false)
  assert.equal(isSessionToken('a'.repeat(43)), false)
})

test('session cookie presence distinguishes absent from supplied invalid tokens', () => {
  assert.equal(hasSessionCookie({ headers: {} }, config), false)
  assert.equal(hasSessionCookie({ headers: { cookie: `other=${TOKEN}` } }, config), false)
  assert.equal(hasSessionCookie({ headers: { cookie: 'custom_session=bad' } }, config), true)
  assert.equal(hasSessionCookie({ headers: { cookie: 'custom_session=' } }, config), true)
  assert.equal(
    hasSessionCookie(
      { headers: { cookie: `custom_session=${TOKEN}; custom_session=bad` } },
      config,
    ),
    true,
  )
})

test('Origin must be an exact canonical allowlisted HTTP(S) origin', () => {
  validateOrigin({ headers: { origin: 'https://aic.example' } }, config)
  for (const origin of [
    undefined,
    'null',
    'https://aic.example/',
    'https://aic.example/path',
    'https://aic.example.evil',
    'https://evil.example',
    'https://user@aic.example',
    'HTTPS://aic.example',
  ]) {
    assert.throws(
      () => validateOrigin({ headers: { origin } }, config),
      error(403, 'ORIGIN_REJECTED'),
    )
  }
  for (const origin of [
    'null',
    'https://user@aic.example',
    'https://aic.example/path',
    'ftp://aic.example',
  ]) {
    assert.throws(
      () => validateOrigin({ headers: { origin } }, { allowedOrigins: [origin] }),
      error(403, 'ORIGIN_REJECTED'),
    )
  }
})

test('CSRF accepts only the exact token, rejecting missing, duplicate, padded and changed values', () => {
  validateCsrf({ headers: { 'x-csrf-token': CSRF } }, session)
  for (const supplied of [undefined, '']) {
    assert.throws(
      () => validateCsrf({ headers: { 'x-csrf-token': supplied } }, session),
      error(403, 'CSRF_REQUIRED'),
    )
  }
  for (const supplied of ['x', `${CSRF} `, [CSRF, CSRF], TOKEN, `${CSRF.slice(0, -1)}1`]) {
    assert.throws(
      () => validateCsrf({ headers: { 'x-csrf-token': supplied } }, session),
      error(403, 'CSRF_MISMATCH'),
    )
  }
})

test('every method except GET, HEAD and OPTIONS requires mutation protection', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'get'])
    assert.equal(isUnsafeMethod(method), false)
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'TRACE', 'CONNECT'])
    assert.equal(isUnsafeMethod(method), true)
})

test('wire sessions expose only principal, CSRF and absolute expiry', () => {
  assert.deepEqual(sessionOutput(session), {
    user: session.user,
    csrf_token: CSRF,
    expires_at: session.expiresAt,
  })
  assert.deepEqual(Object.keys(sessionOutput(session)).sort(), ['csrf_token', 'expires_at', 'user'])
})
