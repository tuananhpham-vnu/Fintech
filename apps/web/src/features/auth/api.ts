import { request, unknownResponse } from '@/lib/api/client'
import { session } from '@/lib/api/decoders'
export const authApi = {
  me: (signal?: AbortSignal) => request('/auth/me', session, { signal, auth: true }),
  login: (username: string, password: string) =>
    request('/auth/login', session, { method: 'POST', body: { username, password }, auth: true }),
  logout: () => request('/auth/logout', unknownResponse, { method: 'POST', auth: true }),
}
