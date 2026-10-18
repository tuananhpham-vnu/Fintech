# One-ZIP dossier — additive API contract and early handoff

Date: 2026-10-17 (Asia/Saigon). **Backend contract implemented; offline runtime verification recorded below. Gate B operator enablement completed on the existing local `aic_mvp_demo`; browser acceptance remains unverified.** Current database/backup/role/runtime evidence and safe startup commands: [DB_GATE_B_EXECUTION.md](DB_GATE_B_EXECUTION.md). Existing demo test results alone do not certify this additive path.

## 1. Integration handoff

Schema file: [`packages/contracts/aic-dossier/schemas.json`](../../packages/contracts/aic-dossier/schemas.json). Add these seven names to the runtime's **merged definitions**: `DossierAccepted`, `DossierArchiveSummary`, `DossierArchive`, `DossierArchiveList`, `DossierMember`, `DossierMemberSummary`, `DossierCounters`. `DossierMemberSummary` is the member extraction-summary response, not an archive-list item.

Merge foundation definitions, existing `aic-demo-48h` definitions (including unchanged `ExtractionSummary`), then dossier definitions into one draft-07 root. Resolve every `#/definitions/...` reference there. Do not register this fragment as an isolated schema or introduce external schema refs. All response object properties are required, including nullable fields, and every object has `additionalProperties: false`. `DossierArchiveList` is a bare array. The archive detail repeats the summary properties flat to preserve strict draft-07 validation.

This is a new product path. The browser uploads the ZIP once; it does not need to split it into PDFs. The existing single-PDF route and legacy ZIP route retain their existing contracts and quotas. No FHI ingestion, financial registry proposals, automatic subject binding, or verified period inference is introduced.

## 2. Routes, authorization, and acknowledgment

All paths below are relative to `/api/v2`. Use the existing session cookie and case ACL. POST uses the existing `Origin`, `X-CSRF-Token`, `Idempotency-Key`, and optimistic case revision protections. `Idempotency-Key` follows the existing 1–128 character `[A-Za-z0-9._:-]` policy. Reads require the same case access, including every source download after permission changes.

| Method and path | Request | Response schema |
| --- | --- | --- |
| POST `/cases/:id/dossier-archives` | `multipart/form-data`: one `file` ZIP and `expected_revision` as the current integer revision encoded as a form field | 202 `DossierAccepted` |
| GET `/cases/:id/dossier-archives` | Session / case ACL | 200 `DossierArchiveList` |
| GET `/dossier-archives/:id` | Session / owning case ACL | 200 `DossierArchive` |
| GET `/dossier-members/:id/source` | Session / owning case ACL | Immutable original PDF bytes, including retained long PDFs in `needs_review` |
| GET `/dossier-members/:id/extraction-summary` | Session / owning case ACL | 200 `DossierMemberSummary` |

The POST persists the **raw ZIP only**, its SHA-256, archive receipt, case revision, idempotency receipt, and durable intake work atomically before acknowledging. It does not synchronously unpack, inspect members, create documents, or run extraction. Container/path/security validation happens asynchronously; a 202 can later become a rejected archive. Request-level authentication, revision, multipart, storage admission, and compressed-size checks still happen before acknowledgment.

Replaying the same request with the same idempotency key returns the original acknowledgment and archive identity/revision, even after intake advances; poll `manifest_url` for current state. A conflicting request under the same key uses the existing conflict behavior. Never resubmit the whole ZIP under a new key to recover a lost response: that is a new archive admission with its own capacity consumption. `manifest_url` must contain this response's `archive_id`.

Synthetic 202 acknowledgment (illustrative, not a runtime receipt):

```json
{
  "archive_id": "00000000-0000-4000-8000-000000000301",
  "case_id": "00000000-0000-4000-8000-000000000001",
  "archive_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "revision": 12,
  "intake_state": "queued",
  "manifest_url": "/api/v2/dossier-archives/00000000-0000-4000-8000-000000000301"
}
```

## 3. Durable intake and processing

The durable worker validates the complete ZIP security envelope before registering any member, then persists safe member identities and independently inspects each supported PDF. A malformed archive, unsafe entry, or normalized duplicate path is archive-fatal; no partial source promotion may precede completion of archive safety validation. Valid archives with unsupported/failed members expose those outcomes explicitly.

Intake work is serialized **one archive at a time per case, two globally**, with 120-second recoverable leases, fencing against stale workers, and a maximum of **three parse attempts and three inspection attempts per member**. Retries reuse archive/member IDs and stable entry indexes, paths, hashes, document/job associations, capacity reservations, and stored source bytes; they do not duplicate sources or extraction jobs. Expired attempts can be reclaimed. Exhausted parse attempts reject the archive; exhausted member inspection retains the source as `needs_review`. Quota admission, manifest persistence, source promotion and final lease checks are transactional. A worker `idle` result can perform attempt-exhaustion maintenance; always poll the target archive until its durable state is terminal.

Promoted PDFs use the existing documents writer and extraction jobs, with a **distinct dossier capacity pool**. Existing extraction behavior, evidence provenance, human verification, and retry policies remain in effect. Database leases and an advisory admission lock bound dossier extraction globally to **two jobs** and **one per case** across workers. Extraction waits while the same case has pending dossier intake, so source registration does not invalidate already-running snapshots. Admission bounds active leases; expired processes must pass the existing fencing checks before publishing.

Archive intake states: `queued | validating | registering | accepted | partially_accepted | rejected`. At terminal intake, `accepted` means at least one safe PDF source was retained and no source was rejected; `partially_accepted` means at least one accepted source and at least one rejected source; `rejected` means zero accepted sources or an archive-fatal security/container failure. Accepted-source counts concern stored source PDFs, not canonical documents or extraction jobs. Retained `needs_review` sources are accepted sources, never actual rejections. An archive containing only safely retained review PDFs is intake-accepted. Intake terminal state does not describe extraction success.

Archive processing states: `waiting | processing | finished | finished_with_errors`. Waiting covers pre-extraction work; processing covers queued/running extraction. Processing becomes terminal after intake is terminal and all eligible extraction jobs are terminal. Rejected, failed, or review-required members make the terminal aggregate `finished_with_errors`; a successfully completed extraction with zero usable data remains an explicit `completed_zero_usable` outcome, never a claim of analyzed usable data. Terminal processing does not imply verification or rating readiness.

Member intake states: `awaiting_inspection | inspecting | registered | rejected | needs_review`. Member processing states: `waiting | queued | running | completed_with_usable_data | completed_zero_usable | failed | needs_review | not_applicable`. Unsupported members use `rejected` / `not_applicable` with an error code and null document/job/source. A retained long or over-processing-budget PDF uses `needs_review` / `needs_review`, with null document/job and a downloadable immutable PDF source. Canonical `document_id` and `job_id` are assigned only after supported inspection and promotion eligibility checks. **Source registration is distinct from canonical document/job assignment, queued extraction, and analysis.** A stored source awaiting inspection or needing review counts as registered even with null document/job IDs. A member that reaches intake state `registered` after promotion may still be queued, running, zero-usable, or failed.

Counters are one current snapshot, not cumulative attempts. `discovered` counts file members (safe directory entries consume the ZIP entry limit but do not become members). **`registered` counts stored source PDFs that are not rejected**, including members in `awaiting_inspection`, `inspecting`, `registered`, or `needs_review`; it is not a count of the literal member intake state `registered`, canonical documents, jobs, queued work, or analyzed PDFs. `rejected` counts actual rejected members. `awaiting_inspection` counts both awaiting and currently inspecting members. `queued`, `running`, `completed_with_usable_data`, `completed_zero_usable`, and `failed` count processing states. `needs_review` counts each member once if either axis requires review. Source-registration and processing counters overlap: do not add all counters to infer a total. Snapshot consistency and ID/URL associations require runtime checks in addition to JSON Schema.

For example, a safe 60-PDF archive including one 12-page PDF can have `intake_state: "accepted"`, `registered: 60`, `rejected: 0`, and `needs_review: 1`. Once the other 59 PDFs finish extraction, its processing aggregate is `finished_with_errors` because the retained 12-page PDF still needs review. A source with null document/job IDs does not prevent intake acceptance.

## 4. Limits and retained PDFs

All MiB values mean 1,048,576 bytes. Limits apply to actual streamed/expanded bytes, not untrusted ZIP declarations alone.

| Scope | Limit / behavior |
| --- | --- |
| Raw ZIP | 32 MiB (33,554,432 bytes) |
| Expanded archive | 64 MiB (67,108,864 bytes) |
| ZIP entries | 128, including directory entries |
| PDFs per archive | 64 |
| Entry nesting depth | 8 |
| Individual PDF | 10 MiB (10,485,760 bytes) |
| Stored dossier capacity per case | 4 archives, 128 accepted PDF sources, 128 MiB member bytes (134,217,728 bytes) |
| Dossier processing pages per case | 1,024 processed pages; exceeding processing capacity retains the PDF as `needs_review` |
| Automatically promoted PDF | At most 10 pages, subject to remaining dossier processing capacity |
| PDF with >10 and <=500 pages | Retain complete bytes as `needs_review`, reason `PDF_REQUIRES_CHUNKED_PROCESSING`; no document promotion, extraction job, analysis, or truncation |
| PDF with >500 pages | Same full-byte retention and `needs_review`, reason `PDF_PAGE_BUDGET` |
| Existing single-PDF / legacy ZIP pool | Unchanged 10 documents / 40 pages; dossier capacity is distinct |

The 1,024-page pool counts current canonical dossier document pages, including queued work; replacing a dossier document also checks that pool. It is not a cumulative count of model attempts or OCR calls. Storage limits conservatively count all immutable member objects, including reservations for a source later rejected by PDF inspection. Retained review-only PDFs consume storage without consuming canonical processing pages. Raw archive objects additionally consume at most 4 × 32 MiB per case. No automatic expiry/deletion or reclamation of these immutable objects is implemented.

Resource admission also limits multipart dossier uploads to two per API process, all ZIP reader subprocesses to two per process and dossier readers to one per process. Dossier reader timeout is 30 seconds with a 96 MiB stdout ceiling and compression ratio limit 100. Database intake leases bound work globally to two and per case to one; extraction has the same dossier concurrency bounds. The budgets bound admitted work, not the total RSS of the API, Python, PostgreSQL and operating system.

Processing budgets must not be confused with storage or ZIP security ceilings. Retention for page budgets assumes a safe supported PDF within byte/storage admission limits; it does not bypass those hard limits. Every discovered file needs an explicit manifest outcome; no PDF may be silently dropped or truncated. Do not slice long PDFs, extract the first 10 pages, silently discard remaining pages, or force browser splitting. Metadata inspection/page counting is allowed to classify the retained source; machine extraction/analysis is not. Page count may remain null while unavailable. A successfully inspected PDF can report more than 500 pages; schema does not cap `page_count` at the analysis threshold.

All formats except PDF are explicitly unsupported, including XLS/XLSX, images, RAR, and nested archives. Unsupported entries appear in the manifest with a safe rejection code; a filename extension is not proof of PDF content. Existing path/security controls must reject traversal, absolute/drive/UNC paths, unsafe links, encryption, malformed containers, and unsafe expansion. **Normalized duplicate paths are fatal**, while duplicate bytes under distinct safe paths remain distinct sources with separate member IDs. Equal SHA-256 does not authorize collapsing source identity, provenance, counters, or quota consumption.

`entry_index` is the original zero-based ZIP entry index and is stable, including gaps for directory entries. `entry_path` preserves the original validated safe relative display path; normalized identities are used internally for duplicate/security checks. A member's `sha256`, detected MIME, page count, and source URL can be null before successful inspection/storage; null means unavailable, not an empty hash or zero pages. `byte_size` is the member byte size, not compressed size. Stable immutable PDF bytes bind to member ID/path/hash throughout worker recovery and promotion. Source download returns `application/pdf` and the existing `X-Source-SHA256` integrity header, with session/ACL checks and private storage; neither raw storage paths nor public object URLs are exposed.

`group` and `suggested_type` use the existing demo enums. Classification remains `unverified`. Filename/path years are hints only: `period_suggestion.year` may be an integer or null, while `kind` and `basis` remain `unresolved` and `verification` remains `unverified`. Multiple years do not establish a fiscal period. `subject_verification` stays `unresolved`; a filename, directory, legacy borrower label, or AI output cannot bind the source to a verified business subject.

## 5. Concrete manifest and extraction-summary

This synthetic snapshot has two registered PDF sources: one promoted PDF awaiting extraction and one retained 27-page PDF without a canonical document/job. The unsupported spreadsheet is an actual rejection, so intake is partially accepted. The counters illustrate source registration versus analysis and include every required property.

```json
{
  "id": "00000000-0000-4000-8000-000000000301",
  "case_id": "00000000-0000-4000-8000-000000000001",
  "archive_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "intake_state": "partially_accepted",
  "processing_state": "processing",
  "created_at": "2026-10-17T09:00:00.000Z",
  "counters": {"discovered": 3, "registered": 2, "rejected": 1, "awaiting_inspection": 0, "queued": 1, "running": 0, "completed_with_usable_data": 0, "completed_zero_usable": 0, "failed": 0, "needs_review": 1},
  "error_code": null,
  "members": [
    {
      "id": "00000000-0000-4000-8000-000000000401",
      "archive_id": "00000000-0000-4000-8000-000000000301",
      "entry_index": 0,
      "entry_path": "2024/financial-statements.pdf",
      "byte_size": 4096,
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "detected_mime": "application/pdf",
      "group": "financial_statements",
      "suggested_type": "financial_statement",
      "classification_verification": "unverified",
      "period_suggestion": {"year": 2024, "kind": "unresolved", "basis": "unresolved", "verification": "unverified"},
      "subject_verification": "unresolved",
      "intake_state": "registered",
      "processing_state": "queued",
      "page_count": 4,
      "document_id": "00000000-0000-4000-8000-000000000201",
      "job_id": "00000000-0000-4000-8000-000000000101",
      "error_code": null,
      "retryable": false,
      "source_url": "/api/v2/dossier-members/00000000-0000-4000-8000-000000000401/source"
    },
    {
      "id": "00000000-0000-4000-8000-000000000402",
      "archive_id": "00000000-0000-4000-8000-000000000301",
      "entry_index": 1,
      "entry_path": "2023-2024/long-contract.pdf",
      "byte_size": 8192,
      "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "detected_mime": "application/pdf",
      "group": "contracts",
      "suggested_type": "contract",
      "classification_verification": "unverified",
      "period_suggestion": {"year": null, "kind": "unresolved", "basis": "unresolved", "verification": "unverified"},
      "subject_verification": "unresolved",
      "intake_state": "needs_review",
      "processing_state": "needs_review",
      "page_count": 27,
      "document_id": null,
      "job_id": null,
      "error_code": "PDF_REQUIRES_CHUNKED_PROCESSING",
      "retryable": false,
      "source_url": "/api/v2/dossier-members/00000000-0000-4000-8000-000000000402/source"
    },
    {
      "id": "00000000-0000-4000-8000-000000000403",
      "archive_id": "00000000-0000-4000-8000-000000000301",
      "entry_index": 2,
      "entry_path": "unsupported.xlsx",
      "byte_size": 1024,
      "sha256": null,
      "detected_mime": null,
      "group": "other",
      "suggested_type": "other",
      "classification_verification": "unverified",
      "period_suggestion": {"year": null, "kind": "unresolved", "basis": "unresolved", "verification": "unverified"},
      "subject_verification": "unresolved",
      "intake_state": "rejected",
      "processing_state": "not_applicable",
      "page_count": null,
      "document_id": null,
      "job_id": null,
      "error_code": "ARCHIVE_UNSUPPORTED_FORMAT",
      "retryable": false,
      "source_url": null
    }
  ]
}
```

Example of the retained member's extraction-summary response:

```json
{
  "member_id": "00000000-0000-4000-8000-000000000402",
  "archive_id": "00000000-0000-4000-8000-000000000301",
  "document_id": null,
  "job_id": null,
  "intake_state": "needs_review",
  "processing_state": "needs_review",
  "error_code": "PDF_REQUIRES_CHUNKED_PROCESSING",
  "extraction": null
}
```

For a promoted document, `extraction` is the **existing `ExtractionSummary`** when available, otherwise null. It keeps the existing unverified machine-extraction semantics, diagnostics, field quality/evidence counts, and usable-field rules. Null does not mean zero usable fields. Once extraction completes, distinguish `completed_with_usable_data` from `completed_zero_usable`; neither marks human verification. Provider unavailable/quota/rate-limit outcomes must not be labeled as malformed PDFs. Only existing human workflows may verify or correct the extracted data.

## 6. Proxy, errors and operator handoff

The new Next multipart route needs a **33 MiB (34,603,008 byte) body cap**, allowing the 32 MiB ZIP plus multipart overhead. Backend raw ZIP cap remains 32 MiB. The legacy `/cases/:id/document-archives` route's **21 MiB** proxy body cap stays unchanged, as do existing PDF/JSON caps. Add only the five precise new method/path patterns above to the proxy policy; do not broaden wildcards or expose internal AI routes. Forward the existing source integrity response header for the new source route.

Use the existing HTTP error envelope `{code,message,request_id,details}` and auth/ACL behavior. Existing revision/idempotency/capacity conflicts are 409, oversized multipart file bytes 413, and immediate invalid request format 422. `DOSSIER_UPLOAD_BUSY` is 503 before multipart buffering; retry the same request/key after backoff. Unsafe ZIPs or member inspection problems discovered after 202 are reported by polling DTOs, not by retroactively changing that POST response. `error_code` is a safe machine-readable string, never a raw provider exception, private path, or secret. `retryable` describes bounded member recovery, not permission to resubmit the ZIP or a new retry endpoint.

| Condition | Surface / code |
| --- | --- |
| Fifth archive for a case | POST 409 `DOSSIER_CASE_ARCHIVE_LIMIT` |
| Raw ZIP magic, extension or MIME mismatch | POST 422 `ARCHIVE_INVALID_ZIP` |
| Revision / same-key fingerprint conflict | POST 409 `REVISION_CONFLICT` / `IDEMPOTENCY_CONFLICT` |
| Unsafe path, normalized duplicate path, bad CRC/container | Archive `rejected`: `ARCHIVE_UNSAFE_PATH`, `ARCHIVE_DUPLICATE_PATH`, `ARCHIVE_INVALID_ZIP` |
| Archive entry / expansion / ratio / encryption restriction | Archive `rejected`: `ARCHIVE_ENTRY_LIMIT`, `ARCHIVE_EXPANDED_SIZE_LIMIT`, `ARCHIVE_COMPRESSION_RATIO`, `ARCHIVE_ENCRYPTED` |
| Unsupported format / individual PDF >10 MiB / beyond first 64 eligible PDFs | Member `rejected`: `ARCHIVE_UNSUPPORTED_FORMAT`, `DOCUMENT_TOO_LARGE`, `ARCHIVE_PDF_LIMIT` |
| Exhausted member object count / bytes | Member `rejected`: `DOSSIER_CASE_MEMBER_LIMIT` / `DOSSIER_CASE_BYTE_LIMIT` |
| PDF signature / parser failure | Member `rejected`: `INVALID_DOCUMENT` / `PDF_INVALID` |
| PDF encrypted / embedded attachments | Member `rejected`: `DOCUMENT_INSPECTION_REJECTED` |
| PDF >10 and <=500 pages | Retained `needs_review`: `PDF_REQUIRES_CHUNKED_PROCESSING` |
| PDF >500 pages or full canonical page pool | Retained `needs_review`: `PDF_PAGE_BUDGET` |
| Parse attempt budget exhausted after crashes | Archive `rejected`: `DOSSIER_INTAKE_ATTEMPTS_EXHAUSTED` |
| Member inspection attempts exhausted after crashes | Retained `needs_review`: `DOSSIER_INSPECTION_ATTEMPTS_EXHAUSTED` |

Transport/worker retry failures retain their safe originating code; the third retryable member failure becomes `needs_review` with `retryable:false`. Source unavailable is 404; session/ACL errors follow the existing policy. Provider availability/quota failures remain extraction failures and never imply an invalid PDF.

Operator handoff: [`0018_mvp_dossier_intake.sql`](../../apps/api/migrations/0018_mvp_dossier_intake.sql) and [`dossier-runtime-grants.sql`](../../apps/api/src/documents/dossier-runtime-grants.sql) were subsequently applied to the existing local `127.0.0.1:5432/aic_mvp_demo` under the approved Gate B, after encrypted backup, actual isolated restore and migration rehearsal passed. The official checksum-tracked runner applied only 0018; restricted-role authentication, ACL isolation and preservation of every existing application table were verified. This local enablement is complete; do not repeat provisioning. Use the encrypted-credential launcher and evidence in [DB_GATE_B_EXECUTION.md](DB_GATE_B_EXECUTION.md). Enabling another database/deployment remains a separate operator action requiring its own authorization and verified backup/restore; never paste migration DDL outside the runner, grant intake tables to PUBLIC or invent a browser session for background work.

Run `node apps/api/dist/documents/run-dossier-worker.js --poll` with the existing restricted API/intake role and local runtime configuration. Run the existing `run-worker.js --poll` separately with the extraction worker role, plus the configured local AI service/private cache. Dossier intake inspects metadata without proposing model fields; extraction uses the explicitly configured AI mode. The new intake CLI permits local, non-production operation only, never migrates, and does not load `.env`. Starting only the API persists ZIPs as `queued`; it does not drain intake. All API and worker processes require the updated build/schema; database readiness rejects an unapplied migration.

## 7. Implementation and verification gates

`SOURCE_IMPLEMENTED`, `UNIT_TESTED` and `HTTP_INTEGRATION_TESTED`: verified for the disclosed offline synthetic scope. `BROWSER_E2E_VERIFIED` and `LIVE_PROVIDER_VERIFIED`: not established.

| Deliverable / evidence | Status |
| --- | --- |
| Additive schemas and contract | SOURCE_IMPLEMENTED; all seven definitions merged in API validator |
| API persistence, admission, ACL/CSRF/revision/idempotency and five routes | SOURCE_IMPLEMENTED; HTTP_INTEGRATION_TESTED offline |
| Migration 0018 and new-object runtime grants | Applied under approved Gate B to existing local aic_mvp_demo; encrypted backup/actual restore/restricted-role checks passed; no production deployment claim |
| Durable validation, member inspection, leases/fencing/max-three recovery | SOURCE_IMPLEMENTED; repository and actual HTTP/worker integration tested |
| Existing writer / separate quotas / page-budget retention | SOURCE_IMPLEMENTED; 30/60 actual PDFs plus repository boundary checks tested |
| Global-two / per-case-one extraction scheduler | SOURCE_IMPLEMENTED; restricted-role DB tests cover lease recovery and legacy progress when dossier pool is full |
| Precise proxy allowlist / 33 MiB new route / unchanged 21 MiB old route | PENDING Antigravity; backend work does not edit `apps/web/**` |
| Browser one-ZIP intake, polling, full source viewer and error display | BROWSER_E2E: NOT VERIFIED |
| New-route acceptance | HTTP_INTEGRATION_TESTED; synthetic/mock, no external provider |
| Legacy regression after additive changes | 194 passed; old ZIP/single-PDF, both core workflows, ACL, retry and FHI gates preserved |

Schema verification: installed Ajv/ajv-formats compiled all seven merged definitions. Three JSON examples and derived summary/list/member/counter payloads validated. Assertions covered 61 missing properties, eight extra properties, nullable fields, IDs/hashes/enums, unresolved period/subject constraints, boundaries and reuse of existing `ExtractionSummary`. Those checks certify schemas/examples only; the separate runtime evidence below establishes backend behavior.

Executed evidence on 2026-10-17:

- `pnpm api:build`: PASS.
- Offline AI suite: **566 passed, 4 skipped**. Includes legacy PDF/OCR/grounding regressions and new ZIP security/limit boundaries. Skips include unavailable Tesseract/scan fixtures and Windows symlink privilege; this does not certify live OCR/provider availability.
- `node apps/api/test/run-dossier-tests.cjs --run`: **18 passed, zero failed**. Real Nest HTTP, FastAPI/PyMuPDF, PostgreSQL, restricted runtime grants, durable intake worker and existing extraction worker; explicitly synthetic mock proposer, network/provider secrets excluded. Includes concurrent first POST/replay, actual Nest restart, source-byte/hash recovery, 89 extraction publications, usable and zero-usable results, source-bound evidence, explicit human verification, malformed/mixed ZIP outcomes, logout survival and ACL revocation. Repository checks separately exercise audit rollback/stale fences, source/page limits, review-only acceptance and durable scheduling. The 11/500/501-page repository cases supply inspection metadata to verify admission policy; they do not certify full extraction of those page counts.
- Contract/transport/evidence regressions: **90 passed**.
- `node apps/api/test/run-demo-48h.cjs --run`: **194 passed, zero failed** on the final build/schema. Includes the old four-PDF ZIP, single-PDF HTTP, both RECEIVABLE/PREPAYMENT workflows, document retry/version/evidence, auth/ACL/revision, migration constraints and disabled/unconfigured FHI behavior. Its disposable PostgreSQL cluster stopped cleanly.
- Final repository rerun after adding the physical-byte boundary: **9 passed**. It stores exactly 128 MiB in immutable member objects, rejects the next source with `DOSSIER_CASE_BYTE_LIMIT`, and proves later PDF rejection cannot reclaim the reservation. The same run passes 128-source/1,024-page boundaries, dossier replacement page checks and legacy scheduling while both dossier slots are occupied. This is a DB admission test with synthetic source/inspection metadata, not an OCR throughput measurement.

Measured HTTP scenario: 30 sources across three years have 39 pages and 30 canonical jobs. The 60-source fixture has 80 source pages: 59 canonical jobs covering 68 pages plus one fully retained 12-page PDF requiring review. The latest complete HTTP run took approximately **243 seconds** including setup, all scenarios and extra mixed-case jobs. Observed Node RSS reached **295,989,248 bytes**; this excludes Python/PostgreSQL and is not a whole-process-tree peak or a throughput guarantee. Files are intentionally small; this proves one-upload volume and provenance, not a large real enterprise dossier benchmark. An earlier inspect attempt returned a transient retryable failure; the harness asserts durable retry state and recovery within three attempts rather than treating that attempt as success.

Downloadable synthetic fixtures: [`synthetic-thirty.zip`](../../packages/contracts/aic-dossier/fixtures/synthetic-thirty.zip), [`synthetic-sixty.zip`](../../packages/contracts/aic-dossier/fixtures/synthetic-sixty.zip), [`synthetic-mixed.zip`](../../packages/contracts/aic-dossier/fixtures/synthetic-mixed.zip). Reproduce with the repo Python environment and local PostgreSQL installed: `pnpm api:build`, then `node apps/api/test/run-dossier-tests.cjs --run`; old demo regression: `node apps/api/test/run-demo-48h.cjs --run`. The runners create/stop their own fresh loopback cluster and never apply owner/demo/production migrations or load `.env`.

Local operator enablement subsequently completed under Gate B: existing aic_mvp_demo is at 0018 with restricted API/intake and extraction roles; an additional restored-copy HTTP run passed 10/10, including 30/60 PDFs and 89 extraction publications. The main database received zero fixture imports, and all old application data fingerprints remained unchanged. See the execution report above for the current local-only launcher; the standard dev-all launcher remains unchanged.

Still pending: Antigravity browser acceptance, live provider/OCR checks and any real dossier test. XLS/XLSX/images/RAR/nested ZIP parsing, chunked long-PDF extraction, content-level classification, cross-document reconciliation, financial registry auto-ingestion and rating/PD activation are not implemented by this slice. Filename/path categories and years remain unverified hints; no FHI method or approval gates changed.
