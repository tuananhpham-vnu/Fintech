import { apiPath, request, unknownResponse, type MutationKey } from '@/lib/api/client'
import type { RevisionInput } from '@/lib/api/contracts'
import { assessment, readiness, page } from '@/lib/api/decoders'
export type AssessmentSummary = {
  id: string
  case_revision: number
  created_at: string
  method_version: string
  state: string
}
const summary = (value: unknown): AssessmentSummary => {
  const item = value as AssessmentSummary
  if (
    !item ||
    typeof item.id !== 'string' ||
    !Number.isSafeInteger(item.case_revision) ||
    item.case_revision < 1 ||
    typeof item.created_at !== 'string' ||
    !Number.isFinite(Date.parse(item.created_at)) ||
    typeof item.method_version !== 'string' ||
    item.state !== 'completed'
  )
    throw Error('INVALID_API_RESPONSE')
  return item
}
export const assessmentsApi = {
  history: (id: string, signal: AbortSignal, cursor?: string) =>
    request(
      apiPath('cases', id, '/assessments') +
        (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
      page(summary),
      { signal },
    ),
  readiness: (id: string, signal?: AbortSignal, setId?: string) =>
    request(
      apiPath('cases', id, '/readiness') + (setId ? '?set_id=' + encodeURIComponent(setId) : ''),
      readiness,
      { signal },
    ),
  assessment: (id: string, signal?: AbortSignal) =>
    request(apiPath('assessments', id), assessment, { signal }),
  run: (id: string, body: RevisionInput & { financial_set_id?: string }, keys: MutationKey) => {
    const path = apiPath('cases', id, '/assessments')
    return request(path, unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
  acknowledge: (id: string, body: RevisionInput & { reason: string }, keys: MutationKey) => {
    const path = apiPath('assessments', id, '/acknowledge')
    return request(path, unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
}
