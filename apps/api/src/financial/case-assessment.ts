import { Decimal, type ExactValue } from './decimal'
import { FHI_GROUPS, FHI_METHOD_ID, FHI_METHOD_VERSION, FHI_METRICS, FHI_RUNTIME_STATE, fhiBandForTotal } from './fhi-method'
import type { FhiEngineResult, FhiMetricTrace } from './fhi-scorer'
import { accountingProfile, fullFinancialYear, type AccountingProfile } from './accounting-profiles'

export const CASE_AGGREGATION_METHOD = 'mean_metric_points_v1' as const
export const CASE_ASSESSMENT_VERSION = `${FHI_METHOD_ID}/${FHI_METHOD_VERSION}/${CASE_AGGREGATION_METHOD}`
const exact = (v: ExactValue) => Decimal.fraction(BigInt(v.numerator), BigInt(v.denominator))
const zero = () => Decimal.parse('0')
const display = (v: ExactValue | null) => v ? exact(v).format(12) : null

export interface CaseAggregation {
  method: typeof CASE_AGGREGATION_METHOD
  accounting_profile?: AccountingProfile
  included_set_ids: string[]
  excluded_sets: { set_id: string; set_revision: number; reasons: string[] }[]
  metrics: {
    metric_id: string
    contributions: {
      set_id: string
      set_revision: number
      period: { kind: string; start_date: string; end_date: string }
      points: string
      raw_value: string | null
      source_fact_ids: string[]
    }[]
    omitted_sets: { set_id: string; blockers: string[] }[]
  }[]
}

/** Owner-selected case recipe. Score each intact annual set before averaging points.
 * Missing years/components have no vote. Original metric weights are applied once.
 * No source values, ratios, units, bases or annual/interim cash flows are combined.
 */
export function aggregateCaseAssessment(records: {
  set: any; engine: FhiEngineResult | null; blockers: string[]
}[], selectedBasis?: 'standalone' | 'consolidated') {
  const summary: CaseAggregation = { method: CASE_AGGREGATION_METHOD, included_set_ids: [], excluded_sets: [], metrics: [] }
  const blockers: string[] = []
  const eligible: typeof records = []
  for (const record of records) {
    const { set, engine } = record, p = set.scope.period
    const reasons = [...record.blockers.filter(b => ['INVALID_SCOPE', 'COUNTRY_METHOD_NOT_VALIDATED'].includes(b))]
    if (selectedBasis && set.scope.basis!==selectedBasis) reasons.push('REPORTING_BASIS_NOT_SELECTED')
    if (accountingProfile(set.scope) ? !fullFinancialYear(p)
      : p.kind !== 'FY' || p.start_date !== `${p.end_date.slice(0, 4)}-01-01` || !p.end_date.endsWith('-12-31'))
      reasons.push('FULL_CALENDAR_FY_REQUIRED')
    if (set.metadata.observation_kind !== 'actual' || set.scope.accounting_regime === 'UNKNOWN')
      reasons.push('ACTUAL_KNOWN_ACCOUNTING_BASIS_REQUIRED')
    if (!engine || engine.metrics.some(m => m.blockers.some(b => ['INVALID_SCOPE', 'OUT_OF_PILOT_SCOPE'].includes(b.code))))
      reasons.push('OUT_OF_PILOT_SCOPE')
    if (records.some(r => r.set.id !== set.id && r.set.scope.period.kind === p.kind &&
      r.set.scope.period.start_date === p.start_date && r.set.scope.period.end_date === p.end_date && r.set.scope.basis === set.scope.basis)) {
      reasons.push('MULTIPLE_STATEMENT_VERSIONS')
      // Conflicting sources require resolution, rather than choosing a favorable copy.
      if (set.facts.length) blockers.push('MULTIPLE_STATEMENT_VERSIONS')
    }
    if (!reasons.length && !engine!.metrics.some(m => m.status === 'available')) reasons.push('NO_ASSESSABLE_METRICS')
    if (reasons.length) summary.excluded_sets.push({ set_id: set.id, set_revision: set.revision, reasons: [...new Set(reasons)] })
    else eligible.push(record)
  }
  const cohortKeys = ['entity_id', 'country', 'industry', 'pilot_scope', 'basis', 'accounting_regime', 'currency']
  if (eligible.length > 1 && eligible.some(r => cohortKeys.some(key => r.set.scope[key] !== eligible[0].set.scope[key])))
    blockers.push('INCOMPATIBLE_CASE_SCOPE')
  const profile = accountingProfile(eligible[0]?.set.scope)
  if (profile) summary.accounting_profile = profile
  const methodVersion = profile?.method_version ?? FHI_METHOD_VERSION
  if (eligible.some(r => r.engine?.method_version !== methodVersion)) blockers.push('INCOMPATIBLE_CASE_SCOPE')
  const metrics: FhiMetricTrace[] = FHI_METRICS.map(definition => {
    const candidates = eligible.map(r => ({ ...r, metric: r.engine!.metrics.find(m => m.metric_id === definition.id)! }))
    const available = candidates.filter(r => r.metric.status === 'available' && r.metric.points && !r.metric.blockers.length)
    summary.metrics.push({
      metric_id: definition.id,
      contributions: available.map(({ set, metric }) => ({
        set_id: set.id, set_revision: set.revision, period: set.scope.period,
        points: display(metric.points)!, raw_value: display(metric.raw_ratio),
        source_fact_ids: metric.source_facts.map(f => f.id),
      })),
      omitted_sets: candidates.filter(r => !available.includes(r)).map(({ set, metric }) => ({
        set_id: set.id, blockers: [...new Set(metric.blockers.map(b => b.code))],
      })),
    })
    for (const { set } of available) if (!summary.included_set_ids.includes(set.id)) summary.included_set_ids.push(set.id)
    const points = available.length
      ? available.reduce((sum, r) => sum.add(exact(r.metric.points!)), zero()).div(Decimal.parse(String(available.length))) : null
    const missing = candidates.flatMap(r => r.metric.blockers)
    const metricBlockers = points ? [] : missing.length ? missing : [{ code: 'MISSING_FACT' as const, metric_id: definition.id }]
    const sources = [...new Map(available.flatMap(r => r.metric.source_facts).map(f => [`${f.id}:${f.revision}`, f])).values()]
    return {
      metric_id: definition.id, group: definition.group,
      formula_id: `${FHI_METHOD_ID}/${methodVersion}/${definition.id}`, formula: definition.formula,
      max_points: definition.max_points, status: points ? 'available' : 'unavailable',
      source_facts: sources, derivation: null, numerator: null, denominator: null,
      // An average of points is not the rubric applied to an average of ratios.
      raw_ratio: null, anchor_segment: null,
      credit: points ? points.div(Decimal.parse(definition.max_points)).toExact() : null,
      points: points?.toExact() ?? null, flags: [], blockers: metricBlockers,
    }
  })
  const complete = metrics.every(m => m.status === 'available')
  const sum = (parts: FhiMetricTrace[]) => parts.reduce((v, m) => v.add(exact(m.points!)), zero())
  const total = complete ? sum(metrics) : null
  const engine: FhiEngineResult = {
    purpose: 'engine_reference_only', method_id: FHI_METHOD_ID, method_version: methodVersion,
    runtime: FHI_RUNTIME_STATE, scope: null, metrics,
    groups: FHI_GROUPS.map(group => {
      const parts = metrics.filter(m => m.group === group.id)
      return { group: group.id, max_points: group.max_points, points: parts.every(m => m.status === 'available') ? sum(parts).toExact() : null }
    }),
    calculation: { status: complete ? 'complete' : 'incomplete', exact_total: total?.toExact() ?? null,
      display_total: total?.format(1) ?? null, candidate_band: total ? fhiBandForTotal(total) : null },
    score: null, band: null, grade: null, pd: null, blockers: metrics.flatMap(m => m.blockers),
  }
  if (!eligible.length) {
    // Preserve why existing statements were excluded instead of reporting them as absent.
    blockers.push(...summary.excluded_sets.flatMap(set => set.reasons))
    blockers.push('FINANCIAL_INPUTS_REQUIRED')
  }
  blockers.push(...engine.blockers.map(b => b.code))
  return { engine, summary, blockers: [...new Set(blockers)] }
}
