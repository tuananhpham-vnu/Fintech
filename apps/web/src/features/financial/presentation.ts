import type { Locale } from '@/lib/api/contracts'
import { displayDecimal } from '@/lib/utils/format'

/** Presentation only; move the decimal point as text, never round scorer inputs. */
export function formatRatio(value: string | null | undefined, metric: string, locale: Locale) {
  if (value == null || !/^-?\d+(?:\.\d+)?$/.test(value)) return '—'
  const percent = ['AIC-M03', 'AIC-M06', 'AIC-M07'].includes(metric)
  let shown = value
  if (percent) {
    const negative = value.startsWith('-')
    const [whole, decimal = ''] = value.replace(/^-/, '').split('.')
    const padded = decimal.padEnd(2, '0')
    shown = `${negative ? '-' : ''}${(whole + padded.slice(0, 2)).replace(/^0+(?=\d)/, '')}.${padded.slice(2) || '0'}`
  }
  shown = displayDecimal(shown)
  if (locale === 'vi') shown = shown.replace('.', ',')
  return `${shown}${percent ? '%' : locale === 'vi' ? ' lần' : locale === 'zh-CN' ? ' 倍' : ' times'}`
}

export type FinancialAction = {
  kind: 'create' | 'edit' | 'verify'
  factKey?: string
  nonce: number
}

/** Rounded approximation for non-terminating exact fractions, display only. */
export function formatExactRatio(
  ratio: { numerator: string; denominator: string; decimal: string | null } | null | undefined,
  metric: string,
  locale: Locale,
) {
  if (!ratio) return '—'
  if (ratio.decimal !== null) return formatRatio(ratio.decimal, metric, locale)
  if (
    !/^-?\d+$/.test(ratio.numerator) ||
    !/^\d+$/.test(ratio.denominator) ||
    BigInt(ratio.denominator) === BigInt(0)
  )
    return '—'
  const n = BigInt(ratio.numerator),
    d = BigInt(ratio.denominator),
    negative = n < BigInt(0)
  let scaled = ((negative ? -n : n) * BigInt(1000000)) / d
  const digits = scaled.toString().padStart(7, '0')
  return (
    '≈ ' +
    formatRatio(`${negative ? '-' : ''}${digits.slice(0, -6)}.${digits.slice(-6)}`, metric, locale)
  )
}

export function zeroDebtException(metric: { metric_id: string; status: string; flags?: string[] }) {
  return (
    metric.metric_id === 'AIC-M05' &&
    metric.status === 'available' &&
    metric.flags?.includes('VERIFIED_ZERO_INTEREST_ZERO_DEBT') === true
  )
}
