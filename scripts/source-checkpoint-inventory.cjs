// Read-only Git inventory. A manifest is NOT a source backup or a Git checkpoint.
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const split = (value) => value.split('\0').filter(Boolean)
const tracked = new Set(split(git('ls-files', '-z')))
const candidates = [
  ...new Set(split(git('ls-files', '-z', '--cached', '--others', '--exclude-standard'))),
].sort()
const technical =
  /\.(?:ts|tsx|js|jsx|cjs|mjs|py|sql|css|scss|html|svg|md|json|jsonl|sha256|yaml|yml|toml|txt|lock|http|sh|ps1)$/i
const denied =
  /(^|\/)(?:node_modules|\.git|\.venv|venv|\.next|dist|build|storage|uploads|data|private|holdout|real|attachments|files|\.reports|coverage|__pycache__)(\/|$)/i
const special = new Set([
  '.gitignore',
  '.gitattributes',
  '.prettierignore',
  'VERSION',
  'SHA256SUMS',
  'Dockerfile',
])
const files = []
const excluded = []
for (const relative of candidates) {
  if (relative === 'docs/implementation/phase-2-source-inventory.json') continue
  const base = path.posix.basename(relative)
  const storageSource = /^apps\/api\/src\/storage\/[^/]+\.ts$/.test(relative)
  if (
    (denied.test(relative) && !storageSource) ||
    (/^\.env/.test(base) && base !== '.env.example') ||
    (!technical.test(base) && !special.has(base) && base !== '.env.example')
  ) {
    excluded.push(relative)
    continue
  }
  const absolute = path.resolve(root, relative)
  if (!absolute.startsWith(root + path.sep)) throw new Error('Path outside workspace')
  if (!fs.existsSync(absolute)) {
    excluded.push(relative)
    continue
  }
  let cursor = root
  let linked = false
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part)
    if (fs.lstatSync(cursor).isSymbolicLink()) {
      linked = true
      break
    }
  }
  if (linked) {
    excluded.push(relative)
    continue
  }
  const stat = fs.lstatSync(absolute)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    excluded.push(relative)
    continue
  }
  const bytes = fs.readFileSync(absolute)
  files.push({
    path: relative,
    git: tracked.has(relative) ? 'tracked' : 'untracked',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
}
process.stdout.write(
  JSON.stringify(
    {
      purpose: 'Read-only source inventory; contains hashes, not file contents. NOT a backup.',
      head: git('rev-parse', 'HEAD').trim(),
      branch: git('branch', '--show-current').trim(),
      staged_paths: split(git('diff', '--cached', '--name-only', '-z')),
      count: files.length,
      untracked_count: files.filter((file) => file.git === 'untracked').length,
      files,
      excluded_paths: excluded,
    },
    null,
    2,
  ) + '\n',
)
