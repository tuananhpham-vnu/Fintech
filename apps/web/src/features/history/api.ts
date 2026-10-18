import { apiPath, request } from '@/lib/api/client'
import { history, page } from '@/lib/api/decoders'
export const historyApi = {
  history: (id: string, cursor = '', signal?: AbortSignal) =>
    request(
      apiPath(
        'cases',
        id,
        `/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
      page(history),
      { signal },
    ),
}
