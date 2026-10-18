// Copies reviewed source bytes, including uncommitted work; never alters Git.
const fs = require('node:fs'),
  path = require('node:path'),
  { execFileSync } = require('node:child_process'),
  { createHash } = require('node:crypto')
const { inspect } = require('./prepare-source-checkpoint.cjs')
const root = path.resolve(__dirname, '..'),
  hash = (b) => createHash('sha256').update(b).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })
const split = (b) => b.toString('utf8').split('\0').filter(Boolean)
function safePath(base, relative) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    relative.includes('\\') ||
    relative.split('/').some((p) => !p || p === '.' || p === '..') ||
    path.isAbsolute(relative)
  )
    throw Error('Unsafe snapshot path')
  const file = path.resolve(base, relative)
  if (!file.startsWith(base + path.sep)) throw Error('Path escapes snapshot')
  let cursor = base
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part)
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink())
      throw Error('Symlinks are not source bytes')
  }
  return file
}
function verify(directory) {
  const base = path.resolve(directory),
    manifest = JSON.parse(fs.readFileSync(path.join(base, 'MANIFEST.json'), 'utf8'))
  const expected = new Set(['MANIFEST.json', ...manifest.files.map((f) => f.path)])
  function inventory(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name),
        relative = path.relative(base, file).replaceAll('\\', '/')
      if (entry.isSymbolicLink()) throw Error('Unexpected snapshot symlink')
      if (entry.isDirectory()) inventory(file)
      else if (!expected.has(relative)) throw Error('Unexpected snapshot file: ' + relative)
    }
  }
  inventory(base)
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(safePath(base, file.path))
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256)
      throw Error('Snapshot checksum mismatch: ' + file.path)
  }
  return {
    files: manifest.files.length,
    head: manifest.head,
    manifest_sha256: hash(fs.readFileSync(path.join(base, 'MANIFEST.json'))),
  }
}
function create(directory) {
  const target = path.resolve(directory)
  if (fs.existsSync(target)) throw Error('Snapshot destination must be new')
  if (target === root || target.startsWith(root + path.sep))
    throw Error('Snapshot must be outside working tree')
  const checkpoint = JSON.parse(
    execFileSync(process.execPath, [path.join(__dirname, 'prepare-source-checkpoint.cjs')], {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024,
    }),
  )
  if (checkpoint.blockers.length) throw Error('Checkpoint has unresolved exclusions')
  const headPaths = split(git('ls-tree', '-r', '--name-only', '-z', 'HEAD'))
  const baseline = headPaths.filter(
    (p) =>
      (/^(?:services\/ai\/|packages\/contracts\/)/.test(p) &&
        !p.startsWith('services/ai/evidence/')) ||
      ['packages/README.md', 'services/README.md', 'render.yaml'].includes(p),
  )
  const included = [...new Set([...checkpoint.included, ...baseline])].sort(),
    files = [],
    excluded = checkpoint.excluded.filter((p) => !baseline.includes(p.path))
  // Review unchanged legacy code without silently including generated evidence or
  // a different/private PDF substituted after HEAD. Scan both index and worktree.
  function scan(relative, bytes) {
    if (checkpoint.included.includes(relative) || checkpoint.deleted.includes(relative))
      return inspect(relative, bytes)
    if (!baseline.includes(relative)) return 'outside snapshot source scope'
    if (relative.endsWith('.pdf'))
      return hash(bytes) === hash(git('show', 'HEAD:' + relative)) ? null : 'changed legacy PDF'
    return inspect(
      'scripts/' +
        (['VERSION', 'SHA256SUMS'].includes(path.basename(relative))
          ? path.basename(relative)
          : 'snapshot-baseline' + path.extname(relative)),
      bytes,
    )
  }
  for (const relative of included) {
    const bytes = fs.readFileSync(safePath(root, relative)),
      problem = scan(relative, bytes)
    if (problem) throw Error('Snapshot scan blocked: ' + relative + ' (' + problem + ')')
  }
  const indexEntries = split(git('ls-files', '--stage', '-z'))
    .map((line) => {
      const [meta, p] = line.split('\t'),
        [mode, oid, stage] = meta.split(' ')
      return { path: p, mode, oid, stage: Number(stage) }
    })
    .filter((e) => included.includes(e.path) || checkpoint.deleted.includes(e.path))
  const indexed = indexEntries.map((e) => {
    if (e.stage !== 0) throw Error('Resolve index conflicts before snapshot')
    const bytes = git('show', ':' + e.path),
      problem = scan(e.path, bytes)
    if (problem) throw Error('Index scan blocked: ' + e.path)
    return { ...e, bytes }
  })
  fs.mkdirSync(target, { recursive: false })
  function copy(relative, bytes) {
    const file = safePath(target, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bytes, { flag: 'wx' })
    files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) })
  }
  for (const p of included) copy('source/' + p, fs.readFileSync(safePath(root, p)))
  for (const e of indexed) copy('index/' + e.path, e.bytes)
  const status = git('status', '--porcelain=v1', '-z').toString('utf8').split('\0').filter(Boolean)
  copy(
    'GIT-STATE.json',
    Buffer.from(
      JSON.stringify(
        {
          head: checkpoint.head,
          branch: checkpoint.branch,
          status,
          index_entries: indexed.map(({ bytes, ...e }) => e),
          deleted: checkpoint.deleted,
          excluded,
          index_preserved: true,
          commit_created: false,
        },
        null,
        2,
      ) + '\n',
    ),
  )
  copy(
    'README.md',
    Buffer.from(
      '# Fixed source review snapshot\n\nReview `source/` as the current application. It includes unstaged and untracked reviewed source. `index/` preserves the prior staged bytes separately; do not overwrite source with it. `GIT-STATE.json` records HEAD and index/working state. No .git, credentials, dependencies, runtime cache/data, private PDFs or generated AI evidence is copied. Canonical synthetic fixtures and application assets are included. Install from lockfile and use docs/implementation/MVP-REVIEW-HANDOFF.md inside source. No commit/push/reset/deploy was performed. Verify with `node source/scripts/create-review-snapshot.cjs --verify <this-directory>`; the manifest hash is recorded outside this folder in the delivery message.\n',
    ),
  )
  fs.writeFileSync(
    path.join(target, 'MANIFEST.json'),
    JSON.stringify(
      {
        format: 1,
        created_at: new Date().toISOString(),
        head: checkpoint.head,
        branch: checkpoint.branch,
        source_count: included.length,
        index_count: indexed.length,
        files,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  )
  return {
    directory: target,
    ...verify(target),
    source_count: included.length,
    index_count: indexed.length,
    excluded_count: excluded.length,
  }
}
module.exports = { safePath, verify, create }
if (require.main === module) {
  try {
    const [mode, directory] = process.argv.slice(2)
    if (!['--output', '--verify'].includes(mode) || !directory || process.argv.length !== 4)
      throw Error('Use --output NEW_ABSOLUTE_DIRECTORY or --verify DIRECTORY')
    console.log(
      JSON.stringify(mode === '--output' ? create(directory) : verify(directory), null, 2),
    )
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}
