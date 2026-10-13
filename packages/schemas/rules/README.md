# packages/schemas/rules

Contract của module đối chiếu ([services/rules](../../../services/rules)). Thư mục này được sinh tự động, **không sửa tay**:

```bash
cd services/rules && ../../.venv/bin/python scripts/export_contracts.py
```

| File | Ai dùng | Mô tả |
|---|---|---|
| `case_snapshot.schema.json` | Backend, đọc tài liệu | Snapshot bất biến của một run: tài liệu, evidence, liên kết reviewer đã xác nhận, request đã duyệt |
| `fact.schema.json` | Đọc tài liệu | Một fact: `field = "<doc_type>.<tên>"`, giá trị, chất lượng đọc, `evidence_ids` |
| `run_output.schema.json` | Backend, frontend | Kết quả: `rule_results`, `findings`, `suggested_requests`, `resolutions`, `input_issues`, `coverage` |
| [examples/](examples) | Mọi người | Đầu vào và đầu ra của 3 bước case Sao Mai Demo |

Một số điểm cần nhớ:

- Tiền là chuỗi thập phân (`"500000000"`), không dùng số thực. Hệ số đơn vị đặt ở `multiplier`.
- Ngày theo dạng ISO `YYYY-MM-DD`.
- `finding` chỉ có khi `status = "issue"`. Mỗi finding có `evidence_ids` hoặc `absence_basis`.
- `resolution.proposal` chỉ là đề xuất. Trạng thái do reviewer quyết định được lưu ở app, không nằm trong contract này.
