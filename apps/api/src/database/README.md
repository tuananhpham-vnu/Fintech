# PH1-DB persistence handoff

The numbered SQL migrations are the only schema definitions. This directory supplies
PostgreSQL infrastructure; main owns application composition, config, ACL queries,
idempotency execution, controllers, and integration tests. No migrations run on
application startup. Main reports PostgreSQL 18 checks for applied migrations
0001/0002, reruns, and checksum validation passed on its isolated cluster. The
persistence writer has not applied migration 0003 or changed applied SQL files.

## Public TypeScript API

`database.service.ts` exports `@Injectable() DatabaseService`, implementing the
frozen `FoundationDatabase` from `../foundation/ports`. Its constructor requires
`@Inject(FOUNDATION_CONFIG) config: FoundationConfig`; it reads no environment
variables. The updated config's `sessionIdleMs` and `loginBlockMs` are auth inputs,
with no policy defaults added by persistence.

```ts
readonly pool: Pool
query(text: string, values?: unknown[]): Promise<SqlResult>
transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T>
onModuleInit(): Promise<void>
onModuleDestroy(): Promise<void>
```

`query` forwards parameterized SQL to the pool. `transaction` checks out one
client, executes BEGIN/work/COMMIT on that client, and rolls back on failure.
It always releases the client, discarding it if rollback fails, and preserves the
original exception for main's global error sanitization. The callback must use
its provided client for all transaction work; nested transactions/savepoints are
not supplied. The pool is exposed for operator/bootstrap/integration-test use.

Initialization executes SELECT 1, locates the latest required numbered migration,
and requires its matching name/canonical SHA-256 checksum in `aic.schema_migrations`.
Migration 0020 introduced the separately gated company-health expansion; an
installed 0020 must have its matching checksum. The current release also includes
0021 for immutable international financial-import sources, so its latest required
readiness migration is now 0021. Apply the full ordered migration set before running
this release. See the company-health v1 contract for its controlled rollout/backup/
rollback boundary. No startup path runs migrations. Missing
migration files (including the required 0003 baseline), a missing schema/ledger,
a missing latest row, or a checksum mismatch reject startup and close the pool.
This is read-only verification;
only the explicit migration runner applies schema changes. Deployments must
include `apps/api/migrations` alongside the expected source/dist layout.
Shutdown ends the pool once. Technical pool settings: 5s connection/acquisition timeout,
30s idle pool timeout, 30s server statement and idle-transaction timeouts, max 10
connections. Idle pool errors produce a fixed message without error details.
These settings do not define session TTLs or login thresholds.

`migrate.ts` exports the standalone function:

```ts
migrate(databaseUrl: string): Promise<{ applied: string[] }>
```

It reads numbered `NNNN_name.sql` files from
`resolve(__dirname, '../../migrations')`, which resolves to `apps/api/migrations`
from both `src/database` and the expected `dist/database` layout. It uses one pg
Client, a session advisory lock `(1095320369, 1)`, and a bootstrap transaction for
`aic` / `aic.schema_migrations`. Each unapplied migration and its ledger INSERT
commit in one separate transaction. SQL is read as UTF-8 and CRLF is replaced
with LF in memory before both execution and SHA-256 calculation. Runner and
readiness use the same `canonicalMigrationSource` helper in `migration-source.ts`.
The checksum covers the UTF-8 bytes of that canonical SQL, so Windows CRLF and
Linux LF packages with otherwise identical SQL have identical checksums.
No other whitespace, lone CR, BOM, or final newline is changed, and migration
files are never rewritten. Changed canonical checksums, removed/renamed history, duplicate versions, and new
migrations inserted before applied history are rejected. Repeated successful
invocation returns `{ applied: [] }`. Nothing imports this runner automatically.

Earlier isolated test databases may contain raw-byte checksums from before this
canonicalization rule. A raw CRLF checksum will still be rejected; no legacy
checksum fallback or automatic ledger rewrite is supplied. Main creates fresh
isolated databases for each test run, and those earlier test databases are not
release databases. Historical LF checksums already match the canonical rule.

The ledger columns are `name text PRIMARY KEY`, `checksum char(64) NOT NULL`
(lowercase hex), and `applied_at timestamptz NOT NULL DEFAULT now()`. The runner
has a 5s connection timeout and 60s statement/idle-transaction timeouts; lock
acquisition therefore times out rather than waiting forever. It always closes
its client, releasing its session lock. There is no down/reset operation.

Operator commands, only after main configures an isolated PostgreSQL:

```powershell
pnpm --filter @fintech/api exec tsx src/database/migrate.ts
# Or, after main builds the expected dist/database layout:
node apps/api/dist/database/migrate.js
```

The CLI requires an explicitly supplied `DATABASE_URL`. Success prints only the
applied filenames as JSON; failure prints a fixed message and exits 1. It never
prints the URL, SQL, row values, or pg error details. Importing the module has no
CLI side effects. Programmatic callers receive errors and must sanitize logs.

## Exact application columns

All tables below are in `aic`. `?` marks a nullable column; every other column is
NOT NULL. UUID `id` primary keys default to server-side `gen_random_uuid()`.
Every `created_at`, `updated_at`, `granted_at`, and `last_seen_at` defaults to
`now()`; these are timestamptz instants. Defaults for `updated_at` and
`last_seen_at` apply only at INSERT: application SQL must explicitly touch them.
No other time column has a default.

| Table            | Columns, in SQL order                                                                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| organizations    | `id uuid`, `name text`, `tax_id text?`, `country text DEFAULT 'VN'`, `created_at timestamptz`                                                                                                                                                                                     |
| users            | `id uuid`, `organization_id uuid`, `username text`, `password_hash text`, `display_name text`, `role text`, `disabled_at timestamptz?`, `created_at timestamptz`                                                                                                                  |
| sessions         | `id uuid`, `organization_id uuid`, `user_id uuid`, `token_hash char(64)`, `csrf_hash char(64)`, `expires_at timestamptz`, `revoked_at timestamptz?`, `last_seen_at timestamptz`, `created_at timestamptz`                                                                         |
| counterparties   | `id uuid`, `organization_id uuid`, `name text`, `country text`, `tax_id text?`, `industry_code text?`, `source_refs jsonb DEFAULT []`, `identity_status text DEFAULT 'unresolved'`, `revision bigint DEFAULT 1`, `created_at timestamptz`, `updated_at timestamptz`               |
| cases            | `id uuid`, `organization_id uuid`, `counterparty_id uuid`, `exposure_kind text`, `lifecycle_stage text`, `exposure_json jsonb`, `revision bigint DEFAULT 1`, `policy_version text`, `method_version text?`, `created_by uuid`, `created_at timestamptz`, `updated_at timestamptz` |
| case_memberships | `organization_id uuid`, `case_id uuid`, `user_id uuid`, `granted_by uuid`, `granted_at timestamptz`                                                                                                                                                                               |
| idempotency_keys | `organization_id uuid`, `actor_id uuid`, `operation text`, `key text`, `request_hash char(64)`, `response_status integer`, `response_body jsonb`, `expires_at timestamptz`, `created_at timestamptz`                                                                              |
| audit_events     | `id uuid`, `organization_id uuid`, `case_id uuid?`, `actor_type text`, `actor_id uuid?`, `action text`, `subject_id uuid?`, `revision_before bigint?`, `revision_after bigint?`, `reason text?`, `metadata_json jsonb DEFAULT {}`, `created_at timestamptz`                       |
| login_attempts   | `bucket_hash char(64)`, `window_started_at timestamptz`, `attempts integer`, `blocked_until timestamptz?`                                                                                                                                                                         |

There are no document, evidence, job, review, assessment, method, policy registry,
or membership-management tables. `policy_version` is required, nonblank, and has
no default. `method_version` remains nullable. `response_body` accepts any JSONB
value, including JSON null; SQL NULL is forbidden. `subject_id` is intentionally
not a foreign key because it can identify different kinds of subject.

## Constraints and indexes

- All nine application tables have primary keys. Membership PK is `(case_id,
user_id)`; idempotency PK is `(organization_id, actor_id, operation, key)`;
  login PK is `bucket_hash`; all others use `id`.
- Every organization reference targets `organizations.id`. `users`,
  `counterparties`, and `cases` also have `UNIQUE (organization_id, id)`.
  Sessions' user, cases' counterparty/creator, memberships' case/user/grantor,
  idempotency's actor, and audit's nullable case/actor use composite tenant FKs.
  Every FK has both `ON UPDATE RESTRICT` and `ON DELETE RESTRICT`.
- Username and session token hash are globally unique. Counterparty identity
  has a partial unique index `(organization_id, country, tax_id) WHERE tax_id IS
NOT NULL`; different NULL tax IDs are allowed. No tax-ID normalization is
  invented in SQL.
- Names, countries, username, password hash, display name, policy version,
  idempotency operation/key, and audit action reject empty/space-only strings.
  Users' role is only `specialist`. Hash columns require 64 lowercase hex chars.
- Counterparty identity is `unresolved | confirmed | conflicting`; `source_refs`
  must be a JSON array. Revisions, including nullable audit before/after values,
  are in `1..9007199254740991`. pg's default bigint string parsing is preserved;
  main must convert checked revisions to safe numbers for wire DTOs.
- Exposure is a JSON object. `amount_vnd` must be a JSON string matching
  `^[1-9][0-9]{0,23}$`, giving the positive integer capacity of numeric(24,0)
  without adding a second amount column or floating-point conversion.
  Required role pairs are RECEIVABLE seller/buyer; PREPAYMENT buyer/seller;
  LOAN lender/borrower; DEBT_INVESTMENT investor/issuer. Required `term_days`
  accepts JSON null or an integer number in `0..9007199254740991`.
  Lifecycle is `proposed | active`. Missing or JSON-null amount/roles fail.
- Audit actor type is `specialist | operator`. Specialists require an actor user;
  operators may have a NULL actor user. Every non-NULL actor is tenant checked.
  Metadata must be a JSON object. A statement trigger rejects UPDATE, DELETE,
  and TRUNCATE, including statements affecting zero rows.
- HTTP response status is `100..599`. Login attempts are integers >= 0, with
  no default or hardcoded production threshold.
- Counterparty and case list indexes are `(organization_id, updated_at DESC,
id DESC)`. Audit indexes include `(case_id, created_at DESC, id DESC)` and
  `(organization_id, created_at DESC, id DESC)`. Supporting indexes cover
  sessions' user, cases' counterparty/creator, memberships' user/grantor, and
  audit actor. Unique/PK indexes also support their corresponding lookups/FKs.

## Auth and pending writes

Auth owns account+IP hashing and serialized failed-attempt updates. The single
login bucket stores failures only; successful logins neither increment nor clear
the current window. `blocked_until` supports an explicit configured block. No
account-only or global-IP policy is introduced. The owner's temporary values
(5 failures / 15min, 15min block, absolute session TTL 8h, idle 30min) belong in
explicit main config, not SQL defaults.

Sessions provide `last_seen_at` for an atomic activity update guarded by active
absolute expiry, idle expiry, no revocation, and an enabled user. Auth must leave
`expires_at` unchanged when touching activity. Persistence does not implement
session validation or extend session expiry.

Creator case membership is approved only for the same organization and in the
same case-creation transaction. Migration 0002 adds the AFTER INSERT row trigger
`cases_grant_creator_membership` / `aic.grant_case_creator_membership()`, inserting
exactly `(NEW.organization_id, NEW.id, NEW.created_by, NEW.created_by)` into
membership `(organization_id, case_id, user_id, granted_by)`. It runs in the
inserting transaction and rolls back with it; existing tenant FKs still apply.
There is no organization-wide grant, historical backfill, or conflict suppression.
Application/bootstrap code must not insert the same creator membership again.
The trigger uses invoker privileges, so the inserting role must be allowed to
insert memberships as well as cases.

The BEFORE UPDATE row trigger `cases_policy_version_immutable` calls
`aic.reject_case_policy_version_change()` and rejects any `IS DISTINCT FROM`
change to `policy_version`, including NULL, with SQLSTATE `23514` and constraint
name `cases_policy_version_immutable`. An unchanged policy value and updates to
other fields remain allowed, subject to the original constraints. This fixes
the bound version for traceability; it does not validate policy approval against
an invented registry. Public case creation remains
blocked by unapproved effective policy selection and the pending Exposure
conditions/claims/source and null-term explanation schemas. No public exposure
or counterparty mutations are authorized by JSON storage. Conditions item
schemas are deliberately not invented. ACL enforcement and idempotency replay
remain main's responsibilities. No automatic retention cleanup/reuse runs here.

PostgreSQL 13+ is required for built-in UUID generation. Schema owner/operator
privileges and runtime grants remain deployment responsibilities; table owners
can bypass triggers by changing DDL. The normal runtime role should not own the
schema. Main owns live integration and concurrency verification. The writer has
run scoped compilation and missing-URL CLI guards; 0003 has not been executed.

## Migration 0002 integration statement checklist

Retained as a regression checklist; not all assertions below are claimed as run.
Main owns execution against isolated real PostgreSQL. Use explicit operator/test
fixture IDs and a non-production policy label; these SQL fixtures do not release
case-creation HTTP. Leave the existing HTTP blocked-creation assertion in place.

- [ ] Before applying migrations, `DatabaseService.onModuleInit()` rejects a
      reachable empty database. With only 0001/0002 applied, it also rejects startup
      because 0003 is absent. Neither attempt creates schema/ledger rows.
- [ ] The explicit runner applies 0001/0002/0003 on an empty database, and only
      0003 on a 0001/0002 database. Run it again and expect `{ applied: [] }`. Startup
      succeeds only when the latest migration name/checksum matches. A changed
      checksum, missing ledger row, missing required 0003 file, or missing deployed
      migration directory rejects startup; the runner also rejects checksum mismatch.
      Use a separate disposable
      database for ledger-tamper checks; never alter the committed migration files.
- [ ] Create two organizations and a creator/second specialist in the first,
      plus a specialist in the second, and a counterparty in each. In an explicit
      transaction, insert a valid case using its same-organization creator and
      counterparty. Before COMMIT, the following query must return exactly one row
      with both user/grantor equal to the creator, proving same-transaction visibility:

  ```sql
  SELECT organization_id, case_id, user_id, granted_by
  FROM aic.case_memberships
  WHERE case_id = $1;
  ```

- [ ] Roll back that case insertion and verify both case and membership are
      absent. Repeat with a new ID and COMMIT; the membership persists. The second
      specialist in the creator's organization and every other-organization user
      receive no membership. Inserting multiple cases in one statement creates
      exactly one creator membership for each inserted case.
- [ ] An INSERT using another organization's creator or counterparty raises
      SQLSTATE `23503`; neither the case nor membership persists. A failed
      membership INSERT also aborts case creation; no case can commit alone.
- [ ] In a new transaction, update a committed fixture's policy to a different
      label. Expect SQLSTATE `23514` with constraint
      `cases_policy_version_immutable`, then ROLLBACK and verify the original value.
      Repeat with NULL in a separate transaction. These changes must fail:

  ```sql
  UPDATE aic.cases SET policy_version = $2 WHERE id = $1;
  UPDATE aic.cases SET policy_version = NULL WHERE id = $1;
  ```

- [ ] An unchanged-policy update succeeds. An unrelated valid revision/timestamp
      update also succeeds without creating another membership:

  ```sql
  UPDATE aic.cases SET policy_version = policy_version WHERE id = $1;
  UPDATE aic.cases
  SET revision = revision + 1, updated_at = now()
  WHERE id = $1;
  ```

- [ ] A multi-row UPDATE attempting a policy change fails as one statement;
      after ROLLBACK all fixture policy values remain unchanged. Verify the triggers
      are attached to the existing `aic.cases`, and no policy registry/table or
      public creation/membership endpoint was added.

## Migration 0003 authorization lock API

PostgreSQL row-locking SELECT requires UPDATE privilege on locked relations.
Migration 0003 supplies narrowly scoped SECURITY DEFINER SQL functions so the
runtime does not need users or case-membership write privileges just to lock.
Their owner is the role applying the migration. Each function fixes
`search_path = pg_catalog`, fully qualifies application relations/types with
`aic`, and has EXECUTE revoked from PUBLIC in the migration transaction.
No function writes application data, extends session timestamps, performs a
grant, creates policy records, or changes the case-creation HTTP gate.

| Function signature                                                                   | Result and row locks                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `aic.lock_login_user(p_username text)`                                               | `SETOF aic.users`, exact username match; `FOR SHARE OF u`. Returns the existing user row, including password hash and disabled state, for auth validation.                                       |
| `aic.lock_case_access(p_org uuid, p_user uuid, p_case uuid)`                         | `SETOF aic.cases`, matching case/tenant and membership for an enabled same-organization user; `FOR UPDATE OF c FOR SHARE OF m, u`.                                                               |
| `aic.lock_active_session(p_session uuid, p_user uuid, p_org uuid, p_idle_ms bigint)` | `TABLE (id uuid)`, matching session/user/tenant and enabled same-organization user, unrevoked, absolute expiry and idle cutoff both strictly active at `clock_timestamp()`; `FOR SHARE OF s, u`. |

The idle cutoff uses `p_idle_ms * INTERVAL '1 millisecond'`; main supplies its
validated configured idle duration. No fallback/default or global throttle is
added. Missing, disabled, mismatched, expired, idle, or revoked access returns
zero rows where those predicates apply. Login intentionally returns disabled
users so auth can use its existing generic credential/disabled-account handling.

Use the functions inside the existing checked-out transaction and consume their
results before proceeding. Locks last until transaction end. Auth/core callers
still provide server-derived identity, enforce transport authorization, and
handle transaction errors/rechecks; these SQL functions are not public endpoints.
In particular the login result contains a password hash and is internal only.

PUBLIC cannot execute these functions. The migration owner retains execution.
Main/operator setup owns explicit signature-scoped EXECUTE grants to the actual
runtime role and the required schema USAGE. This migration contains no role
names, runtime grants, or widening of table privileges. Keep ownership with a
trusted non-runtime role; do not give runtime role membership in that owner.

### Migration 0003 integration checklist (not executed by this writer)

- [ ] Apply 0003 as schema owner; verify 0001/0002 SQL files remain unchanged,
      ledger checksums match canonical UTF-8 SQL with CRLF converted to LF, rerun
      applies nothing, and readiness
      rejects the 0001/0002-only database but accepts the updated one.
- [ ] Inspect `pg_catalog.pg_proc`: all three functions have `prosecdef = true`
      and `proconfig` contains `search_path=pg_catalog`. PUBLIC has no EXECUTE;
      a role with only schema USAGE receives SQLSTATE `42501` on each call until
      its operator grants the corresponding signature. Owner execution still works.
- [ ] As the explicitly granted runtime role with no users/membership writes,
      run login and authorized case/session mutations through main's real callers.
      Verify the original direct locking SELECT fails for insufficient privilege,
      while each function succeeds for the matching fixture. Do not fix this by
      granting UPDATE on users or case_memberships.
- [ ] Exercise correct username, absent username, and disabled user for login.
      Login returns at most the matching row and auth still rejects disabled users.
      With an authorized case member, expect exactly that case; absent membership,
      wrong tenant/user/case, or disabled user returns no case.
- [ ] Check the active session fixture and all negative cases independently:
      wrong session/user/tenant, disabled user, revocation, absolute expiry, idle
      expiry, and exact expiry/cutoff equality. Only strictly active sessions return
      an ID. Confirm no function changes session timestamps or any application row.
- [ ] In transaction A, consume a login lock; an owner disable/password UPDATE
      in transaction B must wait until A ends. For case access, verify a concurrent
      case UPDATE, membership DELETE, and user disable wait for transaction A.
      For session access, verify a session revoke and user disable wait for A.
      Use bounded `lock_timeout` in B; test COMMIT and ROLLBACK release paths.
- [ ] Test the waiting-lock direction too: hold a revoke, membership removal,
      or user disable in B, then call the relevant function in A before committing B.
      After B commits, A must not return rows invalidated by its predicates; main's
      existing expiry rechecks must also cover time passing while waiting for locks.
- [ ] Verify function signatures, result columns, main's signature-scoped grants,
      internal-only handling of user/password rows, and unchanged blocked case HTTP.
- [ ] Use fresh isolated database/package copies to verify LF and CRLF versions
      of otherwise identical migration SQL produce the same ledger checksums, execute
      identical canonical SQL, permit no-op reruns, and pass readiness across package
      line endings. A substantive SQL edit must still fail checksum validation.
