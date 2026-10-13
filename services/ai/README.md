# services/ai — AI service nội bộ (Contracts 1.0.2)

Một FastAPI app nội bộ chứa 3 route theo `packages/contracts/internal-openapi.json`.
Runner/bootstrap, `evaluate` và guards: **Tuấn Anh** (M3). Package `extraction` (`inspect`, `extract`): **Nguyên** (M2).
Backend (**Đức**) là bên duy nhất ghi DB: service này không có DB, không gọi ngược app, chỉ trả JSON.

## Chạy

Cần Python 3.11 và venv ở thư mục gốc repo.

```bash
cd services/ai
export INTERNAL_API_KEY=<lấy qua kênh nhóm, không commit>
../../.venv/bin/python -m runner health                  # kiểm contracts/key/fixtures; exit 0 = sẵn sàng
../../.venv/bin/python -m runner serve --port 8100        # http://127.0.0.1:8100 (chỉ loopback/private network)
../../.venv/bin/python -m pytest -q                       # test module
../../.venv/bin/python scripts/g0_consumer_check.py       # G0-T: ghi evidence/g0-t-report.json
```

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `INTERNAL_API_KEY` | (bắt buộc) | So khớp header `X-Internal-Key`. Không đặt thì mọi route trả 403 (fail closed) |
| `AI_MODE` | `mock` | `mock`: trả gold có nhãn. `live`: `evaluate` chạy 5 rule deterministic, ca khó mới gọi Gemini qua guard, bị chặn thì chuyển người duyệt ([HITL](docs/hitl.md)); `inspect`/`extract` gọi package của Nguyên. **Không tự chuyển sang mock khi live lỗi** |
| `MODEL_ID`, `PROMPT_VERSION` | `gemini-3.1-flash-lite` (provider) | Model Gemini cho tác vụ ngữ nghĩa và spike; xem [decision log](docs/model-prompt-decision-log.md) |
| `GEMINI_API_KEY` | rỗng | Đặt trong env của server hoặc `.env` ở gốc repo (gitignored, nạp tự động, không ghi đè env); `health` chỉ báo có/không |
| `CONTRACTS_DIR` | `packages/contracts` | Bị kiểm `SHA256SUMS` lúc khởi động; sửa tay thì service từ chối chạy |
| `AI_FIXTURES_DIR` | `packages/contracts/fixtures` | Gold cho mock: 3 JSON + 6 PDF text từ bundle; 2 scan 6MB chỉ có trong bundle |

Deploy Render: [`render.yaml`](../../render.yaml) + [runbook](docs/deploy-render.md).

## Hợp đồng cho Đức (backend gọi service)

- **Base URL:** `http://<ai-host>:8100/internal/v1`, header `X-Internal-Key`, `Content-Type: application/json`.
- **Route:** `POST /inspect` (`InspectionInput` → `InspectionOutput`), `POST /extract` (`ExtractionInput` → `ExtractionOutput`), `POST /evaluate` (`EvaluationInput` → `EvaluationOutput`). Body trả về đúng schema, không bọc thêm.
- **Lỗi:** luôn theo envelope `Error`, `request_id` là UUID.

  | HTTP | code | Khi nào |
  |---|---|---|
  | 403 | `FORBIDDEN` | Thiếu hoặc sai key, hoặc server chưa cấu hình key |
  | 422 | `INVALID_REQUEST` | Body không phải JSON hoặc sai schema 1.0.2; `details[].path` là JSON pointer. *Mã đề xuất, cần nhóm xác nhận* |
  | 422 | `INVALID_MODEL_OUTPUT` | Output sai schema hoặc trượt guard; worker ghi failed, **không** coi là pass |
  | 503 | `PROVIDER_UNAVAILABLE` | Live chưa có provider/package, hoặc mock không có gold cho input |
  | 500 | `INTERNAL_ERROR` | Lỗi không lường trước; không có stack trace |

- **Header `X-AI-Mode: mock|live`** có trên mọi response 200. Ở mock, `provenance.model_id = MOCK-GOLD-NOT-MODEL-OUTPUT`, và UI phải gắn nhãn MOCK.
- **Mock `evaluate`** chỉ trả lời G01–G03 (khớp `run_id` + `snapshot_hash`), **không bịa** cho input khác (trả 503).

## Quy ước import cho Nguyên (package `extraction`)

```python
import extraction
extraction.inspect(payload: dict) -> dict   # InspectionInput -> InspectionOutput
extraction.extract(payload: dict) -> dict   # ExtractionInput -> ExtractionOutput
extraction.IMPLEMENTED = True               # để `runner health` ở live báo ok
```

- Runner **import** package, không copy code. Thay toàn bộ [extraction/__init__.py](extraction/__init__.py), giữ nguyên tên hai hàm.
- Input đã được runner validate. Output sẽ đi qua schema và guard: echo `document_id`/`case_id`/`sha256`, page liên tục 1..N, evidence đúng tài liệu và đúng trang, field chỉ tham chiếu evidence của chính tài liệu.
- Lỗi nghiệp vụ: `raise runner.errors.ServiceError(422, "PDF_ENCRYPTED", "...")`. Chưa làm xong thì cứ để `NotImplementedError`, runner sẽ trả 503.

## Guards (`runner/guards.py`) chạy sau khi output đã đúng schema

| Guard | Lý do |
|---|---|
| Echo `schema_version`/`run_id`/`case_id`/`case_revision`/`snapshot_hash` | Chống trả kết quả của run khác |
| Đúng 5 rule R01, R02, R08, R09, R10, mỗi rule một lần | Contracts §9.2 |
| `issue_id = UUIDv5(254068b3-…, case_id + ":" + issue_key)`, mỗi `issue_key` một assessment | Định danh issue ổn định giữa các run |
| Mọi `existing_issue` có assessment | Không bỏ sót issue cũ |
| Evidence và `absence_basis` phải thuộc snapshot | Chống nguồn bịa hoặc lấy từ case khác |
| Không có khóa `human_status` ở bất kỳ đâu | AI không quyết định thay người duyệt |

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `runner/app.py` | `create_app()`: pipeline key → JSON → schema vào → backend → schema ra → guard |
| `runner/contracts.py` | Strict validator JSON Schema 2020-12 + FormatChecker, kiểm `SHA256SUMS` |
| `runner/dto.py` | Pydantic DTO **sinh tự động** (`scripts/gen_dto.sh`); chỉ dùng cho kiểu dữ liệu |
| `runner/backends.py` | `MockBackend` (gold) và `LiveBackend` (evaluator `rules` + package extraction) |
| `normalize/`, `linking/` | Chuẩn hóa MST/ref/tiền/ngày; view snapshot đã áp correction |
| `rules/` | R01, R02, R08 + R10 (`acceptance.py`), R09; `rules.evaluate(EvaluationInput) -> EvaluationOutput` |
| `providers/` | Adapter Gemini (retry/timeout) + tác vụ ngữ nghĩa điều khoản thanh toán có guard |
| `evaluation/` | Protocol so sánh cố định (`compare.py`) + kỳ vọng A01–A14 |
| `docs/` | [Decision tables](docs/T13b-decision-tables.md), [protocol](docs/evaluation-protocol.md), [decision log model/prompt](docs/model-prompt-decision-log.md), [error taxonomy](docs/error-taxonomy.md), [HITL](docs/hitl.md) |
| `runner/guards.py` | Semantic guards |
| `runner/__main__.py` | `python -m runner health / serve` |
| `extraction/` | Stub interface; **Nguyên sở hữu** |
| `scripts/g0_consumer_check.py` | Lệnh G0-T, ghi `evidence/g0-t-report.json` |
| `scripts/task_evidence.py <task>` | Chạy test, ghi `evidence/<task>-report.json` (commit, hash fixture, kết quả từng test, mã T/A) |
| `scripts/export_evaluator_outputs.py` | Output thật cho gold + biến thể → `evidence/evaluator-outputs/` (mock UI cho Đức) |
| `scripts/provider_spike.py` | Spike Gemini T13b (cần `GEMINI_API_KEY`), ghi `evidence/spike-*.json` |
| `scripts/hybrid_smoke.py` | Smoke rule + Gemini + HITL trên 4 ca khó, ghi `evidence/hybrid-smoke-*.json` |

## Còn mở

- Bốn quyết định D-01..D-04 trong [decision tables](docs/T13b-decision-tables.md#quyết-định-cần-reviewer-nguyên-xác-nhận) cần Nguyên xác nhận (`assessment.id`, thứ tự verdict, mã `INVALID_REQUEST`, tập evidence R08).
- Spike Gemini đã chạy (xem [decision log](docs/model-prompt-decision-log.md#kết-quả-spike-ngày-13102026-dev-7-variant-giả-lập--3-lượt-temperature-0)): model làm theo prompt injection 3/3, guard chặn 3/3. **Không dùng output Gemini khi chưa qua guard.**
- G0 chỉ đạt khi Nguyên và Đức xác nhận payload và có commit SHA trên cây sạch. Hiện là `PASS_OWNER_SIDE`, G0 vẫn **PENDING**.
