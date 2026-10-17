# Plan: Xây lại AI theo hướng local-first (zh → en → vi) + deploy Azure

## Context

Dữ liệu hồ sơ là **mật**, nên mọi bước AI phải chạy trên hạ tầng của mình. Hiện có 3 bước gửi dữ liệu cho Google Gemini:
- OCR (ảnh trang);
- trích xuất field (text hồ sơ);
- chatbot (text cả case).

Demo chính bằng **tiếng Trung và tiếng Anh**, nhưng bộ kiểm căn cứ hiện chỉ làm cho tiếng Việt. Đã đo trực tiếp các ca sau bị từ chối dù giá trị đúng: `人民币500万元`, `2026年10月15日`, `October 15, 2026`, mã USCC 18 ký tự, trích dẫn CJK bị xuống dòng (audit **AI-002/AI-003**, P1). Tesseract cũng đang cố định `vie`.

Yêu cầu của bạn:
- chất lượng hơn tốc độ;
- **LLM duy nhất là `gemma3:4b`**, chạy local cho mọi tác vụ sinh văn bản: trích xuất, chatbot, diễn giải điều khoản;
- chatbot dùng RAG: embedding đa ngôn ngữ, vector DB, hybrid search;
- OCR bằng Docling;
- chữ "Loading" thành "Thinking" ở mọi nơi có AI xử lý;
- deploy **Azure** với **chi phí thấp nhất**: 1 VM, mặc định chỉ CPU, chỉ bật khi demo; Postgres chạy container trên cùng VM. Dev hằng ngày chạy trên Mac (0đ).

Kết quả mong muốn: hệ thống chạy trọn trong VM/VNet của mình, không có lời gọi nào ra Internet khi xử lý hồ sơ, và đúng với hồ sơ zh/en/vi.

## Kiến trúc đích (1 VM Azure hoặc máy Mac, docker compose)

```
Internet ─443─> Caddy (TLS) ─> web (Next) ─> api (Nest) ──> postgres + pgvector
                                              │  worker ──┘      (container, volume riêng)
                                              └─> ai (FastAPI) ─> ollama (CPU mặc định / GPU tùy chọn): gemma3:4b (LLM duy nhất)
                                                     │  docling (+RapidOCR/PP-OCR, TableFormer)
                                                     └  BGE-M3 (embed dense+sparse) + bge-reranker-v2-m3
Mạng nội bộ compose: chỉ Caddy mở ra ngoài. Không container nào cần Internet lúc chạy (model tải sẵn).
```

| Việc | Lựa chọn | Ghi chú |
|---|---|---|
| OCR + layout + bảng | **Docling** (OCR engine RapidOCR, model PP-OCR zh/en; EasyOCR cho vi; TableFormer chế độ `accurate`) | Cho bbox với cả trang OCR (hiện là `null`) |
| Trích xuất field | **gemma3:4b** qua Ollama (structured output theo JSON schema) | Bù cho model nhỏ: tách theo loại tài liệu, prompt kèm ví dụ, guard + repair 1 lần |
| Chatbot generate | **gemma3:4b** | Cùng một model, nạp 1 lần trên GPU |
| Diễn giải điều khoản thanh toán (`providers/semantic.py`) | **gemma3:4b** | Thay Gemini |
| Embedding | **BGE-M3**: dense 1024 + sparse lexical | Đa ngôn ngữ zh/en/vi; sparse thay cho BM25 (Postgres không tách từ tiếng Trung) |
| Rerank | **bge-reranker-v2-m3** | Ưu tiên chất lượng |
| Vector DB | **pgvector** (`vector` + `sparsevec`) trong Postgres hiện có | Dùng chung ACL theo org/case, không thêm hạ tầng |
| Serving | **Ollama** (CPU mặc định; GPU tùy chọn) | Đơn giản, có structured output; chất lượng như nhau, GPU chỉ nhanh hơn |

> Chỉ `gemma3:4b` là LLM. BGE-M3, reranker và model OCR/bảng của Docling là model mã hóa/nhận dạng, không sinh văn bản; RAG và OCR bắt buộc cần chúng.

## Các giai đoạn

### P0. Nền: provider LLM local (tái dùng toàn bộ pipeline hiện có)
- Thêm `services/ai/providers/ollama.py` với cùng interface `generate_json(system, user, schema, media, deadline, max_output_tokens)` như `providers/gemini.py`. Nhờ vậy `extraction/llm.py:call_json` (budget `Deadline`, `CallGate`, repair 1 lần), `extraction/extractor.py`, `providers/semantic.py` và `chat/` chạy nguyên, không sửa logic.
- Config: `LLM_PROVIDER=ollama` (mặc định), `LLM_MODEL=gemma3:4b` (một model dùng chung), `OLLAMA_URL`.
  - Gemini **tắt mặc định**; chỉ bật được khi đặt `ALLOW_CLOUD_LLM=true`.
  - Sửa chỗ tạo provider ở `runner/app.py` (`build_backend`, `build_chat`) và `extraction/__init__.py` (`_default_extractor`).
- `python -m runner health` báo trạng thái model local (đã tải, VRAM).

### P1. Kiểm căn cứ đa ngôn ngữ zh → en → vi (sửa AI-002, AI-003)
- `extraction/grounding.py`:
  - ngày: `年月日`, `October 15, 2026`, `15 Oct 2026`;
  - tiền: `万/亿/千`, dấu phẩy kiểu Anh, ký hiệu `¥/元/人民币/RMB/CNY/USD`;
  - cue tiền tệ, nhãn và vai trò bên: `甲方/乙方`, `Party A/B`, `Borrower/Lender`;
  - `find_quote` khớp trích dẫn CJK bị xuống dòng mà vẫn giữ offset nguồn thật.
- `normalize/__init__.py`: nhận cả MST VN (10/13 số) và **USCC Trung Quốc 18 ký tự (có checksum)**. Rule R02 so khớp theo dạng đã chuẩn hóa.
- Prompt trích xuất viết lại bằng tiếng Anh (model nhỏ theo tốt hơn), có ví dụ zh/en/vi.
- Test: mỗi ngôn ngữ có cặp đúng/sai, theo danh sách audit:
  - đổi vai trò, phủ định;
  - đổi 1 chữ số;
  - ngày 03/04 mơ hồ;
  - dấu câu full-width;
  - thang `万/亿`;
  - thiếu so với bằng 0.

  File: `services/ai/tests/test_multilingual_grounding.py`.

### P2. OCR/parse bằng Docling (local)
- `extraction/docling_reader.py`:
  - chạy Docling trong **tiến trình con** có timeout và giới hạn bộ nhớ, giữ nguyên `pdf.Limits`;
  - text từng trang theo thứ tự đọc; bảng tuần tự hóa **mỗi hàng một dòng `a | b | c`**, giống hệt nhau ở text lưu và text đưa vào prompt, để trích dẫn khớp;
  - lấy bbox từ provenance của Docling.
- Giữ `pdf.inspect` (giới hạn tài nguyên, bộ phát hiện chữ nhúng hỏng vừa sửa) để quyết định trang nào cần OCR.
- `extraction/ocr.py`:
  - thêm `OCR_ENGINE=docling` làm mặc định;
  - Tesseract nhận `OCR_LANG=chi_sim+eng+vie`;
  - `GeminiOcr` chỉ chạy khi có `ALLOW_CLOUD_LLM`.
- Contract 1.0.2 **giữ nguyên**: ExtractionOutput không đổi; `provenance.ocr_version` ghi `docling-x.y/rapidocr`.
- Benchmark `services/ai/scripts/ocr_benchmark.py` (phát triển từ bộ test lần trước):
  - zh/en/vi × {text, bảng, scan 100/150/200dpi, xoay, font hỏng};
  - đo CER và độ đúng tuyệt đối của định danh (MST/số tiền/ngày).

### P3. Trích xuất field bằng LLM local
- Ollama structured output dùng `Extractor.response_schema()` có sẵn; guard và repair giữ nguyên.
- `num_ctx` 32k (tối đa 10 trang); `AI_EXTRACT_DEADLINE_S` nâng lên 600 vì ưu tiên chất lượng.
- Tối ưu cho model 4B, thay vì đổi model:
  - prompt riêng theo loại tài liệu, có ví dụ zh/en/vi;
  - nếu tài liệu dài, chia lượt theo nhóm field;
  - giữ guard nguyên văn để field sai bị loại thay vì lọt qua.
- Dựng **bộ gold tổng hợp zh/en** (6 loại tài liệu như bundle hiện có), cộng gold vi hiện có. Đo tỉ lệ field đúng có nguồn đúng, ghi vào `docs/model-prompt-decision-log.md`.

### P4. Chatbot RAG (hybrid search)
- **DB:** migration mới `apps/api/migrations/0019_mvp_document_chunks.sql`:
  - `CREATE EXTENSION vector`;
  - bảng `aic.mvp_document_chunks` với cột org, case, document_id, version, sha256, page, chunk_index, text, lang, `dense vector(1024)`, `sparse sparsevec`;
  - index HNSW cho `dense`; trigger bất biến giống các bảng tài liệu khác;
  - grant: worker INSERT, api SELECT, cập nhật `scripts/sandbox-runtime-grants.sql`.
- **AI service**, bundle mới `packages/contracts/aic-rag`:
  - `POST /internal/v1/index`: trang → chunk (giữ nguyên bảng, không vượt ranh giới trang) → BGE-M3 dense + sparse;
  - `POST /internal/v1/embed-query`;
  - `/internal/v1/chat` nâng lên `aic-chat-0.2`: nhận **chunk ứng viên** thay vì toàn bộ trang → rerank → gemma3:4b → kiểm trích dẫn.
  - Giữ nguyên `chat/analysis.py` (chỉ số Decimal) và `chat/verify.py`.
- **Worker** (`apps/api/src/documents/document-worker.ts`): sau khi publish extraction thì gọi `/index` và ghi chunk. Thêm script backfill cho tài liệu cũ.
- **Backend** (`apps/api/src/assistant/assistant.service.ts`):
  - giữ ACL qua `documents.list` và correction qua `DocumentDecisions.projections`;
  - truy vấn hybrid trong case: dense top 50 + sparse top 50 + khớp định danh chính xác (dùng lại hàm `fold` của tìm kiếm hiện có) → gộp bằng RRF → 40 chunk gửi AI;
  - timeout chat nâng lên khoảng 180s (backend, proxy web, client).
- Prompt hệ thống viết bằng tiếng Anh; trả lời theo ngôn ngữ của câu hỏi.

### P5. Giao diện "Thinking" + ưu tiên tiếng Trung
- Mọi nơi AI đang xử lý hiện "Thinking… / Đang suy nghĩ… / 思考中…":
  - chatbot (`features/assistant/components/case-assistant.tsx`), kèm bước đang làm: tìm tài liệu → xếp hạng → viết câu trả lời. Backend trả tiến trình qua SSE, endpoint `…/assistant/messages/stream`; proxy phải cho phép stream;
  - trạng thái trích xuất/OCR của tài liệu (`processingRunning` và các nhãn liên quan trong `lib/i18n/messages.ts`).
- Chỗ tải dữ liệu thường vẫn giữ "Loading" (`components/feedback/loading.tsx`).
- Locale mặc định cấu hình được, đặt `zh-CN` cho demo. Kiểm toàn bộ bản dịch zh.

### P6. Chế độ triển khai riêng tư (thay các chốt "chỉ local")
- Thay `AIC_DOCUMENT_RUNTIME=local` bằng một chế độ tường minh `AIC_DEPLOYMENT=private` cho Azure. Chế độ này bắt buộc:
  - origin HTTPS;
  - key không phải giá trị mặc định;
  - DB không có địa chỉ public;
  - không bật provider cloud.
- Bootstrap (`apps/api/src/database/bootstrap-sandbox.ts`) chấp nhận host DB trong mạng compose khi ở chế độ này.
- Sửa audit **BE-001** (chế độ chạy và role tường minh) và **BE-002** (giám sát dossier worker). Giữ role DB tách riêng: owner, api, worker.
- **Phối hợp với Đức** vì đây là phần an toàn của backend.

### P7. Deploy Azure
- Dockerfile:
  - `services/ai`: Python 3.11, Docling/RapidOCR/BGE-M3/reranker, model tải sẵn lúc build;
  - `apps/api`: chung image cho api và worker;
  - `apps/web`: Next standalone.
- Image có sẵn: `ollama/ollama` (pull `gemma3:4b` vào volume), `pgvector/pgvector:pg17`, `caddy`.
- `deploy/azure/docker-compose.yml` + `deploy/azure/Caddyfile` + `deploy/azure/setup-vm.sh`:
  - NVIDIA driver, nvidia-container-toolkit;
  - data disk riêng cho model và Postgres;
  - `pg_dump` hằng ngày sang ổ backup.
- VM mặc định **chỉ CPU** (8 vCPU / 32GB RAM, ví dụ dòng `D8as_v5`), bật khi demo rồi deallocate; dùng Spot nếu demo ngắn. Chỉ lên GPU nhỏ (T4 16GB hoặc 1/3 A10) khi tốc độ CPU không chấp nhận được. Ổ đĩa có mã hóa. NSG chỉ mở 443, và SSH từ IP quản trị.
- Có `docker-compose.gpu.yml` (override) để bật GPU cho Ollama bằng một lệnh, không cần sửa code.
- Secret để trong `.env` trên VM, quyền 600 (hoặc Azure Key Vault). Không commit.
- `render.yaml` và runbook Render: đánh dấu ngừng dùng cho dữ liệu thật.

## File chính sẽ sửa/thêm
- **AI service:**
  - thêm: `providers/ollama.py`, `extraction/docling_reader.py`, `chat/retrieval.py` (rerank), endpoint `index` / `embed-query`;
  - sửa: `extraction/{grounding,ocr,extractor,__init__}.py`, `normalize/__init__.py`, `runner/app.py`, `chat/context.py`, `pyproject.toml`.
- **Contract:** thêm `packages/contracts/aic-rag/`; `aic-chat` lên 0.2. Bộ 1.0.2 giữ nguyên.
- **Backend:** migration `0019`, `assistant.service.ts`, `document-worker.ts`, `config/configuration.ts`, `foundation.module.ts`, `bootstrap-sandbox.ts`, file grant.
- **Web:** `case-assistant.tsx` (stream + Thinking), `lib/i18n/messages.ts`, route proxy (cho stream), locale mặc định.
- **Deploy:** `deploy/azure/*`, Dockerfile cho từng service.

## Verification
1. **Unit/offline:** `pytest` (đầy đủ zh/en/vi), `pnpm typecheck && pnpm lint && pnpm test`, `node scripts/test-local-postgres.cjs … assistant.integration.cjs` cộng test chunk/RAG mới. Không giảm số test pass hiện có (560 AI, 194 backend).
2. **Benchmark chất lượng** (ghi vào `services/ai/evidence/`):
   - OCR: CER từng ngôn ngữ, định danh đúng 100% trên bản 150dpi;
   - trích xuất: độ đúng của gemma3:4b trên gold zh/en/vi;
   - RAG: recall@k cho bộ câu hỏi có đáp án và trang nguồn;
   - chatbot: tỉ lệ trích dẫn khớp nguồn, không bịa số.
3. **Kiểm không lộ dữ liệu:** chạy cả stack với **mạng ra ngoài bị chặn** (compose `internal: true` / NSG deny outbound). Upload và chat vẫn chạy, log không có kết nối ra ngoài.
4. **E2E trên Azure:** đăng nhập → upload PDF zh/en/vi (text, bảng, scan) → field đúng kèm nguồn → chatbot trả lời có trích dẫn bấm mở được, hiển thị "Thinking". Đo thời gian mỗi bước.

## Thứ tự và phụ thuộc
P0 → P1 → P2 → P3 (trích xuất chạy local, đúng zh/en) → P4 → P5 → P6 → P7. P1 và P2 làm song song được.

Cần chốt với nhóm:
- **Nguyên:** grounding/OCR/extraction (P1–P3);
- **Đức:** backend gates và migration (P4, P6);
- **Tuấn Anh:** runner, rules, chat.

## Phụ lục: Cách deploy lên Azure (chi tiết, tối ưu chi phí)

### Chọn mức hạ tầng (ưu tiên rẻ; chất lượng như nhau vì cùng model gemma3:4b)
| Mức | Chạy ở đâu | Chi phí | Tốc độ ước lượng | Dùng khi |
|---|---|---|---|---|
| 0 | **Máy Mac** của dev (Ollama dùng Metal) | 0đ | chat 10–30s | Dev hằng ngày, demo trực tiếp trên máy |
| 1 (**mặc định**) | Azure VM **chỉ CPU** 8 vCPU / 32GB RAM, bật khi demo rồi deallocate | Thấp: trả theo giờ chạy + phí ổ đĩa | chat 1–2 phút, trích xuất vài phút/hồ sơ | Demo cho người khác |
| 2 | Như mức 1 nhưng dùng **Spot VM** | Rẻ hơn mức 1 nhiều | như mức 1 | Demo ngắn; Azure có thể thu hồi VM, dữ liệu trên ổ vẫn giữ |
| 3 | VM GPU nhỏ (T4 16GB, hoặc 1/3 A10) | Trung bình | chat 5–15s | Khi bắt buộc phải nhanh |

- Giá theo vùng: kiểm bằng Azure Pricing Calculator trước khi tạo.
- **Azure for Students** (email `@vnu.edu.vn`) có credit miễn phí và cho tạo CPU VM. Thường không cho GPU, nhưng mức 1 là đủ.
- Bật **auto-shutdown** hằng ngày. Sau mỗi buổi demo chạy `az vm deallocate`: VM tắt thì không tính tiền máy, chỉ còn phí ổ đĩa.
- Model chạy bản lượng tử hóa mặc định của Ollama (`gemma3:4b`, Q4). Nếu đo thấy chất lượng chưa đủ, đổi sang bản `q8_0` (chậm hơn, cần thêm RAM).

### Tài khoản: Azure for Students (đã có)
- Credit khoảng 100 USD. Chỉ khi subscription **còn là gói Students gốc** (`spendingLimit: On`) thì hết credit mới tự dừng mà không trừ tiền. Nếu đã chuyển sang Pay-As-You-Go, hoặc tạo tài nguyên ở subscription khác, thì **bị tính tiền thật**.
- Trước khi deploy, kiểm `az account show` để chắc đang ở đúng subscription Students. Đặt **Budget alert** (ví dụ 5 USD) trong Cost Management.
- Deallocate VM chỉ dừng phí máy; **ổ đĩa và Public IP tĩnh vẫn tính tiền**. Không dùng lâu thì xóa cả resource group (sao lưu `/data/backup` trước).
- Thường **không có GPU và không có Spot**: dùng mức 1 (VM CPU thường), bật khi demo, deallocate sau demo.
- Bị giới hạn **vùng được phép** và **quota vCPU mỗi vùng**. Kiểm trước khi tạo VM:
  ```bash
  az policy assignment list --query "[].parameters.listOfAllowedLocations.value" -o json
  az vm list-usage -l <vùng> -o table | grep -i -E "Total Regional vCPUs|DASv5|DSv5"
  ```
- Cỡ VM theo quota:
  - đủ 8 vCPU: `D8as_v5` (8 vCPU/32GB);
  - nếu không: `D4as_v5` (4 vCPU/16GB), kèm giới hạn RAM: ollama 5GB, ai 5GB, postgres 2GB, api+worker+web 3GB.
- Chọn vùng gần Việt Nam nhất trong danh sách được phép (ví dụ Southeast Asia / East Asia nếu có).

### Điều kiện trước khi deploy
1. Code xong P0–P6, nhất là P6: không có chế độ `AIC_DEPLOYMENT=private` thì backend tự chặn khi chạy trên server.
2. Mức 1–2 không cần quota GPU. Chỉ mức 3 mới phải xin quota GPU, mất vài ngày.
3. Tên miền, hoặc DNS label miễn phí `<tên>.<vùng>.cloudapp.azure.com`, để Caddy cấp TLS tự động.

### Bước 1: Hạ tầng (`deploy/azure/provision.sh`, dùng az CLI)
- Resource group, VNet + subnet, Public IP tĩnh có DNS label.
- NSG:
  - inbound chỉ mở 443 (và 80 cho Let's Encrypt), có thể giới hạn theo IP của nhóm;
  - 22 chỉ cho IP quản trị.
- VM Ubuntu 22.04 (mức 1: CPU 8 vCPU/32GB; tùy chọn `--priority Spot`), kèm **data disk khoảng 64–128GB** (Standard SSD để rẻ) gắn tại `/data`, chứa model (khoảng 10GB), Postgres và backup.
- Mức 3 mới cần cài driver GPU (Azure NVIDIA GPU Driver Extension) và `nvidia-container-toolkit`.

### Bước 2: Chuẩn bị VM (`deploy/azure/setup-vm.sh`)
- Docker Engine + compose plugin; chuyển thư mục dữ liệu của Docker sang `/data/docker`.
- Clone repo bằng deploy key chỉ đọc vào `/opt/aic`.
- File `/data/secrets/.env` (quyền 600) gồm mật khẩu DB owner/api/worker, `INTERNAL_API_KEY`, tài khoản bootstrap, `AIC_FRONTEND_ORIGIN`. Không có key cloud nào.

### Bước 3: Tải model một lần (lúc này VM còn được ra Internet)
- `ollama pull gemma3:4b` vào volume `/data/ollama`.
- BGE-M3, bge-reranker-v2-m3, Docling (layout, TableFormer, RapidOCR) tải sẵn vào `/data/models`. Lúc chạy đặt `HF_HUB_OFFLINE=1`.

### Bước 4: `deploy/azure/docker-compose.yml` (+ `docker-compose.gpu.yml` cho mức 3)
| Service | Mạng | Ghi chú |
|---|---|---|
| `caddy` | `edge` | TLS Let's Encrypt, proxy vào `web:3000` |
| `web` | `edge` + `internal` | Next standalone, `AIC_BACKEND_URL=http://api:3001/api/v2` |
| `api` | `internal` | Nest, role DB `api`, `AIC_DEPLOYMENT=private` |
| `worker` | `internal` | Cùng image với api, role DB `worker` |
| `ai` | `internal` | FastAPI + Docling + embedding/rerank, `LLM_PROVIDER=ollama` |
| `ollama` | `internal` | CPU mặc định; GPU khi dùng file override |
| `postgres` | `internal` | `pgvector/pgvector:pg17`, volume `/data/postgres` |
| `db-init` (chạy 1 lần) | `internal` | migrate → grant → bootstrap |

- Mạng `internal` khai báo `internal: true`: container trong đó **không ra được Internet**, lớp chặn rò dữ liệu thứ nhất. NSG outbound là lớp thứ hai.
- `api`, `worker` và `ai` dùng chung volume cache tạm; PDF vẫn lưu trong Postgres.
- Trên máy 32GB RAM, đặt giới hạn bộ nhớ cho từng container (ví dụ ollama 8GB, ai 6GB) để không làm sập nhau.

### Bước 5: Khởi chạy và kiểm tra
1. `docker compose run --rm db-init` rồi `docker compose up -d`.
2. `deploy/azure/smoke.sh`: `/login` trả 200, AI health OK, rồi chạy luồng upload PDF zh/en/vi → field → chatbot.
3. Kiểm không rò: `docker compose exec ai curl -m 5 https://www.google.com` phải **thất bại**.

### Bước 6: Vận hành
- Backup: cron chạy `pg_dump` hằng đêm vào `/data/backup`, giữ 7 bản.
- Cập nhật: `git pull` → `docker compose build` → `db-init` → `docker compose up -d`.
- Sau demo: `az vm deallocate`; lần sau bật lại bằng `az vm start`, dữ liệu và model còn nguyên trên ổ.

### Rủi ro cần lưu ý
- CPU chậm: một câu chat có thể mất 1–2 phút. Đã nâng timeout (P4) và UI hiện "Thinking" (P5) để người dùng biết hệ thống đang chạy.
- Spot VM có thể bị thu hồi giữa buổi demo. Demo quan trọng thì dùng VM thường (mức 1).
- gemma3:4b là model nhỏ: chất lượng trích xuất phụ thuộc prompt theo loại tài liệu và guard. Phải đo trên gold zh/en (P3) trước khi chốt.
