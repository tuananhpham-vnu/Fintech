const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')

// Load root .env if present
const envFile = path.join(ROOT, '.env')
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) process.env[key] = val
    }
  }
}

const PYTHON_EXEC =
  process.platform === 'win32'
    ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
    : path.join(ROOT, '.venv', 'bin', 'python')

const STORAGE_DIR = process.env.AIC_STORAGE_DIR || 'C:/private/aic-mvp-cache'
const INTERNAL_KEY = process.env.INTERNAL_API_KEY
const DB_URL = process.env.DATABASE_URL
if (!INTERNAL_KEY || !DB_URL) {
  console.error('AIC startup requires explicit DATABASE_URL and INTERNAL_API_KEY; no services were started.')
  process.exit(1)
}

// ANSI colors for clean log separation
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  ai: '\x1b[33m', // Yellow
  api: '\x1b[36m', // Cyan
  worker: '\x1b[35m', // Magenta
  web: '\x1b[32m', // Green
  red: '\x1b[31m',
  gray: '\x1b[90m',
}

function pipeOutput(proc, name, color) {
  const handleChunk = (chunk) => {
    const text = chunk.toString()
    const lines = text.split(/\r?\n/)
    for (const line of lines) {
      if (line.trim().length > 0) {
        console.log(`${color}${colors.bold}[${name}]${colors.reset} ${line}`)
      }
    }
  }
  proc.stdout?.on('data', handleChunk)
  proc.stderr?.on('data', handleChunk)
}

const processes = []

function cleanup() {
  console.log(`\n${colors.red}${colors.bold}Stopping all services...${colors.reset}`)
  for (const p of processes) {
    try {
      if (process.platform === 'win32' && p.pid) {
        spawn('taskkill', ['/pid', p.pid.toString(), '/f', '/t'], { stdio: 'ignore' })
      } else if (p.kill) {
        p.kill('SIGTERM')
      }
    } catch {}
  }
}

process.on('SIGINT', () => {
  cleanup()
  process.exit(0)
})

process.on('SIGTERM', () => {
  cleanup()
  process.exit(0)
})

console.log(`${colors.bold}====================================================${colors.reset}`)
console.log(`${colors.bold}Starting AIC Services concurrently...${colors.reset}`)
console.log(`- ${colors.web}[WEB]${colors.reset}    Next.js   : http://127.0.0.1:3000`)
console.log(`- ${colors.api}[API]${colors.reset}    NestJS    : http://127.0.0.1:3001`)
console.log(`- ${colors.ai}[AI]${colors.reset}     FastAPI   : http://127.0.0.1:8100`)
console.log(`- ${colors.worker}[WORKER]${colors.reset} Doc Worker: Polling jobs`)
console.log(`${colors.gray}Press Ctrl+C to terminate all services.${colors.reset}`)
console.log(`${colors.bold}====================================================\n${colors.reset}`)

// 1. AI Service (Python FastAPI)
if (fs.existsSync(PYTHON_EXEC)) {
  const aiProc = spawn(PYTHON_EXEC, ['-m', 'runner', 'serve', '--port', '8100'], {
    cwd: path.join(ROOT, 'services', 'ai'),
    env: {
      ...process.env,
      INTERNAL_API_KEY: INTERNAL_KEY,
      AI_STORAGE_DIR: STORAGE_DIR,
      AI_MODE: process.env.AI_MODE || 'live',
    },
  })
  pipeOutput(aiProc, 'AI', colors.ai)
  processes.push(aiProc)
} else {
  console.log(`${colors.red}[AI] Python virtual environment not found at ${PYTHON_EXEC}${colors.reset}`)
}

// 2. Backend API (NestJS)
const apiDist = path.join(ROOT, 'apps', 'api', 'dist', 'main.js')
if (fs.existsSync(apiDist)) {
  const apiProc = spawn(process.execPath, [apiDist], {
    cwd: path.join(ROOT, 'apps', 'api'),
    env: {
      ...process.env,
      PORT: '3001',
      NODE_ENV: 'development',
      AIC_RUNTIME_MODE: 'foundation',
      AIC_DOCUMENT_RUNTIME: 'local',
      AIC_DOCUMENT_AI_MODE: 'live',
      AIC_STORAGE_DIR: STORAGE_DIR,
      INTERNAL_API_KEY: INTERNAL_KEY,
      AIC_AI_SERVICE_URL: 'http://127.0.0.1:8100',
      AIC_FRONTEND_ORIGIN: 'http://127.0.0.1:3000',
      AIC_IDEMPOTENCY_TTL_MS: '86400000',
      DATABASE_URL: DB_URL,
    },
  })
  pipeOutput(apiProc, 'API', colors.api)
  processes.push(apiProc)
} else {
  console.log(`${colors.red}[API] Dist not found at ${apiDist}. Run 'pnpm api:build' first.${colors.reset}`)
}

// 3. Document Worker
const workerDist = path.join(ROOT, 'apps', 'api', 'dist', 'documents', 'run-worker.js')
if (fs.existsSync(workerDist)) {
  const workerProc = spawn(process.execPath, [workerDist, '--poll'], {
    cwd: path.join(ROOT, 'apps', 'api'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      AIC_RUNTIME_MODE: 'foundation',
      AIC_DOCUMENT_RUNTIME: 'local',
      AIC_DOCUMENT_AI_MODE: 'live',
      AIC_STORAGE_DIR: STORAGE_DIR,
      INTERNAL_API_KEY: INTERNAL_KEY,
      AIC_AI_SERVICE_URL: 'http://127.0.0.1:8100',
      DATABASE_URL: DB_URL,
    },
  })
  pipeOutput(workerProc, 'WORKER', colors.worker)
  processes.push(workerProc)
}

// 4. Frontend Web (Next.js)
const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const webProc = spawn(pnpmCmd, ['dev', '--hostname', '127.0.0.1', '--port', '3000'], {
  cwd: ROOT,
  shell: true,
  env: {
    ...process.env,
    AIC_BACKEND_URL: 'http://127.0.0.1:3001/api/v2',
  },
})
pipeOutput(webProc, 'WEB', colors.web)
processes.push(webProc)
