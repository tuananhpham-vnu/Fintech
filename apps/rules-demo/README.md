# apps/rules-demo

Demo tính năng đối chiếu và kiểm chứng (P3). Chọn một kịch bản giả lập, hệ thống chạy R01–R10 và hiển thị:

- Các phát hiện, sắp theo mức ưu tiên, kèm yêu cầu bổ sung đề xuất.
- Đề xuất của R10 cho tài liệu bổ sung (`candidate_resolved` / `still_open`).
- Nguồn của từng phát hiện: tài liệu, trang, vùng chữ và trích dẫn nguyên văn.
- Bảng kết quả theo rule, hồ sơ đầu vào và JSON thô.

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
| GET | `/api/v1/demo/scenarios` | Danh sách kịch bản |
| POST | `/api/v1/demo/scenarios/{id}/run` | Chạy kịch bản, trả `{scenario, input, output}` |
| POST | `/api/v1/analyze` | Chạy với `{snapshot, facts, enabled_rules?}` tùy chỉnh, trả `RunOutput` |
| GET | `/api/docs` | Swagger UI |

Lỗi trả theo một hình dạng thống nhất: `{"error": {"code", "message", "request_id"}}`. Body tối đa 1 MB.

## File

| File | Vai trò |
|---|---|
| `main.py` | FastAPI: endpoint, xử lý lỗi, giới hạn body, phục vụ UI |
| `scenarios.py` | 10 kịch bản dựng từ `sme_rules.fixtures`, mỗi kịch bản minh họa một rule |
| `static/` | Giao diện: HTML, CSS và JS thuần, không cần build |
| `test_api.py` | Test endpoint và test mỗi kịch bản cho đúng rule mong đợi |
| `requirements.txt` | Phụ thuộc web; `sme_rules` được cài từ `services/rules` |

Thêm kịch bản mới: viết một hàm trả `(snapshot, facts)` bằng `SnapshotBuilder`, thêm `Scenario(...)` vào `SCENARIOS`, rồi thêm kỳ vọng vào `test_scenarios_show_intended_rule`.
