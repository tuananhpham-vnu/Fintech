# Triển khai BCTC Mỹ và Trung Quốc — 19/10/2026

Đã triển khai trong mã nguồn theo kế hoạch được chủ sản phẩm duyệt. Chưa nghiệm thu luồng trình duyệt với AI thật: công cụ trả về “Local browser use is disabled in Work settings”; đã đề nghị người dùng bật quyền. Không dùng công cụ khác để vượt giới hạn này.

## Phạm vi đã triển khai

- Profile riêng US GAAP và ASBE/CAS cho doanh nghiệp thương mại/phân phối trong pilot, policy riêng với phiên bản và hash phương pháp. Không cấu hình policy thì quốc gia mới vẫn bị chặn.
- Country của doanh nghiệp được truyền xuyên suốt intake, kiểm tra chứng từ và tính điểm. Tên doanh nghiệp khác bị từ chối trước khi ghi dữ liệu vào bộ báo cáo.
- Hỗ trợ năm tài chính lệch năm dương lịch, năm 52/53 tuần; vẫn loại kỳ ngắn không đủ điều kiện tổng hợp năm.
- Chấp nhận nguồn tiền và tương đương tiền gộp có xác minh; không cộng trùng với hai trường tiền tách riêng. Bộ trường VN vẫn là 14 trường; US/CN có thêm trường gộp thứ 15.
- Bảo toàn dấu, đơn vị và nguồn. Chỉ cho phép dung sai cân đối khi có bằng chứng làm tròn rõ ràng. Không tự chuyển tỷ giá hoặc thay đổi hệ số đơn vị để làm số liệu khớp.
- CAS: không coi trực tiếp 营业利润 là lợi nhuận hoạt động theo phương pháp; cần cầu nối có chứng cứ và xác nhận. Những chỉ tiêu khác vẫn có thể xuất điểm thành phần.
- Bình quân điểm từng chỉ tiêu qua các năm hợp lệ, sau đó áp dụng trọng số hiện có một lần. Dữ liệu thiếu giữ N/A, không điền 0 hoặc phân bổ lại trọng số. Nhiều file cùng một kỳ không tạo thêm lượt đóng góp.
- Chọn cơ sở riêng lẻ/hợp nhất khi có nhiều cơ sở. Cache AI phân vùng theo tổ chức; không tái sử dụng cache giữa khách hàng.
- UI và decoder nhận profile, niên độ và trường mới; hiển thị giới hạn của điểm thử nghiệm và khác biệt CFO giữa chuẩn kế toán. PD vẫn null.

## Ngân sách AI

Đã thêm sổ SQLite giữ trước chi phí tối đa cho từng HTTP attempt. Retry, OCR sử dụng provider và repair đi qua provider được tính ngân sách. Usage hợp lệ cho phép điều chỉnh phần đã giữ; lỗi hoặc usage không rõ giữ nguyên phần dự phòng. Cấu hình sai provider/model/endpoint hoặc thay đổi ngân sách của sổ hiện có bị từ chối.

Cấu hình cục bộ đã đặt trần 2 USD và policy pilot trong các file bị Git bỏ qua. Giá dự phòng dùng mức không cache: input 0,30 USD / triệu token, output 1,20 USD / triệu token, kiểm tra ngày 19/10/2026 từ [bảng giá DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/). Đây là dự phòng bảo thủ, không phải hóa đơn thực tế. Tối đa 6 lần xử lý tài liệu mới được theo dõi trong kịch bản UAT, chưa có bộ đếm tự động giới hạn số hồ sơ.

Chưa phát sinh request DeepSeek do đợt triển khai này. Cấu hình mới cần được nạp vào tiến trình khi khởi động lại. Chưa khởi động lại stack đang phục vụ: phát hiện có intake đang chạy trong cơ sở dữ liệu thật, cần tránh gián đoạn tác vụ đó.

## Bộ báo cáo demo

Đã lưu dưới `C:/Users/52duc/Desktop/DATA TEST FINTECH`:

| Folder | Báo cáo |
|---|---|
| `Mỹ` | TD SYNNEX FY2024 và FY2025, US GAAP |
| `Trung Quốc` | Digital China Group FY2024 và hai bản công bố FY2025 ngày 31/03/2026, 13/06/2026 |

Hai bản FY2025 Trung Quốc dùng thử xử lý nguồn cùng kỳ, không phải hai năm khác nhau. Mỗi nước có hướng dẫn nguồn và thông tin kiểm chứng PDF. Manifest `BCTC_DEMO_US_CN_SOURCES.json` tại folder gốc ghi URL, kích thước và SHA-256. Báo cáo FY2024 Trung Quốc lấy từ bản PDF công bố của doanh nghiệp trên mirror Eastmoney; các nguồn khác từ website nhà đầu tư TD SYNNEX và CNINFO. Đã kiểm tra đúng tên pháp nhân, năm báo cáo, số trang và khả năng đọc PDF.

## Kiểm chứng đã hoàn tất

| Nhóm | Kết quả |
|---|---|
| Scorer, profile, niên độ, tổng hợp, điểm thiếu dữ liệu | 50 test đạt |
| Tích hợp intake/import/trends trên PostgreSQL tạm, gồm US/CN 15 trường, sai doanh nghiệp, nguồn trùng và policy tắt | 24 test đạt |
| AI semantics, kỳ, đơn vị, checkpoint/cache, provider và ngân sách | 153 test đạt; 1 cảnh báo deprecation Starlette |
| Frontend check:aic | Đạt: 101 unit test và 20 kiểm tra tích hợp, kiểm tra kiến trúc |
| Build API và frontend production | Đạt |
| Đối chiếu các bản ghi VN trước/sau triển khai | 28 phiên bản bộ báo cáo, 269 dòng số liệu, 21 kết quả đánh giá cũ giữ nguyên tại thời điểm kiểm tra |

Test tích hợp dùng AI transport giả lập và cơ sở dữ liệu tạm, không gọi DeepSeek. Có đối chiếu số học độc lập bằng số gốc từ PDF công khai cho các chỉ tiêu có đủ dữ liệu; đây không phải kết quả trích xuất AI hay nghiệm thu UI.

Bằng chứng và log nằm trong `.reports/international-us-cn/20261019/`, được Git bỏ qua; có thể chứa thông tin môi trường cục bộ, không phát hành toàn bộ thư mục.

## Các bước còn lại trước nghiệm thu

1. Người dùng bật local browser use trong Work settings. Xác nhận tác vụ thật đã kết thúc trước khi nạp lại stack với policy/budget mới.
2. UAT qua UI với doanh nghiệp demo đúng pháp nhân: một báo cáo, nhiều năm, nguồn cùng kỳ, báo cáo sai doanh nghiệp. Giới hạn tối đa 6 lần xử lý tài liệu mới và 2 USD.
3. Rà soát số liệu thực tế theo nguồn, dấu, đơn vị, cơ sở hợp nhất/riêng lẻ; kiểm tra điểm thành phần và bình quân từng năm trên UI. Ghi lại chi phí và bằng chứng.

Tính điểm thử nghiệm không thay thế hiệu chỉnh mô hình tín dụng theo thị trường. SEC/XBRL tự động, ngành tài chính, IFRS/HKFRS và chuẩn SME Trung Quốc chưa thuộc đợt triển khai này.
