# Phase 2 — Incremental implementation & staged checkpoint

17/10/2026, Asia/Saigon. Branch `duc`; HEAD `8b0b7ed9e983ba4a2ea4d43f79d1816eaad7dbf0` unchanged. **INDEPENDENT_SLICE_COMPLETE / BUSINESS_RELEASE_BLOCKED**. Không audit lại toàn bộ dự án, không mở mutation hoặc worker publication.

## Triển khai thực tế

### 1. Checkpoint đã chuẩn bị ở index, chưa commit

`scripts/prepare-source-checkpoint.cjs` có read-only mode mặc định và `--stage` explicit. Lead kiểm candidate list, Git ignore, source/docs/migrations, placeholders, assets và synthetic fixtures trước khi stage. Không `git add .`, force-add, reset, commit hay push.

Allowlist gồm root workspace config, source/config/assets/frontend tests hiện hành, backend foundation/prototype/tests/migrations, contracts foundation, technical docs và scripts/synthetic fixtures. Bản AI/legacy contracts đã có trong HEAD giữ nguyên, không stage thay đổi service. `.prettierignore` cũng nằm trong checkpoint để giữ cấu hình QA. Root plan cá nhân và archive logo trùng lặp giữ ngoài checkpoint; secret/runtime/generated/real/holdout paths không được đưa vào index.

11 PDF mới được stage chỉ là synthetic fixtures:9 FE PDFs có nhãn `FINTECHATHON / SYNTHETIC DEMO DOCUMENT`,1 synthetic contract có nhãn giả lập,1 malformed fixture theo handoff. Đã đọc/đối chiếu nguồn và pin exact SHA256 từng path; thay bytes sẽ bị chặn.6 PDF contracts cũ đã tracked không sửa/thêm lại. Không thêm PDF hồ sơ thật.

Pattern scan chặn private-key/provider-token/URL credentials; chỉ có ngoại lệ đúng literal/đúng file negative-test frontend đã kiểm. Finding không in secret values.5 tests kiểm path/secret/PDF rules. Đây không phải secret scanner bao phủ mọi định dạng: owner vẫn review staged diff trước commit. Xem [checkpoint notes](PHASE-2-GIT-CHECKPOINT.md). Index là staging checkpoint reviewable, chưa là lịch sử commit hay backup ngoài máy.

Source inventory SHA256 được làm mới trước stage. Staged-path review và so sánh file/index được kiểm sau stage. `.gitattributes` hiện có đã pin LF cho contracts; bổ sung binary đúng hai thư mục synthetic PDF fixtures vì `core.autocrlf=true` và PDF trước đó bị Git coi như text. Không sửa bytes frontend/PDF. Không nhầm inventory với bản sao source. Checkpoint gồm259 changed paths sau bổ sung attributes.

`git diff --cached --check` **FAIL (exit2)** vì whitespace/new-EOF có sẵn trong snapshot frontend specification, legacy backend và handoff docs. Sau khai báo PDF binary còn127 diagnostics trên14 text files; không sửa frontend/handoff hoặc tắt check để che lỗi. Đây là việc vệ sinh snapshot trước commit, không là FAIL của156 tests hoặc source integrity. Checkpoint vẫn staged/reviewable; owner cần biết check này chưa sạch.

### 2. Feasibility runner exit accounting

- `scripts/test-e2e-feasibility.cjs`: suite nhận reporter, entry point được export để kiểm thử mà không chạy HTTP khi import; main bắt lỗi unexpected và luôn tổng hợp kết quả.
- `scripts/feasibility-results.cjs`: exit0 chỉ khi đúng25 ID1–25 không trùng và tất cả PASS; FAIL/BLOCKED/incomplete/duplicate/extra trả1; unexpected error trả2 dù đã log25PASS. Dùng `process.exitCode`, không cắt output bằng `process.exit`.
- `scripts/tests/feasibility-runner.test.cjs`:13 tests, phần lớn chạy actual runner main trong child Node process. Có caught assertion failure được log FAIL, BLOCKED, thiếu/trùng/extra ID, rejection sau25PASS, invalid status, import không chạy suite và parser integration.
- `check-regression-prerequisites.cjs`: log parser yêu cầu marker thành công từ runner hiện hành; không chấp nhận historical log thiếu marker hoặc ERROR sau25PASS. Exit code thực của process vẫn phải được kiểm tra cùng log.

Không sửa các API assertion trong suite để đạt PASS. Test18 vẫn kỳ vọng legacy400 `IDEMPOTENCY_MISMATCH` cho prototype; contract production vẫn409 `IDEMPOTENCY_CONFLICT`. Phần sai biệt này được giữ hiển thị, không hợp thức hóa400 thành production contract. Runner SHA256 mới: `86af6107a27644622333f4d9bc081cf094692221679192008cea97b4bf4bc30e` (khác historical preparation do thay wrapper/accounting có chủ đích). API README/runbook được cập nhật, các báo cáo cũ vẫn là lịch sử.

### 3. AI adapter negative tests

`apps/api/test/ai-adapter-negative.cjs`:57 tests mới chạy compiled validator1.0.2 hiện có, không đổi schema/AI service. Kiểm mutation isolation giữa calls, foreign/dangling/mixed evidence, required-vs-null provenance/diagnostics/payment fields, raw header spoof/duplicate/padding/injection và numeric-string/NaN/infinite/boundaries. Rejection phải giữ input, exact code/path và subsequent valid call không bị ảnh hưởng.

Validator56 tests từ preparation vẫn PASS. Nhãn mock/live và schema validity không được coi là AI accuracy hoặc public AIC2 mapping approval. Không thêm business verification semantics.

### 4. Immutable storage preparation

`apps/api/src/document-storage/byte-integrity.ts`: pure `computeByteIntegrity`/`verifyByteIntegrity`, hash exact Buffer/Uint8Array view, so cả length lẫn SHA256, per-call byte ceiling bắt buộc, không default quota. Reject metadata/coercion/container/shared/detached/out-of-bounds không hợp lệ; error chỉ fixed code/message.12 tests kiểm same-length tampering, slice/view bounds, binary/text khác biệt, limits, metadata, input preservation và sanitization.

[Storage README](../../apps/api/src/document-storage/README.md) là thiết kế draft cho bước sau: atomic create-if-absent, exact immutable version, authorized source/tenant binding, confinement, read-only AI, durable acknowledgement và orphan reconciliation. **Chưa có store/write API/vendor adapter/approved shared port**, không claim immutability từ hash helper hoặc mock. Chưa wire helper vào Nest, chưa tạo migration/document/job endpoint.

## Kiểm thử đã chạy

| Kiểm tra | Kết quả / giới hạn |
| --- | --- |
| `pnpm api:test:preparation` | **156 PASS /0FAIL/0SKIP**, bao gồm build API;13 runner +5 checkpoint rules +56 existing adapter +57 new negative +12 byte integrity +13 existing auth helpers |
| `node scripts/check-ai-adapter-service.cjs` |4 checks PASS: actual FastAPI TestClient mock inspect/extract, live synthetic PDF inspect và missing-key403; in-process, không TCP/FE/proxy/live extraction |
| Checkpoint dry-run/content/path scan | PASS sau review ngoại lệ hẹp; không xuất secret values |
| Node syntax + Git staged path/content consistency | PASS; required paths present, staged contents scanned, raw synthetic PDF hashes preserved; không sửa frontend source |
| `git diff --cached --check` | FAIL exit2:127 pre-existing whitespace/EOF diagnostics trên14 text files; giữ nguyên WIP, không che check |
| Full FE→BE→AI/browser regression | **NOT RUN/BLOCKED**, hạn chế startup đã ghi từ preparation vẫn còn; không retry/alternate launcher trong lượt này |
| Full AI regression / PostgreSQL integration / FE build | **NOT RUN trong lượt này**, không đổi AI/SQL/FE; không dùng kết quả cũ làm PASS mới |

Root scripts mới: `api:test:preparation`, `api:test:adapter-service`. `api:test` giữ nguyên real PostgreSQL baseline, không thay bằng test synthetic. Runner child tests chỉ kiểm test harness, không giả lập để chứng minh API production.

## B01–B04 để owner duyệt

[PHASE-2-DECISIONS.md](PHASE-2-DECISIONS.md) có bảng A/B ngắn ở đầu, phân biệt nghĩa vụ nghiệp vụ với lựa chọn kỹ thuật/config:

- **B01:** đề xuất artifact/operator registry; khác là approval workflow trong app/DB. Owner cần approved artifact/version thực, approval authority, phạm vi và effectivity/overlap. Không lấy transport-test/draft làm policy.
- **B02:** đề xuất typed versioned aggregate hoặc chọn relational. Dù chọn cách lưu nào, paid/received/condition/verification/source/null-term/invalidation semantics vẫn phải được phê duyệt riêng.
- **B03:** private rewritten-header ingress nếu topology khóa được, hoặc authenticated proxy handoff. Cần topology thật trước chọn. TTL8h/idle30m và failure throttle vẫn là cấu hình tạm đã được cho phép; chưa thành final security policy.
- **B04:** đưa lựa chọn replay24h hoặc72h để thảo luận, **chưa áp dụng**. Đề xuất fail-closed với key hết cửa sổ; không tự cleanup/reuse. Retention response/tombstone cuối cùng và hành vi key reuse vẫn cần owner phê duyệt. Cấu hình env không tự thay contract guarantee.

Đây không phải phê duyệt B01–B04. Không có thay đổi business schema/retention/proxy trust. Không cần truy vấn/audit Notion toàn bộ một lần nữa; limitation connector404 đã ghi ở preparation vẫn chưa có evidence khôi phục.

## Blockers và task song song tiếp theo

| Task / owner duy nhất | File ownership / dependency | Acceptance trước tích hợp |
| --- | --- | --- |
| C01 Lead | Shared contracts/ports/decision artifacts; chờ owner các phần B01/B02/B04 mà slice sử dụng | Published shape/examples/negative vectors; không agent khác sửa shared contract |
| A02 AI validation agent | `src/ai-adapters/**`, dedicated tests sau scope assignment | Error-envelope/raw transport capture và AIC2 mapping chỉ sau interface freeze; còn có thể mở rộng canonical synthetic coverage độc lập |
| D00 Storage preparation agent | `src/document-storage/**`, dedicated tests | Có thể chuẩn bị fault/concurrency test matrix độc lập; concrete store cần approved identity/operations/vendor choice, không tự thêm schema |
| P01 Persistence writer | `migrations/**`, `src/database/**` | Chỉ sau document/source/job invariants freeze; real PG rollback/uniqueness/concurrency; một writer |
| D01 Document agent | New document domain + concrete storage adapter, không sửa migration/shared contract | Exact immutable version/hash/source ACL; orphan/duplicate/replace tests với storage thật |
| W01 Worker agent | `src/workers/**`, `src/jobs/**` sau ports/schema release | Job states/lease/attempt fencing + publication CAS, crash/late result không publish; hiện chưa dispatch |
| S01 Ingress agent | Transport/auth scope sau B03 | Actual approved proxy two-client-IP/spoofing tests, không blanket trust headers |

Hai agent trong lượt này đã hoàn tất: Kuhn chỉ viết new negative test; Franklin chỉ viết storage integrity helper/README/tests. Lead review, integration, runner/checkpoint/scripts/report thuộc scope riêng. Không writer nào sửa chung schema/shared contracts. Không để agent tiếp tục âm thầm sau handoff.

Case/exposure/counterparty mutations vẫn đóng theo Phase1; document/worker publication chưa đăng ký. Trước public deployment phải giải B03, chạy full permitted stack và storage/parser/worker security acceptance. Trước business writes phải đủ contracts tương ứng; không dừng các phần độc lập vì những blocker này.

**Không commit, push, reset, deploy hoặc sửa AI/frontend source. Checkpoint staging sẵn cho owner review; foundation được kế thừa.**
