# packages/schemas

Nguồn sự thật cho dữ liệu trao đổi giữa các module. Frontend và backend dùng các file này để dựng mock và validate.

| Thư mục | Chủ sở hữu | Nội dung |
|---|---|---|
| [rules](rules) | Đối chiếu (Tuấn Anh) | `CaseSnapshot`, `Fact` (đầu vào) và `RunOutput` (đầu ra) |
| `extraction` (chưa có) | Đọc tài liệu (Nguyên) | Schema trích xuất theo từng loại giấy tờ (phụ lục 33) |
| `api` (chưa có) | Fullstack | OpenAPI của app chính |

Schema trong `rules/` được **sinh tự động** từ model Pydantic, không sửa tay. Muốn đổi thì sửa code `services/rules/sme_rules/contracts/` rồi chạy lại script export.
