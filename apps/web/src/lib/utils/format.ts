import type { Locale } from '@/lib/api/contracts'
export function formatTime(value: string, locale: Locale) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(date)
}
export function displayValue(value: unknown) {
  return value === null || value === undefined
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value, null, 2)
      : String(value)
}

/** Presentation only: retain every significant digit without floating-point conversion. */
export function displayDecimal(value: unknown) {
  const text = displayValue(value)
  return /^-?\d+\.\d+$/.test(text) ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}
