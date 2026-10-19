import { apiPath, request, type MutationKey } from '@/lib/api/client'
export type ReviewState = {
  confirmed: boolean
  stale: boolean
  id: string | null
  confirmed_at: string | null
  source_snapshot_hash: string
  processing: boolean
  unresolved_count?: number
}
export type PeriodSourceCandidate = {
  receipt_id: string
  period: { kind: string; start_date: string; end_date: string }
  basis: string
  currency: string
  unit_multiplier: string
  role: 'current' | 'comparative' | 'unspecified'
  status: 'pending' | 'selected' | 'kept'
  existing_sets: {
    set_id: string
    revision: number
    kind: string
    start_date: string
    end_date: string
    basis: string
    source_names: string[]
    role: string
  }[]
  facts: { key: string; value: string; label: string; page: number; quote: string }[]
}
export type IntakeItem = {
  id: string
  parent_id: string | null
  name: string
  sha256: string
  content_type: string
  state:
    | 'queued'
    | 'running'
    | 'ready'
    | 'needs_review'
    | 'failed'
    | 'duplicate'
    | 'skipped'
    | 'expanded'
  attempts: number
  prepared_source_id: string | null
  duplicate_of: string | null
  replacement_of: string | null
  superseded_by: string | null
  error_code: string | null
  created_at: string
  classification: {
    sha256: string
    page_count: number
    document_type: string
    entity_name: string | null
    tax_id: string | null
    warnings: string[]
    period_issues?: {
      candidate_index: number
      kind: string
      end_date: string | null
      basis: string
      pages: number[]
      code: string
      severity: 'info' | 'blocking'
    }[]
    periods: {
      kind: string
      start_date: string | null
      end_date: string
      basis: string
      pages: number[]
      evidence?: { page: number; quote: string }[]
    }[]
  } | null
  statements: {
    receipt_id: string
    set_id: string
    kind?: string
    start_date?: string
    end_date: string
    basis: string
    fact_count: number
    missing_keys: string[]
  }[]
  origin: {
    period_candidates?: PeriodSourceCandidate[]
    locations?: { page: number; sheet?: string; cells?: string[]; image?: string }[]
    warnings?: string[]
    rejected?: { name: string; code: string }[]
    exclusion?: { by: string; reason: string }
    duplicate_sets?: { set_id: string; end_date: string; basis: string }[]
    replaces_existing_sets?: boolean
  }
}
export type IntakePage = {
  capabilities?: { countries: ('VN' | 'US' | 'CN')[]; country: string }
  contract_version: 'AIC-FINANCIAL-INTAKE-1'
  revision: number
  items: IntakeItem[]
  review: ReviewState
}
function review(value: unknown): ReviewState {
  const v = value as ReviewState
  if (
    !v ||
    typeof v.confirmed !== 'boolean' ||
    typeof v.stale !== 'boolean' ||
    typeof v.processing !== 'boolean' ||
    !/^[a-f0-9]{64}$/.test(v.source_snapshot_hash) ||
    (v.id !== null && typeof v.id !== 'string') ||
    (v.confirmed_at !== null && !Number.isFinite(Date.parse(v.confirmed_at)))
  )
    throw Error('Invalid financial review')
  return v
}
function item(value: unknown): IntakeItem {
  const v = value as IntakeItem
  if (
    !v ||
    typeof v.id !== 'string' ||
    typeof v.name !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.sha256) ||
    ![
      'queued',
      'running',
      'ready',
      'needs_review',
      'failed',
      'duplicate',
      'skipped',
      'expanded',
    ].includes(v.state) ||
    !Number.isInteger(v.attempts) ||
    !Array.isArray(v.statements) ||
    !v.origin ||
    (v.classification !== null &&
      (!Array.isArray(v.classification.periods) || !Array.isArray(v.classification.warnings)))
  )
    throw Error('Invalid intake item')
  if (
    v.origin.period_candidates !== undefined &&
    (!Array.isArray(v.origin.period_candidates) ||
      v.origin.period_candidates.length > 12 ||
      v.origin.period_candidates.some(
        (c) =>
          !c ||
          typeof c.receipt_id !== 'string' ||
          !c.period ||
          typeof c.period.kind !== 'string' ||
          !Number.isFinite(Date.parse(c.period.start_date)) ||
          !Number.isFinite(Date.parse(c.period.end_date)) ||
          typeof c.basis !== 'string' ||
          typeof c.currency !== 'string' ||
          !/^[1-9][0-9]{0,11}$/.test(c.unit_multiplier) ||
          !['current', 'comparative', 'unspecified'].includes(c.role) ||
          !['pending', 'selected', 'kept'].includes(c.status) ||
          !Array.isArray(c.existing_sets) ||
          !c.existing_sets.length ||
          c.existing_sets.some(
            (s) =>
              typeof s.set_id !== 'string' ||
              !Number.isSafeInteger(s.revision) ||
              !Array.isArray(s.source_names),
          ) ||
          !Array.isArray(c.facts) ||
          c.facts.length > 15 ||
          c.facts.some(
            (f) =>
              typeof f.key !== 'string' ||
              typeof f.value !== 'string' ||
              !/^-?\d{1,30}(\.\d{1,12})?$/.test(f.value) ||
              !Number.isInteger(f.page) ||
              f.page < 1 ||
              typeof f.quote !== 'string',
          ),
      ))
  )
    throw Error('Invalid period source comparison')
  return v
}
function intakePage(value: unknown): IntakePage {
  const v = value as IntakePage
  if (
    v?.contract_version !== 'AIC-FINANCIAL-INTAKE-1' ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 1 ||
    !Array.isArray(v.items)
  )
    throw Error('Invalid financial intake')
  v.items.forEach(item)
  if (
    v.capabilities &&
    (!Array.isArray(v.capabilities.countries) ||
      v.capabilities.countries.some((c) => !['VN', 'US', 'CN'].includes(c)) ||
      new Set(v.capabilities.countries).size !== v.capabilities.countries.length ||
      typeof v.capabilities.country !== 'string')
  )
    throw Error('Invalid financial capabilities')
  review(v.review)
  return v
}
const mutation = (v: unknown) => {
  const r = v as { revision: number; item: IntakeItem }
  if (!Number.isSafeInteger(r?.revision)) throw Error('Invalid intake mutation')
  item(r.item)
  return r
}
export const intakeApi = {
  list: (id: string, signal?: AbortSignal) =>
    request(apiPath('cases', id, '/financial-intakes'), intakePage, { signal }),
  upload: (id: string, file: File, revision: number, keys: MutationKey) => {
    const path = apiPath('cases', id, '/financial-intakes'),
      body = new FormData()
    body.append('file', file)
    body.append('expected_revision', String(revision))
    return request(path, mutation, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        revision,
      }),
    })
  },
  existing: (
    id: string,
    source: { kind: string; id: string },
    revision: number,
    keys: MutationKey,
  ) => {
    const path = apiPath('cases', id, '/financial-intakes/existing'),
      body = { expected_revision: revision, source_kind: source.kind, source_id: source.id }
    return request(path, mutation, { method: 'POST', body, idempotencyKey: keys.for(path, body) })
  },
  decide: (
    id: string,
    job: string,
    action: 'retry' | 'replace' | 'keep_existing' | 'exclude' | 'compare_periods',
    revision: number,
    keys: MutationKey,
    reason?: string,
  ) => {
    const path = apiPath('cases', id, `/financial-intakes/${encodeURIComponent(job)}/decision`),
      body = { expected_revision: revision, action, ...(reason ? { reason } : {}) }
    return request(path, mutation, { method: 'POST', body, idempotencyKey: keys.for(path, body) })
  },
  periodSource: (
    id: string,
    job: string,
    action: 'select_period_source' | 'keep_period_source',
    revision: number,
    candidate: PeriodSourceCandidate,
    set: { id: string; revision: number },
    keys: MutationKey,
  ) => {
    const path = apiPath('cases', id, `/financial-intakes/${encodeURIComponent(job)}/decision`),
      body = {
        expected_revision: revision,
        action,
        receipt_id: candidate.receipt_id,
        set_id: set.id,
        expected_set_revision: set.revision,
      }
    return request(path, mutation, { method: 'POST', body, idempotencyKey: keys.for(path, body) })
  },
  confirm: (
    id: string,
    revision: number,
    hash: string,
    bridges: {
      quick_assets_non_overlapping: boolean
      quick_assets_eligible: boolean
      da_addback_to_operating_profit: boolean
      international_operating_profit_reconciled?: boolean
      source_rounding_reviewed?: boolean
      assessment_basis?: 'standalone' | 'consolidated'
      expense_presentation_sign_reviewed?: boolean
    },
    keys: MutationKey,
  ) => {
    const path = apiPath('cases', id, '/financial-review-confirmations'),
      body = {
        expected_revision: revision,
        confirmed: true,
        source_snapshot_hash: hash,
        bridge_assertions: bridges,
      }
    return request(
      path,
      (v: unknown) => {
        const r = v as { revision: number; review: ReviewState; verified_fact_count: number }
        if (!Number.isSafeInteger(r?.revision) || !Number.isInteger(r.verified_fact_count))
          throw Error('Invalid confirmation')
        review(r.review)
        return r
      },
      { method: 'POST', body, idempotencyKey: keys.for(path, body) },
    )
  },
  pdf: (id: string, signal: AbortSignal) =>
    request<Blob>(apiPath('financial-files', id, '/source'), (v) => v as Blob, {
      signal,
      bytes: true,
    }),
  originalUrl: (id: string) => '/api/v2' + apiPath('financial-intakes', id, '/original'),
}
