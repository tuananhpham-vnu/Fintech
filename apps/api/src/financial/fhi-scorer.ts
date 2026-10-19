import { Decimal, ExactValue } from './decimal'
import { accountingProfile, INTERNATIONAL_CASH_KEY, type AccountingProfile } from './accounting-profiles'
import {
  FHI_FACT_KEYS,
  FHI_GROUPS,
  FHI_METHOD_ID,
  FHI_METHOD_VERSION,
  FHI_METRICS,
  FHI_PILOT_SCOPE,
  FHI_RUNTIME_STATE,
  FhiAnchorSegment,
  FhiBand,
  FhiFactKey,
  FhiGroup,
  FhiMetricDefinition,
  FhiMetricId,
  fhiBandForTotal,
  interpolateFhiMetric,
} from './fhi-method'

/** Trusted registry adapter ports, NOT a client/AI verification command or shared wire contract. */
export interface FhiScope {
  country: string
  entity_id: string
  industry: string
  pilot_scope: string
  period: { kind: 'FY' | 'TTM' | 'INTERIM'; start_date: string; end_date: string }
  basis: 'standalone' | 'consolidated'
  accounting_regime: string
  currency: string
  /** Every value is expressed in this source unit. No FX, rescaling or annualization occurs here. */
  unit_multiplier: string
}

export interface FhiVerification {
  status: 'verified' | 'unverified' | 'stale' | 'rejected'
  verified_revision: number | null
  verified_by: string | null
  verified_at: string | null
}

export type FhiSourceRef =
  | {
      kind: 'document'
      document_id: string
      document_version: number
      source_hash: string
      page: number
      quote: string
    }
  | {
      kind: 'verified_entry'
      entry_id: string
      entry_revision: number
    }

export interface FhiFinancialFact {
  id: string
  revision: number
  key: FhiFactKey
  statement_set_id: string
  statement_set_revision: number
  scope: FhiScope
  value: string | null
  verification: FhiVerification
  /** Adapter checks live document/entry dependencies; the pure scorer has no repository access. */
  current_source: boolean
  source_refs: readonly FhiSourceRef[]
}

export interface FhiFactBinding {
  key: FhiFactKey
  fact_id: string
  fact_revision: number
}
export interface FhiVerifiedBridge {
  id: string
  revision: number
  statement_set_id: string
  statement_set_revision: number
  verification: FhiVerification
  current_source: boolean
  source_refs: readonly FhiSourceRef[]
  components: readonly FhiFactBinding[]
  /** Human-verified components do not overlap or count the same amount twice. */
  non_overlapping: boolean
}
export interface FhiQuickAssetsBridge extends FhiVerifiedBridge {
  kind: 'quick_assets'
  /** Source-specific eligibility of all three components, including restrictions/receivability. */
  acceptable_per_source: boolean
}
export interface FhiEbitdaBridge extends FhiVerifiedBridge {
  kind: 'ebitda'
  /** Source establishes that this D&A is an add-back to this EBIT, not another profit definition. */
  da_is_addback_to_ebit: boolean
}
export interface FhiInput {
  statement_set: { id: string; revision: number; scope: FhiScope }
  facts: readonly FhiFinancialFact[]
  quick_assets_bridge: FhiQuickAssetsBridge | null
  ebitda_bridge: FhiEbitdaBridge | null
  /** Trusted adapter metadata; it never establishes verification of a source fact. */
  accounting_profile?: AccountingProfile
  rounding_quantums?: Readonly<Record<string, string>>
  international_operating_profit_reconciled?: boolean
  reviewed_expense_magnitude_fact_ids?: readonly string[]
}

export type FhiBlockerCode =
  | 'INVALID_INPUT'
  | 'INVALID_SCOPE'
  | 'OUT_OF_PILOT_SCOPE'
  | 'UNSUPPORTED_FACT_KEY'
  | 'MISSING_FACT'
  | 'DUPLICATE_FACT'
  | 'INVALID_FACT'
  | 'UNVERIFIED_FACT'
  | 'STALE_FACT'
  | 'SOURCE_UNAVAILABLE'
  | 'STATEMENT_SET_MISMATCH'
  | 'SCOPE_MISMATCH'
  | 'PERIOD_MISMATCH'
  | 'BASIS_MISMATCH'
  | 'ACCOUNTING_REGIME_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'UNIT_MISMATCH'
  | 'INVALID_DECIMAL'
  | 'QUICK_ASSETS_UNAVAILABLE'
  | 'EBITDA_BRIDGE_UNAVAILABLE'
  | 'EBITDA_NON_POSITIVE'
  | 'ZERO_DENOMINATOR'
  | 'ZERO_INTEREST_REQUIRES_VERIFIED_ZERO_DEBT'
  | 'INVALID_FINANCIAL_BOUNDS'
  | 'BALANCE_SHEET_UNRECONCILED'
  | 'OPERATING_PROFIT_BRIDGE_UNAVAILABLE'
export interface FhiBlocker {
  code: FhiBlockerCode
  metric_id?: FhiMetricId
  fact_key?: FhiFactKey
}
export interface FhiFactTrace {
  id: string
  revision: number
  key: FhiFactKey
  value: string | null
  source_refs: readonly FhiSourceRef[]
}
export interface FhiMetricTrace {
  metric_id: FhiMetricId
  group: FhiGroup
  formula_id: string
  formula: string
  max_points: string
  status: 'available' | 'unavailable'
  source_facts: FhiFactTrace[]
  derivation: { id: string; revision: number; source_refs: readonly FhiSourceRef[] } | null
  numerator: ExactValue | null
  denominator: ExactValue | null
  raw_ratio: ExactValue | null
  anchor_segment: FhiAnchorSegment | null
  credit: ExactValue | null
  points: ExactValue | null
  flags: string[]
  blockers: FhiBlocker[]
}
export interface FhiEngineResult {
  purpose: 'engine_reference_only'
  method_id: typeof FHI_METHOD_ID
  method_version: string
  runtime: typeof FHI_RUNTIME_STATE
  scope: FhiScope | null
  metrics: FhiMetricTrace[]
  groups: { group: FhiGroup; max_points: string; points: ExactValue | null }[]
  calculation: {
    status: 'complete' | 'incomplete'
    exact_total: ExactValue | null
    display_total: string | null
    candidate_band: FhiBand | null
  }
  /** Publication remains the application's separately guarded responsibility. */
  score: null
  band: null
  grade: null
  pd: null
  blockers: FhiBlocker[]
}

const ZERO = Decimal.parse('0')
const QUICK_KEYS: readonly FhiFactKey[] = [
  'cash',
  'unrestricted_short_term_equivalents',
  'trade_receivables',
]
const EBITDA_KEYS: readonly FhiFactKey[] = ['operating_profit', 'depreciation_amortization']
const record = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0
const revision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0

function validDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.length !== 10)
    return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function validScope(scope: unknown): scope is FhiScope {
  if (!record(scope) || !record(scope.period)) return false
  const p = scope.period
  if (
    !text(scope.country) ||
    !/^[A-Z]{2}$/.test(scope.country) ||
    scope.country.length !== 2 ||
    !text(scope.entity_id) ||
    !text(scope.industry) ||
    !text(scope.pilot_scope) ||
    !['FY', 'TTM', 'INTERIM'].includes(p.kind) ||
    !validDate(p.start_date) ||
    !validDate(p.end_date) ||
    p.start_date > p.end_date ||
    !['standalone', 'consolidated'].includes(scope.basis) ||
    !text(scope.accounting_regime) ||
    !text(scope.currency) ||
    !/^[A-Z]{3}$/.test(scope.currency) ||
    scope.currency.length !== 3
  )
    return false
  try {
    return Decimal.parse(scope.unit_multiplier).compare(ZERO) > 0
  } catch {
    return false
  }
}

function scopeDifferences(expected: FhiScope, actual: FhiScope): FhiBlockerCode[] {
  const codes: FhiBlockerCode[] = []
  if (
    expected.country !== actual.country ||
    expected.entity_id !== actual.entity_id ||
    expected.industry !== actual.industry ||
    expected.pilot_scope !== actual.pilot_scope
  )
    codes.push('SCOPE_MISMATCH')
  if (
    expected.period.kind !== actual.period.kind ||
    expected.period.start_date !== actual.period.start_date ||
    expected.period.end_date !== actual.period.end_date
  )
    codes.push('PERIOD_MISMATCH')
  if (expected.basis !== actual.basis) codes.push('BASIS_MISMATCH')
  if (expected.accounting_regime !== actual.accounting_regime)
    codes.push('ACCOUNTING_REGIME_MISMATCH')
  if (expected.currency !== actual.currency) codes.push('CURRENCY_MISMATCH')
  if (expected.unit_multiplier !== actual.unit_multiplier) codes.push('UNIT_MISMATCH')
  return codes
}

function verified(verification: FhiVerification, currentRevision: number): boolean {
  return (
    record(verification) &&
    verification.status === 'verified' &&
    verification.verified_revision === currentRevision &&
    text(verification.verified_by) &&
    typeof verification.verified_at === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(verification.verified_at) &&
    Number.isFinite(Date.parse(verification.verified_at))
  )
}

function sourced(refs: readonly FhiSourceRef[]): boolean {
  return (
    Array.isArray(refs) &&
    refs.length > 0 &&
    refs.every((source) => {
      if (!record(source)) return false
      if (source.kind === 'verified_entry')
        return text(source.entry_id) && revision(source.entry_revision)
      return (
        source.kind === 'document' &&
        text(source.document_id) &&
        revision(source.document_version) &&
        typeof source.source_hash === 'string' &&
        source.source_hash.length === 64 &&
        /^[a-f0-9]{64}$/.test(source.source_hash) &&
        revision(source.page) &&
        text(source.quote)
      )
    })
  )
}

function emptyTrace(definition: FhiMetricDefinition): FhiMetricTrace {
  return {
    metric_id: definition.id,
    group: definition.group,
    formula_id: definition.formula_id,
    formula: definition.formula,
    max_points: definition.max_points,
    status: 'unavailable',
    source_facts: [],
    derivation: null,
    numerator: null,
    denominator: null,
    raw_ratio: null,
    anchor_segment: null,
    credit: null,
    points: null,
    flags: [],
    blockers: [],
  }
}

function factTrace(fact: FhiFinancialFact): FhiFactTrace {
  return {
    id: fact.id,
    revision: fact.revision,
    key: fact.key,
    value: fact.value,
    source_refs: structuredClone(fact.source_refs),
  }
}

/**
 * Pure deterministic construction engine. Input is a trusted verified snapshot; this function
 * does not authenticate a user, verify a document, approve a method, or activate a pilot.
 */
export function scoreFhi(input: FhiInput): FhiEngineResult {
  const global: FhiBlocker[] = []
  const set = input?.statement_set
  const requestedProfile = input?.accounting_profile
  const knownProfile = accountingProfile(set?.scope)
  const profile = requestedProfile && knownProfile?.id === requestedProfile.id &&
    knownProfile.method_version === requestedProfile.method_version ? knownProfile : null
  if (requestedProfile && !profile) global.push({code:'INVALID_SCOPE'})
  if (
    !record(input) ||
    !record(set) ||
    !text(set.id) ||
    !revision(set.revision) ||
    !Array.isArray(input.facts)
  )
    global.push({ code: 'INVALID_INPUT' })
  if (!validScope(set?.scope)) global.push({ code: 'INVALID_SCOPE' })
  else if (set.scope.pilot_scope !== FHI_PILOT_SCOPE) global.push({ code: 'OUT_OF_PILOT_SCOPE' })

  const byKey = new Map<FhiFactKey, FhiFinancialFact[]>()
  const ids = new Set<string>()
  if (Array.isArray(input?.facts))
    for (const fact of input.facts) {
      if (!record(fact)) {
        global.push({ code: 'INVALID_FACT' })
        continue
      }
      if (!(FHI_FACT_KEYS as readonly string[]).includes(fact.key) && !(profile && fact.key === INTERNATIONAL_CASH_KEY)) {
        global.push({ code: 'UNSUPPORTED_FACT_KEY' })
        continue
      }
      if (!text(fact.id)) {
        global.push({ code: 'INVALID_FACT', fact_key: fact.key })
        continue
      }
      if (ids.has(fact.id)) global.push({ code: 'DUPLICATE_FACT', fact_key: fact.key })
      ids.add(fact.id)
      byKey.set(fact.key, [...(byKey.get(fact.key) ?? []), fact as FhiFinancialFact])
    }

  const metrics = FHI_METRICS.map((definition) => {
    const trace = emptyTrace(definition)
    if (profile) trace.formula_id = `${FHI_METHOD_ID}/${profile.method_version}/${definition.id}`
    const combinedCash = !!profile && (byKey.get(INTERNATIONAL_CASH_KEY) ?? []).some(f => f.value !== null)
    const block = (code: FhiBlockerCode, fact_key?: FhiFactKey) =>
      trace.blockers.push({ code, metric_id: definition.id, ...(fact_key ? { fact_key } : {}) })
    if (profile?.country==='CN' && definition.required_facts.includes('operating_profit') &&
        input.international_operating_profit_reconciled!==true) {
      block('OPERATING_PROFIT_BRIDGE_UNAVAILABLE','operating_profit')
      return trace
    }
    if (global.length) {
      trace.blockers = global.map((item) => ({ ...item, metric_id: definition.id }))
      return trace
    }
    const values = new Map<FhiFactKey, Decimal>()
    const used = new Map<FhiFactKey, FhiFinancialFact>()
    const read = (key: FhiFactKey): Decimal | null => {
      if (values.has(key)) return values.get(key)!
      const matches = byKey.get(key) ?? []
      if (matches.length === 0) {
        block('MISSING_FACT', key)
        return null
      }
      if (matches.length !== 1) {
        block('DUPLICATE_FACT', key)
        return null
      }
      const fact = matches[0]
      const before = trace.blockers.length
      if (!revision(fact.revision)) block('INVALID_FACT', key)
      if (fact.statement_set_id !== set.id || fact.statement_set_revision !== set.revision)
        block('STATEMENT_SET_MISMATCH', key)
      if (!validScope(fact.scope)) block('INVALID_SCOPE', key)
      else for (const code of scopeDifferences(set.scope, fact.scope)) block(code, key)
      if (!record(fact.verification) || fact.verification.status !== 'verified')
        block('UNVERIFIED_FACT', key)
      else if (
        fact.verification.verified_revision !== fact.revision ||
        fact.current_source !== true
      )
        block('STALE_FACT', key)
      else if (!verified(fact.verification, fact.revision)) block('UNVERIFIED_FACT', key)
      if (!sourced(fact.source_refs)) block('SOURCE_UNAVAILABLE', key)
      let value: Decimal | null = null
      if (fact.value === null) block('MISSING_FACT', key)
      else
        try {
          value = Decimal.parse(fact.value)
        } catch {
          block('INVALID_DECIMAL', key)
        }
      // Retain accepted source bindings only; rejected/untrusted source content is not promoted.
      if (trace.blockers.length !== before || !value) return null
      trace.source_facts.push(factTrace(fact))
      if (profile && key==='interest_expense' && value.compare(ZERO)<0 &&
          input.reviewed_expense_magnitude_fact_ids?.includes(fact.id)) {
        value = ZERO.sub(value)
        trace.flags.push('SOURCE_EXPENSE_MAGNITUDE_REVIEWED:'+fact.id)
      }
      used.set(key, fact)
      values.set(key, value)
      if (value.compare(ZERO) < 0) trace.flags.push(`NEGATIVE_FACT:${key}`)
      return value
    }

    const required = definition.id === 'AIC-M02' && combinedCash
      ? [INTERNATIONAL_CASH_KEY, 'trade_receivables', 'current_liabilities'] as FhiFactKey[]
      : definition.required_facts
    for (const key of required) read(key)
    for (const key of [
      'cash',
      'unrestricted_short_term_equivalents',
      'trade_receivables',
      'interest_bearing_debt',
      'interest_expense',
      'eligible_cash_and_equivalents',
    ] as FhiFactKey[]) {
      if (values.has(key) && values.get(key)!.compare(ZERO) < 0)
        block('INVALID_FINANCIAL_BOUNDS', key)
    }

    const bridge = (
      candidate: FhiQuickAssetsBridge | FhiEbitdaBridge | null,
      kind: 'quick_assets' | 'ebitda',
      keys: readonly FhiFactKey[],
    ): boolean => {
      const failure: FhiBlockerCode =
        kind === 'quick_assets' ? 'QUICK_ASSETS_UNAVAILABLE' : 'EBITDA_BRIDGE_UNAVAILABLE'
      if (
        !record(candidate) ||
        !text(candidate.id) ||
        !revision(candidate.revision) ||
        candidate.kind !== kind ||
        candidate.statement_set_id !== set.id ||
        candidate.statement_set_revision !== set.revision ||
        candidate.current_source !== true ||
        !verified(candidate.verification, candidate.revision) ||
        !sourced(candidate.source_refs) ||
        candidate.non_overlapping !== true ||
        (kind === 'quick_assets'
          ? (candidate as FhiQuickAssetsBridge).acceptable_per_source !== true
          : (candidate as FhiEbitdaBridge).da_is_addback_to_ebit !== true) ||
        !Array.isArray(candidate.components) ||
        candidate.components.length !== keys.length ||
        !keys.every((key) => {
          const fact = used.get(key)
          const refs = candidate.components.filter(
            (binding) => record(binding) && binding.key === key,
          )
          return (
            fact &&
            refs.length === 1 &&
            refs[0].fact_id === fact.id &&
            refs[0].fact_revision === fact.revision
          )
        })
      ) {
        block(failure)
        return false
      }
      trace.derivation = {
        id: candidate.id,
        revision: candidate.revision,
        source_refs: structuredClone(candidate.source_refs),
      }
      return true
    }

    if (definition.id === 'AIC-M02') bridge(input.quick_assets_bridge, 'quick_assets',
      combinedCash ? [INTERNATIONAL_CASH_KEY, 'trade_receivables'] : QUICK_KEYS)
    if (definition.id === 'AIC-M04') bridge(input.ebitda_bridge, 'ebitda', EBITDA_KEYS)
    if (definition.id === 'AIC-M02') read('current_assets')
    if (definition.id === 'AIC-M03') read('total_liabilities')
    if (trace.blockers.length) return trace

    const value = (key: FhiFactKey): Decimal => values.get(key)!
    let numerator: Decimal
    let denominator: Decimal
    switch (definition.id) {
      case 'AIC-M01':
        numerator = value('current_assets')
        denominator = value('current_liabilities')
        break
      case 'AIC-M02':
        numerator = (combinedCash ? value(INTERNATIONAL_CASH_KEY)
          : value('cash').add(value('unrestricted_short_term_equivalents'))).add(value('trade_receivables'))
        if (combinedCash) trace.formula = '(eligible_cash_and_equivalents + trade_receivables) / current_liabilities'
        denominator = value('current_liabilities')
        break
      case 'AIC-M03':
        numerator = value('total_equity')
        denominator = value('total_assets')
        break
      case 'AIC-M04':
        numerator = value('interest_bearing_debt')
        denominator = value('operating_profit').add(value('depreciation_amortization'))
        break
      case 'AIC-M05':
        numerator = value('operating_profit')
        denominator = value('interest_expense')
        break
      case 'AIC-M06':
        numerator = value('operating_profit')
        denominator = value('net_revenue')
        break
      case 'AIC-M07':
        numerator = value('cash_from_operations')
        denominator = value('net_revenue')
        break
    }
    trace.numerator = numerator.toExact()
    trace.denominator = denominator.toExact()
    if (
      (definition.id !== 'AIC-M05' &&
        definition.id !== 'AIC-M04' &&
        denominator.compare(ZERO) <= 0) ||
      (definition.id === 'AIC-M04' && numerator.compare(ZERO) < 0) ||
      (definition.id === 'AIC-M05' && denominator.compare(ZERO) < 0) ||
      (definition.id === 'AIC-M02' &&
        (numerator.compare(ZERO) < 0 || numerator.compare(value('current_assets')) > 0))
    ) {
      block('INVALID_FINANCIAL_BOUNDS')
      return trace
    }
    if (
      definition.id === 'AIC-M03' &&
      value('total_assets')
        .sub(value('total_liabilities').add(value('total_equity')))
        .compare(ZERO) !== 0
    ) {
      let withinRounding = false
      if (profile && input.rounding_quantums) {
        try {
          const keys = ['total_assets','total_liabilities','total_equity']
          const quantums = keys.map(k => Decimal.parse(input.rounding_quantums![k]))
          if (quantums.every(q => q.compare(ZERO) > 0)) {
            const residual = value('total_assets').sub(value('total_liabilities').add(value('total_equity')))
            const absolute = residual.compare(ZERO)<0 ? ZERO.sub(residual) : residual
            const tolerance = quantums.reduce((s,q)=>s.add(q),ZERO).div(Decimal.parse('2'))
            withinRounding = absolute.compare(tolerance)<=0
          }
        } catch { /* Absent or invalid source precision never enables a tolerance. */ }
      }
      if (!withinRounding) { block('BALANCE_SHEET_UNRECONCILED'); return trace }
      trace.flags.push('BALANCE_WITHIN_SOURCE_ROUNDING')
    }
    if (definition.id === 'AIC-M04' && denominator.compare(ZERO) <= 0) {
      block('EBITDA_NON_POSITIVE')
      return trace
    }
    if (denominator.compare(ZERO) === 0) {
      if (definition.id === 'AIC-M05') {
        const debt = read('interest_bearing_debt')
        if (debt && debt.compare(ZERO) === 0 && trace.blockers.length === 0) {
          trace.flags.push('VERIFIED_ZERO_INTEREST_ZERO_DEBT')
          trace.anchor_segment = {
            kind: 'verified_zero_debt_exception',
            lower: null,
            upper: null,
            position: null,
          }
          trace.credit = Decimal.parse('1').toExact()
          trace.points = Decimal.parse(definition.max_points).toExact()
          trace.status = 'available'
          return trace
        }
        block('ZERO_INTEREST_REQUIRES_VERIFIED_ZERO_DEBT')
      } else block('ZERO_DENOMINATOR')
      return trace
    }
    const ratio = numerator.div(denominator)
    const interpolated = interpolateFhiMetric(definition.id, ratio)
    trace.raw_ratio = ratio.toExact()
    trace.anchor_segment = interpolated.segment
    trace.credit = interpolated.credit.toExact()
    trace.points = interpolated.points.toExact()
    trace.status = 'available'
    return trace
  })

  const exactDecimal = (value: ExactValue) =>
    Decimal.fraction(BigInt(value.numerator), BigInt(value.denominator))
  const sum = (parts: FhiMetricTrace[]) =>
    parts.reduce((total, item) => total.add(exactDecimal(item.points!)), ZERO)
  const complete = metrics.every((item) => item.status === 'available')
  const total = complete ? sum(metrics) : null
  return {
    purpose: 'engine_reference_only',
    method_id: FHI_METHOD_ID,
    method_version: profile?.method_version ?? FHI_METHOD_VERSION,
    runtime: FHI_RUNTIME_STATE,
    scope: validScope(set?.scope) ? structuredClone(set.scope) : null,
    metrics,
    groups: FHI_GROUPS.map((group) => {
      const parts = metrics.filter((item) => item.group === group.id)
      return {
        group: group.id,
        max_points: group.max_points,
        points: parts.every((part) => part.status === 'available') ? sum(parts).toExact() : null,
      }
    }),
    calculation: {
      status: complete ? 'complete' : 'incomplete',
      exact_total: total?.toExact() ?? null,
      display_total: total?.format(1) ?? null,
      candidate_band: total ? fhiBandForTotal(total) : null,
    },
    score: null,
    band: null,
    grade: null,
    pd: null,
    blockers: metrics.flatMap((item) => item.blockers),
  }
}
