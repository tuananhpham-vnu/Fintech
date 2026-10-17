# Acceptance preparation (lead-owned runtime)

`browser-flows.cjs` exports `runBrowserAcceptance({ browser, origin, username,
password, output, step, providerAvailable })`. The caller supplies its existing
Playwright Browser; this module imports no Playwright package and launches no
browser or service. Use only the lead's fresh disposable DB/tenant with synthetic
credentials, owner-launched frontend, and a private absolute artifact directory.
All mutations use UI actions. Supplemental API calls are same-origin authenticated
GETs. No seed, route interception, mock API, direct DB or background cleanup.

```js
const { runBrowserAcceptance } = require('./browser-flows.cjs')
// browser, origin, username, password, output and step are supplied by the lead.
const result = await runBrowserAcceptance({
  browser,
  origin,
  username,
  password,
  output,
  step,
  providerAvailable,
})
// Persist only result plus the lead's sanitized step statuses.
```

`step(name, fn)` must await `fn()` and return its result, or `undefined` on failure.
It must not swallow failure and return a success placeholder. The helper records
dependent steps as `BLOCKED` without invoking them after an undefined prerequisite.
Callbacks return booleans or synthetic IDs; invitation links remain in a closure.
`result.steps` contains PASS/FAIL/BLOCKED; callers must fail acceptance if any step
fails or is blocked. Check `missingCoverage` separately; success covers only the
implemented subset. `providerAvailable` is metadata and never changes AI evidence
claims or substitutes mock extraction. It is a legacy input name; current output calls it `providerConfigured`,
because a configured key does not establish provider availability. Only a
completed actual job establishes successful extraction.

Post-acceptance recovery: the lead runtime accepts profile `recovery` with
content-free diagnostics. An observed HTTP429/auth/configuration failure stops
further live uploads and immediate retries. Profile `recovery-independent`
deliberately blocks both live upload steps and makes no extraction calls, while
running the other real UI flows. The new `recovery-scenarios.cjs` is executed only
when explicitly enabled by `AIC_RECOVERY_SCENARIOS=true` after source review; it
does not launch services or provide successful API stubs. BLOCKED/FAIL remain in
the aggregate exit status.

Disable Playwright tracing, HAR/video recording, `DEBUG=pw:api` and automatic raw
error/page dumps for this run. The module never starts tracing/video/HAR, masks
password and readonly inputs in every screenshot, checks that capability fragments
are scrubbed before screenshots, and suppresses underlying Playwright call logs
before passing errors to `step`. Caller-added instrumentation must respect the
same rule. Screenshots and TXT exports contain synthetic business data. The helper
closes only contexts it creates, preserving the caller's Browser.

Implemented: invalid/successful login; unresolved counterparty create/edit; both
workflow case creates with party-specific role and exact money/term assertions;
independent review and financial null gates; request draft/approve/download with
repeat-export byte comparison; three locale × two viewport screenshots per
workflow with known-code leak and raw company/money checks; native questionnaire,
one-time invitation, separate cookie-free respondent submit/receipt/provenance and
revocation denial; financial manual fact creation/normalization/null gate on both
workflows. Each invocation has a random synthetic namespace. No implicit retry;
discard the disposable DB as a unit under the lead's runtime lifecycle.

Lead integration additionally exercises upload through the browser, real worker
completion, authenticated runtime-only legacy provenance reads (not an expanded
Next proxy), PDF canvas/hash/zoom, and a null correction preserving original raw
output, on each workflow. Token-fragment consumption is also a regression for
Strict Mode effect replay; actual browser submission and revoke denial are checked.

Not covered here: nullable Exposure editing/claims/conditions; 409 concurrency;
positive field verification; issue/waiver actions; request wrong/correct
supplement and recheck/ack; financial human verification/multi-set/staleness;
capability skip/expiry/reissue/close/races; session reauthentication and cross-tenant
negatives. See the review document for the external suite's exact defects.

Offline commands (repository root, no browser or services):

```powershell
node --check apps/web/tests/acceptance-preparation/browser-flows.cjs
node --test apps/web/tests/acceptance-preparation/browser-flows.test.cjs
node --test apps/web/tests/unit/review-i18n.test.cjs
node --test apps/web/tests/acceptance-preparation/offline-i18n.test.cjs
```

The last command intentionally asserts desired fidelity/localization behavior;
its initial reviewed result is 4 PASS / 5 FAIL (four source defect IDs). The lead
is fixing source independently, so rerun and report current results. Its real
production JSX render checks stub only context/resource/Modal boundaries and do
not prove browser hydration, effects, network, sessions, or PDF rendering.
