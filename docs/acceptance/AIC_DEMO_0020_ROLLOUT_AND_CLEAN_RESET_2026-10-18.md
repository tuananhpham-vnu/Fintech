# Owner-approved0020 rollout and one-time clean demo reset — 18/10/2026

**GO / DONE for the authorized local-demo migration and clean reset.** Final verification: 2026-10-18T07:32:24.670Z. Main target is exactly127.0.0.1:5432/aic_mvp_demo. This replaces the earlier GateA NO-GO and pending-login report; the owner explicitly approved the bounded one-time immutable-deletion exception and then personally completed clone sign-in.

## Gate results

| Gate | Result and evidence |
| --- | --- |
| 0 — exact scope/account | PASS. Same local PostgreSQL18.4 cluster SHA256 1d3e87716a41c966bc5ae7969607050c0ad1a5a515c524d12205a54d9572acee;47 tables;0019 and0020 canonical checksums verified; one active Sandbox specialist with the same user/organization identity. Owner classified the demo business/history as disposable test data; no contrary production/legal-retention evidence was found. |
| 1 — protected new backup + actual restore | PASS. New encrypted full custom dump and external file backup; actual separate-cluster restore17433, all47 full table fingerprints, user/organization, ledger, sources, ACLs, functions, triggers and constraints checked. |
| 2 — migration/reset/rollback/protections/real Chrome | PASS. Official0020 runner; exact atomic rollback and committed purge rehearsals;34 named guards restored;65 DELETE/UPDATE denials plus TRUNCATE/ACL/FK enforcement; owner fresh UI login; real Chrome counterparty and company_health create; true SQL NULL transaction fields. |
| 3 — main rollout and clean reset | PASS. Only owned main writers stopped. Official0020 runner applied exactly one migration; identical rehearsed reset script/hash; all41 non-preserved tables empty;34 guards restored before COMMIT; exact backed-up cache file quarantined. |
| 4 — main Chrome and final handoff | PASS within reset scope. Sandbox specialist retained access after restart, cases/counterparties empty, capability available:true, company form usable without schema warning, form cancelled with zero new main business records. Old-case URL no longer returns case/history. |

## Exact target and account preservation

Source/main:127.0.0.1:5432/aic_mvp_demo, Windows PostgreSQL18.4, same cluster fingerprint as the pre-approval record. Schema now has20 canonical migrations.0020 checksum: d517cda042fc22a2ae7ace6351fe41478097722b84371da0d5c4463c230bf6ce.

Exactly one active user, Sandbox specialist / specialist, and its sole required organization remain. users, organizations, mvp_capability_limits and mvp_policy_artifacts whole-table fingerprints are unchanged from the full pre-reset backup. Required schema/role grants/configuration remain. Existing32 sessions contain only auth user/organization references and were retained as authentication metadata; login_attempts was cleared. No case membership, old case policy assignment, invitation, response, idempotency or audit/history row remains. No original password, authentication hash, cookie or token was printed, separately extracted/exported, changed or replaced. Full authentication data exists only inside the protected full backup/restore, as required for recovery.

The owner personally logged in on the clone using a clone-only cookie name; a fresh session for the exact preserved account was confirmed without reading its secret. Actual main access after restart used its retained owner session. A second fresh password submission on main was not requested or claimed. Main user/organization/config fingerprints remain identical to the account that passed fresh clone login.

## New backup and actual recovery proof

Protected operator directory: C:\Users\52duc\AppData\Local\AIC\rollout-reset-20261018-SN4TvQ. Outside Git and outside the cleaned storage root. NTFS inheritance disabled at the directory; allow entries limited to current Windows user/SYSTEM/Administrators. Backup inherits these permissions. Quarantined main file has an explicitly restricted ACL too.

- Backup: backup.dpapi, 8252694 encrypted bytes. SHA256: 9b59f3e1a8ad6195fe641d25533afa64b2116ebbf9c1027c6b0f944774054341.
- In-memory PostgreSQL custom dump: 5993826 bytes. SHA256: f88df40b990e57701d163bbe92cfc93b51aea52f0e4ef3d89a412169bfc40346. Baseline fingerprints and pg_dump use the same exported repeatable-read snapshot. Zero plaintext dump files.
- Encryption: Windows DPAPI CurrentUser. Persisted ciphertext decrypt/hash roundtripPASS; final ciphertext checksum recheckPASS. Recovery requires this Windows account/profile; no encryption key exported.
- Actual pg_restore --exit-on-error --single-transaction into the newly created owned cluster127.0.0.1:17433/aic_mvp_demo, distinct cluster identity/data directory. All47 table contents, ledger, auth/organization, ACLs, triggers, functions and constraints matched before rehearsal. No restore into main.
- Bytea sources recovered/hash-checked:19 PDFs /4,251,904bytes;1 dossier archive /474,648bytes;2 member objects /499,495bytes. The one external2,566-byte cache object was restored to a confined private path and hash-checked, then exact-path quarantine was rehearsed.
- PostgreSQL re-associated AND parentheses for four CHECK definitions during dump/restore. Each original CHECK was independently reparsed on a temporary empty clone table by the same PostgreSQL18.4 parser and exactly matched the restored definition. Probe transactions rolled back. No broad string normalization or weakening of constraints.

The live rehearsal cluster was subsequently migrated/purged and contains the single synthetic UI acceptance case. It is not a pristine copy of the original business data. The encrypted pre-reset backup is unchanged and is the recovery source. Older backups were not substituted for this run.

## Exact reset procedure and trigger inventory

Procedure: owner-reset.cjs in the protected operator directory. SHA256 baa352ad2b9e4e380054ef3446a3d2003411ff4bbf2711166589b42f78cfdbe2. The same hash is recorded in clone Gate2 and main reset receipts. It acquires explicit access-exclusive locks with a bounded lock timeout; disables only the34 named statement-level unconditional deletion-rejection triggers below; DELETEs the41 non-preserved tables in actual nondeferred-FK dependency order; drains the already-deferrable current-document FK using SET CONSTRAINTS ALL IMMEDIATE; enables every named guard; compares complete trigger/function/ACL/constraint definitions/states and preserved-table fingerprints; checks all purged tables zero; only then COMMITs. FK checks, ACLs and the other application triggers stay active throughout.

No global trigger disable, session_replication_role change, unknown CASCADE, permanent protection change, table/schema/database DROP, FK/ACL/RLS weakening, database switch or fixture reseed occurred. Both rollback and commit were rehearsed on the task-created restore clone before main execution.

| Table | Exact temporary guard | Function | Main transaction state |
| --- | --- | --- | --- |
| aic.assessment_acknowledgements | assessment_acknowledgements_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.assessments | assessments_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.audit_events | audit_events_append_only | reject_audit_event_mutation | O → D → O |
| aic.mvp_counterparty_versions | mvp_counterparty_versions_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_document_decisions | mvp_document_decisions_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_document_objects | mvp_document_objects_immutable | reject_mvp_document_mutation | O → D → O |
| aic.mvp_document_replays | mvp_document_replays_immutable | reject_mvp_document_mutation | O → D → O |
| aic.mvp_document_requests | mvp_requests_no_delete | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_document_results | mvp_document_results_immutable | reject_mvp_document_mutation | O → D → O |
| aic.mvp_documents | mvp_documents_immutable | reject_mvp_document_mutation | O → D → O |
| aic.mvp_dossier_archive_objects | mvp_dossier_archive_bytes_immutable | reject_mvp_document_mutation | O → D → O |
| aic.mvp_dossier_archives | mvp_dossier_archives_no_delete | reject_mvp_document_mutation | O → D → O |
| aic.mvp_dossier_member_objects | mvp_dossier_member_bytes_immutable | reject_mvp_document_mutation | O → D → O |
| aic.mvp_dossier_members | mvp_dossier_members_no_delete | reject_mvp_document_mutation | O → D → O |
| aic.mvp_exposure_source_bindings | mvp_exposure_source_bindings_immutable | reject_mvp_policy_exposure_mutation | O → D → O |
| aic.mvp_exposure_versions | mvp_exposure_versions_immutable | reject_mvp_policy_exposure_mutation | O → D → O |
| aic.mvp_financial_facts | mvp_financial_facts_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_financial_sets | mvp_financial_sets_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_financial_source_bindings | mvp_financial_sources_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_financial_verifications | mvp_financial_verifications_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_invitation_revocations | mvp_invitation_revocations_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_invitations | mvp_invitations_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_issue_decisions | mvp_issue_decisions_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_policy_assignments | mvp_policy_assignments_immutable | reject_mvp_policy_exposure_mutation | O → D → O |
| aic.mvp_questionnaire_events | mvp_questionnaire_events_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_questionnaires | mvp_questionnaires_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_request_history | mvp_request_history_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_respondent_submissions | mvp_respondent_submissions_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_response_bindings | mvp_response_bindings_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_response_verifications | mvp_response_verifications_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_review_runs | mvp_review_runs_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_staff_responses | mvp_staff_responses_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_waiver_revocations | mvp_waiver_revocations_immutable | reject_mvp_workflow_mutation | O → D → O |
| aic.mvp_waivers | mvp_waivers_immutable | reject_mvp_workflow_mutation | O → D → O |

All34 guards restored before main COMMIT; all45 application triggers now enabled. Their definitions and the pre-existing functions/ACLs are unchanged.96 FKs validated;0 unvalidated constraints;117 ready/valid indexes,0 invalid. On the clone,65 DELETE/UPDATE probes rejected with55000; explicit known-business-set TRUNCATE rejected with55000; aic_runtime_api audit DELETE rejected with42501; invalid company FK rejected with23503; changing the UI-created case purpose rejected with23514. All mutation probes rolled back. Main enforcement is evidenced by identical enabled guard/function definitions plus the isolated enforcement tests; no extra destructive main probes were run.

## All47 before/after table counts

Clone column is immediately after reset, before its synthetic UI creation. Main final column was checked after real Chrome actions and restart. The ledger increases19→20; four configuration/auth scaffold tables remain1;32 auth-only sessions remain. All other41 tables are0. Removed total:496 rows, including2 login-attempt records. No new main business records created.

| Table | Main backup before | Clone immediately after purge | Main final |
| --- | ---: | ---: | ---: |
| aic.assessment_acknowledgements | 3 | 0 | 0 |
| aic.assessments | 14 | 0 | 0 |
| aic.audit_events | 121 | 0 | 0 |
| aic.case_memberships | 8 | 0 | 0 |
| aic.cases | 8 | 0 | 0 |
| aic.counterparties | 3 | 0 | 0 |
| aic.idempotency_keys | 84 | 0 | 0 |
| aic.login_attempts | 2 | 0 | 0 |
| aic.mvp_capability_limits | 1 | 1 | 1 |
| aic.mvp_counterparty_versions | 1 | 0 | 0 |
| aic.mvp_document_decisions | 10 | 0 | 0 |
| aic.mvp_document_jobs | 19 | 0 | 0 |
| aic.mvp_document_lineages | 17 | 0 | 0 |
| aic.mvp_document_objects | 19 | 0 | 0 |
| aic.mvp_document_replays | 17 | 0 | 0 |
| aic.mvp_document_requests | 4 | 0 | 0 |
| aic.mvp_document_results | 29 | 0 | 0 |
| aic.mvp_documents | 19 | 0 | 0 |
| aic.mvp_dossier_archive_objects | 1 | 0 | 0 |
| aic.mvp_dossier_archives | 1 | 0 | 0 |
| aic.mvp_dossier_member_objects | 2 | 0 | 0 |
| aic.mvp_dossier_members | 2 | 0 | 0 |
| aic.mvp_exposure_source_bindings | 1 | 0 | 0 |
| aic.mvp_exposure_versions | 9 | 0 | 0 |
| aic.mvp_financial_facts | 42 | 0 | 0 |
| aic.mvp_financial_sets | 3 | 0 | 0 |
| aic.mvp_financial_source_bindings | 0 | 0 | 0 |
| aic.mvp_financial_verifications | 6 | 0 | 0 |
| aic.mvp_invitation_revocations | 2 | 0 | 0 |
| aic.mvp_invitations | 3 | 0 | 0 |
| aic.mvp_issue_decisions | 0 | 0 | 0 |
| aic.mvp_policy_artifacts | 1 | 1 | 1 |
| aic.mvp_policy_assignments | 2 | 0 | 0 |
| aic.mvp_questionnaire_events | 5 | 0 | 0 |
| aic.mvp_questionnaires | 4 | 0 | 0 |
| aic.mvp_request_history | 8 | 0 | 0 |
| aic.mvp_respondent_submissions | 3 | 0 | 0 |
| aic.mvp_response_bindings | 3 | 0 | 0 |
| aic.mvp_response_verifications | 0 | 0 | 0 |
| aic.mvp_review_runs | 18 | 0 | 0 |
| aic.mvp_staff_responses | 3 | 0 | 0 |
| aic.mvp_waiver_revocations | 0 | 0 | 0 |
| aic.mvp_waivers | 0 | 0 | 0 |
| aic.organizations | 1 | 1 | 1 |
| aic.schema_migrations | 19 | 20 | 20 |
| aic.sessions | 32 | 32 | 32 |
| aic.users | 1 | 1 | 1 |

## File quarantine, processes and protected operator record

Canonical bytes are in PostgreSQL. The single file under the exact configured C:/private/aic-mvp-cache/cache path was content-hash matched to a main canonical document, encrypted in the backup, restored and rehearsed, then moved by exact confined path into main-quarantine under this operator directory. Original identity/path/hash were checked; destination hash verified and ACL restricted. Active main cache now has0 files. Parent directories, unrelated sources, backups and old isolated fixtures were not deleted/moved. Original cache bytes remain recoverable from both protected backup and protected quarantine.

Main launcher30344 and its inventoried descendants were stopped after PID/start-time/parent/executable/command-line checks. A conhost exited with its owner before its final Stop-Process; inventory was rechecked empty before migration. PostgreSQL service and other pre-existing environments were not stopped. Main stack restarted through the existing scripts/dev-all.cjs --built-web on3000/3001/8100; configuration/source unchanged, API health/readyPASS. No source reseeding or migration on startup occurred. After acceptance, only the newly owned rehearsal API/web and cluster17433 were stopped; all clone data/receipts and encrypted backup are retained. Main3000/3001/8100 and PostgreSQL5432 remain running.

Protected operator-audit.json records timestamps, operator postgres, exact object names, all before/after counts, script hash, trigger checks, backup location/checksum and hashed receipts. It contains no password/token/source-document content. Public repository reports contain no business values, source PDF bytes or personal identity metadata.

## Verification coverage and practical limits

- PASS lint, typecheck, API build and web production build.
- PASS72 frontend unit tests,20 frontend integration checks,66 focused API/FHI/trend/boundary tests. No broad suite that creates/drops other databases was invoked.
- PASS actual restore, official migration, rollback/commit reset, preserved-auth/config fingerprints, FK/ACL/guard enforcement and exact file quarantine on the owned clone.
- PASS actual Chrome owner fresh sign-in and synthetic company creation on3200; database confirms company_health with exposure_kind/lifecycle_stage/exposure_json/policy_version/policy_artifact_hash all true SQL NULL and creator membership.
- PASS actual Chrome main3000: VI lists empty, form opens/focuses without schema warning and cancels, API capability available:true, stale case inaccessible. Main fresh password sign-in was not repeated; preserved authenticated access works. Main remained empty after all UI checks.
- Current run uses VI on main and EN on clone; it does not re-claim earlier full three-locale/all-viewport product acceptance. Empty-list helper copy still mentions a first transaction; this is a copy limitation, not schema unavailability or persisted data.
- No real-company score published, no financial method approval manufactured, no FHI formula/weights/verification change. Prior HK VINA5/9 source usability remains historical BLOCKED evidence and was not used to claim verification/scoringPASS. Its old active business/source/history rows are removed from main and preserved only in backup.

## Recovery and handoff

Keep backup.dpapi, this Windows DPAPI user profile, receipts and quarantined file secure. Verify ciphertext checksum before recovery. The same backup has already been restored and compared on a separate owned cluster. A future main recovery must first quiesce only owned writers and follow a separately scoped recovery plan using a fresh authorized isolated restore; do not run pg_restore over the clean main or assume the mutated rehearsal clone still holds old records. No automatic main overwrite, broad DROP, rollback through deletion of configuration, or backup cleanup was performed.

Hand-off URL:http://127.0.0.1:3000/cases. Owner account retained; main has no company/case/document/financial/assessment/job/audit business data. To start from empty, add the first counterparty/company, then create a company-health case. The form submit button remains correctly disabled until required company and reason are supplied; the schema migration warning is gone. This is the completed reset scope, not a claim of whole-product/real-company scoring acceptance.

Branch duc and all pre-existing changes preserved. No code/source/environment edits, stage/commit/push/merge/deploy/Notion. Only the two acceptance reports were updated in the repository for this run; operator scripts/backups/evidence stay outside Git.
