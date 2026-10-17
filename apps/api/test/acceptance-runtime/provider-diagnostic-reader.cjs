// Consume only a typed, content-free allowlist. Never persist raw child stderr.
const categories = new Set([
  'RATE_LIMIT_OR_QUOTA',
  'UPSTREAM_AUTH_REJECTED',
  'UPSTREAM_NOT_FOUND',
  'UPSTREAM_SERVER_ERROR',
  'UPSTREAM_HTTP_ERROR',
  'TIMEOUT',
  'DEADLINE',
  'NETWORK_OR_TRANSPORT',
  'PROVIDER_CONFIGURATION_MISSING',
  'DEADLINE_OR_SLOT_WAIT',
  'MODEL_QUEUE_FULL',
  'UNDETERMINED',
])
const uuid = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
function parseLine(line) {
  const prefix = 'AIC_SAFE_PROVIDER_DIAGNOSTIC ',
    index = line.indexOf(prefix)
  if (index < 0 || line.length > 4096) return null
  let v
  try {
    v = JSON.parse(line.slice(index + prefix.length))
  } catch {
    return null
  }
  if (
    !v ||
    Array.isArray(v) ||
    typeof v !== 'object' ||
    Object.keys(v).some(
      (k) =>
        ![
          'operation',
          'request_id',
          'document_id',
          'service_code',
          'service_status',
          'category',
          'http_status',
        ].includes(k),
    )
  )
    return null
  if (
    !['inspect', 'extract', 'evaluate'].includes(v.operation) ||
    !uuid(v.request_id) ||
    v.service_code !== 'PROVIDER_UNAVAILABLE' ||
    v.service_status !== 503 ||
    !categories.has(v.category)
  )
    return null
  if (Object.hasOwn(v, 'document_id') && !uuid(v.document_id)) return null
  if (
    Object.hasOwn(v, 'http_status') &&
    (!Number.isInteger(v.http_status) || v.http_status < 100 || v.http_status > 599)
  )
    return null
  return v
}
function createReader(onEvent) {
  let pending = '',
    discard = false
  return {
    push(chunk) {
      for (const char of String(chunk)) {
        if (char === '\n') {
          if (!discard) {
            const event = parseLine(pending.trim())
            if (event) onEvent(event)
          }
          pending = ''
          discard = false
        } else if (!discard) {
          pending += char
          if (pending.length > 4096) {
            pending = ''
            discard = true
          }
        }
      }
    },
    end() {
      if (!discard) {
        const event = parseLine(pending.trim())
        if (event) onEvent(event)
      }
      pending = ''
      discard = false
    },
  }
}
module.exports = { parseLine, createReader }
