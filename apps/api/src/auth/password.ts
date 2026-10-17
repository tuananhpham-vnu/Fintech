import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

export const MAX_PASSWORD_LENGTH = 1024
export const MAX_PASSWORD_BYTES = 1024
const PREFIX = 'scrypt$v1$32768$8$1$'
const OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const ENCODING = /^scrypt\$v1\$32768\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/
// A real, precomputed scrypt value: missing/malformed records still pay one KDF.
const DUMMY =
  'scrypt$v1$32768$8$1$ABEiM0RVZneImaq7zN3u_w$gb6YZj8L09iUU6QOdapo_p2GuQFb4NHrit3RfHGBjKB9yg8GIA7MreVYVv-fxo-5UDLhOje0dWegvRQOyVwWIA'

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, OPTIONS, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

function parse(encoded: string): { salt: Buffer; key: Buffer } | null {
  if (typeof encoded !== 'string' || encoded.length !== PREFIX.length + 22 + 1 + 86) return null
  const match = ENCODING.exec(encoded)
  if (!match) return null
  const salt = Buffer.from(match[1], 'base64url')
  const key = Buffer.from(match[2], 'base64url')
  if (
    salt.length !== 16 ||
    key.length !== 64 ||
    salt.toString('base64url') !== match[1] ||
    key.toString('base64url') !== match[2]
  )
    return null
  return { salt, key }
}

function bounded(password: string): boolean {
  return (
    typeof password === 'string' &&
    password.length > 0 &&
    password.length <= MAX_PASSWORD_LENGTH * 2 &&
    Array.from(password).length <= MAX_PASSWORD_LENGTH &&
    Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES
  )
}

/** Version 1 fixes all work factors; encoded input can never select KDF costs. */
export async function hashPassword(password: string): Promise<string> {
  if (!bounded(password)) throw new RangeError('Password exceeds transport bounds or is empty')
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return `${PREFIX}${salt.toString('base64url')}$${key.toString('base64url')}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (!bounded(password)) return false
  const parsed = parse(encoded)
  const target = parsed ?? parse(DUMMY)!
  const key = await derive(password, target.salt)
  const equal = timingSafeEqual(key, target.key)
  return parsed !== null && equal
}
