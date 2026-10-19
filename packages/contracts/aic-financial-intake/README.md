# AIC-FINANCIAL-INTAKE-1

Additive company BCTC intake. Uses the existing FinancialSet, exact Decimal scorer,
and AIC-FHI-1.0/1.0.0 method without changing formulas, weights, anchors or bands.

Session, tenant/case ACL, CSRF and scoped idempotency apply to all writes. Case
`expected_revision` and the exact review `source_snapshot_hash` prevent stale writes.

| Route | Behavior |
| --- | --- |
| GET /cases/:id/financial-intakes | Items, case revision, common review state |
| POST /cases/:id/financial-intakes | Multipart `file`, `expected_revision`; queues one original |
| POST /cases/:id/financial-intakes/existing | Queue a case-owned existing document/dossier member/financial file |
| POST /cases/:id/financial-intakes/:job/decision | `retry`, `replace`, or `keep_existing` |
| POST /cases/:id/financial-review-confirmations | Explicit common human review and bridge assertions |
| GET /financial-intakes/:id/original | Private original download with source SHA-256 |

Worker: `node apps/api/dist/financial/run-intake-worker.js --poll`. The standard
local launcher starts it. The worker calls authenticated internal AI preparation,
period discovery and the existing grounded financial import endpoint. It checks
case access before provider use and before publication; leases are fenced and
attempts bounded. Provider candidates remain unverified until common human review.

PDF, XLSX, XLS, PNG/JPG/JPEG: 25,000,000 bytes; PDF at most 600 pages.
ZIP: 32 MiB compressed, 64 MiB expanded, 128 entries, 64 supported members.
Unsafe paths, nested archives, active Excel package content and unsupported
members are rejected. Originals, receipts, financial versions and confirmations
are retained. Excel is rendered to derived PDF with sheet/cell coordinates;
formulas are never executed, unavailable cached results remain N/A.

Discovery returns evidenced periods, including comparative years. Same-case
hash or period/basis/kind collisions require an explicit keep/replace decision,
including collisions with older FinancialSets. Replacement appends set revisions.
Different reporting bases are not silently merged or averaged.

`FinancialSourceInput` also supports explicit human `statement_entry` for an
input omitted by AI: receipt, original source identity/hash, page, quote and reason.
Only keys marked missing in that receipt are eligible, within the receipt's exact
period, currency, unit and accounting basis. These entries are not AI extraction
results; they remain unverified until the common review. Corrections to existing
AI facts carry an explicit `human_correction` reason and keep the original receipt.

Any document/fact/counterparty/source change or processing attempt invalidates the
common review. Assessment cannot run without a matching confirmation. Missing
inputs remain null; the existing scorer's arithmetic and method policy gates still
apply. Vietnam is the enabled MVP intake country. US/CN options are disabled in UI.
