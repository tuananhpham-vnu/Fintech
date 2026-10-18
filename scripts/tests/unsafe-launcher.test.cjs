const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  { spawnSync } = require('node:child_process')
const { inspect } = require('../prepare-source-checkpoint.cjs')
test('deprecated combined launchers fail closed without credentials or process start/termination', () => {
  const root = path.resolve(__dirname, '../..')
  for (const file of ['scripts/dev-all.cjs', 'start-dev.ps1']) {
    const bytes = fs.readFileSync(path.join(root, file)),
      text = bytes.toString()
    assert.equal(inspect(file, bytes), null)
    assert.doesNotMatch(text, /postgres(?:ql)?:\/\/|taskkill|Start-Process|spawn\s*\(/i)
  }
  const result = spawnSync(process.execPath, ['scripts/dev-all.cjs'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /disabled/)
  assert.match(result.stderr, /No service was started or stopped/)
})
