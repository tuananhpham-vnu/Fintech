# Mot APIs — cấu hình và kiểm tra ngày 19/10/2026

**Trạng thái sau thử nghiệm:** theo yêu cầu tiếp theo của chủ sản phẩm, cấu hình đang dùng đã được khôi phục về API DeepSeek chính thức (`https://api.deepseek.com`), model `deepseek-flash`. Mot APIs không còn là provider đang hoạt động. Các phần dưới ghi lại đợt thử nghiệm trước khi khôi phục.

Theo yêu cầu của chủ sản phẩm, ứng dụng cục bộ đã chuyển AI provider sang `motapis`, endpoint `https://motapis.com/v1`, model `gpt-6-luna`, OCR qua provider bật sau khi thử ảnh. Gateway trả tên model `openai/gpt-6-luna` trong một số phản hồi; đây là định danh do gateway báo, không phải xác minh độc lập upstream.

Key chỉ lưu trong `.env` bị Git bỏ qua. Launcher chỉ truyền key của provider được chọn cho AI service. Không đổi cấu hình Codex hay các công cụ ngoài ứng dụng Fintech.

## Kiểm tra thực tế

- `GET /v1/models`: HTTP 200, tài khoản có model `gpt-6-luna`.
- JSON nhỏ: đúng chuỗi số `1234.50`, một attempt của adapter.
- Ảnh giả lập: giữ đúng `123,456.78` và `(9,876.50)`.
- Pipeline trích xuất PDF giả lập có tiêu đề cột năm rõ ràng: tổng tài sản in `77,099` → value `77099`, multiplier `1000000`, trang 1, chưa xác minh; không có fact bị loại. Không đưa dữ liệu khách hàng vào các phép thử này.
- Đã khởi động lại stack khi số job queued/running bằng 0; startup xác nhận provider/model mới, cả AI/API/Web lên lại.
- Endpoint của AI service đang chạy `/internal/v2/financial-discovery` trả HTTP 200, `X-AI-Mode: live`, model `gpt-6-luna`; nhận đúng doanh nghiệp giả lập và FY 01/01–31/12/2025 (17,62 giây). Đây là request đi qua service thực tế sau khi đổi cấu hình, không phải transport giả lập.

Không kết luận mọi BCTC đã ổn định. Có request chậm gần một phút và timeout trong các phép thử. Đầu ra vẫn phải qua kiểm tra nguồn, nhãn, kỳ, đơn vị và người rà soát. Điểm tín dụng được tính bằng code của ứng dụng, không giao model tự gán điểm.

`deepseek-v4-flash` trên cùng gateway đã thử nhưng không chọn làm cấu hình cuối: trả được JSON đơn giản, đọc sai ảnh thử và có đầu ra tài chính không đạt contract. PDF thử ban đầu không có tiêu đề cho hai cột số nên chưa đủ rõ để nghiệm thu việc chọn năm; bản thử có nhãn năm rõ ràng được dùng cho xác nhận cuối.

## Thay đổi kỹ thuật

- Adapter Mot APIs dùng transport Chat Completions hiện có, key riêng, vision opt-in, không redirect hoặc fallback sang nhà cung cấp khác khi lỗi. Cache OCR/quan sát của Mot APIs có identity chứa provider và endpoint.
- Health/config/launcher/diagnostic nhận provider mới. Không log key, prompt hoặc nội dung lỗi upstream trong luồng sản phẩm.
- Prompt BCTC yêu cầu hệ số đơn vị dạng số; lượt sửa schema hiện có nhận đường dẫn trường và tên constraint bị vi phạm. Không tăng số lượt sửa, không đổi số nguồn hoặc nới schema.
- Test kiểm tra app không nhập database client chạy ở interpreter riêng, tránh ảnh hưởng từ các test chủ động nhập SQLite để kiểm chứng sổ ngân sách riêng.

201 test Python và 5 test launcher liên quan đạt. Có một cảnh báo deprecation Starlette hiện có.

## Ngân sách

Sổ DeepSeek cũ được giữ nguyên (0,262566 USD đã dùng/giữ tại thời điểm chuyển). Sổ thử DeepSeek qua Mot APIs cũng giữ nguyên. Sổ `gpt-6-luna` dùng thư mục riêng qua `AI_SPEND_LEDGER_DIR`, trần 1,69 USD; chi phí thử chính model này đã nằm trong sổ đó. Tổng trần các khoản còn lại vẫn dưới mức 2 USD được duyệt trước đó.

Giá dự phòng lấy từ [catalog công khai Mot APIs](https://motapis.com/models.js?v=20260720b): `gpt-6-luna` input 0,10 USD và output 0,50 USD / triệu token, kiểm tra ngày 19/10/2026. Sổ giữ chi phí dự phòng cho request timeout/usage không rõ; số này không phải hóa đơn thực thu của gateway.

Log riêng trong `.reports/motapis/20261019/` bị Git bỏ qua. Không công khai toàn bộ thư mục vì có bản sao cấu hình cục bộ. Không xóa sổ ngân sách để chạy thêm thử nghiệm.

Tài liệu giao thức: [Mot APIs](https://motapis.com/docs).
