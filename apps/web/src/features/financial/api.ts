import { apiPath, request, type MutationKey } from '@/lib/api/client'
import { evidence } from '@/lib/api/decoders'
import { decodeAccountingProfile } from '@/lib/api/accounting-profile'
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
  'eligible_cash_and_equivalents',
] as const
export const factKeysForCountry = (country?: string) =>
  factKeys.filter(
    (key) => key !== 'eligible_cash_and_equivalents' || country === 'US' || country === 'CN',
  )
export type FinancialSource =
  | {
      kind: 'calculated'
      receipt_id: string
      calculation_id: string
      fact_key: string
      source_kind: 'document' | 'dossier_member' | 'financial_file'
      source_id: string
      source_hash: string
      page: number
      quote: string
    }
  | {
      kind: 'statement_entry'
      receipt_id: string
      fact_key: string
      source_kind: 'document' | 'dossier_member' | 'financial_file'
      source_id: string
      source_hash: string
      page: number
      quote: string
      reason: string
    }
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
      human_correction?: { reason: string }
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
export type CalculationProposal = {
  id: string
  key: string
  reason: string
  assumptions: string[]
  expression: string[]
  inputs: {
    id: string
    value: string
    label: string
    raw_token: string
    page: number
    quote: string
    period_start: string
    period_end: string
    basis: string
    currency: string
    unit_multiplier: string
    dimension: string
  }[]
  computed_value: string | null
  blocked_reason: string | null
  blocked_details?: {
    missing_variables: {
      id: string
      label: string
      source_status?:
        'not_observed' | 'observed_unlinked' | 'scope_mismatch' | 'allocation_unproven'
      source_candidates?: {
        observation_id: string
        label: string
        page: number
        quote: string
        status: string
      }[]
    }[]
    assumptions: string[]
  }
  receipt_id: string
  source_kind: 'document' | 'dossier_member' | 'financial_file'
  source_id: string
  source_hash: string
  reasoning_version?: string
  proof?: {
    variable_id: string
    leaf_ids: string[]
    relation_ids: string[]
    depth: number
    exact_value: { numerator: string; denominator: string; decimal: string | null }
    variables: { id: string; label: string; key: string | null }[]
    steps: {
      id: string
      label: string
      reason: string
      kind: string
      expression?: string[]
      output_variable_id?: string
      terms: { variable_id: string; coefficient: string }[]
      evidence: { page: number; quote: string }[]
    }[]
    intermediate_values: {
      variable_id: string
      value: { decimal: string | null; numerator: string; denominator: string }
    }[]
  } | null
}
export type ReasoningSummary = {
  version: string
  receipt_id: string
  proof_hash: string
  coverage: { pages_read: number[]; pages_available: number[]; complete: boolean }
  diagnostics: { code: string; detail: string }[]
  targets: {
    key: string
    status: string
    origin: string
    value: string | null
    code: string | null
    steps: number
  }[]
}
export type ReasoningPage = {
  summary: ReasoningSummary
  relations: NonNullable<CalculationProposal['proof']>['steps']
  rows: {
    variable: { id: string; label: string }
    observations: {
      id: string
      label: string
      value: string
      raw_token: string
      page: number
      quote: string
    }[]
  }[]
  next_offset: number | null
}
export type FinancialInput = {
  intake_review?: { intake_id: string; receipt_id: string; page: number; quote: string }
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
  metadata: {
    accounting_profile?: import('@/lib/api/contracts').AccountingProfile
    source_rounding?: {
      quantums: Record<string, string>
      evidence: { page: number; quote: string }[]
    }
    observation_kind: string
    audit_status: string
    statement_version: string
    calculations?: CalculationProposal[]
    reasoning?: ReasoningSummary
  }
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
  if (s?.metadata?.accounting_profile !== undefined) {
    const profile = decodeAccountingProfile(s.metadata.accounting_profile)
    if (
      profile.country !== s.scope.country ||
      profile.accounting_regime !== s.scope.accounting_regime
    )
      throw Error('Invalid accounting profile scope')
  }
  const reasoning = s?.metadata?.reasoning
  if (
    reasoning &&
    (reasoning.version !== 'AIC-FINANCIAL-REASONING-1' ||
      typeof reasoning.receipt_id !== 'string' ||
      !/^[a-f0-9]{64}$/.test(reasoning.proof_hash) ||
      !Array.isArray(reasoning.targets) ||
      reasoning.targets.length !== 14 ||
      reasoning.targets.some(
        (t) =>
          !factKeys.includes(t.key as (typeof factKeys)[number]) ||
          !['resolved', 'unresolved', 'conflict'].includes(t.status) ||
          !['direct', 'derived'].includes(t.origin) ||
          (t.value !== null && typeof t.value !== 'string') ||
          (t.code !== null && typeof t.code !== 'string'),
      ) ||
      !Array.isArray(reasoning.coverage?.pages_read) ||
      !Array.isArray(reasoning.coverage?.pages_available) ||
      !Array.isArray(reasoning.diagnostics))
  )
    throw Error('Invalid financial reasoning summary')
  if (
    s?.metadata?.calculations !== undefined &&
    (!Array.isArray(s.metadata.calculations) ||
      s.metadata.calculations.length > factKeysForCountry(s.scope.country).length ||
      s.metadata.calculations.some(
        (p) =>
          !p ||
          typeof p.id !== 'string' ||
          !factKeys.includes(p.key as (typeof factKeys)[number]) ||
          !Array.isArray(p.expression) ||
          !p.expression.every((t) => typeof t === 'string') ||
          !Array.isArray(p.inputs) ||
          (!p.inputs.length && !p.blocked_reason) ||
          p.inputs.some(
            (i) =>
              !i ||
              typeof i.id !== 'string' ||
              typeof i.label !== 'string' ||
              typeof i.raw_token !== 'string' ||
              typeof i.quote !== 'string' ||
              !Number.isInteger(i.page) ||
              i.page < 1 ||
              i.page > 600,
          ) ||
          !Array.isArray(p.assumptions) ||
          !p.assumptions.every((a) => typeof a === 'string') ||
          (p.computed_value !== null &&
            (typeof p.computed_value !== 'string' ||
              !/^-?\d{1,30}(\.\d{1,12})?$/.test(p.computed_value))) ||
          (p.blocked_reason !== null && typeof p.blocked_reason !== 'string') ||
          typeof p.receipt_id !== 'string' ||
          typeof p.source_id !== 'string' ||
          (p.proof != null &&
            (!Array.isArray(p.proof.steps) ||
              !Array.isArray(p.proof.variables) ||
              !Array.isArray(p.proof.intermediate_values) ||
              !Array.isArray(p.proof.leaf_ids))) ||
          !/^[a-f0-9]{64}$/.test(p.source_hash),
      ))
  )
    throw Error('Invalid financial calculation proposals')
  if (
    !s ||
    typeof s.id !== 'string' ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < 1 ||
    !s.scope?.period ||
    !s.metadata ||
    !Array.isArray(s.facts) ||
    s.facts.length > factKeysForCountry(s.scope.country).length ||
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
      !factKeysForCountry(s.scope.country).includes(f.key as (typeof factKeys)[number]) ||
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
    } else if (
      f.source?.kind === 'financial_import' ||
      f.source?.kind === 'statement_entry' ||
      f.source?.kind === 'calculated'
    ) {
      if (
        f.source.kind === 'calculated' &&
        (typeof f.source.calculation_id !== 'string' || !f.source.calculation_id)
      )
        throw Error('Invalid calculated source')
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
          if (row.standalone_values !== undefined && row.standalone_values !== true)
            throw Error('Invalid standalone comparison flag')
          if (
            row.comparison_issues.length &&
            (row.facts.length || row.metrics.length) &&
            !(
              row.standalone_values === true &&
              row.comparison_issues.every((code) => code.startsWith('INCOMPATIBLE_'))
            )
          )
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
      ...(input.intake_review ? { intake_review: input.intake_review } : {}),
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
            : f.source.kind === 'financial_import' ||
                f.source.kind === 'statement_entry' ||
                f.source.kind === 'calculated'
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
  reasoning: (caseId: string, receiptId: string, offset = 0) =>
    request(
      apiPath(
        'cases',
        caseId,
        `/financial-reasoning/${encodeURIComponent(receiptId)}?offset=${offset}`,
      ),
      (value) => {
        const p = value as ReasoningPage
        if (
          !p ||
          !Array.isArray(p.rows) ||
          !Array.isArray(p.relations) ||
          p.relations.length > 10 ||
          p.relations.some(
            (r) =>
              typeof r.id !== 'string' ||
              typeof r.label !== 'string' ||
              typeof r.reason !== 'string' ||
              !Array.isArray(r.evidence),
          ) ||
          p.rows.length > 50 ||
          p.rows.some(
            (r) =>
              typeof r.variable?.label !== 'string' ||
              !Array.isArray(r.observations) ||
              r.observations.some(
                (o) =>
                  typeof o.id !== 'string' ||
                  typeof o.quote !== 'string' ||
                  typeof o.raw_token !== 'string' ||
                  !Number.isInteger(o.page),
              ),
          ) ||
          (p.next_offset !== null && !Number.isSafeInteger(p.next_offset))
        )
          throw Error('Invalid reasoning observations')
        return p
      },
    ),
  reviewReasoning: (
    caseId: string,
    receiptId: string,
    body: {
      set_id: string
      expected_revision: number
      reason: string
      excluded_observation_ids: string[]
      excluded_relation_ids?: string[]
    },
    keys: MutationKey,
  ) => {
    const path = apiPath(
      'cases',
      caseId,
      `/financial-reasoning/${encodeURIComponent(receiptId)}/decisions`,
    )
    return request(
      path,
      (value) => {
        const result = value as { revision: number; set_id: string; receipt_id: string }
        if (
          !result ||
          !Number.isSafeInteger(result.revision) ||
          typeof result.receipt_id !== 'string'
        )
          throw Error('Invalid reasoning review')
        return result
      },
      { method: 'POST', body, idempotencyKey: keys.for(path, body) },
    )
  },
}

export type FinancialTrends = {
  contract_version: 'AIC-FINANCIAL-TRENDS-1'
  case_revision: number
  captured_at: string
  baseline_set_id: string | null
  baseline_metrics: Registry['metrics']
  rows: {
    standalone_values?: true
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
