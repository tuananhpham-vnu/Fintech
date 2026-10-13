# apps/ — owner Đức (M1/M4/M5)

Theo Blueprint 1.0.2, thư mục này sẽ chứa:

- `apps/api`: NestJS API + worker gồm auth, cases, documents, jobs, reviews, requests, history. Đây là nơi **duy nhất** ghi DB và ra quyết định.
- `apps/web`: React/TypeScript, gồm case list và workspace rà soát (inventory, review, field drawer, request drawer, history).

Hiện chưa có code. Gọi AI service qua `services/ai` (xem [services/ai/README.md](../services/ai/README.md#hợp-đồng-cho-đức-backend-gọi-service)).
Danh sách ca cần người duyệt (HITL) và cách hiển thị: [services/ai/docs/hitl.md](../services/ai/docs/hitl.md).
