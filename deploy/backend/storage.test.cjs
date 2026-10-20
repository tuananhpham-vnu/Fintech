'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { test } = require('node:test')

// Exercise the compiled, unchanged adapter with a POSIX filesystem model.
// Copy-up changes birthtime even when overlay inode/device numbers stay stable.
// This is a deterministic regression, not a claim to run a real OverlayFS mount.
function fixture({ baked = false } = {}) {
  const nodes = new Map()
  let clock = 100n
  const add = (name, { lower = false, mode = 0o700n, uid = 10001n, link = false } = {}) => {
    nodes.set(name, { dev: 1n, ino: ++clock, birthtimeNs: clock, mode, uid, lower, link })
  }
  for (const name of ['/', '/var', '/var/lib']) add(name, { lower: true, mode: 0o755n, uid: 0n })
  add('/var/lib/aic', { lower: true })
  if (baked) {
    add('/var/lib/aic/private', { lower: true })
    add('/var/lib/aic/ledger', { lower: true })
  }
  const stat = (name) => {
    const n = nodes.get(name)
    if (!n) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return { ...n, isDirectory: () => !n.link, isSymbolicLink: () => n.link }
  }
  const fakeFs = {
    constants: fs.constants,
    lstatSync: stat,
    realpathSync: { native: (name) => name },
    mkdirSync(name, options) {
      if (nodes.has(name)) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      let parent = path.posix.dirname(name)
      stat(parent)
      for (;;) {
        const n = nodes.get(parent)
        if (n.lower) { n.birthtimeNs = ++clock; n.lower = false }
        if (parent === '/') break
        parent = path.posix.dirname(parent)
      }
      add(name, { mode: BigInt(options.mode) })
    },
  }
  const linux = { platform: 'linux', geteuid: () => 10001 }
  function load(filename) {
    const absolute = path.resolve(__dirname, filename)
    const module = { exports: {} }
    const realRequire = createRequire(absolute)
    const requireMock = (name) => name === 'node:fs' ? fakeFs
      : name === 'node:path' ? path.posix : realRequire(name)
    vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), {
      module, exports: module.exports, require: requireMock, process: linux,
      Buffer, __dirname: path.posix.dirname(absolute.replaceAll('\\', '/')),
    }, { filename: absolute })
    return module.exports
  }
  const { PrivateDocumentFiles } = load('../../apps/api/dist/document-storage/private-files.js')
  return { nodes, add, fakeFs, load, PrivateDocumentFiles }
}

test('old image layout reproduces DIRECTORY_CHANGED on first cache mkdir', () => {
  const f = fixture({ baked: true })
  assert.throws(() => new f.PrivateDocumentFiles('/var/lib/aic/private'), { code: 'DIRECTORY_CHANGED' })
})

test('runtime provisioning precedes all identity pins, including later ledger writes', () => {
  const f = fixture()
  const { prepareStorage } = f.load('prepare-storage.cjs')
  prepareStorage('/var/lib/aic/private', '/var/lib/aic/ledger')
  const adapters = Array.from({ length: 3 }, () => new f.PrivateDocumentFiles('/var/lib/aic/private'))
  // A new ledger child must not copy up a pinned common ancestor later.
  f.fakeFs.mkdirSync('/var/lib/aic/ledger/first-write', { mode: 0o700 })
  for (const adapter of adapters) adapter.guard()
  prepareStorage('/var/lib/aic/private', '/var/lib/aic/ledger') // restart is idempotent
  for (const name of ['/var/lib/aic/private', '/var/lib/aic/private/cache', '/var/lib/aic/ledger']) {
    assert.equal(f.nodes.get(name).lower, false)
    assert.equal(f.nodes.get(name).mode, 0o700n)
    assert.equal(f.nodes.get(name).uid, 10001n)
  }
  f.add('/var/lib/aic/private/cache') // real replacement still fails closed
  for (const adapter of adapters) assert.throws(() => adapter.guard(), { code: 'DIRECTORY_CHANGED' })
})

test('provisioning rejects aliases, wrong ownership and permissive existing directories', () => {
  for (const name of ['/var', '/var/lib/aic', '/var/lib/aic/private', '/var/lib/aic/private/cache', '/var/lib/aic/ledger']) {
    const f = fixture({ baked: true })
    f.add(name, { link: true })
    const { prepareStorage } = f.load('prepare-storage.cjs')
    assert.throws(() => prepareStorage('/var/lib/aic/private', '/var/lib/aic/ledger'))
    assert.equal(f.nodes.get(name).link, true)
  }
  for (const options of [{ uid: 0n }, { mode: 0o755n }]) {
    for (const name of ['/var/lib/aic', '/var/lib/aic/private', '/var/lib/aic/ledger']) {
      const f = fixture({ baked: true })
      f.add(name, options)
      const before = { ...f.nodes.get(name) }
      const { prepareStorage } = f.load('prepare-storage.cjs')
      assert.throws(() => prepareStorage('/var/lib/aic/private', '/var/lib/aic/ledger'))
      assert.deepEqual(f.nodes.get(name), before) // never chmod/chown an unsafe directory
    }
  }
})

test('provisioning rejects unexpected configured paths without creating directories', () => {
  const f = fixture()
  const { prepareStorage } = f.load('prepare-storage.cjs')
  const before = [...f.nodes.keys()]
  for (const [root, ledger] of [
    ['/tmp/private', '/var/lib/aic/ledger'],
    ['/var/lib/aic/../private', '/var/lib/aic/ledger'],
    ['/var/lib/aic/private', '/var/lib/aic/private'],
    ['/var/lib/aic/private', undefined],
  ]) assert.throws(() => prepareStorage(root, ledger))
  assert.deepEqual([...f.nodes.keys()], before)
})

test('supervisor provisions storage before spawning any service', () => {
  const source = fs.readFileSync(path.join(__dirname, 'start.cjs'), 'utf8')
  const calls = []
  const stop = new Error('test stops before spawning services')
  vm.runInNewContext(source, {
    require(name) {
      if (name === 'node:child_process') return { spawn() { calls.push('spawn'); throw stop } }
      if (name === './db-url.cjs') return { databaseUrlProblem: () => undefined }
      if (name === './prepare-storage.cjs') return { prepareStorage() { calls.push('prepare'); throw stop } }
      return require(name)
    },
    __dirname,
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
    process: {
      env: { DATABASE_URL: 'synthetic', INTERNAL_API_KEY: 'synthetic', AIC_STORAGE_DIR: '/var/lib/aic/private',
        AI_SPEND_LEDGER_DIR: '/var/lib/aic/ledger', AIC_FRONTEND_ORIGIN: 'synthetic', PORT: '10000' },
      on() {}, stderr: { write() {} }, exit() {},
    },
  })
  assert.deepEqual(calls, ['prepare'])
})

// Opt-in on a FRESH backend image: no DB, HTTP or model calls. This exercises the
// actual container filesystem as UID 10001, including independent Node processes.
test('fresh Linux image: provisioning, workers, publication and ledger writes', {
  skip: process.env.AIC_STORAGE_SMOKE !== '1',
}, async () => {
  assert.equal(process.platform, 'linux')
  assert.equal(process.geteuid(), 10001)
  const root = '/var/lib/aic/private'
  const ledger = '/var/lib/aic/ledger'
  assert.equal(fs.existsSync(root), false, 'private must not be baked into the image')
  assert.equal(fs.existsSync(ledger), false, 'ledger must not be baked into the image')
  require('./prepare-storage.cjs').prepareStorage(root, ledger)
  const adapterPath = path.resolve(__dirname, '../../apps/api/dist/document-storage/private-files.js')
  const { PrivateDocumentFiles } = require(adapterPath)
  const adapter = new PrivateDocumentFiles(root)
  const { execFile } = require('node:child_process')
  const { promisify } = require('node:util')
  const child = `
    const fs = require('node:fs'), { createHash } = require('node:crypto');
    const { PrivateDocumentFiles } = require(process.argv[1]);
    (async () => {
      const bytes = Buffer.from('synthetic container storage check');
      const handle = await new PrivateDocumentFiles(process.argv[2]).materialize(
        bytes, createHash('sha256').update(bytes).digest('hex'));
      require('node:assert/strict').deepEqual(fs.readFileSync(process.argv[2] + '/' + handle.storageKey), bytes);
      await handle.release();
    })().catch(() => { process.exitCode = 1; });
  `
  await Promise.all(Array.from({ length: 3 }, () =>
    promisify(execFile)(process.execPath, ['-e', child, adapterPath, root], { timeout: 15000 })))
  const probe = path.join(ledger, 'synthetic-storage-check')
  fs.writeFileSync(probe, 'synthetic', { flag: 'wx', mode: 0o600 })
  try { adapter.guard() } finally { fs.unlinkSync(probe) }
  assert.deepEqual(fs.readdirSync(path.join(root, 'cache')), [])
})
