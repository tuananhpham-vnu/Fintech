// Explicit allowlist preparation. Default is read-only; --stage changes only index.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const split = (value) => value.split('\0').filter(Boolean)
const roots = [
  'apps/api/',
  'apps/web/',
  'packages/contracts/aic-foundation/',
  'scripts/',
  'docs/integration/',
  'docs/audits/',
  'docs/implementation/',
  'docs/acceptance/',
  'docs/api-collection/',
  'tests/fixtures/synthetic/',
]
const exact = new Set([
  '.gitignore',
  '.gitattributes',
  'README.md',
  'apps/README.md',
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'start-dev.ps1',
  'services/ai/runner/provider_diagnostics.py',
  'services/ai/tests/test_provider_diagnostics.py',
  'services/ai/tests/test_post_acceptance_grounding.py',
])
const textTypes =
  /\.(?:ts|tsx|js|jsx|cjs|mjs|py|sql|css|scss|html|svg|md|json|sha256|yaml|yml|toml|txt|http|sh|ps1)$/i
const assetTypes = /^apps\/web\/(?:public|src)\/.*\.(?:png|ico|webp|woff2?)$/i
const denied =
  /(^|\/)(?:node_modules|\.git|\.venv|\.next|dist|build|storage|uploads|data|private|holdout|real|attachments|\.reports|coverage|__pycache__)(\/|$)/i
// Reviewed synthetic PDFs, hash-bound so a replaced real PDF is not silently staged.
const syntheticPdfs = {
  'apps/web/tests/fixtures/pdf/acceptance-wrong.pdf':
    'ce1aacb7b24b236e7175b1d9f5e4f8aa7551fc06af6ca9b3e7ed27289348de76',
  'apps/web/tests/fixtures/pdf/acceptance.pdf':
    '536bf72523b92507cf33e5d8c4fb197b6974ffaf44eda177383ffe3d00982460',
  'apps/web/tests/fixtures/pdf/contract.pdf':
    '27c029e9f9ed6d0d0e97c4629bbedd993ac56d8132d0af865dea018c0c75a768',
  'apps/web/tests/fixtures/pdf/financials.pdf':
    'f2509934a0762486e2c6107eb9cc4292c4335c2a0b0d330daf60ed1a47c3e8bc',
  'apps/web/tests/fixtures/pdf/loan_request.pdf':
    'ea93df364cab193346a8817b3133eac833911f8980c25282dbf7723044e4b830',
  'apps/web/tests/fixtures/pdf/registration-0000000001.pdf':
    '4cb30d46b1914d26ec752d4207eef17f5ad522559c116daf705eb6de410b0ab1',
  'apps/web/tests/fixtures/pdf/registration-0000000002.pdf':
    '27a6676ff7ac2572d1fe4c716d6e41dce5bf2c701d309789992c48296418d56b',
  'apps/web/tests/fixtures/pdf/registration-DEMO-0001.pdf':
    '384ed5e005d4a7eb39c13f90ee7b970e01ee4937915bad58e213edf150cbff4b',
  'apps/web/tests/fixtures/pdf/registration.pdf':
    '195f09875c5593ede6ba62b3eff71d480f27d83cdff9c348bdd93f8bd3771f29',
  'tests/fixtures/synthetic/valid_synthetic.pdf':
    '2026c65f6784cac9b64b67e688c3c051cdde38d799edc633b61a5b3189f79e52',
  'tests/fixtures/synthetic/corrupted.pdf':
    '33af5048d9adde78542a8948cf7f24476dc6371e9efa91e0f254334e509200cb',
}

function inspect(relative, bytes) {
  const base = path.posix.basename(relative)
  if (!exact.has(relative) && !roots.some((prefix) => relative.startsWith(prefix)))
    return 'outside scope'
  const storageSource = /^apps\/api\/src\/storage\/[^/]+\.ts$/.test(relative)
  if (
    (denied.test(relative) && !storageSource) ||
    (/^\.env/.test(base) && base !== '.env.example') ||
    /\.(?:pem|key|p12|pfx|log|zip)$/i.test(base)
  )
    return 'private/runtime/archive'
  if (relative.endsWith('.pdf'))
    return syntheticPdfs[relative] === createHash('sha256').update(bytes).digest('hex')
      ? null
      : 'unreviewed PDF'
  if (
    !textTypes.test(base) &&
    !assetTypes.test(relative) &&
    ![
      '.gitignore',
      '.gitattributes',
      '.prettierignore',
      '.env.example',
      'VERSION',
      'SHA256SUMS',
    ].includes(base)
  )
    return 'unsupported file'
  if (assetTypes.test(relative)) return null
  const text = bytes.toString('utf8')
  // Findings contain only the path/rule, never matching secret values or lines.
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) return 'BLOCK: private key'
  if (
    /\bAIza[\w-]{35}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/.test(
      text,
    )
  )
    return 'BLOCK: provider token'
  for (const match of text.matchAll(
    /(?:postgres(?:ql)?|https?):\/\/[^\s/:@]+:([^\s/@]+)@[^\s/?#'"<>]+/g,
  )) {
    if (
      relative === 'apps/web/tests/integration/api-contracts.cjs' &&
      match[0] === ['https://u', 'p@test'].join(':')
    )
      continue
    if (!/^(?:CHANGE_ME|PASSWORD|password|REDACTED|example|test|\$\{[^}]+\})$/.test(match[1]))
      return 'BLOCK: credential-bearing URL'
  }
  return null
}

function main(args = process.argv.slice(2)) {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--stage'))
    throw new Error('Use no arguments or --stage')
  if (git('branch', '--show-current').trim() !== 'duc') throw new Error('Expected branch duc')
  const candidates = [
    ...new Set(split(git('ls-files', '-z', '--cached', '--others', '--exclude-standard'))),
  ].sort()
  const included = [],
    excluded = [],
    deleted = [],
    blockers = []
  for (const relative of candidates) {
    const absolute = path.resolve(root, relative)
    if (!absolute.startsWith(root + path.sep)) throw new Error('Path outside workspace')
    if (!fs.existsSync(absolute)) {
      if (inspect(relative, Buffer.alloc(0)) === null) deleted.push(relative)
      else
        blockers.push({ path: relative, reason: 'BLOCK: deletion outside reviewed source scope' })
      continue
    }
    let cursor = root,
      linked = false
    for (const component of relative.split('/')) {
      cursor = path.join(cursor, component)
      if (fs.lstatSync(cursor).isSymbolicLink()) {
        linked = true
        break
      }
    }
    if (linked) {
      excluded.push({ path: relative, reason: 'symlink' })
      continue
    }
    const stat = fs.lstatSync(absolute)
    if (!stat.isFile()) continue
    const bytes = fs.readFileSync(absolute)
    const reason = inspect(relative, bytes)
    if (reason) {
      ;(reason.startsWith('BLOCK:') ? blockers : excluded).push({ path: relative, reason })
    } else included.push(relative)
  }
  const existingStaged = split(git('diff', '--cached', '--name-only', '-z'))
  for (const relative of existingStaged)
    if (!included.includes(relative) && !deleted.includes(relative))
      blockers.push({
        path: relative,
        reason: 'BLOCK: existing staged path outside verified allowlist',
      })
  if (args[0] === '--stage' && blockers.length === 0) {
    execFileSync('git', ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      cwd: root,
      input: [...included, ...deleted].join('\0') + '\0',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }
  const report = {
    branch: 'duc',
    head: git('rev-parse', 'HEAD').trim(),
    mode: args[0] === '--stage' ? 'stage' : 'read-only',
    staged: args[0] === '--stage' && blockers.length === 0,
    included_count: included.length,
    included,
    deleted,
    excluded,
    blockers,
    limitation:
      'Local pattern scan + reviewed paths/PDF hashes; not a comprehensive secret scanner or a commit/backup.',
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  return blockers.length ? 1 : 0
}
module.exports = { inspect, main }
if (require.main === module) {
  try {
    process.exitCode = main()
  } catch {
    process.stderr.write(
      'Checkpoint preparation failed; no commit/push performed. Check paths and Git state.\n',
    )
    process.exitCode = 2
  }
}
