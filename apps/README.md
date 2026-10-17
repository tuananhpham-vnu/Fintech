# apps/ — owner Đức (M1/M4/M5)

Nhánh làm việc: **`duc`**. Commit frontend và cấu hình workspace từ gốc repo theo [quy trình commit/push](../README.md#commit-và-push-trên-nhánh-duc); bàn giao bằng PR `duc` → `main`.

## Hiện trạng sau Backend Phase 1 ngày 17/10/2026

- `web/`: frontend Next.js 16.4 / React 19 / TypeScript theo AIC Rating 2.0.0 và METHOD-SYNC-01; route mỏng, 10 feature, sáu tab workspace. Thuộc workspace cùng `api/`.
- `FE Fintech/`: bản nhập gốc giữ trên máy để đối chiếu, không chạy song song trong workspace và không đưa dependency/cache vào Git.
- `api/`: NestJS foundation `/api/v2`, PostgreSQL/session/ACL/scoped reads đã có; worker, workflow và scoring chưa triển khai. Xem [README](api/README.md) và [báo cáo Phase 1](../docs/implementation/BACKEND-PHASE-1-REPORT.md).

Chạy từ gốc bằng `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Chi tiết: [hướng dẫn web](web/README.md), [báo cáo đối chiếu và kiểm thử](web/docs/integration-audit.md).

## Ghi chú Blueprint 1.0.2 cũ (giữ để truy vết)

Theo Blueprint 1.0.2, thư mục này sẽ chứa:

- `apps/api`: NestJS API + worker gồm auth, cases, documents, jobs, reviews, requests, history. Đây là nơi **duy nhất** ghi DB và ra quyết định.
- `apps/web`: React/TypeScript, gồm case list và workspace rà soát (inventory, review, field drawer, request drawer, history).

Đây là mô tả lịch sử; hiện trạng triển khai ở mục phía trên. AI service hiện có tại `services/ai` (xem [services/ai/README.md](../services/ai/README.md#hợp-đồng-cho-đức-backend-gọi-service)).
Danh sách ca cần người duyệt (HITL) và cách hiển thị: [services/ai/docs/hitl.md](../services/ai/docs/hitl.md).
