// Run ONLY through scripts/test-local-postgres.cjs. Never reads a user DB URL.
const { test } = require('node:test'),
  assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  net = require('node:net')
const { randomUUID, randomBytes, createHash } = require('node:crypto'),
  { parseEnv } = require('node:util')
const { spawn, execFileSync } = require('node:child_process'),
  { Client } = require('pg')
const project = path.resolve(__dirname, '../../../..')
const { migrate } = require('../../dist/database/migrate'),
  { bootstrapSandbox } = require('../../dist/database/bootstrap-sandbox')
const { loadConfig } = require('../../dist/config/configuration'),
  { createApplication } = require('../../dist/main')
const { DatabaseService } = require('../../dist/database/database.service')
const { DocumentWorker } = require('../../dist/documents/document-worker')
const { PostgresDocumentRepository } = require('../../dist/documents/postgres-document.repository')
const { PrivateDocumentFiles } = require('../../dist/document-storage/private-files')
const { DocumentAiTransport } = require('../../dist/ai-adapters/document-ai-transport')
const hash = (b) => createHash('sha256').update(b).digest('hex')
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function free(port) {
  const s = net.createServer()
  return new Promise((resolve) => {
    s.once('error', () => resolve(false))
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
  })
}

test(
  'controlled local MVP acceptance: isolated PostgreSQL + actual API/worker/live AI and owner frontend',
  { timeout: 1200000 },
  async () => {
    assert.equal(process.env.AIC_ALLOW_LOCAL_DB_TESTS, 'true')
    assert.ok(process.env.AIC_TEST_DATABASE_URL)
    const url = new URL(process.env.AIC_TEST_DATABASE_URL)
    assert.equal(url.hostname, '127.0.0.1')
    assert.equal(url.port, '15432')
    assert.equal(url.username, 'aic_test_owner')
    const admin = new Client({ connectionString: url.href })
    await admin.connect()
    const identity = (
      await admin.query(
        "SELECT current_user,current_database(),current_setting('data_directory') AS directory",
      )
    ).rows[0]
    assert.equal(identity.current_user, 'aic_test_owner')
    assert.equal(identity.current_database, 'postgres')
    assert.ok(
      path.resolve(identity.directory).startsWith(path.join(os.tmpdir(), 'aic-pg-check-')),
      'Refuse unknown cluster',
    )
    const cluster = (
      await admin.query(
        "SELECT current_user AS username,current_database() AS database,current_setting('data_directory') AS data_directory,current_setting('port') AS port",
      )
    ).rows[0]
    require('../acceptance-security/harness.cjs').verifyClusterFiles(cluster, url)
    const suffix = randomBytes(6).toString('hex'),
      name = 'aic_mvp_accept_' + suffix,
      apiRole = 'aic_accept_api_' + suffix,
      workerRole = 'aic_accept_worker_' + suffix
    const dbPassword = randomBytes(32).toString('hex'),
      password = randomBytes(24).toString('hex'),
      username = 'accept_' + suffix
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aic-accept-evidence-')),
      storage = path.join(root, 'private-source')
    const results = [],
      secrets = [dbPassword, password],
      createdRoles = []
    let app,
      ai,
      workerDB,
      owner,
      browser,
      dbCreated = false,
      polling = false,
      workerLoop,
      apiPort
    const mode = process.env.AIC_ACCEPTANCE_LIVE === 'true' ? 'live' : 'not_requested'
    const profile = ['browser', 'recovery', 'recovery-independent', 'model-retest'].includes(
      process.env.AIC_ACCEPTANCE_PROFILE,
    )
      ? process.env.AIC_ACCEPTANCE_PROFILE
      : 'full'
    const modelRetest = profile === 'model-retest'
    const retestPolicy = require('./model-retest-policy.cjs')
    let configuredModel
    const providerEvents = []
    const diagnosticReader = require('./provider-diagnostic-reader.cjs').createReader((event) => {
      providerEvents.push(event)
      fs.writeFileSync(
        path.join(root, 'provider-diagnostics.json'),
        JSON.stringify(providerEvents, null, 2),
      )
    })
    function clean(s) {
      let v = String(s ?? '')
      for (const secret of secrets) if (secret) v = v.replaceAll(secret, '<redacted>')
      return v
        .replace(
          /(?:postgres(?:ql)?|https?):\/\/[^\s/:@]+:[^\s/@]+@[^\s/?#'"<>]+/g,
          '<credential-url>',
        )
        .replace(/#token=[^\s"'<>]+/g, '#token=<redacted>')
    }
    async function step(label, fn) {
      try {
        const value = await fn()
        results.push({ label, status: 'PASS' })
        fs.writeFileSync(path.join(root, 'progress.json'), JSON.stringify(results, null, 2))
        console.log('PASS ' + label)
        return value
      } catch (error) {
        const detail = clean(error?.message).slice(0, 1500)
        results.push({ label, status: 'FAIL', detail })
        fs.writeFileSync(path.join(root, 'progress.json'), JSON.stringify(results, null, 2))
        console.log('FAIL ' + label)
        return undefined
      }
    }
    const blocked = (label, reason) => {
      results.push({ label, status: 'BLOCKED', reason })
      console.log('BLOCKED ' + label + ': ' + reason)
    }
    try {
      await admin.query('CREATE DATABASE ' + name)
      dbCreated = true
      const ownerURL = new URL(url)
      ownerURL.pathname = '/' + name
      for (const role of [apiRole, workerRole]) {
        await admin.query(
          `CREATE ROLE ${role} LOGIN PASSWORD '${dbPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
        )
        createdRoles.push(role)
      }
      await migrate(ownerURL.href)
      owner = new Client({ connectionString: ownerURL.href })
      await owner.connect()
      const grants = fs
        .readFileSync(path.join(project, 'scripts/sandbox-runtime-grants.sql'), 'utf8')
        .replaceAll(':"api_role"', '"' + apiRole + '"')
        .replaceAll(':"worker_role"', '"' + workerRole + '"')
      await owner.query(grants)
      Object.assign(process.env, {
        DATABASE_URL: ownerURL.href,
        NODE_ENV: 'development',
        AIC_SANDBOX_BOOTSTRAP: 'true',
        AIC_SANDBOX_ORGANIZATION_ID: randomUUID(),
        AIC_SANDBOX_USERNAME: username,
        AIC_SANDBOX_PASSWORD: password,
      })
      await bootstrapSandbox()
      delete process.env.AIC_SANDBOX_PASSWORD
      delete process.env.AIC_SANDBOX_BOOTSTRAP
      await step(
        'fresh disposable schema0001–0017 and least-privilege runtime identity',
        async () => {
          assert.equal(
            (await owner.query('SELECT count(*)::int AS n FROM aic.schema_migrations')).rows[0].n,
            17,
          )
          for (const role of createdRoles) {
            const r = (
              await owner.query(
                'SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1',
                [role],
              )
            ).rows[0]
            assert.ok(!r.rolsuper && !r.rolcreatedb && !r.rolcreaterole)
          }
        },
      )
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.join(project, 'scripts/create-private-cache.ps1'),
          '-Path',
          storage,
        ],
        { windowsHide: true, stdio: 'pipe' },
      )
      const local = fs.existsSync(path.join(project, '.env'))
        ? parseEnv(fs.readFileSync(path.join(project, '.env'), 'utf8'))
        : {}
      const provider = mode === 'live' && (process.env.GEMINI_API_KEY || local.GEMINI_API_KEY)
      configuredModel = process.env.MODEL_ID || local.MODEL_ID || ''
      if (modelRetest) retestPolicy.assertModel(configuredModel)
      if (provider) secrets.push(provider)
      const internalKey = randomBytes(32).toString('hex')
      secrets.push(internalKey)
      if (!(await free(8100))) {
        blocked('actual live AI startup', 'Port8100 already owned; no process stopped')
        return
      }
      if (!provider) {
        blocked(
          'actual live extraction',
          'No authorized live provider configuration; no mock fallback',
        )
        return
      }
      ai = spawn(
        path.join(project, '.venv', 'Scripts', 'python.exe'),
        ['-m', 'runner', 'serve', '--port', '8100'],
        {
          cwd: path.join(project, 'services/ai'),
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          env: {
            ...process.env,
            INTERNAL_API_KEY: internalKey,
            AI_MODE: 'live',
            AI_STORAGE_DIR: storage,
            GEMINI_API_KEY: provider,
            MODEL_ID: configuredModel,
            PROMPT_VERSION: process.env.PROMPT_VERSION || local.PROMPT_VERSION || '',
            OCR_ENGINE: 'gemini',
            ENABLE_TEST_CONSOLE: 'false',
            AI_EXTRACT_DEADLINE_S: '120',
            AI_MAX_MODEL_CALLS: '1',
            AI_MAX_MODEL_QUEUE: '2',
            AIC_SAFE_PROVIDER_DIAGNOSTICS: profile.startsWith('recovery') || modelRetest ? '1' : '0',
          },
        },
      )
      ai.stderr.setEncoding('utf8')
      ai.stderr.on('data', (chunk) => diagnosticReader.push(chunk))
      let ready = false
      for (let i = 0; i < 100; i++) {
        if (ai.exitCode !== null) break
        try {
          const r = await fetch('http://127.0.0.1:8100/healthz')
          const h = await r.json()
          if (h.status === 'ok' && h.schema_version === '1.0.2' && h.mode === 'live') {
            ready = true
            break
          }
        } catch {}
        await pause(100)
      }
      assert.ok(ready, 'Owned live AI service failed readiness')
      results.push({ label: 'actual FastAPI8100 mode=live schema1.0.2', status: 'PASS' })
      const apiURL = new URL(ownerURL)
      apiURL.username = apiRole
      apiURL.password = dbPassword
      Object.assign(process.env, {
        DATABASE_URL: apiURL.href,
        NODE_ENV: 'development',
        AIC_RUNTIME_MODE: 'foundation',
        AIC_DOCUMENT_RUNTIME: 'local',
        AIC_DOCUMENT_AI_MODE: 'live',
        AIC_STORAGE_DIR: storage,
        INTERNAL_API_KEY: internalKey,
        AIC_AI_SERVICE_URL: 'http://127.0.0.1:8100',
        AIC_FRONTEND_ORIGIN: 'http://127.0.0.1:3000',
        AIC_IDEMPOTENCY_TTL_MS: '86400000',
        PORT: '3001',
      })
      const config = loadConfig()
      app = await createApplication(config, true)
      const browserPortFree = await free(3001)
      await app.listen(browserPortFree ? 3001 : 0, '127.0.0.1')
      apiPort = app.getHttpServer().address().port
      // API ephemeral port is a direct HTTP test only when owner3001 is busy;
      // never start/move Next or report that path as full frontend acceptance.
      const workerURL = new URL(ownerURL)
      workerURL.username = workerRole
      workerURL.password = dbPassword
      workerDB = new DatabaseService({ ...config, databaseUrl: workerURL.href })
      await workerDB.onModuleInit()
      const transport = new DocumentAiTransport({
        baseURL: 'http://127.0.0.1:8100',
        internalKey,
        expectedMode: 'live',
        contractsDirectory: path.join(project, 'packages/contracts'),
        extractTimeoutMs: 130000,
      })
      const files = new PrivateDocumentFiles(storage),
        repo = new PostgresDocumentRepository(workerDB, config)
      const liveHelper = path.join(__dirname, '../acceptance-ai-fixtures/live-subset.cjs')
      if (profile === 'full' && fs.existsSync(liveHelper))
        await require(liveHelper).runLiveSubset({ transport, files, output: root, step })
      else if (profile === 'full')
        blocked('reviewed agent03 live subset', 'Curated independent oracle helper not available')
      const worker = new DocumentWorker(repo, files, transport, {
        leaseMs: 300000,
        maxAttempts: 3,
        automaticRetry: false,
      })
      polling = true
      workerLoop = (async () => {
        while (polling) {
          const state = await worker.once('accept-' + suffix)
          if (state === 'idle') await pause(200)
        }
      })().catch((error) => {
        polling = false
        results.push({
          label: 'actual worker polling',
          status: 'FAIL',
          detail: clean(error?.message).slice(0, 1000),
        })
      })
      const api = 'http://127.0.0.1:' + apiPort + '/api/v2',
        origin = 'http://127.0.0.1:3000'
      const login = await fetch(api + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ username, password }),
      })
      assert.equal(login.status, 200)
      const session = await login.json(),
        cookie = login.headers.get('set-cookie').split(';')[0],
        csrf = session.csrf_token
      secrets.push(cookie, csrf)
      const request = async (
        route,
        { method = 'GET', body, headers = {}, key = randomUUID() } = {},
      ) =>
        fetch(api + route, {
          method,
          headers: {
            Cookie: cookie,
            Origin: origin,
            'X-CSRF-Token': csrf,
            'Idempotency-Key': key,
            ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
            ...headers,
          },
          body:
            body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
        })
      await step('actual runtime identity and session through Nest', async () => {
        const r = await request('/auth/me')
        assert.equal(r.status, 200)
        const current = await r.json()
        assert.equal(current.user.id, session.user.id)
        assert.equal(current.user.role, 'specialist')
      })
      const parties = await (await request('/counterparties')).json()
      const items = parties.items ?? parties.data ?? []
      assert.ok(items.length === 2, 'Synthetic bootstrap counterparties expected')
      let previousLivePassed = true
      for (const [index, kind] of (profile === 'full' || modelRetest
        ? ['RECEIVABLE', 'PREPAYMENT']
        : []
      ).entries()) {
        if (modelRetest && !retestPolicy.mayDispatch(providerEvents, previousLivePassed)) {
          blocked(kind + ' model retest', 'Previous live extraction failed; no further dispatch')
          break
        }
        const previousResultCount = results.length
        await step(kind + ' actual API→DB→worker→live AI→DB exact-source extraction', async () => {
          const exposure = {
            amount_vnd: '500000000',
            amount_missing_reason: null,
            term_days: 30,
            term_null_reason: null,
            due_date: null,
            contract_ref: 'SYNTHETIC ACCEPTANCE',
            conditions: [],
            claims: [],
            organization_role: kind === 'RECEIVABLE' ? 'seller' : 'buyer',
            counterparty_role: kind === 'RECEIVABLE' ? 'buyer' : 'seller',
            source_origin: 'staff_entered',
          }
          const created = await request('/cases', {
            method: 'POST',
            body: {
              counterparty_id: items[index].id,
              exposure_kind: kind,
              lifecycle_stage: 'proposed',
              exposure,
            },
          })
          assert.equal(created.status, 201)
          let current = await created.json()
          const bytes = fs.readFileSync(
              path.join(project, 'packages/contracts/fixtures/04_contract.pdf'),
            ),
            form = new FormData()
          for (const [k, v] of Object.entries({
            type: 'contract',
            source_class: 'synthetic_acceptance',
            mode: 'new',
            expected_revision: String(current.revision),
          }))
            form.set(k, v)
          form.set('file', new Blob([bytes], { type: 'application/pdf' }), 'SYNTHETIC-contract.pdf')
          const accepted = await request('/cases/' + current.id + '/documents', {
            method: 'POST',
            body: form,
          })
          assert.equal(accepted.status, 202)
          const document = await accepted.json()
          let job
          for (let i = 0; i < 650; i++) {
            const r = await request('/jobs/' + document.job.id)
            job = await r.json()
            if (!['queued', 'running'].includes(job.state)) break
            await pause(200)
          }
          assert.equal(
            job.state,
            'completed',
            'Actual live worker result: ' + job.state + ' ' + (job.error_code ?? ''),
          )
          const extraction = await request(
            '/documents/' + document.document.id + '/legacy-extraction',
          )
          assert.equal(extraction.status, 200)
          const output = await extraction.json()
          assert.equal(output.ai_mode, 'live')
          assert.equal(output.raw.schema_version, '1.0.2')
          assert.ok(!output.raw.provenance.model_id.includes('MOCK'))
          if (modelRetest) retestPolicy.assertModel(output.raw.provenance.model_id, configuredModel)
          assert.equal(output.raw.sha256, hash(bytes))
          for (const e of output.raw.evidence) {
            assert.equal(e.document_id, document.document.id)
            assert.ok(e.page >= 1)
            assert.ok(e.quote.trim())
          }
          const source = await request(
            '/documents/' +
              document.document.id +
              '/source?version=' +
              document.document.version +
              '&sha256=' +
              document.document.hash,
          )
          assert.equal(source.status, 200)
          assert.equal(hash(Buffer.from(await source.arrayBuffer())), hash(bytes))
          const facts = output.raw.fields.map((f) => ({
            key: f.field_key,
            value: f.value,
            quality: f.quality,
            evidence_ids: f.evidence_ids,
          }))
          fs.writeFileSync(
            path.join(root, kind + '-live-extraction.json'),
            JSON.stringify(
              {
                mode: 'live',
                schema: '1.0.2',
                source_hash: hash(bytes),
                provenance: output.raw.provenance,
                facts,
                evidence: output.raw.evidence,
                diagnostics: output.raw.diagnostics,
              },
              null,
              2,
            ),
          )
          current = await (await request('/cases/' + current.id)).json()
          const review = await request('/cases/' + current.id + '/review-runs', {
            method: 'POST',
            body: { expected_revision: current.revision },
          })
          assert.equal(review.status, 201)
          const reviewed = await review.json()
          for (const key of ['score', 'band', 'grade', 'pd'])
            assert.equal(reviewed.financial_health[key], null)
        })
        previousLivePassed = results[previousResultCount]?.status === 'PASS'
      }
      if (modelRetest) {
        // Explicitly scoped API/worker test: no frontend startup and no browser claim.
        console.log('Browser acceptance NOT RUN (bounded model retest)')
      } else if (browserPortFree) {
        const helper = path.join(project, 'apps/web/tests/acceptance-preparation/browser-flows.cjs')
        if (!fs.existsSync(helper))
          blocked('real frontend browser workflows', 'Reviewed browser adapter not yet present')
        else {
          // Reuse owner-started Next only, and prove its proxy reaches THIS new identity.
          let frontendReady = false
          for (let i = 0; i < 120; i++) {
            try {
              const r = await fetch(origin + '/login', { signal: AbortSignal.timeout(1000) })
              if (r.ok) {
                frontendReady = true
                break
              }
            } catch {}
            await pause(500)
          }
          if (!frontendReady) {
            blocked(
              'real frontend browser workflows',
              'Owner Next3000 absent; no alternate startup attempted',
            )
            return
          }
          const proxy = await fetch(origin + '/api/v2/auth/login', {
            method: 'POST',
            headers: { Origin: origin, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          })
          if (proxy.status !== 200)
            blocked(
              'real frontend browser workflows',
              'Owner Next proxy does not reach isolated API3001',
            )
          else {
            const library =
              process.env.AIC_PLAYWRIGHT_MODULE ||
              'C:/Users/52duc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
            browser = await require(library).chromium.launch({
              headless: true,
              executablePath:
                process.env.AIC_ACCEPT_CHROMIUM_PATH ||
                'C:/Users/52duc/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
            })
            const browserResult = await require(helper).runBrowserAcceptance({
              browser,
              origin,
              username,
              password,
              output: root,
              step,
              providerAvailable: true,
              allowLive: () =>
                profile !== 'recovery-independent' &&
                !providerEvents.some((e) =>
                  [
                    'RATE_LIMIT_OR_QUOTA',
                    'UPSTREAM_AUTH_REJECTED',
                    'UPSTREAM_NOT_FOUND',
                    'PROVIDER_CONFIGURATION_MISSING',
                  ].includes(e.category),
                ),
              allowProviderRetry: (id) =>
                !providerEvents.some(
                  (e) =>
                    e.document_id === id &&
                    [
                      'RATE_LIMIT_OR_QUOTA',
                      'UPSTREAM_AUTH_REJECTED',
                      'UPSTREAM_NOT_FOUND',
                      'PROVIDER_CONFIGURATION_MISSING',
                    ].includes(e.category),
                ),
              readLegacy: async (id) => {
                assert.match(id, /^[0-9a-f-]{36}$/)
                const response = await request('/documents/' + id + '/legacy-extraction')
                assert.equal(response.status, 200)
                return response.json()
              },
            })
            fs.writeFileSync(
              path.join(root, 'browser-coverage.json'),
              JSON.stringify(browserResult, null, 2),
            )
            for (const item of browserResult.steps.filter((s) => s.status === 'BLOCKED'))
              blocked(item.name, item.reason)
            const recovery = path.join(
              project,
              'apps/web/tests/acceptance-preparation/recovery-scenarios.cjs',
            )
            if (
              profile.startsWith('recovery') &&
              process.env.AIC_RECOVERY_SCENARIOS === 'true' &&
              fs.existsSync(recovery)
            ) {
              fs.writeFileSync(
                path.join(root, 'recovery-helper-fingerprint.json'),
                JSON.stringify(
                  { sha256: hash(fs.readFileSync(recovery)), reviewed: true },
                  null,
                  2,
                ),
              )
              const extra = await require(recovery).runRecoveryScenarios({
                browser,
                origin,
                username,
                password,
                output: root,
                step,
                cases: browserResult.cases,
              })
              fs.writeFileSync(
                path.join(root, 'recovery-browser-coverage.json'),
                JSON.stringify(extra, null, 2),
              )
              for (const item of (extra.steps ?? []).filter((s) => s.status === 'BLOCKED'))
                blocked(item.name, item.reason ?? 'Prerequisite unavailable')
            }
          }
        }
      } else
        blocked(
          'full frontend browser acceptance',
          'Owner API3001 still occupied; direct HTTP isolated test used an ephemeral Nest port. No Next startup/rebind or user DB access.',
        )
    } catch (error) {
      results.push({
        label: 'acceptance runtime prerequisite/execution',
        status: 'FAIL',
        detail: clean(error?.message).slice(0, 1500),
      })
      console.log('FAIL acceptance runtime prerequisite/execution')
    } finally {
      if (owner && (profile.startsWith('recovery') || modelRetest)) {
        try {
          const audit =
            await owner.query(`SELECT j.id AS job_id,j.case_id,j.document_id,j.document_version,j.sha256,
          j.state,j.attempts,j.fence::text,j.error_code,j.retryable,j.ai_mode,
          (SELECT count(*)::int FROM aic.mvp_document_results r WHERE r.job_id=j.id AND r.outcome='published') AS published_results
          FROM aic.mvp_document_jobs j ORDER BY j.created_at,j.id`)
          fs.writeFileSync(
            path.join(root, 'job-binding-audit.json'),
            JSON.stringify(audit.rows, null, 2),
          )
        } catch {
          results.push({
            label: 'read-only job binding evidence',
            status: 'FAIL',
            detail: 'Audit unavailable; continue owned-resource cleanup',
          })
        }
      }
      if (browser) await browser.close()
      polling = false
      if (workerLoop) await workerLoop
      if (app) await app.close()
      if (workerDB) await workerDB.onModuleDestroy()
      if (ai && ai.exitCode === null) {
        ai.kill()
        await Promise.race([new Promise((r) => ai.once('exit', r)), pause(5000)])
      }
      diagnosticReader.end()
      fs.writeFileSync(
        path.join(root, 'provider-diagnostics.json'),
        JSON.stringify(providerEvents, null, 2),
      )
      if (owner) await owner.end()
      if (dbCreated) await admin.query('DROP DATABASE ' + name)
      for (const role of createdRoles) await admin.query('DROP ROLE ' + role)
      await admin.end()
      fs.writeFileSync(
        path.join(root, 'acceptance-results.json'),
        JSON.stringify(
          {
            recorded_at: new Date().toISOString(),
            mode,
            profile,
            configured_model: configuredModel,
            root,
            results,
            scope:
              'fresh owned PG15432; actual Nest/FastAPI/worker, owner Next only; no userDB migrations or mock AI; synthetic-only evidence; no raw credentials',
          },
          null,
          2,
        ),
      )
      console.log('Acceptance evidence: ' + root)
      assert.ok(
        results.length > 0 && results.every((r) => r.status === 'PASS'),
        'Acceptance has FAIL/BLOCKED; see sanitized evidence',
      )
    }
    assert.ok(
      results.every((r) => r.status === 'PASS'),
      'Acceptance has FAIL/BLOCKED; see sanitized evidence',
    )
  },
)
