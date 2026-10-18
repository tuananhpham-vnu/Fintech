// Disposable, synthetic pagination data. Only talks to the loopback QA harness.
const { randomUUID } = require('node:crypto')
async function main() {
  const { origin: base } = require('./config.cjs')
  const probe = await fetch(base + '/__qa__/report')
  if (!probe.ok || !(await probe.json()).requests) throw new Error('QA harness is not running')
  const auth = await fetch(base + '/api/v2/auth/login', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'qa.specialist', password: 'TestOnly#2026' }),
  })
  if (auth.headers.get('x-aic-test-harness') !== 'SYNTHETIC-QA-ONLY' || !auth.ok)
    throw new Error('Not the synthetic QA service')
  const session = await auth.json(),
    cookie = auth.headers.get('set-cookie').split(';')[0]
  async function create(path, body) {
    const res = await fetch(base + '/api/v2/' + path, {
      method: 'POST',
      headers: {
        Origin: base,
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': session.csrf_token,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('QA setup failed: ' + res.status)
    return res.json()
  }
  for (let i = 1; i <= 15; i++) {
    const party = await create('counterparties', {
      name: 'QA PAGE · ' + i,
      country: 'VN',
      tax_id: 'QA-PAGE-' + i,
      industry_code: null,
      source_refs: [],
    })
    await create('cases', {
      counterparty_id: party.id,
      exposure_kind: 'RECEIVABLE',
      lifecycle_stage: 'proposed',
      exposure: {
        amount_vnd: '100000000',
        term_days: 30,
        organization_role: 'seller',
        counterparty_role: 'buyer',
        contract_ref: 'QA-PAGE-' + i,
        conditions: [],
        source_origin: 'staff_entered',
      },
    })
  }
  console.log(
    'Created 15 synthetic counterparties and transactions for UI pagination checks. No production data changed.',
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
