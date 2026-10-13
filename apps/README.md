# apps/

Các ứng dụng chạy được (có server hoặc giao diện).

| Thư mục | Trạng thái | Mô tả |
|---|---|---|
| [rules-demo](rules-demo) | Có | Demo đối chiếu R01–R10: FastAPI và giao diện tĩnh, deploy lên Render |
| `api` | Chưa có (fullstack) | Backend chính: auth, case, upload, version, request, audit (phần 16–17 tài liệu) |
| `web` | Chưa có (fullstack) | Frontend React UI01–UI06 |

`rules-demo` chỉ phục vụ trình diễn tính năng đối chiếu, không thay thế `apps/api` và `apps/web`.
Khi app chính sẵn sàng, `apps/api` gọi trực tiếp `sme_rules.run_analysis(...)` giống cách `rules-demo/main.py` đang làm.
