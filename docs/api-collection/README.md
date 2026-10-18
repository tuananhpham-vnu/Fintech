# AIC Rating 2.0 — API Toolkit & HTTP Collection Guide

Tài liệu hướng dẫn sử dụng bộ sưu tập API kiểm thử cho hệ thống **AIC Rating 2.0 (FinTechathon 2026)**.

---

## 1. Tổng Quan Bộ Sưu Tập

Bộ sưu tập được định dạng chuẩn RFC 7230 `.http`, tương thích trực tiếp với:
- **VS Code:** Tiện ích *REST Client* (Huachao Mao) hoặc *Thunder Client*.
- **JetBrains IDE:** *HTTP Client* (IntelliJ IDEA, WebStorm, PyCharm).
- **Bruno / Postman / Insomnia:** Hỗ trợ import trực tiếp file `.http` hoặc các request tương ứng.
- **cURL / CLI Scripts:** Dễ dàng chuyển đổi sang lệnh terminal.

Tệp chính: [`aic-rating-v2.http`](file:///c:/Users/52duc/Desktop/Fintech/docs/api-collection/aic-rating-v2.http).

---

## 2. Danh Sách Endpoint Khả Dụng & Đang Hoạt Động

Toàn bộ các endpoint trong bộ sưu tập đều được ánh xạ với mã nguồn đang hoạt động thực tế trên máy:

| Tuyến dịch vụ | Method | Path | Controller / Module | Mục đích |
|---|---|---|---|---|
| **API Gateway** | `POST` | `/api/v2/auth/login` | `AuthController.login` | Đăng nhập cấp Session cookie + CSRF token |
| **API Gateway** | `GET` | `/api/v2/auth/me` | `AuthController.me` | Kiểm tra trạng thái phiên và quyền `specialist` |
| **API Gateway** | `POST` | `/api/v2/auth/logout` | `AuthController.logout` | Hủy session và xóa cookie |
| **API Gateway** | `GET` | `/api/v2/cases` | `CasesController.list` | Danh sách hồ sơ tín dụng (phân trang) |
| **API Gateway** | `GET` | `/api/v2/cases/:id` | `CasesController.getOne` | Chi tiết hồ sơ, tài liệu, tiến trình và kết quả |
| **API Gateway** | `GET` | `/api/v2/cases/:id/readiness` | `CasesController.getReadiness` | Danh sách điều kiện tiên quyết và miễn trừ |
| **API Gateway** | `GET` | `/api/v2/counterparties` | `CounterpartiesController.list` | Danh sách đối tác giao dịch (Bên bán / Bên mua) |
| **API Gateway** | `GET` | `/api/v2/counterparties/:id` | `CounterpartiesController.getOne` | Chi tiết pháp nhân, MST, quốc gia của đối tác |
| **API Gateway** | `POST` | `/api/v2/cases/:id/documents` | `CasesController.uploadDocument` | Tải lên PDF, kích hoạt Inspect & Extract AI |
| **API Gateway** | `GET` | `/api/v2/jobs/:id` | `JobsController.getOne` | Kiểm tra trạng thái tiến trình xử lý bất đồng bộ |
| **API Gateway** | `GET` | `/api/v2/documents/:id/source` | `DocumentsController.getSource` | Tải binary PDF gốc phục vụ trình xem (viewer) |
| **API Gateway** | `GET` | `/api/v2/documents/:id/extraction` | `DocumentsController.getExtraction` | Trích xuất các trường dữ liệu của tài liệu |
| **AI Runner** | `POST` | `/internal/v1/inspect` | `runner/app.py` | Kiểm tra số trang, mã hóa, tính hợp lệ PDF |
| **AI Runner** | `POST` | `/internal/v1/extract` | `runner/app.py` | Trích xuất trường dữ liệu có bảo vệ căn cứ (grounding) |

---

## 3. Quy Trình Xác Thực & Các Header Nghiệp Vụ Quan Trọng

### 3.1. Cookie Phiên (`aic_fe_qa`)
- Sau khi gọi thành công `POST /api/v2/auth/login`, máy chủ trả về header:
  ```http
  Set-Cookie: aic_fe_qa=<session_uuid>; Path=/; HttpOnly; SameSite=Lax
  ```
- Mọi request cần quyền (trừ login và các endpoint nội bộ) đều phải kèm header:
  ```http
  Cookie: aic_fe_qa=<session_uuid>
  ```

### 3.2. CSRF Token (`x-csrf-token`)
- Body phản hồi của `POST /api/v2/auth/login` và `GET /api/v2/auth/me` chứa trường `csrf_token` (dạng UUIDv4).
- Đối với mọi thao tác làm thay đổi dữ liệu (như `POST /api/v2/cases/:id/documents`), bắt buộc gửi kèm header:
  ```http
  x-csrf-token: <csrf_token>
  ```
- Nếu thiếu hoặc sai token, máy chủ sẽ từ chối với lỗi HTTP 403 `CSRF_MISMATCH`.

### 3.3. Kiểm Soát Xung Đột Dữ Liệu (`expected_revision`)
- Hệ thống áp dụng cơ chế **Optimistic Concurrency Control**.
- Khi tải lên tài liệu (`POST /api/v2/cases/:id/documents`), client phải gửi trường form `expected_revision` khớp với giá trị `revision` hiện tại của case (lấy từ `GET /api/v2/cases/:id`).
- Sau mỗi lượt ghi thành công, case revision tăng lên 1 đơn vị. Nếu client gửi sai revision, máy chủ trả về HTTP 409 `REVISION_CONFLICT`.

### 3.4. Chống Lặp Yêu Cầu (`idempotency-key`)
- Header `idempotency-key: <client-generated-uuid>` bắt buộc khi upload tài liệu.
- Nếu gửi lại request với cùng `idempotency-key` và cùng nội dung file hash, máy chủ trả lại kết quả của lần gửi trước mà không tạo thêm tài liệu trùng lặp (Replay Detection).
- Nếu tái sử dụng key nhưng gửi payload khác, máy chủ trả về HTTP 400 `IDEMPOTENCY_MISMATCH`.

---

## 4. Kiểm Thử Nhanh Qua Lệnh cURL

### Bước 1: Đăng nhập
```bash
curl -X POST http://127.0.0.1:3001/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "qa.specialist", "password": "TestOnly#2026"}' \
  -c cookies.txt
```

### Bước 2: Lấy thông tin case và revision
```bash
curl -X GET http://127.0.0.1:3001/api/v2/cases/a06adf0c-7110-51f6-86ad-4b4b903c3e9e \
  -b cookies.txt
```

### Bước 3: Tải tài liệu PDF lên
```bash
curl -X POST http://127.0.0.1:3001/api/v2/cases/a06adf0c-7110-51f6-86ad-4b4b903c3e9e/documents \
  -b cookies.txt \
  -H "x-csrf-token: <CSRF_TOKEN_TỪ_BƯỚC_1>" \
  -H "idempotency-key: $(uuidgen)" \
  -F "expected_revision=1" \
  -F "type=contract" \
  -F "file=@tests/fixtures/synthetic/valid_synthetic.pdf"
```
