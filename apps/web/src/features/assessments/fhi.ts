import type { Assessment } from '@/lib/api/contracts'

/** Display reference from Notion 13 §4. No scoring/interpolation runs in FE. */
export const fhiMetrics = [
  { id: 'AIC-M01', group: 'liquidity', formula: 'current_assets / current_liabilities', max: '15' },
  { id: 'AIC-M02', group: 'liquidity', formula: 'quick_assets / current_liabilities', max: '10' },
  { id: 'AIC-M03', group: 'capital', formula: 'total_equity / total_assets', max: '20' },
  {
    id: 'AIC-M04',
    group: 'leverage',
    formula: 'interest_bearing_debt / ebitda_candidate',
    max: '10',
  },
  { id: 'AIC-M05', group: 'leverage', formula: 'operating_profit / interest_expense', max: '15' },
  { id: 'AIC-M06', group: 'profitability', formula: 'operating_profit / net_revenue', max: '10' },
  {
    id: 'AIC-M07',
    group: 'profitability',
    formula: 'cash_from_operations / net_revenue',
    max: '20',
  },
] as const

export function hasCompleteFhi(result: Assessment | null | undefined) {
  const health = result?.financial_health
  return (
    !!health &&
    health.components.length === fhiMetrics.length &&
    health.score !== null &&
    health.band !== null &&
    !health.blockers?.length &&
    !health.missing_facts?.length &&
    fhiMetrics.every((metric) => {
      const matches = health.components.filter((part) => part.metric_id === metric.id)
      const part = matches[0]
      return (
        matches.length === 1 &&
        part.points !== null &&
        (part.raw_value !== null ||
          (result?.purpose === 'company_health' &&
            result.case_aggregation?.method === 'mean_metric_points_v1' &&
            !!result.case_aggregation.metrics.find(m => m.metric_id === metric.id)?.contributions.length) ||
          (part.verification_state === 'verified_zero_debt_exception' &&
            part.flags?.includes('VERIFIED_ZERO_INTEREST_ZERO_DEBT'))) &&
        part.max_points === metric.max &&
        part.source_facts.length > 0 &&
        !part.blockers?.length
      )
    })
  )
}
