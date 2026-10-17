import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  BigIntStats,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import * as path from 'node:path'
import { DOCUMENT_MAX_BYTES } from '../documents/ports'
import type { DocumentFiles } from '../documents/ports'
import { ByteIntegrityError, computeByteIntegrity, verifyByteIntegrity } from './byte-integrity'

export class PrivateFilesError extends Error {
  constructor(
    readonly code: string,
    readonly filesystemCode?: string,
  ) {
    super(`Private document cache failed: ${code}`)
    this.name = 'PrivateFilesError'
  }
}

type Identity = Pick<BigIntStats, 'dev' | 'ino' | 'birthtimeNs'>
type PinnedDirectory = { name: string; identity: Identity }
const limits = Object.freeze({ maxBytes: DOCUMENT_MAX_BYTES })
const windows = process.platform === 'win32'
const noFollow = windows ? 0 : constants.O_NOFOLLOW

function fail(code: string): never {
  throw new PrivateFilesError(code)
}
function errno(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException)?.code
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : undefined
}
function sanitized(error: unknown): Error {
  return error instanceof PrivateFilesError || error instanceof ByteIntegrityError
    ? error
    : new PrivateFilesError('FILESYSTEM_FAILURE', errno(error))
}
function same(a: Identity, b: Identity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs
}
function normalized(name: string): string {
  const value = path.resolve(name)
  return windows ? value.toLowerCase() : value
}
function ancestors(name: string): string[] {
  const result = [name]
  while (path.dirname(result[0]) !== result[0]) result.unshift(path.dirname(result[0]))
  return result
}
function directory(name: string): BigIntStats {
  const info = lstatSync(name, { bigint: true })
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.ino === 0n ||
    normalized(realpathSync.native(name)) !== normalized(name)
  )
    fail('UNSAFE_PATH')
  return info
}

// Node does not expose Windows DACLs or all reparse tags. Fail closed if the local
// Windows security API cannot be queried. No interpolated paths or shell commands.
// SYSTEM and elevated local administrators are necessarily trusted operators.
const windowsSecurity = `
$ErrorActionPreference = 'Stop'
$config = $env:AIC_PRIVATE_FILES_CHECK | ConvertFrom-Json
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$trusted = @($me, 'S-1-5-18', 'S-1-5-32-544')
foreach ($name in $config.components) {
  if (([IO.File]::GetAttributes($name) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'UNSAFE_PATH' }
}
foreach ($name in $config.private) {
  $acl = [IO.Directory]::GetAccessControl($name)
  $raw = New-Object Security.AccessControl.RawSecurityDescriptor($acl.GetSecurityDescriptorBinaryForm(), 0)
  if ($null -eq $raw.DiscretionaryAcl) { throw 'NOT_PRIVATE' }
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $me) { throw 'NOT_PRIVATE' }
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
        $rule.IdentityReference.Value -notin $trusted) { throw 'NOT_PRIVATE' }
  }
}
`

/**
 * Disposable, local filesystem cache implementing the frozen DocumentFiles port.
 * The explicitly configured root MUST already exist and be privately owned.
 * POSIX: effective uid owner, mode 0700 (no group/other access). Windows: owner
 * SID is the service account and every allow ACE is that SID, SYSTEM or admins.
 * Provision the root outside public hosting, with no reparse/symlink ancestors.
 *
 * File fsync + atomic hard-link publication are required. Directory fsync is
 * attempted and reported separately; success NEVER means power-loss durability.
 * PostgreSQL bytea remains canonical and must rematerialize missing/corrupt cache.
 *
 * Checks pin directory/file identities around critical operations, but portable
 * Node pathname APIs do not provide openat/unlinkat/Windows relative-handle APIs.
 * A hostile process with the same OS identity/admin rights can still race paths,
 * restore write permissions or mutate bytes after return. Isolate AI credentials
 * and mount/share read-only at deployment; chmod is only an additional safeguard.
 * Synchronous bounded filesystem sections prevent JS interleaving; not intended
 * as a high-throughput storage backend. Crashes may leave UUID cache/temp orphans;
 * this adapter never recursively removes or reconciles an operator's directory.
 */
export class PrivateDocumentFiles implements DocumentFiles {
  private readonly root: string
  private readonly cache: string
  private readonly pinned: PinnedDirectory[]
  private syncStatus: 'not-attempted' | 'succeeded' | 'unsupported' = 'not-attempted'
  private syncError?: string

  constructor(root: string) {
    try {
      if (
        typeof root !== 'string' ||
        !root ||
        root.includes('\0') ||
        !path.isAbsolute(root) ||
        (windows && !/^[a-z]:[\\/]/i.test(root))
      )
        fail('INVALID_ROOT')
      this.root = path.resolve(root)
      const segments = this.root.split(/[\\/]+/).map((part) => part.toLowerCase())
      if (
        this.root === path.parse(this.root).root ||
        segments.includes('.git') ||
        segments.some(
          (part, i) => part === 'apps' && segments[i + 1] === 'web' && segments[i + 2] === 'public',
        ) ||
        (windows &&
          segments
            .slice(1)
            .some(
              (part) =>
                /[:. ]$|:/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/.test(part),
            ))
      )
        fail('INVALID_ROOT')
      this.cache = path.join(this.root, 'cache')
      this.pinned = ancestors(this.root).map((name) => ({ name, identity: directory(name) }))
      this.checkPrivate([this.root])
      this.guard()
      try {
        mkdirSync(this.cache, { mode: 0o700 })
      } catch (error) {
        if (errno(error) !== 'EEXIST') throw error
      }
      this.guard()
      this.pinned.push({ name: this.cache, identity: directory(this.cache) })
      this.authorize()
    } catch (error) {
      throw sanitized(error)
    }
  }

  /** Capability observation only, deliberately separate from the frozen port. */
  get capabilities() {
    return Object.freeze({
      canonical: false as const,
      publication: 'hard-link-create-if-absent' as const,
      directoryFsync: this.syncStatus,
      directoryFsyncError: this.syncError,
      readOnly: windows ? ('windows-readonly-attribute' as const) : ('owner-read-mode' as const),
    })
  }

  private guard(): void {
    for (const entry of this.pinned) {
      if (!same(directory(entry.name), entry.identity)) fail('DIRECTORY_CHANGED')
    }
    if (!windows)
      this.checkPrivate(
        this.pinned
          .filter((entry) => entry.name === this.root || entry.name === this.cache)
          .map((entry) => entry.name),
      )
  }

  private checkPrivate(names: string[]): void {
    if (windows) {
      try {
        execFileSync(
          path.join(
            process.env.SystemRoot || 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe',
          ),
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsSecurity],
          {
            env: {
              ...process.env,
              AIC_PRIVATE_FILES_CHECK: JSON.stringify({
                components: this.pinned.map((entry) => entry.name),
                private: names,
              }),
            },
            windowsHide: true,
            timeout: 15_000,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        )
      } catch {
        fail('WINDOWS_SECURITY_CHECK_FAILED')
      }
    } else {
      for (const name of names) {
        const info = directory(name)
        if (
          info.uid !== BigInt(process.geteuid()) ||
          (info.mode & 0o077n) !== 0n ||
          (info.mode & 0o700n) !== 0o700n
        )
          fail('NOT_PRIVATE')
      }
    }
  }

  private authorize(): void {
    this.guard()
    if (windows) this.checkPrivate([this.root, this.cache])
    this.guard()
  }

  private own(name: string, identity: Identity): BigIntStats {
    this.guard()
    if (path.dirname(name) !== this.cache) fail('UNSAFE_PATH')
    const info = lstatSync(name, { bigint: true })
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      !same(info, identity) ||
      normalized(realpathSync.native(name)) !== normalized(name)
    )
      fail('FILE_CHANGED')
    return info
  }

  private readVerified(name: string, identity: Identity, sha256: string, byteLength: number): void {
    this.own(name, identity)
    const fd = openSync(name, constants.O_RDONLY | noFollow)
    try {
      const info = fstatSync(fd, { bigint: true })
      if (!same(info, identity) || !info.isFile()) fail('FILE_CHANGED')
      if (info.size !== BigInt(byteLength)) fail('FILE_SIZE_MISMATCH')
      // One extra byte detects growth; never allocate/read an unbounded file.
      const readback = Buffer.alloc(byteLength + 1)
      let count = 0
      while (count < readback.length) {
        const amount = readSync(fd, readback, count, readback.length - count, count)
        if (amount === 0) break
        count += amount
      }
      verifyByteIntegrity(readback.subarray(0, count), { sha256, byteLength }, limits)
      if (!same(fstatSync(fd, { bigint: true }), identity)) fail('FILE_CHANGED')
      this.own(name, identity)
    } finally {
      closeSync(fd)
    }
  }

  private removeOwn(name: string, identity: Identity): void {
    let info: BigIntStats
    try {
      info = this.own(name, identity)
    } catch (error) {
      if (errno(error) === 'ENOENT') {
        // Only a missing file in the STILL verified namespace is idempotent.
        this.guard()
        return
      }
      throw error
    }
    if (info.nlink !== 1n) fail('UNEXPECTED_LINK_COUNT')
    if (windows && (info.mode & 0o200n) === 0n) {
      // Windows requires clearing readonly before unlink. Change only a verified
      // descriptor, never chmod a potentially substituted pathname.
      const fd = openSync(name, constants.O_RDONLY | noFollow)
      try {
        if (!same(fstatSync(fd, { bigint: true }), identity)) fail('FILE_CHANGED')
        this.own(name, identity)
        fchmodSync(fd, 0o600)
      } finally {
        closeSync(fd)
      }
    }
    this.own(name, identity)
    unlinkSync(name)
    this.guard()
  }

  private syncDirectories(): void {
    for (const name of [this.cache, this.root]) {
      this.guard()
      let fd: number | undefined
      try {
        fd = openSync(name, constants.O_RDONLY | noFollow)
        const pinned = this.pinned.find((entry) => entry.name === name)
        if (!same(fstatSync(fd, { bigint: true }), pinned.identity)) fail('DIRECTORY_CHANGED')
        fsyncSync(fd)
        if (this.syncStatus !== 'unsupported') this.syncStatus = 'succeeded'
      } catch (error) {
        const code = errno(error)
        if (!['EPERM', 'EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP', 'ENOSYS', 'EBADF'].includes(code))
          throw error
        this.syncStatus = 'unsupported'
        this.syncError = code
      } finally {
        if (fd !== undefined) closeSync(fd)
      }
      this.guard()
    }
  }

  async materialize(
    bytes: Buffer,
    sha256: string,
  ): Promise<{ storageKey: string; release(): Promise<void> }> {
    // Validate BEFORE allocating a copy or touching disk. Intrinsic bounds in the
    // shared integrity helper prevent shadowed Buffer lengths bypassing 10 MiB.
    if (!Buffer.isBuffer(bytes)) fail('INVALID_BYTES')
    const actual = computeByteIntegrity(bytes, limits)
    verifyByteIntegrity(bytes, { sha256, byteLength: actual.byteLength }, limits)
    const snapshot = Buffer.alloc(actual.byteLength)
    Uint8Array.prototype.set.call(snapshot, bytes)
    verifyByteIntegrity(snapshot, { sha256, byteLength: actual.byteLength }, limits)
    const id = randomUUID()
    const storageKey = `cache/${id}.pdf`
    const temporary = path.join(this.cache, `.${id}.tmp`)
    const published = path.join(this.root, storageKey)
    let fd: number | undefined
    let identity: BigIntStats | undefined
    let linked = false
    let staged = false
    try {
      this.authorize()
      this.guard()
      fd = openSync(
        temporary,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      )
      identity = fstatSync(fd, { bigint: true })
      staged = true
      if (!identity.isFile() || identity.nlink !== 1n) fail('FILE_CHANGED')
      this.own(temporary, identity)
      writeFileSync(fd, snapshot)
      fsyncSync(fd)
      this.readVerified(temporary, identity, sha256, actual.byteLength)
      this.own(temporary, identity)
      // link() fails with EEXIST, unlike rename() which may replace a version.
      linkSync(temporary, published)
      linked = true
      if (this.own(published, identity).nlink !== 2n) fail('UNEXPECTED_LINK_COUNT')
      this.own(temporary, identity)
      unlinkSync(temporary)
      staged = false
      this.own(published, identity)
      fchmodSync(fd, 0o400)
      fsyncSync(fd)
      this.readVerified(published, identity, sha256, actual.byteLength)
      this.syncDirectories()
      this.authorize()
      this.readVerified(published, identity, sha256, actual.byteLength)
      closeSync(fd)
      fd = undefined
    } catch (error) {
      if (fd !== undefined) {
        try {
          closeSync(fd)
        } catch {
          /* cleanup still attempted */
        }
      }
      let cleanupFailed = false
      // Both names may still link our inode. Remove staging first without ever
      // claiming a destination when link() failed (including EEXIST).
      for (const name of [...(staged ? [temporary] : []), ...(linked ? [published] : [])]) {
        try {
          const info = this.own(name, identity)
          if (info.nlink === 2n && staged && linked && name === temporary) {
            unlinkSync(name)
            this.guard()
          } else this.removeOwn(name, identity)
        } catch {
          cleanupFailed = true
        }
      }
      if (cleanupFailed) throw new PrivateFilesError('CLEANUP_REFUSED_OR_FAILED', errno(error))
      throw sanitized(error)
    }
    let released = false
    return Object.freeze({
      storageKey,
      release: async () => {
        if (released) return
        try {
          this.authorize()
          this.removeOwn(published, identity)
          released = true
          this.syncDirectories()
        } catch (error) {
          throw sanitized(error)
        }
      },
    })
  }
}
