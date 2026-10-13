# apps/rules-demo

Demo tính năng đối chiếu và kiểm chứng (P3). Có hai chế độ:

| Trang | Dành cho | Nội dung |
|---|---|---|
| `/` **Đơn giản** | Người xem demo, chuyên viên, ban giám khảo | Lần đầu vào có hướng dẫn tương tác 1 phút (`/?tour=1` để luôn mở). Bấm ví dụ hoặc điền form (tick giấy tờ, điền số triệu đồng) → kết quả bằng lời thường: số vấn đề, việc nên làm, căn cứ |
| `/advanced` **Chuyên sâu** | Nhóm phát triển | Ô R01–R10, bảng kết quả rule, số hạng tính, nguồn có vùng bbox, JSON, nhập JSON tùy chỉnh |

Có 12 ví dụ: câu chuyện 3 bước Sao Mai và 9 ví dụ nhanh (hồ sơ sạch, thiếu BCTC, BCTC sai năm, BCTC không cân, MST sai, khai đã thu, thu một phần, hóa đơn trùng, hóa đơn vượt hợp đồng).

## Chạy

```bash
# từ thư mục gốc repo
.venv/bin/uvicorn main:app --app-dir apps/rules-demo --reload   # http://localhost:8000
(cd apps/rules-demo && ../../.venv/bin/python -m pytest -q)     # test API
```

Deploy dùng [render.yaml](../../render.yaml) ở thư mục gốc; xem hướng dẫn trong [README gốc](../../README.md#deploy-demo-lên-render).

## API

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/healthz` | Health check cho Render |
| GET | `/api/v1/rules` | Danh sách rule, tên và phiên bản |
| GET | `/api/v1/demo/examples` | Ví dụ kèm giá trị form điền sẵn và `next_id` cho câu chuyện |
| POST | `/api/v1/demo/examples/{id}/run` | Chạy ví dụ, trả `{example, input, output}` |
| POST | `/api/v1/demo/check` | Body là form đơn giản (`SimpleCase`), trả `{input, output}` |
| POST | `/api/v1/analyze` | Body `{snapshot, facts, enabled_rules?}` theo contract, trả `RunOutput` |
| GET | `/api/docs` | Swagger UI |

Lỗi có dạng `{"error": {"code", "message", "request_id", "details"}}`. Với lỗi form, `details.field` cho biết ô nào sai. Body tối đa 1 MB.

## File

| File | Vai trò |
|---|---|
| `main.py` | FastAPI: endpoint, xử lý lỗi, giới hạn body, phục vụ 2 trang |
| `simple_case.py` | Form `SimpleCase` (số tiền tính bằng triệu) → `CaseSnapshot` + `Fact[]`, với trích dẫn viết như câu trên giấy tờ thật |
| `scenarios.py` | 12 ví dụ, mỗi ví dụ là một bộ giá trị form; nhóm `story` nối với nhau qua `next_id` |
| `static/` | Giao diện (HTML, CSS, JS thuần) |
| `test_api.py` | Test endpoint; mỗi ví dụ ra đúng rule mong đợi; hồ sơ sạch không bị báo thừa |
| `requirements.txt` | Phụ thuộc web; `sme_rules` cài từ `services/rules` |

Thêm ví dụ: thêm một `Example(...)` vào `EXAMPLES` trong `scenarios.py`, dùng `_form(...)` để chỉ ghi những giá trị khác mặc định, rồi thêm kỳ vọng vào `EXPECTED_ISSUE` trong `test_api.py`. Nếu ví dụ cần loại giấy tờ mà form chưa có, thêm trường vào `SimpleCase` và `build_case`.
