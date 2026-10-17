# ACCEPT-BE independent security harness review — 2026-10-17

**PASS for the scoped adapted tests:** 27/27 Node database tests (25 leaf scenarios + 2 parent tests), no failures, cancellations or skips; exit 0. Seven separate no-database protection tests also pass, exit 0. No application defect was reproduced by these scenarios. These results establish the tested service/repository behavior, not browser, live AI, HTTP ingress or production acceptance.

The lead explicitly released port15432 after its baseline run and authorized this serial run. The existing launcher finished with `server stopped` and `Disposable cluster stopped`; no further database execution is planned by ACCEPT-BE. The lead was notified that port15432 is released.

## Scope and baseline

- Live checkout: `C:/Users/52duc/Desktop/Fintech`, branch `duc`, HEAD `8b0b7ed9e983ba4a2ea4d43f79d1816eaad7dbf0`. Most implementation is staged/unstaged/untracked beyond HEAD; existing WIP was preserved.
- Read the owner-approved `C:/Users/52duc/Downloads/AIC-CODEX-MVP-ACCEPTANCE-ORCHESTRATION-v2.md`, root/apps/API READMEs, database/storage guidance, sandbox README, owner decisions, feature matrix, review handoff and foundation contract README. No root/API/test AGENTS file was found; `apps/web/AGENTS.md` applies to the frontend, outside this assignment.
- The finished frontend i18n patch/report are present. The lead owns their verification, checkpoint, runtime, UI and AI acceptance.
- Only new `apps/api/test/acceptance-security/**` and this document were written. No other tests, business source, migrations, schema, contracts, grants, launcher or package scripts were edited. No commit/push/deployment. No `.env` or user database was read or used.
- Existing compiled API artifacts were used after the lead's baseline build/test. The capability/worker compiled timestamps were later than their matching source timestamps. This agent did not rebuild shared `dist` while the lead was working.

## External package reviewed, never executed

Directory: `C:/Users/52duc/Desktop/AIC-MVP-Audit-v0.4.0-20261017/agent-02/security-test-preparation/`. Both entire stress scripts, the unified runner and `SECURITY-TEST-HANDOFF.md` were read. The accompanying `agent-02/reports/AUDIT-BACKEND-SECURITY.md` was inspected as historical claims, not current results.

| External file | SHA-256 of reviewed bytes | Disposition |
| --- | --- | --- |
| `concurrency-capability.stress.cjs` | `eeacdeb167ba5b29c1bf0f8be0cbfccc4e100f133e9b66206e8271c2dc8fafe0` | Reused the six scenario intents and real service calls; replaced orchestration, isolation, expiry fixture and assertions. |
| `crash-recovery-worker.stress.cjs` | `4845ac5e40a6aaa65eeed6015f9955c8f663b500eec7ea48da010b2301522bd6` | Reused lease recovery, zombie rejection, exhaustion, orphan tolerance and owned-child crash intents; replaced implementation. |
| `run-security-tests.cjs` | `c6270bb5b3044cc24aeec30323f2dfc5d6d245fd0914ff45488ef76598490252` | Rejected execution and copied no runner code. Replaced with explicit opt-in and the existing isolated launcher. |
| `SECURITY-TEST-HANDOFF.md` | Historical report | Retained as context only. Neither its PASS claim nor its production suggestions are an acceptance oracle. |

## Objective problems in the supplied harness

| ID | Severity / source | Trigger and observed source problem | Resolution |
| --- | --- | --- | --- |
| BE-H01 | P0 execution safety; both stress scripts ~32/76 and runner7–18 | Missing URL falls back to `postgres` on15432. Loopback-only validation does not prove a disposable cluster; neither script enforces the documented opt-in. The runner's `SELECT version()` only proves PostgreSQL is reachable. | Require launcher-specific URL/opt-in and verify live server identity plus temporary filesystem proof before any database/role creation. Never run the originals. |
| BE-H02 | P0 credential handling; runner18/54, crash child ~410–446 | Runner prints the complete database URL on normal and failure paths. Generated child source embeds a runtime URL/password on disk; child stack/stderr may expose diagnostic detail. | Strip inherited secrets from child environment, no URL output, static child file, runtime credentials sent only in private IPC, fixed child failure messages. |
| BE-H03 | P1 expiry validity; capability458–463 | Expiry test disables the immutable-invitation trigger and updates an existing invitation; enable is not protected by a local finally. | Append a short-lived operator fixture without disabling triggers or mutating invitations; expire during an observed case-lock wait and assert zero committed effects. |
| BE-H04 | P1 reproducibility; capability T1/T2/T5 | Promise scheduling chooses only whichever branch happens to occur. T2 does not assert every loser's code/count/DB effects; T5 does not validate eventual replacement-token usability when submission wins. The handoff's strict FIFO claim is stronger than these tests prove. | Exercise both commit orderings for revoke/close/reissue, observe ten PostgreSQL lock waiters, assert all codes/counts/revisions/response/audit effects, retry control with fresh revision, reject exact receipt replay afterward. No fairness claim. |
| BE-H05 | P1 crash coverage; worker T1/T2/T5 | T1 manually abandons a claim; T2 depends on T1's shared attempt. T5 child only calls repository claim, so it never proves an actual worker's materialize/heartbeat checkpoint. Readiness timeout is uncleared and failure does not always clean up the child. Two/five-second leases are sensitive to filesystem/OS delays. | Independent fixtures,60s leases, bounded readiness and child close, always kill only the owned ChildProcess, actual `DocumentWorker.once()` + `PrivateDocumentFiles` suspended at synthetic extract. |
| BE-H06 | P1 teardown/accounting; both finally blocks and runner87 | Forced database deletion and swallowed drop/role errors can hide leaked connections/cleanup failure. Success string hardcodes13/13; source contains6+5 leaf scenarios plus2 parent tests. | Drain operations, close owned pools, ordinary DROP of only generated names, fail on cleanup errors; use Node's real counts. |
| BE-H07 | P2 portability / handoff | Hardcoded `C:/Users/52duc/Desktop/Fintech` imports/cwd. Existing launcher uses Windows `.exe` names, fixed15432 and a Windows PostgreSQL install path. Handoff suggests retention/proxy changes outside approved business/security scope. | Relative imports; preserve launcher unchanged. Verified on Windows only; Linux portability is NOT VERIFIED. Reject unsolicited retention/ingress changes. |

The reviewed external files contain an owned-child SIGKILL, not a global PostgreSQL process kill. No allegation of a global kill is inferred from their text. Their unsafe connection/credential/teardown behaviors are sufficient reasons not to execute them.

## Added files and reused live implementation

| Added file under `apps/api/test/acceptance-security/` | Purpose |
| --- | --- |
| `harness.cjs` | Shared verified isolated fixture, actual grants, authenticated synthetic specialist, approved policy for both workflows, bounded runtime transactions and commit gates. |
| `concurrency-capability.stress.cjs` |18 independent scenarios: both workflows × nine cases (six ordered control/submission races, same-key replay, distinct-key conflict, expiry during lock wait). |
| `crash-recovery-worker.stress.cjs` | Seven scenarios: both workflows × lease/zombie, exhaustion, actual child crash/recovery; one independent orphan-cache restart check. |
| `crash-child.cjs` | Static child executes actual worker until the synthetic extractor checkpoint; never stores credentials in source/argv. |
| `run-security-tests.cjs` | Requires exactly `--run`, refuses occupied15432, strips inherited DB/provider/bootstrap/Node options, invokes unchanged launcher serially; propagates nonzero exit. |
| `harness-protection.test.cjs` | Seven no-DB tests: opt-in, URL rejection/redaction, user-path denial, owner/path/link identity, password/PID proof, inherited-secret stripping and runner misuse. Identity failure branches use injected filesystem doubles, no database. |

Live files reused without editing:

- `scripts/test-local-postgres.cjs`: sole cluster start/stop owner. Fresh private `aic-pg-check-*`, SCRAM random owner password, loopback15432; finally stops only `pg_ctl -D <its data>`, deletes its password file and retains diagnostics.
- `scripts/sandbox-runtime-grants.sql`: applied byte-for-byte apart from the two psql role placeholders. No supplemental grants or runtime ownership. Both runtime roles assert NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT/NOREPLICATION/NOBYPASSRLS, zero role memberships and zero owned application relations. Audit DELETE denied to both; worker user/session/invitation reads denied.
- `src/database/migrate.ts`: explicit migrations only into each newly created test database.
- `src/auth/{session.service,password}.ts`, `src/foundation/{core.repository,case-mutations,mvp-case.service,mvp-capability.service,mvp-questionnaire.service,canonical}.ts`: actual runtime services, login and contract validation. No replacement implementation of their business methods.
- `src/documents/{postgres-document.repository,document-worker}.ts` and `src/document-storage/private-files.ts`: actual claims, heartbeat, publication/failure fence, canonical source and private materialization. Existing `test/document-retry.integration.cjs` was inspected for API shape/grant conventions, unchanged. The older repository test's wider hand-written grants were not copied.

Safety identity checks require `current_user=aic_test_owner`, `current_database=postgres`, port15432, the server-reported real data directory exactly `<OS temp>/aic-pg-check-<suffix>/data`, unlinked root/data directories, matching active launcher password proof and matching `postmaster.pid` data/port. A plausible loopback URL alone cannot authorize mutation. Credentials exist only in memory and the existing launcher's private temporary password file; assertions do not print them. No `.env` loading, backend/AI startup, process enumeration, unrelated service termination, FORCE drop, trigger disabling, business reset or recursive filesystem deletion occurs.

Each fixture creates random database/role names and drops only resources it successfully created. Cleanup failures fail acceptance. Synthetic cache/orphan files are intentionally retained for inspection; no production retention policy is invented.

RECEIVABLE uses organization=`seller`, counterparty=`buyer`; PREPAYMENT uses organization=`buyer`, counterparty=`seller` (the frozen wire enum representing the supplier). No contract/role enum change was made.

## Commands and observed evidence

From repository root, only after coordinating exclusive15432 ownership with the lead:

```powershell
# Lead builds current source before testing; this agent reused that build.
pnpm api:build
node --test apps/api/test/acceptance-security/harness-protection.test.cjs
node apps/api/test/acceptance-security/run-security-tests.cjs --run
```

The runner invokes this exact existing launcher command internally, with a sanitized child environment:

```powershell
node scripts/test-local-postgres.cjs --test-concurrency=1 apps/api/test/acceptance-security/concurrency-capability.stress.cjs apps/api/test/acceptance-security/crash-recovery-worker.stress.cjs
```

Prefer the wrapper for opt-in, occupied-port protection and environment isolation. It checks required dist files; it does not claim to rebuild or detect every stale compiled dependency. Do not invoke the stress files directly with a manually supplied URL. Do not run concurrently with `pnpm api:test:mvp` or the lead's live acceptance cluster.

Observed on Windows, Node `v24.12.0`, installed PostgreSQL18 binaries, 2026-10-17:

| Check | Result | Evidence |
| --- | --- | --- |
| `node --check` on all six added `.cjs` files | PASS / exit0 | All parse successfully. |
| `node --test .../harness-protection.test.cjs` | PASS / exit0 | Final7tests,7pass,0fail/skip/cancel;317.5542ms. Initial five checks also passed before DB execution. |
| `node .../run-security-tests.cjs --run` | PASS / exit0 | Node27tests,27pass,0fail/skip/cancel;18740.9188ms test duration. |
| Capability suite | PASS |18leaf scenarios +1parent;9381.3134ms. Both deterministic ordering branches exercised for each control in each workflow. |
| Crash/fence/cache suite | PASS |7leaf scenarios +1parent;8999.7168ms. Two actual owned worker children killed/recovered; cache bytes preserved. |
| Owned resource cleanup and cluster stop | PASS | Test after-hooks completed without failure; launcher printed `server stopped`, removed its password file, exited0. |
| Original Gemini runner/scripts | NOT RUN | Source review only; intentionally rejected for execution. |
| Linux, browser, real provider extraction, transport schema/HTTP Origin/CSRF, trusted ingress | NOT RUN by this assignment | Separate acceptance responsibilities; no inference from these service/repository tests. |

Diagnostic cluster: `C:/Users/52duc/AppData/Local/Temp/aic-pg-check-4xCEEX`. Private synthetic orphan cache: `C:/Users/52duc/AppData/Local/Temp/aic-accept-security-4RzaRD`. Node counts include parent tests; there are25database leaf scenarios, not27independent scenarios. The raw test output was observed in command results; this document records its summary and does not represent a newly invented raw log.

After the database run, the only harness change was adding an optional filesystem argument defaulting to the same Node filesystem object, so all identity-failure branches could be tested without touching disk or starting another cluster. The final seven protection tests and syntax checks passed; database scenarios were not rerun after that test seam addition because the lead had been released to start its cluster. No database behavior or assertions were relaxed.

The crash child intentionally pauses in a synthetic AI stub; recovery publication directly tests the repository source-binding contract with `mode=mock`. This proves fencing/materialization/persistence behavior, not canonical AI response validation, extraction accuracy or a full successful worker/provider journey. The parent also asserts zero zombie side effects while a newer fence is still running, immutable outcome counts, single publication, exact canonical byte recovery and three-attempt quarantine. Expiry timing is a deliberately short operator fixture; normal invitation TTL bounds remain unchanged.

## Result and lead handoff

The external harness has objectively unsafe execution defaults and several evidence gaps, fixed within the new harness only. Adapted scenarios reproduced no defect requiring business-source changes. Lead may cite **scoped ACCEPT-BE PASS** with the counts/mode above. Public ingress, browser/AI workflow acceptance, orphan retention/reconciliation and overall demo/production GO decisions remain the lead's separate gates. No instruction to enable proxy trust, delete historical data, activate FHI or change financial/auth semantics is provided.
