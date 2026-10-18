export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: unknown,
    public retryAfter?: string | null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
let csrfToken: string | null = null
export function setCsrfToken(token: string | null) {
  csrfToken = token
}
export const apiPath = (resource: string, id: string, suffix = '') =>
  `/${resource}/${encodeURIComponent(id)}${suffix}`
type Options = {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  signal?: AbortSignal
  idempotencyKey?: string
  respondentToken?: string
  auth?: boolean
  bytes?: boolean
  timeoutMs?: number
  /** Successful headers are ephemeral; callers must never persist capability secrets. */
  onSuccessHeaders?: (headers: Headers) => void
}
/** No automatic retries for writes. Reuse one key for one exact payload after uncertain delivery. */
export async function request<T>(
  path: string,
  parse: (value: unknown) => T,
  options: Options = {},
): Promise<T> {
  const method = options.method ?? 'GET',
    write = method !== 'GET'
  const headers = new Headers({ Accept: options.bytes ? '*/*' : 'application/json' })
  if (write && !options.auth)
    headers.set('Idempotency-Key', options.idempotencyKey ?? crypto.randomUUID())
  if (write && csrfToken && !options.respondentToken) headers.set('X-CSRF-Token', csrfToken)
  if (options.respondentToken) headers.set('Authorization', `Bearer ${options.respondentToken}`)
  const form = options.body instanceof FormData
  if (options.body !== undefined && !form) headers.set('Content-Type', 'application/json')
  const controller = new AbortController(),
    abort = () => controller.abort(options.signal?.reason)
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? (options.body instanceof FormData ? 90_000 : 30_000),
  )
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  try {
    let response: Response
    try {
      response = await fetch(`/api/v2${path}`, {
        method,
        credentials: options.respondentToken ? 'omit' : 'same-origin',
        cache: 'no-store',
        headers,
        body:
          options.body === undefined
            ? undefined
            : form
              ? (options.body as FormData)
              : JSON.stringify(options.body),
        signal: controller.signal,
        redirect: 'error',
      })
    } catch (error) {
      if (options.signal?.aborted) throw error
      throw new ApiError(
        0,
        controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
        'Connection unavailable',
      )
    }
    if (!response.ok) {
      const value = await response.json().catch(() => ({}))
      if (response.status === 401 && !options.auth && !options.respondentToken)
        window.dispatchEvent(new Event('aic:session-expired'))
      throw new ApiError(
        response.status,
        typeof value.code === 'string' ? value.code : `HTTP_${response.status}`,
        typeof value.message === 'string' ? value.message : 'Request failed',
        value.request_id,
        value.details,
        response.headers.get('retry-after'),
      )
    }
    options.onSuccessHeaders?.(response.headers)
    if (options.bytes) return (await response.blob()) as T
    if (response.status === 204) return undefined as T
    const value: unknown = await response.json().catch(() => {
      throw new ApiError(502, 'INVALID_API_RESPONSE', 'Invalid JSON response')
    })
    try {
      return parse(value)
    } catch {
      throw new ApiError(502, 'INVALID_API_RESPONSE', 'Response does not match the AIC contract')
    }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}
export const unknownResponse = (value: unknown) => value

/** Repeat a mutation manually only with the same key AND the same serialized payload. */
export class MutationKey {
  private body = ''
  private key = ''
  for(path: string, body: unknown) {
    const next = path + ':' + JSON.stringify(body)
    if (next !== this.body) {
      this.body = next
      this.key = crypto.randomUUID()
    }
    return this.key
  }
  clear() {
    this.body = ''
    this.key = ''
  }
}
