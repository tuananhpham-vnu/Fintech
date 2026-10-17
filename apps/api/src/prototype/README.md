# AIC Rating 2.0 — Backend Service (`apps/api`)

NestJS backend service cho hệ thống **AIC Rating 2.0 (FinTechathon 2026)**.
Mã nguồn này được thiết kế theo cấu trúc modular, phục vụ việc kiểm chứng khả thi tích hợp E2E (**Next.js Frontend ↔ NestJS Backend ↔ FastAPI AI Service**) và làm nền tảng kế thừa trực tiếp cho **GPT-6.1 Sol** tiếp tục hoàn thiện thành backend chính thức.

---

## 1. Cấu Trúc Thư Mục & Phân Tách Trách Nhiệm

```
apps/api/
├── .env.example                    # Cấu hình mẫu môi trường
├── package.json                    # Khai báo dependency (@nestjs/*, cookie-parser, multer)
├── tsconfig.json                   # TypeScript config (CommonJS target, decorators enabled)
├── README.md                       # Tài liệu hướng dẫn & kế thừa
└── src/
    ├── main.ts                     # Bootstrap NestJS, CORS, cookie-parser, prefix api/v2
    ├── app.module.ts               # Root module đăng ký controllers và providers
    ├── config/
    │   └── configuration.ts        # [TÁI SỬ DỤNG] Quản lý biến môi trường tập trung
    ├── ai-client/
    │   └── ai-client.service.ts    # [TÁI SỬ DỤNG] Adapter gọi FastAPI (/inspect, /extract)
    ├── storage/
    │   └── storage.service.ts      # [TÁI SỬ DỤNG/NÂNG CẤP] Quản lý lưu trữ staging & SHA-256
    ├── state/
    │   └── in-memory-db.service.ts # [THAY THẾ] Lưu trữ tạm trong RAM cho prototype E2E
    └── controllers/                # [TÁI SỬ DỤNG/HOÀN THIỆN] HTTP Transport & Validation
        ├── auth.controller.ts           # Login, logout, session me, CSRF token
        ├── counterparties.controller.ts # Danh sách và chi tiết đối tác
        ├── cases.controller.ts          # Chi tiết hồ sơ, upload tài liệu PDF
        ├── documents.controller.ts      # Stream PDF nhị phân, danh sách trường trích xuất
        ├── jobs.controller.ts           # Truy vấn trạng thái tác vụ bất đồng bộ
        └── evidence.controller.ts       # Truy xuất chi tiết bằng chứng và bbox
```

---

## 2. Phân Định Code Tái Sử Dụng vs. Code Cần Thay Thế

| Module / File | Vai trò hiện tại | Định hướng cho GPT-6.1 Sol (Production) |
|---|---|---|
| `src/config/configuration.ts` | Đọc `process.env` với giá trị dự phòng chuẩn | **Giữ lại & mở rộng**: Bổ sung cấu hình PostgreSQL, Redis, JWT secret, AWS S3. |
| `src/ai-client/ai-client.service.ts` | HTTP Client gọi FastAPI, xử lý 502/503, timeout | **Giữ lại & hoàn thiện**: Thêm retry exponential backoff, circuit breaker, telemetry OpenTelemetry. |
| `src/storage/storage.service.ts` | Lưu file local `storage/staging/`, tính SHA-256 | **Nâng cấp thành Interface / Strategy**: Thay bằng S3 / MinIO adapter cho môi trường cloud. |
| `src/controllers/*.ts` | Tiếp nhận HTTP, validate magic bytes `%PDF-`, revision | **Giữ lại routing & DTO**: Chuyển logic gọi `InMemoryDbService` sang Inject các Domain Service / Use Cases. |
| `src/state/in-memory-db.service.ts` | Lưu tạm session, case, document, job, evidence trong RAM | **Thay thế hoàn toàn**: Thay bằng PostgreSQL ORM (Prisma hoặc TypeORM) theo schema DDL Trang 08. |

---

## 3. Biến Môi Trường (`.env`)

Tạo file `apps/api/.env` (tham khảo `.env.example`):

```bash
PORT=3001
AIC_FRONTEND_ORIGIN=http://127.0.0.1:3000
AIC_STORAGE_DIR=../../storage
AIC_AI_SERVICE_URL=http://127.0.0.1:8100
INTERNAL_API_KEY=test_internal_key
AIC_COOKIE_NAME=aic_fe_qa
```

---

## 4. Hướng Dẫn Chạy & Kiểm Thử

### 4.1. Cài đặt & Build
Tại thư mục gốc dự án:
```bash
# Cài đặt dependencies toàn monorepo
pnpm install

# Build riêng backend NestJS
pnpm --filter @fintech/api build

# Kiểm tra TypeScript typecheck
pnpm typecheck
```

### 4.2. Khởi chạy Backend
```bash
# Chạy ở chế độ phát triển
pnpm --filter @fintech/api start

# Hoặc chạy file dist sau khi build
node apps/api/dist/main.js
```
Backend sẽ lắng nghe tại: `http://127.0.0.1:3001/api/v2`.

### 4.3. Chạy Toàn Bộ 3 Dịch Vụ Cùng Lúc (E2E)
Mở 3 cửa sổ terminal (PowerShell) riêng biệt:

1. **AI Service (FastAPI — Port 8100):**
   ```powershell
   cd services/ai
   $env:INTERNAL_API_KEY="test_internal_key"
   ..\..\.venv\Scripts\python.exe -m runner serve --port 8100
   # Lắng nghe tại: http://127.0.0.1:8100
   ```
2. **Backend NestJS (Port 3001):**
   ```powershell
   pnpm --filter @fintech/api start:dist
   # hoặc: node apps/api/dist/main.js
   # Lắng nghe tại: http://127.0.0.1:3001/api/v2
   ```
3. **Frontend Next.js (Port 3000):**
   ```powershell
   pnpm --filter @fintech/web dev
   # Lắng nghe tại: http://localhost:3000
   ```

### 4.4. Kiểm Thử Khả Thi Tích Hợp (Automated Integration Test)
Chạy kịch bản 20 test case kiểm thử toàn diện (bao gồm các ca kiểm thử bảo mật, idempotency, dung lượng, và negative tests):
```powershell
node scripts/test-e2e-feasibility.cjs
```

Kết quả mong đợi: **20/20 PASSED (100%)**.

---

## 5. Lưu Ý Kỹ Thuật Khi Kế Thừa (Dành cho GPT-6.1 Sol)

1. **Mapping Contract `evidence_refs` vs `evidence_ids`:**
   - FastAPI contract (`1.0.2`) trả về mảng `evidence_ids: string[]`.
   - Frontend Next.js decoder (`apps/web/src/lib/api/decoders.ts#L48`) yêu cầu trường `evidence_refs: string[]`.
   - `CasesController` và `DocumentsController` hiện đang ánh xạ: `evidence_refs: f.evidence_ids || f.evidence_refs || []`. Cần giữ quy tắc này hoặc thống nhất schema v2.
2. **Xác thực CSRF và Origin từ Next.js Proxy:**
   - Frontend Next.js gọi NestJS thông qua proxy route `apps/web/src/app/api/v2/[...path]/route.ts`.
   - Mọi request ghi (POST/PUT/PATCH) từ UI đều mang header `x-csrf-token`, `idempotency-key` và `Origin === AIC_FRONTEND_ORIGIN`.
   - Proxy chấp nhận cả `http://localhost:3000` lẫn `http://127.0.0.1:3000`.
   - Cookie xác thực `aic_fe_qa` là `HttpOnly; SameSite=Lax`.
3. **Chế độ Mock vs Live của FastAPI:**
   - Khi `AI_MODE=mock`, FastAPI chỉ chấp nhận 8 cặp `(document_id, sha256)` tương ứng với các file trong `packages/contracts/fixtures/`.
   - Khi `AI_MODE=live`, FastAPI gọi Gemini API. Nếu thiếu `GEMINI_API_KEY`, FastAPI trả HTTP 503 `PROVIDER_UNAVAILABLE`. Backend đã bọc lỗi này thành lỗi 503 có cấu trúc chuẩn để UI hiển thị thông báo lỗi thân thiện.
4. **Idempotency Replay & Revision Concurrency:**
   - Backend hỗ trợ replay idempotent: nếu cùng `idempotency-key` và cùng file hash gửi lại, backend trả về kết quả 202 đã lưu mà không tăng revision hoặc ghi đè tài liệu.
   - Nếu cùng key nhưng gửi khác payload hoặc case, backend trả về HTTP 400 `IDEMPOTENCY_MISMATCH`.
5. **Path Traversal & Security Confinement:**
   - `StorageService` và `DocumentsController` áp dụng bộ lọc regex `^[a-zA-Z0-9_-]+$` và kiểm tra `path.resolve` đảm bảo mọi đường dẫn lưu và đọc file nằm hoàn toàn trong thư mục `storage/staging/`.
