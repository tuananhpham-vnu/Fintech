# services/

| Thư mục | Owner | Nội dung |
|---|---|---|
| [ai](ai) | Tuấn Anh: runner, normalize, linking, rules, providers, evaluation · Nguyên: `extraction` | FastAPI nội bộ `/internal/v1/{inspect,extract,evaluate}` theo Contracts 1.0.2 |

Ranh giới trách nhiệm:

- `extraction` (Nguyên) sở hữu **nguồn**: PDF/OCR, field, evidence.
- `rules` (Tuấn Anh) sở hữu **chuẩn hóa, phép tính và đề xuất**.
- Không module nào trong `services/` ghi DB hay quyết định thay người duyệt.
