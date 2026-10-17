# AIC Backend audit — GitHub handoff

Audit date: 2026-10-17, Asia/Saigon. Entry point: [agent handoff](AIC_AGENT_FIX_HANDOFF.md). Publication details: [checklist](AIC_GITHUB_PUBLISH_CHECKLIST.md).

Publication update: the owner subsequently authorized all latest source on `duc`; pinned source commit **`b528225c7e39ee2476f5c117ce6113b037352fdd`** includes Backend, AI, Frontend, contracts, migrations and fixtures. `NOT_ON_REMOTE` and remote-blocker wording below are historical audit-time observations. Publication hygiene removed only the launcher's hardcoded DB/internal-key fallbacks; four no-spawn/configuration VM checks passed. BE-001 remains open for mode/role separation and BE-002 for intake topology. The original probe evidence and source fingerprint are retained with provenance; no main DB/runtime/cloud verification was added.

## Revision and evidence boundary

Audited branch `duc`, base HEAD `8b0b7ed9e983ba4a2ea4d43f79d1816eaad7dbf0`, plus the dirty worktree captured at **2026-10-17 21:52:23 +07:00**. HEAD alone contains **zero `apps/api/**` files**. Source fingerprint and drift inventory are in the handoff/checklist. None of the findings below is a claim about a running production database.

All four BE findings are **CONFIRMED at component/probe scope**, with no main-DB reproduction. P0: 0; P1: 2; P2: 2; P3: 0. No auth bypass, cross-tenant leak, source corruption or rating activation was demonstrated. `NOT_ON_REMOTE` applies to all affected BE source at the inspected remote tips. A later docs-only commit does not publish this source.

Three read-only subagents were requested; one failed on usage limit and two on revoked network permission before delivering usable findings. The lead performed the checks below directly; there is no independent three-auditor sign-off.

## Coverage matrix

| Area / actual path | Coverage | Evidence / limitation |
| --- | --- | --- |
| Session/token/password/CSRF/origin | Partial | [security.ts](../../apps/api/src/auth/security.ts), [session.guard.ts](../../apps/api/src/auth/session.guard.ts), [session.service.ts](../../apps/api/src/auth/session.service.ts) read; unique wire cookie, exact origin, timing-safe CSRF, expiry and account disable checks present. No DB login stress rerun |
| Tenant and case ACL, revocation | Partial | [core.repository.ts](../../apps/api/src/foundation/core.repository.ts), [case-mutations.ts](../../apps/api/src/foundation/case-mutations.ts), [dossier.repository.ts](../../apps/api/src/documents/dossier.repository.ts) use organization scope and active-session/case locking. Race guarantees require isolated PostgreSQL tests |
| Idempotency/revision/rollback/audit | Partial | Case mutation and dossier enqueue replay before revision check, transactions, final-session checks; no main DB writes |
| Multipart and API/proxy join | Partial | [dossiers.controller.ts](../../apps/api/src/documents/dossiers.controller.ts), [document-archives.controller.ts](../../apps/api/src/documents/document-archives.controller.ts); guards, one-file and byte caps inspected. FE proxy read only as integration context; browser not tested |
| ZIP traversal/bombs/ZIP64/metadata | Verified at parser scope | Actual Python synthetic ZIP suites ran; [demo_zip_reader.py](../../services/ai/scripts/demo_zip_reader.py) validates envelope before returning members, does not extract to disk |
| Raw 202 / durable manifests / long PDFs | Partial | Enqueue persists archive, object, revision, replay, audit in one transaction with synchronous commit. Deferred security rejection and >10-page retention are explicit. No fresh HTTP/DB intake run |
| Fencing/reclaim/retries/global quotas | Partial | Repository claim/locked/finish/inspected and [document-worker.ts](../../apps/api/src/documents/document-worker.ts) inspected. Advisory locks, DB time, finite attempts and separate dossier pool present. Cross-process DB contention not measured |
| Hash/version/evidence projection | Verified at boundary scope | Current-source contract/transport/projection tests; no foreign IDs or raw diagnostic text accepted. Persistence isolation remains Partial |
| DB schema/migrations/grants | Partial | [migrate.ts](../../apps/api/src/database/migrate.ts), migration 0018, grants reviewed statically. No DB connection or credential access in this audit; actual catalog/roles NOT VERIFIED |
| Runtime supervision / shutdown | Partial | Combined-launcher VM probes; standalone CLI source read; running API/workers never started/stopped |
| RECEIVABLE/PREPAYMENT and FHI/registry | Partial | [financial-registry.service.ts](../../apps/api/src/financial/financial-registry.service.ts), [fhi-method.ts](../../apps/api/src/financial/fhi-method.ts), workflow sources: scoped source/version/human checks, method remains unconfigured; score/rating/PD acceptance not run |
| Observability/error/privacy | Partial | [http.ts](../../apps/api/src/foundation/http.ts), transport sanitized errors and no redirects tested; no operational log or private credential inspection |
| Fresh clone / GitHub parity | Verified blocker | BE and additive contracts absent from all three live remote trees; checkpoint scope omissions reproduced below |
| Live model / actual OCR / real dossiers | Not verified | Deliberately excluded; no external transfer permission inferred |
| UI appearance / production deployment | Out of scope | Antigravity UI ownership; local document runtime explicitly refuses production |

## Executed tests

T1: `node apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit --incremental false` — exit 0; static typecheck, no build or output files.

T2: seven existing suites loaded with current TypeScript transpiled **in memory**, redirecting their `../dist/...` imports to corresponding `src/*.ts`:

```text
apps/api/test/ai-adapter-validation.cjs
apps/api/test/ai-adapter-negative.cjs
apps/api/test/ai-response-capture.cjs
apps/api/test/document-ai-transport.cjs
apps/api/test/evidence-projection.cjs
scripts/tests/source-checkpoint.test.cjs
scripts/tests/foundation-release.test.cjs
```

Actual result: **232 passed, 0 failed, 0 skipped**, exit 0, approximately 4.75 seconds test duration. Scope: UNIT + synthetic loopback HTTP transport; no Nest server, DB, cloud provider, `.env` or real document. The reproducible in-memory loader is in [handoff test recipes](AIC_AGENT_FIX_HANDOFF.md#test-recipes). This avoids treating stale `dist` as source evidence.

T3: combined launcher executed in `vm.runInNewContext`, with fake `fs`, `spawn`, environment and process hooks. Zero real processes and zero `.env` reads. Empty synthetic environment planned four children: AI live, API live, extraction live, one shared owner DB URL, **no dossier worker**. Explicit synthetic `AI_MODE=mock` and `AIC_DOCUMENT_AI_MODE=mock` still produced API/worker live versus AI mock.

T4: `DatabaseService.onModuleInit()` invoked on a prototype object with a stubbed query method: one matching latest-migration checksum yielded READY although the simulated ledger had only one row and local migration files numbered 18. Zero real DB connections.

T5: checkpoint `inspect(path, bytes)` called directly on current source: additive contracts and ZIP helper returned `outside scope`; launcher returned a credential-bearing-URL block. No matching values printed. Parser/AI regression tests are recorded in the [AI report](AIC_AI_SERVICE_AUDIT.md#executed-tests).

`NOT RUN: safety`: `pnpm api:test`, DB integration suites, normal `api:build`, `dev:all`, migration/grants/bootstrap, smoke against existing API. The direct foundation test script consumes a configured DB; the PG launcher creates/stops a new process and retains files. This audit chose component/in-memory tests and did not change any running process. Historical Gate B/18-test/194-test claims are context only, not new evidence.

<a id="be-001"></a>
## BE-001: Make the combined launcher require explicit mode and separate restricted credentials

- **State/confidence:** CONFIRMED by T3 VM execution of the actual launcher; environment composition defect, not a live exfiltration test. **P1**. Every user of `dev:all`/`dev:windows` is affected; default owner/live selection creates data-transfer and privilege risk. Probability high when using documented root commands.
- **Affected revision:** base SHA above + untracked `scripts/dev-all.cjs`, untracked `start-dev.ps1`, modified `package.json`; NOT_ON_REMOTE. Required source must be reviewed before publication.
- **Locations:** [dev-all.cjs](../../scripts/dev-all.cjs), lines 7–21 root-env import, 28–32 defaults, 96–105 AI environment, 114–153 API/extraction environments; [package.json](../../package.json) root dev scripts. Do not copy its embedded credential text into a ticket/log.
- **Preconditions/repro:** use the T3 VM recipe in the handoff, with filesystem reads stubbed and process spawning recorded. Case A: empty environment. Case B: synthetic mock variables and a password-free synthetic DB URL. No real launcher execution permitted against the owner's workstation.
- **Expected/actual:** absent configuration should fail closed; explicit mock should stay mock everywhere; API/intake and extraction should receive separate role connections. Actual: implicit live mode, API/extraction hardcoded live even when AI is mock, shared DB connection; a credential-bearing default URL exists.
- **Evidence:** T3 returned `api_mode=live`, `ai_mode=mock`, `shared_db_url_api_worker=true`, `real_processes_started=0`. Local source scanner flagged only the path/rule, without the value.
- **Cause:** launcher bypasses role separation and mode intent during child-env construction. Transport mode validation correctly rejects mismatch but cannot make the launcher safe.
- **Fix plan:** BE operations owner replaces or disables this legacy entry point; require explicit offline/live mode, two injected role URLs, private storage/key configuration, and preflight validation before any child is started. No source/secret rewrite was applied. Retain standalone worker semantics; do not remove transport mode checks or read owner DPAPI from portable code.
- **Tests/acceptance:** red VM assertion: explicit mock must never yield any live child. Negative: missing key/role/mode => no spawn; no owner/default-credential URL; no secret in errors. Regression: explicit approved offline configuration gives consistent mode and correct roles. One-liner after source publication: `node --test scripts/tests/unsafe-launcher.test.cjs` **only after verifying it still fails before its real-spawn section on unsafe source**; preferably implement pure environment-builder tests first. The existing test was **not run** because it contains a subsequent real launcher call.
- **Owner/dependencies/order:** package OPS-1; strict ownership `scripts/dev-all.cjs`, `start-dev.ps1`, launcher tests only. Coordinate BE-002 in the same package; do not let two agents edit the launcher. Estimate 0.5–1.5 days, not guaranteed.
- **Impact/approval:** no migration or FHI change. Live provider use, credential provisioning, deployment or existing-process replacement requires owner approval. Source containing credential-like defaults must not be blindly pushed.
- **Handoff DoD:** pure synthetic VM test fails before patch and passes afterward on a fresh clone; no owner's `.env`, Windows profile or DB needed; safe portable procedure documented.

<a id="be-002"></a>
## BE-002: Include the durable dossier intake worker in supported startup topology

- **State/confidence:** CONFIRMED missing child in T3; indefinite queue persistence is STRONGLY_SUPPORTED by the source topology, not measured against a DB in this audit. **P1**, core One-ZIP flow stalls for users starting only the advertised combined stack.
- **Affected revision:** same base/local-only launcher as BE-001; intake CLI/repository are untracked and NOT_ON_REMOTE.
- **Locations:** [dev-all.cjs](../../scripts/dev-all.cjs):96–169 starts AI/API/extraction/web only; [run-dossier-worker.ts](../../apps/api/src/documents/run-dossier-worker.ts):10–34; [dossiers.controller.ts](../../apps/api/src/documents/dossiers.controller.ts):30–48; [dossier.repository.ts](../../apps/api/src/documents/dossier.repository.ts):50–87 enqueue only; [dossier-worker.ts](../../apps/api/src/documents/dossier-worker.ts):14–38 performs intake.
- **Preconditions/repro:** T3 VM records child command paths with all prerequisite existence checks true; count `run-dossier-worker` children. Actual 0, expected 1 for a complete dossier-enabled topology. `PROPOSED_REPRO` after OPS-1: isolated fresh DB + mock AI, upload synthetic ZIP, poll durable manifest with only documented startup command.
- **Evidence:** four planned children, no intake child. POST writes raw 202 and durable queued work; API does not launch background intake as an import side effect. A separately running intake process can mitigate this; its presence was not inspected here.
- **Cause:** old document-worker topology predates the second worker; successful API startup/raw acceptance is mistaken for an active consumer.
- **Fix plan:** same launcher owner as BE-001 adds explicit intake process and readiness/liveness supervision, or makes an incomplete topology visibly fail preflight. Keep API raw-only 202 and durable recoverability; do not unpack ZIP synchronously as a workaround.
- **Tests/acceptance:** red VM child-topology assertion; negative: missing intake build/config prevents READY and cleans up only children owned by that launch. Regression: kill/restart the disposable intake worker; same archive/member IDs resume, and >10-page source remains review-only. Proposed validation: `node apps/api/test/run-dossier-tests.cjs --run` on a reviewed isolated environment after build, never existing DB. This command was NOT RUN in this audit.
- **Owner/dependencies:** OPS-1, merge together with BE-001; no concurrent edits to launcher. Separate E2E verifier owns tests only. Estimate 0.5–1 day beyond BE-001.
- **Impact/approval:** no schema/FHI change; process lifecycle changes need an operator-reviewed launch procedure. No permission to terminate current services inferred.
- **Handoff DoD:** an external agent can start the complete synthetic topology without hidden processes/private credentials; manifest progresses and sources remain byte-exact.

<a id="be-003"></a>
## BE-003: Check the full migration ledger during runtime readiness

- **State/confidence:** CONFIRMED T4 component reproduction. **P2**. A damaged/incomplete ledger or modified earlier SQL can pass startup when the final checksum matches. This is an operational integrity gap, not demonstrated unauthorized DDL or data corruption.
- **Affected revision:** local added [database.service.ts](../../apps/api/src/database/database.service.ts), NOT_ON_REMOTE; base SHA above.
- **Locations:** `DatabaseService.onModuleInit`, database.service.ts:37–59. Contrast [migrate.ts](../../apps/api/src/database/migrate.ts):16–40 and 84–98, which checks the complete ordered prefix.
- **Preconditions/repro:** instantiate with `Object.create(DatabaseService.prototype)`; stub `query('SELECT 1')` and latest-row lookup, returning only latest checksum from local canonical LF bytes. Simulated DB ledger has 1/18 rows. Call `onModuleInit`; T4 resolves READY. Full snippet in handoff.
- **Expected/actual:** readiness rejects missing/unknown/changed history; current code requests only `WHERE name=$1` for the lexicographically latest SQL file. It verifies file presence for 0003 but not that ledger row.
- **Cause/evidence:** migration application has a complete validation algorithm; read-only runtime readiness implements a weaker independent algorithm. A successful runner invocation mitigates initial setup, but startup after drift does not repeat that validation.
- **Fix plan:** share a read-only ordered-ledger verifier with the runner, comparing every migration name/checksum and rejecting duplicate versions/unknown rows/gaps. Runtime must not migrate or repair history. Keep canonical CRLF/LF treatment unchanged.
- **Tests/acceptance:** red stub test for latest-only ledger; negatives: changed 0001, gap, unknown row and duplicate local version; regression: exact 18-row ledger and canonical LF/CRLF pass. One-liner once new unit file exists: `node --test apps/api/test/database-readiness.cjs` (`PROPOSED_REPRO`, file not authored). Existing no-emit typecheck must pass.
- **Owner/dependencies:** DB-1 owns database.service.ts and a new test; migration verifier sharing requires explicit coordination with migrate.ts owner. No OPS/AI conflict. Estimate 0.5–1 day.
- **Impact/approval:** no new migration required for verifier code; if deployed DB history is inconsistent, stop for operator approval rather than altering it. REQUIRES_OWNER_APPROVAL for any DB repair.
- **Handoff DoD:** reproduction runs with stub SQL only; exact complete ledger passes, corrupted history fails with a sanitized startup error and zero SQL writes.

<a id="be-004"></a>
## BE-004: Update publication inventory to include the actual dossier dependencies

- **State/confidence:** CONFIRMED direct `inspect` calls in T5. **P2**, high likelihood of incomplete GitHub handoff when using existing checkpoint/snapshot scripts. Not a production API defect.
- **Affected revision:** modified [prepare-source-checkpoint.cjs](../../scripts/prepare-source-checkpoint.cjs), untracked [create-review-snapshot.cjs](../../scripts/create-review-snapshot.cjs), untracked demo/dossier contracts/helper/fixtures; NOT_ON_REMOTE.
- **Locations:** prepare-source-checkpoint.cjs:11–37 root/exact allowlist, 69–85 scope/archive exclusions; create-review-snapshot.cjs:65–98 baseline selection/scanning; [validation.ts](../../apps/api/src/foundation/validation.ts):9–21 unconditionally loads all three schema fragments; [document-archive.ts](../../apps/api/src/documents/document-archive.ts):59–65 invokes helper.
- **Repro:** import `inspect`, call it with actual bytes at `packages/contracts/aic-dossier/schemas.json`, `packages/contracts/aic-demo-48h/schemas.json`, `services/ai/scripts/demo_zip_reader.py`. Each returns `outside scope`. Hash-reviewed synthetic ZIPs are also outside this scope/archive policy. No snapshot/staging command executed.
- **Expected/actual:** a reviewed portable source manifest contains runtime dependencies and reproducible synthetic fixtures, or blocks clearly with a dependency error. Current tool can omit dependencies from its advertised snapshot even after unrelated blockers are resolved. The standalone snapshot baseline only recovers paths at HEAD; these new paths are absent there.
- **Cause:** scope allowlist was not extended when validator/ZIP reader gained new modules. Passing source-checkpoint unit tests checks the older scope, not dossier completeness.
- **Fix plan:** PUB-1 adds explicit reviewed schema/helper and hash-bound synthetic fixture entries, plus dependency-closure tests. Do not widen to arbitrary PDFs/ZIPs, `.env`, logs, real fixtures, DPAPI or all `services/ai/evidence`. Launcher credential block must remain a block until OPS-1 resolves it.
- **Tests/acceptance:** red assertions for all required dependencies; negative substituted real/archive bytes stay blocked; generated/private files remain excluded. Existing regression command `node --test scripts/tests/source-checkpoint.test.cjs`; add pure completeness tests. Fresh clone can compile merged definitions, invoke ZIP helper and find all synthetic fixtures without external folders.
- **Owner/dependencies:** PUB-1 owns checkpoint/snapshot inventory/tests; merge before curating a source publication. OPS-1 resolves its own credential blocker. No application-code overlap. Estimate 0.5–1 day.
- **Impact/approval:** repository publication/fixture provenance only; owner must approve source/fixture inclusion, especially old evidence and licensed assets. No automatic staging of the dirty index.
- **Handoff DoD:** exact safe manifest yields a runnable source snapshot with matching hashes and no hidden Windows dependencies; external agent can reproduce all non-owner-gated tickets.

## Already mitigated / not promoted to findings

- SQL migration runner checks checksums and ordered history, uses an advisory lock, and applies explicitly; no automatic API migration. BE-003 concerns the weaker startup check only.
- Dossier counters use retained non-rejected sources, include inspecting in awaiting_inspection, count needs_review once, and accept review-only archives. This matches the current contract; no stale counter ticket opened.
- >10-page PDFs are retained, not silently truncated; >500 uses PDF_PAGE_BUDGET. Encrypted/embedded-file sources fail admission. Quotas are separate from legacy documents.
- Expired attempts cannot publish through stale fences. Crash recovery, starvation and throughput remain Partial until fresh isolated DB tests; source reading alone is not concurrency PASS.
- FHI method remains unconfigured/pilot unauthorized; no request to change methodology, rating or PD is implied by an extraction fix.
- Legacy `AiClientService` has weaker transport/logging patterns but is not the configured foundation document path. It is not reported as an active foundation leak without reachability proof.

## Unverified operational risks / hypotheses

- H-BE-1: PG test launcher hardcodes Windows `.exe` names/default installation path. Linux clone execution needs environment adaptation; not run on Linux, so portability is not certified.
- H-BE-2: upload admission guards limit concurrency per process, not tenant/global ingress bandwidth; no load benchmark or slow-client test performed.
- H-BE-3: baseline grant script uses SELECT ON ALL TABLES at application time. Actual least-privilege grants/ownership cannot be inferred without DB metadata. No main DB/secret access was attempted.
- No fresh real HTTP login, ZIP 30/60 pipeline, revocation race, browser E2E or live model test was performed by this audit. Historical results are explicitly not reissued as current PASS.
