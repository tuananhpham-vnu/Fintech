# services/

Module nghiệp vụ dạng thư viện Python, được backend hoặc worker import. Thư mục này không chứa server.

| Thư mục | Chủ sở hữu | Trạng thái | Interface |
|---|---|---|---|
| [rules](rules) | Tuấn Anh | Có | `run_analysis(snapshot, facts, config) → RunOutput` |
| `extraction` | Nguyên | Chưa có | `extract(document_version) → facts + evidence + diagnostics` (phần 22) |

Ranh giới trách nhiệm:

- `extraction` sở hữu **nguồn**: đọc, phân loại và trích dẫn. Module này không tính tiền.
- `rules` sở hữu **số chuẩn hóa và phép tính**. Không nhận liên kết do LLM đề xuất làm sự thật khi còn mơ hồ.
