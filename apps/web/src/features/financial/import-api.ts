import { apiPath, request, type MutationKey } from '@/lib/api/client'
import { factKeys, type FinancialSource } from './api'
export type ImportSource = {
  id: string
  kind: 'document' | 'dossier_member' | 'financial_file'
  name: string
  sha256: string
  page_count: number | null
}
export type ImportPage = {
  page: number
  preview: string
  needs_ocr: boolean
  statement_title: boolean
}
export type ImportIndex = {
  contract_version: string
  sha256: string
  page_count: number
  suggested_pages: number[]
  pages: ImportPage[]
  source: ImportSource
  revision: number
}
export type ImportCandidate = {
  key: string
  value: string
  raw_token: string
  label: string
  page: number
  quote: string
  method: 'native' | 'ocr'
  verification: 'unverified'
}
export type ImportReceipt = {
  receipt_id: string
  revision: number
  sha256: string
  source: ImportSource
  document_type: string
  scope: {
    entity_name: string
    country: string
    period_kind: string
    start_date: string
    end_date: string
    basis: string
    accounting_regime: string
    currency: string
    unit_multiplier: string
  }
  scope_evidence: { page: number; quote: string }[]
  selected_pages: number[]
  facts: ImportCandidate[]
  missing_keys: string[]
  rejected: { key: string; code: string }[]
  warnings: string[]
  ocr_failures: { page: number; code: string }[]
}
export const importSourceUrl = (source: Pick<ImportSource, 'kind' | 'id'>, page = 1) =>
  `/api/v2/${source.kind === 'document' ? 'documents' : source.kind === 'dossier_member' ? 'dossier-members' : 'financial-files'}/${encodeURIComponent(source.id)}/source#page=${page}`
export const candidateSource = (
  receipt: ImportReceipt,
  fact: ImportCandidate,
): FinancialSource => ({
  kind: 'financial_import',
  receipt_id: receipt.receipt_id,
  fact_key: fact.key,
  source_kind: receipt.source.kind,
  source_id: receipt.source.id,
  source_hash: receipt.sha256,
  page: fact.page,
  quote: fact.quote,
})
function index(value: unknown): ImportIndex {
  const v = value as ImportIndex
  if (
    v?.contract_version !== 'AIC-FINANCIAL-IMPORT-1' ||
    !Array.isArray(v.pages) ||
    !Array.isArray(v.suggested_pages) ||
    !v.source?.id ||
    !Number.isSafeInteger(v.revision)
  )
    throw Error('Invalid import index')
  return v
}
function receipt(value: unknown): ImportReceipt {
  const v = value as ImportReceipt
  if (
    !v?.receipt_id ||
    !v.scope ||
    !Array.isArray(v.facts) ||
    v.facts.length > 14 ||
    !v.source?.id ||
    v.facts.some(
      (f) =>
        !factKeys.includes(f.key as (typeof factKeys)[number]) ||
        !/^-?\d+(\.\d+)?$/.test(f.value) ||
        !f.quote ||
        !Number.isInteger(f.page),
    )
  )
    throw Error('Invalid import candidates')
  return v
}
export const importApi = {
  diagnostics: (caseId: string, setId: string, signal?: AbortSignal) =>
    request(
      apiPath('cases', caseId, '/financial-diagnostics') + '?set_id=' + encodeURIComponent(setId),
      (value: unknown) => {
        const v = value as FinancialDiagnosticsResult
        if (
          v?.contract_version !== 'AIC-FINANCIAL-DIAGNOSTICS-1' ||
          v.credit_score !== null ||
          v.pd !== null ||
          !Array.isArray(v.metrics) ||
          !Array.isArray(v.observations)
        )
          throw Error('Invalid diagnostics')
        return v
      },
      { signal },
    ),
  sources: (caseId: string, signal?: AbortSignal) =>
    request(
      apiPath('cases', caseId, '/financial-import-sources'),
      (value: unknown) => {
        const v = value as { revision: number; sources: ImportSource[] }
        if (!Number.isSafeInteger(v?.revision) || !Array.isArray(v.sources))
          throw Error('Invalid financial sources')
        return v
      },
      { signal },
    ),
  upload: (caseId: string, file: File, revision: number, keys: MutationKey) => {
    const body = new FormData()
    body.set('file', file)
    body.set('expected_revision', String(revision))
    const path = apiPath('cases', caseId, '/financial-files')
    return request(path, index, {
      method: 'POST',
      body,
      timeoutMs: 275_000,
      idempotencyKey: keys.for(path, {
        name: file.name,
        size: file.size,
        modified: file.lastModified,
        revision,
      }),
    })
  },
  run: (
    caseId: string,
    source: ImportSource,
    revision: number,
    pages: number[],
    scope: { country: string; basis: string; end_date: string } | undefined,
    extract: boolean,
    keys: MutationKey,
  ) => {
    const body = {
        expected_revision: revision,
        source_kind: source.kind,
        source_id: source.id,
        operation: extract ? 'extract' : 'index',
        pages,
        ...(scope ? { requested_scope: scope } : {}),
      },
      path = apiPath('cases', caseId, '/financial-imports')
    return request(path, (value: unknown) => (extract ? receipt(value) : index(value)), {
      method: 'POST',
      body,
      timeoutMs: 275_000,
      idempotencyKey: keys.for(path, body),
    })
  },
}
export type FinancialDiagnosticsResult = {
  contract_version: string
  credit_score: null
  pd: null
  metrics: {
    id: string
    numerator: string
    denominator: string
    status: string
    display: string | null
    issues: string[]
  }[]
  observations: { code: string }[]
  balance_check: { status: string; residual: string | null }
}
