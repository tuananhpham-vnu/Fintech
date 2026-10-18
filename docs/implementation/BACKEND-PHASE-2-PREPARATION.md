# AIC Rating 2.0 — Phase 2 preparation

17/10/2026, Asia/Saigon. Branch `duc`. **PHASE_2_PREPARATION_PARTIAL**: independent preparation implemented and tested; B01–B04 await owner decisions and full FE→BE→AI execution is tool-policy blocked. Foundation is retained; no business mutation release.

## Completed work

### Git safety / checkpoint

Verified status/index/tracking/ignore rules, with no index mutations. Backend/storage source and audit/report docs are discoverable but still untracked. `.env`, runtime storage and real/holdout data remain ignored; no ignore changes were needed. Existing WIP is preserved. No commit, push, reset, deploy or user-database migration.

[Checkpoint proposal](PHASE-2-GIT-CHECKPOINT.md) explains the selected-path local commit for owner review, or a verified source-only backup if owner prefers. `scripts/source-checkpoint-inventory.cjs` generates a deterministic SHA256 inventory of technical candidates from Git. [Inventory](phase-2-source-inventory.json) contains hashes, not source bytes, and is **not a backup**. Actual checkpoint remains to be chosen/created; no claim of durable protection for untracked source.

### B01–B04 decision package

[PHASE-2-DECISIONS.md](PHASE-2-DECISIONS.md) contains proposals, alternatives/trade-offs, FE/BE/database impact, blocked APIs and concrete information needed from owner. It does not approve any option or supply missing TTL/claim/policy values.

Notion master + pages01/08/09/10 returned404 `object_not_found` in this run, and search returned no `AIC Rating` result. Source reconciliation therefore uses local code, unchanged bundle1.0.2, prior audit/Phase1 source records and owner's explicit decisions. A new Notion change is not claimed verified. Restored access needs a targeted B01–B04 comparison before release, not a fresh general audit.

### Pure internal AI boundary (PH2-A01)

New files:

- `apps/api/src/ai-adapters/legacy-validation.ts`
- `apps/api/src/ai-adapters/README.md`
- `apps/api/test/ai-adapter-validation.cjs`

The factory accepts in-memory canonical bundle bytes. It checks VERSION and all six SHA256SUMS artifacts against the reviewed1.0.2 hashes, then compiles actual JSON Schema2020-12 using existing AJV/format dependencies. It validates inspect/extract request and raw response, explicit expected mode and captured `x-ai-mode`, without coercion/defaults/field removal. Header stays separate from canonical JSON.

It mirrors the existing runner's source guards: request hash/document/case echoes; contiguous pages; unique same-document evidence on existing pages; field references limited to that evidence. It returns the same body, retaining pages/quotes/bbox/nulls/provenance/diagnostics and mode, with `orchestrationBinding: pending`. Errors are bounded and omit raw payload values. Schema-permitted diagnostics and classification are not narrowed by invented business rules; PaymentCondition uses only canonical1.0.2 schema, not new claim semantics.

These exported interfaces are **technical module interfaces**, not a new public AIC2 release: `LegacyContractBundle`, `LegacyAiExchange`, `LegacyAiResponseHeaders`, `ValidatedLegacyResponse`. They do not alter existing shared contracts/ports. There are no new dependencies, providers, schema migrations or production composition imports. This does not implement evaluation, AIC2 field/type/party mapping, HTTP transport replacement, immutable persistence, human verification or worker publication.

The legacy `AiClientService` remains isolated to prototype composition; its loose checks/error mapping are not presented as the new validator. Future transport must capture the actual raw body/header before prototype metadata blending, bind expected mode and authoritative source from backend-owned data, enforce bounded transport/parser resources and adapt internal errors under a released contract.

### Actual AI compatibility probe

`scripts/check-ai-adapter-service.cjs` invokes the current Python FastAPI app through TestClient, returns its response to the compiled TypeScript validator and checks body/mode preservation. It uses a random in-memory internal key, no provider key, no TCP listener, no AI source edits and no production data. A private temporary synthetic PDF is removed by Python's TemporaryDirectory cleanup.

Verified paths: mock inspect; mock extraction with original MOCK provenance/diagnostics; **live inspect using real PyMuPDF on a synthetic PDF**, matching source SHA256 and byte size; actual FastAPI missing-key403. Mock extraction remains mock. In-process compatibility does not establish Next proxy, Nest HTTP transport, live model extraction or worker behavior. It does not replace the blocked three-service test or bypass the denied Next startup.

### Regression preparation (PH2-Q01)

- `scripts/check-regression-prerequisites.cjs`: read-only fixed-loopback/file preflight, checks bundle/fixture integrity and intended environment shapes without printing credentials; no service/DB/storage writes. Runtime mode cannot be proven by port/401, so unresolved manual gates remain explicit, exit1.
- [Runbook](PHASE-2-REGRESSION-RUNBOOK.md): exact consumer/backend base includes `/api/v2`, three prototype enable gates, separate foundation DB acceptance, source/mode/parser limitations, and auxiliary ports used by unchanged tests.
- A result-log parser rejects missing/duplicate IDs, disagreement between run and summary, FAIL/BLOCKED or malformed logs. This matters because the existing script logs results twice and does **not** fail its exit code when an assertion is logged FAIL. Parser synthetic logs verify the parser only, not a real25/25 run.

Ordinary Next3000 startup was attempted once after this user request and automatic approval review rejected it again: `blocked by policy`. No alternate method, launcher or tool was used. No prototype/AI server was started just to leave a partial stack running. All three ports were observed connection-refused by preflight. Full feasibility remains **NOT RUN/BLOCKED**, not25/25 PASS. The unchanged script hash is `f9a1531a91a4384308e72b37b276bc1c1b842a3b6d9cebc3522eca0686cd6a90`; its test18 still asserts legacy400, while production foundation contract is409. Neither test nor business rule was edited to manufacture PASS.

## Verification in this run

| Command / scope | Result | Evidence / limit |
| --- | --- | --- |
| `pnpm api:build` | PASS | Current source, including new validator; Nest foundation retained |
| `node --test apps/api/test/ai-adapter-validation.cjs` | **56 PASS / 0 FAIL** | Compiled implementation, canonical synthetic gold + corruption/negative cases; no AI accuracy claim |
| `node scripts/check-ai-adapter-service.cjs` | **4 checks PASS** | Three actual FastAPI→validator exchanges + missing-key403; TestClient in-process only |
| `node --test apps/api/dist/auth/auth.helpers.test.js` | **13 PASS / 0 FAIL** | Existing auth/crypto/helper regression; not DB suite |
| `pnpm test` | PASS | Architecture94 runtime files/10 modules,10 FE unit tests and18 consumer checks |
| `.venv/Scripts/python.exe -m pytest tests/test_contracts.py tests/test_app.py tests/test_m2_m3_trust_boundary.py tests/test_extraction_trace.py -q` from services/ai | **54 PASS / 0 FAIL** | Existing AI tests, provider key empty; one dependency deprecation warning |
| Preflight `--mode prototype` | **UNRESOLVED, exit1 as designed** | All three checksum groups and synthetic metadata checks PASS; ports/config/runtime/permission gates unresolved |
| Preflight/parser safety checks | PASS | Q01 reports19 safety/parser checks; Lead independently verified4 parser cases (complete/mismatch/missing/duplicate) using synthetic logs only |
| Node syntax checks, `git diff --check`, tracked AI/legacy contract diff | PASS | No schema/AI/test-baseline edits; tracked diffs alone cannot attest untracked FE bytes |
| Full three-service feasibility / browser proxy acceptance | **NOT RUN / BLOCKED** | Ordinary Next startup rejected by tool policy |
| PostgreSQL integration40/40 | **NOT RUN in this phase** | Historical Phase1 result retained, no DB/auth/persistence changes; dedicated cluster stopped |
| Full AI regression | **NOT RUN in this phase** | Prior Phase1:361PASS/1FAIL/4SKIP; known prompt-version assertion remains unresolved, not relabeled PASS |
| FE build/typecheck/lint | **NOT RUN in this phase** | Prior Phase1 PASS retained as history only; no frontend implementation edits |
| New migrations / production mutations / deployment | **None** | No migration or route release authorized by this preparation |

Reproduce from repo root: build API, run adapter tests and `node scripts/check-ai-adapter-service.cjs`. The bridge requires the existing root venv with FastAPI/PyMuPDF dependencies. It returns nonzero on failure, prints only fixed safe diagnostics and never starts a service. Preflight exit1 remains expected until its explicitly manual gates are resolved; it has no force-ready switch.

## Decisions and next independent work

| Decision | What owner must supply before affected implementation |
| --- | --- |
| B01 | Actual approved policy artifact/version and approval/effectivity/scope/overlap selection contract; no placeholder policy |
| B02 | Chosen typed aggregate vs relational model and condition/paid/received/source/verification/null-term/invalidation semantics; can split counterparty identity source contract for earlier release |
| B03 | Actual ingress/hop/TLS/network topology and authoritative client-IP handoff; then test two real clients and forged headers; temporary throttle values are not final policy |
| B04 | Replay window, response/tombstone retention/cleanup/key reuse rules and operation/fingerprint/result contract per mutation; no implicit TTL selection |

Auth/scoped reads remain available under Phase1 rules. `POST /cases`, `PATCH /cases/:id/exposure`, counterparty create/update still return503 for the previously documented blockers. Document/worker/AI routes remain absent from production foundation. No scoring/review/waiver workflow, role or claim state introduced.

Current agents used disjoint scopes: Gibbs/A01 owned only `src/ai-adapters/**` + `test/ai-adapter*.cjs`; Sartre/Q01 owned only preflight + runbook. Main owns decision/checkpoint/report/inventory and actual compatibility probe, reviews compiled tests and wiring. Shared contracts/migrations had no agent writer in this preparation.

Independent parallel work can continue on canonical synthetic adapter edge cases, fixture/provenance coverage and regression tooling. Persistence, document, worker and ingress agents are **not yet dispatched** for implementation. The [decision package](PHASE-2-DECISIONS.md) specifies exclusive file ownership, dependencies, acceptance and integration order for each. One shared-contract owner and one migration writer remain mandatory; do not let worker/document agents create competing SQL or shared DTOs.

Document implementation starts when the selected slice has approved source/type/lineage/immutable storage/upload/revision/idempotency and ACL contracts. Worker implementation additionally needs frozen job states, transactional enqueue, lease/attempt fencing, bounded retry/deadline, exact snapshot/result publication CAS and raw AI mapping/mode/error interfaces. B01 need not block a document slice for existing valid cases; B02 only blocks bindings the slice actually uses. Before public staging, B03 must be resolved and actual proxy/security/containment tests must pass. B04 is required before public idempotent mutations open. Detailed gates and real-DB/storage acceptance are in the decision package.

**Handoff:** independent code/preparation is reviewable and verified. Owner can decide B01–B04 and checkpoint from the linked tables; no further broad audit is needed to continue. Full stack execution awaits a permitted environment, with the rejection preserved as evidence.
