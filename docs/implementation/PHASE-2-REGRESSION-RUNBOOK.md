# PH2-Q01 — Independent regression preparation

Branch: `duc`. Workspace: `C:/Users/52duc/Desktop/Fintech`. Preparation date: 2026-10-17.

**Incremental update:** user subsequently authorized fixing runner accounting. `test-e2e-feasibility.cjs` now uses `feasibility-results.cjs`: exit0 requires25 unique PASS outcomes, exit1 means FAIL/BLOCKED/incomplete, exit2 means unexpected abort. API assertion bodies (including legacy400 at test18) remain unchanged. `scripts/tests/feasibility-runner.test.cjs` verifies actual child exits without services. The log parser now requires a matching `RUNNER RESULT: PASS; … exit=0` marker and rejects historical logs lacking it. Earlier statements below about an unchanged script/no failing exit describe the preparation baseline, not current runner behavior. Startup denial and lack of full-stack acceptance remain in effect; no new service attempt in this incremental task.

**Full FE–BE–AI regression: NOT RUN / BLOCKED.** Main retried the ordinary previously denied Next3000 startup once after renewed user instruction. Execution was again rejected with `blocked by policy`. This task neither starts Next nor supplies an alternate launch path. The rejected command used a bare backend URL and never executed; correcting that URL is not authorization to rerun it. No port change, launcher, tool change, shell change, background helper, build/start substitution, or other workaround is proposed.

Notion now returns 404 according to main's source check. Requirements here come from repository snapshots and current local code; no current Notion verification or new contract approval is claimed.

## Scope and evidence

Exclusive changes for this task:

- `docs/implementation/PHASE-2-REGRESSION-RUNBOOK.md`
- `scripts/check-regression-prerequisites.cjs` (new, Node built-ins only)

Existing tests, `apps/*`, AI service, contracts, schema, shared packages and configuration are outside the write scope. Main owns actual services, builds, migrations and regression execution. No staging, commit, push or deployment is authorized here.

Reviewed sources: root `README.md`; `apps/api/README.md`; `apps/web/AGENTS.md`; frontend integration/audit and browser-checklist docs; `scripts/test-e2e-feasibility.cjs`; `docs/integration/{FE-BE-AI-FEASIBILITY,CODEX-BACKEND-HANDOFF,PARALLEL-AGENT-EXECUTION,subagent-fe-report,subagent-be-report,subagent-ai-report}.md`; the Phase 1 report/contract freeze; current API configuration/entry/tests, proxy policy/route, AI runner/backends, and synthetic fixture manifests. Frontend guidance requires version-specific Next documentation before frontend coding; this task makes no frontend edits.

Historical integration documents describe previous runs and contain conflicting claims. Their 25/25 entries do not establish a current pass. The unchanged feasibility script's SHA-256 is `f9a1531a91a4384308e72b37b276bc1c1b842a3b6d9cebc3522eca0686cd6a90` at preparation time.

## Separate acceptance tracks

| Track | Setup / expectation | What it proves and what remains open |
| --- | --- | --- |
| Unchanged prototype regression | Next3000 → explicitly enabled prototype3001 → FastAPI8100 with `AI_MODE=mock`; synthetic bundle contract PDF | Legacy transport/upload/source guards and mock gold compatibility. Require all 25 unique results. Test 18 expects **400 `IDEMPOTENCY_MISMATCH`**; preserve it as legacy debt. No foundation DB/auth acceptance. Currently NOT RUN/BLOCKED. |
| Real synthetic PDF inspection | Separate inspection of a synthetic local PDF, without OCR/extraction/model calls | Main reports PASS through the in-process FastAPI bridge below, including actual live-mode PDF parsing. Mock inspection does not satisfy this gate. This is not TCP/Next/worker acceptance. |
| Foundation auth/DB acceptance | Default/explicit foundation, real disposable loopback PostgreSQL, migrations, least-privilege runtime credentials; `pnpm api:test` | Real password/session/expiry/revoke/ACL/scoped reads, transactional revision/replay/audit behavior. Foundation conflict is **409 `IDEMPOTENCY_CONFLICT`**. Business/document/AI writes remain closed pending release. |
| Foundation through actual Next proxy | Foundation backend with approved actual proxy/ingress topology | Requires separate real proxy auth/cookie/CSRF/ACL and two-client-IP/spoofing evidence. Direct API tests and prototype PASS cannot substitute. Still missing. |

Current `services/ai/runner/backends.py` makes **mock inspection** return manifest page count, fixture byte size and fixed encryption/embedded-file flags, matched by hash. It does not run PyMuPDF. This supersedes the historical report's claim that mock three-service inspection proves real parsing. Real parsing exists in `services/ai/extraction`; mock extraction remains labeled gold, not model output. Do not switch the three-service baseline to live mode to make an inspection claim: its known non-fixture failure expectation and gold matching depend on mock mode.

## Read-only preflight

Run from repository root with Node >=22; no install is needed for this script:

```powershell
Set-Location C:/Users/52duc/Desktop/Fintech
node --check scripts/check-regression-prerequisites.cjs
node scripts/check-regression-prerequisites.cjs
node scripts/check-regression-prerequisites.cjs --mode foundation
# Optional file/environment-only observation:
node scripts/check-regression-prerequisites.cjs --mode prototype --offline
```

The default mode is `prototype`. The script reads bounded local repository files, rejects symlinks/junctions and paths outside the repository, checks exact checksum bytes, confirms the synthetic contract PDF's manifest/gold identity and hash, and checks presence/basic labels for additional synthetic inputs. It does not treat those JSON examples as approved foundation write payloads. The six text PDFs are available; the two scanned PDFs referenced in the manifest are bundle-only and not needed for this unchanged contract-PDF run. Scan/OCR coverage remains absent.

Online preflight makes exactly these unauthenticated GETs, with a 2.5-second total deadline per request and bounded headers/body:

| Loopback endpoint | Observation |
| --- | --- |
| `http://127.0.0.1:3000/api/v2/auth/me` | HTTP response confirms a listener; 401/403 is only an unauthenticated-route check. `503 BACKEND_NOT_CONFIGURED` is explicitly unresolved. |
| `http://127.0.0.1:3001/api/v2/auth/me` | HTTP response confirms a listener; 401/403 cannot distinguish prototype from foundation. |
| `http://127.0.0.1:8100/healthz` | Require explicit `status=ok`, `schema_version=1.0.2`, `mode=mock` for the prototype track. Health is self-reported mode evidence, not inspection or key authorization evidence. |

No redirects are followed; no configurable URL, DNS name, proxy, external endpoint, cookies or internal keys are sent. Any HTTP response, including a redirect/error, indicates a listener; it does not establish identity. A timeout/error is unresolved, not permission to replace a process. Connection refusal describes only this IPv4 loopback attempt, not all interface bindings or future availability. No listener is killed/reconfigured and no port is bound. No app module is imported. No `.env` file is loaded. No environment values, response bodies, headers, secrets or raw error messages are printed.

Caller environment checks describe **intended configuration only**. They cannot read another process's environment or prove what an already-running Next/API process loaded. `.env.local` may supply Next settings even if this caller has none; absent caller settings remain unresolved until main provides independent launch/config evidence. The exact backend base **must include `/api/v2`**; bare `http://127.0.0.1:3001` fails the preflight. Never point the frontend proxy at the AI service or `/api/v1`.

Preflight intentionally exits **1** while manual/runtime gates are unresolved, even if every file check and GET succeeds. Current API routes expose no trustworthy runtime-mode discriminator, so this version cannot return overall readiness. There is no force/assume-ready option. Exit **2** means invalid arguments or an internal error. `--offline` also exits 1. `--help` exits 0 without a readiness claim. Main must record each outstanding gate separately; a preflight report is not test acceptance.

## Main-owned prototype execution after the policy block is resolved

**Do not execute the startup/test commands below while the recorded startup denial remains effective.** These are the ordinary intended setup and test commands for main in a subsequently permitted environment. They were not executed in PH2-Q01. An existing listener alone does not resolve the policy gate or establish permission/ownership.

Main must confirm Node >=22, pnpm11.22.0, installed workspace dependencies and the existing Python environment/dependencies. Build the current API so tests 10/11 load current compiled client code:

```powershell
pnpm api:build
```

Required frontend configuration, supplied to its ordinary approved launch environment:

```powershell
$env:AIC_BACKEND_URL='http://127.0.0.1:3001/api/v2'
$env:AIC_FRONTEND_ORIGIN='http://127.0.0.1:3000'
```

The normal frontend development launch is documented in the root README. No Next startup command or replacement launcher is supplied here, because that action was rejected twice. Preserve the rejection as a blocker until the environment's approval state changes.

In the separate backend process environment, all prototype gates are required:

```powershell
$env:NODE_ENV='test'
$env:AIC_RUNTIME_MODE='prototype'
$env:AIC_ENABLE_PROTOTYPE='true'
$env:PORT='3001'
$env:AIC_FRONTEND_ORIGIN='http://127.0.0.1:3000'
$env:AIC_AI_SERVICE_URL='http://127.0.0.1:8100'
# Main supplies AIC_STORAGE_DIR as an absolute disposable private local directory.
# Main injects the same test-only INTERNAL_API_KEY into API and AI without printing it.
pnpm api:start
```

In the separate AI process environment, use the existing environment (no dependency installation or live provider invocation in this task):

```powershell
Set-Location C:/Users/52duc/Desktop/Fintech/services/ai
$env:AI_MODE='mock'
# INTERNAL_API_KEY is injected through the protected process environment.
& ../../.venv/Scripts/python.exe -B -m runner health
& ../../.venv/Scripts/python.exe -B -m runner serve --host 127.0.0.1 --port 8100
```

Main verifies the prototype boot mode from its own launch record and non-secret startup message, actual Next proxy target/configuration, consistent internal key and disposable storage ownership. AI `AI_STORAGE_DIR` is required for separate real parser service use; it is not required by mock manifest inspection. Non-default `CONTRACTS_DIR`/`AI_FIXTURES_DIR` overrides require a separate integrity check of the actual selected files; this preflight checks the repository bundle only.

Before running the unchanged suite, main must confirm **59999 unused** (test 10 expects connection refusal) and **59998 available** (test 11 itself creates/closes a temporary loopback HTTP server). Preflight does not probe these auxiliary ports. Do not stop the real AI service to test failure handling; test 10 points a new local client at59999. The suite mutates prototype sessions, uploads/private staging files and case revisions. Never run it against foundation or non-disposable data.

Once all gates are evidenced, main runs exactly:

```powershell
Set-Location C:/Users/52duc/Desktop/Fintech
node scripts/check-regression-prerequisites.cjs --mode prototype
# Review the unresolved manual gates; the above exit1 is expected, not acceptance.
node scripts/test-e2e-feasibility.cjs
```

The suite uses a fixed synthetic prototype user and seeded case `a06adf0c-7110-51f6-86ad-4b4b903c3e9e`, uploads `packages/contracts/fixtures/04_contract.pdf`, verifies source hash/extraction/job/UI routes and negative guards. Test 25 uses an invalid cookie; its label is not proof of access isolation between two authenticated real tenants. Test 24's label mentions evidence but the code only queries the job route. Do not inflate coverage from labels.

### Validate all 25 unique outcomes

**The unchanged suite never sets a nonzero exit code for logged FAIL/BLOCKED results. Exit0 is insufficient.** Its execution entries are repeated in the final summary, so counting PASS lines produces duplicates. Require one result for every ID1–25 in the run and the summary, matching names/statuses, all PASS, no FAIL/BLOCKED, and no uncaught error. Do not edit expected schemas or the legacy400 assertion to manufacture a pass.

The owned helper can parse an existing UTF-8 log (<=1MiB, inside the repo, no links) without displaying its contents:

```powershell
# Main captures output only to its approved private local log; the raw suite can log token fragments.
# Example path assumes main already saved the UTF-8 capture there; this helper creates nothing.
node scripts/check-regression-prerequisites.cjs --results .reports/regression/prototype.log
```

Parser exit0 means only that the supplied log contains matching25/25 PASS entries; exit1 rejects missing/duplicate IDs, mismatches, FAIL/BLOCKED, missing/multiple summaries or unavailable logs. A log is not authenticated runtime evidence; correlate it with main's run time, script hash, actual process/configuration and exit/error record. Do not publish raw cookies, tokens, credential-bearing URLs or unrestricted logs.

### Main's in-process service bridge and separate real PDF inspection

Main reports **56 adapter checks PASS**, plus all checks PASS in [`scripts/check-ai-adapter-service.cjs`](../../scripts/check-ai-adapter-service.cjs): actual FastAPI `TestClient` mock inspect/extract responses through the compiled Nest-side validator, live-mode synthetic PDF inspection, and missing internal key403. PH2-Q01 read the bridge source but did not edit or rerun it. This evidence was supplied by main; it is distinct from PH2-Q01's own checks below.

Main's exact bridge command is:

```powershell
Set-Location C:/Users/52duc/Desktop/Fintech
node scripts/check-ai-adapter-service.cjs
```

The bridge uses in-process FastAPI HTTP handling with no TCP listener, starts no Next service, performs no live extraction/OCR/provider call, and uses temporary local synthetic storage. It supplies real parser/service-to-validator compatibility evidence; it does not replace the blocked three-service regression, real foundation auth/DB tests, worker or production acceptance. The read-only preflight never invokes this bridge because the bridge runs application code and creates temporary storage.

If a standalone parser-only observation is useful beyond the bridge, main can inspect a repository synthetic PDF directly with the current parser, without starting a service or requiring Gemini. This optional command is not part of the preflight and was not executed in PH2-Q01:

```powershell
Set-Location C:/Users/52duc/Desktop/Fintech/services/ai
@'
import hashlib, json
from pathlib import Path
from extraction.pdf import inspect
data = Path('../../tests/fixtures/synthetic/valid_synthetic.pdf').read_bytes()
info = inspect(data)
assert info.page_count > 0 and not info.encrypted and not info.has_embedded_files
print(json.dumps({'source_class':'synthetic', 'sha256':hashlib.sha256(data).hexdigest(),
                 'byte_size':len(data), 'page_count':info.page_count,
                 'encrypted':info.encrypted, 'has_embedded_files':info.has_embedded_files}))
'@ | & ../../.venv/Scripts/python.exe -B -
```

This tests parser bytes only; it does not prove authenticated HTTP inspection, shared-storage mapping, worker publication, live extraction or production parser containment. Capture failures honestly. More-than10-page/encrypted/embedded/corrupt cases need separate released expectations and evidence; the valid signature preflight does not test them.

## Main-owned foundation acceptance

Do not reuse prototype credentials, seeded case, gold or expected400 behavior. Remove prototype enable from the foundation process environment; default runtime mode is foundation. Supply `DATABASE_URL` for a dedicated least-privilege runtime role, positive `AIC_IDEMPOTENCY_TTL_MS`, correct origin/cookie/session settings and explicit operator-applied migrations. Backend does not auto-load `.env` or auto-migrate. Dedicated operator migration via `pnpm api:migrate` remains a separate reviewed action owned by main; do not migrate user data from this task.

The existing DB suite requires **AIC_TEST_DATABASE_URL** for an operator connection to a disposable loopback PostgreSQL cluster (not the runtime URL). Main confirms CREATE DATABASE/ROLE permission and disposability through its approved setup, without exposing the URL. It creates unique test databases/roles and starts actual API child processes; do not reinterpret it as a read-only preflight.

```powershell
Set-Location C:/Users/52duc/Desktop/Fintech
pnpm api:build
# AIC_TEST_DATABASE_URL is already injected securely for the disposable loopback cluster.
$env:AIC_ALLOW_LOCAL_DB_TESTS='true'
pnpm api:test
# Main's separate frontend/static verification:
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Record actual totals/failures/skips rather than copying Phase1's historical40/40. DB suite success does not require the three fixed HTTP ports and does not establish browser/proxy acceptance. The foundation preflight describes combined runtime + DB-test intended settings, a stricter configuration checklist than the standalone DB suite. It never connects to PostgreSQL or validates operator privileges. Existing migrations/checksums/grants, restart behavior, real expiry/revoke/idle, outsider404, ACL-before-replay, same-payload replay, different-payload409, concurrency and append-only audit need real suite evidence.

## Missing gates and handoff

| Gate | Required evidence / owner |
| --- | --- |
| Policy environment | Main's ordinary Next3000 retry was again denied `blocked by policy`. Full three-service suite remains NOT RUN/BLOCKED; no workaround. |
| Runtime identity/config | Main-owned service/launch evidence; API mode cannot be inferred from port or401. Exact frontend `/api/v2` base, origin/cookies and internal key agreement. |
| Fresh build/dependencies/storage | Main build result, dependency availability, disposable private staging ownership; file presence is insufficient. No write probe performed. |
| Regression outcomes | New run capture with25 unique PASS and unchanged hash, independent of exit0; auxiliary port ownership and exact synthetic bytes. |
| Real inspection | Main reports in-process bridge PASS for real synthetic live-mode inspection and internal-key guard. Actual TCP/proxy/source/worker integration remains open; mock manifest results do not qualify. |
| Foundation real DB | Actual DB suite evidence on explicit disposable loopback cluster; migrations, runtime least privilege, auth/ACL/replay/audit acceptance. |
| Actual proxy/security | Approved ingress/trusted-hop topology and real two-client-IP/spoofed-header tests; no blanket `trust proxy=true`. Browser/HTTPS acceptance remains absent. |
| B01/B02/B04 contract decisions | Approved/effective policy selection, typed Exposure/claims/source and staleness bindings, idempotency retention/cleanup and operation contracts. Test policy strings are not approved production policy. |
| B05 document/worker release | Immutable storage/source/evidence ownership, jobs/leases/retry/fenced publication and AI adapter contracts. No production scoring or financial method approval from this task. |
| Source and AI baseline | Notion404: snapshots only. Phase1 records an existing AI pytest failure (`extraction-v1` vs `extraction-v2`) and skipped cases; no new AI run or repair here. |

## PH2-Q01 verification record

Preparation ran only syntax checks, the read-only preflight and in-memory safety/parser checks documented in the handoff. No full feasibility, foundation DB suite, direct parser command, frontend test/build or service command above was executed by PH2-Q01.

The initial online observation on2026-10-17 returned connection-refused on all three fixed loopback ports and exit1 (`READINESS UNRESOLVED`). All three checksum groups passed; the contract PDF's synthetic manifest/gold identity/hash passed. This observation is time-bound and does not authorize service startup. Final command outcomes are reported with the task handoff.

PH2-Q01 verification outcomes:

| Command/check | Result |
| --- | --- |
| `node --check scripts/check-regression-prerequisites.cjs` | Exit0; syntax valid. |
| `node scripts/check-regression-prerequisites.cjs --help` | Exit0; CLI usage only, no readiness claim. |
| `node scripts/check-regression-prerequisites.cjs --results README.md` | Exit1; non-result file rejected with fixed message, no file content printed. |
| `node scripts/check-regression-prerequisites.cjs` | Exit1, readiness unresolved; all three ports connection-refused, fixture/checksum checks PASS. |
| `node scripts/check-regression-prerequisites.cjs --mode foundation` | Exit1, readiness unresolved; all three ports connection-refused; no DB connection attempted. |
| In-memory checks using exported `parseFeasibilityOutput`, `probeEndpoint`, `main` | **19 PASS**, exit0; no test files/listeners created. |
| `git diff --no-index --check -- NUL` for each owned file | No whitespace errors; only repository LF/CRLF conversion notices. Unchanged feasibility script hash reconfirmed. |

The19 checks covered25 unique PASS/CRLF parsing; FAIL/BLOCKED, missing/duplicate/out-of-range IDs, mismatching/missing/multiple summaries and malformed results; fixed unauthenticated GET options; invalid endpoint selectors; connection refusal, connected errors, oversize responses, redirect non-following and bounded timeouts; offline unresolved exit1, bare URL rejection, exact `/api/v2` acceptance, invalid CLI exit2, out-of-repo log rejection and suppressed secret/argument values. Network edge cases used an in-memory replacement for Node's HTTP request function, not temporary servers. Main separately reviewed/reran preflight and confirmed checksums/fixtures PASS, three ports closed and the expected exit1. Full FE–BE–AI remains **NOT RUN/BLOCKED**.
