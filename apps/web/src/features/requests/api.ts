import { apiPath, request, unknownResponse, type MutationKey } from '@/lib/api/client'
import type { RevisionInput, DocumentType } from '@/lib/api/contracts'
export const requestsApi = {
  draft: (
    caseId: string,
    requestId: string | undefined,
    body: RevisionInput & {
      run_id: string
      issue_id: string
      purpose: string
      content: string
      document_types: DocumentType[]
    },
    keys: MutationKey,
  ) => {
    const path = requestId ? apiPath('requests', requestId) : apiPath('cases', caseId, '/requests')
    return request(path, unknownResponse, {
      method: requestId ? 'PATCH' : 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
  decide: (
    id: string,
    mode: 'approve' | 'cancel' | 'ack',
    body: RevisionInput & { reason: string },
    keys: MutationKey,
  ) => {
    const path = apiPath('requests', id, '/' + mode)
    return request(path, unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
  export: (id: string) =>
    request<Blob>(
      apiPath('requests', id, '/export'),
      () => {
        throw new Error()
      },
      { bytes: true },
    ),
}
