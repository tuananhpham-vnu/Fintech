const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { execFileSync, fork } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { test } = require('node:test')
const {
  PrivateDocumentFiles,
  PrivateFilesError,
} = require('../dist/document-storage/private-files.js')
const { DOCUMENT_MAX_BYTES } = require('../dist/documents/ports.js')

const windows = process.platform === 'win32'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const synthetic = Buffer.from([0, 255, 13, 10, 0, 128, 37, 80, 68, 70, 45, 0])
const powershell = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)
function securityScript(script, root) {
  execFileSync(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$ErrorActionPreference = 'Stop'\n${script}`,
    ],
    {
      env: { ...process.env, AIC_PRIVATE_FILES_TEST_ROOT: root },
      windowsHide: true,
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
}
function protect(root) {
  if (!windows) return fs.chmodSync(root, 0o700)
  securityScript(
    `
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($me)
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($me.Value, 'S-1-5-18', 'S-1-5-32-544')) {
  $identity = New-Object Security.Principal.SecurityIdentifier($sid)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
[IO.Directory]::SetAccessControl($env:AIC_PRIVATE_FILES_TEST_ROOT, $acl)
`,
    root,
  )
}
// Delete only this suite's freshly allocated namespace. lstat prevents following
// symlinks/junctions; no recursive shell deletion or user-configured directory.
function removeTestTree(root, boundary) {
  const relative = path.relative(boundary, root)
  assert.ok(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)))
  const info = fs.lstatSync(root)
  if (info.isSymbolicLink()) return fs.unlinkSync(root)
  if (info.isDirectory()) {
    for (const entry of fs.readdirSync(root)) removeTestTree(path.join(root, entry), boundary)
    fs.rmdirSync(root)
  } else {
    fs.chmodSync(root, 0o600)
    fs.unlinkSync(root)
  }
}
function actualPath(root, handle) {
  assert.match(
    handle.storageKey,
    /^cache\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/,
  )
  assert.equal(path.isAbsolute(handle.storageKey), false)
  return path.join(root, handle.storageKey)
}
function fileEquals(root, handle, bytes) {
  const file = actualPath(root, handle)
  assert.deepEqual(fs.readFileSync(file), bytes)
  assert.equal(digest(fs.readFileSync(file)), digest(bytes))
  assert.equal(fs.statSync(file).size, bytes.length)
  assert.equal(fs.statSync(file).nlink, 1)
  return file
}
function linkOrSkip(t, target, name, type) {
  try {
    fs.symlinkSync(target, name, type)
    return true
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip(`Platform disallows ${type} creation (${error.code})`)
      return false
    }
    throw error
  }
}

// External attacker for actual readback/failure-cleanup exercises. It uses only
// real filesystem operations, never patches UUIDs/fs, and never leaves the test
// cache namespace. Parent retries a bounded number of times to allow scheduling.
if (process.env.AIC_PRIVATE_FILES_MATERIALIZER === 'true') {
  const adapter = new PrivateDocumentFiles(process.env.AIC_PRIVATE_FILES_TEST_ROOT)
  let handle
  process.on('message', async (message) => {
    try {
      if (message === 'go') {
        handle = await adapter.materialize(synthetic, digest(synthetic))
        process.send(handle.storageKey)
      } else if (message === 'release') {
        await handle.release()
        process.disconnect()
      }
    } catch (error) {
      process.stderr.write(String(error))
      process.exitCode = 1
      process.disconnect()
    }
  })
  process.send('ready')
} else if (process.env.AIC_PRIVATE_FILES_ATTACKER === 'true') {
  const root = process.env.AIC_PRIVATE_FILES_ATTACK_ROOT
  const mode = process.env.AIC_PRIVATE_FILES_ATTACK_MODE
  let active = true
  process.on('message', (message) => {
    if (message === 'stop') active = false
  })
  process.send('ready')
  const tick = () => {
    if (!active) {
      process.disconnect()
      return
    }
    for (const entry of fs.readdirSync(root)) {
      if (!/^\.[0-9a-f-]+\.tmp$/.test(entry)) continue
      const file = path.join(root, entry)
      try {
        if (mode === 'collision') {
          const destination = path.join(root, `${entry.slice(1, -4)}.pdf`)
          fs.writeFileSync(destination, 'collision-sentinel', { flag: 'wx', mode: 0o600 })
        } else {
          const fd = fs.openSync(file, 'r+')
          try {
            if (fs.fstatSync(fd).size === DOCUMENT_MAX_BYTES) {
              fs.writeSync(fd, Buffer.from([0x7f]), 0, 1, DOCUMENT_MAX_BYTES - 1)
            }
          } finally {
            fs.closeSync(fd)
          }
        }
      } catch (error) {
        if (!['ENOENT', 'EACCES', 'EPERM', 'EEXIST'].includes(error.code)) throw error
      }
    }
    setImmediate(tick)
  }
  tick()
} else {
  test('private materialization on the actual local filesystem', { timeout: 240000 }, async (t) => {
    const boundary = fs.mkdtempSync(path.join(os.tmpdir(), 'aic-private-files-test-'))
    const allocated = path.resolve(boundary)
    assert.equal(path.dirname(allocated), path.resolve(os.tmpdir()))
    function fixture() {
      const root = fs.mkdtempSync(path.join(boundary, 'owned-'))
      fs.chmodSync(root, 0o700)
      return { root, adapter: new PrivateDocumentFiles(root) }
    }
    try {
      protect(boundary)
      await t.test(
        'explicit existing absolute root, never public, git, aliases or drive roots',
        () => {
          for (const root of [
            undefined,
            null,
            '',
            '.',
            'relative/cache',
            path.parse(boundary).root,
            path.join(boundary, 'missing'),
            path.join(boundary, '.git'),
            path.join(boundary, 'apps', 'web', 'public'),
            path.join(boundary, '.git', 'cache'),
            path.join(boundary, 'APPS', 'WEB', 'PUBLIC', 'cache'),
          ]) {
            assert.throws(() => new PrivateDocumentFiles(root), PrivateFilesError)
          }
          if (windows) {
            for (const root of [
              'C:relative',
              '\\implicit-drive',
              '\\\\localhost\\share',
              `${boundary}:stream`,
            ]) {
              assert.throws(() => new PrivateDocumentFiles(root), PrivateFilesError)
            }
          }
          assert.equal(fs.existsSync(path.join(boundary, 'missing')), false)
        },
      )

      await t.test(
        'requires private ownership/permissions and rechecks changed permissions',
        async () => {
          const { root, adapter } = fixture()
          if (windows) {
            securityScript(
              `
$acl = [IO.Directory]::GetAccessControl($env:AIC_PRIVATE_FILES_TEST_ROOT)
$everyone = New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
$rule = New-Object Security.AccessControl.FileSystemAccessRule($everyone, 'ReadAndExecute', 'Allow')
$acl.AddAccessRule($rule)
[IO.Directory]::SetAccessControl($env:AIC_PRIVATE_FILES_TEST_ROOT, $acl)
`,
              root,
            )
          } else fs.chmodSync(root, 0o755)
          try {
            assert.throws(() => new PrivateDocumentFiles(root), PrivateFilesError)
            await assert.rejects(
              adapter.materialize(synthetic, digest(synthetic)),
              PrivateFilesError,
            )
            assert.deepEqual(fs.readdirSync(path.join(root, 'cache')), [])
          } finally {
            protect(root)
          }
        },
      )

      await t.test(
        'exact binary slices, readonly output, frozen handle and capability observation',
        async () => {
          const { root, adapter } = fixture()
          assert.equal(adapter.capabilities.directoryFsync, 'not-attempted')
          const backing = Buffer.concat([Buffer.from('prefix'), synthetic, Buffer.from('suffix')])
          const bytes = backing.subarray(6, 6 + synthetic.length)
          const handle = await adapter.materialize(bytes, digest(bytes).toUpperCase())
          const file = fileEquals(root, handle, synthetic)
          backing.fill(0)
          fileEquals(root, handle, synthetic)
          assert.ok(Object.isFrozen(handle))
          assert.ok(Object.isFrozen(adapter.capabilities))
          assert.equal(fs.statSync(file).mode & 0o222, 0)
          assert.equal(adapter.capabilities.canonical, false)
          assert.equal(adapter.capabilities.publication, 'hard-link-create-if-absent')
          assert.ok(['succeeded', 'unsupported'].includes(adapter.capabilities.directoryFsync))
          if (adapter.capabilities.directoryFsync === 'unsupported') {
            assert.match(adapter.capabilities.directoryFsyncError, /^[A-Z0-9_]+$/)
          }
          t.diagnostic(
            `Observed directory fsync: ${adapter.capabilities.directoryFsync}` +
              (adapter.capabilities.directoryFsyncError
                ? ` (${adapter.capabilities.directoryFsyncError})`
                : '') +
              '; cache only, no power-loss durability claim',
          )
          await Promise.all([handle.release(), handle.release()])
          assert.deepEqual(fs.readdirSync(path.join(root, 'cache')), [])
          assert.ok(fs.statSync(root).isDirectory())
        },
      )

      await t.test(
        '10 MiB inclusive ceiling, oversize/shadowed views/malformed hash rejected before disk',
        async () => {
          const { root, adapter } = fixture()
          assert.equal(DOCUMENT_MAX_BYTES, 10 * 1024 * 1024)
          const bytes = Buffer.alloc(DOCUMENT_MAX_BYTES, 0x31)
          const maximum = await adapter.materialize(bytes, digest(bytes))
          fileEquals(root, maximum, bytes)
          await maximum.release()
          const oversize = Buffer.alloc(DOCUMENT_MAX_BYTES + 1)
          Object.defineProperty(oversize, 'byteLength', { value: 0 })
          await assert.rejects(adapter.materialize(oversize, digest(oversize)), {
            code: 'BYTE_LIMIT_EXCEEDED',
          })
          for (const hash of ['0'.repeat(64), '', 'a'.repeat(63), `${digest(synthetic)}\n`, null]) {
            await assert.rejects(adapter.materialize(synthetic, hash))
          }
          for (const bytes of [
            'synthetic',
            new Uint8Array([1, 2]),
            Buffer.from(new SharedArrayBuffer(2)),
          ]) {
            await assert.rejects(adapter.materialize(bytes, '0'.repeat(64)))
          }
          assert.deepEqual(fs.readdirSync(path.join(root, 'cache')), [])
          const empty = await adapter.materialize(Buffer.alloc(0), digest(Buffer.alloc(0)))
          fileEquals(root, empty, Buffer.alloc(0))
          await empty.release()
        },
      )

      await t.test(
        'concurrent equal bytes produce unique identities across adapter instances',
        async () => {
          const { root, adapter } = fixture()
          const other = new PrivateDocumentFiles(root)
          const handles = await Promise.all(
            Array.from({ length: 8 }, (_, index) =>
              (index % 2 ? adapter : other).materialize(synthetic, digest(synthetic)),
            ),
          )
          assert.equal(new Set(handles.map((handle) => handle.storageKey)).size, handles.length)
          assert.equal(
            new Set(
              handles.map((handle) => fs.statSync(actualPath(root, handle), { bigint: true }).ino),
            ).size,
            handles.length,
          )
          for (const handle of handles) fileEquals(root, handle, synthetic)
          await handles[0].release()
          for (const handle of handles.slice(1)) fileEquals(root, handle, synthetic)
          await Promise.all(handles.map((handle) => handle.release()))
          assert.deepEqual(fs.readdirSync(path.join(root, 'cache')), [])
        },
      )

      await t.test(
        'actual hardlink create-if-absent refuses overwrite and preserves exact old descriptors',
        async () => {
          const { root, adapter } = fixture()
          const first = await adapter.materialize(synthetic, digest(synthetic))
          const oldFile = fileEquals(root, first, synthetic)
          const fd = fs.openSync(oldFile, 'r')
          try {
            const replacement = Buffer.from('new-synthetic-version')
            const second = await adapter.materialize(replacement, digest(replacement))
            const secondFile = fileEquals(root, second, replacement)
            assert.throws(() => fs.linkSync(secondFile, oldFile), { code: 'EEXIST' })
            assert.deepEqual(fs.readFileSync(fd), synthetic)
            fileEquals(root, first, synthetic)
            await first.release() // Real Windows open-handle + readonly cleanup.
            assert.equal(fs.existsSync(oldFile), false)
            const stillOpen = Buffer.alloc(synthetic.length)
            assert.equal(fs.readSync(fd, stillOpen, 0, stillOpen.length, 0), synthetic.length)
            assert.deepEqual(stillOpen, synthetic)
            fileEquals(root, second, replacement)
            await second.release()
          } finally {
            fs.closeSync(fd)
          }
        },
      )

      await t.test(
        'independent processes publish concurrently into the same private root',
        async () => {
          const { root, adapter } = fixture()
          const old = await adapter.materialize(synthetic, digest(synthetic))
          const children = Array.from({ length: 2 }, () =>
            fork(__filename, [], {
              env: {
                ...process.env,
                AIC_PRIVATE_FILES_MATERIALIZER: 'true',
                AIC_PRIVATE_FILES_TEST_ROOT: root,
              },
              windowsHide: true,
              stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
            }),
          )
          const errors = []
          for (const child of children) child.stderr.on('data', (data) => errors.push(String(data)))
          try {
            const ready = await Promise.all(children.map((child) => once(child, 'message')))
            assert.ok(
              ready.every(([message]) => message === 'ready'),
              errors.join(''),
            )
            const results = children.map((child) => once(child, 'message'))
            for (const child of children) child.send('go')
            const keys = (await Promise.all(results)).map(([key]) => key)
            assert.equal(new Set([...keys, old.storageKey]).size, 3)
            for (const storageKey of keys) fileEquals(root, { storageKey }, synthetic)
            fileEquals(root, old, synthetic)
            const exits = children.map((child) => once(child, 'exit'))
            for (const child of children) child.send('release')
            for (const [exitCode] of await Promise.all(exits))
              assert.equal(exitCode, 0, errors.join(''))
            assert.deepEqual(fs.readdirSync(path.join(root, 'cache')), [
              path.basename(old.storageKey),
            ])
          } finally {
            for (const child of children) if (child.exitCode === null) child.kill()
            await old.release()
          }
        },
      )

      await t.test(
        'release refuses extra hardlink aliases without changing their bytes or readonly state',
        async () => {
          const { root, adapter } = fixture()
          const handle = await adapter.materialize(synthetic, digest(synthetic))
          const file = actualPath(root, handle)
          const alias = path.join(root, 'operator-alias')
          fs.linkSync(file, alias)
          await assert.rejects(handle.release(), { code: 'UNEXPECTED_LINK_COUNT' })
          assert.deepEqual(fs.readFileSync(alias), synthetic)
          assert.equal(fs.statSync(alias).mode & 0o222, 0)
          // Windows removal of a readonly hardlink requires clearing the shared
          // attribute. This is test-owned setup, not adapter release authority.
          fs.chmodSync(alias, 0o600)
          fs.unlinkSync(alias)
          fs.chmodSync(file, 0o400)
          await handle.release()
        },
      )

      await t.test(
        'changed root inode rejected; release can retry after exact namespace restored',
        async () => {
          const { root, adapter } = fixture()
          const handle = await adapter.materialize(synthetic, digest(synthetic))
          const displaced = `${root}-displaced`
          fs.renameSync(root, displaced)
          fs.mkdirSync(root, { mode: 0o700 })
          const sentinel = path.join(root, 'sentinel')
          fs.writeFileSync(sentinel, 'keep')
          try {
            await assert.rejects(
              adapter.materialize(synthetic, digest(synthetic)),
              PrivateFilesError,
            )
            await assert.rejects(handle.release(), PrivateFilesError)
            assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep')
            assert.deepEqual(fs.readFileSync(path.join(displaced, handle.storageKey)), synthetic)
          } finally {
            fs.unlinkSync(sentinel)
            fs.rmdirSync(root)
            fs.renameSync(displaced, root)
          }
          await handle.release()
        },
      )

      await t.test(
        'file replacement cannot be deleted by release, including repeated release',
        async () => {
          const { root, adapter } = fixture()
          const handle = await adapter.materialize(synthetic, digest(synthetic))
          const file = actualPath(root, handle)
          const displaced = `${file}.owned`
          fs.renameSync(file, displaced)
          fs.writeFileSync(file, 'unowned-sentinel')
          await assert.rejects(handle.release(), { code: 'FILE_CHANGED' })
          assert.equal(fs.readFileSync(file, 'utf8'), 'unowned-sentinel')
          fs.unlinkSync(file)
          fs.renameSync(displaced, file)
          await handle.release()
          fs.writeFileSync(file, 'later-unowned-sentinel')
          await handle.release()
          assert.equal(fs.readFileSync(file, 'utf8'), 'later-unowned-sentinel')
          fs.unlinkSync(file)
        },
      )

      await t.test(
        'missing own file is idempotent; unrelated files and directories survive',
        async () => {
          const { root, adapter } = fixture()
          const sentinel = path.join(root, 'cache', 'operator-file')
          const operatorDir = path.join(root, 'cache', 'operator-directory')
          fs.writeFileSync(sentinel, 'keep')
          fs.mkdirSync(operatorDir)
          const handle = await adapter.materialize(synthetic, digest(synthetic))
          const file = actualPath(root, handle)
          fs.chmodSync(file, 0o600)
          fs.unlinkSync(file)
          await handle.release()
          assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep')
          assert.ok(fs.statSync(operatorDir).isDirectory())
        },
      )

      for (const type of windows ? ['junction', 'dir'] : ['dir']) {
        await t.test(
          `${type}: preexisting aliased cache is rejected without touching its target`,
          (subtest) => {
            const root = fs.mkdtempSync(path.join(boundary, 'preexisting-'))
            const target = fs.mkdtempSync(path.join(boundary, 'cache-target-'))
            const cache = path.join(root, 'cache')
            if (!linkOrSkip(subtest, target, cache, type)) return
            assert.throws(() => new PrivateDocumentFiles(root), PrivateFilesError)
            assert.deepEqual(fs.readdirSync(target), [])
          },
        )

        await t.test(`${type}: reject aliased root and ancestor components`, (subtest) => {
          const target = fs.mkdtempSync(path.join(boundary, 'link-target-'))
          const alias = path.join(boundary, `alias-${type}`)
          if (!linkOrSkip(subtest, target, alias, type)) return
          try {
            fs.mkdirSync(path.join(target, 'child'), { mode: 0o700 })
            assert.throws(() => new PrivateDocumentFiles(alias), PrivateFilesError)
            assert.throws(
              () => new PrivateDocumentFiles(path.join(alias, 'child')),
              PrivateFilesError,
            )
            assert.equal(fs.existsSync(path.join(target, 'cache')), false)
          } finally {
            fs.unlinkSync(alias)
          }
        })

        await t.test(
          `${type}: substituted cache cannot escape during write or release`,
          async (subtest) => {
            const { root, adapter } = fixture()
            const handle = await adapter.materialize(synthetic, digest(synthetic))
            const cache = path.join(root, 'cache')
            const parked = path.join(root, 'parked-cache')
            const outside = fs.mkdtempSync(path.join(boundary, 'outside-'))
            const foreign = path.join(outside, path.basename(handle.storageKey))
            fs.writeFileSync(foreign, 'outside-sentinel')
            fs.renameSync(cache, parked)
            if (!linkOrSkip(subtest, outside, cache, type)) {
              fs.renameSync(parked, cache)
              await handle.release()
              return
            }
            try {
              await assert.rejects(
                adapter.materialize(synthetic, digest(synthetic)),
                PrivateFilesError,
              )
              await assert.rejects(handle.release(), PrivateFilesError)
              assert.equal(fs.readFileSync(foreign, 'utf8'), 'outside-sentinel')
              assert.deepEqual(fs.readdirSync(outside), [path.basename(foreign)])
            } finally {
              fs.unlinkSync(cache)
              fs.renameSync(parked, cache)
            }
            await handle.release()
          },
        )
      }

      await t.test(
        'preexisting cache symlink and published-file symlink rejected',
        async (subtest) => {
          const { root, adapter } = fixture()
          const handle = await adapter.materialize(synthetic, digest(synthetic))
          const file = actualPath(root, handle)
          const parked = `${file}.owned`
          const outside = path.join(boundary, 'outside-file')
          fs.writeFileSync(outside, 'outside-content')
          fs.renameSync(file, parked)
          if (!linkOrSkip(subtest, outside, file, 'file')) {
            fs.renameSync(parked, file)
            await handle.release()
            return
          }
          try {
            await assert.rejects(handle.release(), { code: 'FILE_CHANGED' })
            assert.equal(fs.readFileSync(outside, 'utf8'), 'outside-content')
          } finally {
            fs.unlinkSync(file)
            fs.renameSync(parked, file)
          }
          await handle.release()
          fs.rmdirSync(path.join(root, 'cache'))
          const target = fs.mkdtempSync(path.join(boundary, 'cache-target-'))
          if (!linkOrSkip(subtest, target, path.join(root, 'cache'), windows ? 'junction' : 'dir'))
            return
          assert.throws(() => new PrivateDocumentFiles(root), PrivateFilesError)
          assert.deepEqual(fs.readdirSync(target), [])
        },
      )

      await t.test(
        'corrupt cache is noncanonical; fresh materialization uses independently accepted bytes',
        async () => {
          const { root, adapter } = fixture()
          const first = await adapter.materialize(synthetic, digest(synthetic))
          const file = actualPath(root, first)
          fs.chmodSync(file, 0o600) // Demonstrates same-account readonly is advisory.
          const corrupt = Buffer.from(synthetic)
          corrupt[0] ^= 1
          fs.writeFileSync(file, corrupt)
          assert.notEqual(digest(fs.readFileSync(file)), digest(synthetic))
          await assert.rejects(adapter.materialize(corrupt, digest(synthetic)), {
            code: 'SHA256_MISMATCH',
          })
          const recovered = await adapter.materialize(synthetic, digest(synthetic))
          fileEquals(root, recovered, synthetic)
          assert.notEqual(first.storageKey, recovered.storageKey)
          await first.release()
          fileEquals(root, recovered, synthetic)
          await recovered.release()
        },
      )

      for (const mode of ['corruption', 'collision']) {
        await t.test(
          `external ${mode} during real publication fails closed and cleans only owned files`,
          async () => {
            const { root, adapter } = fixture()
            const cache = path.join(root, 'cache')
            const child = fork(__filename, [], {
              env: {
                ...process.env,
                AIC_PRIVATE_FILES_ATTACKER: 'true',
                AIC_PRIVATE_FILES_ATTACK_ROOT: cache,
                AIC_PRIVATE_FILES_ATTACK_MODE: mode,
              },
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            })
            let childErrors = ''
            child.stderr.on('data', (data) => {
              childErrors += data
            })
            let detected = false
            try {
              const [message] = await once(child, 'message')
              assert.equal(message, 'ready')
              const bytes = Buffer.alloc(DOCUMENT_MAX_BYTES, 0x31)
              const hash = digest(bytes)
              for (let attempt = 0; attempt < 6 && !detected; attempt++) {
                try {
                  const handle = await adapter.materialize(bytes, hash)
                  await handle.release()
                } catch (error) {
                  if (mode === 'corruption')
                    assert.ok(
                      ['SHA256_MISMATCH', 'FILE_SIZE_MISMATCH'].includes(error.code),
                      String(error),
                    )
                  else assert.equal(error.filesystemCode, 'EEXIST')
                  detected = true
                }
              }
            } finally {
              const exited = once(child, 'exit')
              child.send('stop')
              const [exitCode] = await exited
              assert.equal(exitCode, 0, childErrors)
            }
            assert.equal(detected, true, `External ${mode} must exercise a real filesystem failure`)
            const remaining = fs.readdirSync(cache)
            assert.ok(
              remaining.every((name) => name.endsWith('.pdf')),
              'Owned temporary files were removed',
            )
            if (mode === 'corruption') assert.deepEqual(remaining, [])
            else {
              assert.ok(remaining.length >= 1)
              for (const name of remaining)
                assert.equal(fs.readFileSync(path.join(cache, name), 'utf8'), 'collision-sentinel')
            }
          },
        )
      }
    } finally {
      assert.equal(path.resolve(boundary), allocated)
      assert.match(path.basename(allocated), /^aic-private-files-test-/)
      removeTestTree(allocated, allocated)
      assert.equal(fs.existsSync(allocated), false)
    }
  })
}
