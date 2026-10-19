# Agent Router / DeepSeek V4 Flash — 19/10/2026

Yêu cầu chủ dự án: thêm gateway Agent Router tại `agentrouter.org`, dùng model
`deepseek-v4-flash` làm core. Key chủ dự án cung cấp chỉ lưu root `.env` bị Git ignore.

## Kết quả

- Đã thêm `AgentRouterProvider` qua port `ModelProvider`, dùng JSON Chat Completions
  transport hiện có với tên/key/cấu hình riêng; giữ Gemini và DeepSeek trực tiếp.
- Default gateway `https://agentrouter.org/v1`, gọi `/chat/completions`, Bearer token,
  model `deepseek-v4-flash`. Nguồn: [tài liệu chính thức](https://agentrouter.org/docs/opencode.html)
  được mở từ liên kết Docs trong console của người dùng. Không nhầm `agentrouter.to`.
- Root `.env` đã chọn `AI_PROVIDER=agentrouter`; model/base URL/key/capability riêng
  dưới prefix `AGENTROUTER_`. `MODEL_ID` cũ không ghi đè model của gateway.
- Launcher chỉ chuyển đúng key đang chọn sang AI. API/web không nhận key router;
  không fallback sang Gemini, DeepSeek trực tiếp hoặc mock khi có lỗi.
- Không thay method chấm điểm, contract nghiệp vụ hoặc dữ liệu BCTC cũ.

## Kiểm tra thực tế và điểm còn chặn

GET `/v1/models` và POST JSON tổng hợp đến gateway đều nhận HTTP **401**. Error
message được xác minh là **unauthorized client detected, contact support for
assistance**. Gọi lại qua adapter chính với `User-Agent: AIC-Rating/1.0
(financial-document-service)` vẫn 401, đúng một request; không giả client khác.
Receipt không chứa key/tài liệu ở `.reports/agentrouter-live-check.json`.

Đây là hạn chế client của gateway. Chưa có bằng chứng key sai, model không tồn tại,
thiếu số dư hay gọi model thành công. Cần phía Agent Router cho phép AIC/generic
backend client trước khi nghiệm thu live. Không sửa quyền token/tài khoản trên
website, gửi tin hỗ trợ, mua dịch vụ hay dùng header giả Codex/Claude Code để vượt
chặn. [Phạm vi sử dụng của gateway](https://agentrouter.org/docs/terms.html) nêu nền
tảng ưu tiên công cụ lập trình và có thể giới hạn các kiểu dùng khác.

Không gửi hồ sơ riêng tư/ZIP qua gateway mới trong lượt này. Không restart các
worker đang chạy chỉ để tiếp tục gọi khi gateway đã từ chối client. Cấu hình trên
đĩa được áp dụng sau lần restart bằng `pnpm dev:all`; process cũ giữ cấu hình cũ.

## OCR

Mã model của gateway không chứng minh khả năng vision giống model có tên gần
giống ở API DeepSeek trực tiếp. `AGENTROUTER_VISION_ENABLED=0` mặc định, từ chối
ảnh trước khi gọi mạng. Bật `1` chỉ sau khi gateway hỗ trợ và đã test bằng ảnh tổng
hợp. PDF text/Excel không cần vision; PDF scan cần OCR local (`tesseract` với
binary/ngôn ngữ đã cài), hoặc capability ảnh đã xác minh. Chưa test được vision
live do HTTP 401, không khẳng định router đang OCR được.

## Kiểm thử

| Kiểm tra | Kết quả |
| --- | --- |
| Toàn bộ pytest | 715 passed, 4 skipped, một cảnh báo deprecation có sẵn |
| Chọn provider/key/model/endpoint trong launcher | 3 passed |
| `pnpm dev:all --check` | Qua, nhận `agentrouter / deepseek-v4-flash`; không gọi model |
| API build trong preflight | Qua |
| HTTP probe tổng hợp qua adapter thật | Thất bại 401 `CLIENT_NOT_ALLOWED`, không retry |
| OCR live và BCTC thật qua Agent Router | Chưa chạy, chặn bởi quyền client |

Kiểm thử offline bao gồm endpoint đúng `/v1`, cách ly credentials, truthful
User-Agent, 401/402/403/redirect không retry/fallback/lộ body, JSON parsing,
grounding kỳ BCTC, health và capability ảnh bật/tắt rõ ràng. Test offline không
chứng minh độ chính xác trích xuất hoặc quyền sử dụng model thực tế.
