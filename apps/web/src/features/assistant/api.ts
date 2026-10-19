import { apiPath, request } from '@/lib/api/client'

export type ChatTurn = { role: 'user' | 'assistant'; content: string }
export type AssistantCitation = {
  id: number
  document_id: string
  document_name: string
  document_version: number
  source_hash: string
  page: number
  quote: string
  verified: boolean
}
export type AssistantMetric = {
  metric_id: string
  label: string
  value: string | null
  unit: string
  period: string | null
  formula: string
  status: 'ok' | 'insufficient_data'
  document_ids: string[]
}
export type AssistantAnswer = {
  case_id: string
  answer: string
  citations: AssistantCitation[]
  metrics: AssistantMetric[]
  diagnostics: { code: string; message: string }[]
  documents_considered: number
  mode: 'live' | 'mock'
}
export type SearchHit = {
  document_id: string
  document_name: string
  document_type: string
  page: number
  snippet: string
  match_start: number
  match_length: number
}
export type SearchResult = { query: string; hits: SearchHit[]; truncated: boolean }

const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max
const count = (v: unknown, min = 0) => Number.isSafeInteger(v) && (v as number) >= min

function answer(value: unknown): AssistantAnswer {
  const v = value as AssistantAnswer
  if (
    !v ||
    !text(v.case_id, 64) ||
    !text(v.answer, 8000) ||
    !v.answer ||
    !Array.isArray(v.citations) ||
    !Array.isArray(v.metrics) ||
    !Array.isArray(v.diagnostics) ||
    !count(v.documents_considered) ||
    !['live', 'mock'].includes(v.mode)
  )
    throw Error('Invalid assistant answer')
  for (const c of v.citations)
    if (
      !count(c.id, 1) ||
      !text(c.document_id, 64) ||
      !text(c.document_name, 300) ||
      !count(c.document_version, 1) ||
      !/^[a-f0-9]{64}$/.test(c.source_hash) ||
      !count(c.page, 1) ||
      !text(c.quote, 1000) ||
      typeof c.verified !== 'boolean'
    )
      throw Error('Invalid citation')
  for (const m of v.metrics)
    if (
      !text(m.metric_id, 64) ||
      !text(m.label, 200) ||
      !(m.value === null || text(m.value, 64)) ||
      !text(m.unit, 32) ||
      !(m.period === null || text(m.period, 32)) ||
      !['ok', 'insufficient_data'].includes(m.status) ||
      !Array.isArray(m.document_ids)
    )
      throw Error('Invalid metric')
  for (const d of v.diagnostics)
    if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(d.code) || !text(d.message, 500))
      throw Error('Invalid diagnostic')
  return v
}

function searchResult(value: unknown): SearchResult {
  const v = value as SearchResult
  if (!v || !text(v.query, 200) || !Array.isArray(v.hits) || typeof v.truncated !== 'boolean')
    throw Error('Invalid search result')
  for (const h of v.hits)
    if (
      !text(h.document_id, 64) ||
      !text(h.document_name, 300) ||
      !text(h.document_type, 64) ||
      !count(h.page, 1) ||
      !text(h.snippet, 400) ||
      !count(h.match_start) ||
      !count(h.match_length, 1)
    )
      throw Error('Invalid search hit')
  return v
}

export const assistantApi = {
  /** Read-only question: a fresh idempotency key per question; no automatic retry. */
  ask: (caseId: string, question: string, history: ChatTurn[], signal?: AbortSignal) =>
    request(apiPath('cases', caseId, '/assistant/messages'), answer, {
      method: 'POST',
      body: { question, history },
      signal,
      timeoutMs: 90_000,
    }),
  search: (caseId: string, q: string, signal?: AbortSignal) =>
    request(
      apiPath('cases', caseId, '/assistant/search') + '?q=' + encodeURIComponent(q),
      searchResult,
      {
        signal,
      },
    ),
}
