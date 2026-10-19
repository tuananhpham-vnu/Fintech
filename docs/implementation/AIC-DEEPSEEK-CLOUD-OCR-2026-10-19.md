# DeepSeek Flash: OCR và xử lý AI

Ngày kiểm tra: 19/10/2026. Cấu hình theo yêu cầu chủ dự án, sử dụng API DeepSeek trực tiếp.

## Cấu hình đang chọn

Root `.env` đã đổi sang `AI_PROVIDER=deepseek`, `DEEPSEEK_MODEL_ID=deepseek-flash`,
`DEEPSEEK_BASE_URL=https://api.deepseek.com`, `OCR_ENGINE=provider`, `AI_MODE=live`.
Key mới chỉ lưu trong `.env` được Git ignore. Không ghi key trong báo cáo hoặc log.
Launcher không chuyển key Gemini sang process AI khi chọn DeepSeek.

Adapter đã có sẵn dùng Chat Completions và luôn gửi `thinking: {type: "disabled"}`.
Không cần SDK OpenAI: `extra_body` trong ví dụ SDK tương ứng với trường `thinking`
ở cấp gốc JSON khi ứng dụng dùng HTTP trực tiếp. JSON vẫn được kiểm schema và căn cứ.

## Ngân sách output và ZIP

| Bước | `max_tokens` tối đa mỗi request |
| --- | ---: |
| OCR một ảnh trang | 16.384 |
| Trích xuất hợp đồng / trường tài liệu | 16.384 |
| Trích xuất số liệu BCTC | 16.384 |
| Nhận diện BCTC và kỳ báo cáo | 8.192 |
| Sửa căn cứ riêng lẻ | Giữ giới hạn 4.096 / 8.192 hiện có |

Đây là giới hạn output, không phải context đầu vào, số file hoặc độ song song.
ZIP vẫn được tách thành từng tài liệu và xếp hàng xử lý; không gửi nguyên 40 file
vào một request. Worker intake hiện xử lý từng file; financial import có OCR tối đa
hai trang đồng thời, chịu CallGate chung tối đa bốn lời gọi trong một process.
Lượt này không tăng số worker hoặc thay cơ chế claim/lease. Giới hạn chọn trang
hiện hành vẫn là 16 trang, tối đa 8 trang cần OCR trong một lần import.

Prompt OCR v3 yêu cầu giữ hàng/cột, chép số 0 thực sự được in, phân biệt ô trống,
giữ dấu âm/ngoặc và không tính hoặc suy diễn số liệu. Version OCR mới khiến cache
không dùng nhầm kết quả của Docling hoặc prompt OCR cũ.

## Xác nhận thực tế

- Key mới gọi JSON tổng hợp thành công (953 ms) và đọc ảnh tổng hợp thành công
  (703 ms), response model đều là `deepseek-flash`.
- Hai BCTC người dùng cung cấp: 2024 và 2025, mỗi file 8 trang. Đã OCR mới toàn bộ
  16 trang bằng API DeepSeek, không dùng văn bản OCR local cũ.
- Thời gian mỗi trang: 1,74–6,06 giây trong lượt thử; OCR dùng tối đa hai trang
  song song. Đây là số đo của lượt thử, không phải cam kết latency.
- Đối chiếu 32 hàng bảng được kiểm bằng ảnh bản gốc: 32/32 giữ đúng cặp số của
  hai cột. Bao gồm số 0, số âm và các tổng tiền. Đây là mẫu kiểm, không phải tỷ lệ
  chính xác của toàn bộ tài liệu. Chi tiết ở `.reports/deepseek-switch-2026-10-19/quality.json`.
- Qua route FastAPI thật bằng TestClient với backend live và API DeepSeek thật:
  discovery trả HTTP 200 cho cả hai PDF; nhận kỳ 2025/2024 và 2024/2023.
  Bốn lần trích xuất theo kỳ đều HTTP 200, không lỗi OCR, mỗi kỳ có 10/14 chỉ tiêu
  được guard chấp nhận. Tất cả fact vẫn `unverified`.
- Còn thiếu `unrestricted_short_term_equivalents`, `trade_receivables`,
  `interest_bearing_debt`, `depreciation_amortization`; đây không phải lỗi cắt output.
  `trade_receivables` bị giữ lại với `NET_TRADE_RECEIVABLES_REQUIRED` vì số phải thu
  tổng chưa đủ căn cứ cho định nghĩa phải thu thuần của method. Không nới guard
  hoặc tự tính số thiếu trong lượt đổi API.
- Tổng 22 request DeepSeek (16 ảnh, 6 text), response model đều đúng; toàn lượt
  kiểm tra 61,56 giây. OCR text được cache trong cùng process trước khi thử route,
  tương ứng luồng discovery/import tái sử dụng OCR; không phải thời gian upload ZIP
  đầy đủ trên trình duyệt.
- ZIP gốc có 40 file, CRC hợp lệ; chỉ kiểm inventory, không chạy cloud cả 40 file
  hoặc tạo job mới trong DB.
- Toàn bộ AI: 750 passed, 4 skipped. `pnpm dev:all --check` qua với DeepSeek và
  provider OCR. Không bật stack/worker hoặc ghi dữ liệu nghiệp vụ trong lượt thử.

Receipt chính: `.reports/deepseek-switch-2026-10-19/result.json`. Các bản trích xuất
theo kỳ và OCR text chỉ nằm trong thư mục báo cáo local. Khởi động ứng dụng bằng
`pnpm dev:all`; bản import cũ không tự đổi provenance, cần chủ động thử lại tài liệu.

## Tài liệu API

- [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [Vision](https://api-docs.deepseek.com/guides/vision/)
- [Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)
