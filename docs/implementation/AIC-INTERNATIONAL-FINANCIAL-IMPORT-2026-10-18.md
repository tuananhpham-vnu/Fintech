# BCTC Việt Nam / Mỹ / Trung Quốc — kết quả triển khai 18/10/2026

## Trạng thái và phạm vi

Đã triển khai luồng PDF tài chính riêng, hỗ trợ tiếng Việt, Anh và Trung, có kiểm tra nguồn, kỳ, cơ sở báo cáo, chuẩn kế toán, tiền tệ và hệ số đơn vị. Hệ thống đề xuất dữ kiện; người dùng đối chiếu nguồn và xác minh trước khi tính tỷ số. Đây chưa phải mô hình chấm điểm tín dụng hoặc xác suất vỡ nợ (PD) đã kiểm định cho ba quốc gia.

Luồng này giải quyết giới hạn của luồng tài liệu cũ: PDF tài chính dài được lập chỉ mục toàn bộ và người dùng chọn trang bảng báo cáo, thay vì đưa toàn bộ báo cáo vào bộ trích xuất tài liệu ngắn. Luồng PDF/ZIP cũ và trạng thái các tệp đã nạp được giữ nguyên; các tệp từng bị từ chối không tự biến thành dữ kiện thành công.

## Cách sử dụng trên demo

1. Mở hồ sơ của doanh nghiệp; kiểm tra quốc gia của đối tác.
2. Tại **Tài liệu**, chọn **Đọc BCTC Việt / Mỹ / Trung**; hoặc vào **Sức khỏe tài chính → Đọc PDF · Việt / Mỹ / Trung**.
3. Tải PDF gốc hoặc chọn PDF đã lưu, kể cả thành viên ZIP còn giữ bản gốc.
4. Chọn trang bảng cân đối, kết quả kinh doanh, lưu chuyển tiền tệ và thuyết minh cần thiết. Kiểm tra cả trang tiếp nối. Gợi ý trang chỉ là gợi ý.
5. Chọn quốc gia, hợp nhất/riêng lẻ và ngày kết thúc kỳ; chạy trích xuất.
6. Đối chiếu từng số với **PDF gốc**, kiểm tra dấu âm, cột năm, đơn vị và phạm vi. Chọn dữ kiện đúng, ngành và lý do rà soát; **Lưu dữ kiện chờ xác minh**.
7. Vào **Rà soát xác minh**, chỉ xác minh các dữ kiện thực sự đã kiểm tra. Các xác nhận về cầu nối thanh khoản/EBITDA cần bằng chứng riêng.
8. Xem **Tỷ số tài chính và dấu hiệu cần xem xét**. Trường thiếu vẫn trống; không thay bằng 0. Điểm chỉ được phát hành khi đáp ứng phương pháp và phạm vi được phê duyệt.

Giới hạn hiện tại: PDF tối đa **25.000.000 byte / 600 trang**, mỗi lần tối đa **16 trang được chọn**, trong đó không quá **8 trang cần OCR**. Excel phải xuất bảng sang PDF, giữ tiêu đề cột và đơn vị; chưa có bộ nhập XLS/XLSX hoặc XBRL tổng quát. PDF có mật khẩu/tệp nhúng và tài liệu vượt giới hạn bị từ chối có mã lỗi.

## Thay đổi có ý nghĩa với độ đúng

- Contract mới `AIC-FINANCIAL-IMPORT-1` độc lập với contract trích xuất cũ; không đổi checksum của canonical registry cũ.
- Mỗi đề xuất giữ số gốc, nhãn, trang gốc, trích dẫn, hash PDF, phạm vi và biên nhận bất biến. Mọi đề xuất AI mặc định **unverified**.
- Đọc số theo quy ước quốc gia; giữ âm, số thập phân và đơn vị. Không đổi ngoại tệ, quy năm, ghép năm hoặc tự tính một chỉ tiêu thiếu từ chỉ tiêu khác.
- Tránh các ánh xạ sai nghĩa: tiền mặt và tương đương tiền gộp không tự thành tiền mặt riêng; nợ dài hạn không tự thành toàn bộ nợ vay; vốn thuộc công ty mẹ không tự thành toàn bộ vốn hợp nhất; lợi nhuận hoạt động theo BCTC không tự được coi là EBIT xuyên quốc gia; phải thu gộp không tự thành phải thu thuần.
- Trích dẫn không tìm thấy trong nguồn bị loại. Có một bước thử sửa trích dẫn, vẫn phải qua toàn bộ kiểm tra và không được đổi giá trị ban đầu. Trang OCR lỗi được ghi riêng; không bỏ các trang đã đọc thành công.
- 7 tỷ số số học dùng Decimal chính xác, chỉ từ dữ kiện hiện hành đã xác minh. Mẫu số không dương bị giữ lại; dấu âm của tử số được bảo toàn. Kiểm tra chênh lệch bảng cân đối không tự sửa số hay bịa ngưỡng dung sai.
- Giữ nguyên các rào chắn phương pháp/ngành/nguồn. US/CN bị chặn phát điểm bằng `COUNTRY_METHOD_NOT_VALIDATED`; không dùng bộ trọng số pilot Việt Nam để khẳng định điểm tín dụng quốc tế.

## Kiểm chứng thực tế

Chạy với nhà cung cấp AI thật, tách biệt khỏi transport double trong integration test. Dữ liệu thử nằm trong bản phục hồi PostgreSQL riêng, không chèn tài khoản hoặc hồ sơ thử vào demo chính.

| Mẫu | Kết quả đã kiểm chứng |
| --- | --- |
| Việt Nam 2025, PDF scan từ ZIP người dùng cung cấp | HTTP thật trả 10 đề xuất; chọn 9 dữ kiện đã đối chiếu để kiểm thử lưu/xác minh; tính 6 tỷ số và giữ đúng dấu âm của dòng tiền kinh doanh. |
| Việt Nam 2024, cùng bộ tài liệu | Lấy được dữ kiện từ các trang đọc thành công; trang 4 và 8 bị nhà cung cấp OCR từ chối và được báo riêng. Không tuyên bố đã đọc đủ mọi trang. |
| Apple 2025, PDF 80 trang | Chrome chạy AI thật, lưu và xác minh 10 dữ kiện; 5 tỷ số đúng theo dữ liệu đã đối chiếu. Không tự tách dòng tiền và tương đương tiền gộp. Trang PDF gốc 34/80 hiển thị trong ứng dụng. |
| Costco 2024, PDF 76 trang | Chạy provider thật: 8 dữ kiện được chấp nhận sau kiểm tra nguồn; phân biệt tổng doanh thu với net sales riêng. |
| Haier 2025, PDF tiếng Trung 245 trang | HTTP thật cuối cùng trả 6 dữ kiện đạt kiểm tra; lưu/xác minh trên UAT và tính 3 tỷ số. Vốn, doanh thu và CFO chưa có đề xuất đạt điều kiện nguồn ở lần chạy này, nên giữ thiếu. |

Số trường đề xuất có thể thay đổi giữa các lần gọi AI. Những kết quả này là kiểm chứng trên các mẫu nêu trên, không phải chứng nhận độ chính xác cho mọi biểu mẫu, ngành, báo cáo ngân hàng/bảo hiểm hoặc mọi bản scan.

Tài liệu công khai dùng để đối chiếu: [Apple 2025 Form 10-K](https://s2.q4cdn.com/470004039/files/doc_financials/2025/ar/_10-K-2025-As-Filed.pdf), [Costco 2024 Annual Report](https://s201.q4cdn.com/287523651/files/doc_financials/2024/ar/COST-2024-Annual-Report.pdf), [Haier 2025 Annual Report trên CNINFO](https://dataclouds.cninfo.com.cn/shgonggao/hsomarket/2026/20260326/d7e721dc96a94bc4ac85794b0d818fe2.PDF).

Ảnh UAT: [tỷ số từ dữ kiện Mỹ đã xác minh](../acceptance/artifacts/international-20261018/us-verified-ratios.jpg), [trình xem PDF gốc](../acceptance/artifacts/international-20261018/us-original-page.jpg). Các ảnh chỉ chứa tài khoản thử tổng hợp và báo cáo Mỹ công khai.

## Kiểm tra kỹ thuật cuối

- Python: **641 passed, 4 skipped**; có một cảnh báo deprecation của thư viện test.
- Web: production build thành công; kiến trúc 122 runtime files / 11 modules; **72 unit tests và 20 integration checks** đạt.
- API: build thành công; **22 regression tests** đạt; **2 integration tests** PostgreSQL tách biệt đạt, gồm ACL khác tổ chức, replay/idempotency, bất biến nguồn, không sửa giá trị giữ provenance AI, xác nhận rà soát, xác minh và stale khi đổi đối tác.
- Integration double chỉ kiểm chứng giao thức và quyền; các mẫu live ở trên kiểm chứng việc đọc tài liệu bằng provider thật.
- Migration `0021_financial_import_sources.sql` chỉ bổ sung bảng nguồn và ràng buộc bất biến. Đã thử trên bản phục hồi từ bản sao lưu hiện tại, giữ nguyên hash mọi bảng nghiệp vụ đã có và chặn UPDATE/DELETE/TRUNCATE.

## Giới hạn phải giữ khi giới thiệu sản phẩm

Có thể demo **nhập PDF đa quốc gia → dữ kiện có nguồn → rà soát/xác minh → tỷ số và dấu hiệu tài chính**. Chưa thể khẳng định “nạp mọi báo cáo và chấm chính xác điểm tín dụng”. Điểm/PD cần tập dữ liệu kết quả tín dụng, định nghĩa default, hiệu chỉnh theo quốc gia/ngành, kiểm định ngoài mẫu và chủ sở hữu phương pháp phê duyệt. BCTC đơn lẻ cũng chưa đủ để kết luận rủi ro tín dụng toàn diện.

Để mở rộng tiếp: thêm bảng mapping được chuyên gia kế toán duyệt; bộ mẫu có đáp án cho từng nước/ngành/định dạng; đo độ đúng từng trường và tỷ lệ phải rà soát; sau đó tích hợp dữ liệu cấu trúc XBRL/iXBRL và Excel. Không hạ kiểm tra nguồn để tăng số trường trích xuất.

## Triển khai demo chính

Đã áp dụng riêng migration `0021_financial_import_sources.sql`: **21 migration**, hash dữ liệu nghiệp vụ cũ trước/sau giữ nguyên. Bảng nguồn mới trên demo chính còn **0 dòng** sau triển khai; không sao chép tài khoản hoặc bộ dữ liệu UAT sang demo chính.

Đã khởi động lại với cấu hình vận hành hiện có. Kiểm tra `http://127.0.0.1:3000/login`, API readiness trên 3001 và AI health trên 8100 đều HTTP 200. Phiên Chrome trước đó đã hết hạn; cần đăng nhập lại bằng tài khoản của người dùng. Không đọc mật khẩu hoặc thay chính sách phiên đăng nhập để vượt bước này.

Bản sao lưu mã hóa và biên bản hash được giữ trong thư mục vận hành riêng; không đưa dữ liệu tài chính riêng tư, mật khẩu hoặc khóa API vào Git. Hồ sơ đã nạp vẫn giữ lịch sử tiếp nhận cũ; sử dụng nút đọc BCTC mới để thực hiện lượt trích xuất tài chính có chọn trang.
