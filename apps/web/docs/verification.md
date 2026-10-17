# Kiểm tra tích hợp monorepo — 16/10/2026

Đây là kết quả thực tế của source `apps/web` trong lượt tích hợp hiện tại. Phần báo cáo nhập cũ được giữ phía dưới dưới nhãn lịch sử; không lấy số liệu cũ làm nghiệm thu mới.

| Kiểm tra         | Kết quả thực tế                                    | Bằng chứng                                                            |
| ---------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| Frozen install   | Đạt, pnpm 11.22.0; giữ dependency lock từ bản nhập | `pnpm install --frozen-lockfile`, root lockfile                       |
| Lint hiện có     | Đạt architecture + Prettier; chưa có ESLint        | `.reports/lint.log`                                                   |
| Architecture     | Đạt, 94 runtime files, 10 modules                  | `.reports/architecture.json`                                          |
| Unit             | 8/8 nhóm đạt                                       | `.reports/frontend-tests.log`                                         |
| Consumer/proxy   | 18/18 kiểm tra đạt                                 | `.reports/consumer-checks.json`                                       |
| Typecheck        | Đạt typegen + tsc strict/noEmit                    | `.reports/typecheck.log`                                              |
| Production build | Đạt, giữ toàn bộ URL sản phẩm                      | `.reports/build.log`                                                  |
| HTTP runtime QA  | 12/12 nhóm đạt trên build cuối                     | `.reports/http-regression.json`, `.reports/http-qa.log`               |
| Next proxy thật  | 503 chưa backend, 403 sai Origin, 404 private AI   | Nằm trong HTTP QA, trực tiếp UI port 3101                             |
| Browser          | Đã kiểm một phần, chưa nghiệm thu toàn bộ          | `.reports/browser-observations.json`, 5 ảnh trong `.reports/browser/` |
| AI regression    | 361 passed / 4 skipped / **1 failed**              | `.reports/ai-regression.log`, `.reports/ai-regression.xml`            |

AI chạy trong venv local Python 3.12 với dependencies khai báo của service, từ cwd `services/ai`. Lỗi còn lại là `tests/test_extraction.py::test_contract_extraction_grounded`: kỳ vọng `prompt_version=extraction-v1` nhưng code trả `extraction-v2`. Không sửa AI/tests/contracts để ép xanh. Lượt thử từ repo root có thêm lỗi đường dẫn tương đối; đã chạy lại từ cwd service theo README và số liệu bảng trên lấy từ lượt này.

HTTP QA chạy trên 127.0.0.1:4900, Next production UI trên 3101 để tránh các tiến trình có sẵn ở 3001/4800. Không kiểm backend AIC thật; không gọi provider/OCR/scorer thật. Muốn chạy lại cần đặt `AIC_QA_PORT=4900` và `AIC_QA_UI_PORT=3101`; xem README.

Browser đã quan sát login, hai core flow/create, role, đối tác quốc tế, 409 recovery, PDF canvas/đúng page/hash, review khi FHI blocked, waiver/stale, FHI QA riêng transaction Unknown, acknowledgement audit và 403/422/429/503. Sáu tab đã bấm trên 1440/1280/1024/768/390 trước patch cuối. Ảnh cho thấy số tiền dài bị cắt sau khi load; đã thêm wrap nhưng không thể retest browser.

Chưa chạy xong: browser upload (extension không có file URL permission), hết phiên/đổi identity, locale/draft, respondent, phân trang và các write đang pending. Local browser use bị tắt trong Work settings trong lúc tiếp tục. Ảnh/bằng chứng browser thuộc build trước patch cuối về wrap, guards/decoder và respondent validator. Các patch cuối đã qua source/type/build/HTTP nhưng **chưa browser retest**. Không báo frontend E2E hoặc toàn hệ thống PASS.

Ma trận và phần chờ API tại [integration-audit.md](integration-audit.md). Không sửa hoặc nâng trạng thái task Notion.

## Báo cáo nhập trước tích hợp — chỉ lịch sử

# Kiểm tra sau dọn cấu trúc — bản nhập ngày 16/10/2026

Phạm vi: source hiện tại trong `src/`, Next production build và dịch vụ QA riêng trên loopback. Dữ liệu QA tổng hợp; chưa có backend thật để nghiệm thu.

## Kết quả

| Kiểm tra                     | Kết quả        | Bằng chứng/lệnh                                                                                                |
| ---------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| Cài dependency đúng lockfile | Đạt            | `pnpm install --frozen-lockfile`                                                                               |
| Production build             | Đạt            | `pnpm build`, các URL sản phẩm giữ nguyên                                                                      |
| TypeScript                   | Đạt            | Typegen và `tsc --noEmit`                                                                                      |
| Kiến trúc                    | Đạt            | 92 file, 10 module; không vòng import/file code bỏ rơi; alias/import hợp lệ                                    |
| Unit                         | 4/4 nhóm đạt   | Vai trò/tiền/conditions, readiness/stale, upload, respondent validation                                        |
| Consumer/proxy               | 18/18 đạt      | Decoder, transport, CSRF/origin/allowlist, 401/409, idempotency, bytes                                         |
| HTTP QA                      | 11/11 nhóm đạt | SSR/CSS, auth, đối tác, hai core exposure, 409, upload/source, review, waiver/history, scoped form, assessment |
| Loại tài nguyên cũ           | Đạt qua HTTP   | URL preview, placeholder và PDF demo trả 404; PDF worker cục bộ giữ đúng bytes                                 |
| Ghi log khi dừng QA          | Đạt            | `.reports/qa-http-observations.json`, không tạo lại thư mục artifacts                                          |

JSON hiện hành nằm trong `.reports/`: `architecture.json`, `consumer-checks.json`, `http-regression.json`, `qa-http-observations.json`. Thư mục này được gitignore và không nằm trong import graph sản phẩm.

## Thay đổi được kiểm tra

- Gom ứng dụng vào `src/`; sửa alias, test loader và config liên quan.
- Chuyển lịch sử/demo/audit/file tạm ra thư mục `FE Fintech Backups` cạnh dự án; giữ snapshot source trước dọn.
- Bỏ hai module không dùng, các route chỉ bọc 404 và placeholder assets cũ.
- Bỏ bảy dependency trực tiếp không dùng cùng các gói kéo theo; không nâng phiên bản thư viện còn dùng.
- Loại 944 selector CSS có class không xuất hiện trong code hiện tại; giữ thứ tự các rule còn dùng. CSS được ghép qua một entry, Tailwind chỉ quét `src`.
- Gom toàn bộ output kiểm tra vào `.reports/`; cache TypeScript vào `.next/cache/`; bỏ cấu hình shadcn/workspace không còn sử dụng.

## Chưa nghiệm thu

Kiểm thử bấm UI sau dọn cấu trúc **chưa chạy** vì local browser use bị tắt trong Work settings. HTTP/SSR không xác nhận hydration, thao tác chuột/bàn phím, bố cục responsive hoặc PDF canvas. Checklist cần chạy lại ở `tests/e2e/README.md`; kết quả browser cũ nằm ngoài dự án và không được tính cho lần này.

Chín nhóm write còn `CONTRACT_NOT_RELEASED`. Không nghiệm thu backend, OCR, phương pháp chấm điểm, ACL/tenant isolation hoặc audit bền vững qua QA tổng hợp. Xem G01–G11 trong [backend-integration.md](backend-integration.md).
