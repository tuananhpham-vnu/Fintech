import { apiPath, request, unknownResponse, type MutationKey } from '@/lib/api/client'
import type { IssueDecisionInput, RevisionInput, WaiverInput } from '@/lib/api/contracts'
import { review } from '@/lib/api/decoders'
export const reviewApi = {
  review: (id: string, signal?: AbortSignal) =>
    request(apiPath('review-runs', id), review, { signal }),
  run: (id: string, body: RevisionInput, keys: MutationKey) => {
    const path = apiPath('cases', id, '/review-runs')
    return request(path, unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
  decide: (id: string, body: IssueDecisionInput, keys: MutationKey) => {
    const path = apiPath('issues', id, '/decisions')
    return request(path, unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
  waive: (id: string, body: WaiverInput, key: string) =>
    request(apiPath('cases', id, '/waivers'), unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: key,
    }),
  revoke: (id: string, body: RevisionInput & { reason: string }, keys: MutationKey) => {
    const path = apiPath('waivers', id, '/revoke')
    return request(path, unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
}
