# MVP v2 fixed-source review handoff — 17/10/2026

**IMPLEMENTATION_PARTIAL / ACCEPTANCE_NOT_RUN / AWAITING_INDEPENDENT_REVIEW / NO_GO_PUBLIC_PRODUCTION.** New vertical slices are implemented/integrated on the existing backend/UI. Required canonical30 parity and browser/live-model acceptance remain incomplete; unchanged AI regression has one confirmed failure. Evidence below is author self-test, not independent review.

## Correct source and fixed bytes

Exact owner requirement bytes are retained at `requirements/AIC_MVP_Complete_Remaining_Features_v2.md`; use them with the feature matrix/approved decisions, rather than treating the author's PASS report as acceptance.

HEAD `8b0b7ed9e983ba4a2ea4d43f79d1816eaad7dbf0` alone omits most implementation. Review **`C:/Users/52duc/Desktop/AIC-MVP-Review-v0.4.0-20261017/source/`**. `MANIFEST.json` hashes copied source/index/metadata bytes. `GIT-STATE.json` records HEAD/branch/index/current status/exclusions; `index/` separately preserves older staged bytes. Review `source/`, not `index/`. Verify with `node source/scripts/create-review-snapshot.cjs --verify <snapshot-directory>` and compare manifest hash with the delivery message. No commit/push/reset, original index preserved.

Included: unstaged/untracked implementation, migrations, lockfile, policy, technical docs, sanitized evidence, unchanged AI/legacy1.0.2, exact synthetic PDFs and application assets. Excluded: .git/dependencies/credentials/runtime/private data/generated AI evidence/original import/archive/personal plan/unreviewed PDFs. Install from lockfile and `services/ai/pyproject.toml`; do not copy original private cache. Snapshot is a source handoff, not a deployment or user-data backup.

## Safe startup

Follow `MVP-SANDBOX-README.md`. Owner confirmed no demo sandbox yet. **No demo/user database migrated**; agent applied migrations only on fresh disposable tests. Explicit fresh DB, separate migration/bootstrap owner/API/worker roles,0001–0017, current runtime grants, insert-only synthetic bootstrap, private cache, then ordinary API/AI/worker/frontend commands. Startup does not migrate/seed; stale checksums refuse readiness. No applied migration edits or independent idempotency reset.

Capability development defaults: TTL1h (bounds1minute–7days), budget120/socket-IP/minute (bounds1–1200), configurable env. With Next the socket peer is the proxy and shares its budget; no forwarded-IP trust. Retry:3total attempts, original24h deadline and300s remaining minimum, known committed retryable failure only. Default automatic retries remain; `AIC_WORKER_AUTOMATIC_RETRY=false` permits a manual-recovery exercise. These are local parameters, not final production policy.

Prior Next3000 startup was rejected “blocked by policy”. Do not use alternate launcher/tool/port. Owner must run ordinary README commands in an allowed terminal. Live extraction requires existing server-side `GEMINI_API_KEY`; native inspect does not. Never send credentials in chat or substitute a mock success.

## Frozen contracts / source ownership

- Wire0.4.0-mvp-sandbox, generator/schemas/OpenAPI/checksums in foundation bundle; Lead sole shared-contract/migration writer. Earlier owner B01/B02/B04/policy effectivity unchanged. V2 permits unresolved CRUD/native forms/exact questionnaire sources/retry/financial engine, not legal identity confirmation/numeric activation/public ingress.
- Questionnaire definition immutable per form ID/version1. Changed questions create a new draft/form and invitation. Invitations bind exact questions/party/recipient/version. Reissue revokes old token for the same form/party/recipient.
- First create delivers secret **X-Invitation-Token only**, JSON metadata frozen; replay status/body identical but no secret header. A lost secret needs explicit revoke/reissue. Hash/metadata only in DB/audit. Fragment link scrubbed immediately, memory only; no localStorage/referrer/analytics transport. No email sent.
- Respondent bearer omits specialist cookies/CSRF; submit requires allowed Origin/idempotency. Current expiry/revoke/close precedes replay. One committed submit per invitation, stable exact replay24h while capability valid, changed key/body409. Token proves access only; identity self-reported.
- Exposure writes whitelist exact document or response ID/revision/form/question/party; origins/actors/verification server-owned. Declaration without PDF stays valid/unverified. Source/input changes stale dependencies and preserve history.
- Financial set selection explicit when multiple, no period/basis/FX blending. Human verification targets exact fact/source revisions and bridges. App points/score/band/grade/PD null. Pure reference candidate calculation is internal/test-only, no scoring endpoint. `FHI-ENGINE-REFERENCE.md` documents canonical source and missing30 artifacts.

## Browser walkthroughs / fixture oracles (NOT RUN by author)

Run both README core workflows: create new unresolved counterparty→create RECEIVABLE or PREPAYMENT→claims/conditions/declarations→synthetic upload/extract→exact source viewer/classification→verify correct field or correction→Review independent of FHI→request edit/approve/export→wrong supplement rejected/blocked→correct replacement/review/recheck/ack→issue actions and waiver/revoke→history/reload/restart. Check unrelated findings retained, old raw/source/export immutable, foreign case,401/409,3locales/responsive/focus.

Native: specialist creates optional questions→selects scope/party/recipient→creates invitation→copies ephemeral link manually→separate respondent browser context with no specialist session→text or explicit skip+reason→submit/receipt→specialist reads SME_direct, entered_by null and real capability provenance→separate source verification→staff edit creates new revision/origin→select exact response revision in Exposure. Exercise revoke/reissue/expiry/close/wrong scope/duplicate and revoke-vs-submit.

Financial: Assessment tab→create set period/basis/regime/currency/unit/raw data/exact source or attributable entry→read normalization/provenance→human verify selected facts/bridges→inspect ratios/formula/source revisions/anchors→revise and confirm reset/stale; explicit selection when multiple sets. All score fields stay null.

Oracles: `packages/contracts/fixtures/{manifest.json,extraction-gold.json,golden-cases.json}` and six canonical PDFs; `apps/web/tests/fixtures/pdf/`; `tests/fixtures/synthetic/`. Service/HTTP tests label synthetic AI publication. Actual FastAPI native inspect is not model extraction. Live text/scan acceptance must inspect quote/page/field/entity/period/unit and failure with these oracles, not fixture-server output.

## Tests, gaps and independent review

Commands/counts/raw sanitized logs: `MVP-EXECUTION-REPORT.md`, `evidence/mvp-v2/`. Full backend uses its own PostgreSQL15432, never5432; run DB suites serially. FE check:aic consumer tests use mocked fetch and are not browser evidence. Runner child tests enforce nonzero FAIL/BLOCKED/missing results.

Known unchanged AI failure: `tests/test_extraction.py::test_contract_extraction_grounded`, provenance expected prompt_version extraction-v1 vs actual extraction-v2 (361PASS/1FAIL/4SKIP). No AI code or test expectation changed. Canonical30 config/scorer/fixtures not attached on current Notion: obtain original artifacts before parity acceptance. Browser/live-model awaits owner stack/provider. Production ingress/trusted IP, retention/reconciliation operations, backup/restore and resource isolation remain separate gates.

Independent reviewers were not started: recommended workflow/UI, backend/security/data integrity, AI/FHI. Findings need ID/severity/trigger/expected source/reproduction/file/fix suggestion; distinguish bug/missing feature/test gap. Fix ownership cannot overlap schema/SQL; one integrator, regression per fix, another agent verifies. Implementing agents are stopped before freeze. Do not silently modify a snapshot under review.
