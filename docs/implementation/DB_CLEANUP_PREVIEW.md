# AIC — Gate A read-only audit and Gate B preview

Subsequent conditional Gate B authorization and backup/restore execution are recorded in [DB_GATE_B_EXECUTION.md](DB_GATE_B_EXECUTION.md). The Gate A findings below remain the historical pre-change baseline; consult that execution report for current gate status.

Observed: 2026-10-17 18:33–18:37, Asia/Saigon. This is a sanitized audit report, not a backup or authorization to modify the database.

`TARGET_DB`: `aic_mvp_demo`, PostgreSQL Windows 18.4, `127.0.0.1:5432`.

`SCHEMA_VERSION`: 0017. All 17 applied migration checksums match canonical LF source; 0018 is the only pending repository migration.

Gate A was explicitly approved in `AIC_CODEX_APPROVE_GATE_A_READONLY_AUDIT.md`. Connections were pinned to the approved host/port/database, set `default_transaction_read_only=on`, and used read-only transactions. Counts, hashes and integrity checks ran inside PostgreSQL; original PDF bytes, extracted values, quotations, usernames, business names, connection credentials and tokens were not exported. Separate snapshots may differ if another process writes; recheck immediately before any approved maintenance.

## A. Exact inventory

Database allocation: **11,916,991 bytes (~11.36 MiB)**. Non-system schemas: `aic`, `public`; application tables are in `aic`. All 41 application tables are owned by `postgres`. No application views, materialized views, sequences or partitioned tables were found in `aic`.

There are **98 indexes (82 unique), zero invalid/not-ready indexes; 83 validated foreign keys and zero orphan rows across those relationships; 158 validated CHECK constraints**. All 35 non-internal application triggers are enabled. This establishes the checks performed, not a physical disk-corruption assessment or proof of every business invariant.

All counts below are actual `COUNT(*)` observations on this approved small database. Bytes are `pg_total_relation_size`, including indexes/TOAST, and are not a prediction of reclaimable disk space.

| Table in `aic` | Rows | Total bytes |
| --- | ---: | ---: |
| audit_events | 20 | 114688 |
| case_memberships | 2 | 57344 |
| cases | 2 | 98304 |
| counterparties | 2 | 81920 |
| idempotency_keys | 7 | 49152 |
| login_attempts | 1 | 24576 |
| mvp_capability_limits | 0 | 16384 |
| mvp_counterparty_versions | 0 | 24576 |
| mvp_document_decisions | 3 | 65536 |
| mvp_document_jobs | 7 | 98304 |
| mvp_document_lineages | 7 | 24576 |
| mvp_document_objects | 7 | 483328 |
| mvp_document_replays | 7 | 65536 |
| mvp_document_requests | 0 | 24576 |
| mvp_document_results | 9 | 114688 |
| mvp_documents | 7 | 98304 |
| mvp_exposure_source_bindings | 0 | 16384 |
| mvp_exposure_versions | 3 | 81920 |
| mvp_financial_facts | 0 | 32768 |
| mvp_financial_sets | 0 | 24576 |
| mvp_financial_source_bindings | 0 | 16384 |
| mvp_financial_verifications | 0 | 16384 |
| mvp_invitation_revocations | 0 | 24576 |
| mvp_invitations | 0 | 32768 |
| mvp_issue_decisions | 0 | 32768 |
| mvp_policy_artifacts | 1 | 81920 |
| mvp_policy_assignments | 2 | 49152 |
| mvp_questionnaire_events | 0 | 16384 |
| mvp_questionnaires | 0 | 24576 |
| mvp_request_history | 0 | 24576 |
| mvp_respondent_submissions | 0 | 24576 |
| mvp_response_bindings | 0 | 16384 |
| mvp_response_verifications | 0 | 32768 |
| mvp_review_runs | 1 | 65536 |
| mvp_staff_responses | 0 | 49152 |
| mvp_waiver_revocations | 0 | 24576 |
| mvp_waivers | 0 | 24576 |
| organizations | 1 | 32768 |
| schema_migrations | 17 | 32768 |
| sessions | 15 | 57344 |
| users | 1 | 65536 |

## B. Provenance and cleanup manifest

The seven canonical source objects contain **394,591 bytes**. Database-side recomputation found zero SHA-256 or byte-length mismatches. Every object has a document, and every lineage resolves to its exact current document.

The following aliases describe this audit only; they are not maintenance selectors. Classification uses exact SHA-256 and byte-size matches against locally read repository fixtures, never filename/age/mode alone.

| Source | Bytes / pages | Evidence | Classification | Action proposed |
| --- | --- | --- | --- | --- |
| S1 | 363321 / 8 | No match in checked fixture catalog | REAL_OR_UNKNOWN_PROTECT; origin unverified | KEEP |
| S2–S4 | 865 each / 1 each | Exact `registration-0000000002.pdf` fixture bytes | SYNTHETIC_CONFIRMED sources | KEEP; S4 has three human classification decisions |
| S5 | 2566 / 4 | Exact frontend `contract.pdf` fixture bytes | SYNTHETIC_CONFIRMED source | KEEP |
| S6 | 25244 / 1 | Exact contracts `04_contract.pdf` fixture bytes | SYNTHETIC_CONFIRMED source | KEEP |
| S7 | 865 / 1 | Exact `registration-0000000001.pdf` fixture bytes | SYNTHETIC_CONFIRMED source | KEEP |

Confirmed synthetic source payload totals **31,270 bytes**. These matches establish source content, not that the entire case, tenant, review history or all its dependencies can be deleted. No claim that S1 is real or corrupted is established. All seven documents have stored `ai_mode=live`; this is processing metadata, not proof of a successful external model/OCR call or authorization for another call.

The policy artifact matches the repository's sandbox policy hash. This confirms that policy artifact, not the provenance of the organization, users, counterparties or case contents. No durable seed-run marker establishing safe deletion of those identities was found in the bootstrap design. Keep their classification REAL_OR_UNKNOWN_PROTECT / UNKNOWN_REVIEW.

| Group | Observed state | Classification / cleanup decision |
| --- | --- | --- |
| Jobs | 6 succeeded, 1 failed; all mode live; no queued/running or currently claim-eligible jobs | Protected operational history; KEEP |
| Failed job | `PROVIDER_UNAVAILABLE`; three retained failed attempt results across jobs | Availability outcome, not garbage or invalid-PDF proof; KEEP |
| Published extraction | 6 results; 5 zero-usable under current usable-field rules | Valid business states; KEEP |
| Evidence | 8 evidence items; no observed source/page mismatch, missing field reference or duplicate evidence ID in published results | Source-bound evidence; KEEP |
| Human decisions | 3 classification decisions; no correction/verification rows | Protected human history; KEEP |
| Review / exposure | 1 review run; 3 exposure versions | Protected snapshots/history; KEEP |
| Sessions | 15; zero revoked or absolute-expired at observation | No expired/revoked cleanup set. Idle expiry/retention not used as deletion authority; KEEP |
| Replay receipts | 7 generic + 7 document; zero expired at observation | KEEP even after expiry: deletion would allow key reuse / duplicate operations |
| Auth throttle | 1 login-attempt row | No approved retention policy; KEEP |
| Financial registry | Zero sets/facts/verifications; both cases have null method version | Preserve FHI/method gates; do not seed facts/scores |
| Empty application tables | See inventory | Empty tables are schema, not disposable data; KEEP |

**Proposed delete/soft-delete/archive/move set: zero rows and zero files. Reliably reclaimable space established by this audit: zero bytes.** No unconditional EPHEMERAL_SAFE set is established. Do not disable immutable triggers, delete expired idempotency keys, reset job attempts or remove a failed/zero-usable source to make the UI look clean.

## C. Dependencies and integrity limits

Organization/user/counterparty identities and memberships anchor cases. Cases anchor policy/exposure snapshots, source objects and document lineages. Each canonical document binds exact version/hash/size to immutable bytes, then jobs/results/replays. Human decisions, review snapshots and evidence bind those source versions; embedded JSON references also matter beyond relational FKs.

All 83 FKs use RESTRICT (16) or NO ACTION (67); none authorizes cascading cleanup. Audit, canonical objects/documents/results/replays, human decisions, policy/exposure and workflow histories have enabled mutation guards. Six SECURITY DEFINER functions are owned by `postgres` with `search_path=pg_catalog`. No explicit PUBLIC application-table ACL entries were found. Application tables do not use RLS; tenant/case isolation relies on restricted runtime roles, application predicates and the reviewed locking functions.

Hash checks, FK checks and evidence-reference/page checks passed. This audit did not reread the unknown PDF through OCR/model, validate its business content, call any provider or re-run human workflows. No active other connection was observed during the inventory snapshot; this does not replace an approved maintenance window or writer quiescence check.

## D. Storage and runtime readiness

- Launcher-resolved private cache: `C:\private\aic-mvp-cache`. Root and cache are not reparse points and are owned by the current user. Root ACL inheritance is protected; the cache child inherits restricted permissions. Both have zero allow rules for principals outside current user/SYSTEM/Administrators. It contains one cache file, **2,566 bytes**. Metadata only was read; content/ownership by a current job is not proven, so do not call it an orphan or delete it.
- Direct API fallback: workspace `storage`, containing `staging` with **10 files / 77,412 bytes**. Root inherits ACLs and has two allow rules outside the private-cache trusted set. Its current active use is not established. Do not use this fallback for real documents or delete/move its files without provenance/approval.
- Canonical accepted sources are PostgreSQL bytea; filesystem cache is not a substitute backup. No configured external object store was identified in the reviewed local document path. Other unconfigured locations were not scanned.
- Only `postgres` is a login role; it is superuser/table owner with role/database creation and bypass-RLS privileges. No reviewed restricted API or extraction login role is currently provisioned. This is a prerequisite for real-data readiness, not evidence of a damaged database.
- `scripts/dev-all.cjs` starts only the extraction worker, not the dossier intake worker; it forces API/extraction `live` mode and shares their DB connection. Do not start that launcher to perform a synthetic-only check on this database. Workers have no case/archive selector and can mutate any eligible work, including retries; `--once` is also a write operation.
- API startup currently fails the migration-readiness check because 0018 is absent. Mapping routes is not successful startup. Restoring startup alone does not establish grants, worker health or browser acceptance.

## E. Backup and restore plan — NOT EXECUTED

`pg_dump` and `pg_restore` **18.4** are installed. C: has approximately **63.0 GB** free at observation. Tool versions/free space are prerequisites only. **BACKUP_VERIFIED = NOT_RUN; RESTORE_VERIFIED = NOT_RUN.** No dump, backup directory, archive schema or restore cluster was created.

Proposed location, requiring Gate B approval: `C:\Users\52duc\AppData\Local\AIC\backups\<approved-run-id>`. The parent does not currently exist. It is outside the repository and normal public/sync locations; confirm local redirection/sync policy before creation. Provision a new directory with inheritance disabled and access limited to current user/SYSTEM/Administrators. Encrypt backup content before writing it to disk, using an approved recoverable local mechanism. A Windows DPAPI CurrentUser envelope is one proposed local mechanism: it depends on retaining that Windows account/profile and its recovery material and is not a portable recovery key. Never leave a plaintext dump in TEMP/repo or export source PDFs separately.

After approval, use PostgreSQL custom-format dump (`pg_dump -Fc`) with securely injected connection credentials and bounded lock waits; do not put passwords/URLs in command arguments or logs. Record sanitized target identity, timestamp, byte length, cryptographic digest and source inventory signature, plus owner/grant metadata needed for restoration. Do not dump all cluster roles/passwords indiscriminately.

Verification must decrypt in memory, run `pg_restore --list`, and restore into a **new, approved, isolated loopback test instance**, without connecting restore output to the source DB or altering any existing TEMP cluster. Verify full table counts, 0001–0017 checksums, canonical source SHA/length, source/version/lineage associations, evidence/review/audit counts, constraints/triggers and the required ownership/ACL mapping. A TOC listing or `pg_dump` exit zero alone is insufficient. Test and document the account/key recovery dependency. No cloud upload.

Proposed retention: retain the verified encrypted pre-change backup until the owner accepts post-change verification and explicitly approves later disposal; this report authorizes no automatic deletion. Backup/restore tests can expose protected contents to the isolated local instance, so that instance also requires private filesystem access and no workers/providers.

## F. Maintenance proposal — no commands below have been executed

1. Reconfirm `aic_mvp_demo@127.0.0.1:5432`, approved maintenance window, no writers, source counts/checksums and exactly one pending migration. Snapshot current ACLs/ownership and inventory. Stop on drift, an occupied restore port, changed target, missing recoverable encryption, or a failed verification; do not stop an unrelated service.
2. Create and verify the encrypted local backup/isolated restore described above. **No cleanup:** keep every current row and file, including fixture sources and failed jobs.
3. Review/apply **only** `0018_mvp_dossier_intake.sql` through the official checksum-tracked runner, with securely supplied owner credentials and a bounded lock timeout. Review the exact migration digest again at execution. Do not execute its SQL directly or rewrite older migrations. The runner applies every pending file, so stop if anything besides 0018 is pending.

   Proposed existing command: `pnpm api:migrate` (requires a current prebuilt API and securely preloaded `DATABASE_URL`; it does not load `.env`). Expected `applied` list: exactly `0018_mvp_dossier_intake.sql`.

4. Provision separately approved nonowner restricted roles, proposed names `aic_runtime_api` and `aic_runtime_worker`, with no superuser/createdb/createrole/replication/bypass-RLS or privileged memberships. Provision credentials locally without printing them or changing `.env`. Grant the explicit baseline table/column/function privileges needed by each role, then the narrow dossier delta to API/intake. Because roles do not exist, the dossier delta by itself is insufficient. Do not blanket-run the sandbox grant file's `SELECT ON ALL TABLES` against the owner DB; use an explicit reviewed application-table list. No PUBLIC grants or ownership transfer. Inventory pre/post privileges, including PUBLIC execute defaults of the new ordinary trigger functions.

   Proposed delta command after role/baseline checks: `psql -X --set=ON_ERROR_STOP=1 --single-transaction --set=api_role=aic_runtime_api --file=apps/api/src/documents/dossier-runtime-grants.sql`, using a securely preloaded approved local connection service/environment. Extraction gets no dossier-table access; its existing baseline reads include the updated cases/lineages columns.

5. Verify old tables/counts/source hashes/lineages/evidence/review/audit/replay data unchanged, two added columns with defaults, four new empty dossier tables, constraints/indexes/triggers present, ledger 0018 once with matching checksum, and exact effective grants. Readiness via read-only checks only at this maintenance gate; do not start API/workers or run synthetic imports on the owner database under this proposed approval.
6. Prepare a separate reviewed local-only synthetic runtime configuration for later authorization: API/intake role distinct from extraction role, explicitly offline proposer/network guard, private cache, and intake plus extraction processes. The current launcher requires a reviewed change or separate manual launch setup before it can satisfy this. No live model/OCR calls, real dossier upload, synthetic writes or browser acceptance are included in the maintenance proposal.

0018 preflight: its four table names and two column names do not yet exist; referenced tables/functions exist. The two new unique constraints include the already-unique document/job IDs, so current IDs satisfy the uniqueness requirement. DDL is additive and defaults preserve existing lineages as `legacy`, cases as zero pending; no seeds/FHI changes. It still takes locks and creates indexes, and therefore requires a tested maintenance window. Prior disposable-cluster tests in the API contract are historical source evidence, not evidence 0018 has been applied here.

Rollback: failure during 0018 rolls back that migration's DDL and ledger insert together. After successful commit there is **no down migration**. Grant/provisioning changes are separate and must use captured pre-change ACLs for precise reversal; do not change global PostgreSQL configuration. Prefer stopping enablement and retaining a verified additive schema over an improvised destructive rollback. Restoring the owner database is a separate destructive recovery decision requiring explicit approval, writer quiescence and accounting for every post-backup change. Never use DELETE/TRUNCATE/trigger disabling as rollback. Existing other databases, test clusters and files remain untouched.

## G. One Approval Gate B — pending

Request approval for this exact maintenance scope: **create a protected encrypted backup at the proposed local path; verify restore in a new isolated instance; only if verification passes, apply 0018 through the official runner and provision the two reviewed restricted roles/baseline plus narrow dossier grants on the confirmed database; verify unchanged old data.** Cleanup remains **zero rows / zero files**. No `.env` changes, API/worker starts, fixture imports, real-document use or external AI calls are included. Unexpected drift or failed backup/restore/grant checks stops the run before further mutation.

This report records an audit and proposed sequence only. Gate A is complete; Gate B has not been granted. The only workspace addition is this sanitized Markdown report; application code, Frontend, runtime settings and database contents were not changed.
