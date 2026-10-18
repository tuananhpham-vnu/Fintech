# AIC pilot runtime and approval

## Approved scope

On 18/10/2026 the project owner explicitly approved activating AIC-FHI-1.0/version 1.0.0 for `DISTRIBUTION_WHOLESALE_PILOT`, AIC-F1–F5, with experimental / NOT VALIDATED labelling and PD=null. The confirmation was a direct reply to approval question `call_f3826de218e548b9874473fcd8ff80b5`: “Duyệt kích hoạt pilot đúng phạm vi trên”. It authorizes configured pilot use, not independent validation or a financial transaction.

The local approval artifact was recorded at `2026-10-17T20:03:17.840Z` and is limited to the existing local organization. It is stored outside Git with the operational receipts. No expert financial sign-off, calibration report or validation status was invented.

## Method activation

The API reads a private JSON file from `AIC_FHI_POLICY_PATH` at startup. If absent, the method stays unconfigured. Invalid/incompatible artifacts fail startup. The artifact must contain:

- `policy_id`, `method_id`, `method_version`, `method_hash`, `status`;
- `industry_scope` and an explicit nonempty list of organization UUIDs;
- `approval.by`, `approval.recorded_at`, `approval.source`, `approval.scope`;
- `effective_from`, and `effective_until` as a timestamp or null.

The method hash is the canonical SHA-256 of the method ID, version, scope and metric definitions exported by `fhi-policy.ts`. Changing these definitions requires a new reviewed artifact; a client request cannot override the hash. Approval and effective dates are checked against server/database time, and the current organization must be in scope.

Only `configured_pilot` / `validation_pending` artifacts are supported by this implementation. Neither is independently validated. `validated_for_limited_use` is not accepted. Never commit the actual organization policy, credentials, source reports or decrypted operational receipts.

## Run the local live stack

Requirements: installed workspace dependencies, PostgreSQL with migrations through 0021 for the current release, AI Python dependencies in `.venv`, private storage, Gemini configuration, application accounts, and explicit service authentication. Apply migrations with the explicit operator runner before starting services; startup does not migrate or reset data. Secrets belong in local environment configuration.

```powershell
pnpm api:build
pnpm build
pnpm local:serve
```

Web: `http://127.0.0.1:3000`; API: loopback 3001; AI: loopback 8100. The command starts both PDF and ZIP workers. `pnpm dev:all` uses Next development mode instead. Run one stack at a time. Startup checks occupied ports before launching; it does not kill unrelated processes.

`AIC_API_DATABASE_URL` and `AIC_WORKER_DATABASE_URL` let the launcher use separate restricted roles; each falls back to `DATABASE_URL` for existing local setups. An operator connection used for migration is not a production runtime credential. The acceptance session used existing encrypted restricted role credentials through a private local wrapper; that wrapper is not required by the application or checked into Git.

AI is explicitly live, its test console and automatic dotenv loading are disabled by the launcher, and provider secrets are not forwarded to Next. The launcher is for local operation even when the web uses `next start`.

## Explicit production document runtime

Deploy API, PDF worker and ZIP worker as separately supervised processes. `AIC_DOCUMENT_RUNTIME=production` requires all of: `NODE_ENV=production`, foundation runtime, live AI, HTTPS frontend origin, secure session cookies, an explicit absolute private `AIC_STORAGE_DIR`, database configuration and a non-default service key of 32–512 printable ASCII characters. Set `AIC_IDEMPOTENCY_TTL_MS` explicitly. The API rejects privileged/owner database roles at production startup.

Use restricted API and worker grants, apply migrations separately, and keep private storage outside the public web root. `/api/v2/health/live` and `/api/v2/health/ready` support private supervisor/ingress checks. Readiness checks database connectivity; it is not an end-to-end Gemini or scoring guarantee. Do not expose the private API or AI service publicly merely to make these checks reachable.

No public deployment or HTTPS production acceptance has been executed by this change. Build success and local browser acceptance must not be reported as whole-stack production certification.
