import type { AccountingProfile } from './contracts'

export function decodeAccountingProfile(value: unknown): AccountingProfile {
  const p = value as AccountingProfile
  const versions = {
    US_GAAP_DISTRIBUTION_1: ['US', 'US_GAAP', '1.0.0-us-gaap-pilot.1'],
    CN_ASBE_DISTRIBUTION_1: ['CN', 'CN_ASBE', '1.0.0-cn-asbe-pilot.1'],
  } as const
  const expected = p && Object.hasOwn(versions, p.id) ? versions[p.id] : null
  if (
    !expected ||
    Object.keys(p).sort().join(',') !==
      'accounting_regime,country,id,mapping_version,method_version' ||
    p.country !== expected[0] ||
    p.accounting_regime !== expected[1] ||
    p.method_version !== expected[2] ||
    p.mapping_version !== 'international-accounting-v1'
  )
    throw Error('INVALID_API_RESPONSE')
  return p
}

export function isFullFiscalYear(period: { kind: string; start_date: string; end_date: string }) {
  if (
    period.kind !== 'FY' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(period.start_date) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(period.end_date)
  )
    return false
  const start = new Date(period.start_date + 'T00:00:00Z'),
    end = new Date(period.end_date + 'T00:00:00Z')
  if (
    !Number.isFinite(+start) ||
    !Number.isFinite(+end) ||
    start.toISOString().slice(0, 10) !== period.start_date ||
    end.toISOString().slice(0, 10) !== period.end_date
  )
    return false
  const next = new Date(end)
  next.setUTCDate(next.getUTCDate() + 1)
  const anniversary = new Date(start)
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1)
  const days = (+end - +start) / 86400000 + 1
  return +next === +anniversary || days === 364 || days === 371
}
