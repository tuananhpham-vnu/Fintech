# Retest Gemini 3.1 Flash Lite — 17/10/2026

**Kết quả: 2/2 live document workflows PASS; không tái hiện lỗi AI/HTTP429 trong lượt thử này.** Đây là kiểm thử API/worker trực tiếp, không phải full browser acceptance hay phê duyệt production.

Theo yêu cầu trực tiếp của owner, đổi duy nhất `MODEL_ID` trong root `.env` từ `gemini-3.8-flash` sang `gemini-3.1-flash-lite`. Kiểm tra bytes xác nhận các phần còn lại không đổi. Key, prompt version, quota, retry, deadline và concurrency không thay đổi. `.env` vẫn bị Git ignore; không lưu key vào báo cáo/evidence.

## Thực thi thật

```powershell
$env:AIC_ACCEPTANCE_LIVE='true'
$env:AIC_ACCEPTANCE_PROFILE='model-retest'
node scripts/test-local-postgres.cjs --test-concurrency=1 apps/api/test/acceptance-runtime/mvp-acceptance.cjs
```

- Lượt chạy kết thúc `2026-10-17T07:19:49.453Z` (14:19:49 giờ Việt Nam), exit **0**; Node parent **1 PASS**, bên trong **5 checkpoints PASS**.
- Hai case synthetic mới: RECEIVABLE và PREPAYMENT. Cùng PDF `packages/contracts/fixtures/04_contract.pdf`, SHA256 `33a453e3558ff0e8b5a770b70b38f2fb1bc32a2484cd3e916742ed973d378764`.
- Nest thật → PostgreSQL tạm → DocumentWorker thật → FastAPI live → Gemini → persisted result. Không mock. Cả hai output có provenance `gemini-3.1-flash-lite`, schema `1.0.2`, 7 fields, 6 evidence entries, diagnostics rỗng.
- Kiểm tra exact source read/hash, evidence document/page/quote, review và FHI score/band/grade/pd vẫn null theo guard hiện hành.
- Read-only SQL audit: hai jobs `succeeded`, mỗi job `attempts=1`, `fence=1`, `error_code=null`, `ai_mode=live`, đúng một published result. Số lần HTTP nội bộ của provider không được đo riêng; không đồng nhất với worker attempts.
- `provider-diagnostics.json=[]`; không ghi nhận provider failure trong lượt này.
- Chỉ fresh SCRAM cluster `aic-pg-check-U7Np8V` trên15432, migrations0001–0017 và runtime roles riêng. Không dùng/migrate DB của owner. API, AI, worker và PostgreSQL tạm đã dừng; không còn listener3001/8100/15432 sau run.

## Phạm vi thay đổi kiểm thử

Thêm profile `model-retest` vào harness hiện có để tối đa hai document extractions tuần tự, bỏ subset/browser, kiểm model provenance chính xác. Dừng dispatch tiếp nếu lượt trước FAIL hoặc có diagnostic429/auth/not-found/configuration; không fallback mock, không tự đổi model/key. Chế độ cũ giữ nguyên. Thêm `model-retest-policy.cjs` và unit tests.

Syntax check PASS. `node --test apps/api/test/acceptance-runtime/model-retest-policy.test.cjs apps/api/test/acceptance-runtime/provider-diagnostic-reader.test.cjs`: **4/4 PASS** (offline). Không chạy lại toàn bộ regression vì không đổi implementation API/AI/frontend hoặc contract.

## Giới hạn kết luận

Lượt trước model3.8 có bằng chứng HTTP429; model3.1 hiện thành công. Điều này phù hợp với nghi ngờ giới hạn provider/model, nhưng chưa xác định quota bucket/rate-limit cụ thể, và không chứng minh model3.8 luôn lỗi hoặc model3.1 sẽ không bị giới hạn. Không gọi lại3.8 để tăng tải so sánh.

Frontend3000 không chạy nên browser **NOT RUN**. Hai workflows dùng cùng một PDF, không phải đánh giá độ chính xác đa tài liệu. Không khôi phục job cũ đã bị disposable cleanup. Overall MVP/browser release vẫn chờ các gates còn lại; không chuyển báo cáo acceptance cũ thành PASS.

Evidence private, chỉ sao chép năm JSON synthetic đã kiểm tra và manifest: `C:/Users/52duc/Desktop/AIC-Model-Retest-3.1-Flash-Lite-20261017`. Không copy `.env`, private-source, DB hoặc credentials. Original temporary evidence: `C:/Users/52duc/AppData/Local/Temp/aic-accept-evidence-bSUmPm`.

Giữ model mới trong `.env` theo yêu cầu owner. Không stage/commit/push/deploy;314 staged changed paths trước và sau không đổi. Các stack đã chạy từ trước cần restart AI process để nhận cấu hình mới.
