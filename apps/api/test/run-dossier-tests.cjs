// Fresh loopback PostgreSQL only; no inherited database/provider credentials.
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { launcherEnv } = require('./acceptance-security/run-security-tests.cjs')
const project = path.resolve(__dirname, '../../..')

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') {
    process.stderr.write('Run pnpm api:build, then node apps/api/test/run-dossier-tests.cjs --run\n')
    return 2
  }
  for (const file of ['documents/dossiers.controller.js', 'documents/dossier.repository.js', 'documents/dossier-worker.js'])
    if (!fs.existsSync(path.join(project, 'apps/api/dist', file))) throw Error('Build prerequisite missing')
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 15432 })
    socket.setTimeout(1500)
    socket.once('connect', () => { socket.destroy(); reject(Error('Test port15432 occupied; leave the existing cluster untouched')) })
    socket.once('timeout', () => { socket.destroy(); reject(Error('Cannot verify test port availability')) })
    socket.once('error', (error) => error.code === 'ECONNREFUSED' ? resolve() : reject(Error('Cannot verify test port availability')))
  })
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(project, 'scripts/test-local-postgres.cjs'), '--test-concurrency=1',
      path.join(__dirname, 'dossier-repository.cjs'), path.join(__dirname, 'dossier-http.integration.cjs')], {
      cwd: project, windowsHide: true, stdio: 'inherit', env: launcherEnv(process.env),
    })
    child.once('error', () => reject(Error('Unable to start private test launcher')))
    child.once('exit', (code) => resolve(code === 0 ? 0 : 1))
  })
}
if (require.main === module) main().then((code) => { process.exitCode = code }, (error) => {
  process.stderr.write(error.message + '\n'); process.exitCode = 1
})
