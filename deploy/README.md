# Deploying the AIC demo (Render + Supabase)

Branch: **`deploy`** (created from `main`; `main`, `duc`, `nguyen`, `tanh` are untouched).
Target: **1 Render Starter + 1 Render Free + Supabase Free**. Synthetic documents only.

| Service | What runs inside | Plan | Approx. cost (verify on the pricing page before paying) |
|---|---|---|---|
| `aic-backend` (Render, Docker) | NestJS API on the public port, the document/dossier/intake workers (one process), the Python AI service on `127.0.0.1:8100` (never public) | Starter, 512 MB | about $7/month, billed per second |
| `aic-web` (Render, Docker) | Next.js UI. The browser only talks to this service; `/api/v2/*` is forwarded server-side to `aic-backend` | Free | $0; sleeps after 15 min idle (about 1 min to wake) |
| Supabase | PostgreSQL. Uploaded PDFs are stored in the database, so **Supabase Storage is not needed** | Free | $0; pauses after 7 days without activity |
| Gemini API | Extraction and OCR | pay per use | set a budget limit in Google AI Studio |

Why not everything on one Starter: measured locally, all six processes peaked at **531 MB** while processing a 9 MB PDF,
above Starter's 512 MB. With the web app on the free service and the three workers merged into one process, the
backend peaked at about 350–400 MB (plus about 50 MB when Gemini OCRs a scanned page).

---

## Step 0 — Push the `deploy` branch (once)

```powershell
cd D:\Data\Code\Python\Fintech
git switch deploy
git push -u origin deploy
```

## Step 1 — Supabase (about 5 minutes)

1. supabase.com → **New project**. Region: **Southeast Asia (Singapore)** (same region as Render).
   Click **Generate a password** for the database and save it in your password manager. This is the **owner password**.
2. Generate a second password for the restricted app role. In PowerShell:
   ```powershell
   $b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
   ```
   Save it as the **runtime password**.
3. Supabase → **SQL Editor** → New query. Paste the contents of `deploy/supabase/create-runtime-role.sql`, then
   type the runtime password between the quotes **in the editor only** (never edit the file in the repository),
   click **Run**. Expected: `Success. No rows returned`. Do not save the query.
   To change the password later: `ALTER ROLE aic_runtime PASSWORD '<new runtime password>';` in the SQL Editor,
   then update `DATABASE_URL` in Render.
4. Supabase → **Connect** → **Session pooler**. Copy the URI. It looks like
   `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`
   (your host may start with `aws-0-` instead; use exactly the host Supabase shows).
   Do **not** use "Direct connection" (IPv6 only; Render cannot reach it) or "Transaction pooler" (port 6543).
5. Build the two connection strings (keep them in your password manager, never in Git or chat). Both end with the
   same TLS settings, which make the driver verify Supabase's certificate **and** the host name:

   ```text
   AIC_MIGRATION_DATABASE_URL (owner, pre-deploy only):
   postgresql://postgres.<ref>:<owner password>@<pooler host>:5432/postgres?sslmode=verify-full&sslrootcert=/app/deploy/certs/supabase-prod-ca-2021.crt

   DATABASE_URL (restricted app role):
   postgresql://aic_runtime.<ref>:<runtime password>@<pooler host>:5432/postgres?sslmode=verify-full&sslrootcert=/app/deploy/certs/supabase-prod-ca-2021.crt
   ```

   - `<ref>` is your project ref (the part after `postgres.` in the copied URI); `<pooler host>` is the copied host.
   - The user name **must** include `.<ref>`: the pooler uses it to find your project.
   - If a password contains anything other than letters and digits, URL-encode it first:
     `[uri]::EscapeDataString('the-password')` in PowerShell.
   - `/app/deploy/certs/supabase-prod-ca-2021.crt` is Supabase's public root CA, already inside the backend image
     (see `deploy/certs/README.md` for its fingerprint). Supabase's pooler certificate is issued by this private CA,
     which Node does not trust by default.
   - The backend and the pre-deploy step **refuse to start** if a hosted database URL is not
     `sslmode=verify-full` with this `sslrootcert`, so an unverified connection cannot be configured by mistake.

Nothing else is created manually: the Render pre-deploy step creates all tables (23 migrations) and grants the
runtime role its privileges.

## Step 2 — Render (about 10 minutes plus build time)

1. render.com → **New** → **Blueprint** → connect the GitHub repository → branch **`deploy`**.
   Render reads `render.yaml` and proposes `aic-backend` (Starter) and `aic-web` (Free). **Check the plans and prices
   shown before you click Apply.**
2. Fill in the values Render asks for (all are secrets or account-specific):

   | Service | Variable | Value |
   |---|---|---|
   | aic-backend | `DATABASE_URL` | runtime connection string (Step 1.5) |
   | aic-backend | `AIC_MIGRATION_DATABASE_URL` | owner connection string (Step 1.5) |
   | aic-backend | `GEMINI_API_KEY` | your Gemini API key |
   | aic-backend | `AIC_FRONTEND_ORIGIN` | `https://aic-web.onrender.com` (exact URL of aic-web, no trailing slash) |
   | aic-web | `AIC_BACKEND_URL` | `https://aic-backend.onrender.com/api/v2` |

   If Render gives a service a different URL (name already taken, e.g. `aic-web-x7k2.onrender.com`), correct the
   two URL variables afterwards in each service's **Environment** tab and click **Save, rebuild, and deploy**.
3. Click **Apply**. Each service shows a build log, then a deploy log.

Fixed settings already in `render.yaml` (no action): runtimes, Dockerfiles, region, health checks
(`/api/v2/health/ready`, `/login`), `INTERNAL_API_KEY` (generated by Render), `AI_PROVIDER=gemini`,
`GEMINI_MODEL_ID=gemini-3.1-flash-lite`, `OCR_ENGINE=provider`, production mode and memory limits.

### How to tell it worked

- aic-backend **deploy log** shows, in order:
  `[predeploy] migrations applied: 0001_foundation.sql, … 0023_financial_reasoning.sql` (first deploy; later `none`)
  → `[predeploy] runtime role aic_runtime: privileges applied, restricted check passed`
  → `[supervisor] AI service healthy on loopback` → `AIC foundation listening on all interfaces:10000`.
- `https://aic-backend.onrender.com/api/v2/health/ready` returns `{"status":"ready"}`.
- `https://aic-web.onrender.com/login` shows the login page.

## Step 3 — Create the demo login (once)

Render → `aic-backend` → **Shell** (top right). Paste these lines; the second one asks for the demo password
(16+ characters; it is not shown or saved in history):

```bash
read -r -s -p "Demo password (16+ chars): " AIC_SANDBOX_PASSWORD; echo
NODE_ENV=development AIC_SANDBOX_BOOTSTRAP=true AIC_SANDBOX_REMOTE_DEMO=true \
  AIC_SANDBOX_ORGANIZATION_ID="$(cat /proc/sys/kernel/random/uuid)" AIC_SANDBOX_USERNAME=demo.analyst \
  AIC_SANDBOX_PASSWORD="$AIC_SANDBOX_PASSWORD" DATABASE_URL="$AIC_MIGRATION_DATABASE_URL" \
  node apps/api/dist/database/bootstrap-sandbox.js; unset AIC_SANDBOX_PASSWORD
```

Expected: `Sandbox tenant, specialist, unresolved synthetic counterparties and explicit core policy assignments created.`
It creates one organization, the user `demo.analyst`, two synthetic counterparties and policy assignments. It is
insert-only and refuses to run against an existing organization. Log in at `/login` with `demo.analyst`.

## Step 4 — Demo check (synthetic files only)

1. Log in → create a company assessment for a synthetic counterparty.
2. Upload `packages/contracts/fixtures/04_contract.pdf` as a contract.
3. The document job should finish and show fields with evidence quotes. If it shows `PROVIDER_UNAVAILABLE`, check
   `GEMINI_API_KEY` (there is no mock fallback by design).
4. Review fields (correct/verify), then run the evaluation.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `[predeploy] FAILED: Role aic_runtime does not exist` | Run Step 1.3, then **Manual Deploy → Deploy latest commit** |
| `[predeploy] FAILED: password authentication failed` | Wrong password in `AIC_MIGRATION_DATABASE_URL`, or the user is not `postgres.<ref>` |
| `self-signed certificate in certificate chain` | The URL is missing `sslrootcert=/app/deploy/certs/supabase-prod-ca-2021.crt` (Step 1.5) |
| `Hostname/IP does not match certificate's altnames` | Use the pooler **host name** Supabase shows (`…pooler.supabase.com`), never an IP address |
| `must use sslmode=verify-full` / `must set sslrootcert` | Fix the URL ending exactly as in Step 1.5; unverified TLS is refused on purpose |
| `tenant/user … not found` | User name must be `postgres.<ref>` or `aic_runtime.<ref>` (with your project ref) |
| Backend log `API startup failed [APPLICATION/DATABASE_CONNECTION]` | Check `DATABASE_URL` (user `aic_runtime.<ref>`, runtime password, session pooler port 5432) |
| `Production database connections require a restricted nonowner role` | `DATABASE_URL` uses the owner (`postgres.<ref>`); use `aic_runtime.<ref>` |
| Login returns `ORIGIN_REJECTED` | `AIC_FRONTEND_ORIGIN` on aic-backend must equal the aic-web URL exactly |
| Web shows `BACKEND_NOT_CONFIGURED` / `UPSTREAM_UNAVAILABLE` | Check `AIC_BACKEND_URL` (must end in `/api/v2`) |
| Render event "Out of memory" on aic-backend | Change the aic-backend plan to Standard (2 GB, about $25/month); no code change |
| First page load takes about a minute | aic-web (Free) was asleep; open it a few minutes before presenting |

## Limits of this demo setup

- Not production: one region, no backups configured on Supabase Free, no monitoring, synthetic data only.
- The runtime role gets table-level SELECT/INSERT/UPDATE (no DDL, no DELETE); the team's column-level grants
  (`scripts/sandbox-runtime-grants.sql`) predate migrations 0018–0023 and need review before any real deployment.
- Login throttling sees the web service's address for every user (requests arrive through the proxy).
- The backend container's private cache is temporary; PDFs are kept in PostgreSQL, so restarts lose nothing.
