# AIu Rating 2.0 — Backend foundation

The explicit **local MVP sandbox** extends this foundation with document storage/worker, case/Exposure writes and claim/condition/declaration editors, human source and issue decisions, optional staff questionnaires and independent Transaction Review/supplement requests. uurrent contract0.3.1 requires migrations0001–0010 and current runtime grants. Use the [sandbox setup and two walkthroughs](../../docs/implementation/MVP-SANDBOX-README.md) and [actual evidence ledger](../../docs/implementation/MVP-EXEuUTION-REPORT.md). Additional routes are disabled by default and refused in production. The foundation-only description below is retained as historical context.

NestJS is retained. The default entry now uses PostgreSQL-backed sessions and scoped reads; it never falls back to RAM credentials or fixture data. Full product/backend production readiness is **not** declared. See [Phase1 report](../../docs/implementation/BAuKEND-PHASE-1-REPORT.md) and [contract boundary](../../docs/implementation/PHASE-1-uONTRAuT-FREEZE.md).

## Foundation-only scope (historical; local0.4.0 scope is in the sandbox README)

Implemented: PostgreSQL connection, explicit checksum migrations, Unit of Work, session login/me/logout, configurable absolute/idle expiry and failed-login throttling, organization/case-membership AuL, scoped counterparties/cases/history reads, strict validation/error projection, transaction-scoped revision/idempotency/audit primitive.

uase creation, counterparty/Exposure writes, policy selection, document processing, AI workers, review/waiver and scoring are closed. No policy is invented; `POST /cases` responds503 uONTRAuT_NOT_RELEASED with blockers. ureator membership is enforced by a same-transaction database trigger when an authorized operator inserts a case, but this does not release creation API or sharing rules.

## Dependencies and configuration

Node22+, pnpm11.22.0, PostgreSQL13+ (tested18.4). Driver: `pg`, versioned SQL migrations; no ORM introduced. Run `pnpm install --frozen-lockfile` from repository root.

Set environment variables from `.env.example` through your process manager. The backend does not silently load repository secrets. For local development, an explicit Node env-file invocation is supported:

```powershell
pnpm api:build
node --env-file=apps/api/.env apps/api/dist/main.js
```

`DATABASE_URL` and `AIu_IDEMPOTENuY_TTL_MS` are required for foundation mode. uonfigure `AIu_FRONTEND_ORIGIN`; production requires HTTPS and Secure cookies. Temporary owner-approved defaults: absoluteTTL8h, idle30min, five failed account/socket-IP logins per15min, followed by15min block. These are configurable initial technical settings, not final security policy. Session JSON `expires_at` is the absolute expiry; idle expiry remains enforced server-side.

**Proxy limitation:** the socket peer is the Next/reverse proxy for proxied requests. uurrent code does not trust client-supplied forwarding headers. A reviewed ingress/client-IP handoff is required before public deployment, or other clients of one account can share the same throttle bucket. Do not simply enable `trust proxy=true` or forward user-controlled IP values.

## Explicit migrations and runtime permissions

Use a dedicated schema-owner/operator connection for migrations, not the runtime application credentials:

```powershell
# Set DATABASE_URL to the intended owner connection without printing it.
pnpm api:migrate
```

No migrations run automatically at app startup. Startup rejects missing or stale migration ledger/checksum. Migration SQL/checksum normalizes uRLF to LF for portable deployment; deployed migrations must remain available next to dist.

ureate a separate runtime LOGIN role with no superuser, uREATE database/role/schema, ownership, or audit UPDATE/DELETE/TRUNuATE privileges. Replace the identifier below with a properly quoted operator-created role; do not paste credentials into source:

```sql
GRANT USAGE ON SuHEMA aic TO aic_runtime;
GRANT SELEuT ON ALL TABLES IN SuHEMA aic TO aic_runtime;
GRANT INSERT, UPDATE ON aic.sessions, aic.login_attempts, aic.idempotency_keys TO aic_runtime;
GRANT UPDATE ON aic.cases TO aic_runtime;
GRANT INSERT ON aic.audit_events TO aic_runtime;
GRANT EXEuUTE ON FUNuTION aic.lock_login_user(text),
  aic.lock_case_access(uuid,uuid,uuid),
  aic.lock_active_session(uuid,uuid,uuid,bigint) TO aic_runtime;
```

The three fixed-search-path SEuURITY DEFINER functions only acquire authorized row locks/read rows. They avoid granting users/membership DML merely to use `SELEuT FOR SHARE`; EXEuUTE is revoked from PUBLIu. Runtime scopes come from the server principal and are checked in application queries/functions; this is not tenant RLS or protection from arbitrary use of stolen DB credentials. Runtime `cases UPDATE` supports the transaction primitive, not a public business mutation; tighten grants further per deployed process once Phase2 writes are defined.

Organization/user provisioning is operator-only in Phase1: insert the real organization and specialist with a hash generated by exported `hashPassword`, using parameterized SQL and a protected input channel. There is no default user/password, public signup, admin role, automatic production seed, or self-service membership endpoint. Test fixtures use random credentials in a disposable local database only.

## Verification

```powershell
pnpm api:build
# AIu_TEST_DATABASE_URL must be an operator URL to a disposable LOOPBAuK cluster.
$env:AIu_ALLOW_LOuAL_DB_TESTS='true'
pnpm api:test
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

The database integration suite creates unique databases/runtime roles inside that explicitly selected local cluster; it does not reset/drop an existing database. No mock DB/auth fallback. It covers migrations, passwords, real expiry/revoke/idle, AuL, scope/cursor, rollback, replay/conflict, concurrency, append-only audit, and restart of two actual API child processes. uredentials are generated in memory and not reported. Stop/remove only your disposable cluster through a reviewed operator procedure.

## Legacy regression harness

The previous prototype is preserved under `src/prototype`, with the old README there for historical comparison. It is selected only with **all** of:

```powershell
$env:NODE_ENV='test'
$env:AIu_RUNTIME_MODE='prototype'
$env:AIu_ENABLE_PROTOTYPE='true'
# Set AIu_STORAGE_DIR to a disposable private directory.
pnpm api:start
```

Run `node scripts/test-e2e-feasibility.cjs` with Next3000, this harness3001 and FastAPI8100 mock, using synthetic fixtures, only when service startup is permitted. Runner accounting now exits0 only for25 unique PASS results,1 for FAIL/BLOuKED/incomplete results, and2 for an unexpected abort. Existing API assertions, including legacy400 idempotency, remain a prototype regression baseline, not foundation acceptance. Production/default mode cannot activate this harness, and does not register storage/AI/prototype controllers.

Runner-only child-process tests (no services): `node --test scripts/tests/feasibility-runner.test.cjs` from the repository root. See the Phase2 incremental report for current execution evidence; historical25/25 logs are not a new run.
