const test = require('node:test'),
  assert = require('node:assert/strict')
const { randomUUID, randomBytes, createHash } = require('node:crypto')
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  net = require('node:net')
const { spawn, execFileSync } = require('node:child_process')
const { Client } = require('pg')
const { migrate } = require('../dist/database/migrate')
const { createApplication } = require('../dist/main')
const { loadConfig } = require('../dist/config/configuration')
const { hashPassword } = require('../dist/auth')
const { validateContract } = require('../dist/foundation/validation')
const { requestHash } = require('../dist/foundation/canonical')
const { DatabaseService } = require('../dist/database/database.service')
const { SessionService } = require('../dist/auth')
const { PostgresDocumentRepository } = require('../dist/documents/postgres-document.repository')
const { DocumentWorker } = require('../dist/documents/document-worker')
const { DocumentAiTransport } = require('../dist/ai-adapters/document-ai-transport')
const { PrivateDocumentFiles } = require('../dist/document-storage/private-files')

test(
  'local document HTTP + actual FastAPI live native inspection + PostgreSQL source',
  { timeout: 120000 },
  async (t) => {
    assert.equal(process.env.AIC_ALLOW_LOCAL_DB_TESTS, 'true')
    const adminURL = new URL(process.env.AIC_TEST_DATABASE_URL)
    assert.ok(['127.0.0.1', 'localhost'].includes(adminURL.hostname))
    const admin = new Client({ connectionString: adminURL.href })
    await admin.connect()
    const suffix = randomBytes(6).toString('hex'),
      dbName = 'aic_doc_http_' + suffix
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aic-doc-http-'))
    // Explicit private test-owned Windows DACL, without changing any user directory.
    if (process.platform === 'win32')
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `
    $ErrorActionPreference='Stop'; $me=[Security.Principal.WindowsIdentity]::GetCurrent().User;
    $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($me); $acl.SetAccessRuleProtection($true,$false);
    foreach($sid in @($me.Value,'S-1-5-18','S-1-5-32-544')) { $identity=New-Object Security.Principal.SecurityIdentifier($sid); $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))) };
    [IO.Directory]::SetAccessControl($env:AIC_HTTP_TEST_ROOT,$acl)
  `,
        ],
        { env: { ...process.env, AIC_HTTP_TEST_ROOT: root }, windowsHide: true, stdio: 'pipe' },
      )
    else fs.chmodSync(root, 0o700)
    let owner, app, ai
    try {
      await admin.query('CREATE DATABASE ' + dbName)
      const url = new URL(adminURL)
      url.pathname = '/' + dbName
      await migrate(url.href)
      owner = new Client({ connectionString: url.href })
      await owner.connect()
      const org = randomUUID(),
        user = randomUUID(),
        cp = randomUUID(),
        caseId = randomUUID(),
        foreign = randomUUID()
      const password = 'Synthetic-' + randomUUID()
      await owner.query('INSERT INTO aic.organizations(id,name) VALUES($1,$2)', [
        org,
        'SYNTHETIC HTTP',
      ])
      for (const [id, name] of [
        [user, 'member'],
        [foreign, 'outsider'],
      ])
        await owner.query(
          "INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role) VALUES($1,$2,$3,$4,$3,'specialist')",
          [id, org, name, await hashPassword(password)],
        )
      await owner.query(
        "INSERT INTO aic.counterparties(id,organization_id,name,country) VALUES($1,$2,'SYNTHETIC','VN')",
        [cp, org],
      )
      const policy = JSON.parse(
        fs.readFileSync(
          path.resolve(
            __dirname,
            '../../../docs/implementation/policies/AIC-MVP-SANDBOX-2026-10-17.1.json',
          ),
          'utf8',
        ),
      )
      await owner.query(
        'INSERT INTO aic.mvp_policy_artifacts(version,sha256,artifact_json,approved_at,effective_from) VALUES($1,$2,$3,$4,$5)',
        [
          policy.policy_version,
          requestHash(policy),
          policy,
          policy.approval.recorded_at,
          policy.effective_from,
        ],
      )
      for (const kind of ['RECEIVABLE', 'PREPAYMENT'])
        await owner.query(
          `INSERT INTO aic.mvp_policy_assignments(id,organization_id,policy_version,artifact_hash,exposure_kind,effective_from) VALUES($1,$2,$3,$4,$5,$6)`,
          [
            randomUUID(),
            org,
            policy.policy_version,
            requestHash(policy),
            kind,
            policy.effective_from,
          ],
        )
      await owner.query(
        "INSERT INTO aic.cases(id,organization_id,counterparty_id,exposure_kind,lifecycle_stage,exposure_json,policy_version,policy_artifact_hash,created_by) VALUES($1,$2,$3,'PREPAYMENT','proposed',$4,$5,$6,$7)",
        [
          caseId,
          org,
          cp,
          {
            amount_vnd: '200000000',
            term_days: 30,
            organization_role: 'buyer',
            counterparty_role: 'seller',
            contract_ref: null,
            conditions: [],
            source_origin: 'staff_entered',
          },
          policy.policy_version,
          requestHash(policy),
          user,
        ],
      )
      const listener = net.createServer()
      await new Promise((r) => listener.listen(0, '127.0.0.1', r))
      const aiPort = listener.address().port
      await new Promise((r) => listener.close(r))
      const project = path.resolve(__dirname, '../../..'),
        key = randomBytes(24).toString('hex')
      ai = spawn(
        path.join(project, '.venv', 'Scripts', 'python.exe'),
        // Native inspect remains real. The isolated harness blocks dotenv and
        // outbound connections instead of loading the user's provider settings.
        ['-I', '-B', path.join(__dirname, 'demo-zip-runtime.py'), 'inspect-only', String(aiPort), root],
        {
          cwd: path.join(project, 'services', 'ai'),
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore'],
          env: {
            ...process.env,
            INTERNAL_API_KEY: key,
            AI_MODE: 'live',
            AI_STORAGE_DIR: root,
            OCR_ENGINE: 'none',
          },
        },
      )
      let ready = false
      for (let i = 0; i < 100; i++) {
        if (ai.exitCode !== null) throw new Error('FastAPI startup failed')
        try {
          await fetch('http://127.0.0.1:' + aiPort + '/health')
          ready = true
          break
        } catch {}
        await new Promise((r) => setTimeout(r, 100))
      }
      assert.ok(ready, 'Actual FastAPI TCP startup')
      Object.assign(process.env, {
        NODE_ENV: 'test',
        DATABASE_URL: url.href,
        AIC_RUNTIME_MODE: 'foundation',
        AIC_DOCUMENT_RUNTIME: 'local',
        AIC_DOCUMENT_AI_MODE: 'live',
        AIC_STORAGE_DIR: root,
        AIC_AI_SERVICE_URL: 'http://127.0.0.1:' + aiPort,
        INTERNAL_API_KEY: key,
        AIC_IDEMPOTENCY_TTL_MS: '86400000',
      })
      const config = loadConfig()
      app = await createApplication(config, true)
      await app.listen(0, '127.0.0.1')
      let base = (await app.getUrl()) + '/api/v2'
      async function login(username) {
        const r = await fetch(base + '/auth/login', {
          method: 'POST',
          headers: { origin: config.frontendOrigin, 'content-type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })
        assert.equal(r.status, 200)
        const body = await r.json()
        return { cookie: r.headers.get('set-cookie').split(';')[0], csrf: body.csrf_token }
      }
      const member = await login('member'),
        outsider = await login('outsider')
      const bytes = fs.readFileSync(
        path.join(project, 'tests/fixtures/synthetic/valid_synthetic.pdf'),
      )
      const sha = createHash('sha256').update(bytes).digest('hex')
      function form(revision = 1, extra = {}) {
        const body = new FormData()
        body.set('file', new Blob([bytes], { type: 'application/pdf' }), 'synthetic.pdf')
        for (const [k, v] of Object.entries({
          type: 'other',
          source_class: 'synthetic',
          mode: 'new',
          expected_revision: String(revision),
          ...extra,
        }))
          body.set(k, String(v))
        return body
      }
      function upload(auth, key, body = form(), csrf = auth.csrf) {
        return fetch(base + '/cases/' + caseId + '/documents', {
          method: 'POST',
          headers: {
            cookie: auth.cookie,
            origin: config.frontendOrigin,
            'x-csrf-token': csrf,
            'idempotency-key': key,
          },
          body,
        })
      }
      let accepted
      async function mutate(route, body, key = randomUUID()) {
        const r = await fetch(base + route, {
          method: 'POST',
          headers: {
            cookie: member.cookie,
            origin: config.frontendOrigin,
            'x-csrf-token': member.csrf,
            'idempotency-key': key,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        })
        return { status: r.status, body: await r.json(), headers: r.headers }
      }
      await t.test(
        'both core cases created through HTTP and independently review/request/approve/export with FHI disabled',
        async () => {
          for (const kind of ['RECEIVABLE', 'PREPAYMENT']) {
            const created = await mutate('/cases', {
              counterparty_id: cp,
              exposure_kind: kind,
              lifecycle_stage: 'active',
              exposure: {
                amount_vnd: '100000000',
                term_days: 30,
                organization_role: kind === 'RECEIVABLE' ? 'seller' : 'buyer',
                counterparty_role: kind === 'RECEIVABLE' ? 'buyer' : 'seller',
                contract_ref: null,
                conditions: [],
                source_origin: 'staff_entered',
              },
            })
            assert.equal(created.status, 201, JSON.stringify(created.body))
            validateContract('Case', created.body)
            const review = await mutate('/cases/' + created.body.id + '/review-runs', {
              expected_revision: 1,
            })
            assert.equal(review.status, 201, JSON.stringify(review.body))
            validateContract('ReviewRun', review.body)
            assert.equal(review.body.financial_health.score, null)
            const finding = review.body.findings.find((f) => f.issue_key === 'transaction_contract')
            const draft = await mutate('/cases/' + created.body.id + '/requests', {
              expected_revision: 2,
              run_id: review.body.id,
              issue_id: finding.id,
              purpose: 'Synthetic request',
              content: 'Provide contract',
              document_types: ['contract'],
            })
            assert.equal(draft.status, 201, JSON.stringify(draft.body))
            validateContract('DocumentRequest', draft.body)
            const approved = await mutate('/requests/' + draft.body.id + '/approve', {
              expected_revision: 3,
              reason: 'Request source only',
            })
            assert.equal(approved.status, 200, JSON.stringify(approved.body))
            validateContract('DocumentRequest', approved.body)
            const exported = await fetch(base + '/requests/' + draft.body.id + '/export', {
              headers: { cookie: member.cookie },
            })
            assert.equal(exported.status, 200)
            assert.equal(JSON.parse(await exported.text()).request_id, draft.body.id)
            const questionnaireInput = {
              expected_revision: 4,
              reason: 'Supplementary optional question',
              questions: [{ label: 'Synthetic operating experience?' }],
            }
            const questionnaireKey = randomUUID()
            const form = await mutate(
              '/cases/' + created.body.id + '/questionnaires',
              questionnaireInput,
              questionnaireKey,
            )
            assert.equal(form.status, 201, JSON.stringify(form.body))
            validateContract('Questionnaire', form.body)
            assert.deepEqual(
              (
                await mutate(
                  '/cases/' + created.body.id + '/questionnaires',
                  questionnaireInput,
                  questionnaireKey,
                )
              ).body,
              form.body,
            )
            const responseInput = {
              expected_revision: 5,
              reason: 'Record source declaration',
              question_id: form.body.questions[0].id,
              question_version: 1,
              answer_state: 'submitted',
              answer_json: 'Synthetic statement; not verified payment',
              reported_by: 'counterparty',
              reported_reference: 'Synthetic reporter',
              source_refs: [],
            }
            const answer = await mutate(
              '/questionnaires/' + form.body.id + '/staff-responses',
              responseInput,
            )
            assert.equal(answer.status, 201, JSON.stringify(answer.body))
            validateContract('StaffResponse', answer.body)
            assert.equal(answer.body.verification_status, 'unverified')
            const verified = await mutate('/responses/' + answer.body.id + '/verification', {
              expected_revision: 6,
              response_revision: 1,
              reason: 'Keep declaration unverified pending evidence',
              status: 'unverified',
              evidence_refs: [],
            })
            assert.equal(verified.status, 201, JSON.stringify(verified.body))
            validateContract('ResponseVerificationOutput', verified.body)
            const getForm = await fetch(base + '/questionnaires/' + form.body.id, {
              headers: { cookie: member.cookie },
            })
            assert.equal(getForm.status, 200)
            assert.equal((await getForm.json()).responses[0].origin, 'staff_transcribed')
            const outsiders = [
              ['/questionnaires/' + form.body.id, undefined],
              ['/questionnaires/' + form.body.id + '/staff-responses', responseInput],
              [
                '/responses/' + answer.body.id + '/verification',
                {
                  expected_revision: 7,
                  response_revision: 1,
                  status: 'unverified',
                  reason: 'Unauthorized',
                  evidence_refs: [],
                },
              ],
            ]
            for (const [route, input] of outsiders) {
              const response = await fetch(base + route, {
                method: input ? 'POST' : 'GET',
                headers: {
                  cookie: outsider.cookie,
                  origin: config.frontendOrigin,
                  'x-csrf-token': outsider.csrf,
                  'idempotency-key': randomUUID(),
                  'content-type': 'application/json',
                },
                ...(input ? { body: JSON.stringify(input) } : {}),
              })
              assert.equal(response.status, 404)
            }
            const issueBody = {
              expected_revision: 7,
              action: 'resolve',
              reason: 'Cannot resolve without source',
              evidence_refs: [],
            }
            assert.equal(
              (await mutate('/issues/' + finding.id + '/decisions', issueBody)).body.code,
              'CURRENT_REVIEW_REQUIRED',
            )
            const recheck = await mutate('/cases/' + created.body.id + '/review-runs', {
              expected_revision: 7,
            })
            assert.equal(recheck.status, 201, JSON.stringify(recheck.body))
            assert.equal(
              (
                await mutate('/issues/' + finding.id + '/decisions', {
                  ...issueBody,
                  expected_revision: 8,
                })
              ).body.code,
              'EVIDENCE_REQUIRED',
            )
            const noCsrf = await fetch(base + '/cases/' + created.body.id + '/questionnaires', {
              method: 'POST',
              headers: {
                cookie: member.cookie,
                origin: config.frontendOrigin,
                'content-type': 'application/json',
                'idempotency-key': randomUUID(),
              },
              body: JSON.stringify({ ...questionnaireInput, expected_revision: 8 }),
            })
            assert.equal(noCsrf.status, 403)
            const noOrigin = await fetch(base + '/issues/' + finding.id + '/decisions', {
              method: 'POST',
              headers: {
                cookie: member.cookie,
                'x-csrf-token': member.csrf,
                'content-type': 'application/json',
                'idempotency-key': randomUUID(),
              },
              body: JSON.stringify({ ...issueBody, expected_revision: 8 }),
            })
            assert.equal(noOrigin.status, 403)
            const anonymous = await fetch(base + '/questionnaires/' + form.body.id)
            assert.equal(anonymous.status, 401)
            const detail = await fetch(base + '/cases/' + created.body.id, {
              headers: { cookie: member.cookie },
            })
            const workspace = await detail.json()
            assert.equal(detail.status, 200, JSON.stringify(workspace))
            validateContract('Case', workspace)
            assert.equal(workspace.questionnaires[0].responses[0].id, answer.body.id)
          }
        },
      )
      await t.test(
        'v2 native form and financial registry through actual HTTP; direct capability needs no specialist cookies',
        async () => {
          const current = await mutate('/cases', {
            counterparty_id: cp,
            exposure_kind: 'RECEIVABLE',
            lifecycle_stage: 'proposed',
            exposure: {
              amount_vnd: '100',
              term_days: 30,
              organization_role: 'seller',
              counterparty_role: 'buyer',
              contract_ref: null,
              conditions: [],
              source_origin: 'staff_entered',
            },
          })
          assert.equal(current.status, 201, JSON.stringify(current.body))
          const form = await mutate('/cases/' + current.body.id + '/questionnaires', {
            expected_revision: 1,
            reason: 'Native optional question',
            questions: [{ label: 'Synthetic direct experience?' }],
          })
          assert.equal(form.status, 201, JSON.stringify(form.body))
          const input = {
            expected_revision: 2,
            reason: 'Share native form manually',
            question_ids: form.body.questions.map((q) => q.id),
            reported_by: 'counterparty',
            recipient_reference: 'Synthetic recipient',
          }
          const key = randomUUID(),
            invitation = await mutate(
              '/questionnaires/' + form.body.id + '/invitations',
              input,
              key,
            )
          assert.equal(invitation.status, 201, JSON.stringify(invitation.body))
          const token = invitation.headers.get('x-invitation-token')
          assert.match(token, /^[A-Za-z0-9_-]{43}$/)
          const replay = await mutate(
            '/questionnaires/' + form.body.id + '/invitations',
            input,
            key,
          )
          assert.equal(replay.headers.get('x-invitation-token'), null)
          assert.deepEqual(replay.body, invitation.body)
          const publicForm = await fetch(base + '/respondent/form', {
            headers: { authorization: 'Bearer ' + token },
          })
          assert.equal(publicForm.status, 200)
          const publicBody = await publicForm.json()
          validateContract('RespondentForm', publicBody)
          assert.equal(publicBody.case_id, undefined)
          assert.equal(publicBody.responses, undefined)
          const directInput = {
              reported_reference: 'Self-reported contact',
              answers: [
                {
                  question_id: form.body.questions[0].id,
                  question_version: 1,
                  answer_state: 'submitted',
                  answer_json: 'Native source statement',
                  skip_reason: null,
                },
              ],
            },
            submitKey = randomUUID()
          const submit = async (body = directInput, origin = config.frontendOrigin) =>
            fetch(base + '/respondent/responses', {
              method: 'POST',
              headers: {
                authorization: 'Bearer ' + token,
                origin,
                'content-type': 'application/json',
                'idempotency-key': submitKey,
              },
              body: JSON.stringify(body),
            })
          assert.equal((await submit(directInput, 'https://foreign.invalid')).status, 403)
          assert.equal((await submit({ ...directInput, verified: true })).status, 422)
          const receipt = await submit()
          assert.equal(receipt.status, 201)
          const submitted = await receipt.json()
          validateContract('RespondentReceipt', submitted)
          assert.deepEqual(await (await submit()).json(), submitted)
          const staff = await fetch(base + '/questionnaires/' + form.body.id, {
              headers: { cookie: member.cookie },
            }),
            read = await staff.json()
          assert.equal(read.responses[0].origin, 'SME_direct')
          assert.equal(read.responses[0].entered_by, null)
          const raw = await owner.query('SELECT token_hash FROM aic.mvp_invitations WHERE id=$1', [
            invitation.body.invitation.id,
          ])
          assert.notEqual(raw.rows[0].token_hash, token)
          const revoke = await mutate('/invitations/' + invitation.body.invitation.id + '/revoke', {
            expected_revision: 4,
            reason: 'Withdraw capability',
          })
          assert.equal(revoke.status, 200, JSON.stringify(revoke.body))
          assert.equal((await submit()).status, 404)
          const financial = {
            expected_revision: 5,
            reason: 'Real HTTP financial entry',
            period: { kind: 'FY', start_date: '2025-01-01', end_date: '2025-12-31' },
            basis: 'standalone',
            accounting_regime: 'IFRS',
            currency: 'VND',
            unit_multiplier: '1',
            industry_scope: 'DISTRIBUTION_WHOLESALE_PILOT',
            observation_kind: 'actual',
            audit_status: 'unknown',
            statement_version: 'SYNTHETIC-HTTP',
            facts: [
              {
                key: 'current_assets',
                raw_value: '60',
                raw_label: 'Current assets',
                missing_reason: null,
                source: { kind: 'manual_entry', statement: 'Original synthetic entry, not a PDF' },
              },
            ],
          }
          const set = await mutate('/cases/' + current.body.id + '/financial-sets', financial)
          assert.equal(set.status, 201, JSON.stringify(set.body))
          validateContract('FinancialMutationOutput', set.body)
          const decision = await mutate('/financial-sets/' + set.body.set.id + '/verification', {
            expected_revision: 6,
            set_revision: 1,
            reason: 'Human checked original entry',
            status: 'verified',
            fact_ids: set.body.set.facts.map((f) => f.id),
            bridge_assertions: {
              quick_assets_non_overlapping: false,
              quick_assets_eligible: false,
              da_addback_to_operating_profit: false,
            },
          })
          assert.equal(decision.status, 200, JSON.stringify(decision.body))
          const ratios = await fetch(base + '/cases/' + current.body.id + '/financial-sets', {
              headers: { cookie: member.cookie },
            }),
            ratiosBody = await ratios.json()
          assert.equal(ratios.status, 200, JSON.stringify(ratiosBody))
          validateContract('FinancialRegistry', ratiosBody)
          assert.equal(ratiosBody.score, null)
          assert.equal(ratiosBody.sets[0].facts[0].verification.status, 'verified')
          assert.equal(
            (
              await fetch(base + '/cases/' + current.body.id + '/financial-sets', {
                headers: { cookie: outsider.cookie },
              })
            ).status,
            404,
          )
        },
      )
      await t.test('unsafe request and outsider rejected; no source/job side effects', async () => {
        assert.equal((await upload(member, 'csrf', form(), 'wrong')).status, 403)
        assert.equal((await upload(outsider, 'outsider')).status, 404)
        assert.equal(
          (await owner.query('SELECT count(*)::int n FROM aic.mvp_documents')).rows[0].n,
          0,
        )
      })
      await t.test(
        'native PDF inspection then atomic202; exact source hash and detail DTO',
        async () => {
          const r = await upload(member, 'upload-one')
          accepted = await r.json()
          assert.equal(r.status, 202, JSON.stringify(accepted))
          validateContract('DocumentAccepted', accepted)
          assert.equal(accepted.document.hash, sha)
          assert.equal(accepted.document.source.ai_mode, 'live')
          const source = await fetch(base + '/documents/' + accepted.document.id + '/source', {
            headers: { cookie: member.cookie },
          })
          assert.equal(source.status, 200)
          assert.deepEqual(Buffer.from(await source.arrayBuffer()), bytes)
          assert.equal(source.headers.get('cache-control'), 'no-store')
          assert.equal(source.headers.get('x-source-sha256'), sha)
          const detail = await fetch(base + '/cases/' + caseId, {
            headers: { cookie: member.cookie },
          })
          const body = await detail.json()
          assert.equal(detail.status, 200, JSON.stringify(body))
          validateContract('Case', body)
          assert.equal(body.documents.length, 1)
        },
      )
      await t.test('source/job/extraction ACL; incomplete extraction remains409', async () => {
        for (const route of [
          '/documents/' + accepted.document.id + '/source',
          '/jobs/' + accepted.job.id,
          '/documents/' + accepted.document.id + '/extraction',
        ])
          assert.equal(
            (await fetch(base + route, { headers: { cookie: outsider.cookie } })).status,
            404,
          )
        assert.equal(
          (
            await fetch(base + '/documents/' + accepted.document.id + '/extraction', {
              headers: { cookie: member.cookie },
            })
          ).status,
          409,
        )
      })
      await t.test(
        'provider stopped: frozen replay still202; mismatched key409; new intent503',
        async () => {
          ai.kill()
          await new Promise((r) => ai.once('exit', r))
          ai = undefined
          const r = await upload(member, 'upload-one')
          assert.equal(r.status, 202)
          assert.deepEqual(await r.json(), accepted)
          assert.equal((await upload(member, 'upload-one', form(2))).status, 409)
          assert.equal((await upload(member, 'upload-two', form(2))).status, 503)
          assert.equal(
            (await owner.query('SELECT count(*)::int n FROM aic.mvp_document_jobs')).rows[0].n,
            1,
          )
          assert.deepEqual(fs.readdirSync(path.join(root, 'cache')), [])
        },
      )
      await t.test('actual Nest close/recreate retains source and session', async () => {
        await app.close()
        app = await createApplication(config, true)
        await app.listen(0, '127.0.0.1')
        base = (await app.getUrl()) + '/api/v2'
        const r = await fetch(base + '/documents/' + accepted.document.id + '/source', {
          headers: { cookie: member.cookie },
        })
        assert.equal(r.status, 200)
        assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes)
      })
      await t.test(
        'actual worker uses private cache + HTTP transport + PostgreSQL publication; no live model claim',
        async () => {
          const db = app.get(DatabaseService),
            repository = app.get(PostgresDocumentRepository),
            files = new PrivateDocumentFiles(root)
          // The previously accepted live job is exercised against a stopped provider,
          // with a bounded retry budget and no silent mock fallback.
          const unavailable = new DocumentWorker(
            repository,
            files,
            new DocumentAiTransport({
              baseURL: config.aiServiceUrl,
              internalKey: key,
              expectedMode: 'live',
              contractsDirectory: path.join(project, 'packages/contracts'),
            }),
          )
          for (let i = 0; i < 3; i++)
            assert.equal(await unavailable.once('actual-unavailable-worker'), 'failed')
          const auth = await app.get(SessionService).resolve(member.cookie.split('=')[1])
          assert.equal((await repository.job(auth, accepted.job.id)).state, 'failed')
          assert.equal((await repository.job(auth, accepted.job.id)).retryable, false)
          const current = Number(
            (await owner.query('SELECT revision FROM aic.cases WHERE id=$1', [caseId])).rows[0]
              .revision,
          )
          const queued = await repository.accept(auth, caseId, 'synthetic-worker-http', {
            mode: 'new',
            type: 'other',
            sourceClass: 'synthetic',
            expectedRevision: current,
            displayName: 'worker.pdf',
            bytes,
            sha256: sha,
            pageCount: 1,
            aiMode: 'mock',
          })
          let requests = 0,
            wrongPages = false
          const server = require('node:http').createServer(async (req, res) => {
            try {
              assert.equal(req.headers['x-internal-key'], key)
              const chunks = []
              for await (const chunk of req) chunks.push(chunk)
              const input = JSON.parse(Buffer.concat(chunks).toString())
              requests++
              assert.deepEqual(fs.readFileSync(path.join(root, input.storage_key)), bytes)
              const output = {
                schema_version: '1.0.2',
                document_id: input.document_id,
                case_id: input.case_id,
                sha256: input.sha256,
                detected_type: 'other',
                classification_confident: false,
                pages: [{ page: 1, text: 'SYNTHETIC', method: 'text', width: 595, height: 842 }],
                fields: [],
                evidence: [],
                diagnostics: [],
                provenance: {
                  model_id: 'SYNTHETIC-HTTP-NOT-MODEL',
                  prompt_version: 'test',
                  ocr_version: 'none',
                  schema_version: '1.0.2',
                },
              }
              if (wrongPages) output.pages.push({ ...output.pages[0], page: 2 })
              res.writeHead(200, { 'content-type': 'application/json', 'x-ai-mode': 'mock' })
              res.end(JSON.stringify(output))
            } catch {
              res.writeHead(500)
              res.end()
            }
          })
          await new Promise((r) => server.listen(0, '127.0.0.1', r))
          try {
            const worker = new DocumentWorker(
              repository,
              files,
              new DocumentAiTransport({
                baseURL: 'http://127.0.0.1:' + server.address().port,
                internalKey: key,
                expectedMode: 'mock',
                contractsDirectory: path.join(project, 'packages/contracts'),
              }),
            )
            assert.equal(await worker.once('synthetic-http-worker'), 'published')
            assert.equal(requests, 1)
            assert.equal((await repository.job(auth, queued.body.job.id)).state, 'completed')
            const result = await fetch(
              base + '/documents/' + queued.body.document.id + '/extraction',
              { headers: { cookie: member.cookie } },
            )
            assert.equal(result.status, 200)
            assert.deepEqual(await result.json(), [])
            const raw = await fetch(
              base + '/documents/' + queued.body.document.id + '/legacy-extraction',
              { headers: { cookie: member.cookie } },
            )
            assert.equal((await raw.json()).raw.provenance.model_id, 'SYNTHETIC-HTTP-NOT-MODEL')
            const revision = (
              await owner.query('SELECT revision FROM aic.cases WHERE id=$1', [caseId])
            ).rows[0].revision
            const classified = await mutate(
              '/documents/' + queued.body.document.id + '/classification',
              {
                expected_revision: Number(revision),
                reason: 'Read synthetic page; retain unresolved subject',
                declared_type: 'other',
                subject_match: 'unresolved',
                reviewed_pages: [1],
                evidence_refs: [],
              },
            )
            assert.equal(classified.status, 200, JSON.stringify(classified.body))
            validateContract('DocumentDecisionOutput', classified.body)
            const detail = await fetch(base + '/cases/' + caseId, {
              headers: { cookie: member.cookie },
            })
            const resultBody = await detail.json()
            assert.equal(detail.status, 200, JSON.stringify(resultBody))
            validateContract('Case', resultBody)
            assert.equal(
              resultBody.documents.find((d) => d.id === queued.body.document.id).source_review
                .subject_match,
              'unresolved',
            )
            assert.deepEqual(fs.readdirSync(path.join(root, 'cache')), [])
            assert.equal(await worker.once('synthetic-http-worker'), 'idle')
            const nextRevision = Number(
              (await owner.query('SELECT revision FROM aic.cases WHERE id=$1', [caseId])).rows[0]
                .revision,
            )
            const invalid = await repository.accept(auth, caseId, 'invalid-source-pages', {
              mode: 'new',
              type: 'other',
              sourceClass: 'synthetic',
              expectedRevision: nextRevision,
              displayName: 'page-mismatch.pdf',
              bytes,
              sha256: sha,
              pageCount: 1,
              aiMode: 'mock',
            })
            wrongPages = true
            assert.equal(await worker.once('synthetic-http-worker'), 'failed')
            const rejected = await repository.job(auth, invalid.body.job.id)
            assert.equal(rejected.state, 'failed')
            assert.equal(rejected.errors[0].code, 'AI_INVALID_PROJECTION')
            assert.equal(
              (await repository.read(auth, invalid.body.document.id)).document.extraction,
              null,
            )
          } finally {
            await new Promise((r) => server.close(r))
          }
        },
      )
    } finally {
      if (app) await app.close()
      if (ai) {
        ai.kill()
        await new Promise((r) => ai.once('exit', r))
      }
      if (owner) await owner.end()
      await admin.end()
      // Retain only this test's private empty cache directory for diagnosis; no real data.
      t.diagnostic('Private synthetic cache namespace: ' + root)
      delete process.env.AIC_DOCUMENT_RUNTIME
      delete process.env.AIC_DOCUMENT_AI_MODE
    }
  },
)
