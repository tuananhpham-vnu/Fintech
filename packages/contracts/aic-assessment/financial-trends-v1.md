# AIC-FINANCIAL-TRENDS-1

Additive read-only `GET /api/v2/cases/{id}/financial-trends?baseline_set_id={uuid}`.
Same active specialist session, tenant and case membership locks as Financial Registry.
No migration, write, new score, FX conversion, annualization, source substitution or verification.

Response: contract_version, case_revision, captured_at, baseline_set_id, baseline_metrics, rows.
`baseline_metrics` always preserves the explicitly selected set's current standalone
FHI ratios for the report, even when its comparison with other years is excluded.
Each row contains the current append-only set revision and provenance (`set`), the
existing server FHI registry ratios (`metrics`), independently source-verified
normalized monetary facts (`facts`), `comparison_issues` and `gap_before`.
For transaction cases, incompatible rows retain provenance but have no trend values or metrics.
For company health cases, standalone annual values and metrics remain available when
the column passes its own period, actual observation, regime and version checks.
Such columns carry the optional `standalone_values: true` marker, allowing consumers
to distinguish standalone values from a compatible cross-period comparison.
Cross-column incompatibility remains explicit in `comparison_issues`; it does not
erase otherwise eligible standalone observations. No cross-period totals or growth
calculations are inferred from those observations.

Rules: full calendar FY, actual observations, known regime; entity/country/industry,
pilot scope, basis, regime, currency and input unit multiplier must match baseline.
Multiple versions of the same period/basis require explicit reconciliation and are
excluded. Missing intervening years are identified, never interpolated. Current
fact/source verification gates apply independently to each fact and metric.
No historical assessment is reinterpreted as a current trend observation.

Snapshot is assembled in one case-locked transaction. Readiness and published
assessment permissions remain separate; ratios do not imply eligibility to score.
