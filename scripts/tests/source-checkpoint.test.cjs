const assert = require('node:assert/strict')
const { test } = require('node:test')
const { inspect } = require('../prepare-source-checkpoint.cjs')
const check = (file, text = '') => inspect(file, Buffer.from(text))

test('required source/migration/docs and environment template are allowed', () => {
  for (const name of [
    '.gitattributes',
    'apps/api/src/storage/storage.service.ts',
    'apps/api/migrations/0001_foundation.sql',
    'docs/audits/CODEX-PRODUCTION-READINESS.md',
    'apps/web/src/app/page.tsx',
    'apps/web/.prettierignore',
    'apps/api/.env.example',
  ])
    assert.equal(check(name), null, name)
})
test('runtime, real data, secrets by path and archives stay out of checkpoint', () => {
  for (const name of [
    'apps/api/.env',
    'apps/web/.env.local',
    'apps/api/storage/runtime.json',
    'docs/audits/private/customer.json',
    'tests/fixtures/real/customer.json',
    'apps/web/public/AIC_Rating_Logo_Web_Assets.zip',
    'apps/api/private.pem',
  ])
    assert.notEqual(check(name), null, name)
})

test('only the reviewed recovery AI sources extend the checkpoint scope', () => {
  for (const name of [
    'services/ai/runner/provider_diagnostics.py',
    'services/ai/tests/test_provider_diagnostics.py',
    'services/ai/tests/test_post_acceptance_grounding.py',
  ])
    assert.equal(check(name, '# reviewed technical source'), null)
  for (const name of [
    'services/ai/logs/provider.json',
    'services/ai/.env',
    'services/ai/tests/private/key.json',
    'services/ai/evidence/new-live-response.json',
  ])
    assert.notEqual(check(name), null)
})
test('PDF labels are insufficient; only reviewed exact synthetic bytes qualify', () => {
  assert.notEqual(check('tests/fixtures/synthetic/new.pdf', '%PDF SYNTHETIC'), null)
  assert.notEqual(check('tests/fixtures/synthetic/valid_synthetic.pdf', '%PDF tampered'), null)
})
test('provider and private key findings never contain the matching secret', () => {
  const value = 'AIza' + 'x'.repeat(35)
  const reason = check('apps/api/src/example.ts', `const key='${value}'`)
  assert.equal(reason, 'BLOCK: provider token')
  assert.ok(!reason.includes(value))
  assert.equal(
    check('docs/implementation/example.md', '-----BEGIN ' + 'PRIVATE KEY-----'),
    'BLOCK: private key',
  )
})
test('only the exact reviewed frontend negative-test URL is exempt', () => {
  const testFile = 'apps/web/tests/integration/api-contracts.cjs'
  const url = (host) => 'https://' + 'u:' + 'p@' + host + '/api'
  assert.equal(check(testFile, url('test')), null)
  assert.equal(check(testFile, url('actual-host')), 'BLOCK: credential-bearing URL')
  assert.equal(check('apps/api/src/example.ts', url('test')), 'BLOCK: credential-bearing URL')
  const databaseUrl = (password) =>
    'DATABASE_URL=postgresql://' + 'u:' + password + '@localhost/aic'
  assert.equal(check('apps/api/.env.example', databaseUrl('CHANGE_ME')), null)
  assert.equal(
    check('apps/api/.env.example', databaseUrl('real-secret-value')),
    'BLOCK: credential-bearing URL',
  )
})
