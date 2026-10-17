import { apiPath, request } from '@/lib/api/client'
import { evidence } from '@/lib/api/decoders'
export const evidenceApi = {
  evidence: (id: string, signal?: AbortSignal) =>
    request(apiPath('evidence', id), evidence, { signal }),
  source: (id: string, signal?: AbortSignal) =>
    request<Blob>(
      apiPath('documents', id, '/source'),
      () => {
        throw new Error()
      },
      { bytes: true, signal },
    ),
  dossierMemberSource: (id: string, signal?: AbortSignal) =>
    request<Blob>(
      apiPath('dossier-members', id, '/source'),
      () => {
        throw new Error()
      },
      { bytes: true, signal },
    ),
}
