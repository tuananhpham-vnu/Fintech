const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  { execFileSync } = require('node:child_process'),
  { randomUUID } = require('node:crypto')
test(
  'operator private-cache command provisions actual Windows DACL, accepted by runtime, and refuses existing path',
  { skip: process.platform !== 'win32' },
  () => {
    const target = path.join(os.tmpdir(), 'aic-cache-provision-' + randomUUID()),
      script = path.resolve(__dirname, '../create-private-cache.ps1')
    const run = () =>
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-File', script, '-Path', target],
        { windowsHide: true, stdio: 'pipe' },
      )
    run()
    const { PrivateDocumentFiles } = require('../../apps/api/dist/document-storage/private-files')
    new PrivateDocumentFiles(target)
    const before = fs.readdirSync(target)
    assert.throws(run)
    assert.deepEqual(fs.readdirSync(target), before)
    for (const name of fs.readdirSync(target)) {
      const p = path.join(target, name)
      if (fs.statSync(p).isDirectory() && fs.readdirSync(p).length === 0) fs.rmdirSync(p)
    }
    fs.rmdirSync(target)
  },
)
