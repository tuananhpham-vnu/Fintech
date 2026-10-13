# Fintech — AI hỗ trợ rà soát hồ sơ vay SME (FinTechathon 2026)

AI giúp nhân viên tín dụng tìm **thiếu sót và mâu thuẫn có dẫn nguồn** trong hồ sơ vay SME. Nhân viên duyệt yêu cầu bổ sung, sau đó hệ thống kiểm tra lại khi có tài liệu mới.
Hệ thống **không** chấm điểm tín dụng, không dự báo vỡ nợ, không phê duyệt khoản vay.
Mọi quyết định (`resolved`, `dismissed`, duyệt request) là của **người duyệt**; AI chỉ đưa đề xuất.

Thiết kế chuẩn: **Fintech Blueprint 1.0.2** (gói bàn giao trên Notion; bản giải nén để ở `docs/Fintech_Blueprint_1.0.2/`, thư mục này không commit). Không trộn với 1.0.1.

## Kiến trúc và phân công

```
React/TS (apps/web) → NestJS API + worker (apps/api) → PostgreSQL + private PDF volume
                                 │  X-Internal-Key
                                 ▼
          FastAPI nội bộ services/ai: /internal/v1/inspect · /extract · /evaluate
```

| Thư mục | Owner | Nội dung | Trạng thái |
|---|---|---|---|
| [packages/contracts](packages/contracts) | Cả ba | Contracts 1.0.2: 52 schema, OpenAPI, field registry, 26 example, gold | Đã import, có checksum |
| [services/ai](services/ai) | Tuấn Anh (runner, rules, evaluate) · Nguyên (`extraction`) | AI service nội bộ | T13a, T13b xong ở phía owner; `extraction` đang là stub chờ Nguyên |
| `apps/api`, `apps/web` | Đức | Backend, DB, UI rà soát | Chưa có trong repo |

## Chạy AI service

```bash
uv venv --python 3.11 .venv     # hoặc python3.11 -m venv .venv
uv pip install --python .venv/bin/python -e "services/ai[dev]"
cd services/ai
../../.venv/bin/python -m pytest -q                       # test module
../../.venv/bin/python scripts/g0_consumer_check.py       # G0-T contract acceptance
INTERNAL_API_KEY=... ../../.venv/bin/python -m runner serve
```

Deploy lên Render: `render.yaml` ở gốc repo (New → Blueprint), xem [runbook](services/ai/docs/deploy-render.md).

Secret (`GEMINI_API_KEY`, `INTERNAL_API_KEY`) để trong `.env` ở gốc repo. File này đã được gitignore; tuyệt đối không commit, không đưa lên Notion.

## Quy trình

- Nhánh `feat/<task-id>-<slug>`, PR nhỏ, người phụ trách module đối ứng review.
- Contract chỉ đổi khi có version mới, cập nhật đồng thời và chạy lại G0.
- Chỉ đổi trạng thái task khi có code, log và commit làm bằng chứng. Evidence của AI service nằm ở `services/ai/evidence/`.
