import { backendBase, isPublicApiRoute } from '@/lib/api/proxy-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const error = (status: number, code: string) =>
  Response.json(
    { code, message: code, request_id: crypto.randomUUID(), details: null },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params,
    endpoint = path.join('/'),
    method = request.method
  if (!isPublicApiRoute(method, endpoint)) return error(404, 'NOT_FOUND')
  const write = !['GET', 'HEAD'].includes(method)
  // Next may construct request.url with the listen address (localhost) rather than
  // the public Host (127.0.0.1). Pin the public origin explicitly behind a proxy.
  const requestUrl = new URL(request.url)
  const publicOrigin =
    process.env.AIC_FRONTEND_ORIGIN ??
    `${requestUrl.protocol}//${request.headers.get('host') ?? requestUrl.host}`
  const origin = request.headers.get('origin')
  const originMatches =
    origin === publicOrigin ||
    (process.env.NODE_ENV !== 'production' &&
      origin?.replace('//localhost:', '//127.0.0.1:') ===
        publicOrigin.replace('//localhost:', '//127.0.0.1:'))
  if (write && !originMatches) return error(403, 'ORIGIN_REJECTED')
  if (!process.env.AIC_BACKEND_URL) return error(503, 'BACKEND_NOT_CONFIGURED')
  let base: string
  try {
    base = backendBase(process.env.AIC_BACKEND_URL)
  } catch {
    return error(503, 'BACKEND_NOT_CONFIGURED')
  }
  const headers = new Headers()
  for (const key of [
    'accept',
    'content-type',
    'cookie',
    'origin',
    'x-csrf-token',
    'idempotency-key',
    'range',
    'if-none-match',
  ]) {
    const value = request.headers.get(key)
    if (value) headers.set(key, value)
  }
  // Capability credentials never flow into specialist endpoints or private AI services.
  if (endpoint.startsWith('respondent/')) {
    headers.delete('cookie')
    const auth = request.headers.get('authorization')
    if (auth) headers.set('authorization', auth)
  }
  if (
    write &&
    endpoint !== 'auth/login' &&
    !endpoint.startsWith('respondent/') &&
    !headers.has('x-csrf-token')
  )
    return error(403, 'CSRF_REQUIRED')
  if (write && !endpoint.startsWith('auth/') && !headers.has('idempotency-key'))
    return error(400, 'IDEMPOTENCY_REQUIRED')
  let body: ArrayBuffer | undefined
  if (write) {
    const max = endpoint.endsWith('/financial-intakes')
      ? 33 * 1024 * 1024
      : endpoint.endsWith('/financial-files')
        ? 26_000_000
        : endpoint.endsWith('/dossier-archives')
          ? 33 * 1024 * 1024
          : endpoint.endsWith('/document-archives')
            ? 21 * 1024 * 1024
            : endpoint.endsWith('/documents')
              ? 11 * 1024 * 1024
              : 1024 * 1024
    if (Number(request.headers.get('content-length') ?? 0) > max)
      return error(413, 'PAYLOAD_TOO_LARGE')
    const reader = request.body?.getReader(),
      chunks: Uint8Array[] = []
    let length = 0
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          length += chunk.value.byteLength
          if (length > max) {
            await reader.cancel()
            return error(413, 'PAYLOAD_TOO_LARGE')
          }
          chunks.push(chunk.value)
        }
      } finally {
        reader.releaseLock()
      }
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    body = bytes.buffer
  }
  try {
    const upstream = await fetch(`${base}/${endpoint}${new URL(request.url).search}`, {
      method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(
          /\/(financial-imports|financial-files)$/.test(endpoint) ? 270_000 : 85_000,
        ),
      ]),
    })
    if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304)
      return error(502, 'UPSTREAM_REDIRECT_REJECTED')
    const output = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    for (const key of [
      'content-type',
      'content-disposition',
      'content-range',
      'accept-ranges',
      'etag',
      'retry-after',
      'x-request-id',
      'x-source-sha256',
    ]) {
      const value = upstream.headers.get(key)
      if (value) output.set(key, value)
    }
    if (
      upstream.status === 201 &&
      method === 'POST' &&
      /^questionnaires\/[a-zA-Z0-9_-]+\/invitations$/.test(endpoint)
    ) {
      const token = upstream.headers.get('x-invitation-token')
      if (token) output.set('X-Invitation-Token', token)
    }
    // Backend must issue host-only HttpOnly cookies for the public frontend host.
    for (const cookie of upstream.headers.getSetCookie()) output.append('set-cookie', cookie)
    return new Response(upstream.body, { status: upstream.status, headers: output })
  } catch {
    return error(503, 'UPSTREAM_UNAVAILABLE')
  }
}
export { forward as GET, forward as PATCH, forward as POST }
