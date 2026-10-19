# Chọn Gemini, DeepSeek hoặc Agent Router

Runtime dùng `providers.base.ModelProvider` và `providers.factory.create_provider()`.
Các adapter cùng cung cấp `generate_json(...)`; discovery BCTC, extraction,
OCR bằng model và xử lý điều khoản dùng chung provider được chọn.
Gemini được giữ làm mặc định, cùng các đường import cũ của adapter.

## Cấu hình local

Thêm/chỉnh các dòng dưới đây trong `.env` **đang có ở gốc repo**. Giữ cấu hình
DB, policy, private storage và internal authentication hiện tại.
Chỉ cần key của nhà cung cấp đang chọn; có thể lưu cả hai key để chuyển qua lại.
Ví dụ này không chứa key thật:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=replace_with_gemini_key
GEMINI_MODEL_ID=gemini-3.1-flash-lite

DEEPSEEK_API_KEY=replace_with_new_deepseek_key
DEEPSEEK_MODEL_ID=deepseek-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com

OCR_ENGINE=provider
```

Đổi `AI_PROVIDER=deepseek` để chọn DeepSeek; đổi lại `gemini` để dùng Gemini.
`MODEL_ID` cũ vẫn được dùng cho Gemini nếu chưa có `GEMINI_MODEL_ID`.
DeepSeek chỉ lấy `DEEPSEEK_MODEL_ID` (mặc định `deepseek-flash`), nên `MODEL_ID`
Gemini cũ không làm hỏng việc chuyển provider.

Sau khi đổi cấu hình, dừng stack bằng Ctrl+C rồi chạy lại:

```powershell
pnpm dev:all
```

`pnpm dev:all --check` kiểm tra API và khả năng tạo adapter AI với đúng cấu hình,
không gọi API model, không bật dịch vụ hoặc sửa DB. Nó không xác nhận key còn tiền,
quyền gọi model hay độ chính xác của model.
Launcher chỉ chuyển key của provider được chọn sang Python AI, không chuyển key
đó sang Next/API. Không tự fallback sang provider còn lại hoặc mock khi lỗi.

## JSON, OCR và kiểm chứng số liệu

DeepSeek dùng Chat Completions, Bearer authentication, `response_format=json_object`
và schema trong system prompt. Thinking tắt để giữ budget của extraction hiện tại.
JSON vẫn qua các schema/grounding/semantic guards hiện hành của ứng dụng;
JSON hợp lệ chưa đủ để một số liệu được chấp nhận. Output rỗng, không phải JSON,
không phải object hoặc bị cắt do hết token đi vào đường lỗi/repair hiện có.

Ảnh PNG/JPEG/WebP/GIF được gửi inline bằng base64 trong user message.
`deepseek-flash` hỗ trợ ảnh theo tài liệu API ngày 19/10/2026.
Adapter chặn OCR ảnh nếu chọn model chưa được nhận diện là hỗ trợ ảnh, chẳng hạn
`deepseek-v4-pro`; PDF có text vẫn dùng được. Với model chỉ đọc text, đặt
`OCR_ENGINE=docling` ([cài runtime/model local](local-ocr.md)),
`tesseract` (cần cài binary/ngôn ngữ) hoặc `none` theo nhu cầu.
`OCR_ENGINE=gemini` là alias cũ cho OCR bằng provider được chọn; cấu hình mới nên
dùng `provider`. Provenance OCR ghi đúng tên provider/model thực tế.

Mỗi lần gọi giữ timeout/deadline, tối đa hai retry cho lỗi tạm thời, không retry
lỗi key/thanh toán/quyền truy cập và không theo redirect mang theo key.
Chẩn đoán chỉ ghi mã lỗi, không ghi key, prompt, tài liệu hoặc body lỗi upstream.

Method, trọng số/band, dữ liệu nguồn bất biến và yêu cầu xác nhận chung trước
khi phát điểm không thay đổi. Đổi provider có thể đổi kết quả trích xuất nên cần
đối chiếu bộ BCTC có đáp án trước khi đánh giá chất lượng thực tế.

## Kiểm tra đã chạy

- Pytest: 683 passed, 4 skipped; gồm 30 ca DeepSeek mới, HTTP dùng mock transport.
- BCTC tổng hợp qua adapter DeepSeek: nhận diện kỳ, trích xuất và giữ nguồn/giá trị;
  số liệu không khớp nguồn bị giữ lại, số được nhận vẫn là `unverified`.
- OCR ảnh và xử lý điều khoản: dùng adapter DeepSeek với guards hiện hành.
- Launcher: chọn đúng một key/model, tương thích `MODEL_ID` cũ của Gemini,
  từ chối thiếu key đúng provider, endpoint không hợp lệ và model rỗng.
- 7 kiểm thử launcher đều qua trên PostgreSQL tạm; `pnpm dev:all --check` qua
  với Gemini hiện tại và DeepSeek dùng key tổng hợp chỉ để kiểm tra cấu hình.

Lượt bổ sung adapter ban đầu chỉ dùng kiểm thử offline. Sau đó, ngày 19/10/2026,
chủ dự án yêu cầu điền key và kiểm tra thật: đã cập nhật root `.env` thành
`AI_PROVIDER=deepseek`, endpoint `https://api.deepseek.com`, model `deepseek-flash`
và khởi động lại stack. Key chỉ nằm trong `.env` bị Git ignore; key Gemini được
giữ để có thể chuyển lại sau, nhưng không được chuyển sang process AI khi chọn DeepSeek.

Kiểm tra live: `/models` trả HTTP 200; adapter thực tế là `DeepSeekProvider`,
response model là `deepseek-flash`, nhận JSON tổng hợp đúng sau một lần gọi
(844 ms, 130 token cho yêu cầu kiểm tra kết nối). Luồng nội bộ
`/internal/v2/financial-discovery` trả HTTP 200 trong khoảng 2 giây, provenance
`deepseek-flash`, nhận đúng 2024-12-31 và 2025-12-31, không cảnh báo từ PDF text
tổng hợp. Web/API/AI đều HTTP 200 sau restart. Đây là xác nhận kết nối/routing và
smoke test PDF text, chưa đo chất lượng OCR hoặc BCTC thực tế trên DeepSeek.

## Agent Router — DeepSeek V4 Flash

### Cấu hình local mới nhất: DeepSeek trực tiếp cho cả OCR

Sau các lượt thử gateway/local OCR, chủ dự án đã chọn lại DeepSeek trực tiếp với key mới.
Root `.env` hiện dùng `AI_PROVIDER=deepseek`, `DEEPSEEK_MODEL_ID=deepseek-flash`,
`DEEPSEEK_BASE_URL=https://api.deepseek.com`, `OCR_ENGINE=provider`, `AI_MODE=live`.
Adapter giữ `thinking=disabled` theo cấu hình chủ dự án gửi. OCR prompt v3 giữ số 0,
ô trống và cột bảng; OCR/extraction tối đa 16.384 output token, discovery 8.192.
ZIP được tách file, không tăng số file xử lý đồng thời bằng `max_tokens`.
Đã kiểm thật 16 trang của hai BCTC, discovery và bốn lần extract đều HTTP 200.
Chi tiết phạm vi và số liệu thiếu còn lại:
[báo cáo DeepSeek cloud OCR](../../../docs/implementation/AIC-DEEPSEEK-CLOUD-OCR-2026-10-19.md).

### Lịch sử thử Agent Router

Tài liệu trên chính website người dùng cung cấp xác nhận OpenAI Chat Completions tại
`https://agentrouter.org/v1/chat/completions`, Bearer token và model `deepseek-v4-flash`.
Đây là gateway riêng, có tài khoản/quota/quyền client riêng; key DeepSeek trực tiếp
không dùng thay key Agent Router. Không nhầm với dịch vụ khác cùng tên tại `.to`.

```dotenv
AI_PROVIDER=agentrouter
AGENTROUTER_API_KEY=replace_with_agentrouter_key
AGENTROUTER_BASE_URL=https://agentrouter.org/v1
AGENTROUTER_MODEL_ID=deepseek-v4-flash
AGENTROUTER_VISION_ENABLED=0
OCR_ENGINE=provider
```

`AgentRouterProvider` kế thừa transport Chat Completions đã dùng cho DeepSeek,
giữ JSON guard, deadline/retry và quy tắc không redirect; tên provider, key/model
và provenance riêng. Launcher chỉ gửi key được chọn sang process AI. Gemini và
DeepSeek trực tiếp vẫn có thể chọn lại bằng `AI_PROVIDER`; không tự fallback.
Client tự nhận đúng tên `AIC-Rating/1.0 (financial-document-service)`, không giả làm
Codex/Claude Code/OpenCode để vượt hạn chế client của gateway.

Khả năng nhận ảnh của alias gateway chưa được xác minh. Mặc định không gửi ảnh;
PDF có text và Excel sau chuyển đổi vẫn đi qua model core. PDF scan cần OCR local
`OCR_ENGINE=docling` ([hướng dẫn](local-ocr.md)) hoặc `tesseract` (cài binary/ngôn ngữ trước), hoặc chỉ bật vision khi endpoint
thực sự cho phép và đã kiểm tra bằng ảnh tổng hợp. `--check` chỉ kiểm cấu hình,
không chứng minh model/key được gọi thật hoặc hỗ trợ ảnh.

Ngày 19/10/2026: key chủ dự án cung cấp được lưu trong root `.env` bị Git ignore;
cấu hình local đã chọn `agentrouter` / `deepseek-v4-flash`. GET `/v1/models` và
yêu cầu JSON tổng hợp trả HTTP **401** với thông báo **unauthorized client detected**.
Gọi lại qua chính `AgentRouterProvider`, với User-Agent AIC trung thực, cũng nhận
HTTP 401 / `CLIENT_NOT_ALLOWED` sau một request, không retry. Receipt an toàn ở
`.reports/agentrouter-live-check.json`; không gửi BCTC thật trong các probe này.
Không coi test offline hay health thành kết nối thành công. Cần quản trị Agent Router cho phép backend
AIC/generic API client. Không tự sửa token permissions, mua dịch vụ hay đổi user-agent
để giả một client khác. Stack đang chạy không tự đổi provider chỉ vì sửa `.env`;
sau khi gateway cấp quyền, khởi động lại bằng `pnpm dev:all`.

Kiểm tra sau tích hợp: toàn bộ Python **715 passed, 4 skipped**; 3 kiểm thử chọn
provider của launcher qua; `pnpm dev:all --check` nhận đúng Agent Router/V4 Flash,
API build/config check qua. Các kiểm thử bao gồm JSON/grounding, tên provider,
cách ly key, endpoint HTTPS `/v1`, client identity, 401/402 không retry/fallback,
không redirect key và OCR chỉ gửi ảnh khi capability đã bật rõ ràng.

Nguồn: [OpenCode/OpenAI-compatible](https://agentrouter.org/docs/opencode.html),
[phạm vi sử dụng](https://agentrouter.org/docs/terms.html).

Tài liệu DeepSeek chính thức:
[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/),
[JSON Output](https://api-docs.deepseek.com/guides/json_mode/),
[Vision](https://api-docs.deepseek.com/guides/vision/).
