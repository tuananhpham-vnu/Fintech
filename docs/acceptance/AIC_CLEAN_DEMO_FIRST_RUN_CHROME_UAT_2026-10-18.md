# Clean-demo real Chrome acceptance — 18/10/2026

**GO / PASS for the owner-approved0020 rollout and clean-demo reset.** Date:2026-10-18T07:33:45.069Z. Actual Chrome integration, browser3; main tab947933429 on127.0.0.1:3000, clone tab947933432 on127.0.0.1:3200. No generated/mock screenshot or API-only create substituted for browser acceptance.

| Check | Actual action and observed result | Result |
| --- | --- | --- |
| Fresh owner sign-in on cleared clone | Owner personally entered credentials; Sandbox specialist shown, new active session for exact preserved user confirmed without token/hash access | PASS |
| Cleared clone lists | Chrome cases/counterparties empty before synthetic test | PASS |
| Counterparty declaration on clone | Actual click/type/save of SYNTHETIC RESET ACCEPTANCE20261018; identity remains unconfirmed | PASS |
| Company assessment on clone | Actual company select/reason/save, navigated to company workspace; no transaction amount/term/type/roles in form | PASS |
| FE→API→DB result | UI case49e002e7-7df4-45b5-862e-28fd9b932201 matches sole clone case, company_health; all five transaction-policy fields SQL NULL; creator membership exists; purpose mutation rejected | PASS |
| Main authenticated access after restart | Retained owner session shows Sandbox specialist/Chuyên viên on3000; user/org/config fingerprints unchanged | PASS; fresh main password submission NOT RERUN |
| Main cases empty | Actual list shows Chưa có dữ liệu | PASS |
| Main counterparties empty | Actual list shows Chưa có dữ liệu | PASS |
| Main capability | Actual browser GET /api/v2/company-assessments/capabilities returns AIC-COMPANY-HEALTH-1,available:true | PASS |
| Main company form | Opened real CTA; company selector and reason shown; reason accepted focus; previous schema warning absent | PASS |
| Main cancel without writing | Cancelled without entering/submitting; returned to empty cases list | PASS |
| Old case/history access | Actual prior case URL now displays unavailable/not authorized message; no old workspace/history | PASS |
| Main final data | Live post-UI query: all41 purged tables0, including all sources/jobs/financial/assessment/audit/history;45 triggers enabled,96 validated FKs,117 valid indexes | PASS |

Main save button is disabled because no company/reason has been entered in this intentionally empty environment; this is expected validation. It is no longer blocked by a schema warning. No counterparty/case/source/financial/assessment fixture was created in main. Main remains the clean owner starting state; the synthetic end-to-end case exists only in the new isolated rehearsal DB.

## Evidence outside Git

- C:\Users\52duc\AppData\Local\AIC\rollout-reset-20261018-SN4TvQ/clone-new-login-empty.jpg
- C:\Users\52duc\AppData\Local\AIC\rollout-reset-20261018-SN4TvQ/clone-company-created.jpg
- C:\Users\52duc\AppData\Local\AIC\rollout-reset-20261018-SN4TvQ/main-clean-cases-vi.jpg
- C:\Users\52duc\AppData\Local\AIC\rollout-reset-20261018-SN4TvQ/main-clean-counterparties-vi.jpg
- C:\Users\52duc\AppData\Local\AIC\rollout-reset-20261018-SN4TvQ/main-company-form-ready-vi.jpg
- C:\Users\52duc\AppData\Local\AIC\rollout-reset-20261018-SN4TvQ/main-old-case-inaccessible.jpg

Screenshots are real captures. The final main form screenshot shows usable controls without the earlier migration banner; list screenshots show actual empty states. Main is handed back on/cases with the form cancelled.

## Coverage boundaries

This run covers the specific fresh/reset/company-create flow, VI main and EN clone. It does not re-claim every old three-locale/viewport/keyboard scenario. Main fresh password sign-in was not repeated; the owner freshly signed in on the identical restored account and retained main access after restart. FHI method remains unconfigured where applicable, PD remains null and missing financial facts keep scoring blocked; no real-company score was issued.

Lint/typecheck/API+web buildPASS;72 frontend unit +20 frontend integration +66 focused API testsPASS. New protected backup/actual restore, atomic reset/rollback and all guard checks are detailed in the paired operator report. Whole-product and real-company financial acceptance are outside this completed reset claim.

After acceptance the temporary clone Chrome tab/API/web/cluster17433 were closed/stopped. Main Chrome tab947933429 stays open on the clean /cases list; main app and PostgreSQL remain running. Backup and all isolated evidence/data are retained.
