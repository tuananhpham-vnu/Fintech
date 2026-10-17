import { Decimal, ExactValue } from './decimal'

export const FHI_METHOD_ID = 'AIC-FHI-1.0' as const
export const FHI_METHOD_VERSION = '1.0.0' as const
export const FHI_PILOT_SCOPE = 'DISTRIBUTION_WHOLESALE_PILOT' as const

/** Construction specification from owner v2 F10/F11, not a registry approval artifact. */
export const FHI_RUNTIME_STATE = Object.freeze({
  method_status: 'unconfigured' as const,
  pilot_authorized: false as const,
})

export const FHI_FACT_KEYS = Object.freeze([
  'current_assets',
  'current_liabilities',
  'cash',
  'unrestricted_short_term_equivalents',
  'trade_receivables',
  'total_equity',
  'total_assets',
  'total_liabilities',
  'interest_bearing_debt',
  'operating_profit',
  'depreciation_amortization',
  'interest_expense',
  'net_revenue',
  'cash_from_operations',
] as const)
export type FhiFactKey = (typeof FHI_FACT_KEYS)[number]
export type FhiMetricId =
  'AIC-M01' | 'AIC-M02' | 'AIC-M03' | 'AIC-M04' | 'AIC-M05' | 'AIC-M06' | 'AIC-M07'
export type FhiGroup = 'liquidity' | 'capital' | 'leverage' | 'profitability'
export type FhiBand = 'AIC-F1' | 'AIC-F2' | 'AIC-F3' | 'AIC-F4' | 'AIC-F5'
export interface FhiAnchor {
  readonly value: string
  readonly credit: string
}
export interface FhiMetricDefinition {
  readonly id: FhiMetricId
  readonly group: FhiGroup
  readonly formula_id: string
  readonly formula: string
  readonly max_points: string
  readonly required_facts: readonly FhiFactKey[]
  readonly anchors: readonly FhiAnchor[]
}

function metric(
  id: FhiMetricId,
  group: FhiGroup,
  formula: string,
  max_points: string,
  required_facts: FhiFactKey[],
  anchors: [string, string][],
): FhiMetricDefinition {
  return Object.freeze({
    id,
    group,
    formula_id: `${FHI_METHOD_ID}/${FHI_METHOD_VERSION}/${id}`,
    formula,
    max_points,
    required_facts: Object.freeze(required_facts),
    anchors: Object.freeze(anchors.map(([value, credit]) => Object.freeze({ value, credit }))),
  })
}

export const FHI_METRICS: readonly FhiMetricDefinition[] = Object.freeze([
  metric(
    'AIC-M01',
    'liquidity',
    'current_assets / current_liabilities',
    '15',
    ['current_assets', 'current_liabilities'],
    [
      ['0', '0'],
      ['0.75', '0.2'],
      ['1.25', '0.65'],
      ['2', '1'],
    ],
  ),
  metric(
    'AIC-M02',
    'liquidity',
    '(cash + unrestricted_short_term_equivalents + trade_receivables) / current_liabilities',
    '10',
    ['cash', 'unrestricted_short_term_equivalents', 'trade_receivables', 'current_liabilities'],
    [
      ['0', '0'],
      ['0.5', '0.2'],
      ['1', '0.75'],
      ['1.5', '1'],
    ],
  ),
  metric(
    'AIC-M03',
    'capital',
    'total_equity / total_assets',
    '20',
    ['total_equity', 'total_assets'],
    [
      ['-0.3', '0'],
      ['0', '0.1'],
      ['0.2', '0.45'],
      ['0.4', '0.8'],
      ['0.65', '1'],
    ],
  ),
  metric(
    'AIC-M04',
    'leverage',
    'interest_bearing_debt / (operating_profit + depreciation_amortization)',
    '10',
    ['interest_bearing_debt', 'operating_profit', 'depreciation_amortization'],
    [
      ['0', '1'],
      ['1', '0.9'],
      ['2.5', '0.6'],
      ['4', '0.3'],
      ['7', '0'],
    ],
  ),
  metric(
    'AIC-M05',
    'leverage',
    'operating_profit / interest_expense',
    '15',
    ['operating_profit', 'interest_expense'],
    [
      ['0', '0'],
      ['1', '0.15'],
      ['2', '0.45'],
      ['4', '0.8'],
      ['7', '1'],
    ],
  ),
  metric(
    'AIC-M06',
    'profitability',
    'operating_profit / net_revenue',
    '10',
    ['operating_profit', 'net_revenue'],
    [
      ['-0.15', '0'],
      ['0', '0.2'],
      ['0.08', '0.55'],
      ['0.2', '1'],
    ],
  ),
  metric(
    'AIC-M07',
    'profitability',
    'cash_from_operations / net_revenue',
    '20',
    ['cash_from_operations', 'net_revenue'],
    [
      ['-0.15', '0'],
      ['0', '0.2'],
      ['0.08', '0.65'],
      ['0.2', '1'],
    ],
  ),
])

export const FHI_GROUPS = Object.freeze([
  Object.freeze({ id: 'liquidity' as const, max_points: '25' }),
  Object.freeze({ id: 'capital' as const, max_points: '20' }),
  Object.freeze({ id: 'leverage' as const, max_points: '25' }),
  Object.freeze({ id: 'profitability' as const, max_points: '30' }),
])

export interface FhiAnchorSegment {
  kind: 'anchor' | 'interpolated' | 'clamped_low' | 'clamped_high' | 'verified_zero_debt_exception'
  lower: FhiAnchor | null
  upper: FhiAnchor | null
  /** Exact (ratio - lower.value) / (upper.value - lower.value). */
  position: ExactValue | null
}

/** Anchors/weights are fixed above; callers cannot inject an approved or alternate method. */
export function interpolateFhiMetric(
  metricId: FhiMetricId,
  ratio: Decimal,
): {
  segment: FhiAnchorSegment
  credit: Decimal
  points: Decimal
} {
  const definition = FHI_METRICS.find((item) => item.id === metricId)
  if (!definition) throw new TypeError('Unknown FHI metric ID')
  const anchors = definition.anchors
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  let credit: Decimal
  let segment: FhiAnchorSegment
  const exact = anchors.find((anchor) => ratio.compare(Decimal.parse(anchor.value)) === 0)
  if (exact) {
    credit = Decimal.parse(exact.credit)
    segment = { kind: 'anchor', lower: exact, upper: exact, position: null }
  } else if (
    ratio.compare(Decimal.parse(first.value)) < 0 ||
    ratio.compare(Decimal.parse(last.value)) > 0
  ) {
    const low = ratio.compare(Decimal.parse(first.value)) < 0
    const endpoint = low ? first : last
    credit = Decimal.parse(endpoint.credit)
    segment = {
      kind: low ? 'clamped_low' : 'clamped_high',
      lower: endpoint,
      upper: endpoint,
      position: null,
    }
  } else {
    const index = anchors.findIndex((anchor) => ratio.compare(Decimal.parse(anchor.value)) < 0)
    const lower = anchors[index - 1]
    const upper = anchors[index]
    const position = ratio
      .sub(Decimal.parse(lower.value))
      .div(Decimal.parse(upper.value).sub(Decimal.parse(lower.value)))
    credit = Decimal.parse(lower.credit).add(
      position.mul(Decimal.parse(upper.credit).sub(Decimal.parse(lower.credit))),
    )
    segment = { kind: 'interpolated', lower, upper, position: position.toExact() }
  }
  return { segment, credit, points: credit.mul(Decimal.parse(definition.max_points)) }
}

/** Classification uses the exact total, before display rounding. */
export function fhiBandForTotal(total: Decimal): FhiBand {
  if (total.compare(Decimal.parse('0')) < 0 || total.compare(Decimal.parse('100')) > 0)
    throw new RangeError('FHI total must be between 0 and 100')
  if (total.compare(Decimal.parse('85')) >= 0) return 'AIC-F1'
  if (total.compare(Decimal.parse('70')) >= 0) return 'AIC-F2'
  if (total.compare(Decimal.parse('55')) >= 0) return 'AIC-F3'
  if (total.compare(Decimal.parse('40')) >= 0) return 'AIC-F4'
  return 'AIC-F5'
}
