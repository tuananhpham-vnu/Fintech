# Company assessment: case evidence and optional period columns

## Owner clarification

The main company assessment must use the evidence supplied to the case. Individual
period columns are supporting comparisons: missing columns must not erase usable
observations in other periods. No minimum number of annual documents is required.
More evidence can change a score in either direction; upload count is not a score.

## Changes completed in this increment

- New reviewed company assessments retain the independently calculable component
  and factor points already allowed by the existing partial assessment guard.
  Missing components stay null. Existing total, band and policy gates remain.
- The company radar displays available components as individual points when some
  axes are missing. It does not draw a polygon through fabricated zeros. Actual
  zero points remain visible and the accessible label includes coverage.
- Company comparison columns are checked independently for their own full annual
  period, actual observations, known accounting regime and version ambiguity.
  A difference from the selected baseline remains a comparison warning but no
  longer deletes eligible standalone annual facts and ratios. Transaction-case
  comparison behavior remains unchanged.
- No financial facts, original sources or historical assessment payloads are
  rewritten. A newly run assessment is required for newly exposed component points.

## Main aggregation implemented

The owner selected equal averaging of eligible annual **metric points**, followed by
summation under the existing metric weights. The company dashboard now requests
that case-wide assessment without selecting one latest statement set.

For each metric, apply the original rubric to each eligible annual set first, then
average its exact earned points over years in which that metric is calculable. Sum
those means once. The earned points already contain the metric weight; they are
not multiplied by that weight again. This is not the rubric applied to an average
ratio, nor an average of partially populated annual totals.

The adapter uses existing source verification and intact within-period inputs.
Full calendar FY actual observations with a known regime participate. Empty,
interim, forecast, out-of-scope or wholly unassessable sets are listed as excluded
with reasons. Each metric has its own contributor count; a missing observation has
no vote and verified zero points remain a vote. No quarterly annualization or flow
stitching is introduced. Different entity, country, industry, pilot, basis, regime
or currency cohorts require reconciliation rather than publishing a blended score.
Unresolved same-period copies cannot gain an extra vote. Existing source-selection
decisions and current set revisions determine which original/comparative source is
active; uploads themselves are never averaged as separate observations.

New snapshots have method version
`AIC-FHI-1.0/1.0.0/mean_metric_points_v1`, a null `financial_set_id`, optional
`case_aggregation` with per-metric annual contributions, and the original annual
calculation traces. The snapshot hash binds the recipe and every current source set.
Old snapshots retain the original single-period preparation path when reread. An
explicit `financial_set_id` continues to request the single-period assessment, and
transaction-case behavior is unchanged.

An incomplete case keeps its original covered maximum and outward-rounded total
bounds. It does not normalize the covered portion to 100, assign zeros to absent
metrics, or publish a complete total/band/PD. The radar and component table display
available points. The supporting annual table uses the optional
`standalone_values: true` contract marker to keep valid annual columns visible when
another column has a different accounting basis; cross-period warnings remain.
The UI exposes annual points, ratios and source-page links separately from the mean.

## Verification

- API TypeScript build passed.
- Web production build passed, including TypeScript.
- 48 backend tests passed against a disposable local PostgreSQL cluster or pure
  synthetic fixtures: intake, workflow/ACL/history, scorer, partial bounds and trends.
  The cluster was stopped after the run; the user database was not used.
- Four targeted frontend tests passed, including partial radar rendering in all
  three locales, actual zero points and no polygon through unavailable axes.
- The full frontend check passed (96 unit tests, 20 contract/integration checks,
  architecture boundaries). It includes the standalone-column contract regression.
- Real UI validation was performed on the existing local case through Chrome's
  Chấm điểm action. An independent exact-arithmetic check of the returned annual
  traces matched every reported component mean and the covered-point sum. Private
  case details and screenshots remain under the ignored UAT report directory.
- The final standalone-column marker change was additionally checked with the
  disposable intake and trends integration suites. No test database was shared
  with the user's application.
