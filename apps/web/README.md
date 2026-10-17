# AIC Rating — Frontend

Nhánh làm việc của Đức: **`duc`**. Stage/commit từ repo root theo [hướng dẫn chung](../../README.md#commit-và-push-trên-nhánh-duc), gồm `apps/web`, root package/workspace/lockfile và README liên quan. Không commit `node_modules`, `.next`, `.reports`, `.env.local` hoặc bản nhập cũ.

Ứng dụng chuẩn của monorepo nằm ở `apps/web`; bản nhập `apps/FE Fintech` giữ nguyên. Chạy install/dev/build/lint/typecheck/test từ repo root. [Audit tích hợp](docs/integration-audit.md) và [nguồn mới](docs/specification/current-sync.md) ghi rõ METHOD-SYNC-01, phần đã kiểm và còn chờ API. Các `.txt` cũ là snapshot lịch sử.

FHI bảy metric/bốn nhóm và Transaction Review hiển thị riêng. FE không tính score hoặc bật pilot; fixture QA 73.7/AIC-F2 có nhãn tổng hợp. Không có backend thì sản phẩm báo unavailable.

Next.js 16.4 / React 19 / TypeScript. Nghiệp vụ theo AIC Rating 2.0.0 / CR-AIC-01: chuyên viên SME đánh giá đối tác trước bán chịu hoặc trả trước; cho vay/đầu tư nợ là luồng phụ.

## Cấu trúc

```text
src/       Toàn bộ code ứng dụng: app, features, components, hooks, lib, styles
public/    Icon và tài nguyên công khai
tests/     Kiểm tra, dữ liệu và PDF QA
scripts/   Chuẩn bị tài nguyên, chạy QA và ghi báo cáo
docs/      Kiến trúc, đặc tả và bàn giao backend
```

Chi tiết: [kiến trúc](docs/frontend-architecture.md), [hợp đồng backend](docs/backend-integration.md), [kết quả kiểm tra](docs/verification.md). Bản đọc báo cáo ở `docs/specification/`. Code/báo cáo lịch sử đã chuyển ra thư mục `FE Fintech Backups` cạnh dự án.

## Chạy ứng dụng

Dùng Node.js 22 trở lên và pnpm 11.22.0 theo `package.json` ở gốc repo. Chạy install từ gốc; root lockfile giữ dependency của bản nhập đã cài, không dùng lockfile chỉ chứa pnpm của bản nhập.

```powershell
pnpm install --frozen-lockfile
pnpm dev --hostname 127.0.0.1 --port 3000
```

Mở http://127.0.0.1:3000/login. Khi có backend, sao chép `.env.example` thành `.env.local`, đặt `AIC_BACKEND_URL` tới base `/api/v2`, cấu hình public origin/cookie và khởi động lại Next. Không có backend thì app chính báo dịch vụ chưa sẵn sàng.

## Dùng FE khi chưa có backend

Mặc định UI 3001, QA 4800. Khi cổng bị chiếm, dùng cặp khác; ví dụ từ repo root:

```powershell
pnpm build
pnpm start --hostname 127.0.0.1 --port 3101
# Terminal khác:
$env:AIC_QA_UI_PORT='3101'
$env:AIC_QA_PORT='4900'
pnpm qa:serve
# Terminal kiểm tra, đặt cùng hai biến:
pnpm check:qa
```

Mở http://127.0.0.1:4900/login. Tài khoản test ở dưới; đây là RAM QA, không auth/OCR/scorer/backend thật. Không dùng QA để kết luận production.

Mở hai terminal. Terminal thứ nhất:

```powershell
pnpm build
pnpm start --hostname 127.0.0.1 --port 3001
```

Terminal thứ hai:

```powershell
pnpm qa:serve
```

Vào http://127.0.0.1:4800/login, dùng `qa.specialist` / `TestOnly#2026`. Đây là harness riêng dùng dữ liệu tổng hợp trong RAM. `pnpm qa:seed-pages` tạo dữ liệu phân trang; `pnpm check:qa` kiểm tra HTTP và có sửa dữ liệu QA. Harness không được import vào sản phẩm.

## Kiểm tra

```powershell
pnpm typecheck
pnpm check:aic
pnpm format:check
pnpm build
```

`check:aic` gồm kiểm tra kiến trúc, unit và consumer/proxy. Kết quả JSON ghi tập trung vào `.reports/`; thư mục này được gitignore. `pnpm check:qa` cần UI và harness đang chạy. Checklist bấm UI nằm trong `tests/e2e/README.md`.

PDF.js worker/fonts/CMaps/WASM được chuẩn bị bởi `postinstall`, `predev` và `prebuild`, không tải từ CDN. `public/pdfjs/` và `.next/` là tài nguyên sinh tự động.

## Tình trạng tích hợp

Chưa có backend/OpenAPI/JSON Schema phát hành và method số thực tế. Chín nhóm write vẫn báo `CONTRACT_NOT_RELEASED` và giữ bản nháp; xem G01–G11 trong tài liệu bàn giao. Không coi kiểm thử với QA là nghiệm thu backend.

English mặc định; hỗ trợ Tiếng Việt và 简体中文. Chỉ preference ngôn ngữ lưu localStorage; dữ liệu, session, score, revision và audit chuẩn thuộc backend.
