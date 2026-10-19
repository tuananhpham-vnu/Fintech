# AI đề xuất số liệu tính toán

Đã bật `AI_FINANCIAL_CALCULATIONS=1` trong root `.env`. Provider hiện tại vẫn là
DeepSeek Flash, thinking tắt theo cấu hình đã chốt. Không sửa method, trọng số,
band hoặc quy tắc xác nhận chung.

## Sử dụng

1. Khởi động lại `pnpm dev:all`. Với tài liệu đã trích xuất trước khi bật tính năng,
   chọn **Thử lại** ở tab Tài liệu; quyết định giữ/thay phiên bản theo luồng hiện có.
2. Tại **Rà soát dữ liệu BCTC**, xem phần **AI đề xuất số liệu tính toán**. Mở từng
   dòng nguồn để đối chiếu kỳ, đơn vị, cơ sở báo cáo, công thức và tính đầy đủ.
3. Chọn đề xuất đủ căn cứ, đánh dấu đã rà soát, rồi **Áp dụng đề xuất đã rà soát**.
   Hệ thống tạo phiên bản bộ số liệu mới và ghi rõ **Số tính ra**.
4. Xác nhận rà soát tất cả lại trước khi dùng số đó cho tỷ số/chấm điểm.

Có thể chọn **Không dùng số tính ra** để bỏ một kết quả đã áp dụng. Hệ thống giữ
phiên bản cũ, tạo phiên bản mới và làm xác nhận trước đó hết hiệu lực.

Không có công thức đủ căn cứ thì giữ N/A. Đề xuất còn giả định bị chặn; không thể
chỉ tick xác nhận để biến giả định thành số hợp lệ. Có thể bổ sung BCTC/thuyết minh
và đọc lại hoặc dùng luồng bổ sung số liệu có nguồn hiện có.

## Luồng dữ liệu

- Trích xuất trực tiếp giữ nguyên. Một lượt AI bổ sung, chỉ khi còn thiếu chỉ tiêu,
  đề xuất công thức và các thành phần nguồn; không yêu cầu AI tính đáp số.
- Mỗi thành phần có nhãn, token số gốc, giá trị dạng chuỗi, trang, trích dẫn,
  kỳ đầu/cuối, cơ sở báo cáo, tiền tệ, hệ số đơn vị và dimension tiền/scalar.
- Python kiểm trích dẫn trong đúng trang OCR/native, ranh giới token và giá trị
  token chính xác. Số bịa hoặc nguồn không khớp không đi vào đề xuất.
- Biểu thức postfix chỉ gồm mã đầu vào và `+ - * /`, tối đa 31 token / 16 đầu vào.
  Không eval, mã chương trình, literal constants, chuỗi công thức tùy ý hoặc chain
  tham chiếu đến những số suy ra khác. Công thức phải có phép tính thật.
- Backend dùng Decimal phân số chính xác. Kiểm phạm vi/đơn vị, dimension, mẫu số,
  thành phần trùng/dùng lại, độ dài và độ chính xác. Số thập phân lặp bị giữ lại,
  không tự làm tròn để tạo fact tài chính.
- Công thức cần giả định, không hợp lệ hoặc đã có chỉ tiêu trực tiếp không được
  dùng để ghi đè dữ liệu. Kiểm tra số học không chứng minh bản chất kế toán đúng;
  bước rà soát phải kiểm tính đầy đủ, điều kiện áp dụng và việc đếm trùng.

## Lưu, truy vết và xác minh

Proposals nằm riêng trong receipt nhập BCTC và metadata của bộ số liệu; không giả
làm dòng số in trong tài liệu. Cả luồng intake tự động lẫn import PDF có rà soát
đều giữ metadata để hiển thị đề xuất. `calculation_prompt_version` ghi phiên bản
prompt bổ sung, độc lập với prompt trích xuất trực tiếp.

Áp dụng dùng mutation cập nhật FinancialSet hiện có: tenant ACL, idempotency,
case revision và lịch sử append-only. Source mới `kind=calculated` trỏ tới receipt,
calculation ID và PDF/hash gốc. Backend tính lại từ receipt bất biến, không tin
đáp số hoặc công thức bị sửa ở frontend; từ chối đổi giá trị/phạm vi hoặc lấy
receipt của hồ sơ khác. Bộ số liệu mới luôn unverified và xác nhận cũ hết hiệu lực.
Nguồn bị thay thế làm fact không còn current; snapshot và xác minh cũ cũng hết hạn.

Không cần migration: tận dụng receipt audit, metadata và payload nguồn hiện có.
Các hợp đồng mới là trường tùy chọn/source union bổ sung. Generators giữ phần mở rộng.

## Phạm vi và bằng chứng

- 9 ca Python: nguồn đúng/sai, token số không khớp hoặc cắt một phần, page sai,
  target không yêu cầu, lỗi AI optional không làm mất số đã trích xuất, proposal
  riêng biệt và tắt tính năng không tốn thêm lời gọi.
- 15 ca bộ tính: số vượt MAX_SAFE_INTEGER, bốn phép tính chính xác, scope/unit,
  dimension, dùng lại đầu vào, constants/code, chia 0, thập phân lặp, target đã có.
- PostgreSQL: proposal không tự thành fact; sửa giá trị/scope hoặc khác tenant
  bị từ chối; áp dụng tạo version mới và unverified; common review mới xác minh;
  method hiện tại dùng được số đã xác nhận (current ratio 50/25 = 2).
- Frontend: hiển thị công thức/nguồn/giả định, nút áp dụng khóa ban đầu và khi chưa
  đủ căn cứ, write projection giữ source kind/calculation ID.
- Đã gọi DeepSeek thật một lần trên OCR BCTC 2025 được ràng buộc SHA256 của lượt
  kiểm tra trước. Có 2 đề xuất: phép cộng vay ngắn/dài hạn cho nợ vay chịu lãi
  qua bộ tính; đề xuất lấy nguyên phải thu khách hàng bị chặn vì không có phép
  tính thật, không được coi là phải thu thuần. Không ghi chúng vào DB thật.
  Receipt local: `.reports/financial-calculations-2026-10-19/`.

Đây là smoke test luồng đề xuất, không phải xác nhận tính đúng nghiệp vụ của mọi
công thức. Hiện mỗi công thức dùng các trang cùng một tài liệu và phạm vi báo cáo;
chưa ghép nguồn từ nhiều PDF hay tự hoàn thiện toàn bộ N/A trong ZIP.

Kiểm tra cuối: toàn bộ AI **759 passed, 4 skipped**; backend MVP **231 passed**
trên PostgreSQL tạm; frontend **81 unit + 20 integration checks**, architecture và
typecheck đều qua. `pnpm dev:all --check` qua với DeepSeek và tính năng đã bật.
