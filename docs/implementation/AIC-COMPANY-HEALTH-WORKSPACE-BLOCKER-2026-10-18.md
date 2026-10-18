# Company financial-health entry — remaining implementation boundary

**Update after continuation, 18/10/2026:** the implementation boundary described
below has now been addressed by the discriminated-purpose vertical slice. See
`AIC-COMPANY-HEALTH-CONTRACT-V1.md`, migration 0020 and remediation report section 9.
Real Chrome creation → FY2024/FY2025 facts → explicit synthetic verification →
blocked assessment → comparison → management report/printed PDF passed on a
separate disposable cluster. Automated tests also retain the 82.5/F2 synthetic
oracle, ACL, idempotency, immutable snapshots and transaction regressions.

The **remaining rollout boundary** is unchanged: migration 0020 has NOT been
applied to `aic_mvp_demo`. Read-only proof confirms migration 0019 and unchanged
A/B/V revisions 32/39/8. Company creation on that installation remains unavailable
until a separately controlled operator rollout with verified backup. The original
diagnosis below is retained as the pre-implementation checkpoint, not current code
status. HK VINA's insufficient grounded financial facts remain an independent data
blocker; no artificial data or verification was substituted.

The owner has already approved the company-first product direction. No further
business-scope clarification is needed. The existing transaction aggregate cannot
honestly stand in for this entry: `aic.cases` requires `exposure_kind`, an exposure
object, transaction roles, lifecycle and bound transaction policy. Current Case
contracts, creation service, review preparation and Financial Registry also bind
to that aggregate. The financial tables have case foreign keys. Renaming the
transaction button or inserting a synthetic RECEIVABLE is therefore insufficient.

No live migration was applied during UX remediation. In particular the existing
`aic_mvp_demo` schema, data, policy bindings and historical snapshots were retained.

Required next vertical slice (UX01; prerequisite for company-first T03/T04/T06):

1. Introduce a versioned company-health workspace contract with company identity,
   owner/membership, organization, revision and timestamps. No exposure amount,
   term, transaction parties, predicted term or PD in its creation request.
2. Add an independent company-health aggregate and append-only statement/fact/
   verification/assessment bindings, or a tested discriminated case-purpose model.
   Pick one consistent model before introducing dual-parent foreign keys. Retain
   all legacy transaction contracts and frozen snapshots unchanged.
3. Separate company source/identity readiness from transaction checklist rules.
   Reuse the seven FHI formulas, weights, sector/period/source gates and null
   behavior. Do not weaken gates or reinterpret transaction findings as company
   financial findings.
4. Build the additive migration and tenant/ACL/replay/concurrency/legacy regression
   suite on a disposable cluster. Review rollout and rollback with a verified
   backup; release through a separate controlled schema rollout. Do not run the
   general migration/reset/seed commands against the live demo as a UX shortcut.
5. Implement company list → create/select workspace → statements/source review →
   explicit verification → assessment → comparison/report. Accept both blocked
   and eligible synthetic runs in Chrome, including reload and permissions.

Until this slice is implemented and rolled out, UX01 is BLOCKED and overall
first-time specialist acceptance is PARTIAL/FAIL. The independently implemented
comparison and report apply to the existing authorized case scope only.
