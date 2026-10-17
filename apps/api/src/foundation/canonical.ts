import { createHash } from 'crypto'
import { FoundationError } from './errors'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonicalJson((value as any)[key]))
        .join(',') +
      '}'
    )
  }
  throw new FoundationError(422, 'INVALID_INPUT', 'Expected JSON values')
}
export const requestHash = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex')
