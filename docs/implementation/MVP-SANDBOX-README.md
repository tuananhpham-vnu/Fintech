# AIC MVP sandbox: setup, reproduction and acceptance

This entry point describes the implementation on local branch `duc`, not a public deployment or production certification. Keep the existing NestJS foundation and unchanged AI service/legacy contracts 1.0.2. The sandbox wire bundle is `packages/contracts/aic-foundation`, version **0.4.0-mvp-sandbox**. Runtime defaults to foundation-only; the additional operations require explicit local enablement and refuse production mode. Owner confirmed that no demo sandbox exists yet and will follow these instructions; browser acceptance still awaits the owner-launched stack.

## Prerequisites and database boundary

Use Node 22+, pnpm 11.22.0, PostgreSQL 18 and the existing Python virtual environment. Install the existing lockfile without changing dependencies. Build with `pnpm api:build` and `pnpm build`.

**Do not point the following commands at an existing user database.** An operator must create a new disposable database such as `aic_mvp_demo`, a migration/bootstrap owner and separate nonsuperuser API/worker roles. No owner credentials belong in browser configuration or Git. The agent has only run migrations against freshly allocated test clusters; no user database was migrated.

1. Supply the fresh sandbox owner's `DATABASE_URL` securely in the operator terminal. Run `node apps/api/dist/database/migrate.js`. Migrations 0001–0017 must apply; restarting the API never applies migrations automatically. After a checksum ledger exists, do not edit an applied file: add a numbered migration. New 0009 records issue decisions; 0010 records optional questionnaires, staff response revisions and source verifications. Apply the current runtime grants after migration.
2. Apply `scripts/sandbox-runtime-grants.sql` using psql variables `api_role` and `worker_role` matching the explicitly provisioned roles. It creates no roles/passwords. API permissions exclude direct user/membership mutation and policy registration. The fixed creator trigger grants only the creator's membership. Worker permissions exclude session/user reads and mutation.
3. Choose a new synthetic organization UUID, username and a non-reused password of at least16 characters. Supply `AIC_SANDBOX_BOOTSTRAP=true`, `AIC_SANDBOX_ORGANIZATION_ID`, `AIC_SANDBOX_USERNAME`, `AIC_SANDBOX_PASSWORD`, and development `NODE_ENV`, then run `node apps/api/dist/database/bootstrap-sandbox.js` with the owner connection. This insert-only command refuses an existing organization; it does not reset data. It creates two unresolved synthetic counterparties and explicit core policy assignments; **no cases or verified facts are seeded**. Remove bootstrap credentials from the terminal environment afterward.
4. Provision a new cache outside public hosting: `powershell -NoProfile -File scripts/create-private-cache.ps1 -Path <new-absolute-private-directory>`. The script never modifies an existing directory. Nest independently checks ownership, permissions, reparse points and confinement. Use that same cache as `AIC_STORAGE_DIR` in Nest and `AI_STORAGE_DIR` in the existing AI process.

The approved artifact `policies/AIC-MVP-SANDBOX-2026-10-17.1.json` has canonical JSON bytes and a companion SHA-256 file. Approval was recorded at2026-10-17T00:30:25Z from the actual owner reply. Assignments never backdate effectivity, automatically include other organizations, select drafts, or activate FHI. See `MVP-OWNER-DECISIONS.md`.

## Ordinary local launch commands

Use separate owner-controlled terminals, each in the repository root unless noted. Set secrets through the terminal/secret manager, never command-line literals saved in scripts. These are instructions for an allowed terminal, **not an alternate launcher around a tool-policy refusal**.

API terminal: set `DATABASE_URL` to the API runtime role, `AIC_RUNTIME_MODE=foundation`, `NODE_ENV=development`, `AIC_DOCUMENT_RUNTIME=local`, `AIC_DOCUMENT_AI_MODE=live`, `AIC_IDEMPOTENCY_TTL_MS=86400000`, `AIC_STORAGE_DIR`, `INTERNAL_API_KEY`, `AIC_AI_SERVICE_URL=http://127.0.0.1:8100`, `AIC_FRONTEND_ORIGIN=http://127.0.0.1:3000`, `PORT=3001`. Run:

```powershell
node apps/api/dist/main.js
```

AI terminal: set the matching `INTERNAL_API_KEY`, `AI_STORAGE_DIR` and `AI_MODE=live`; supply `GEMINI_API_KEY` securely in that server environment as documented by `services/ai/README.md`. `MODEL_ID` / `PROMPT_VERSION` follow the existing service configuration. Native inspect needs no model key; **live extraction does**. `AI_MODE=live` alone does not prove a model call. Then:

```powershell
Set-Location services/ai
../../.venv/Scripts/python.exe -m runner serve --port 8100
```

Worker terminal: use the worker database role with the same local runtime/AI/cache settings:

```powershell
node apps/api/dist/documents/run-worker.js --poll
```

Frontend terminal: set `AIC_BACKEND_URL=http://127.0.0.1:3001/api/v2` in the server environment and run the existing frontend command:

```powershell
pnpm dev --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000`. Do not expose the services publicly or enable blanket proxy trust. Browser acceptance is pending: an earlier agent Next3000 startup was rejected **“blocked by policy”**; no alternate port/tool was used to bypass it. Frontend build and direct HTTP tests are separate evidence.

## Reproducible tests

The default test launcher allocates its **own** SCRAM-authenticated PostgreSQL cluster on loopback15432. It refuses to substitute a mock database and does not connect to5432. Set `AIC_POSTGRES_BIN` only if the installed PostgreSQL binary directory differs. Test-created databases/roles are confined to that cluster. The launcher stops its own server in `finally`, removes its password file, and retains a private diagnostic cluster. No automated business/source reset is provided.

```powershell
pnpm api:test:mvp
node --test apps/api/test/document-ai-transport.cjs apps/api/test/evidence-projection.cjs
node --test scripts/tests/feasibility-runner.test.cjs scripts/tests/source-checkpoint.test.cjs
pnpm --filter @fintech/web check:aic
pnpm --filter @fintech/web typecheck
```

`document-http.integration.cjs` starts actual Nest/FastAPI TCP listeners and private storage, tests live **native PDF inspect**, then stops the provider and verifies frozen replay/provider failure. Its worker publication section uses a labelled synthetic HTTP extraction server with actual PostgreSQL/cache/transport. `mvp-workflow.integration.cjs` uses real authenticated sessions, separate API/worker roles, the exact grant script, and canonical synthetic extraction payloads; it does not prove live AI accuracy. `private-files.cjs` separately exercises the real filesystem; platform-disallowed symlink cases are reported as skips.

## Walkthrough1: RECEIVABLE

1. Log in with the provisioned sandbox specialist; select synthetic Buyer Alpha. Create RECEIVABLE, organization=seller/counterparty=buyer, VND amount and term; choose proposed or explicitly active scope. Proposed never automatically becomes active or a certified receivable.
   In the Exposure editor add paid/received claims and conditions. Unknown amount/term require explicit reasons; a staff declaration may be saved without a PDF. Paid is reported by the payer, received by the payee; roles are derived. Existing exact document/version/hash sources remain pinned, and client verification/provenance cannot be submitted. These declarations never compute verified settlement.
2. Upload `apps/web/tests/fixtures/pdf/contract.pdf` as contract, with an explicit synthetic source label. Inspect the queued/running/completed or failed state. Refresh/restart: IDs, revision and source bytes must persist. A live provider failure must remain a real failure, with no fallback to fixtures.
3. Open source and confirm version/hash/page. Classify with a reason and subject scope; inspect fields and, where supported source evidence exists, correct a field with a reason. Raw AI remains immutable; a correction is a separate human review record, not financial eligibility.
4. Run Review. Transaction Review must work with FHI unconfigured. Verify identity/financial/payment limitations remain visible; invoice alone never establishes receipt. Draft a request linked to a current finding, select its document type, approve and export. Keep the export bytes/hash.
5. Upload a response to that approved request. Wrong type must conflict; wrong subject marked by a specialist must keep the affected blocker. Replace with the correct version, review its scope, recheck and record supplement review. Read history and compare the original export/source bytes after restart. Recording a supplement review does not verify settlement or clear unrelated findings.
6. After recheck, a previously observed finding that is no longer detected appears in issue history awaiting a human decision. Resolve needs current reviewed evidence in that requirement/document lineage, readable or human-corrected complete extraction, and no diagnostics; partial/stale/wrong-case sources fail closed. Dismiss/reopen record a separate disposition and retain current detector gates and unrelated findings. General claim/identity fact verification is not opened by this route.
7. In Information create an optional text question with a reason. Use Staff entry, identify the reporting party/contact, submit a declaration or skip with a reason. Verification is separate and targets the response revision plus reviewed evidence. Edit the response to confirm old verification is reset; change sources to confirm it becomes stale. Create a scoped native invitation, share its ephemeral link manually and follow the separate respondent walkthrough below. This questionnaire cannot replace financial minimums or document requirements.

## Walkthrough2: PREPAYMENT

Repeat with synthetic Supplier Beta, organization=buyer/counterparty=seller and PREPAYMENT. Use the same document/source/request/recheck sequence; conditions and paid declarations remain distinct from verified delivery, acceptance, refund rights or payment. An unresolved delivery/refund/guarantee source stays unknown. Test a wrong-subject supplement before a corrected replacement. A permitted missing-identity-source waiver must preserve the finding and limitation; financial minimum cannot be waived into a numeric score. Revoke the waiver and recheck. Score/band/grade/pd stay null.

Counterparty create/edit now uses the existing list/dialog and real API/DB: save a source declaration/reason, preserve text identifiers and unresolved identity. A change makes old dependent reviews/jobs/source verifications stale; it grants no case access. Manual retry is available on eligible failed jobs in Documents: reason/current revision/idempotency, original3attempt maximum,24h job lifetime and300s remaining, known committed retryable outcome and current exact source. Unknown in-flight/crash/lease outcome requires reconciliation; no reset/new key/re-upload shortcut. Default automatic retries remain; the worker reads `AIC_DOCUMENT_AUTOMATIC_RETRY` (not `AIC_WORKER_AUTOMATIC_RETRY`). An operator-approved manual recovery exercise can use `AIC_DOCUMENT_AUTOMATIC_RETRY=false`. No browser acceptance is implied.

## Native respondent and financial walkthrough

Information→create optional text questions (immutable draft/version1)→create invitation selecting questions/reporting party/recipient/reason→copy the link before closing. Share manually, no email. Raw token appears only on first create, in an ephemeral response header/fragment link, never in stored JSON. Lost token cannot be re-delivered on replay: explicitly revoke/reissue. Reissue for the same form/party/recipient revokes old invitations. Changed questions use a new draft/form; issued questions never mutate silently.

Open the link in a separate browser context with **no specialist cookie**. Fragment is scrubbed immediately and token kept only in memory. Enter self-reported name/contact, answer text or select skip with reason, preview/submit and receive receipt. Reloading the original invitation link may display receipt while capability valid; sanitized history alone does not retain the secret. Specialist reads real SME_direct/entered_by null/capability provenance, verifies exact response revision with reason/reviewed evidence, or enters a staff correction creating a new revision/origin. Select exact response version in Exposure editor; it never becomes verified settlement. Test invalid/expired/revoked/closed/wrong-scope token and duplicate submit. Defaults TTL1h/budget120socket-IP requests per minute, bounded env configuration as `.env.example`; these are development settings. Token proves access only, not identity.

Assessment→financial registry: create statement set, period/FY-TTM-interim, basis/regime/currency/unit/audit/source version; enter raw decimal facts with exact document evidence or attributable manual entry. Inspect raw→normalized values. Human verification is a separate reason/source decision over selected fact revisions and quick/EBITDA bridges. Select a set explicitly if multiple; inspect formulas/source versions/ratios/anchors. Change fact/source/exposure/CP to check reset/stale and old history. No proxy/FX/annualization/period mixing. App points/score/band/grade/PD stay null. Method reference tests do not activate pilot; canonical30 artifact package is still unavailable.

## Short operator setup checklist / expected results

1. `pnpm install --frozen-lockfile`, `pnpm api:build`, `pnpm build` → compile success, no services started. Python environment follows existing AI README.
2. Operator creates a **new** DB + owner/API/worker roles; `DATABASE_URL` owner only, `node apps/api/dist/database/migrate.js` → ledger0001–0017. No existing user DB/reset.
3. `psql -v api_role=<role> -v worker_role=<role> -f scripts/sandbox-runtime-grants.sql` using the owner connection → explicit grants applied, worker has no session/user access. Insert-only bootstrap above →2unresolved counterparties,2explicit policy assignments,0cases; repeated org refuses.
4. Private cache provisioning above → new private directory; no public URL. API,AI,worker use same cache root and matching internal key; secrets stay out of source/chat.
5. Ordinary launch commands above → API listening3001, AI8100, worker polling, owner-launched Next3000. Open login; wrong credentials fail generically, valid specialist sees scoped empty cases.
6. Run both core/native/financial walkthroughs → persisted records/revisions, immutable sources/exports, actual states, no false verified facts or numeric FHI. Live provider failure remains failure. Supply only `stack ready` + local URL, never credentials, when browser acceptance can proceed.

## Security self-assessment and operational limits

- Sessions, Origin/CSRF and organization plus case membership guard every released write/read. Exact source/evidence bindings reject foreign cases/organizations. Current ACL precedes replay; expired keys409 without reuse or purge. Sessions expire/revoke in PostgreSQL.
- Canonical accepted PDF bytes live in PostgreSQL in the same durable transaction as document/version/lineage/job/revision/audit/replay. Replace never overwrites old bytes. Filesystem cache uses private UUID paths, file fsync and hard-link create-if-absent. Windows directory fsync returns EPERM: **no filesystem power-loss durability claim**.
- No cache URL is public. AI credentials remain server-only. Worker provider calls run outside database transactions, with bounded deadlines/response bytes, three attempts, a300s lease and fencing/CAS. Partial remains reserved, not inferred from null fields. Corrupt/mismatched/late outputs cannot become current facts.
- A crash before acceptance can leave only private cache staging; accepted canonical source is transactional. Re-materialization recovers missing cache from PostgreSQL. Automatic cache-orphan reconciliation/retention and disk quotas across historical versions are not implemented. Stop API/worker and investigate the private staging namespace before any operator cleanup; never delete canonical sources or reset replay state independently of business effects.
- Numeric FHI/method approval, verified settlement calculations, identity confirmation and public ingress/TLS/trusted-IP acceptance remain separate gates. Native PDF process resource isolation, backup/restore drill, public abuse controls, cache host isolation and retention policy need further work before production.
- No submission format/deadline, measured30% improvement, live model accuracy, browser video or production certification is asserted. Prepare final slides/video only against the organizer's confirmed brief and actual browser evidence; do not submit automatically.
