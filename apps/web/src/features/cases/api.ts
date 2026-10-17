import { apiPath, request, unknownResponse } from '@/lib/api/client'
import type { CaseCreate, Exposure, RevisionInput } from '@/lib/api/contracts'
import { caseRecord, detail, page } from '@/lib/api/decoders'
export const casesApi = {
  cases: (cursor = '', signal?: AbortSignal) =>
    request(
      `/cases?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      page(caseRecord),
      { signal },
    ),
  createCase: (body: CaseCreate, key: string) =>
    request('/cases', caseRecord, { method: 'POST', body, idempotencyKey: key }),
  detail: (id: string, signal?: AbortSignal) => request(apiPath('cases', id), detail, { signal }),
  exposure: (id: string, body: RevisionInput & { exposure: Exposure }, key: string) =>
    request(apiPath('cases', id, '/exposure'), unknownResponse, {
      method: 'PATCH',
      body,
      idempotencyKey: key,
    }),
}
