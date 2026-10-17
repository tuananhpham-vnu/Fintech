const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { project } = require('./harness.cjs')

function launcherEnv(source) {
  // Allow only OS/runtime essentials. Do not pass user DB URLs, provider keys,
  // PG* defaults, NODE_OPTIONS/env-file flags, or bootstrap credentials to tests.
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE|OS|USERNAME|USERDOMAIN|AIC_POSTGRES_BIN)$/i
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.test(key)))
}

async function portFree() {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 15432 })
    socket.setTimeout(1500)
    socket.once('connect', () => { socket.destroy(); reject(Error('Port 15432 occupied; wait for the lead to release its cluster')) })
    socket.once('timeout', () => { socket.destroy(); reject(Error('Cannot verify port 15432 availability')) })
    socket.once('error', (error) => error.code === 'ECONNREFUSED' ? resolve() : reject(Error('Cannot verify port 15432 availability')))
  })
}

async function main(args) {
  if (args.length !== 1 || args[0] !== '--run') {
    process.stderr.write('Explicit opt-in required: node apps/api/test/acceptance-security/run-security-tests.cjs --run\n')
    return 2
  }
  for (const file of ['foundation/mvp-capability.service.js', 'documents/document-worker.js', 'database/migrate.js'])
    if (!fs.existsSync(path.join(project, 'apps/api/dist', file))) throw Error('Build prerequisite missing; run pnpm api:build first')
  await portFree()
  // The existing launcher is the sole cluster owner. It creates fresh random
  // SCRAM credentials and pg_ctl stops only its own -D data directory in finally.
  // Do not impose a timeout that kills the launcher and bypasses that finally.
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(project, 'scripts/test-local-postgres.cjs'),
      '--test-concurrency=1', path.join(__dirname, 'concurrency-capability.stress.cjs'),
      path.join(__dirname, 'crash-recovery-worker.stress.cjs')], {
      cwd: project, env: launcherEnv(process.env), windowsHide: true, stdio: 'inherit',
    })
    child.once('error', () => reject(Error('Isolated launcher could not start')))
    child.once('exit', (status) => resolve(status === 0 ? 0 : 1))
  })
}

if (require.main === module) main(process.argv.slice(2)).then(
  (status) => { process.exitCode = status },
  () => { process.stderr.write('Security runner failed; no database URL or credential details are logged.\n'); process.exitCode = 1 },
)
module.exports = { main, launcherEnv }
