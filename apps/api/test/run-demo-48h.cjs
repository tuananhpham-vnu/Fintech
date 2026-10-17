// Reproducible local regression runner. Uses only a fresh, private PostgreSQL
// cluster; drops inherited DB/provider settings and never reads .env.
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { launcherEnv } = require('./acceptance-security/run-security-tests.cjs')
const project = path.resolve(__dirname, '../../..')

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') {
    process.stderr.write('Usage: pnpm api:build, then node apps/api/test/run-demo-48h.cjs --run\n')
    return 2
  }
  for (const file of ['documents/document-archives.controller.js', 'documents/extraction-summary.js', 'database/migrate.js'])
    if (!fs.existsSync(path.join(project, 'apps/api/dist', file))) throw Error('Run pnpm api:build first')
  await new Promise((resolve, reject) => {
    const probe = net.createConnection({ host: '127.0.0.1', port: 15432 })
    probe.setTimeout(1500)
    probe.once('connect', () => { probe.destroy(); reject(Error('Port 15432 is occupied; leave the existing cluster untouched')) })
    probe.once('timeout', () => { probe.destroy(); reject(Error('Cannot verify test port availability')) })
    probe.once('error', (error) => error.code === 'ECONNREFUSED' ? resolve() : reject(Error('Cannot verify test port availability')))
  })
  const tests = ['document-archive.integration.cjs', 'document-http.integration.cjs', 'documents-repository.cjs',
    'document-retry.integration.cjs', 'mvp-case.integration.cjs', 'mvp-workflow.integration.cjs',
    'foundation.integration.cjs', 'mvp-counterparty.integration.cjs', 'policy-exposure-migration.cjs',
    'sandbox-bootstrap.integration.cjs', 'fhi-scorer.cjs']
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(project, 'scripts/test-local-postgres.cjs'),
      '--test-concurrency=1', ...tests.map((file) => path.join(__dirname, file))], {
      cwd: project, windowsHide: true, stdio: 'inherit', env: launcherEnv(process.env),
    })
    child.once('error', () => reject(Error('Could not start isolated regression launcher')))
    // No wrapper timeout/kill: let the cluster owner's finally stop its own DB.
    child.once('exit', (code) => resolve(code === 0 ? 0 : 1))
  })
}

main().then((code) => { process.exitCode = code }, (error) => {
  process.stderr.write(error.message + '\n')
  process.exitCode = 1
})
