// In-process FastAPI -> actual compiled Nest-side validator compatibility probe.
// No TCP listener, Next.js, worker, database, provider call or service modification.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')

const root = path.resolve(__dirname, '..')
const contractDir = path.join(root, 'packages/contracts')
const python = process.platform === 'win32'
  ? path.join(root, '.venv/Scripts/python.exe') : path.join(root, '.venv/bin/python')
const { createLegacyAiValidationBoundary } = require('../apps/api/dist/ai-adapters/legacy-validation.js')
const manifest = fs.readFileSync(path.join(contractDir, 'SHA256SUMS'), 'utf8')
const boundary = createLegacyAiValidationBoundary({
  version: fs.readFileSync(path.join(contractDir, 'VERSION'), 'utf8'),
  sha256sums: manifest,
  files: Object.fromEntries(manifest.trim().split(/\r?\n/).map((line) => {
    const name = line.split(/\s+/)[1]
    return [name, fs.readFileSync(path.join(contractDir, name))]
  })),
})

// Explicit Settings avoid loading runtime credentials. Live operation is inspect
// only: local synthetic PDF parsing without OCR/Gemini. Mock extraction is labeled.
const program = String.raw`
import hashlib, json, os, secrets, tempfile
from pathlib import Path
from fastapi.testclient import TestClient
from runner.app import create_app
from runner.config import Settings, DEFAULT_CONTRACTS_DIR, DEFAULT_FIXTURES_DIR

key = secrets.token_hex(32)
def settings(mode):
    return Settings(internal_api_key=key, mode=mode, model_id='', prompt_version='',
        contracts_dir=DEFAULT_CONTRACTS_DIR, fixtures_dir=DEFAULT_FIXTURES_DIR,
        gemini_key_configured=False, test_console=False)
examples = json.loads((DEFAULT_CONTRACTS_DIR / 'examples.json').read_text('utf-8'))
def example(name):
    return next(entry['value'] for entry in examples if entry['name'] == name)
results = []
with TestClient(create_app(settings('mock'))) as client:
    for operation in ('inspect', 'extract'):
        request = example(operation + ' request')
        response = client.post('/internal/v1/' + operation, json=request,
            headers={'X-Internal-Key': key})
        assert response.status_code == 200, 'mock request failed'
        results.append(dict(operation=operation, request=request, body=response.json(),
            headers={'x-ai-mode': response.headers.get('X-AI-Mode')}, expectedMode='mock'))
    denied = client.post('/internal/v1/inspect', json=example('inspect request'))
    assert denied.status_code == 403, 'internal key guard failed'
with tempfile.TemporaryDirectory(prefix='aic-phase2-inspect-') as directory:
    source = DEFAULT_CONTRACTS_DIR.parents[1] / 'tests/fixtures/synthetic/valid_synthetic.pdf'
    data = source.read_bytes()
    target = Path(directory) / 'synthetic.pdf'
    target.write_bytes(data)
    os.environ['AI_STORAGE_DIR'] = directory
    os.environ['AI_MAX_PDF_BYTES'] = '25000000'
    request = dict(schema_version='1.0.2', storage_key='synthetic.pdf',
        sha256=hashlib.sha256(data).hexdigest())
    with TestClient(create_app(settings('live'))) as client:
        response = client.post('/internal/v1/inspect', json=request,
            headers={'X-Internal-Key': key})
        assert response.status_code == 200, 'live synthetic inspection failed'
        results.append(dict(operation='inspect', request=request, body=response.json(),
            headers={'x-ai-mode': response.headers.get('X-AI-Mode')}, expectedMode='live'))
print(json.dumps(results))
`

let stage = 'FastAPI subprocess'
try {
  const raw = execFileSync(python, ['-c', program], {
    cwd: path.join(root, 'services/ai'), encoding: 'utf8', timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GEMINI_API_KEY: '', AI_MODE: 'mock', OCR_ENGINE: 'none',
      PYTHONDONTWRITEBYTECODE: '1', ENABLE_TEST_CONSOLE: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  stage = 'parse subprocess output'
  const exchanges = JSON.parse(raw)
  assert.equal(exchanges.length, 3)
  for (const exchange of exchanges) {
    stage = `${exchange.headers['x-ai-mode']} ${exchange.operation} validation`
    const before = JSON.stringify(exchange.body)
    const validated = boundary.validate(exchange)
    assert.equal(validated.mode, exchange.expectedMode)
    assert.equal(validated.orchestrationBinding, 'pending')
    assert.equal(validated.body, exchange.body)
    assert.equal(JSON.stringify(validated.body), before)
    if (exchange.operation === 'extract') {
      assert.equal(validated.body.provenance.model_id, 'MOCK-GOLD-NOT-MODEL-OUTPUT')
      assert.ok(Array.isArray(validated.body.diagnostics))
    }
    if (exchange.headers['x-ai-mode'] === 'live') {
      const bytes = fs.readFileSync(path.join(root, 'tests/fixtures/synthetic/valid_synthetic.pdf'))
      assert.equal(validated.body.sha256, createHash('sha256').update(bytes).digest('hex'))
      assert.equal(validated.body.byte_size, bytes.length)
      assert.ok(validated.body.page_count > 0)
    }
    process.stdout.write(`PASS FastAPI TestClient -> compiled validator: ${exchange.headers['x-ai-mode']} ${exchange.operation}\n`)
  }
  process.stdout.write('PASS actual FastAPI missing internal key -> 403\n')
  process.stdout.write('Scope: in-process compatibility, NOT FE/BE TCP, live extraction, worker or production acceptance.\n')
} catch (error) {
  // Do not echo provider data, child environment, raw HTTP bodies or child stderr.
  const code = ['INVALID_CONTRACT_BUNDLE', 'INVALID_LEGACY_REQUEST', 'INVALID_LEGACY_RESPONSE',
    'SOURCE_MISMATCH', 'UNSUPPORTED_MODE', 'MODE_MISMATCH', 'ERR_ASSERTION'].includes(error.code)
    ? error.code : 'PROBE_FAILED'
  process.stderr.write(`FAIL AI boundary compatibility probe at ${stage} (${code}); verify local venv, build, contracts and synthetic fixture.\n`)
  process.exitCode = 1
}
