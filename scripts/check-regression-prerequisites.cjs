'use strict'

// Read files and make three fixed, unauthenticated loopback GETs only.
// Never import application code: imports can start services or mutate storage/DBs.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { createHash } = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const MAX_FILE = 16 * 1024 * 1024
const ENDPOINTS = Object.freeze([
  { port: 3000, path: '/api/v2/auth/me' },
  { port: 3001, path: '/api/v2/auth/me' },
  { port: 8100, path: '/healthz' },
])

function readLocal(relative, limit = MAX_FILE) {
  const target = path.resolve(ROOT, relative)
  const rel = path.relative(ROOT, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Unsafe path')
  // Reject links/junctions before following them, including links to network shares.
  let current = ROOT
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part)
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked path')
  }
  const stat = fs.statSync(target)
  if (!stat.isFile() || stat.size > limit) throw new Error('Unsupported file')
  return fs.readFileSync(target)
}

function json(relative) {
  return JSON.parse(readLocal(relative).toString('utf8'))
}

function probeEndpoint(index) {
  if (!Number.isInteger(index) || index < 0 || index >= ENDPOINTS.length)
    return Promise.reject(new Error('Endpoint not allowed'))
  const endpoint = ENDPOINTS[index]
  return new Promise((resolve) => {
    let connected = false
    let settled = false
    let timer
    const finish = (observation) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ port: endpoint.port, listener: connected, ...observation })
    }
    const request = http.request({
      hostname: '127.0.0.1', port: endpoint.port, path: endpoint.path,
      method: 'GET', agent: false,
      headers: { accept: 'application/json', connection: 'close' },
      maxHeaderSize: 16384,
    }, (response) => {
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > 16384) {
          finish({ state: 'response-too-large', status: response.statusCode })
          response.destroy()
        } else chunks.push(chunk)
      })
      response.on('end', () => {
        let body = null
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {}
        // No response text, cookies, headers, exception strings or arbitrary codes escape.
        finish({
          state: 'http', status: response.statusCode,
          protected: response.statusCode === 401 || response.statusCode === 403,
          proxyUnconfigured: response.statusCode === 503 && body?.code === 'BACKEND_NOT_CONFIGURED',
          mockHealth: response.statusCode === 200 && body?.status === 'ok' &&
            body?.schema_version === '1.0.2' && body?.mode === 'mock',
        })
      })
      response.on('error', () => finish({ state: 'incomplete-response' }))
      response.on('aborted', () => finish({ state: 'incomplete-response' }))
    })
    request.on('socket', (socket) => socket.once('connect', () => { connected = true }))
    request.on('error', (error) => finish({
      state: error.code === 'ECONNREFUSED' ? 'connection-refused' : 'connection-error',
    }))
    timer = setTimeout(() => {
      finish({ state: 'timeout' })
      request.destroy()
    }, 2500)
    request.end()
  })
}

function parseFeasibilityOutput(contents) {
  const parts = contents.replace(/\r\n/g, '\n').split('SUMMARY OF RESULTS:')
  if (parts.length !== 2) return { ok: false, reason: 'Expected exactly one summary' }
  function entries(section) {
    const lines = section.split('\n').filter((line) => /^\[/.test(line))
    const results = new Map()
    for (const line of lines) {
      const match = /^\[(PASS|FAIL|BLOCKED)\] (\d+)\. (.+)$/.exec(line)
      if (!match) return null
      const id = Number(match[2])
      if (id < 1 || id > 25 || results.has(id)) return null
      results.set(id, { status: match[1], name: match[3] })
    }
    return results.size === 25 ? results : null
  }
  const initial = entries(parts[0]), summary = entries(parts[1])
  if (!initial || !summary) return { ok: false, reason: 'Require 25 unique IDs 1-25 in run and summary' }
  const failed = []
  for (let id = 1; id <= 25; id++) {
    const a = initial.get(id), b = summary.get(id)
    if (a.status !== b.status || a.name !== b.name)
      return { ok: false, reason: 'Run and summary disagree' }
    if (b.status !== 'PASS') failed.push(id)
  }
  const markers = contents.split(/\r?\n/).filter((line) => line.startsWith('RUNNER RESULT:'))
  if (markers.length !== 1 || markers[0] !==
    'RUNNER RESULT: PASS; PASS=25 FAIL=0 BLOCKED=0; complete=true; exit=0')
    return { ok: false, reason: 'Current runner must confirm complete PASS with exit0' }
  return { ok: failed.length === 0, unique: 25, failed }
}

async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/check-regression-prerequisites.cjs [--mode prototype|foundation] [--offline]')
    console.log('       node scripts/check-regression-prerequisites.cjs --results repo-relative-log-path')
    console.log('Preflight: 1 = unresolved; 2 = usage/internal error. Results parser: 0 = 25 unique PASS, 1 = invalid/failing log.')
    return 0
  }
  if (args[0] === '--results' && args.length === 2) {
    let result
    try { result = parseFeasibilityOutput(readLocal(args[1], 1024 * 1024).toString('utf8')) }
    catch { result = { ok: false, reason: 'Log unavailable, linked, oversized or outside repository' } }
    console.log(JSON.stringify({ kind: 'log-validation-only', ...result }))
    return result.ok ? 0 : 1
  }
  let mode = 'prototype', offline = false, seenMode = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--offline' && !offline) offline = true
    else if (args[index] === '--mode' && !seenMode && ['prototype', 'foundation'].includes(args[index + 1])) {
      mode = args[++index]
      seenMode = true
    } else {
      console.log('[ERROR] Invalid arguments; use --help. Argument values are suppressed.')
      return 2
    }
  }

  const checks = []
  const record = (ok, label) => checks.push({ status: ok ? 'OK' : 'UNRESOLVED', label })
  const pending = (label) => record(false, label)
  const attempt = (label, check) => {
    try { record(Boolean(check()), label) } catch { record(false, label) }
  }
  const env = process.env
  record(Number(process.versions.node.split('.')[0]) >= 22, 'Node >=22')
  record(path.resolve(process.cwd()) === ROOT, 'Run from repository root (unchanged test uses cwd)')

  const artifacts = [
    'scripts/test-e2e-feasibility.cjs', 'apps/api/dist/main.js',
    'apps/api/dist/config/configuration.js', 'apps/api/dist/app.module.js',
    'services/ai/runner/app.py', 'services/ai/runner/backends.py',
  ]
  if (mode === 'prototype') artifacts.push(
    'apps/api/dist/prototype/prototype.module.js',
    'apps/api/dist/ai-client/ai-client.service.js',
  )
  else artifacts.push(
    'apps/api/dist/database/migrate.js', 'apps/api/dist/auth/auth.helpers.test.js',
    'apps/api/test/foundation.integration.cjs',
    'apps/api/migrations/0001_foundation.sql',
    'apps/api/migrations/0002_creator_membership_policy_immutability.sql',
    'apps/api/migrations/0003_authorization_row_locks.sql',
  )
  for (const file of artifacts) attempt(`Artifact present: ${file}`, () => readLocal(file).length > 0)

  // Compare exact bytes, matching the AI runner's checksum contract. Never repair drift.
  for (const directory of ['packages/contracts', 'packages/contracts/fixtures', 'packages/contracts/aic-foundation']) {
    attempt(`Checksum list and listed files: ${directory}`, () => {
      const lines = readLocal(`${directory}/SHA256SUMS`).toString('utf8').trim().split(/\r?\n/)
      return lines.length > 0 && lines.every((line) => {
        const match = /^([a-f0-9]{64})\s+([A-Za-z0-9_.-]+)$/.exec(line)
        return match && createHash('sha256').update(readLocal(`${directory}/${match[2]}`)).digest('hex') === match[1]
      })
    })
  }
  attempt('Legacy contract VERSION is 1.0.2', () => readLocal('packages/contracts/VERSION').toString('utf8').trim() === '1.0.2')
  attempt('Synthetic contract PDF, manifest and gold identity/hash agree', () => {
    const manifest = json('packages/contracts/fixtures/manifest.json')
    const entry = manifest.files.find((file) => file.filename === '04_contract.pdf')
    const bytes = readLocal('packages/contracts/fixtures/04_contract.pdf')
    return manifest.schema_version === '1.0.2' && entry?.source_class === 'synthetic' &&
      entry.document_id === 'bdd9ea62-ce2f-5e12-b0d7-a7320811dea1' &&
      entry.sha256 === createHash('sha256').update(bytes).digest('hex') &&
      bytes.subarray(0, 5).toString('ascii') === '%PDF-' && bytes.length <= 10 * 1024 * 1024 &&
      json('packages/contracts/fixtures/extraction-gold.json').some((gold) =>
        gold.document_id === entry.document_id && gold.sha256 === entry.sha256 &&
        gold.case_id === 'a06adf0c-7110-51f6-86ad-4b4b903c3e9e')
  })
  for (const [file, kind, orgRole, cpRole] of [
    ['receivable_case.json', 'RECEIVABLE', 'seller', 'buyer'],
    ['prepayment_case.json', 'PREPAYMENT', 'buyer', 'seller'],
  ]) attempt(`Synthetic input labels/core roles only: ${file}`, () => {
    const value = json(`tests/fixtures/synthetic/${file}`)
    return value.metadata?.is_synthetic_input === true && value.exposure_kind === kind &&
      value.exposure?.organization_role === orgRole && value.exposure?.counterparty_role === cpRole &&
      typeof value.exposure?.amount_vnd === 'string'
  })
  attempt('Synthetic valid PDF signature (not parser acceptance)', () =>
    readLocal('tests/fixtures/synthetic/valid_synthetic.pdf').subarray(0, 5).toString('ascii') === '%PDF-')
  attempt('Corrupted synthetic fixture present', () => readLocal('tests/fixtures/synthetic/corrupted.pdf').length > 0)
  attempt('Negative-input catalogue present (not executed)', () => Array.isArray(json('tests/fixtures/synthetic/invalid_payloads.json').cases))

  record(env.AIC_BACKEND_URL === 'http://127.0.0.1:3001/api/v2', 'AIC_BACKEND_URL requires /api/v2 suffix: caller must declare exact loopback backend base')
  record((env.AIC_FRONTEND_ORIGIN || 'http://127.0.0.1:3000') === 'http://127.0.0.1:3000', 'Caller frontend origin agrees with fixed suite origin')
  record((env.PORT || '3001') === '3001', 'Caller API port agrees with fixed suite port')
  if (mode === 'prototype') {
    record(env.NODE_ENV === 'test' && env.AIC_RUNTIME_MODE === 'prototype' && env.AIC_ENABLE_PROTOTYPE === 'true',
      'Caller declares all three explicit prototype gates')
    record(env.AI_MODE === 'mock', 'Caller explicitly declares AI mock mode')
    record(Boolean(env.INTERNAL_API_KEY), 'Caller internal key present (value suppressed; service equality unproven)')
    record(Boolean(env.AIC_STORAGE_DIR) && path.isAbsolute(env.AIC_STORAGE_DIR) && !/^[/\\]{2}/.test(env.AIC_STORAGE_DIR),
      'Caller declares absolute local prototype storage path (not opened or write-tested)')
    record((env.AIC_AI_SERVICE_URL || 'http://127.0.0.1:8100') === 'http://127.0.0.1:8100', 'Caller AI URL agrees with fixed loopback target')
  } else {
    record((env.AIC_RUNTIME_MODE || 'foundation') === 'foundation' && env.AIC_ENABLE_PROTOTYPE !== 'true', 'Caller foundation mode without prototype enable')
    for (const name of ['DATABASE_URL', 'AIC_TEST_DATABASE_URL']) attempt(`${name}: local PostgreSQL URL shape only (no DB connection)`, () => {
      const value = new URL(env[name])
      return ['postgres:', 'postgresql:'].includes(value.protocol) &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(value.hostname) && Boolean(value.pathname.slice(1)) &&
        !value.search && !value.hash
    })
    record(env.AIC_ALLOW_LOCAL_DB_TESTS === 'true', 'Caller explicitly opts into disposable local DB tests')
    record(Boolean(env.AIC_IDEMPOTENCY_TTL_MS) && Number.isSafeInteger(Number(env.AIC_IDEMPOTENCY_TTL_MS)) && Number(env.AIC_IDEMPOTENCY_TTL_MS) > 0,
      'Caller declares positive safe integer idempotency retention')
    record(env.NODE_ENV !== 'production', 'Local HTTP acceptance requires non-production cookies/origin')
    pending('DB ownership/disposability, grants, migration checksums and real auth/ACL acceptance require main evidence')
  }

  if (offline) pending('Loopback observations skipped (--offline)')
  else {
    const observations = await Promise.all(ENDPOINTS.map((_, index) => probeEndpoint(index)))
    for (const observation of observations) {
      const listener = observation.listener ? 'listener detected' : 'listener not confirmed'
      console.log(`[OBSERVED] 127.0.0.1:${observation.port}: ${listener}; ${observation.state}` +
        (observation.status ? `; HTTP ${observation.status}` : ''))
      if (observation.port === 8100) {
        if (mode === 'prototype') record(observation.mockHealth === true, 'AI health explicitly reports ok/schema1.0.2/mock (not inspection proof)')
      } else record(observation.state === 'http' && observation.protected === true,
        `Port ${observation.port} unauthenticated auth/me rejects with 401/403 (mode unproven)`)
      if (observation.proxyUnconfigured) pending('Frontend explicitly reports BACKEND_NOT_CONFIGURED')
    }
  }
  pending('Existing API mode and actual proxy target require main launch/config evidence; caller env and HTTP status cannot prove them')
  pending('Main must verify current build/dependencies and private disposable storage; no imports/builds/write probes performed')
  if (mode === 'prototype') {
    pending('Main must check auxiliary ports 59998 available / 59999 unused; preflight does not probe or bind them')
    pending('Full FE-BE-AI NOT RUN/BLOCKED: renewed ordinary Next3000 attempt was rejected blocked by policy; no alternate startup')
    pending('Real synthetic PDF parser inspection is a separate gate; mock manifest inspection does not satisfy it')
  }
  for (const check of checks) console.log(`[${check.status}] ${check.label}`)
  console.log(`READINESS UNRESOLVED (${mode}); no services/tests started; no files changed; no secrets emitted.`)
  return 1
}

module.exports = { parseFeasibilityOutput, probeEndpoint, main }
if (require.main === module) main().then((code) => { process.exitCode = code }).catch(() => {
  console.error('[ERROR] Preflight failed; diagnostic values suppressed.')
  process.exitCode = 2
})
