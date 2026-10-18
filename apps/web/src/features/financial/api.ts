import { apiPath, request, type MutationKey } from '@/lib/api/client'
import { evidence } from '@/lib/api/decoders'
export const factKeys = [
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
] as const
export type FinancialSource =
  | { kind: 'manual_entry'; statement: string }
  | {
      kind: 'financial_import'
      receipt_id: string
      fact_key: string
      source_kind: 'document' | 'dossier_member' | 'financial_file'
      source_id: string
      source_hash: string
      page: number
      quote: string
    }
  | {
      kind: 'document'
      document_id: string
      document_version: number
      source_hash: string
      page: number
      quote: string
      evidence_ref: string
    }
export type FactInput = {
  key: string
  raw_value: string | null
  raw_label: string
  missing_reason: string | null
  source: FinancialSource
}
export type FinancialInput = {
  import_review?: { receipt_id: string; confirmed: true }
  expected_revision: number
  reason: string
  period: { kind: string; start_date: string; end_date: string }
  basis: string
  accounting_regime: string
  currency: string
  unit_multiplier: string
  industry_scope: string
  observation_kind: string
  audit_status: string
  statement_version: string
  facts: FactInput[]
}
export type FinancialSet = {
  id: string
  revision: number
  created_at: string
  scope: {
    entity_id: string
    country: string
    industry: string
    pilot_scope: string
    period: FinancialInput['period']
    basis: string
    accounting_regime: string
    currency: string
    unit_multiplier: string
  }
  metadata: { observation_kind: string; audit_status: string; statement_version: string }
  facts: (FactInput & {
    id: string
    revision: number
    normalized_decimal: string | null
    verification: {
      status: string
      verified_by?: string | null
      verified_at?: string | null
      verified_revision?: number | null
    }
    verification_reason?: string
    current_source: boolean
  })[]
  verification_stale: boolean
}
export type Registry = {
  sets: FinancialSet[]
  selected_set_id: string | null
  method_status:
    | 'unconfigured'
    | 'configured_pilot'
    | 'validation_pending'
    | 'validated_for_limited_use'
    | 'retired'
  score: null
  band: null
  grade: null
  pd: null
  metrics: {
    metric_id: string
    group: string
    formula: string
    status: string
    flags?: string[]
    raw_ratio: { numerator: string; denominator: string; decimal: string | null } | null
    points: null
    blockers: { code: string }[]
    max_points: string
    anchors: readonly { value: string; credit: string }[]
    source_facts: { id: string; key: string; value: string | null; revision: number }[]
  }[]
  blockers: string[]
  limitations: string[]
}
function financialSet(value: unknown): FinancialSet {
  const s = value as FinancialSet
  if (
    !s ||
    typeof s.id !== 'string' ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < 1 ||
    !s.scope?.period ||
    !s.metadata ||
    !Array.isArray(s.facts) ||
    s.facts.length > 14 ||
    typeof s.verification_stale !== 'boolean'
  )
    throw Error('Invalid financial set')
  for (const p of [
    'entity_id',
    'country',
    'industry',
    'pilot_scope',
    'basis',
    'accounting_regime',
    'currency',
    'unit_multiplier',
  ] as const)
    if (typeof s.scope[p] !== 'string') throw Error('Invalid scope')
  for (const f of s.facts) {
    if (
      typeof f.id !== 'string' ||
      !Number.isSafeInteger(f.revision) ||
      f.revision < 1 ||
      !factKeys.includes(f.key as (typeof factKeys)[number]) ||
      typeof f.raw_label !== 'string' ||
      (f.raw_value !== null && typeof f.raw_value !== 'string') ||
      (f.normalized_decimal !== null && typeof f.normalized_decimal !== 'string') ||
      typeof f.current_source !== 'boolean' ||
      !['unverified', 'verified', 'stale', 'rejected'].includes(f.verification?.status)
    )
      throw Error('Invalid financial fact')
    if (f.source?.kind === 'document') {
      if (
        typeof f.source.document_id !== 'string' ||
        !Number.isSafeInteger(f.source.document_version) ||
        f.source.document_version < 1 ||
        !/^([a-f0-9]{64})$/.test(f.source.source_hash) ||
        !Number.isInteger(f.source.page) ||
        f.source.page < 1 ||
        typeof f.source.quote !== 'string' ||
        typeof f.source.evidence_ref !== 'string'
      )
        throw Error('Invalid financial source')
    } else if (f.source?.kind === 'financial_import') {
      if (
        !f.source.receipt_id ||
        !f.source.fact_key ||
        !f.source.source_id ||
        !['document', 'dossier_member', 'financial_file'].includes(f.source.source_kind) ||
        !/^[a-f0-9]{64}$/.test(f.source.source_hash) ||
        !Number.isInteger(f.source.page) ||
        f.source.page < 1 ||
        f.source.page > 600 ||
        typeof f.source.quote !== 'string'
      )
        throw Error('Invalid financial import source')
    } else if (f.source?.kind !== 'manual_entry' || typeof f.source.statement !== 'string')
      throw Error('Invalid manual entry')
  }
  return s
}
function mutation(value: unknown) {
  const v = value as { set: FinancialSet; revision: number }
  if (!v || !Number.isSafeInteger(v.revision) || v.revision < 1)
    throw Error('Invalid financial mutation')
  return { set: financialSet(v.set), revision: v.revision }
}
function registry(value: unknown): Registry {
  const v = value as Registry
  if (
    !v ||
    ![
      'unconfigured',
      'configured_pilot',
      'validation_pending',
      'validated_for_limited_use',
      'retired',
    ].includes(v.method_status) ||
    ['score', 'band', 'grade', 'pd'].some((k) => v[k as keyof Registry] !== null) ||
    !Array.isArray(v.sets) ||
    !Array.isArray(v.metrics) ||
    !Array.isArray(v.blockers) ||
    !Array.isArray(v.limitations)
  )
    throw Error('Invalid financial registry')
  for (const s of v.sets) financialSet(s)
  if (v.selected_set_id !== null && !v.sets.some((s) => s.id === v.selected_set_id))
    throw Error('Invalid selected financial set')
  for (const m of v.metrics) {
    if (
      m.points !== null ||
      typeof m.metric_id !== 'string' ||
      typeof m.formula !== 'string' ||
      !Array.isArray(m.blockers) ||
      !Array.isArray(m.source_facts) ||
      !Array.isArray(m.anchors)
    )
      throw Error('Invalid gated financial metric')
    for (const a of m.anchors)
      if (typeof a.value !== 'string' || typeof a.credit !== 'string')
        throw Error('Invalid method anchors')
  }
  return v
}
export const financialApi = {
  trends: (caseId: string, signal?: AbortSignal, baseline?: string) =>
    request(
      apiPath('cases', caseId, '/financial-trends') +
        (baseline ? '?baseline_set_id=' + encodeURIComponent(baseline) : ''),
      (value: unknown): FinancialTrends => {
        const v = value as FinancialTrends
        if (
          v?.contract_version !== 'AIC-FINANCIAL-TRENDS-1' ||
          !Number.isSafeInteger(v.case_revision) ||
          !Array.isArray(v.rows) ||
          !Array.isArray(v.baseline_metrics) ||
          !Number.isFinite(Date.parse(v.captured_at))
        )
          throw Error('Invalid financial comparison')
        for (const row of v.rows) {
          financialSet(row.set)
          if (
            !Array.isArray(row.comparison_issues) ||
            !Array.isArray(row.facts) ||
            !Array.isArray(row.metrics) ||
            typeof row.gap_before !== 'boolean'
          )
            throw Error('Invalid comparison row')
          if (row.comparison_issues.length && (row.facts.length || row.metrics.length))
            throw Error('Incompatible comparison values')
          for (const f of row.facts)
            if (
              (f.value !== null && (typeof f.value !== 'string' || f.status !== 'verified')) ||
              !factKeys.includes(f.key as (typeof factKeys)[number])
            )
              throw Error('Invalid trend fact')
          for (const m of row.metrics)
            if (m.points !== null || !Array.isArray(m.blockers) || typeof m.metric_id !== 'string')
              throw Error('Invalid trend metric')
        }
        return v
      },
      { signal },
    ),
  get: (caseId: string, signal?: AbortSignal, setId?: string) =>
    request(
      apiPath('cases', caseId, '/financial-sets') +
        (setId ? '?set_id=' + encodeURIComponent(setId) : ''),
      registry,
      { signal },
    ),
  save: (caseId: string, id: string | undefined, input: FinancialInput, keys: MutationKey) => {
    const path = id ? apiPath('financial-sets', id) : apiPath('cases', caseId, '/financial-sets')
    const body = {
      ...(input.import_review ? { import_review: input.import_review } : {}),
      expected_revision: input.expected_revision,
      reason: input.reason,
      period: {
        kind: input.period.kind,
        start_date: input.period.start_date,
        end_date: input.period.end_date,
      },
      basis: input.basis,
      accounting_regime: input.accounting_regime,
      currency: input.currency,
      unit_multiplier: input.unit_multiplier,
      industry_scope: input.industry_scope,
      observation_kind: input.observation_kind,
      audit_status: input.audit_status,
      statement_version: input.statement_version,
      facts: input.facts.map((f) => ({
        key: f.key,
        raw_value: f.raw_value,
        raw_label: f.raw_label,
        missing_reason: f.missing_reason,
        source:
          f.source.kind === 'manual_entry'
            ? { kind: f.source.kind, statement: f.source.statement }
            : f.source.kind === 'financial_import'
              ? { ...f.source }
              : {
                  kind: f.source.kind,
                  document_id: f.source.document_id,
                  document_version: f.source.document_version,
                  source_hash: f.source.source_hash,
                  page: f.source.page,
                  quote: f.source.quote,
                  evidence_ref: f.source.evidence_ref,
                },
      })),
    }
    return request(path, mutation, {
      method: id ? 'PATCH' : 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
  verify: (
    id: string,
    body: {
      expected_revision: number
      set_revision: number
      reason: string
      status: string
      fact_ids: string[]
      bridge_assertions: {
        quick_assets_non_overlapping: boolean
        quick_assets_eligible: boolean
        da_addback_to_operating_profit: boolean
      }
    },
    keys: MutationKey,
  ) => {
    const path = apiPath('financial-sets', id, '/verification')
    return request(path, mutation, { method: 'POST', body, idempotencyKey: keys.for(path, body) })
  },
  evidence: (id: string, signal?: AbortSignal) =>
    request(apiPath('evidence', id), evidence, { signal }),
}

export type FinancialTrends = {
  contract_version: 'AIC-FINANCIAL-TRENDS-1'
  case_revision: number
  captured_at: string
  baseline_set_id: string | null
  baseline_metrics: Registry['metrics']
  rows: {
    set: FinancialSet
    comparison_issues: string[]
    gap_before: boolean
    facts: {
      key: string
      value: string | null
      fact_id: string | null
      fact_revision: number | null
      status: 'verified' | 'missing' | 'unverified' | 'stale' | 'rejected'
    }[]
    metrics: Registry['metrics']
  }[]
}
