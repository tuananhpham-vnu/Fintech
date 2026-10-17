# AIC demo 48h — API handoff cho Antigravity

Ngày: 17/10/2026 (Asia/Saigon). Codex sở hữu API/AI/contracts; Antigravity sở hữu `apps/web/**`.
Đây là contract triển khai, không phải chứng nhận nghiệm thu. Mỗi trạng thái dưới đây phải được cập nhật sau khi chạy test.

## 1. Kết nối đã có — IMPLEMENTED; HTTP regression đã chạy

Base URL: `/api/v2` qua Next proxy; Nest mặc định `http://127.0.0.1:3001/api/v2`.
Cookie phiên HttpOnly hiện có; lấy `csrf_token` qua session/login, gửi `X-CSRF-Token` và Origin hợp lệ cho mọi POST.
Mutation cần `Idempotency-Key` (1–128 ký tự `[A-Za-z0-9._:-]`) và revision của case. Không gửi internal AI key tới browser.
`AIC_RUNTIME_MODE=foundation`, `AIC_DOCUMENT_RUNTIME=local`, `AIC_DOCUMENT_AI_MODE=live|mock` là cấu hình có sẵn; không hỗ trợ production.
Chế độ mock phải hiển thị rõ. Không có fallback từ live sang mock.

| Method/path | Request | Response |
| --- | --- | --- |
| GET `/cases/:id` | session | Case có `revision`, `documents`, `jobs` |
| POST `/cases/:id/documents` | multipart bên dưới | 202 `{document,job,revision}` |
| GET `/jobs/:id` | session | Job bên dưới |
| POST `/jobs/:id/retry` | `{expected_revision: number, reason: string}` + idempotency | 200 `{job,revision}`; retry hữu hạn, không retry tùy ý |
| GET `/documents/:id/source` | session | bytes PDF gốc, header `X-Source-SHA256` |
| GET `/documents/:id/extraction` | session | array field theo schema `ExtractionRead` hiện hành |
| GET `/documents/:id/legacy-extraction` | session | `{document_id,document_version,source_hash,ai_mode,schema_version:"1.0.2",verification:"unverified",raw}`; raw có diagnostics/pages |
| GET `/evidence/:id` | session | evidence có document/version/hash/page/quote/bbox; theo schema hiện hành |
| POST `/documents/:id/classification`, `/corrections`, `/verification` | JSON theo schema hiện hành + revision/idempotency | human decision, không tự xác minh |

Single PDF multipart: `file`, `type`, `source_class`, `mode="new"`, `expected_revision="1"`.
Type: `registration|loan_request|financial_statement|contract|acceptance_record|payment_record|invoice|other`.
Mode replace cần `replaces_document_id`; response cần `response_request_id`.
Giới hạn: 10 MiB/PDF, 10 trang/PDF, 10 tài liệu active và 40 trang active/case. Không cắt trang hoặc đổi bytes/hash.

Job ví dụ (UUID chỉ minh họa):
```json
{"id":"00000000-0000-4000-8000-000000000101","case_id":"00000000-0000-4000-8000-000000000001","document_id":"00000000-0000-4000-8000-000000000201","state":"queued","attempts":0,"errors":[],"retryable":false,"mode":"live","created_at":"2026-10-17T09:00:00.000Z"}
```
State: `queued|running|completed|failed`. `completed` chỉ có nghĩa job kết thúc; có thể không có field usable, chưa được human verify.
Poll GET job/case khi queued/running; dừng khi completed/failed. Khi revision đổi, refresh case trước mutation tiếp theo.

## 2. ZIP PDF import — IMPLEMENTED / HTTP TESTED (offline synthetic proposer)

Endpoint đã triển khai: POST `/cases/:id/document-archives`.
Multipart: `file` ZIP, `expected_revision` chuỗi số nguyên dương. Headers/cookie/CSRF/idempotency như upload PDF.
Không có mode replace/response cho ZIP trong demo. Không có scoring hoặc xác minh pháp nhân tự động.
Nhận tối đa 8 PDF; archive <=20 MiB, <=32 entries kể cả thư mục, <=40 MiB giải nén tổng, <=10 MiB/file, ratio <=100.
Inspection chỉ đọc cấu trúc PDF; extraction/OCR/model chạy bằng job worker riêng, không đọc cả ZIP bằng provider đồng bộ.
Chỉ hỗ trợ ZIP STORED/DEFLATE, không ZIP64/multi-volume/encrypted. MIME: `application/zip|application/x-zip-compressed|application/octet-stream`; tên file `.zip` và magic ZIP phải hợp lệ.
Parser là Python stdlib chạy subprocess `-I -B`, stdin/stdout, không giải nén ra filesystem, không đọc `.env` hay truyền provider keys. Cần `.venv` của repo hoặc Python 3 trên PATH; tối đa 2 parser, timeout 15 giây. Tổng preparation/inspection có budget 60 giây; từng inspection không gia hạn budget hiện hành. `ARCHIVE_READER_UNAVAILABLE` là lỗi dependency local, không lỗi PDF/provider.
Persistence accepted members + receipt atomic cùng transaction và ACL/case lock. Dùng bảng/writer/job hiện có, **không cần migration mới**.

Response 202; schema thực thi runtime trong `packages/contracts/aic-demo-48h/schemas.json` (`ArchiveImportOutput`, ghép definitions với aic-foundation). Ví dụ shape hợp lệ 1 PDF + 1 file không hỗ trợ:
```json
{
  "archive_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "case_id": "00000000-0000-4000-8000-000000000001",
  "revision": 2,
  "state": "partial",
  "items": [
    {
      "entry_index": 0, "entry_path": "BCTC_2025.pdf",
      "group": "financial_statements", "suggested_type": "financial_statement",
      "classification_verification": "unverified", "status": "accepted",
      "document": {
        "id": "00000000-0000-4000-8000-000000000201",
        "lineage": "00000000-0000-4000-8000-000000000301",
        "version": 1, "hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "pages": 1, "type": "financial_statement", "name": "BCTC_2025.pdf", "status": "queued",
        "owner_party_ref": "unresolved",
        "source": {"source_class": "archive_unverified", "document_id": "00000000-0000-4000-8000-000000000201", "version": 1, "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "ai_mode": "live", "subject_verification": "unverified"},
        "classification": {"declared_type": "financial_statement", "verified": false}
      },
      "job": {"id": "00000000-0000-4000-8000-000000000101", "case_id": "00000000-0000-4000-8000-000000000001", "document_id": "00000000-0000-4000-8000-000000000201", "state": "queued", "attempts": 0, "errors": [], "retryable": false, "mode": "live", "created_at": "2026-10-17T09:00:00.000Z"},
      "rejection": null
    },
    {
      "entry_index": 1, "entry_path": "unsupported.xlsx", "group": "other", "suggested_type": "other",
      "classification_verification": "unverified", "status": "rejected", "document": null, "job": null,
      "rejection": {"code": "ARCHIVE_UNSUPPORTED_FORMAT", "retryable": false}
    }
  ]
}
```
UUID/hash trong ví dụ là synthetic minh họa, không phải receipt từ hồ sơ thật. Accepted luôn có document/job đầy đủ; rejected luôn null cả hai và có `rejection`.
`state=accepted|partial|rejected` mô tả import, không mô tả extraction. Các item giữ thứ tự entry; thư mục hợp lệ không tạo document/job.
`group=financial_statements|contracts|tax|payments|other` chỉ là gợi ý theo tên file, người dùng cần xác nhận.
Tờ khai thuế có `suggested_type=other` vì schema legacy chưa có tax_declaration. Invoice không gán thành payment.
RAR/XLS/XLSX/JPG và nested archives phải liệt kê bị từ chối; không bỏ âm thầm.
ZIP slip, absolute/drive/UNC, symlink, duplicate paths, encryption và archive malformed bị chặn trước persistence.
Idempotency dùng hash archive + expected revision; replay trả receipt cũ, poll job để lấy tiến trình mới. Không tự retry toàn batch bằng key mới sau mất kết nối.
Không cần endpoint polling batch riêng: dùng từng `job.id` và GET case. Receipt gồm các file bị reject phải được UI giữ để người dùng xem.
Nếu một phần đã accepted, không submit lại cả ZIP bằng key mới: sẽ tạo document mới và tính quota. Chỉ upload riêng file rejected sau refresh revision; `retryable` ở rejection là gợi ý thử lại, không phải một job đã tồn tại.
Nhóm được gợi ý từ tên/path file; `document.type` được khai báo bằng suggested_type và luôn unverified. Sau reload, đọc group qua extraction-summary; GET case không tự thêm property ngoài schema Document hiện hữu.

## 3. Kết quả extraction dễ hiểu — IMPLEMENTED / HTTP TESTED

GET `/documents/:id/extraction-summary` dùng session/ACL hiện hữu. Schema runtime `ExtractionSummary`:
```json
{"document_id":"00000000-0000-4000-8000-000000000201","document_version":1,"source_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","job_state":"completed","ai_mode":"live","verification":"unverified","group":"other","suggested_type":"other","classification_verification":"unverified","outcome":"zero_usable_fields","total_fields":1,"non_null_fields":0,"usable_fields":0,"diagnostics":[],"fields":[{"field_key":"legacy:1.0.2:document.summary","has_value":false,"quality":"unreadable","missing_reason":"not_present","evidence_count":0}]}
```
`outcome=processing|ready_for_review|zero_usable_fields|failed`. Chỉ đếm **machine extraction**, không gộp human corrections hoặc coi là đã verify. `usable_fields` cần value khác null/unknown, có evidence, quality khác unreadable; OCR uncertain vẫn cần human review.
`diagnostics[]` chỉ gồm `{code,field_key}`, không trả nội dung provider/raw exception. `fields[]` trả chất lượng/lý do thiếu và số evidence; giá trị và evidence cụ thể lấy từ endpoints hiện hữu.
Nếu failed, GET job để lấy `errors[].code/retryable`; không dựa vào summary để tự gán lỗi parser.
UI phải phân biệt đang xử lý, có dữ liệu cần review, completed nhưng zero usable fields, và lỗi provider/parser.
Không coi provider 429/quota/503 là lỗi parser. Không hiện nội dung raw provider/secrets trong thông báo.
Provider adapter hiện chuyển HTTP429/503 upstream thành `PROVIDER_UNAVAILABLE`/503 có retry budget; API không phân biệt quota cố định với rate limit. Không được hiển thị là “PDF hỏng”. Không thay canonical provider error schema/policy retry trong lượt này.

M1 đã sửa: comparison U+0003→space có mapping về source quote/offset nguyên gốc; NFC quote mapping; OCR cho vector có mực và garbled không có image; blank thực không bị gọi OCR; tổng text/OCR budget. Diagnostics mới: `TEXT_SEPARATOR_NORMALIZED`, `VECTOR_OCR_USED`, `GARBLED_TEXT_LAYER`. Không nới value/source/role/amount/unit guards. OCR values vẫn uncertain/unverified.

## 4. Lỗi và acceptance

Lỗi HTTP hiện hành: `{code,message,request_id,details}`. 401 session, 403 Origin/CSRF, 404 ACL/not found, 409 revision/idempotency/quota, 413 size, 422 format/inspection, 502/503 AI transport/provider.
ZIP sai container/security trả lỗi toàn request, không import một phần trước khi phát hiện unsafe archive.
ZIP hợp lệ có file không hỗ trợ/quá caps trả receipt từng file; không hiển thị 202 thành extraction success.
Per-file thường gặp: `ARCHIVE_UNSUPPORTED_FORMAT`, `ARCHIVE_PDF_LIMIT`, `INVALID_DOCUMENT`, `DOCUMENT_TOO_LARGE`, `DOCUMENT_PAGE_LIMIT`, `DOCUMENT_INSPECTION_REJECTED`, `DOCUMENT_CASE_QUOTA_EXCEEDED`, `PDF_INVALID`, `PDF_ENCRYPTED`, `AI_SERVICE_UNAVAILABLE`, `AI_TIMEOUT`, `ARCHIVE_INSPECTION_BUDGET`.
Whole-request ZIP errors gồm `ARCHIVE_UNSAFE_PATH`, `ARCHIVE_UNSAFE_ENTRY`, `ARCHIVE_DUPLICATE_PATH`, `ARCHIVE_ENCRYPTED`, `ARCHIVE_INVALID_ZIP`, `ARCHIVE_UNSUPPORTED_ZIP`, `ARCHIVE_UNSUPPORTED_COMPRESSION`, `ARCHIVE_SIZE_LIMIT`, `ARCHIVE_ENTRY_LIMIT`, `ARCHIVE_EXPANDED_SIZE_LIMIT`, `ARCHIVE_COMPRESSION_RATIO`, `ARCHIVE_NO_FILES`. Busy/timeout/unavailable parser trả 503; các size/entry/expanded/reader `_LIMIT` trả 413; lỗi security/container (gồm compression ratio) trả 422. Multipart quá file limit trả 413 `PAYLOAD_TOO_LARGE` qua filter hiện hữu.

### Antigravity — việc nối FE còn lại (snapshot source khi bàn giao)

1. `apps/web/src/lib/api/proxy-policy.ts`: POST `cases/:id/document-archives` đã xuất hiện trong source Antigravity ở lần đọc cuối; GET `documents/:id/extraction-summary` vẫn cần thêm. Chưa chứng nhận browser. Không mở wildcard tới AI/internal endpoints.
2. `apps/web/src/app/api/v2/[...path]/route.ts`: multipart ZIP cap **21 MiB** (20 MiB bytes + overhead); giữ PDF 11 MiB, JSON 1 MiB. Hiện route mới rơi về 1 MiB. Forward `X-Source-SHA256` từ backend cho source evidence; hiện allowlist response headers chưa có.
3. Thêm API decoder/form ZIP theo schema thực thi ở trên; hiển thị mọi rejection + group unverified. Refresh case revision bằng receipt; receipt replay giữ job snapshot queued ban đầu, phải poll actual jobs.
4. Nối summary để phân biệt zero usable/failed và hiện lý do field null. Không gọi legacy-extraction như endpoint browser hiện đã allowlist (hiện chưa có).
5. Chạy browser acceptance dưới đây, bao gồm refresh/replay và source viewer. Frontend source có thể đang thay đổi song song; Codex không sửa `apps/web/**`.

Browser acceptance Antigravity: chọn ZIP synthetic 4–8 PDF + một XLSX bị reject; hiển thị đủ accepted/rejected và group unverified; poll từng job; mở PDF nguồn đúng hash/version/page; hiển thị zero usable fields và provider unavailable rõ; kiểm tra CSRF/revision/replay; không claim XLSX/RAR support.
Fixture phải tổng hợp. Không upload hồ sơ thật, không gọi cloud/provider nếu chưa có owner cho phép riêng.
ZIP sẵn dùng: `packages/contracts/aic-demo-48h/fixtures/synthetic-4pdf.zip` và `synthetic-4pdf-plus-rejections.zip` (4 PDF hợp lệ + XLSX unsupported + PDF11 trang). Không chứa hồ sơ doanh nghiệp.

## 5. Giới hạn nghiệp vụ và gates

M0–M2 ưu tiên. M3 financial proposals và M4 matching: CHƯA TRIỂN KHAI trong lượt này; chỉ xem xét sau M0–M2 có kiểm chứng thực tế.
Financial Registry nhập tay hiện có tiếp tục là fallback; không claim PDF tự đổ registry. `method_status=unconfigured` giữ score/band/grade/PD null.
Không suy `counterparty` từ legacy `borrower`; RECEIVABLE seller/buyer và PREPAYMENT buyer/supplier cần human source binding.

## 6. Bằng chứng kiểm thử và go/no-go

| Kiểm chứng đã chạy | Kết quả |
| --- | --- |
| `pnpm api:build` | PASS |
| AI full suite, network/`.env` blocked | **466 PASS / 4 SKIP / 0 FAIL**; gồm 9 PDF regressions và 22 ZIP security tests |
| Nest/FastAPI/PostgreSQL integration + existing core/registry/FHI regressions | **194 PASS / 0 FAIL / 0 SKIP** |
| `demo-48h-contract.cjs` + `document-ai-transport.cjs` | **72 PASS / 0 FAIL**; gồm 6 DTO/summary/reader tests và deadline override |
| Adapter/evidence/storage regression trước test deadline mới | 226 PASS / 4 SKIP; có overlap với transport suite, không cộng tổng |

4 SKIP của AI: quyền symlink, 2 scan fixture chưa có trong handoff bundle, Tesseract chưa cài. Storage có 4 SKIP symlink Windows. Không sửa expectations/gold/schema canonical để giả PASS. Không chứng nhận OCR/model provider thật từ test fake engines/proposer.
HTTP ZIP suite mở rộng đã PASS các kiểm tra: 4 accepted + 2 reject, concurrent first-import/replay, revocation ACL/CSRF/MIME, receipt fault rollback, 10 docs/40 pages quotas, source/evidence/hash/version, completed-zero-fields, provider stopped. Runtime dùng proposer tổng hợp có nhãn `mock`, **không chứng minh chất lượng/live availability của Gemini**.
Regression HTTP cũ đã PASS cả RECEIVABLE/PREPAYMENT, financial registry nhập tay, field human review và source recovery. Test native inspection đã được đổi launcher để chặn `.env` và network thay vì nạp provider settings thật; không đổi expectations.

**GO:** Backend/AI offline synthetic demo qua API. **PENDING:** tích hợp proxy/UI và nghiệm thu browser bởi Antigravity. **NO-GO cho claim:** live provider đã kiểm chứng, đã chạy hồ sơ thật/bộ 59 file, auto financial proposals/registry, cross-document matching hoàn chỉnh, rating/PD được phê duyệt. M0/M2 toàn hành trình chưa được tuyên bố PASS khi browser gate chưa chạy; vì vậy chưa mở M3/M4.
Worker là process riêng: `node apps/api/dist/documents/run-worker.js --poll` với cấu hình local hiện hữu; `--once` chạy một job. Không tự migrate DB thật hoặc khởi chạy với credentials/hồ sơ thật. API/AI cần runtime cấu hình nhất quán live/mock; mock fixture mode thường chỉ biết bundle gold, **không tự nhận mọi synthetic ZIP**. Proposer offline linh hoạt chỉ nằm trong test harness, không được thay cho provider thật trong sản phẩm.
Checkpoint source/diff trước sửa đã lưu ngoài repo trong thư mục tạm `aic-demo-48h-checkpoint-*`; không reset/stash/commit/push hoặc sửa `.env`.

### Lệnh tái hiện (từ repo root)

```powershell
pnpm api:build
.\.venv\Scripts\python.exe -B apps/api/test/acceptance-ai-fixtures/run_unit_suite.py --tb=short
node --test apps/api/test/demo-48h-contract.cjs apps/api/test/document-ai-transport.cjs
node apps/api/test/run-demo-48h.cjs --run
```

Runner cuối scrub inherited DB/provider env, kiểm tra port15432 trống, gọi launcher PostgreSQL tạm; không dùng DB5432 của owner. Yêu cầu PostgreSQL18 binaries đã cài (hoặc `AIC_POSTGRES_BIN`), venv/PyMuPDF của repo. Không tự cài runtime, đọc `.env` hay migrate DB thật. Test runner giữ test-owned diagnostic cluster sau khi stop, không xóa dữ liệu người dùng.
API/SQL regression log của lượt đóng gói cuối: `C:/Users/52duc/AppData/Local/Temp/aic-demo-48h-regression-20261017-163113.log`: **194 PASS / 0 FAIL**, exit0; cluster tạm đã stop trong finally. Runner đóng gói đã được chạy thật, không chỉ kiểm tra syntax.

### Files touched trong lượt Codex (so với checkpoint, không phải so với HEAD)

- AI: `services/ai/extraction/{pdf,grounding,extractor}.py`; helper mới `services/ai/scripts/demo_zip_reader.py`; tests `test_demo_pdf_regressions.py`, `test_demo_zip_security.py`.
- API: mới `documents/document-archive.ts`, `document-archives.controller.ts`, `extraction-summary.ts`; cập nhật `documents/{ports,documents.controller,postgres-document.repository}.ts`, `ai-adapters/document-ai-transport.ts`, `foundation/{foundation.module,validation}.ts`.
- Contracts/fixtures: `packages/contracts/aic-demo-48h/**` (schema additive + 2 ZIP synthetic); không sửa bundle/hash legacy.
- API tests: mới `document-archive.integration.cjs`, `demo-48h-contract.cjs`, `demo-zip-runtime.py`, `run-demo-48h.cjs`; thêm deadline test vào `document-ai-transport.cjs`; đổi subprocess launcher an toàn trong `document-http.integration.cjs`.
- Handoff: chính file này. Không sửa FE/method/FHI, không migration mới, không commit/push/deploy.

## 7. Additive one-ZIP dossier — backend implemented and tested offline

New product-path contract: [AIC-ONE-ZIP-DOSSIER-API-CONTRACT.md](AIC-ONE-ZIP-DOSSIER-API-CONTRACT.md); schemas: [aic-dossier/schemas.json](../../packages/contracts/aic-dossier/schemas.json). `POST /api/v2/cases/:id/dossier-archives` acknowledges raw ZIP persistence with 202, then durable asynchronous intake exposes archive/member polling and retained PDF sources. Runtime merges the seven `Dossier*` definitions with existing definitions, including unchanged `ExtractionSummary`.

The dossier route implements a distinct capacity pool: 32 MiB ZIP, 64 PDFs, 128 entries, 64 MiB expanded, 4 archives/128 stored PDF sources/128 MiB member bytes per case and 1,024 current canonical dossier pages. Antigravity must add the exact five routes and new 33 MiB proxy body cap; existing single-PDF/legacy ZIP contracts, 10-document/40-page quotas, and old ZIP 21 MiB proxy cap remain unchanged. The browser uploads one ZIP without splitting. **Real offline HTTP/DB/worker tests passed for 30/60 synthetic PDFs and 89 extraction jobs, with a separate final 9-test repository run covering physical storage/page limits and lease scheduling. Browser/proxy integration and live provider tests remain pending.** Full evidence and commands are in the dossier contract.

Dossier `registered` counts retained non-rejected PDF sources, including awaiting inspection and `needs_review`; it does not mean canonical document/job assignment, queued extraction, or analysis. Review-only archives are intake-accepted and finish processing with errors. Full PDFs above 10 pages are retained for review without truncation or extraction jobs. Under the subsequently approved Gate B, migration 0018 and restricted runtime grants were applied to the existing local `127.0.0.1:5432/aic_mvp_demo` after encrypted backup and actual isolated restore passed. The API and both workers use the verified restricted roles; all existing application-table fingerprints remain unchanged. Current evidence and encrypted-credential startup procedure: [DB_GATE_B_EXECUTION.md](DB_GATE_B_EXECUTION.md). No production deployment, commit, push or FHI method change occurred; browser E2E and live provider verification remain pending.
