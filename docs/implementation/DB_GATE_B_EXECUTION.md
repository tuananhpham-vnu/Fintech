# AIC — Gate B execution evidence

Date: 2026-10-17, Asia/Saigon. Authorization: `AIC_CODEX_GATE_B_SAFE_BACKUP_RESTORE_MIGRATION_0018.md`. This report contains no credentials, keys, source PDF content or business values.

`TARGET_DB`: `127.0.0.1:5432/aic_mvp_demo` (Windows PostgreSQL 18.4).

`SCHEMA_VERSION`: **0018 applied on the existing main database**. Credential provisioning was explicitly approved by the owner in the follow-up reply; credentials are encrypted outside the repository.

| Gate | Status | Evidence |
| --- | --- | --- |
| B1 | PASS for target/source/migration checks | Exact approved identity; all 17 checksums match; only 0018 pending; no other DB connections; no queued/running jobs; DPAPI synthetic memory roundtrip passed |
| B2 | PASS | Consistent PostgreSQL custom dump encrypted before disk write; persisted ciphertext read/decrypt/hash checks passed; restricted NTFS directory verified |
| B3 | PASS | Actual restore on 16432; all 41 table fingerprints/migrations match; source/review/evidence preserved; SCRAM positive/negative authentication and actual restricted-role reads/ACL denials passed |
| B4 | PASS | Official runner applied only 0018; two restricted roles provisioned with reviewed bounded grants; main source/review/evidence and every pre-existing application table remain unchanged |
| B5 | PASS for offline API/runtime scope | Restored-copy HTTP suite 10/10 passed; existing main DB API, intake and extraction processes running with verified restricted roles; AI is local/mock; zero main fixture imports |

## Backup and restore evidence

Private run directory: `C:\Users\52duc\AppData\Local\AIC\backups\gate-b-20261017-121117`.

Encrypted backup: `backup.dpapi`, **837,718 bytes**. Ciphertext SHA-256:

`b66a1ecff0197f0fd491f2525c2c4038a9802c25664d9c13a2ebcf3b4f7bd598`

In-memory custom dump: **622,201 bytes**. SHA-256:

`6abb8e4439a1a9dad7d846b6d6c9361194ff3ca94783b14c0c8b157e5f5599bd`

Encryption uses Windows DPAPI CurrentUser. Recovery was actually tested with this Windows account/profile; the backup is not independently portable to another account/machine. Preserve this account/profile and associated recovery material. No encryption key was exported. The backup parent is outside the repo; the run directory is not a reparse point, is owned by the current user, has inheritance disabled and no allow rules beyond current user/SYSTEM/Administrators.

`backup.dpapi` contains the custom-format schema/data dump plus encrypted baseline table fingerprints, migration checksums and relevant nonsecret role/membership metadata. The only existing application object owner/login role is `postgres`; the restore cluster provisions the same role name with a separate local test password. Existing application-user authentication hashes are included in the dump and covered by the restored users-table fingerprint. The original PostgreSQL superuser password is not copied into the archive as a separate credential and is not required to recover its object ownership on the separate instance.

Restore directory: `restore-cluster` inside that same private run directory. A fresh PostgreSQL cluster was initialized with SCRAM authentication on **16432** and restored into its own database also named `aic_mvp_demo`; the source on **5432** was never a restore target. No pre-existing TEMP cluster was started/stopped/modified. The owned restore cluster stopped after each verification stage and was then restarted for the separately authorized synthetic smoke test. The cluster and encrypted backup are retained.

Plaintext dump files written: **0**. The newly created private bootstrap password file used by `initdb` was removed immediately after initialization; its encrypted connection envelope remains in `restore-connection.dpapi`. No pre-existing file or business data was deleted.

Commands executed by the private local operator helper (credentials supplied only through process memory/environment):

- `pg_dump --format=custom --no-password --lock-wait-timeout=5s --snapshot=<exported snapshot>`; captured stdout in memory. Baseline and dump use the same read-only exported snapshot.
- DPAPI Protect → write ciphertext → read ciphertext → Unprotect → verify dump digest.
- `pg_restore --list` (precheck only), then **actual** `pg_restore --exit-on-error --single-transaction --no-password --dbname=aic_mvp_demo` on port 16432, with dump supplied through stdin.
- New-cluster `initdb` / `pg_ctl start` / `pg_ctl stop`, confined to the new private restore path.
- Authenticated PostgreSQL read-only queries against the restored copy; negative SCRAM password check returned `28P01`.

Private helper invocations: `node <private-run-directory>\operator.cjs backup`, `restore`, and `verifySource`; all completed with exit code 0. The helper code contains no passwords or connection strings with credentials. Sanitized `backup-receipt.json` and `restore-receipt.json` are in the private run directory.

## Data preservation checks

| Measure | Main baseline | Restored copy | Main recheck after restore |
| --- | ---: | ---: | ---: |
| Application tables | 41 | 41 | 41 |
| Migrations | 17 | 17 | 17 |
| Canonical source objects | 7 | 7 | 7 |
| Source payload bytes | 394591 | 394591 | 394591 |
| Source hash/length errors | 0 | 0 | 0 |
| Human decisions | 3 | 3 | 3 |
| Published evidence items | 8 | 8 | 8 |
| Pending/running extraction jobs | 0 | 0 | 0 |

Every existing table's full row-content fingerprint matched the backup after restore and matched the main database during the pre-migration read-only recheck, including source objects, users/authentication hashes, cases, ACLs, lineages, jobs/results, human decisions, review runs, audit, policy/exposure history, sessions and replay receipts. The unknown 8-page PDF is preserved without model/OCR access. FK and enabled application-trigger counts also matched between baseline and restored copy. This table records B2/B3 preservation checks before migration; subsequent restricted-role authentication and current post-migration counters are recorded below. Browser authentication remains unverified.

## Credential approval and completed B4

- Owner approved cryptographically random passwords for the exact existing runbook names `aic_runtime_api` and `aic_runtime_worker`, stored using DPAPI CurrentUser. `runtime-credentials.dpapi` contains independent 256-bit role passwords and the shared local offline internal key. Read/decrypt roundtrip passed; no password/key was printed, written plaintext or added to `.env`.
- Restricted roles were first created and authenticated on the restored copy; they are nonowners, without superuser/createdb/createrole/inherit/replication/bypass-RLS or role memberships. Worker was denied users-table reads. All 41 table fingerprints still matched before migration.
- The official runner then rehearsed 0018 on the restored copy. It produced exactly one applied migration, 45 tables and unchanged original data; authenticated API/worker ACL checks passed, including worker denial of dossier reads.
- Immediately before main migration, the source identity, all baseline row fingerprints, all 17 migration checksums, empty runnable queue, absent target roles and zero other connections were reconfirmed. The official compiled `migrate()` runner was invoked with connection-level `lock_timeout=5000`; it applied only 0018 and returned successfully. No direct migration SQL execution or ledger manipulation occurred.
- Applied baseline grants derive from `scripts/sandbox-runtime-grants.sql`, expanding the API `SELECT ON ALL TABLES` into an explicit list of 41 existing application tables, then adding the four dossier tables after 0018. Worker reads nine specified existing tables, never dossier tables. Mutation privileges remain the source baseline column/table grants plus `apps/api/src/documents/dossier-runtime-grants.sql`; no PUBLIC grant, table ownership, superuser/createdb/createrole/replication/bypass-RLS or privileged membership was introduced.
- 0018 adds two columns, two unique constraints, four tables, two explicit indexes, two ordinary invoker trigger functions and seven triggers. Its immutable triggers mention DELETE/TRUNCATE as rejected events; no destructive data statement was run. PUBLIC EXECUTE was explicitly revoked from the two new ordinary trigger functions as a separate narrow ACL step; zero PUBLIC EXECUTE entries remained for them. The migration source/checksum was not changed.
- Canonical migration SHA-256: `1cadbdee79457b61d90214416475c1986abd26a22c102388a56e51bef3c17695`. Main B4 receipt confirms one application, 45 tables, four empty dossier tables and all **40 existing non-ledger application tables** unchanged by full row fingerprint. The ledger has the intended eighteenth row. Seven source objects / 394,591 source bytes / three decisions / eight evidence items remain intact.
- Actual authenticated connections on **5432** passed for both new roles. Table reads and negative ACL checks passed; neither role owns tables or has privileged attributes/memberships. The API/intake role has the dossier delta, the extraction role does not. Credentials were sent to PostgreSQL as locally generated SCRAM verifiers; session logging was suppressed during provisioning to avoid credential material in error statements. Roles/passwords were not dumped publicly.

## B5 verification and current local runtime

The repository's existing `apps/api/test/dossier-http.integration.cjs` suite was executed against the approved restored copy on **16432**: **10 passed, zero failed**, exit code 0, approximately **217 seconds**. Its test body was reused in memory; only its isolated harness was replaced with a fixture pinned to the owned restore data directory and its expected role-name assertion adapted to the approved API role. Repository test/harness files were not edited. A new, explicitly synthetic organization/user/counterparty/policy assignment namespace was added only to the restored copy; original user passwords or business records were not changed for the test. Existing sandbox policy content was hash-checked and reused.

Coverage includes raw-only 202, concurrent replay and actual Nest restart, 30/60-PDF durable intake, byte-exact sources and IDs, **89 extraction publications**, usable versus zero-usable summaries, source-bound evidence, explicit human verification, mixed/invalid ZIPs, session logout survival and membership revocation. All requests used real Nest/FastAPI/PyMuPDF/PostgreSQL and restricted roles, with the explicitly synthetic offline proposer and outbound-network guard. The 60-PDF archive retains its 12-page member for review and creates 59 supported extraction jobs; no long PDF is truncated or represented as fully analyzed. Observed Node RSS was 297,111,552 bytes, excluding Python/PostgreSQL; this is not a whole-process-tree benchmark.

The owned restore cluster stopped cleanly after the suite; **16432 is no longer listening**. No pre-existing test clusters were touched. Synthetic records remain in the isolated restored copy and were not bulk-imported into the main database.

Current runtime on the existing main database:

| Process | Endpoint / PID at verification | Actual database role |
| --- | --- | --- |
| API | `http://127.0.0.1:3001/api/v2`, PID 28332 | `aic_runtime_api` |
| Dossier intake worker | Polling, PID 37520 | `aic_runtime_api` |
| Extraction worker | Polling, PID 33036 | `aic_runtime_worker` |
| Offline AI | `http://127.0.0.1:8100`, launcher PID 30224 / listener PID 11380 | No database connection |

API readiness was tested by actual listening HTTP and a protected endpoint returning 401 without credentials; AI health returned 200. Both workers completed a real idle poll. Each Node process verified `current_user`, database and server port against its expected role before polling/serving and wrote a launch-ID-bound role proof. Process liveness/start timestamps were checked; stale proof files alone cannot mark a launch READY. Active PostgreSQL runtime connections were API/intake role (2 idle connections) and extraction role (1 idle connection), with no runtime superuser connection. CLI readiness also passed directly for both roles.

Final catalog: **45 tables, 111 valid/ready indexes, 92 foreign keys, no unvalidated constraints**, seven existing lineages defaulted to legacy and zero pending-intake cases. API can read 45 explicit application tables; extraction can read nine, with no dossier/users read access. Neither role has database/schema CREATE. No inherited privileged role membership or application-table ownership was introduced.

All **40 pre-existing non-ledger table fingerprints** were checked again after runtime startup and still matched the encrypted pre-change baseline. The intended ledger change is 0018. Main counters remain two cases, seven sources / 394,591 bytes, seven jobs, nine results, three human decisions and eight evidence items; no main synthetic imports, new business rows, source deletion or rating/FHI activation occurred. The original unknown 8-page source remains protected.

## Local operator / Antigravity handoff

The encrypted-credential launcher is local to the approved backup run directory. It decrypts secrets in memory and injects separate role connections into child processes; `.env` is unchanged. It uses a launch lock, rejects duplicate launches while prior owned processes remain, binds role proofs to a unique launch ID and checks worker polling/liveness. It does not start the Frontend.

```powershell
# Inspect the currently running stack:
node "C:\Users\52duc\AppData\Local\AIC\backups\gate-b-20261017-121117\runtime.cjs" status

# Stop only this launch's processes after checking PID/start-time ownership:
node "C:\Users\52duc\AppData\Local\AIC\backups\gate-b-20261017-121117\runtime.cjs" stop

# Start again under the same Windows account/profile, after stopping:
node "C:\Users\52duc\AppData\Local\AIC\backups\gate-b-20261017-121117\runtime.cjs" start
```

`start` and `status` were executed successfully. The `stop` command is supplied and syntax-checked but was not executed because the requested runtime remains running. The old `scripts/dev-all.cjs` / `start-dev.ps1` are unchanged and still select the root configuration's shared owner connection/live mode; use this approved launcher for the verified restricted/offline stack rather than starting those concurrently. Existing application-user passwords remain unchanged. Source cache remains `C:\private\aic-mvp-cache`.

Antigravity can point its existing proxy to `http://127.0.0.1:3001/api/v2` and verify the five dossier routes, 33 MiB new ZIP proxy cap, polling/reload/source viewer and honest registered-versus-analyzed labels against the [API contract](AIC-ONE-ZIP-DOSSIER-API-CONTRACT.md). Browser E2E remains **NOT VERIFIED**. This running AI service is the guarded synthetic mock backend, not a verified live model or general real-document extraction service. Real-document use and any external AI call still require their separate authorization.

Cleanup remains **0 existing rows / 0 existing files**. The approved main migration/restricted grants and local runtime enablement are complete. No main database restore, main fixture imports, `.env` changes, Frontend edit, commit, push, deploy or cloud call occurred. **LIVE_PROVIDER_NOT_TESTED**.
