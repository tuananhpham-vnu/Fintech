# PH1-AUTH handoff

Write scope is this directory only. Main must register this `AuthController`,
`SessionService`, and the global `FoundationSessionGuard`, replace production
prototype wiring, and provide the frozen `FOUNDATION_DB` / `FOUNDATION_CONFIG`
providers. No module, config, schema, prototype controller, or shared guard is edited here.
The existing `../guards/public.decorator` is reused.

## Public surface

`index.ts` exports `AuthController`, `SessionService`, `FoundationSessionGuard`,
`LoginResult`, `AuthRequest`, `hashPassword`, `verifyPassword`, `readCookie`, `hasSessionCookie`,
`validateOrigin`, `validateCsrf`, `validateLogin`, `isUnsafeMethod`,
`isSessionToken`, `hashToken`, `deriveCsrfToken`, `loginBucketHash`,
`sessionOutput`, `MAX_PASSWORD_BYTES`, `MAX_USERNAME_BYTES`, and
`MAX_COOKIE_HEADER_BYTES`, `MAX_USERNAME_LENGTH`, and `MAX_PASSWORD_LENGTH`.

- `SessionService.login(username, password, peerAddress)` returns
  `{ token, session: SessionOutput }`. Only transport writes the token to a cookie.
- `resolve(token | undefined)` returns `AuthSession | null`, atomically touching
  `last_seen_at` only for a currently active session. Absolute expiry never extends.
- `revoke(token | undefined)` persists revocation, including expired sessions.
- `readCookie(request, config)` parses the configured wire cookie. Duplicate named
  cookies, noncanonical tokens and oversized headers fail closed.
- `validateOrigin(request, config)` requires an exact canonical HTTP(S) entry from
  `allowedOrigins`. There is no implicit fallback to Host, Referer or forwarded headers.
- Protected requests resolve first (401), then check Origin/CSRF (403) for unsafe
  methods. Public unsafe methods still require Origin. Logout separately resolves
  and checks CSRF only while the cookie session is active; absent/expired/revoked/idle
  sessions return 204 with a valid Origin and clear the cookie.

Login accepts exactly `username` and `password`, nonblank strings, bounded to
256 and 1024 UTF-8 bytes respectively. Character bounds use the same ceilings;
the byte bound additionally limits Unicode input, as documented in the machine
schema's transport descriptions owned by main. Passwords and usernames are preserved
exactly, including surrounding spaces; transport limits are not password policy.
Versioned password encoding is
`scrypt$v1$32768$8$1$<16-byte-base64url-salt>$<64-byte-base64url-key>`.
Verification fixes work factors, validates lengths and canonical encoding, and
uses async scrypt with 64 MiB maxmem and timing-safe key comparison. Missing or
malformed stored hashes perform one dummy KDF and cannot authenticate.

Schema coordination for main: username maxLength 256, nonblank password pattern,
and UTF-8 byte-bound descriptions were requested in the final integration review.
Runtime implements those requirements; main owns the corresponding schema edits.
No coercion or extra fields are accepted, and no shared schema is edited here.

## Temporary owner settings and throttle behavior

Auth has no duration/attempt defaults: main supplies `sessionTtlMs` (temporary
8h), `sessionIdleMs` (30min), `loginMaxAttempts` (5), `loginWindowMs` (15min),
and `loginBlockMs` (15min). They must be positive finite safe integers; attempts
must fit PostgreSQL integer. Cookies always use HttpOnly, SameSite=Lax and path=/;
Secure is forced in production and otherwise follows `secureCookies`. Cookie
maxAge is absolute TTL, not a sliding timeout. Session JSON contains absolute expiry.

Only failures count. One SHA-256 bucket binds the exact username and socket peer
address using a versioned JSON tuple. The controller ignores `req.ip` and all
forwarded headers. Behind a proxy, the socket peer is the proxy until a separately
approved trusted-network design is supplied. No account-only or global-IP bucket.

The failure window is fixed from the first failed attempt; success neither counts
nor clears an existing window. Failure reaching the configured maximum returns
401 and starts `blocked_until`; subsequent attempts return 429 without incrementing
or extending the block. A block survives the original window expiring. If custom
block duration is shorter than the failure window, the full window limit still
applies until that window ends. The first failure after both restrictions expire
starts a fresh window. Transaction-scoped PostgreSQL advisory locking serializes
the single bucket before reads/KDF/writes; counters remain finite. Failure results
are returned from the transaction and only then become `INVALID_CREDENTIALS`, so
counters commit. Disabled users use the same KDF and 401 result as bad credentials.

## SQL assumptions for main

- `aic.users`: `id`, `organization_id`, globally unique exact `username`,
  `password_hash`, `display_name`, `role`, `disabled_at`. Only `specialist` can log
  in or resolve. Login holds a shared user-row lock through session insertion.
- `aic.sessions`: `id`, `organization_id`, `user_id`, `token_hash char(64)` unique,
  `csrf_hash char(64)`, `expires_at`, `revoked_at` nullable/default NULL,
  `created_at`, `last_seen_at NOT NULL DEFAULT now()`. Composite user/organization
  FK enforces tenant ownership. UUIDs are generated server-side in auth.
- `aic.login_attempts`: `bucket_hash char(64)` PK, `window_started_at timestamptz`,
  `attempts integer >= 0`, `blocked_until timestamptz NULL`.
- `clock_timestamp()` supplies expiry/window/block/idle decisions, including
  after lock waits. The DB port must keep advisory locks and SQL on the same
  transaction client, commit successful callbacks, and roll back rejected ones.
- Tokens are random 32-byte base64url text. Only SHA-256 hex of the token and
  derived CSRF text are SQL parameters. CSRF is HMAC-SHA256 keyed by exact raw
  token text over `AIC-CSRF-1`, encoded base64url. No raw credentials/IP in throttle
  rows or logs; no token in session JSON.

HTTP error codes are `INVALID_INPUT` (422), `INVALID_CREDENTIALS` /
`UNAUTHORIZED` / `SESSION_EXPIRED` (401), `ORIGIN_REJECTED` / `CSRF_REQUIRED` /
`CSRF_MISMATCH` (403), `RATE_LIMITED` (429),
all via shared `FoundationError`. Main owns request IDs, error filtering and logs.
Missing cookies use `UNAUTHORIZED`; supplied invalid/expired/revoked cookies use
`SESSION_EXPIRED`, without exposing session metadata. Missing/empty CSRF headers
use `CSRF_REQUIRED`; other mismatches use `CSRF_MISMATCH`.

## Verification boundary

Run from repository root:

```powershell
node apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit --incremental false
node apps/api/node_modules/tsx/dist/cli.mjs --test apps/api/src/auth/auth.helpers.test.ts
```

Helper tests use real crypto and pure transport helpers, with no mocked database.
Main must test actual PostgreSQL transactions/concurrent failure limits, persisted
blocks/restarts, success preserving failures, disabled/tenant checks, true idle
expiry versus activity refresh, absolute expiry, revocation, and HTTP guard/cookie
behavior. A passing helper test/typecheck is not PostgreSQL or application acceptance.
