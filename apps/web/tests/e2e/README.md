# Browser regression checklist

## Integration run on 16 October 2026

Chrome UI checks were performed against synthetic QA at 127.0.0.1:4900, with the production UI on 3101. Observed: invalid/valid login, both core flows/create, four role pairs, international counterparty, 409 manual recovery, six tabs on five viewports, immutable PDF canvas/pages, review while FHI blocked, waiver/stale, synthetic FHI/transaction separation, acknowledgement audit and 403/422/429/503 errors. Screenshots are in `.reports/browser/`; detail and limits are in `docs/integration-audit.md`.

Browser file selection was blocked by extension file-URL permission. Local browser use was later disabled in Work settings before locale/session/respondent coverage and final-patch retest. The last screenshot exposed clipped long money in a row: CSS wrapping was fixed, but browser retest could not run. Do not report the checklist below as fully passed. The older browser-unavailable statement below describes the imported baseline.

This is a checklist, not an executable browser test suite. Historical browser reports have been moved to the sibling FE Fintech Backups directory and predate the source cleanup. Post-refactor browser automation was unavailable because local browser use is disabled in Work settings. HTTP regression does not replace these checks.

Run against the isolated QA harness at `http://127.0.0.1:4800`; never seed a production backend.

- Login, invalid credentials, logout, same-identity reauthentication with unsaved drafts, different-identity draft isolation.
- Counterparty create/edit/search/pagination; all four transaction role pairs; large integer money; 409 load, inspect and manually resubmit.
- Upload new/replacement/request-response PDF; immutable source version, hash and page; invalid/oversized PDF; local PDF.js assets.
- Independent document review while numeric assessment is blocked; job completion refresh; issue decisions; waiver/revoke with retained findings.
- Assessment readiness, stale result, factors/evidence, acknowledgement and audit-only history refresh.
- Questionnaire origins, verification, invitation and respondent scope; required/skip answers; pending writes keep drafts and do not report success.
- Request draft pending state, approve/cancel and immutable export.
- English/Vietnamese/Chinese changes preserve forms and sources; keyboard focus/dialogs; widths 390, 768, 1024, 1280 and 1440 px.
- 401/403/404/409/422/429/503 and malformed responses preserve the documented error and retry semantics.

Record observed outcomes and screenshots separately. Do not copy historical PASS results into a new run.
