# Runbook — deploy AI service lên Render

Blueprint: [`render.yaml`](../../../render.yaml) ở gốc repo, gồm một service `fintech-ai-internal`.

## Lần đầu

1. Push nhánh lên GitHub (repo `tuananhpham-vnu/Fintech`). `render.yaml` theo dõi nhánh `main`; muốn deploy nhánh khác thì sửa `branch`.
2. Render Dashboard → **New → Blueprint** → chọn repo → **Apply**.
3. Khi Render hỏi biến `sync: false`, nhập **`GEMINI_API_KEY`**. Không commit key, không dán lên Notion hay chat.
4. `INTERNAL_API_KEY` do Render tự sinh. Mở service → **Environment** để lấy giá trị và gửi Đức qua kênh riêng của nhóm (để đặt vào env của `apps/api`).
5. Chờ deploy xong rồi kiểm tra:
   ```bash
   curl https://<service>.onrender.com/healthz
   # {"status":"ok","schema_version":"1.0.2","mode":"live"}
   curl -X POST https://<service>.onrender.com/internal/v1/evaluate \
        -H "Content-Type: application/json" -H "X-Internal-Key: <INTERNAL_API_KEY>" \
        --data @packages/contracts/fixtures/<một EvaluationInput>.json
   # Trợ lý hồ sơ (cùng key, dữ liệu tổng hợp): trả 200 + citations; thiếu GEMINI_API_KEY ở live -> 503
   curl -X POST https://<service>.onrender.com/internal/v1/chat \
        -H "Content-Type: application/json" -H "X-Internal-Key: <INTERNAL_API_KEY>" \
        --data '{"schema_version":"aic-chat-0.1","case_id":"a06adf0c-7110-51f6-86ad-4b4b903c3e9e","question":"Tóm tắt","history":[],"documents":[],"findings":[]}'
   ```

## Cấu hình

| Biến | Giá trị | Ghi chú |
|---|---|---|
| `AI_MODE` | `live` | `evaluate`: rule + Gemini cho ca khó + HITL. `inspect`/`extract` trả 503 cho tới khi có package `extraction` của Nguyên. Muốn demo UI bằng gold: đặt `mock` |
| `MODEL_ID` | `gemini-3.1-flash-lite` | Đã xác nhận qua `--list-models` |
| `CONTRACTS_DIR` | `/opt/render/project/src/packages/contracts` | Service kiểm `SHA256SUMS` lúc khởi động; contract bị sửa thì không chạy |
| `INTERNAL_API_KEY` | Render sinh | Thiếu hoặc sai → 403 trên mọi `/internal/v1/*` (fail-closed) |
| `GEMINI_API_KEY` | Nhập tay | Không có thì ca khó chuyển sang người duyệt (`SEMANTIC_PROVIDER_UNAVAILABLE`), rule vẫn chạy |
| `PYTHON_VERSION` | `3.11.11` | Code yêu cầu ≥ 3.11 |

## Giới hạn và rủi ro

- **Mạng:** contract yêu cầu loopback/private network. Gói free không có Private Service nên đang là Web Service public, được bảo vệ bằng key. Khi `apps/api` cũng chạy trên Render: đổi `type: web` → `type: pserv` (gói trả phí) và gọi qua host nội bộ.
- **Cold start:** gói free ngủ sau một thời gian không có request; lần gọi đầu có thể mất 30–60 giây. Worker của Đức nên đặt timeout và retry hữu hạn theo lease, và gọi `/healthz` trước buổi demo.
- **Dữ liệu:** chỉ dùng hồ sơ **giả lập**. Không gửi hồ sơ thật lên service public hay lên Gemini khi chưa có chấp thuận xử lý dữ liệu (Specs §20).
- **Log:** service chỉ log ID và loại lỗi, không log nội dung hồ sơ, prompt hay key.

## Rollback

- Render → service → **Events** → chọn bản deploy trước → **Rollback**.
- Hoặc revert commit trên `main`; Render tự deploy lại, nhờ `autoDeployTrigger: commit` và `buildFilter` chỉ theo dõi `services/ai`, `packages/contracts`, `render.yaml`.

## Đã kiểm chứng trước khi giao

Mô phỏng build trên bản copy sạch, không có `.venv`, `docs/`, `.env`, chạy đúng lệnh trong `render.yaml`. Kết quả 13/10/2026:

- Build OK, `/healthz` OK.
- G01–G03 evaluate đúng (live, deterministic).
- Không key → 403; `inspect` → 503; body sai → 422.

**Chưa** deploy thật lên Render. Bước đó cần người có quyền vào Render và GitHub thực hiện.
