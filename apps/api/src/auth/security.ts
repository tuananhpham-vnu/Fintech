import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Request } from 'express'
import { FoundationError } from '../foundation/errors'
import type { AuthSession, FoundationConfig, SessionOutput } from '../foundation/ports'
import { MAX_PASSWORD_BYTES, MAX_PASSWORD_LENGTH } from './password'

export const MAX_USERNAME_LENGTH = 256
export const MAX_USERNAME_BYTES = 256
export const MAX_COOKIE_HEADER_BYTES = 16384
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/

export type AuthRequest = Request & { user?: AuthSession['user']; session?: AuthSession }

export function isSessionToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    OPAQUE_TOKEN.test(value) &&
    Buffer.from(value, 'base64url').toString('base64url') === value
  )
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Key is the opaque cookie's exact text, message is the versioned label. */
export function deriveCsrfToken(token: string): string {
  return createHmac('sha256', token).update('AIC-CSRF-1', 'utf8').digest('base64url')
}

/** JSON tuple avoids delimiter collisions; no raw username/IP is persisted. */
export function loginBucketHash(username: string, peerAddress: string): string {
  return createHash('sha256')
    .update(JSON.stringify(['AIC-LOGIN-1', username, peerAddress]), 'utf8')
    .digest('hex')
}

function cookieHeader(request: Pick<Request, 'headers'>): string | undefined {
  const header = request.headers.cookie
  if (
    typeof header !== 'string' ||
    header.length > MAX_COOKIE_HEADER_BYTES ||
    Buffer.byteLength(header, 'utf8') > MAX_COOKIE_HEADER_BYTES
  )
    return undefined
  return header
}

/** Presence is separate from validity, solely to select the generic 401 code. */
export function hasSessionCookie(
  request: Pick<Request, 'headers'>,
  config: Pick<FoundationConfig, 'cookieName'>,
): boolean {
  return (
    cookieHeader(request)
      ?.split(';')
      .some((field) => {
        const separator = field.indexOf('=')
        return separator >= 0 && field.slice(0, separator).trim() === config.cookieName
      }) ?? false
  )
}

/** Read only the named wire cookie; do not depend on cookie-parser precedence. */
export function readCookie(
  request: Pick<Request, 'headers'>,
  config: Pick<FoundationConfig, 'cookieName'>,
): string | undefined {
  const header = cookieHeader(request)
  if (header === undefined) return undefined
  let found: string | undefined
  let matches = 0
  for (const field of header.split(';')) {
    const separator = field.indexOf('=')
    if (separator < 0 || field.slice(0, separator).trim() !== config.cookieName) continue
    matches += 1
    const value = field.slice(separator + 1).trim()
    if (isSessionToken(value)) found = value
  }
  return matches === 1 ? found : undefined
}

export function validateOrigin(
  request: Pick<Request, 'headers'>,
  config: Pick<FoundationConfig, 'allowedOrigins'>,
): void {
  const origin = request.headers.origin
  if (
    typeof origin !== 'string' ||
    origin.length > 2048 ||
    origin === 'null' ||
    !config.allowedOrigins.includes(origin)
  )
    throw new FoundationError(403, 'ORIGIN_REJECTED')
  // Even a misconfigured allowlist cannot allow opaque origins, paths or credentials.
  try {
    const parsed = new URL(origin)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== origin) {
      throw new Error('Invalid origin')
    }
  } catch {
    throw new FoundationError(403, 'ORIGIN_REJECTED')
  }
}

export function validateCsrf(request: Pick<Request, 'headers'>, session: AuthSession): void {
  const supplied = request.headers['x-csrf-token']
  if (supplied === undefined || supplied === '') throw new FoundationError(403, 'CSRF_REQUIRED')
  if (
    !isSessionToken(supplied) ||
    !isSessionToken(session.csrfToken) ||
    !timingSafeEqual(Buffer.from(supplied, 'utf8'), Buffer.from(session.csrfToken, 'utf8'))
  ) {
    throw new FoundationError(403, 'CSRF_MISMATCH')
  }
}

export function isUnsafeMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

export function validateLogin(body: unknown): { username: string; password: string } {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    (Object.getPrototypeOf(body) !== Object.prototype && Object.getPrototypeOf(body) !== null)
  ) {
    throw new FoundationError(422, 'INVALID_INPUT')
  }
  const fields = Reflect.ownKeys(body)
  if (fields.length !== 2 || !Object.hasOwn(body, 'username') || !Object.hasOwn(body, 'password')) {
    throw new FoundationError(422, 'INVALID_INPUT')
  }
  const { username, password } = body as { username: unknown; password: unknown }
  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    !username.trim() ||
    !password.trim() ||
    username.length > MAX_USERNAME_LENGTH * 2 ||
    password.length > MAX_PASSWORD_LENGTH * 2 ||
    Array.from(username).length > MAX_USERNAME_LENGTH ||
    Array.from(password).length > MAX_PASSWORD_LENGTH ||
    Buffer.byteLength(username, 'utf8') > MAX_USERNAME_BYTES ||
    Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES
  ) {
    throw new FoundationError(422, 'INVALID_INPUT')
  }
  // Preserve both values exactly: neither passwords nor account identities are normalized.
  return { username, password }
}

export function sessionOutput(session: AuthSession): SessionOutput {
  return { user: session.user, csrf_token: session.csrfToken, expires_at: session.expiresAt }
}
