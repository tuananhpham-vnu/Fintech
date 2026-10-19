import type { Locale } from '@/lib/api/contracts'
const moneyPattern = /^[1-9]\d*$/
export function validAmount(value: string) {
  return moneyPattern.test(value) && value.length <= 24
}
export function formatMoney(value: string | null, locale: Locale) {
  return value !== null && /^\d+$/.test(value)
    ? new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'VND',
        maximumFractionDigits: 0,
      }).format(BigInt(value))
    : '—'
}
