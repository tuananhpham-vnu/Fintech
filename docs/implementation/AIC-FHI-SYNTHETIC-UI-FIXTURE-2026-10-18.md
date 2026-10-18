# Synthetic FHI fixture for manual desktop acceptance

This is a technical arithmetic fixture, not a company statement, business verification, calibrated rating, or demo response. Enter it through the real UI into a separately named local case. It must never be attached to a real company's dossier or counted as real-data acceptance. No external AI processing is needed.

## Original input record

Reference: `SYNTHETIC-FHI-UI-20261018`. Entity: existing synthetic Buyer Alpha, with a new technical case. Reporting period: FY 2025, 2025-01-01 through 2025-12-31; standalone; VN_TT133; VND; multiplier 1; pilot distribution/wholesale. Observation is the fixture's completed period, with unaudited status and source version `synthetic-fhi-2025-v1`.

| Fact | Original decimal |
| --- | --- |
| current_assets | 200 |
| current_liabilities | 100 |
| cash | 30 |
| unrestricted_short_term_equivalents | 20 |
| trade_receivables | 50 |
| total_equity | 200 |
| total_assets | 500 |
| total_liabilities | 300 |
| interest_bearing_debt | 100 |
| operating_profit | 80 |
| depreciation_amortization | 20 |
| interest_expense | 20 |
| net_revenue | 400 |
| cash_from_operations | 32 |

For this synthetic record only: cash, equivalents and receivables are distinct, eligible quick assets; D&A 20 is the add-back to EBIT 80 for the same entity/period/basis. Balance reconciles exactly: 200 + 300 = 500. Record these as manual declarations first. Verification, if exercised, means checking the UI's persisted fixture values against this original record, with a reason that explicitly says synthetic technical acceptance. It does not verify any real business.

## Independently worked expected result

Each ratio falls exactly on a documented method anchor. Expected points below are worked from the approved pilot rubric before observing application output.

| Metric | Calculation | Anchor credit | Weight | Expected points |
| --- | --- | --- | --- | --- |
| M01 | 200 / 100 = 2 | 1 | 15 | 15 |
| M02 | (30 + 20 + 50) / 100 = 1 | 0.75 | 10 | 7.5 |
| M03 | 200 / 500 = 0.4 | 0.8 | 20 | 16 |
| M04 | 100 / (80 + 20) = 1 | 0.9 | 10 | 9 |
| M05 | 80 / 20 = 4 | 0.8 | 15 | 12 |
| M06 | 80 / 400 = 0.2 | 1 | 10 | 10 |
| M07 | 32 / 400 = 0.08 | 0.65 | 20 | 13 |

Expected sum: **82.5 / 100**, **AIC-F2** (70 <= 82.5 < 85), experimental / NOT VALIDATED, PD=null. Group totals: 22.5/25, 16/20, 21/25, 23/30.

Before verification and bridge assertions, score/band must remain null. Without the quick-assets assertion M02 must remain blocked; without the D&A assertion M04 must remain blocked. A later input revision must make the old result stale and require review again. Do not change weights, gates, source fidelity, or policy to make the fixture pass.

## Execution result

Manual Chrome execution observed the seven expected component points and 82.5/AIC-F2, case revision 10. Before bridge verification, revision 7 retained null score/band and blocked M02/M04. Case: `91c0f61e-5d4a-47ae-8f63-67f604c7a04b`. See the desktop UAT report for evidence and later transitions. This does not establish real-company data acceptance or statistical calibration.

## Second-year negative input record

Create a separate FY2024 set (2024-01-01 through 2024-12-31), source version `synthetic-fhi-2024-zero-ebitda-v1`, with the same scope and units. Copy the original decimals above except four explicitly documented zeros: `interest_bearing_debt=0`, `operating_profit=0`, `depreciation_amortization=0`, `interest_expense=0`. They are known fixture values, never substitutions for missing data. The same quick-asset and D&A bridge definitions apply to this second-year record.

Expected: M04 remains blocked because EBITDA is zero even though debt is zero. M05 may take its verified zero-interest/zero-debt exception. Overall score/band must remain null; M01/M02/M03/M06/M07 must use only the selected FY2024 set. Having two sets requires explicit selection. Selecting FY2024 must never display FY2025's 82.5 as its score. This does not test automatic multiyear trend analysis.
