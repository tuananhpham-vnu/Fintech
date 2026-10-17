const test = require('node:test'),
  assert = require('node:assert/strict')
const { parseLine, createReader } = require('./provider-diagnostic-reader.cjs')
const event = {
  operation: 'extract',
  request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  document_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  service_code: 'PROVIDER_UNAVAILABLE',
  service_status: 503,
  category: 'RATE_LIMIT_OR_QUOTA',
  http_status: 429,
}
const line = (v) => 'AIC_SAFE_PROVIDER_DIAGNOSTIC ' + JSON.stringify(v)
test('only typed correlation data survive log parsing; untrusted messages/headers are rejected', () => {
  assert.deepEqual(parseLine('WARNING: ' + line(event)), event)
  for (const v of [
    { ...event, message: 'secret' },
    { ...event, request_id: 'secret#token=x' },
    { ...event, document_id: 'customer name' },
    { ...event, category: 'secret' },
    { ...event, http_status: '429' },
    { ...event, service_status: 200 },
  ])
    assert.equal(parseLine(line(v)), null)
  assert.equal(parseLine('https://user:REDACTED@private.invalid/?key=REDACTED'), null)
})
test('bounded streaming discards oversized and raw stderr, handles split JSON once', () => {
  const seen = [],
    reader = createReader((v) => seen.push(v)),
    text = line(event)
  reader.push('PRIVATE_PROMPT\n' + 'x'.repeat(9000))
  reader.push('\n' + text.slice(0, 30))
  reader.push(text.slice(30) + '\n')
  reader.end()
  assert.deepEqual(seen, [event])
})
