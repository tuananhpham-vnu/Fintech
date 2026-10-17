# REC-UI handoff

`apps/web/tests/acceptance-preparation/recovery-scenarios.cjs` exports
`runRecoveryScenarios({ browser, origin, username, password, output, step, cases })`.
Only this helper, its new unit test, and this document are owned by REC-UI.
Application source, contracts, shared helpers, and runtime are unchanged by this task.

Lead integration (after explicit `AIC_RECOVERY_SCENARIOS=true` gating in the
lead-owned harness):

```js
const {
  runRecoveryScenarios,
} = require("../../../web/tests/acceptance-preparation/recovery-scenarios.cjs");
const recovery = await runRecoveryScenarios({
  browser,
  origin,
  username,
  password,
  output,
  step,
  cases: browserResult.cases,
});
// Persist the complete recovery object, including FAIL/BLOCKED/NOT RUN and cleanup.
// Aggregate required failures from recovery.ok; recovery.complete includes omissions.
```

The import above is relative to
`apps/api/test/acceptance-runtime/mvp-acceptance.cjs`. This module does not read the opt-in itself;
the lead owns invocation, a fresh module load, and recording the frozen hash.

Supply the existing Playwright Browser, plain same-origin HTTP(S) origin, explicit
synthetic specialist credentials, both disposable existing case IDs as
`{ RECEIVABLE: id, PREPAYMENT: id }` (also accepts `{ id }` values), and an absolute
private evidence directory. Cases must belong to that specialist's organization.
No financial baseline is required: if none exists, two sets are created through
UI; otherwise one new set is added. Run serially without other case writers.
`step(name, fn)` must await `fn()` exactly once and return its value or undefined
on failure. Disable tracing, HAR, video, API debug logging, and raw error dumps.

Both core workflows exercise unknown Exposure amount/term with persisted reasons,
empty/whitespace reason rejection with zero PATCH requests and unchanged revision,
an actual unknown payment claim retained as an unverified declaration, two
independently authenticated specialist pages causing real 409, retained draft,
explicit Refresh/rebase/resubmit, frozen roles/party/policy, financial multiple-set
selection, manual-entry verification, Exposure snapshot staleness, and edited
manual provenance requiring fresh verification. Score/band/grade/PD and metric
points remain null; all seven displayed FHI component points remain gated.
Keyboard checks cover both arrows, Home/End, focus/selection, native dialog focus
and Escape. Dirty Escape/stay/discard, cross-case draft discard, logout denial of
session/case GETs, and same-identity relogin verify discarded drafts stay absent.
Logout coverage does not claim session expiry or cross-identity isolation.

All writes use real UI. Supplemental calls are authenticated same-origin GETs
with redirects disabled. No extraction, upload, retry-job, provider request, API
write setup, interception, direct DB, or runtime launch is implemented here.
An independent scenario navigates and reloads its case before operating, clearing
prior failed dialogs; failed prerequisite steps stay BLOCKED. No callback retry
can execute a mutation twice. Recorder errors and cleanup failures remain FAIL;
every owned context is closed once, and the caller's Browser stays open.

Source classification/field verification and replace/response modes **exist**:
`document-classification.tsx`, `field-correction.tsx`, `upload-dialog.tsx` and
`features/documents/api.ts` were inspected. They are explicitly NOT RUN here:
case IDs alone provide no reviewed source-to-party identity oracle; replacement
and request supplements dispatch extraction and need approved source fixtures.
No absent button is interpreted as unsupported functionality. Expiry and
cross-identity checks also remain NOT RUN without their own runtime fixtures.

Failures expose only controlled `UI_TIMEOUT`/`ASSERTION`/`ACTION_ERROR` categories,
action stage and numeric helper line, never original errors, bodies, URLs, or
tokens. Failure/success screenshots permit only known login/case paths and
non-capability tab fragments, reject all query strings, and mask readonly,
password, username and alert fields. Safe-capture omissions are recorded. Artifacts
contain synthetic business data and belong in the lead's private evidence root.

Source references:

- `apps/web/src/features/cases/components/transaction-dialog.tsx`: nullable controls,
  frozen kind/stage and real conflict refresh/rebase; `exposure-editors.tsx`:
  payment claim fields. Wrapped native selects use combobox prefix matches.
- `apps/web/src/features/cases/helpers/exposure-inputs.ts` and `schemas.ts`:
  required reason validation, exact source identities and claim roles.
- `apps/api/src/foundation/mvp-case.service.ts`: ExposureRead regenerates record
  and binding IDs on write. Assertions compare editable values/exact source
  identity and separately check generated declaration provenance.
- `apps/web/src/features/financial/components/financial-registry.tsx`, `api.ts`,
  `apps/api/src/financial/financial-registry.service.ts`: explicit set selection,
  manual verification, snapshot invalidation and new fact revisions. Editing the
  source resets verification to unverified; snapshot changes make it stale.
- `apps/web/src/features/assessments/components/{risk-assessment,fhi-breakdown}.tsx`:
  score cards require an existing assessment; seven gated component buttons
  always render. No empty score-card collection is used as the sole null oracle.
- `apps/web/src/features/cases/components/workspace.tsx`,
  `components/ui/{modal,leave-prompt}.tsx`, `features/auth/session-provider.tsx`:
  keyboard, dialog, discard, and logout behavior.
- Existing `browser-flows.cjs`, acceptance runtime and bundled Next.js
  `01-app/02-guides/testing/playwright.md` informed integration; no startup from
  the Next.js guide was executed.

Validation: syntax checks for both new CJS files, the focused Node unit suite,
and Prettier only. Exact final counts and SHA-256 are supplied in the REC-UI
handoff message. Unit tests exercise orchestration/error accounting/cleanup and
null gates; they do not simulate successful UI acceptance. The lead's preliminary
`D6IWaG` run used an unfinished require-cached helper and is not frozen-source
acceptance. Current real-UI coverage remains unverified until the gated lead run.
