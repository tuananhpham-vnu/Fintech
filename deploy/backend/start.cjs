// Backend container supervisor (Render). Starts, in order:
//   1. Python AI service on 127.0.0.1:8100 (never public), waits for /healthz
//   2. NestJS API on 0.0.0.0:$PORT (Render's public port)
//   3. document + dossier + financial-intake workers in one Node process
// If any process exits, the others are stopped and the container exits non-zero so Render restarts it.
// No secrets are logged; configuration errors come from each process's own fixed diagnostics.
'use strict'
const { spawn } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const AI_PORT = Number(process.env.AIC_AI_PORT || 8100)   // internal loopback port; override only for local testing
const required = ['DATABASE_URL', 'INTERNAL_API_KEY', 'AIC_STORAGE_DIR', 'AIC_FRONTEND_ORIGIN', 'PORT']
const missing = required.filter((name) => !process.env[name])
if (missing.length) {
  process.stderr.write(`Backend start refused: missing environment variables ${missing.join(', ')}\n`)
  process.exit(1)
}
const tlsProblem = require('./db-url.cjs').databaseUrlProblem('DATABASE_URL', process.env.DATABASE_URL)
if (tlsProblem) {
  process.stderr.write(`Backend start refused: ${tlsProblem}\n`)
  process.exit(1)
}

const shared = {
  ...process.env,
  // The AI service and the API must use the same private directory and the same internal key.
  AI_STORAGE_DIR: process.env.AIC_STORAGE_DIR,
  AIC_AI_SERVICE_URL: `http://127.0.0.1:${AI_PORT}`,
}
const children = new Map()
let stopping = false

function start(name, command, args, cwd, env = shared) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] })
  children.set(name, child)
  child.on('exit', (code, signal) => {
    children.delete(name)
    if (stopping) return
    process.stderr.write(`[supervisor] ${name} exited (code ${code}, signal ${signal}); stopping backend\n`)
    shutdown(1)
  })
  return child
}

function shutdown(code) {
  if (stopping) return
  stopping = true
  for (const child of children.values()) child.kill('SIGTERM')
  const deadline = setTimeout(() => {
    for (const child of children.values()) child.kill('SIGKILL')
    process.exit(code)
  }, 20_000)
  const check = setInterval(() => {
    if (children.size === 0) {
      clearInterval(check)
      clearTimeout(deadline)
      process.exit(code)
    }
  }, 200)
}

function healthy(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => req.destroy())
  })
}

async function main() {
  process.on('SIGTERM', () => shutdown(0))
  process.on('SIGINT', () => shutdown(0))

  start('ai', process.env.AIC_PYTHON || 'python3', ['-m', 'runner', 'serve', '--host', '127.0.0.1', '--port', String(AI_PORT)],
        path.join(ROOT, 'services/ai'))
  for (let i = 0; i < 90 && !stopping; i += 1) {
    if (await healthy(`http://127.0.0.1:${AI_PORT}/healthz`)) break
    if (i === 89) {
      process.stderr.write('[supervisor] AI service did not become healthy in 90s\n')
      return shutdown(1)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  if (stopping) return
  process.stdout.write('[supervisor] AI service healthy on loopback\n')

  const api = path.join(ROOT, 'apps/api')
  start('api', process.execPath, ['dist/main.js'], api, { ...shared, AIC_LISTEN_HOST: process.env.AIC_LISTEN_HOST || '0.0.0.0' })
  start('workers', process.execPath, ['dist/run-workers.js', '--poll'], api)
}

main().catch(() => {
  process.stderr.write('[supervisor] unexpected start failure\n')
  shutdown(1)
})
