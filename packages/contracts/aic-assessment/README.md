# Assessment integration contract 1.0.0

This bundle adds persisted Assessment results to the existing AIC foundation API. It does not change the released legacy AI 1.0.2 payload or activate a method by itself. `schemas.json` contains `definitions` used by the backend validator; `openapi.json` contains the corresponding self-contained OpenAPI schemas. The foundation bundle is preserved. This bundle is part of the current uncommitted implementation and has not been independently certified.

## Routes

All paths below are relative to `/api/v2`. Reads and writes require the application's current specialist session and case ACL. Writes also require the configured same-origin CSRF policy and an `Idempotency-Key`. The service-to-service internal key is never a browser login credential.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/cases/{id}/readiness?set_id={optional UUID}` | Current revision, blockers, `assessment_allowed` and `numeric_assessment_allowed` |
| POST | `/cases/{id}/assessments` | 201, immutable Assessment snapshot |
| GET | `/cases/{id}/assessments?limit=20&cursor={revision}` | History summaries, newest first, opaque-to-consumers revision cursor |
| GET | `/assessments/{id}` | Stored result plus current `stale` and acknowledgement projection |
| POST | `/assessments/{id}/acknowledge` | Result with a separate append-only acknowledgement |

The case detail projection includes `latest_assessment_id` and `assessment`. The optional `checked_case_revision` is the case revision at which freshness was checked, while `case_revision` remains the immutable result's creation revision.

## Write bodies

Run accepts `expected_revision` and optional `financial_set_id`. Choose a statement set explicitly when more than one exists. Acknowledge accepts `expected_revision` and nonempty `reason`.

Reuse an idempotency key only for the exact same route and serialized body after uncertain delivery. A changed body requires a new key. Acknowledgement records that the specialist viewed the result; it does not approve a transaction, resolve a finding, verify a financial fact, or activate a methodology.

## Publication and freshness

- Transaction assessments require a current document review and finished source processing. Company-health workspaces use the explicit company-purpose contract below and require finished source processing; their financial-source, verification, bridge and method gates remain identical. Unsupported secondary exposure kinds remain blocked.
- A completed Assessment can have a blocked financial component and null numeric outputs. `state=completed` describes result creation, not financial eligibility.
- Publishing an experimental score/band requires an active server-side method approval artifact, the approved industry scope, consistent verified inputs and all seven metrics. No weight redistribution or inferred zero is allowed.
- The financial registry reports ratios and source facts; it does not publish Assessment points independently.
- PD and credit grade remain null. AIC-F1–F5 are experimental index bands, not calibrated credit ratings.
- Store and inspect the immutable method version/hash, policy version, source snapshot hash, components and exact calculation trace. Display rounding does not determine bands.
- Source, statement set, case/role, waiver, request or policy changes can invalidate a result. Result-only Assessment/acknowledgement audit events do not change source facts. Missing audit coverage is treated conservatively as stale.
- Replacing a source or changing a counterparty revision does not carry over human verification. Historical results remain retrievable with their stale status.

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `ASSESSMENT_NOT_READY` | 409 | Current review/source processing prerequisites are not met; inspect blockers |
| `STALE_ASSESSMENT` | 409 | Sources changed before acknowledgement |
| `ASSESSMENT_ALREADY_ACKNOWLEDGED` | 409 | This result already has an acknowledgement |
| `REVISION_CONFLICT` | 409 | Reload current case revision before explicitly retrying |
| `INVALID_INPUT` / contract validation error | 422 | Invalid shape, UUID or pagination |
| `SESSION_EXPIRED` | 401 | Sign in again; writes are not automatically replayed |
| `NOT_FOUND` | 404 | Resource unavailable within the caller's allowed scope |

Existing foundation error handling and tenant boundaries also apply. Do not rely on an error message to distinguish another tenant's resource from an absent resource.

## Persistence and runtime grants

Apply migration `0019_assessments.sql` using the explicit migration runner and operator connection, after a backup. Runtime connections must not own migrations. The API role needs SELECT/INSERT on the two new append-only tables; the extraction worker does not. See `apps/api/src/financial/assessment-runtime-grants.sql`.

The migration is immutable after application. Use a new migration for later persistence changes. This bundle's build/typecheck status is separate from manual browser acceptance; consult the implementation/UAT report for executed scenarios and remaining limits.

## Company-health workspace v1 (optional schema expansion)

`POST /company-assessments` accepts only `schema_version=AIC-COMPANY-HEALTH-1`,
`counterparty_id` and an explicit reason. Same authenticated session, Origin/CSRF,
idempotency, tenant/counterparty access and creator case-membership controls apply.
The `Workspace` union preserves the unchanged transaction `Case` and adds
`CompanyHealthCaseV1`: purpose `company_health`, true null exposure/kind/lifecycle/
transaction policy. Company assessments have a null transaction review and policy;
this is permitted only for the explicit company discriminator. No fake transaction
or exposure version is created.

Migration0020 is additive and currently validated only on disposable PostgreSQL.
It is not applied to the live demo. `GET /company-assessments/capabilities` exposes
availability after session validation; absent expansion means creation503
`COMPANY_HEALTH_SCHEMA_REQUIRED`, while legacy0019 installations keep working.
The startup check validates the installed expansion checksum. Never run migrations
implicitly during startup or to make the UI demo pass.

See `docs/implementation/AIC-COMPANY-HEALTH-CONTRACT-V1.md` for snapshot semantics,
backup/rollback and the controlled rollout boundary. See the remediation report
section9 for real Chrome company creation/verification/trend/report evidence and
the distinction between synthetic fixture verification and real-company evidence.
