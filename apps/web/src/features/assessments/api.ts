import { apiPath, request, unknownResponse, type MutationKey } from '@/lib/api/client'
import type { RevisionInput } from '@/lib/api/contracts'
import { assessment, readiness } from '@/lib/api/decoders'
export const assessmentsApi = {
  readiness: (id: string, signal?: AbortSignal) =>
    request(apiPath('cases', id, '/readiness'), readiness, { signal }),
  assessment: (id: string, signal?: AbortSignal) =>
    request(apiPath('assessments', id), assessment, { signal }),
  run: (id: string, body: RevisionInput, keys: MutationKey) => {
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
