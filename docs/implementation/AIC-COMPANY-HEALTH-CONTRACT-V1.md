# Company financial-health workspace v1

Local implementation of the owner's company-first scope, 2026-10-18. This contract is additive to the existing transaction endpoints. It does not authorize migration of the live demo database.

## Wire contract

- `GET /api/v2/company-assessments/capabilities` returns `{schema_version: "AIC-COMPANY-HEALTH-1", available: boolean}` after session validation. False means the expansion migration is absent; creation fails closed with `COMPANY_HEALTH_SCHEMA_REQUIRED` (503).
- `POST /api/v2/company-assessments` accepts `{schema_version: "AIC-COMPANY-HEALTH-1", counterparty_id: UUID, reason: nonblank string}` and an Idempotency-Key. No exposure, amount, term, role, lifecycle or transaction policy is accepted.
- The result is a company-health case: `purpose: "company_health"`, `exposure_kind`, `lifecycle_stage`, `exposure`, `policy_version`, `policy_artifact_hash` all null. Common case identity, membership, revision, audit, document, financial set and assessment routes remain in use. `Workspace` is the union of the unchanged transaction `Case` and `CompanyHealthCaseV1`.
- A company assessment has `purpose: "company_health"`, null transaction policy and null transaction review. Transaction assessments retain their original required policy and review. Both use the same FHI engine, method-policy approval, financial scope/exclusion rules, verification, bridge and source-currentness gates. PD remains null.
- Transaction review, exposure edits, requests and questionnaires are not part of a company workspace. Their transaction-policy guards remain closed for company cases. Creating a company case is not creating an exposure declaration or approving a policy.

## Snapshot and authorization

Same organization, active specialist session, counterparty access lock, creator membership trigger, case ACL and frozen idempotent replay as transaction creation. Reason is recorded in the audit event. Financial snapshots already include counterparty revision/identity, document lineage/decisions, facts and verification. Company assessment publication additionally snapshots its purpose and method policy. Any source changes invalidate the appropriate current verification and assessment without rewriting history.

Company assessments may persist an explicit blocked result while financial input is missing/unverified, provided source jobs are idle. No transaction review run or fictional contract is required. An eligible numeric result still requires all existing financial gates and approved method policy.

## Database expansion and rollback

Migration 0020 adds an immutable purpose discriminator defaulting to `transaction`. Existing rows retain their complete exposure and policy values. Four transaction columns become nullable only under a new check requiring ALL transaction fields to be null for company cases and nonnull for transaction cases. The existing amount/roles/object/term expressions are retained verbatim inside purpose guards. No row is deleted, reinterpreted, reseeded or updated by application code during migration. Existing policy immutability and membership triggers remain.

Apply only to a disposable PostgreSQL cluster for this implementation's validation. Before any operator-approved rollout: take and verify a private backup, record existing row counts/hashes, run migration in a transaction during a suitable lock window, validate legacy rows and grants, then release the matching application. Do not run the generic migration launcher against `aic_mvp_demo`.

Rollback application first to a version that understands the union. Do not use an old transaction-only binary against a database containing company cases. If no company rows exist, an operator may transactionally restore the original checks/NOT NULLs and remove the purpose column/trigger. Once company records exist, prefer a forward fix; preserve records and audit history. No automatic down migration or deletion is supplied.
