import { Decimal, type ExactValue } from './decimal'
import { FHI_METHOD_ID, FHI_METHOD_VERSION, FHI_METRICS } from './fhi-method'
import type { FhiEngineResult } from './fhi-scorer'
import { INTERNATIONAL_METHOD_VERSIONS } from './accounting-profiles'

const missingData = new Set([
  'MISSING_FACT',
  'UNVERIFIED_FACT',
  'QUICK_ASSETS_UNAVAILABLE',
  'EBITDA_BRIDGE_UNAVAILABLE',
  'OPERATING_PROFIT_BRIDGE_UNAVAILABLE',
])

export interface PartialAssessment {
  kind: 'data_limited_bounds'
  available_points: string
  available_max_points: string
  unresolved_max_points: string
  lower_bound: string
  upper_bound: string
  total_metric_count: 7
  components: { metric_id: string; points: string; max_points: string }[]
  unresolved_metric_ids: string[]
}

const exact = (v: ExactValue) => Decimal.fraction(BigInt(v.numerator), BigInt(v.denominator))
// Bounds round outwards, never narrowing uncertainty due to display rounding.
function bound(value: Decimal, upper: boolean) {
  const scaled = value.numerator * 10n
  const tenths = scaled / value.denominator + (upper && scaled % value.denominator ? 1n : 0n)
  return Decimal.fraction(tenths, 10n).format(1)
}

/** An optional evidence-coverage summary; never a replacement FHI total/band or PD.
 * No weights are redistributed and no missing source facts are fabricated.
 * Only reviewed company cases in an active approved scope can expose these bounds.
 */
export function partialAssessment(
  engine: FhiEngineResult | null,
  context: { company: boolean; policyActive: boolean; reviewAllowed: boolean; blockers: string[] },
): PartialAssessment | null {
  if (!context.company || !context.policyActive || !context.reviewAllowed || !engine ||
      engine.method_id !== FHI_METHOD_ID || ![FHI_METHOD_VERSION, ...INTERNATIONAL_METHOD_VERSIONS].includes(engine.method_version as any) ||
      engine.calculation.status !== 'incomplete' || engine.metrics.length !== FHI_METRICS.length ||
      !context.blockers.length || context.blockers.some(code => !missingData.has(code))) return null

  let known = Decimal.parse('0'), covered = Decimal.parse('0'), unresolved = Decimal.parse('0')
  const components: PartialAssessment['components'] = [], missing: string[] = []
  for (const definition of FHI_METRICS) {
    const matches = engine.metrics.filter(m => m.metric_id === definition.id)
    if (matches.length !== 1) return null
    const metric = matches[0], max = Decimal.parse(definition.max_points)
    if (metric.max_points !== definition.max_points ||
        metric.formula_id !== `${FHI_METHOD_ID}/${engine.method_version}/${definition.id}`) return null
    if (metric.status === 'available') {
      if (!metric.points || metric.blockers.length || !metric.source_facts.length) return null
      const points = exact(metric.points)
      if (points.compare(Decimal.parse('0')) < 0 || points.compare(max) > 0) return null
      known = known.add(points)
      covered = covered.add(max)
      components.push({metric_id: metric.metric_id, points: points.format(12), max_points: metric.max_points})
    } else {
      if (!metric.blockers.length || metric.blockers.some(b => !missingData.has(b.code))) return null
      missing.push(metric.metric_id)
      unresolved = unresolved.add(max)
    }
  }
  if (!components.length || !missing.length) return null
  return {
    kind: 'data_limited_bounds',
    available_points: known.format(2),
    available_max_points: covered.format(0),
    unresolved_max_points: unresolved.format(0),
    lower_bound: bound(known, false),
    upper_bound: bound(known.add(unresolved), true),
    total_metric_count: 7,
    components,
    unresolved_metric_ids: missing,
  }
}
