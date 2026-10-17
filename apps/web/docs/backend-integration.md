# AIC Rating — frontend handoff, 16/10/2026

## Superseding note — METHOD-SYNC-01

[Current sources](specification/current-sync.md) and [integration audit](integration-audit.md) supersede old workspace links and method/country assumptions below. Current pages were read through signed-in Chrome; connector returned 404. AIC-FHI-1.0 has seven required metrics, no reweighting, financial_health separate from transaction_review, new lifecycle and international counterparties; grade/pd null. Production policy remains unconfigured.

`apps/web` is the only root workspace app; `apps/api` is absent. Nested consumer types follow draft Notion examples, not released schemas. Fact refs are not evidence refs; fact-to-source, period/basis/scope metadata and method-registry anchors remain gaps. Nine write groups remain pending. AI/contracts stay at their existing version. The original handoff below is preserved for G01–G11 and earlier decisions; its old browser status is historical.

Baseline: **AIC Rating 2.0.0 / CR-AIC-01 / AIC-2.0-DRAFT**.

Read live in the signed-in Notion workspace on 16 October: [master](https://app.notion.com/p/b6b237ed30f48343821401da9b2c7a24), [01 domain](https://app.notion.com/p/238237ed30f483429abe012a8d1bba58), [02 rules](https://app.notion.com/p/be3237ed30f483e5951d812c286bd915), [06 security](https://app.notion.com/p/3f9237ed30f481db9a1cdd6866f37d16), [09 operations](https://app.notion.com/p/3fa237ed30f4813b8875d88e3ac3b1db), [10 DTO](https://app.notion.com/p/3fa237ed30f4818398a1d2c993d0bbbc), [11 product](https://app.notion.com/p/3fa237ed30f481a3b9b7da4a05a903ab), [12 frontend](https://app.notion.com/p/3fa237ed30f481c1b6d3fcd3432e6cf1), [13 method](https://app.notion.com/p/3fb237ed30f48164a862ebf7da37194d).

Read snapshots: `docs/specification/`. Collapsed historical sections were deliberately excluded. Historical audit files were moved outside this repository and must not override these snapshots.

## What is implemented

The live route graph uses thin `src/app/` routes, ten business modules under `src/features/`, shared `src/components/` and `src/hooks/`, and transport/contracts under `src/lib/api/`. See [frontend architecture](frontend-architecture.md). Retired source, audit output and temporary migration files are preserved outside the project in the sibling `FE Fintech Backups` directory. QA fixtures remain under `tests/fixtures/`, outside public assets. No fake login or data is substituted on service failure. Retired preview URLs return the standard 404.

One internal role: `specialist`. Receivable seller/buyer and prepayment buyer/seller are both core; lender/borrower and investor/issuer are secondary. Proposed/active and expected obligations remain distinct. No loan approval, payment execution, automatic email, client score calculation, edited method weights, or client-created server revisions.

The UI provides login/session recovery; counterparties CRUD and cursor pages; cases/create/exposure edit; six workspace tabs; PDF upload new/replace/request response; extraction/source drawers; document jobs; document review/findings; policy waivers/revocation; non-financial/questionnaire forms; method/readiness blockers; assessment/factors/strengths/weaknesses/red flags; acknowledgement; immutable request export; cursor audit history. Forms whose payload is not sufficiently specified remain explicitly pending and never report a successful save. See the matrix below.

Translations: English default, Vietnamese, Simplified Chinese. Locale preference alone is stored in localStorage. Changing language does not replace the route, draft values, source content, or approved export. Dialog drafts are retained across a same-user/org session expiry; reauthentication does not replay writes. A different identity triggers a fresh page so the old user's draft is not reused.

## Configure the future backend

Copy `.env.example` to `.env.local`, set `AIC_BACKEND_URL` to the backend's **complete `/api/v2` base URL**, and restart Next. Pin `AIC_FRONTEND_ORIGIN` to the public HTTPS origin behind a reverse proxy. With no URL configured, the proxy returns `503 BACKEND_NOT_CONFIGURED`; login does not succeed.

The browser calls same-origin `/api/v2/...`. The Next route is a restricted public-API forwarder, not a business backend. It does not create users, persist cases, decide ACL, run OCR, calculate scores, or append authoritative audit events. It blocks unlisted/private AI routes, cross-origin writes, oversized bodies and unexpected redirects. It forwards only the defined transport headers; no private service credential is present in browser code.

Backend must supply host-only session cookies for the **frontend's public host**, with HttpOnly, Secure in HTTPS, appropriate Path and SameSite. The frontend does not persist or expose raw session tokens. Set-Cookie is forwarded, not rewritten. Backend must independently enforce session, CSRF, tenant/case isolation, policy, immutable-source, method and concurrency checks. This frontend is not proof those controls exist in an unimplemented backend.

JSON responses have no `data` envelope; lists use `items` and optional `next_cursor`. Upload is multipart. 204 is not JSON parsed. Sources/exports are bytes. VND is an integer string, formatted with BigInt. Values absent from the source are not changed to zero. Source viewing fetches the immutable document ID and verifies SHA-256 before rendering; no fallback to another version. PDF worker/fonts/CMaps are local.

Writes use `Idempotency-Key`, except auth, and `X-CSRF-Token` from `/auth/me` or login. Those exact header/cookie deployment conventions need confirmation at schema release. The same unchanged payload retains its key after an uncertain failure. Edited payloads receive new keys. Reads abort when obsolete; writes are not automatically retried. 409 retains a draft; the user must load and inspect the latest revision, adopt it and explicitly submit. 401 preserves the form and requests sign-in, without automatic replay. Polling uses actual job states, no fabricated progress, at three-second intervals while work is running, with a five-minute budget and manual refresh thereafter.

## Contract gaps to release with AIC-B01

The report explicitly says **no released OpenAPI / JSON Schema / field registry / machine-readable package exists yet**. Therefore this is prepared frontend code against a draft, **not a claim that the full product is production-ready**.

| Gap | Missing decision / schema                                                                                                                             | Current handling                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G01 | LoginInput fields, exact CSRF header, cookie settings and capability-token header/link format                                                         | Login adapter uses username/password and X-CSRF-Token as explicitly documented consumer conventions. Backend must confirm. No fake auth.                                                                                                                    |
| G02 | Full case-detail expansion, document filename/active status/source shape, extraction envelope, accepted-job envelope                                  | Optional view-model expansions and array extraction decoder are isolated in `src/lib/api/contracts.ts` / `src/lib/api/decoders.ts`. Confirm against released schema; malformed known structures fail closed. No latest-source fallback.                     |
| G03 | Exposure `conditions[]`, milestones/acceptance/refund/paid/received claims and provenance shapes; term-null reason path                               | Editor supports confirmed core fields and preserves existing conditions. Condition/claim editing is held; creation uses empty conditions, known term, proposed/active choice. No invented payment event.                                                    |
| G04 | Upload `source_class` values, inspection rules and active-file policy metadata                                                                        | Multipart core fields and PDF signature/size checks implemented. Source class currently text; backend must publish values and inspect PDF pages/encryption/embedded content. No client page-count assertion or fake OCR.                                    |
| G05 | **No document-manual-review operation is present in the new API catalogue**; correct/classify `DecisionInput` fields missing                          | Manual review/correction/classification forms prepared. Submit explicitly reports `CONTRACT_NOT_RELEASED`, sends no request and retains the draft. Do not invent `/manual-review` or misuse response verification.                                          |
| G06 | Request draft/edit schema, immutable approved payload, bindings, request-vs-case revision semantics                                                   | Draft forms pending. Approve/cancel adapter uses case expected_revision + reason and must be checked against released request revision semantics. Export always fetches server-approved bytes, never synthesizes text.                                      |
| G07 | Questionnaire creation, staff-response envelope, answer states/types/validation/options, verification targets, invite input/result, revocation result | Forms prepared and pending at write boundary. Existing supplied question/response expansions can be displayed. No client-generated capability, false SME origin, auto-verification, automatic sharing, or fake receipt.                                     |
| G08 | Respondent form envelope, capability header/link format and submit payload                                                                            | A provisional read adapter supports `#token=...` → Bearer header, removes fragment and omits specialist cookie credentials. Only known text types render editable; submission stays pending. Release actual policy before opening this route to recipients. |
| G09 | Financial metric registry/formulas, method configuration, factor taxonomy, rationale/notes persistence                                                | Server-returned facts/results displayed. No BA example scorecard or Moody's formula/grade/PD runs in live FE. Analyst-note persistence and numeric assessment require the released method/API.                                                              |
| G10 | External source search/registration/verification operations and provider/data rights                                                                  | No invented web-search endpoint. Evidence refs and immutable source viewing work through the catalogued API. External source management awaits its contract.                                                                                                |
| G11 | Organization display metadata and missing/must/conditional document checklist result shape                                                            | Do not hardcode “An Tâm”. Use current session organization context and server readiness blockers/waivable requirements. Publish readable organization metadata and checklist outputs with detail schema.                                                    |

These gaps do not revoke the user's UI approval. They are missing transport/business details, not another UI approval request. No changes have been made to the Notion report, team repository or its contracts.

## Screen → operation → verification

Results below describe the current source cleanup. HTTP QA uses synthetic data; it does not exercise clicks, layout, real OCR or backend policy.

| Screen/flow                                 | API group                              | Current verification                                                           |
| ------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| Login/session/logout                        | auth                                   | Consumer + HTTP valid/invalid login, session, logout; browser recovery pending |
| Counterparties                              | counterparties                         | HTTP create/edit/leading-zero ID; browser search/pagination pending            |
| Four exposure roles; both core flows        | cases, exposure                        | Unit role/string-money/preservation checks + HTTP two core flows/409           |
| Upload, immutable extraction/source         | documents, jobs, evidence              | Unit multipart bindings/PDF guards + HTTP upload/source/extraction             |
| Independent review/findings                 | review-runs, issues                    | HTTP completed job and issue decision while numeric method blocked             |
| Waiver/revocation/history                   | waivers, history                       | HTTP actions, retained finding and audit events                                |
| Questionnaire/staff/verification/invitation | questionnaires, responses, invitations | Draft UI builds; G07 writes remain pending, no successful-save claim           |
| Scoped respondent                           | respondent                             | HTTP valid/invalid token + unit required/skip/type validation; submit pending  |
| Readiness and assessment                    | readiness, assessments                 | Unit stale/readiness + HTTP synthetic configured result/acknowledgement        |
| Request draft/decisions/export              | requests                               | Draft pending; export exact bytes consumer check; G06 still needs release      |
| Error/concurrency/session semantics         | API transport, proxy                   | Consumer 401/409/malformed/CSRF/origin/allowlist/idempotency/204 checks        |

## Run and verify

Use the commands in [README](../README.md). Current evidence is written to `.reports/`; see [verification](verification.md). Historical browser reports/screenshots are preserved outside the repository. Browser regression after the source cleanup has not run because local browser use is disabled in Work settings. See `tests/e2e/README.md`.

Next backend step: publish AIC-B01 schemas/examples and clarify G01–G11, replace isolated draft decoders/mappings as needed, wire pending forms, then run consumer checks and authenticated browser E2E against that backend. Keep synthetic QA separate.
