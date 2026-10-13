# packages/contracts — Fintech Blueprint 1.0.2 (bản chuẩn)

Bản sao **byte-identical** các file contract trong gói bàn giao 1.0.2. Mọi producer và consumer (TypeScript, Python) import từ đây.
**Không sửa tay.** Muốn đổi contract thì tăng version trong bundle mới, cập nhật đồng thời ở cả ba người, rồi chạy lại G0.

| File | Nội dung |
|---|---|
| `schemas.json` | Canonical JSON Schema 2020-12, 52 named schemas (`$defs`) |
| `openapi.json` | 23 external operations (backend ↔ frontend) |
| `internal-openapi.json` | 3 internal operations: `/internal/v1/inspect`, `/extract`, `/evaluate` |
| `field-registry.json` | `field_key` hợp lệ theo từng loại tài liệu |
| `examples.json` | 26 payload mẫu có tên |
| `validation-vectors.json` | S01–S04: vector biên, chấp nhận hoặc từ chối |
| `VERSION` | `1.0.2` |
| `fixtures/` | Gold G01–G03, extraction gold, manifest và 6 PDF text (giả lập, không phải holdout); có `SHA256SUMS` riêng. 2 scan 6MB chỉ nằm trong bundle |
| `SHA256SUMS` | Hash từng file, khớp `artifact-sha256.json` của bundle; AI service kiểm lúc khởi động |

Kiểm tra lại: `cd services/ai && ../../.venv/bin/python scripts/g0_consumer_check.py`.
