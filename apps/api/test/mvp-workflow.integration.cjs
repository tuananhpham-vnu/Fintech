const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID, randomBytes, createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { Client, Pool } = require('pg')
const { migrate } = require('../dist/database/migrate')
const { SessionService, hashPassword } = require('../dist/auth')
const { CaseMutations } = require('../dist/foundation/case-mutations')
const { CoreRepository } = require('../dist/foundation/core.repository')
const { MvpCaseService } = require('../dist/foundation/mvp-case.service')
const { MvpWorkflowService } = require('../dist/foundation/mvp-workflow.service')
const { MvpQuestionnaireService } = require('../dist/foundation/mvp-questionnaire.service')
const { MvpCapabilityService } = require('../dist/foundation/mvp-capability.service')
const { MvpCounterpartyService } = require('../dist/foundation/mvp-counterparty.service')
const { FinancialRegistry } = require('../dist/financial/financial-registry.service')
const { AssessmentService } = require('../dist/financial/assessment.service')
const { fhiMethodHash } = require('../dist/financial/fhi-policy')
const { FHI_METHOD_ID, FHI_METHOD_VERSION } = require('../dist/financial/fhi-method')
const { requestHash } = require('../dist/foundation/canonical')
const { validateContract } = require('../dist/foundation/validation')
const { PostgresDocumentRepository } = require('../dist/documents/postgres-document.repository')
const { DocumentDecisions } = require('../dist/documents/document-decisions.service')
const { createLegacyAiValidationBoundary } = require('../dist/ai-adapters/legacy-validation')

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const project = path.resolve(__dirname, '../../..')
const policy = JSON.parse(
  readFileSync(
    path.join(project, 'docs/implementation/policies/AIC-MVP-SANDBOX-2026-10-17.1.json'),
    'utf8',
  ),
)
const contractDir = path.join(project, 'packages/contracts')
const manifest = readFileSync(path.join(contractDir, 'SHA256SUMS'), 'utf8')
const boundary = createLegacyAiValidationBoundary({
  version: '1.0.2',
  sha256sums: manifest,
  files: Object.fromEntries(
    manifest
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const name = line.split(/\s+/)[1]
        return [name, readFileSync(path.join(contractDir, name))]
      }),
  ),
})
const rejects = (promise, code) =>
  assert.rejects(promise, (error) => error.getResponse?.().code === code, `Expected ${code}`)

test(
  'MVP workflow: real PostgreSQL, authenticated sessions and approved sandbox policy',
  { timeout: 120000 },
  async (t) => {
    assert.equal(
      process.env.AIC_ALLOW_LOCAL_DB_TESTS,
      'true',
      'Explicit disposable loopback opt-in required',
    )
    assert.ok(process.env.AIC_TEST_DATABASE_URL, 'Real PostgreSQL URL required; no mock fallback')
    const source = new URL(process.env.AIC_TEST_DATABASE_URL)
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname))
    const suffix = randomBytes(8).toString('hex')
    const dbName = `aic_workflow_${suffix}`,
      runtimeRole = `aic_wf_api_${suffix}`,
      workerRole = `aic_wf_worker_${suffix}`
    const password = randomBytes(32).toString('hex')
    const admin = new Client({ connectionString: source.href })
    let owner,
      pool,
      workers,
      created = false
    const roles = []
    await admin.connect()
    try {
      await admin.query(`CREATE DATABASE ${dbName}`)
      created = true
      for (const role of [runtimeRole, workerRole]) {
        await admin.query(
          `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
        )
        roles.push(role)
      }
      const ownerURL = new URL(source)
      ownerURL.pathname = '/' + dbName
      const migrated = await migrate(ownerURL.href)
      assert.ok(
        migrated.applied.some((name) => name.startsWith('0006_')),
        'Frozen workflow migration required',
      )
      owner = new Client({ connectionString: ownerURL.href })
      await owner.connect()
      // Apply the exact operator grant script with generated safe SQL identifiers.
      for (const role of roles) assert.match(role, /^[a-z0-9_]+$/)
      const grantSql = readFileSync(
        path.join(project, 'scripts/sandbox-runtime-grants.sql'),
        'utf8',
      )
        .replaceAll(':"api_role"', '"' + runtimeRole + '"')
        .replaceAll(':"worker_role"', '"' + workerRole + '"')
      await owner.query(grantSql)
      const runtimeURL = (role) => {
        const url = new URL(ownerURL)
        url.username = role
        url.password = password
        return url.href
      }
      pool = new Pool({ connectionString: runtimeURL(runtimeRole) })
      workers = new Pool({ connectionString: runtimeURL(workerRole) })
      const database = (p) => ({
        query: (sql, values) => p.query(sql, values),
        transaction: async (work) => {
          const client = await p.connect()
          try {
            await client.query('BEGIN')
            const result = await work(client)
            await client.query('COMMIT')
            return result
          } catch (error) {
            await client.query('ROLLBACK')
            throw error
          } finally {
            client.release()
          }
        },
      })
      const db = database(pool)
      const config = {
        sessionTtlMs: 3600000,
        sessionIdleMs: 3600000,
        loginMaxAttempts: 5,
        loginWindowMs: 900000,
        loginBlockMs: 900000,
        idempotencyTtlMs: 86400000,
      }
      const sessions = new SessionService(db, config)
      const core = new CoreRepository(db)
      const mutations = new CaseMutations(db, config, core)
      const cases = new MvpCaseService(db, config, core, mutations)
      const capabilities = new MvpCapabilityService(db, config, core, mutations)
      const questionnaires = new MvpQuestionnaireService(db, config, core, mutations, capabilities)
      const workflow = new MvpWorkflowService(db, config, core, mutations, questionnaires)
      const documents = new PostgresDocumentRepository(db, config)
      const decisions = new DocumentDecisions(db, documents, mutations)
      const worker = new PostgresDocumentRepository(database(workers), config)
      const identities = []
      const loginPassword = 'Synthetic-' + randomUUID()
      const encoded = await hashPassword(loginPassword)
      await owner.query(
        `INSERT INTO aic.mvp_policy_artifacts(version,sha256,artifact_json,approved_at,effective_from)
      VALUES($1,$2,$3,$4,$5)`,
        [
          policy.policy_version,
          requestHash(policy),
          policy,
          policy.approval.recorded_at,
          policy.effective_from,
        ],
      )
      for (const kind of ['RECEIVABLE', 'PREPAYMENT']) {
        const org = randomUUID(),
          user = randomUUID(),
          cp = randomUUID(),
          username = randomUUID()
        await owner.query('INSERT INTO aic.organizations(id,name) VALUES($1,$2)', [
          org,
          'SYNTHETIC WORKFLOW',
        ])
        await owner.query(
          `INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role)
        VALUES($1,$2,$3,$4,'SYNTHETIC','specialist')`,
          [user, org, username, encoded],
        )
        await owner.query(
          `INSERT INTO aic.counterparties(id,organization_id,name,country)
        VALUES($1,$2,'SYNTHETIC','VN')`,
          [cp, org],
        )
        await owner.query(
          `INSERT INTO aic.mvp_policy_assignments
        (id,organization_id,policy_version,artifact_hash,exposure_kind,effective_from)
        VALUES($1,$2,$3,$4,$5,$6)`,
          [
            randomUUID(),
            org,
            policy.policy_version,
            requestHash(policy),
            kind,
            policy.effective_from,
          ],
        )
        const login = await sessions.login(username, loginPassword, '127.0.0.1')
        const session = await sessions.resolve(login.token)
        assert.ok(session, 'Actual login/resolve, no fabricated AuthSession')
        const exposure = {
          amount_vnd: null,
          amount_missing_reason: 'Unknown synthetic amount',
          term_days: null,
          term_null_reason: 'source_missing',
          organization_role: kind === 'RECEIVABLE' ? 'seller' : 'buyer',
          counterparty_role: kind === 'RECEIVABLE' ? 'buyer' : 'seller',
          contract_ref: null,
          conditions: [],
          claims: [],
          source_origin: 'staff_entered',
        }
        const result = await cases.create(session, randomUUID(), {
          counterparty_id: cp,
          exposure_kind: kind,
          lifecycle_stage: 'active',
          exposure,
        })
        assert.equal(result.status, 201)
        assert.equal(result.body.policy_artifact_hash, requestHash(policy))
        identities.push({
          session,
          caseId: result.body.id,
          exposure,
          org,
          user,
        })
      }
      const [a, b] = identities
      const revision = async (item) => (await core.case(item.session.user, item.caseId)).revision
      await t.test(
        'company health: no exposure, real ACL/idempotency, existing FHI gates, immutable snapshots',
        async () => {
          const legacy = await core.case(a.session.user, a.caseId)
          const input = {
            schema_version: 'AIC-COMPANY-HEALTH-1',
            counterparty_id: legacy.counterparty_id,
            reason: 'SYNTHETIC technical company-health acceptance only',
          }
          assert.equal((await cases.companyCapabilities(a.session)).available, true)
          for (const extra of [
            { exposure_kind: 'RECEIVABLE' },
            { exposure: {} },
            { amount_vnd: '1' },
            { term_days: 30 },
          ])
            await rejects(
              cases.createCompany(a.session, randomUUID(), {
                ...input,
                ...extra,
              }),
              'INVALID_INPUT',
            )
          await rejects(cases.createCompany(b.session, randomUUID(), input), 'NOT_FOUND')
          const key = randomUUID(),
            pair = await Promise.all([
              cases.createCompany(a.session, key, input),
              cases.createCompany(a.session, key, input),
            ])
          assert.deepEqual(pair[0].body, pair[1].body)
          assert.equal(pair.filter((x) => x.replayed).length, 1)
          const company = pair[0].body,
            item = { ...a, caseId: company.id }
          validateContract('Workspace', company, true)
          assert.equal(company.purpose, 'company_health')
          for (const k of [
            'exposure',
            'exposure_kind',
            'lifecycle_stage',
            'policy_version',
            'policy_artifact_hash',
          ])
            assert.equal(company[k], null)
          assert.equal(
            Number(
              (
                await owner.query(
                  'SELECT count(*) AS n FROM aic.mvp_exposure_versions WHERE case_id=$1',
                  [company.id],
                )
              ).rows[0].n,
            ),
            0,
          )
          await rejects(
            cases.createCompany(a.session, key, {
              ...input,
              reason: 'Changed',
            }),
            'IDEMPOTENCY_CONFLICT',
          )
          await rejects(core.case(b.session.user, company.id), 'NOT_FOUND')
          await rejects(
            cases.update(a.session, company.id, randomUUID(), {
              expected_revision: 1,
              exposure: a.exposure,
            }),
            'TRANSACTION_WORKFLOW_REQUIRED',
          )
          await assert.rejects(
            owner.query("UPDATE aic.cases SET purpose='transaction' WHERE id=$1", [company.id]),
            (e) => e.constraint === 'cases_purpose_immutable',
          )
          await assert.rejects(
            owner.query("UPDATE aic.cases SET exposure_json='{}'::jsonb WHERE id=$1", [company.id]),
            (e) => e.constraint === 'cases_purpose_shape',
          )
          assert.deepEqual(await core.case(a.session.user, a.caseId), legacy)
          assert.equal((await workflow.detail(a.session, company.id)).transaction_review, null)
          const finance = new FinancialRegistry(db, config, core, mutations),
            service = new AssessmentService(db, config, core, mutations, finance, workflow)
          await rejects(service.run(a.session,company.id,randomUUID(),{expected_revision:await revision(item)}),'ASSESSMENT_NOT_READY')
          const blocked=await service.workspace(a.session,company.id)
          assert.ok(blocked.readiness.blockers.some(b=>b.code==='FINANCIAL_REVIEW_ALL_REQUIRED'))
          assert.equal(blocked.assessment,null)
          const values = {
            current_assets: '200',
            current_liabilities: '100',
            cash: '30',
            unrestricted_short_term_equivalents: '20',
            trade_receivables: '50',
            total_assets: '500',
            total_liabilities: '300',
            total_equity: '200',
            interest_bearing_debt: '100',
            operating_profit: '80',
            depreciation_amortization: '20',
            interest_expense: '20',
            net_revenue: '400',
            cash_from_operations: '32',
          }
          const source =
            'SYNTHETIC technical fixture only: cash 30 + distinct eligible equivalents 20 + receivables 50; EBIT 80 + D&A addback 20. Not real-company evidence or professional verification.'
          const factInput = {
            expected_revision: await revision(item),
            reason: source,
            period: {
              kind: 'FY',
              start_date: '2025-01-01',
              end_date: '2025-12-31',
            },
            basis: 'standalone',
            accounting_regime: 'VN_TT133',
            currency: 'VND',
            unit_multiplier: '1',
            industry_scope: 'UNKNOWN',
            observation_kind: 'actual',
            audit_status: 'unaudited',
            statement_version: 'synthetic-company-v1',
            facts: Object.entries(values).map(([key, raw_value]) => ({
              key,
              raw_value,
              raw_label: key,
              missing_reason: null,
              source: { kind: 'manual_entry', statement: source },
            })),
          }
          const set = (
            await finance.save(a.session, company.id, undefined, randomUUID(), factInput)
          ).body.set
          const at = '2026-01-01T00:00:00Z'
          const syntheticConfig = {
            ...config,
            fhiPolicy: {
              policy_id: 'SYNTHETIC-TEST-ONLY',
              method_id: FHI_METHOD_ID,
              method_version: FHI_METHOD_VERSION,
              method_hash: fhiMethodHash(),
              status: 'configured_pilot',
              industry_scope: 'DISTRIBUTION_WHOLESALE_PILOT',
              organization_ids: [a.org],
              approval: {
                by: 'Synthetic test fixture',
                recorded_at: at,
                source: 'Automated technical test only',
                scope: 'Disposable database only',
              },
              effective_from: at,
              effective_until: null,
            },
          }
          const configuredFinance = new FinancialRegistry(db, syntheticConfig, core, mutations),
            configured = new AssessmentService(
              db,
              syntheticConfig,
              core,
              mutations,
              configuredFinance,
              workflow,
            )
          assert.equal(
            (await configured.workspace(a.session, company.id, set.id)).readiness
              .numeric_assessment_allowed,
            false,
          )
          const verify = {
            expected_revision: await revision(item),
            set_revision: 1,
            reason: source,
            status: 'verified',
            fact_ids: set.facts.map((f) => f.id),
            bridge_assertions: {
              quick_assets_non_overlapping: false,
              quick_assets_eligible: false,
              da_addback_to_operating_profit: false,
            },
          }
          await finance.verify(a.session, set.id, randomUUID(), verify)
          assert.equal(
            (await configured.workspace(a.session, company.id, set.id)).readiness
              .numeric_assessment_allowed,
            false,
            'Facts alone must not bypass independent bridge gates',
          )
          await finance.verify(a.session, set.id, randomUUID(), {
            ...verify,
            expected_revision: await revision(item),
            bridge_assertions: {
              quick_assets_non_overlapping: true,
              quick_assets_eligible: true,
              da_addback_to_operating_profit: true,
            },
          })
          const ready = await configured.workspace(a.session, company.id, set.id)
          assert.equal(ready.readiness.numeric_assessment_allowed,false,'Individual legacy decisions cannot replace the common company review')
          await rejects(configured.run(a.session,company.id,randomUUID(),{expected_revision:await revision(item),financial_set_id:set.id}),'ASSESSMENT_NOT_READY')
          const {FinancialReviewService}=require('../dist/financial/financial-review.service')
          const {financialReviewState}=require('../dist/financial/financial-review-state')
          const state=await db.transaction(async tx=>financialReviewState(tx,await core.assertCaseAccess(tx,a.session.user,company.id,true)))
          await rejects(new FinancialReviewService(mutations,configuredFinance).confirm(a.session,company.id,randomUUID(),{
            expected_revision:await revision(item),confirmed:true,source_snapshot_hash:state.source_snapshot_hash,
            bridge_assertions:{quick_assets_non_overlapping:true,quick_assets_eligible:true,da_addback_to_operating_profit:true}
          }),'BCTC_SOURCE_REQUIRED')
          assert.equal((await configured.workspace(a.session,company.id)).assessment,null)
          const workspacePage = await core.cases(a.session.user, {})
          validateContract('WorkspacePage', workspacePage, true)
        },
      )
      const run = async (item) =>
        (
          await workflow.run(item.session, item.caseId, randomUUID(), {
            expected_revision: await revision(item),
          })
        ).body
      async function sourceDocument(item, type, label, options = {}) {
        const bytes = Buffer.from(`%PDF-1.7\nSYNTHETIC ${label}\n%%EOF`)
        const result = await documents.accept(item.session, item.caseId, randomUUID(), {
          mode: options.response ? 'response' : options.replaces ? 'replace' : 'new',
          ...(options.replaces ? { replacesDocumentId: options.replaces } : {}),
          ...(options.response ? { responseRequestId: options.response } : {}),
          type,
          sourceClass: 'synthetic',
          expectedRevision: await revision(item),
          displayName: label + '.pdf',
          bytes,
          sha256: sha(bytes),
          pageCount: 1,
          aiMode: 'mock',
        })
        const attempt = await worker.claim('synthetic-workflow-worker', 60000, 3)
        assert.equal(attempt.documentId, result.body.document.id)
        const evidenceId = randomUUID()
        const raw = {
          schema_version: '1.0.2',
          document_id: attempt.documentId,
          case_id: item.caseId,
          sha256: sha(bytes),
          detected_type: type,
          classification_confident: false,
          pages: [{ page: 1, text: label, method: 'text', width: 595, height: 842 }],
          fields: [
            {
              id: randomUUID(),
              document_id: attempt.documentId,
              field_key: 'synthetic.party_a',
              raw_value: label,
              value: label,
              quality: options.readable ? 'readable' : 'uncertain',
              evidence_ids: options.readable ? [evidenceId] : [],
              missing_reason: options.readable ? null : 'ambiguous',
            },
          ],
          evidence: [
            {
              id: evidenceId,
              document_id: attempt.documentId,
              page: 1,
              quote: label,
              bbox: null,
              precision: 'page',
            },
          ],
          diagnostics: [],
          provenance: {
            model_id: 'SYNTHETIC-NOT-LIVE',
            prompt_version: 'test',
            ocr_version: 'none',
            schema_version: '1.0.2',
          },
        }
        const validated = boundary.validate({
          operation: 'extract',
          body: raw,
          request: {
            schema_version: '1.0.2',
            document_id: attempt.documentId,
            case_id: item.caseId,
            sha256: sha(bytes),
            type,
            storage_key: 'synthetic/input.pdf',
          },
          headers: { 'x-ai-mode': 'mock' },
          expectedMode: 'mock',
        })
        assert.equal(await worker.publish(attempt, validated.body, 'mock'), true)
        const read = await documents.read(item.session, attempt.documentId)
        assert.deepEqual(read.bytes, bytes)
        return {
          ...read.document,
          bytes,
          acceptedRevision: result.body.revision,
        }
      }

      await t.test(
        'both core cases review without financial inputs or an approved FHI method',
        async () => {
          for (const item of identities) {
            const review = await run(item)
            validateContract('ReviewRun', review, true)
            assert.equal(review.case_revision, await revision(item))
            assert.equal(review.state, 'completed')
            assert.equal(review.stale, false)
            assert.notEqual(review.transaction_review.status, 'CLEAR_FOR_REVIEW')
            assert.deepEqual(review.transaction_review.findings, review.findings)
            assert.equal(review.transaction_review.verified_settlement_vnd, null)
            assert.equal(review.transaction_review.verified_outstanding_vnd, null)
            for (const key of ['score', 'band', 'grade', 'pd'])
              assert.equal(review.financial_health[key], null)
            const detail = await workflow.detail(item.session, item.caseId)
            validateContract('Readiness', detail.readiness, true)
            assert.equal(detail.readiness.document_review_allowed, true)
            assert.equal(detail.readiness.numeric_assessment_allowed, false)
          }
        },
      )

      await t.test(
        'case revision, frozen replay, concurrency, ACL and derived staleness use real locks',
        async () => {
          const expected = await revision(a),
            key = randomUUID()
          const input = { expected_revision: expected }
          const results = await Promise.all([
            workflow.run(a.session, a.caseId, key, input),
            workflow.run(a.session, a.caseId, key, input),
          ])
          assert.equal(new Set(results.map((result) => result.body.id)).size, 1)
          assert.equal(results.filter((result) => result.replayed).length, 1)
          assert.equal(await revision(a), expected + 1)
          const review = results[0].body
          await rejects(
            workflow.run(a.session, a.caseId, key, {
              expected_revision: expected + 1,
            }),
            'IDEMPOTENCY_CONFLICT',
          )
          await rejects(workflow.run(a.session, a.caseId, randomUUID(), input), 'REVISION_CONFLICT')
          await rejects(workflow.getRun(b.session, review.id), 'NOT_FOUND')
          await rejects(workflow.detail(b.session, a.caseId), 'NOT_FOUND')
          await rejects(
            workflow.run(b.session, a.caseId, randomUUID(), {
              expected_revision: expected + 1,
            }),
            'NOT_FOUND',
          )
          await sourceDocument(a, 'invoice', 'invoice-is-not-payment')
          assert.equal((await workflow.getRun(a.session, review.id)).stale, true)
          assert.deepEqual((await workflow.run(a.session, a.caseId, key, input)).body, review)
          const next = await run(a)
          assert.ok(
            next.findings.some((finding) => finding.issue_key.startsWith('invoice_not_payment:')),
          )
          assert.ok(next.findings.some((finding) => finding.category === 'source_uncertainty'))
          assert.notEqual(next.transaction_review.status, 'CLEAR_FOR_REVIEW')
          assert.ok(next.findings.every((finding) => finding.finding_state === 'open'))
        },
      )

      await t.test(
        'actual paid declaration plus invoice retains missing payment support without inferred settlement',
        async () => {
          const exposure = structuredClone(a.exposure)
          exposure.claims = [
            {
              kind: 'paid',
              event_state: 'actual',
              claimant_party: 'counterparty',
              payer_party: 'counterparty',
              payee_party: 'organization',
              currency: 'VND',
              amount_vnd: null,
              amount_missing_reason: 'Counterparty did not specify amount',
              occurred_on: null,
              planned_on: null,
              date_missing_reason: 'No date supplied',
              obligation_ref: null,
              source_refs: [{ kind: 'declaration', reported_by: 'counterparty' }],
            },
          ]
          await cases.update(a.session, a.caseId, randomUUID(), {
            expected_revision: await revision(a),
            exposure,
          })
          const review = await run(a)
          assert.ok(review.findings.some((finding) => finding.issue_key === 'paid_received_source'))
          assert.ok(
            review.findings.some((finding) => finding.issue_key.startsWith('claim_unverified:')),
          )
          assert.equal(review.transaction_review.verified_settlement_vnd, null)
          assert.equal(review.transaction_review.verified_outstanding_vnd, null)
        },
      )

      await t.test(
        'both core flows: draft/approve/frozen export, wrong type rejected, response/recheck/ack and history',
        async () => {
          for (const item of identities) {
            const review = await run(item),
              finding = review.findings.find((f) => f.issue_key === 'transaction_contract')
            assert.ok(finding)
            const draftInput = {
              expected_revision: await revision(item),
              run_id: review.id,
              issue_id: finding.id,
              purpose: 'Clarify synthetic contract',
              content: 'Provide the contract and confirm parties. Not transaction approval.',
              document_types: ['contract'],
            }
            const draft = (
              await workflow.draft(item.session, item.caseId, randomUUID(), draftInput)
            ).body
            await rejects(
              workflow.exportRequest(item.session, draft.id),
              'APPROVED_EXPORT_UNAVAILABLE',
            )
            await rejects(
              workflow.decideRequest(
                identities.find((x) => x !== item).session,
                draft.id,
                'approve',
                randomUUID(),
                { expected_revision: await revision(item), reason: 'foreign' },
              ),
              'NOT_FOUND',
            )
            const approvalInput = {
                expected_revision: await revision(item),
                reason: 'Specialist approves requesting source only.',
              },
              approvalKey = randomUUID()
            const approved = (
              await workflow.decideRequest(
                item.session,
                draft.id,
                'approve',
                approvalKey,
                approvalInput,
              )
            ).body
            validateContract('DocumentRequest', approved, true)
            const frozen = await workflow.exportRequest(item.session, draft.id)
            assert.equal(sha(frozen.bytes), frozen.hash)
            assert.equal(JSON.parse(frozen.bytes.toString()).approved_by, item.user)
            assert.deepEqual(
              (
                await workflow.decideRequest(
                  item.session,
                  draft.id,
                  'approve',
                  approvalKey,
                  approvalInput,
                )
              ).body,
              approved,
            )
            await rejects(
              workflow.decideRequest(item.session, draft.id, 'ack', randomUUID(), {
                expected_revision: await revision(item),
                reason: 'premature',
              }),
              'RECHECK_REQUIRED',
            )
            const bytes = Buffer.from('%PDF-1.7\nWRONG TYPE')
            const before = await revision(item)
            await rejects(
              documents.accept(item.session, item.caseId, randomUUID(), {
                mode: 'response',
                responseRequestId: draft.id,
                type: 'invoice',
                sourceClass: 'synthetic',
                expectedRevision: before,
                displayName: 'wrong.pdf',
                bytes,
                sha256: sha(bytes),
                pageCount: 1,
                aiMode: 'mock',
              }),
              'RESPONSE_DOCUMENT_TYPE_NOT_REQUESTED',
            )
            assert.equal(await revision(item), before)
            const response = await sourceDocument(item, 'contract', 'supplement-unverified', {
              response: draft.id,
            })
            const binding = (
              await owner.query('SELECT * FROM aic.mvp_response_bindings WHERE document_id=$1', [
                response.id,
              ])
            ).rows[0]
            assert.equal(binding.request_hash, frozen.hash)
            assert.equal(Number(binding.request_revision), approved.revision)
            await rejects(
              workflow.decideRequest(item.session, draft.id, 'ack', randomUUID(), {
                expected_revision: await revision(item),
                reason: 'no recheck',
              }),
              'RECHECK_REQUIRED',
            )
            const recheck = await run(item)
            assert.ok(
              recheck.findings.some((f) => f.issue_key === 'document_unverified:' + response.id),
            )
            assert.notEqual(recheck.transaction_review.status, 'CLEAR_FOR_REVIEW')
            await rejects(
              workflow.decideRequest(item.session, draft.id, 'ack', randomUUID(), {
                expected_revision: await revision(item),
                reason: 'Not source-reviewed yet',
              }),
              'RESPONSE_SOURCE_REVIEW_REQUIRED',
            )
            await decisions.decide(item.session, response.id, 'classification', randomUUID(), {
              expected_revision: await revision(item),
              reason: 'Read synthetic source; correct case scope only.',
              declared_type: 'contract',
              subject_match: 'match',
              reviewed_pages: [1],
              evidence_refs: [],
            })
            await run(item)
            const acknowledged = (
              await workflow.decideRequest(item.session, draft.id, 'ack', randomUUID(), {
                expected_revision: await revision(item),
                reason: 'Reviewed response; identity and facts remain unverified.',
              })
            ).body
            assert.equal(acknowledged.status, 'closed')
            assert.deepEqual(
              (await workflow.exportRequest(item.session, draft.id)).bytes,
              frozen.bytes,
            )
            assert.equal(
              (await documents.read(item.session, response.id)).document.source_verification,
              undefined,
            )
            const history = await core.history(item.session.user, item.caseId, {
              limit: '100',
            })
            assert.ok(history.items.some((e) => e.action === 'request.ack'))
            assert.equal(
              (
                await owner.query(
                  'SELECT count(*)::int n FROM aic.mvp_request_history WHERE request_id=$1',
                  [draft.id],
                )
              ).rows[0].n,
              3,
            )
          }
        },
      )
      await t.test(
        'waiver preserves missing finding and unknown facts; financial/identity conflict cannot be waived into verification',
        async () => {
          const review = await run(b),
            missing = review.findings.find((f) => f.issue_key === 'counterparty_identity_source')
          assert.ok(missing)
          const waiver = (
            await workflow.waive(b.session, b.caseId, randomUUID(), {
              expected_revision: await revision(b),
              requirement_key: missing.issue_key,
              issue_id: missing.id,
              reason: 'Provisional review only.',
            })
          ).body
          const next = await run(b),
            retained = next.findings.find((f) => f.issue_key === missing.issue_key)
          assert.equal(retained.id, missing.id)
          assert.equal(retained.finding_state, 'open')
          assert.equal(retained.handling_state, 'waived')
          assert.ok(next.findings.some((f) => f.issue_key === 'identity_pending'))
          const financial = next.findings.find((f) => f.issue_key === 'financial_minimum')
          await rejects(
            workflow.waive(b.session, b.caseId, randomUUID(), {
              expected_revision: await revision(b),
              requirement_key: 'financial_minimum',
              issue_id: financial.id,
              reason: 'attempt',
            }),
            'REQUIREMENT_NOT_WAIVABLE',
          )
          const revoked = (
            await workflow.revoke(b.session, waiver.id, randomUUID(), {
              expected_revision: await revision(b),
              reason: 'Source still required.',
            })
          ).body
          assert.equal(revoked.active, false)
          assert.equal(
            (await run(b)).findings.find((f) => f.issue_key === missing.issue_key).handling_state,
            'none',
          )
        },
      )
      await t.test(
        'source changes after draft block stale approval; cancel freezes prior export and rejects new response',
        async () => {
          let review = await run(a),
            finding = review.findings.find((f) => f.issue_key === 'counterparty_identity_source')
          const input = {
            expected_revision: await revision(a),
            run_id: review.id,
            issue_id: finding.id,
            purpose: 'Identity',
            content: 'Provide registration',
            document_types: ['registration'],
          }
          const draft = (await workflow.draft(a.session, a.caseId, randomUUID(), input)).body
          await sourceDocument(a, 'other', 'changed-source')
          await rejects(
            workflow.decideRequest(a.session, draft.id, 'approve', randomUUID(), {
              expected_revision: await revision(a),
              reason: 'stale',
            }),
            'STALE_REVIEW',
          )
          await workflow.decideRequest(a.session, draft.id, 'cancel', randomUUID(), {
            expected_revision: await revision(a),
            reason: 'Replaced by new review',
          })
          review = await run(a)
          finding = review.findings.find((f) => f.issue_key === 'counterparty_identity_source')
          const fresh = (
            await workflow.draft(a.session, a.caseId, randomUUID(), {
              ...input,
              expected_revision: await revision(a),
              run_id: review.id,
              issue_id: finding.id,
            })
          ).body
          await workflow.decideRequest(a.session, fresh.id, 'approve', randomUUID(), {
            expected_revision: await revision(a),
            reason: 'request only',
          })
          const frozen = await workflow.exportRequest(a.session, fresh.id)
          await workflow.decideRequest(a.session, fresh.id, 'cancel', randomUUID(), {
            expected_revision: await revision(a),
            reason: 'cancel',
          })
          assert.deepEqual((await workflow.exportRequest(a.session, fresh.id)).bytes, frozen.bytes)
          const bytes = Buffer.from('%PDF-1.7\nresponse to cancelled')
          await rejects(
            documents.accept(a.session, a.caseId, randomUUID(), {
              mode: 'response',
              responseRequestId: fresh.id,
              type: 'registration',
              sourceClass: 'synthetic',
              expectedRevision: await revision(a),
              displayName: 'cancelled.pdf',
              bytes,
              sha256: sha(bytes),
              pageCount: 1,
              aiMode: 'mock',
            }),
            'RESPONSE_REQUEST_NOT_APPROVED',
          )
        },
      )
      await t.test(
        'wrong-subject supplement remains blocked; exact replacement plus human source review allows limited acknowledgement',
        async () => {
          const review = await run(a),
            finding = review.findings.find((f) => f.issue_key === 'counterparty_identity_source')
          const request = (
            await workflow.draft(a.session, a.caseId, randomUUID(), {
              expected_revision: await revision(a),
              run_id: review.id,
              issue_id: finding.id,
              purpose: 'Identity source',
              content: 'Supply the correct registration',
              document_types: ['registration'],
            })
          ).body
          await workflow.decideRequest(a.session, request.id, 'approve', randomUUID(), {
            expected_revision: await revision(a),
            reason: 'Source request only',
          })
          const wrong = await sourceDocument(a, 'registration', 'wrong-subject', {
            response: request.id,
          })
          const classification = {
            expected_revision: await revision(a),
            reason: 'Read source; different entity',
            declared_type: 'registration',
            subject_match: 'mismatch',
            reviewed_pages: [1],
            evidence_refs: [],
          }
          await rejects(
            decisions.decide(b.session, wrong.id, 'classification', randomUUID(), classification),
            'NOT_FOUND',
          )
          await rejects(
            decisions.decide(a.session, wrong.id, 'classification', randomUUID(), {
              ...classification,
              reviewed_pages: [2],
            }),
            'INVALID_SOURCE_PAGE',
          )
          const key = randomUUID(),
            decision = await decisions.decide(
              a.session,
              wrong.id,
              'classification',
              key,
              classification,
            )
          assert.deepEqual(
            (await decisions.decide(a.session, wrong.id, 'classification', key, classification))
              .body,
            decision.body,
          )
          const flagged = await run(a)
          assert.ok(
            flagged.findings.some(
              (f) =>
                f.issue_key === 'document_subject_mismatch:' + wrong.id && f.severity === 'blocker',
            ),
          )
          assert.ok(flagged.findings.some((f) => f.issue_key === 'counterparty_identity_source'))
          await rejects(
            workflow.decideRequest(a.session, request.id, 'ack', randomUUID(), {
              expected_revision: await revision(a),
              reason: 'Wrong subject cannot resolve',
            }),
            'REVIEW_BLOCKED',
          )
          const correct = await sourceDocument(a, 'registration', 'correct-subject', {
            replaces: wrong.id,
          })
          assert.equal(correct.version, wrong.version + 1)
          assert.equal(correct.lineage, wrong.lineage)
          assert.deepEqual((await documents.read(a.session, wrong.id)).bytes, wrong.bytes)
          assert.equal(
            (
              await owner.query(
                'SELECT request_id FROM aic.mvp_response_bindings WHERE document_id=$1',
                [correct.id],
              )
            ).rows[0].request_id,
            request.id,
          )
          await rejects(
            decisions.decide(a.session, wrong.id, 'classification', randomUUID(), {
              ...classification,
              expected_revision: await revision(a),
            }),
            'DOCUMENT_SUPERSEDED',
          )
          await decisions.decide(a.session, correct.id, 'classification', randomUUID(), {
            ...classification,
            expected_revision: await revision(a),
            reason: 'Reviewed new version; source subject matches this case',
            subject_match: 'match',
          })
          const rawBefore = structuredClone(correct.extraction),
            field = correct.extraction.fields[0],
            source = correct.extraction.evidence[0]
          const correction = {
            expected_revision: await revision(a),
            reason: 'Human correction with exact source reference',
            field_key: 'legacy:1.0.2:' + field.field_key,
            value: 'Corrected synthetic label',
            evidence_refs: [source.id],
          }
          const verificationBody = {
            expected_revision: await revision(a),
            reason: 'Value already correct; verify without editing',
            field_key: 'legacy:1.0.2:' + field.field_key,
            evidence_refs: [source.id],
          }
          const unchanged = await decisions.decide(
            a.session,
            correct.id,
            'verification',
            randomUUID(),
            verificationBody,
          )
          assert.equal(unchanged.body.decision.value, undefined)
          assert.equal(
            (await decisions.projection(a.session, correct)).fields[0].value,
            field.value,
          )
          assert.equal(
            (await decisions.projection(a.session, correct)).fields[0].quality,
            'human_reviewed',
          )
          correction.expected_revision = await revision(a)
          await rejects(
            decisions.decide(a.session, correct.id, 'correction', randomUUID(), {
              ...correction,
              evidence_refs: [randomUUID()],
            }),
            'INVALID_DOCUMENT_EVIDENCE',
          )
          await decisions.decide(a.session, correct.id, 'correction', randomUUID(), correction)
          assert.deepEqual(
            (await documents.read(a.session, correct.id)).document.extraction,
            rawBefore,
          )
          const projected = await decisions.projection(a.session, correct)
          assert.equal(projected.fields[0].value, correction.value)
          assert.equal(projected.fields[0].raw_value, field.raw_value)
          assert.equal(projected.fields[0].quality, 'human_reviewed')
          const correctionHistory = await core.history(a.session.user, a.caseId, { limit: '100' })
          assert.ok(
            correctionHistory.items.some(
              (event) =>
                event.action === 'document.correction.reviewed' &&
                event.reason === correction.reason &&
                event.subject_refs.includes(correct.id),
            ),
          )
          const next = await run(a)
          assert.ok(
            !next.findings.some((f) => f.issue_key === 'document_subject_mismatch:' + wrong.id),
          )
          assert.ok(next.findings.some((f) => f.issue_key === 'identity_pending'))
          assert.equal(next.financial_health.score, null)
          assert.equal(
            (
              await workflow.decideRequest(a.session, request.id, 'ack', randomUUID(), {
                expected_revision: await revision(a),
                reason: 'Reviewed corrected source; entity confirmation remains separate',
              })
            ).body.status,
            'closed',
          )
          await assert.rejects(
            owner.query('DELETE FROM aic.mvp_document_decisions'),
            (error) => error.code === '55000',
          )
        },
      )
      await t.test(
        'issue resolve/dismiss/reopen preserve detector gates, exact sources, history and replay',
        async () => {
          const cp = (await core.case(a.session.user, a.caseId)).counterparty_id
          const created = await cases.create(a.session, randomUUID(), {
            counterparty_id: cp,
            exposure_kind: 'RECEIVABLE',
            lifecycle_stage: 'active',
            exposure: a.exposure,
          })
          const item = { ...a, caseId: created.body.id }
          const initial = await run(item)
          const missing = initial.findings.find((f) => f.issue_key === 'transaction_contract')
          const invoice = await sourceDocument(item, 'invoice', 'reviewed-invoice', {
            readable: true,
          })
          const classify = async (doc, subject_match = 'match') =>
            decisions.decide(item.session, doc.id, 'classification', randomUUID(), {
              expected_revision: await revision(item),
              reason: 'Synthetic human source review',
              declared_type: doc.type,
              subject_match,
              reviewed_pages: [1],
              evidence_refs: [doc.extraction.evidence[0].id],
            })
          await classify(invoice)
          await run(item)
          const issueInput = async (action, refs = [invoice.extraction.evidence[0].id]) => ({
            expected_revision: await revision(item),
            action,
            reason: 'Synthetic specialist decision',
            evidence_refs: refs,
          })
          await rejects(
            workflow.decideIssue(
              item.session,
              missing.id,
              randomUUID(),
              await issueInput('resolve'),
            ),
            'ISSUE_STILL_PRESENT',
          )
          await rejects(
            workflow.decideIssue(b.session, missing.id, randomUUID(), await issueInput('dismiss')),
            'NOT_FOUND',
          )
          const unknown = await issueInput('dismiss', [randomUUID()])
          const before = await revision(item)
          await rejects(
            workflow.decideIssue(item.session, missing.id, randomUUID(), unknown),
            'CURRENT_REVIEWED_EVIDENCE_REQUIRED',
          )
          assert.equal(await revision(item), before)
          const wrong = await sourceDocument(item, 'contract', 'wrong-contract', { readable: true })
          await classify(wrong, 'mismatch')
          const flagged = await run(item),
            mismatch = flagged.findings.find(
              (f) => f.issue_key === 'document_subject_mismatch:' + wrong.id,
            )
          await workflow.decideIssue(
            item.session,
            mismatch.id,
            randomUUID(),
            await issueInput('dismiss'),
          )
          assert.equal(
            (await workflow.detail(item.session, item.caseId)).transaction_review.status,
            'BLOCKED',
            'Dismissal cannot suppress a current identity blocker',
          )
          const correct = await sourceDocument(item, 'contract', 'correct-contract', {
            replaces: wrong.id,
            readable: true,
          })
          await classify(correct)
          const recheck = await run(item)
          assert.ok(!recheck.findings.some((f) => f.id === missing.id))
          assert.equal(recheck.issue_history.find((f) => f.id === missing.id).finding_state, 'open')
          const partial = await sourceDocument(item, 'contract', 'partial-contract')
          await classify(partial)
          await run(item)
          await rejects(
            workflow.decideIssue(
              item.session,
              missing.id,
              randomUUID(),
              await issueInput('resolve', [partial.extraction.evidence[0].id]),
            ),
            'PARTIAL_SOURCE_CANNOT_RESOLVE',
          )
          await rejects(
            workflow.decideIssue(
              item.session,
              missing.id,
              randomUUID(),
              await issueInput('resolve', [wrong.extraction.evidence[0].id]),
            ),
            'CURRENT_REVIEWED_EVIDENCE_REQUIRED',
          )
          await rejects(
            workflow.decideIssue(
              item.session,
              missing.id,
              randomUUID(),
              await issueInput('resolve'),
            ),
            'ISSUE_SOURCE_SCOPE_MISMATCH',
          )
          const input = await issueInput('resolve', [correct.extraction.evidence[0].id]),
            key = randomUUID()
          const pair = await Promise.all([
            workflow.decideIssue(item.session, missing.id, key, input),
            workflow.decideIssue(item.session, missing.id, key, input),
          ])
          assert.deepEqual(pair[0].body, pair[1].body)
          assert.equal(pair.filter((p) => p.replayed).length, 1)
          assert.equal(pair[0].body.issue.finding_state, 'verified_resolved')
          assert.equal(await revision(item), input.expected_revision + 1)
          const same = await workflow.decideIssue(item.session, missing.id, key, input)
          assert.equal(same.replayed, true)
          await rejects(
            workflow.decideIssue(item.session, missing.id, key, {
              ...input,
              reason: 'different',
            }),
            'IDEMPOTENCY_CONFLICT',
          )
          const detail = await workflow.detail(item.session, item.caseId)
          assert.ok(
            detail.findings.some((f) => f.issue_key === 'identity_pending'),
            'Unrelated uncertainty remains',
          )
          assert.equal(detail.readiness.numeric_assessment_allowed, false)
          assert.equal(
            (
              await workflow.decideIssue(
                item.session,
                missing.id,
                randomUUID(),
                await issueInput('reopen', []),
              )
            ).body.issue.finding_state,
            'open',
          )
          await workflow.decideIssue(
            item.session,
            missing.id,
            randomUUID(),
            await issueInput('dismiss', [correct.extraction.evidence[0].id]),
          )
          const altered = { ...item.exposure, contract_ref: 'changed input' }
          await cases.update(item.session, item.caseId, randomUUID(), {
            expected_revision: await revision(item),
            exposure: altered,
          })
          await rejects(
            workflow.decideIssue(
              item.session,
              missing.id,
              randomUUID(),
              await issueInput('reopen', []),
            ),
            'CURRENT_REVIEW_REQUIRED',
          )
          const refreshed = await run(item)
          assert.equal(
            refreshed.issue_history.find((f) => f.id === missing.id).finding_state,
            'open',
            'Source/input change invalidates old disposition',
          )
          await assert.rejects(
            owner.query('DELETE FROM aic.mvp_issue_decisions'),
            (e) => e.code === '55000',
          )
          await assert.rejects(
            pool.query('UPDATE aic.mvp_issue_decisions SET reason=$1', ['tamper']),
            (e) => e.code === '42501',
          )
        },
      )
      await t.test(
        'optional questionnaires: real declarations, skip policy, exact revision verification and stale invalidation',
        async () => {
          for (const item of identities) {
            const key = randomUUID(),
              input = {
                expected_revision: await revision(item),
                reason: 'Ask supplementary question',
                questions: [{ label: 'Synthetic payment experience?' }],
              }
            const pair = await Promise.all([
              questionnaires.create(item.session, item.caseId, key, input),
              questionnaires.create(item.session, item.caseId, key, input),
            ])
            assert.equal(pair.filter((p) => p.replayed).length, 1)
            assert.deepEqual(pair[0].body, pair[1].body)
            const form = pair[0].body,
              question = form.questions[0]
            assert.equal(question.requiredness, 'optional')
            assert.equal(question.allowed_to_skip, true)
            await rejects(
              questionnaires.create(item.session, item.caseId, randomUUID(), {
                ...input,
                questions: [{ label: 'override', requiredness: 'required' }],
              }),
              'INVALID_INPUT',
            )
            const answer = {
              expected_revision: await revision(item),
              reason: 'Record original declaration',
              question_id: question.id,
              question_version: 1,
              answer_state: 'submitted',
              answer_json: 'Reported experience; not verified payment',
              reported_by: 'counterparty',
              reported_reference: 'Synthetic CP contact',
              source_refs: [],
            }
            for (const injected of [
              { origin: 'SME_direct' },
              { entered_by: randomUUID() },
              { verification: 'verified' },
            ])
              await rejects(
                questionnaires.respond(item.session, form.id, randomUUID(), {
                  ...answer,
                  ...injected,
                }),
                'INVALID_INPUT',
              )
            await rejects(
              questionnaires.respond(item.session, form.id, randomUUID(), {
                ...answer,
                question_id: randomUUID(),
              }),
              'QUESTION_SCOPE_MISMATCH',
            )
            await rejects(
              questionnaires.respond(item.session, form.id, randomUUID(), {
                ...answer,
                reason: ' ',
                answer_state: 'skipped',
                answer_json: null,
              }),
              'INVALID_INPUT',
            )
            await rejects(
              questionnaires.respond(item.session, form.id, randomUUID(), {
                ...answer,
                source_refs: [randomUUID()],
              }),
              'CURRENT_CASE_EVIDENCE_REQUIRED',
            )
            const responseKey = randomUUID(),
              response = await questionnaires.respond(item.session, form.id, responseKey, answer)
            assert.equal(response.body.origin, 'staff_transcribed')
            assert.equal(response.body.entered_by, item.user)
            assert.equal(response.body.verification_status, 'unverified')
            assert.ok(response.body.id && response.body.created_at)
            assert.deepEqual(
              (await questionnaires.respond(item.session, form.id, responseKey, answer)).body,
              response.body,
            )
            const other = item === a ? b : a
            await rejects(questionnaires.get(other.session, form.id), 'NOT_FOUND')
            await rejects(
              questionnaires.respond(other.session, form.id, randomUUID(), answer),
              'NOT_FOUND',
            )
            const verify = async (
              status,
              refs = [],
              response_revision = response.body.revision,
            ) => ({
              expected_revision: await revision(item),
              response_revision,
              status,
              reason: 'Compare original response with source',
              evidence_refs: refs,
            })
            await rejects(
              questionnaires.verify(
                item.session,
                response.body.id,
                randomUUID(),
                await verify('verified'),
              ),
              'EVIDENCE_REQUIRED',
            )
            const doc = await sourceDocument(item, 'other', 'supporting-source-' + item.org, {
              readable: true,
            })
            const evidence = doc.extraction.evidence[0].id
            await rejects(
              questionnaires.verify(
                item.session,
                response.body.id,
                randomUUID(),
                await verify('verified', [evidence]),
              ),
              'CURRENT_CASE_EVIDENCE_REQUIRED',
            )
            await decisions.decide(item.session, doc.id, 'classification', randomUUID(), {
              expected_revision: await revision(item),
              reason: 'Inspect actual source for this case',
              declared_type: 'other',
              subject_match: 'match',
              reviewed_pages: [1],
              evidence_refs: [evidence],
            })
            const oldReview = await run(item)
            const verification = await questionnaires.verify(
              item.session,
              response.body.id,
              randomUUID(),
              await verify('verified', [evidence]),
            )
            assert.equal(verification.body.actor_id, item.user)
            assert.equal(
              (await questionnaires.get(item.session, form.id)).responses[0].verification_status,
              'verified',
            )
            assert.equal((await workflow.getRun(item.session, oldReview.id)).stale, true)
            const newAnswer = await questionnaires.respond(item.session, form.id, randomUUID(), {
              ...answer,
              expected_revision: await revision(item),
              answer_json: 'Corrected original statement',
            })
            assert.equal(newAnswer.body.id, response.body.id)
            assert.equal(newAnswer.body.revision, 2)
            assert.equal(newAnswer.body.verification_status, 'unverified')
            await rejects(
              questionnaires.verify(
                item.session,
                response.body.id,
                randomUUID(),
                await verify('verified', [evidence], 1),
              ),
              'STALE_RESPONSE',
            )
            await questionnaires.verify(
              item.session,
              response.body.id,
              randomUUID(),
              await verify('verified', [evidence], 2),
            )
            await cases.update(item.session, item.caseId, randomUUID(), {
              expected_revision: await revision(item),
              exposure: {
                ...item.exposure,
                contract_ref: 'changed after verification',
              },
            })
            const stale = (await questionnaires.get(item.session, form.id)).responses[0]
            assert.equal(stale.verification_status, 'unverified')
            assert.equal(stale.verification_stale, true)
            const skipped = await questionnaires.respond(item.session, form.id, randomUUID(), {
              ...answer,
              expected_revision: await revision(item),
              answer_state: 'skipped',
              answer_json: null,
              reason: 'Reporter declined to answer',
            })
            assert.equal(skipped.body.revision, 3)
            await rejects(
              questionnaires.verify(
                item.session,
                response.body.id,
                randomUUID(),
                await verify('verified', [evidence], 3),
              ),
              'SKIPPED_RESPONSE_NOT_VERIFIABLE',
            )
            const currentReview = await run(item)
            assert.equal(currentReview.financial_health.score, null)
            assert.equal(currentReview.transaction_review.verified_settlement_vnd, null)
            assert.ok(
              (await workflow.detail(item.session, item.caseId)).questionnaires.some(
                (q) => q.id === form.id,
              ),
            )
            const stored = (
              await owner.query(
                'SELECT * FROM aic.mvp_staff_responses WHERE id=$1 ORDER BY revision',
                [response.body.id],
              )
            ).rows
            assert.equal(stored.length, 3)
            assert.equal(stored[0].answer_json, answer.answer_json)
          }
          await assert.rejects(
            owner.query('TRUNCATE aic.mvp_staff_responses CASCADE'),
            (e) => e.code === '55000',
          )
          await assert.rejects(
            pool.query('UPDATE aic.mvp_response_verifications SET status=$1', ['verified']),
            (e) => e.code === '42501',
          )
        },
      )
      await t.test(
        'native capability form: hash-only token, exact questions, direct origin, replay, reissue/revoke/expiry/close races',
        async () => {
          const item = b
          const form = (
            await questionnaires.create(item.session, item.caseId, randomUUID(), {
              expected_revision: await revision(item),
              reason: 'Native form test',
              questions: [{ label: 'Scoped question1' }, { label: 'Scoped question2' }],
            })
          ).body
          const createBody = async (recipient = 'Synthetic recipient') => ({
            expected_revision: await revision(item),
            reason: 'Manually share local scoped form',
            question_ids: form.questions.map((q) => q.id),
            reported_by: 'counterparty',
            recipient_reference: recipient,
          })
          const key = randomUUID(),
            input = await createBody(),
            created = await capabilities.create(item.session, form.id, key, input)
          assert.match(created.rawToken, /^[A-Za-z0-9_-]{43}$/)
          const token = created.rawToken
          const replay = await capabilities.create(item.session, form.id, key, input)
          assert.equal(replay.rawToken, undefined)
          assert.deepEqual(replay.body, created.body)
          const stored = (
            await owner.query('SELECT token_hash FROM aic.mvp_invitations WHERE id=$1', [
              created.body.invitation.id,
            ])
          ).rows[0]
          assert.equal(stored.token_hash, sha(Buffer.from(token)))
          const replayJson = JSON.stringify(
            (await owner.query('SELECT response_body FROM aic.idempotency_keys')).rows,
          )
          assert.ok(!replayJson.includes(token))
          const publicForm = await capabilities.form(token, 'synthetic-client')
          assert.deepEqual(
            publicForm.questions.map((q) => q.id),
            input.question_ids,
          )
          for (const field of [
            'case_id',
            'organization_id',
            'responses',
            'invitations',
            'score',
            'internal_notes',
          ])
            assert.equal(publicForm[field], undefined)
          await rejects(
            capabilities.form(randomBytes(32).toString('base64url'), 'synthetic-client'),
            'NOT_FOUND',
          )
          const answers = {
            reported_reference: 'Self-reported name',
            answers: form.questions.map((q, i) => ({
              question_id: q.id,
              question_version: 1,
              answer_state: i ? 'skipped' : 'submitted',
              answer_json: i ? null : 'Original direct statement',
              skip_reason: i ? 'Prefer not to answer' : null,
            })),
          }
          for (const bad of [
            { ...answers, verified: true },
            { ...answers, case_id: a.caseId },
            { ...answers, answers: [answers.answers[0], answers.answers[0]] },
            {
              ...answers,
              answers: [{ ...answers.answers[0], question_id: randomUUID() }, answers.answers[1]],
            },
            {
              ...answers,
              answers: [answers.answers[0], { ...answers.answers[1], skip_reason: ' ' }],
            },
          ])
            await assert.rejects(capabilities.submit(token, 'synthetic-client', randomUUID(), bad))
          const submitKey = randomUUID(),
            before = await revision(item)
          const pair = await Promise.all([
            capabilities.submit(token, 'synthetic-client', submitKey, answers),
            capabilities.submit(token, 'synthetic-client', submitKey, answers),
          ])
          assert.deepEqual(pair[0], pair[1])
          assert.equal(await revision(item), before + 1)
          await rejects(
            capabilities.submit(token, 'synthetic-client', randomUUID(), answers),
            'IDEMPOTENCY_CONFLICT',
          )
          await rejects(
            capabilities.submit(token, 'synthetic-client', submitKey, {
              ...answers,
              reported_reference: 'changed',
            }),
            'IDEMPOTENCY_CONFLICT',
          )
          assert.deepEqual((await capabilities.form(token, 'synthetic-client')).receipt, pair[0])
          const read = await questionnaires.get(item.session, form.id)
          assert.equal(read.state, 'published')
          assert.equal(read.responses.length, 2)
          for (const r of read.responses) {
            assert.equal(r.origin, 'SME_direct')
            assert.equal(r.entered_by, null)
            assert.equal(r.invitation_id, created.body.invitation.id)
            assert.equal(r.verification_status, 'unverified')
          }
          const source = read.responses.find((r) => r.answer_state === 'submitted')
          const claim = {
            kind: 'paid',
            event_state: 'actual',
            claimant_party: 'organization',
            payer_party: 'organization',
            payee_party: 'counterparty',
            currency: 'VND',
            amount_vnd: '100',
            amount_missing_reason: null,
            occurred_on: null,
            planned_on: null,
            date_missing_reason: 'Date not supplied',
            obligation_ref: null,
            source_refs: [
              {
                kind: 'questionnaire',
                reported_by: 'counterparty',
                questionnaire_id: form.id,
                question_id: source.question_id,
                response_id: source.id,
                response_revision: source.revision,
              },
            ],
          }
          // PREPAYMENT paid must be reported by organization, not CP. Use received
          // instead: unverified questionnaire never becomes a confirmed settlement.
          claim.kind = 'received'
          claim.claimant_party = 'counterparty'
          const exposure = { ...item.exposure, claims: [claim] }
          const saved = await cases.update(item.session, item.caseId, randomUUID(), {
            expected_revision: await revision(item),
            exposure,
          })
          assert.equal(saved.body.exposure.claims[0].source_refs[0].origin, 'SME_direct')
          assert.equal(saved.body.exposure.claims[0].verification, 'unverified')
          const binding = (
            await owner.query(
              "SELECT * FROM aic.mvp_exposure_source_bindings WHERE case_id=$1 AND exposure_revision=$2 AND source_kind='questionnaire'",
              [item.caseId, saved.body.revision],
            )
          ).rows[0]
          const insert = `INSERT INTO aic.mvp_exposure_source_bindings(organization_id,case_id,exposure_revision,binding_id,source_kind,source_id,reported_by,response_revision,questionnaire_id,question_id) VALUES($1,$2,$3,$4,'questionnaire',$5,$6,$7,$8,$9)`
          const values = [
            binding.organization_id,
            binding.case_id,
            binding.exposure_revision,
            randomUUID(),
            binding.source_id,
            binding.reported_by,
            binding.response_revision,
            binding.questionnaire_id,
            binding.question_id,
          ]
          await assert.rejects(
            owner.query(
              insert,
              values.map((v, i) => (i === 6 ? null : v)),
            ),
            (e) => e.code === '23514',
          )
          await assert.rejects(
            owner.query(
              insert,
              values.map((v, i) => (i === 8 ? randomUUID() : v)),
            ),
            (e) => e.code === '23503',
          )
          assert.equal((await run(item)).transaction_review.verified_settlement_vnd, null)
          await questionnaires.respond(item.session, form.id, randomUUID(), {
            expected_revision: await revision(item),
            reason: 'Correct source declaration',
            question_id: source.question_id,
            question_version: 1,
            answer_state: 'submitted',
            answer_json: 'New version',
            reported_by: 'counterparty',
            reported_reference: 'Staff reporter',
            source_refs: [],
          })
          await rejects(
            cases.update(item.session, item.caseId, randomUUID(), {
              expected_revision: await revision(item),
              exposure,
            }),
            'INVALID_QUESTIONNAIRE_SOURCE',
          )
          const next = await capabilities.create(
            item.session,
            form.id,
            randomUUID(),
            await createBody(),
          )
          await rejects(capabilities.form(token, 'synthetic-client'), 'NOT_FOUND')
          const race = await Promise.allSettled([
            capabilities.revoke(item.session, next.body.invitation.id, randomUUID(), {
              expected_revision: await revision(item),
              reason: 'Withdraw invitation',
            }),
            capabilities.submit(next.rawToken, 'synthetic-client', randomUUID(), answers),
          ])
          assert.ok(race.some((r) => r.status === 'fulfilled'))
          // If submit won, the revision-bound revoke conflicts; repeat with the
          // current revision before asserting the post-revocation capability.
          if (race[0].status === 'rejected')
            await capabilities.revoke(item.session, next.body.invitation.id, randomUUID(), {
              expected_revision: await revision(item),
              reason: 'Revoke after concurrent submit',
            })
          await rejects(capabilities.form(next.rawToken, 'synthetic-client'), 'NOT_FOUND')
          const expired = await capabilities.create(
            item.session,
            form.id,
            randomUUID(),
            await createBody('Expire synthetic'),
          )
          await owner.query('BEGIN')
          await owner.query(
            'ALTER TABLE aic.mvp_invitations DISABLE TRIGGER mvp_invitations_immutable',
          )
          await owner.query(
            "UPDATE aic.mvp_invitations SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
            [expired.body.invitation.id],
          )
          await owner.query(
            'ALTER TABLE aic.mvp_invitations ENABLE TRIGGER mvp_invitations_immutable',
          )
          await owner.query('COMMIT')
          await rejects(
            capabilities.submit(expired.rawToken, 'synthetic-client', randomUUID(), answers),
            'NOT_FOUND',
          )
          const final = await capabilities.create(
            item.session,
            form.id,
            randomUUID(),
            await createBody('Closing test'),
          )
          await capabilities.close(item.session, form.id, randomUUID(), {
            expected_revision: await revision(item),
            reason: 'Close form explicitly',
          })
          await rejects(capabilities.form(final.rawToken, 'synthetic-client'), 'NOT_FOUND')
          await rejects(
            capabilities.create(item.session, form.id, randomUUID(), await createBody()),
            'QUESTIONNAIRE_CLOSED',
          )
          const limited = new MvpCapabilityService(
            db,
            { ...config, respondentRequestsPerMinute: 1 },
            core,
            mutations,
          )
          await rejects(limited.form('bad', 'rate-test'), 'NOT_FOUND')
          await rejects(limited.form('bad', 'rate-test'), 'CAPABILITY_RATE_LIMIT')
          await assert.rejects(
            pool.query('DELETE FROM aic.mvp_invitations'),
            (e) => e.code === '42501',
          )
          await assert.rejects(
            owner.query('DELETE FROM aic.mvp_respondent_submissions'),
            (e) => e.code === '55000',
          )
        },
      )
      await t.test(
        'counterparty source revision makes dependent review stale without granting organization-wide case rights',
        async () => {
          const item = a,
            before = await run(item)
          const current = await core.case(item.session.user, item.caseId),
            cp = await core.counterparty(item.session.user, current.counterparty_id)
          const service = new MvpCounterpartyService(db, config)
          await service.update(item.session, cp.id, randomUUID(), {
            name: cp.name,
            country: cp.country,
            tax_id: cp.tax_id,
            industry_code: cp.industry_code,
            expected_revision: cp.revision,
            source: {
              kind: 'declaration',
              reported_by: 'organization',
              reported_reference: 'Synthetic source',
              statement: 'Revised counterparty information',
            },
            reason: 'Source change invalidates prior conclusions',
          })
          assert.equal((await workflow.getRun(item.session, before.id)).stale, true)
          assert.equal((await workflow.detail(item.session, item.caseId)).review_stale, true)
          assert.equal((await run(item)).stale, false)
        },
      )
      await t.test(
        'financial registry: versioned scope/raw decimals/normalization, human verification, immutable evidence and gated metrics',
        async () => {
          const cp = (await core.case(a.session.user, a.caseId)).counterparty_id
          const created = await cases.create(a.session, randomUUID(), {
            counterparty_id: cp,
            exposure_kind: 'RECEIVABLE',
            lifecycle_stage: 'proposed',
            exposure: a.exposure,
          })
          const item = { ...a, caseId: created.body.id },
            finance = new FinancialRegistry(db, config, core, mutations)
          const values = {
            current_assets: '60',
            current_liabilities: '40',
            cash: '10',
            unrestricted_short_term_equivalents: '10',
            trade_receivables: '20',
            total_assets: '100',
            total_liabilities: '60',
            total_equity: '40',
            interest_bearing_debt: '50',
            operating_profit: '15',
            depreciation_amortization: '10',
            interest_expense: '5',
            net_revenue: '150',
            cash_from_operations: '20',
          }
          const input = {
            expected_revision: await revision(item),
            reason: 'Synthetic financial statement set',
            period: {
              kind: 'FY',
              start_date: '2025-01-01',
              end_date: '2025-12-31',
            },
            basis: 'standalone',
            accounting_regime: 'IFRS',
            currency: 'VND',
            unit_multiplier: '1000',
            industry_scope: 'DISTRIBUTION_WHOLESALE_PILOT',
            observation_kind: 'actual',
            audit_status: 'unaudited',
            statement_version: 'synthetic-1',
            facts: Object.entries(values).map(([key, raw_value]) => ({
              key,
              raw_value,
              raw_label: 'Original ' + key,
              missing_reason: null,
              source: {
                kind: 'manual_entry',
                statement: 'Synthetic original entry from verified manual example; not model data',
              },
            })),
          }
          for (const bad of [
            { ...input, verified: true },
            { ...input, entity_id: randomUUID() },
            {
              ...input,
              facts: [{ ...input.facts[0], normalized_decimal: '999' }],
            },
            { ...input, facts: [input.facts[0], input.facts[0]] },
            { ...input, facts: [{ ...input.facts[0], raw_value: null }] },
            { ...input, unit_multiplier: '1e6' },
            { ...input, period: { ...input.period, end_date: '2024-12-31' } },
          ])
            await assert.rejects(
              finance.save(item.session, item.caseId, undefined, randomUUID(), bad),
            )
          const key = randomUUID(),
            pair = await Promise.all([
              finance.save(item.session, item.caseId, undefined, key, input),
              finance.save(item.session, item.caseId, undefined, key, input),
            ])
          assert.equal(pair.filter((r) => r.replayed).length, 1)
          assert.deepEqual(pair[0].body, pair[1].body)
          const set = pair[0].body.set
          assert.equal(set.scope.entity_id, cp)
          assert.equal(set.scope.country, 'VN')
          assert.equal(
            set.facts.find((f) => f.key === 'operating_profit').normalized_decimal,
            '15000',
          )
          assert.ok(set.facts.every((f) => f.verification.status === 'unverified'))
          await rejects(finance.get(b.session, item.caseId), 'NOT_FOUND')
          const before = await finance.get(item.session, item.caseId)
          await rejects(finance.trends(b.session, item.caseId), 'NOT_FOUND')
          const unverifiedTrend = await finance.trends(item.session, item.caseId, set.id)
          assert.equal(unverifiedTrend.contract_version, 'AIC-FINANCIAL-TRENDS-1')
          assert.ok(unverifiedTrend.rows[0].facts.every((f) => f.value === null))
          assert.equal(unverifiedTrend.rows[0].set.id, set.id)
          assert.equal(before.score, null)
          assert.ok(before.metrics.every((m) => m.status === 'unavailable'))
          const verify = {
            expected_revision: await revision(item),
            set_revision: 1,
            reason: 'Human checked original entries and bridges',
            status: 'verified',
            fact_ids: set.facts.map((f) => f.id),
            bridge_assertions: {
              quick_assets_non_overlapping: true,
              quick_assets_eligible: true,
              da_addback_to_operating_profit: true,
            },
          }
          const vk = randomUUID(),
            verified = await finance.verify(item.session, set.id, vk, verify)
          assert.ok(verified.body.set.facts.every((f) => f.verification.status === 'verified'))
          assert.deepEqual(
            (await finance.verify(item.session, set.id, vk, verify)).body,
            verified.body,
          )
          const result = await finance.get(item.session, item.caseId)
          for (const field of ['score', 'band', 'grade', 'pd']) assert.equal(result[field], null)
          assert.equal(result.method_status, 'unconfigured')
          assert.equal(result.metrics.filter((m) => m.status === 'available').length, 7)
          assert.equal(result.metrics[0].raw_ratio.decimal, '1.5')
          assert.ok(result.metrics.every((m) => m.points === null))
          const trend = await finance.trends(item.session, item.caseId, set.id)
          assert.deepEqual(trend.rows[0].comparison_issues, [])
          assert.equal(trend.rows[0].facts.find((f) => f.key === 'net_revenue').value, '150000')
          assert.equal(trend.rows[0].metrics.filter((m) => m.status === 'available').length, 7)
          assert.deepEqual(trend.baseline_metrics, result.metrics)
          assert.equal(await revision(item), trend.case_revision)
          const fresh = new FinancialRegistry(db, config, core, mutations)
          assert.deepEqual(await fresh.get(item.session, item.caseId), result)
          const revised = await finance.revise(item.session, set.id, randomUUID(), {
            ...input,
            expected_revision: await revision(item),
            facts: input.facts.map((f) =>
              f.key === 'cash_from_operations' ? { ...f, raw_value: '-15' } : f,
            ),
          })
          assert.equal(revised.body.set.revision, 2)
          assert.ok(revised.body.set.facts.every((f) => f.verification.status === 'unverified'))
          await rejects(
            finance.verify(item.session, set.id, randomUUID(), {
              ...verify,
              expected_revision: await revision(item),
            }),
            'STALE_FINANCIAL_SET',
          )
          const unknown = await finance.revise(item.session, set.id, randomUUID(), {
            ...input,
            expected_revision: await revision(item),
            facts: [
              {
                ...input.facts[0],
                raw_value: null,
                missing_reason: 'Source unavailable',
              },
            ],
          })
          assert.equal(unknown.body.set.facts[0].normalized_decimal, null)
          const doc = await sourceDocument(item, 'financial_statement', 'financial-exact-quote', {
              readable: true,
            }),
            e = doc.extraction.evidence[0]
          const sourcedInput = {
            ...input,
            expected_revision: await revision(item),
            facts: [
              {
                ...input.facts[0],
                source: {
                  kind: 'document',
                  document_id: doc.id,
                  document_version: doc.version,
                  source_hash: doc.hash,
                  page: 1,
                  quote: e.quote,
                  evidence_ref: e.id,
                },
              },
            ],
          }
          await rejects(
            finance.revise(item.session, set.id, randomUUID(), {
              ...sourcedInput,
              facts: [
                {
                  ...sourcedInput.facts[0],
                  source: {
                    ...sourcedInput.facts[0].source,
                    quote: 'fabricated quote',
                  },
                },
              ],
            }),
            'INVALID_FINANCIAL_SOURCE',
          )
          const sourced = await finance.revise(item.session, set.id, randomUUID(), sourcedInput)
          const sv = {
            ...verify,
            expected_revision: await revision(item),
            set_revision: sourced.body.set.revision,
            fact_ids: sourced.body.set.facts.map((f) => f.id),
          }
          await rejects(
            finance.verify(item.session, set.id, randomUUID(), sv),
            'FINANCIAL_SOURCE_REVIEW_REQUIRED',
          )
          await decisions.decide(item.session, doc.id, 'classification', randomUUID(), {
            expected_revision: await revision(item),
            reason: 'Read actual financial source page',
            declared_type: 'financial_statement',
            subject_match: 'match',
            reviewed_pages: [1],
            evidence_refs: [e.id],
          })
          await finance.verify(item.session, set.id, randomUUID(), {
            ...sv,
            expected_revision: await revision(item),
          })
          assert.equal(
            (await finance.get(item.session, item.caseId)).sets[0].facts[0].verification.status,
            'verified',
          )
          await cases.update(item.session, item.caseId, randomUUID(), {
            expected_revision: await revision(item),
            exposure: {
              ...item.exposure,
              contract_ref: 'changed dependent input',
            },
          })
          assert.equal(
            (await finance.get(item.session, item.caseId)).sets[0].facts[0].verification.status,
            'stale',
          )
          const old = (
            await owner.query(
              'SELECT payload_json FROM aic.mvp_financial_facts WHERE set_id=$1 AND set_revision=1',
              [set.id],
            )
          ).rows
          assert.equal(old.length, 14)
          assert.equal(
            old.find((f) => f.payload_json.key === 'cash_from_operations').payload_json.raw_value,
            '20',
          )
          await assert.rejects(
            owner.query('DELETE FROM aic.mvp_financial_facts'),
            (e) => e.code === '55000',
          )
          await assert.rejects(
            pool.query('UPDATE aic.mvp_financial_verifications SET status=$1', ['verified']),
            (e) => e.code === '42501',
          )
          const second = await finance.save(item.session, item.caseId, undefined, randomUUID(), {
            ...input,
            expected_revision: await revision(item),
            period: {
              kind: 'FY',
              start_date: '2024-01-01',
              end_date: '2024-12-31',
            },
          })
          const unselected = await finance.get(item.session, item.caseId)
          assert.equal(unselected.selected_set_id, set.id)
          assert.equal(unselected.metrics.length, 7)
          assert.ok(!unselected.blockers.includes('EXPLICIT_STATEMENT_SET_SELECTION_REQUIRED'))
          const selected = await finance.get(item.session, item.caseId, second.body.set.id)
          assert.equal(selected.selected_set_id, second.body.set.id)
          assert.equal(selected.metrics.length, 7)
          assert.ok(
            selected.metrics.every((m) =>
              m.source_facts.every((f) => second.body.set.facts.some((v) => v.id === f.id)),
            ),
          )
          await rejects(finance.get(item.session, item.caseId, randomUUID()), 'NOT_FOUND')
          await rejects(finance.get(b.session, item.caseId, second.body.set.id), 'NOT_FOUND')
        },
      )
    } finally {
      if (pool) await pool.end()
      if (workers) await workers.end()
      if (owner) await owner.end()
      if (created) await admin.query(`DROP DATABASE ${dbName}`)
      for (const role of roles) await admin.query(`DROP ROLE ${role}`)
      await admin.end()
    }
  },
)
