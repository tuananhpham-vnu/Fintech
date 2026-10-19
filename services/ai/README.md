# services/ai — AI service nội bộ (Contracts 1.0.2)

Một FastAPI app nội bộ chứa 3 route theo `packages/contracts/internal-openapi.json`.
Runner/bootstrap, `evaluate` và guards: **Tuấn Anh** (M3). Package `extraction` (`inspect`, `extract`): **Nguyên** (M2).
Backend (**Đức**) là bên duy nhất ghi DB: service này không có DB, không gọi ngược app, chỉ trả JSON.

Runtime hỗ trợ Gemini, DeepSeek và Agent Router qua cùng giao diện adapter; Gemini vẫn là mặc định khi không cấu hình.
Xem [cấu hình chọn provider, OCR và kiểm tra](docs/providers.md). `pnpm dev:all` vẫn
khởi chạy cả stack với key của provider được chọn.

OCR local cho BCTC trên Windows: chạy `pnpm ai:ocr:setup` một lần ở gốc repo,
rồi đặt `OCR_ENGINE=docling` trong `.env`. `pnpm dev:all` kiểm tra runtime/model trước
khi bật dịch vụ. Docling + EasyOCR `vi,en` đọc chữ và bảng tại máy; Gemini được giữ
cho nhận diện kỳ và đề xuất số liệu. Xem [hướng dẫn OCR local](docs/local-ocr.md).

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
| `AI_MODE` | `mock` | `mock`: trả gold có nhãn. `live`: `evaluate` chạy 5 rule deterministic, ca khó mới gọi provider đã chọn qua guard; kết quả model chỉ là gợi ý (`LLM_SUGGESTION`), luôn chuyển người duyệt xác nhận bằng `correct_field` ([HITL](docs/hitl.md)); `inspect`/`extract` gọi package của Nguyên. **Không tự chuyển sang mock khi live lỗi** |
| `AI_PROVIDER` | `gemini` | Chọn `gemini`, `deepseek`, `agentrouter` hoặc `motapis` cho semantic, extraction và nhận diện BCTC; OCR phụ thuộc khả năng nhận ảnh của endpoint |
| `GEMINI_MODEL_ID`, `MODEL_ID` | `gemini-3.1-flash-lite` | Model Gemini; `GEMINI_MODEL_ID` ưu tiên hơn `MODEL_ID` cũ |
| `DEEPSEEK_MODEL_ID`, `DEEPSEEK_BASE_URL` | `deepseek-flash`, `https://api.deepseek.com` | Model/endpoint DeepSeek; độc lập với model Gemini cũ |
| `PROMPT_VERSION` | rỗng | Phiên bản prompt cho health/spike; xem [decision log](docs/model-prompt-decision-log.md) |
| `GEMINI_API_KEY` | rỗng | Đặt trong env của server hoặc `.env` ở gốc repo (gitignored, nạp tự động, không ghi đè env); `health` chỉ báo có/không |
| `DEEPSEEK_API_KEY` | rỗng | Bắt buộc khi chọn DeepSeek; không cần key Gemini khi chạy DeepSeek |
| `AI_FINANCIAL_CALCULATIONS` | `0` | `1`: đề xuất công thức cho chỉ tiêu còn thiếu; backend tính chính xác, người dùng rà soát và áp dụng trước xác nhận chung |
| `AI_FINANCIAL_REASONING` | `0` | `1`: kho quan sát ngoài 14 key, tìm trang nguồn và suy luận nhiều bước; backend giải chính xác, giữ điều kiện rà soát. Khi bật, thay lượt đề xuất đơn bước cho receipt mới; receipt cũ vẫn đọc được |
| `AI_REASONING_CACHE` | `0` | `1`: cache OCR/quan sát riêng trong `AI_STORAGE_DIR/reasoning-cache`, gắn hash nguồn/model/prompt, TTL 30 phút, tối đa 256 file × 1 MB; không thay kho chứng cứ DB |
| `AGENTROUTER_API_KEY` | rỗng | Key riêng của gateway Agent Router; không dùng key DeepSeek/Gemini thay thế |
| `AGENTROUTER_MODEL_ID`, `AGENTROUTER_BASE_URL` | `deepseek-v4-flash`, `https://agentrouter.org/v1` | Model core và OpenAI Chat Completions endpoint của Agent Router |
| `AGENTROUTER_VISION_ENABLED` | `0` | Chỉ bật `1` sau khi kiểm chứng gateway/model nhận ảnh; mặc định không suy diễn khả năng OCR từ tên model |
| `MOTAPIS_API_KEY` | rỗng | Key riêng phía server cho Mot APIs; không chuyển tiếp key DeepSeek/Gemini/Agent Router |
| `MOTAPIS_MODEL_ID`, `MOTAPIS_BASE_URL` | `gpt-6-luna`, `https://motapis.com/v1` | Gateway Chat Completions; tên model phải thuộc danh sách tài khoản trả về từ `/v1/models` |
| `MOTAPIS_VISION_ENABLED` | `0` | Bật `1` sau khi kiểm chứng ảnh thực tế. Model cùng tên trên gateway khác chưa chứng minh khả năng OCR |
| `AI_SPEND_LEDGER_DIR` | `AI_STORAGE_DIR` | Thư mục riêng tùy chọn cho sổ ngân sách khi đổi provider. Không xóa hoặc đặt lại sổ cũ; trần mới phải nằm trong ngân sách còn lại đã duyệt |
| `CONTRACTS_DIR` | `packages/contracts` | Bị kiểm `SHA256SUMS` lúc khởi động; sửa tay thì service từ chối chạy |
| `AI_MAX_REQUEST_BYTES` | `10000000` | Body lớn hơn bị từ chối 413 `PAYLOAD_TOO_LARGE` trước khi parse (đọc theo stream, không tin Content-Length) |
| `ENABLE_TEST_CONSOLE` | tắt | `1`: bật trang test thủ công `GET /console` (xem bên dưới). Render đang bật |
| `AI_FIXTURES_DIR` | `packages/contracts/fixtures` | Gold cho mock: 3 JSON + 6 PDF text từ bundle; 2 scan 6MB chỉ có trong bundle |
| `AI_STORAGE_DIR` | rỗng | Live `inspect`/`extract`: thư mục gốc chứa file theo `storage_key` (chỉ đọc). Không đặt thì 503 |
| `OCR_ENGINE` | `provider` | `docling`: chữ/bảng local với EasyOCR Việt/Anh; `provider`: gửi ảnh cho provider; `gemini` là alias cũ; `tesseract`: binary local; `none`: từ chối scan |
| `AI_MAX_PDF_BYTES`, `AI_MAX_PAGES`, `AI_EXTRACT_DEADLINE_S` | `25000000`, `10`, `240` | Giới hạn file, số trang cho extract, budget tổng một lần extract (OCR + model + repair) |
| `AI_MAX_MODEL_CALLS`, `AI_MAX_MODEL_QUEUE` | `4`, `16` | Số lời gọi model/OCR chạy cùng lúc trong process / được chờ; hàng chờ đầy hoặc chờ quá budget -> 503 |

Deploy Render: [`render.yaml`](../../render.yaml) + [runbook](docs/deploy-render.md).

## Test console (`/console`)

Trang test thủ công, chỉ có khi `ENABLE_TEST_CONSOLE=1`: `http://127.0.0.1:8100/console` hoặc `https://fintech-ai-internal.onrender.com/console`.

- Dán `INTERNAL_API_KEY` vào ô key. Key chỉ lưu trong sessionStorage của tab; API vẫn fail-closed như cũ.
- Có 12 ca mẫu giả lập: G01–G03 (so với gold bằng bản JS của `evaluation/compare.py`), các biến thể partial/unknown, H1–H4 cho Gemini/HITL, và example inspect/extract.
- Sửa được điều khoản thanh toán hoặc toàn bộ JSON; `snapshot_hash` được tính lại khi gửi.
- Kết quả hiển thị theo rule, assessment, evidence (trích dẫn + trang), đề xuất bổ sung, diagnostics và lỗi kèm `details[].path`.
- Ca mẫu nằm ở `runner/console/presets.json`, sinh bởi `scripts/build_console_presets.py`. Đổi gold hoặc contract thì chạy lại script này.

Trang chỉ gồm file tĩnh và dữ liệu giả lập. **Không dán hồ sơ thật**: service đang public, và ca khó được gửi sang provider đã chọn.

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

## Extraction (M2, Nguyên)

- `inspect`: PyMuPDF đọc cấu trúc (số trang thật kể cả >10, mã hóa, file đính kèm), kiểm SHA-256 và `storage_key`. Không OCR, không LLM.
- `extract`: text nhúng theo trang (trang ảnh -> OCR) -> provider đề xuất field theo `field-registry.json` -> code kiểm căn cứ:
  quote phải nguyên văn trên đúng trang, giá trị (MST, tiền, ngày, enum, tiền tệ, mã) phải có trong quote. Không qua
  thì field `null` + `uncertain`/`ambiguous` + diagnostic; điều khoản thanh toán qua guard của `providers/semantic.py`.
  Output model sai schema: hỏi lại tối đa 1 lần, vẫn sai -> 422 `INVALID_MODEL_OUTPUT`. Dòng nghi prompt injection bị
  ẩn khỏi prompt và không được làm evidence (`SUSPECTED_PROMPT_INJECTION`).
- ID field/evidence: UUIDv5(namespace manifest, `document_id:f:field_key` / `document_id:e:page:start:end`); bbox chỉ có ở trang text.
- Mã lỗi thêm (*đề xuất, cần Đức xác nhận*): 404 `PDF_NOT_FOUND`, 422 `SHA256_MISMATCH`, 422 `PDF_INVALID`,
  422 `PDF_ENCRYPTED` (cần mật khẩu), 413 `PDF_TOO_LARGE`, 413 `PDF_TOO_MANY_PAGES`, 422 `PDF_NO_TEXT`, 422 `INVALID_REQUEST` (`storage_key` không an toàn).
- Giới hạn tài nguyên (`extraction/pdf.py` `Limits`), kiểm trước khi MuPDF cấp phát: số trang trước khi đọc text; content stream
  FlateDecode giải nén thử có giới hạn (8MB/trang); text 40k ký tự/trang, 150k/tài liệu; pixel ảnh khai báo 40M/trang trước khi
  render; ảnh OCR tối đa 8M pixel, cạnh 5000px, PNG 10MB, dưới 100dpi thì từ chối. Vượt -> 413 `PDF_TOO_LARGE`/`PDF_TOO_MANY_PAGES`.
- Thời gian: mỗi lời gọi Gemini nhận phần budget còn lại (timeout HTTP, retry, backoff), `maxOutputTokens` 8192; kết quả về sau
  hạn bị bỏ (503). Trang có chữ nhúng ở đầu nhưng thân là ảnh scan được OCR cả trang (`PARTIAL_TEXT_LAYER`, field uncertain).
- **Chưa chặn được trong process** (cần giới hạn ở mức tiến trình/container, vd. memory limit của Render, hoặc worker riêng):
  thời gian CPU và bộ nhớ bên trong một lệnh MuPDF native (thread Python không hủy được); font/stream nén bằng filter khác
  Flate; HTTP đang chạy dở chỉ bị bỏ kết quả chứ không bị hủy ngay; httpx timeout tính theo từng pha, không phải tổng.
- Smoke thật (cần key): `../../.venv/Scripts/python.exe scripts/extraction_smoke.py` -> `evidence/extraction-smoke-*.json`.

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

## Kiểm toàn vẹn input `evaluate` (`runner/input_guards.py`)

Chạy sau JSON Schema, trước rule. Vi phạm -> 422 `INVALID_REQUEST` kèm `details[].path`; rule không chạy trên snapshot không nhất quán (contracts §147, T18):

- snapshot/document/extraction/request/issue/correction cùng `case_id`; `snapshot.case.revision` = `case_revision`;
- extraction đúng tài liệu (`document_id`, `sha256` của file); ID tài liệu/field/evidence không trùng;
- evidence thuộc đúng tài liệu, trang tồn tại, quote nguyên văn trên trang; field chỉ dẫn evidence của chính tài liệu;
- field `readable` có giá trị nằm trong quote của nó (cùng bộ so khớp `extraction/grounding.py`);
- tài liệu bổ sung chỉ trả lời request có trong snapshot; correction trỏ field có trong snapshot;
- tài liệu có `detected_type` khác `type` không bao giờ làm căn cứ (`linking`), kể cả khi đã confirm.

Không tính lại `snapshot_hash`/`extraction_hash` (backend là bên duy nhất tạo hash, contracts §316).

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
| `extraction/` | M2 (**Nguyên**): `storage` (key/hash), `pdf` (PyMuPDF), `ocr`, `grounding` (kiểm căn cứ), `extractor` |
| `scripts/g0_consumer_check.py` | Lệnh G0-T, ghi `evidence/g0-t-report.json` |
| `scripts/task_evidence.py <task>` | Chạy test, ghi `evidence/<task>-report.json` (commit, hash fixture, kết quả từng test, mã T/A) |
| `scripts/export_evaluator_outputs.py` | Output thật cho gold + biến thể → `evidence/evaluator-outputs/` (mock UI cho Đức) |
| `scripts/provider_spike.py` | Spike Gemini T13b (cần `GEMINI_API_KEY`), ghi `evidence/spike-*.json` |
| `scripts/hybrid_smoke.py` | Smoke rule + Gemini + HITL trên 4 ca khó, ghi `evidence/hybrid-smoke-*.json` |

## Còn mở

- Bốn quyết định D-01..D-04 trong [decision tables](docs/T13b-decision-tables.md#quyết-định-cần-reviewer-nguyên-xác-nhận) cần Nguyên xác nhận (`assessment.id`, thứ tự verdict, mã `INVALID_REQUEST`, tập evidence R08).
- Spike Gemini đã chạy (xem [decision log](docs/model-prompt-decision-log.md#kết-quả-spike-ngày-13102026-dev-7-variant-giả-lập--3-lượt-temperature-0)): model làm theo prompt injection 3/3, guard chặn 3/3. **Không dùng output Gemini khi chưa qua guard.**
- G0 chỉ đạt khi Nguyên và Đức xác nhận payload và có commit SHA trên cây sạch. Hiện là `PASS_OWNER_SIDE`, G0 vẫn **PENDING**.
