# Sửa các lỗi UAT tài liệu và đánh giá doanh nghiệp

Ngày 19/10/2026. Người dùng đã duyệt sửa BUG-001, BUG-002, BUG-004, BUG-005 và BUG-006, đồng thời nghiệm thu lại BUG-003 đã sửa trong đợt kết quả giới hạn dữ liệu.

## Hành vi sau sửa

| Mã | Thay đổi |
|---|---|
| BUG-001 | Hàng đợi chỉ hiển thị trạng thái và thời gian từ lúc tải lên. Bỏ bước/phần trăm suy từ thời gian. Tổng số file xử lý vẫn dùng số file thực tế. |
| BUG-002 | Phân biệt không có dòng liên kết, có dòng có thể liên quan nhưng chưa nối, khác phạm vi và dự phòng chung chưa chứng minh phân bổ. Hiện trang/trích dẫn để đối chiếu. Đề xuất chưa xác định không còn được diễn đạt như số đã đối chiếu xong. |
| BUG-003 | Kết quả completed hiện hành nhưng không phát tổng điểm được trình bày khác với chưa chạy. Không hiển thị số hoặc band từ bản đánh giá hết hiệu lực. |
| BUG-004 | Nút hành động là Xác nhận rà soát tất cả hoặc Xác nhận lại; trạng thái Đã xác nhận được trình bày riêng. Đủ vi/en/zh. |
| BUG-005 | Trùng file theo hash được tách khỏi giao nhau về kỳ. Nguồn mới vẫn được trích xuất; kỳ mới được lưu, kỳ giao nhau được giữ dưới dạng ứng viên để đối chiếu và chọn nguồn theo từng kỳ. |
| BUG-006 | Form nạp cả dẫn chứng calculated và bảo toàn nguồn/công thức khi số, kỳ, cơ sở, chế độ kế toán, tiền tệ và đơn vị không đổi. Đổi ngành không tự chuyển số tính toán thành số đọc trực tiếp. |

## Đối chiếu nguồn theo từng kỳ

- Không dùng tên file làm bằng chứng về vai trò báo cáo. Vai trò cột hiện tại/so sánh chỉ được trình bày khi trích dẫn nhận diện có nhãn tương ứng; trường hợp khác ghi chưa xác định vai trò.
- Nhận diện kỳ dùng loại kỳ, ngày bắt đầu, ngày kết thúc và cơ sở báo cáo. Quý riêng và kỳ lũy kế kết thúc cùng ngày là các kỳ khác nhau.
- Các số của nguồn ứng viên được lưu trong biên nhận trích xuất và bản đối chiếu; chưa đi vào bộ dữ liệu đang dùng khi chưa chọn nguồn.
- UI hiển thị cả hai bộ số, tài liệu, vai trò cột, tiền tệ và đơn vị. Không chọn sẵn nguồn thắng.
- Chọn nguồn mới thêm một phiên bản cho đúng set của kỳ được chọn; giữ các kỳ khác và các tài liệu nguồn. Giữ nguồn đang dùng không viết lại số liệu của set đó.
- Lệnh quyết định mang revision hồ sơ, receipt ứng viên, set và revision set. Server kiểm tra tổ chức, hồ sơ, kỳ và phiên bản trong transaction. Không cho quyết định vào set khác hoặc phiên bản đã thay đổi.
- Sau chọn/giữ nguồn, cần xác nhận chung lại trước khi chấm điểm. Lịch sử và bản đánh giá cũ được bảo toàn.
- Hồ sơ bị phân loại trùng theo logic cũ có hành động Đối chiếu từng kỳ. Tài liệu đã chọn Giữ bản trước cũng có thể mở lại đối chiếu bằng hành động rõ ràng; không tự mở lại hoặc tự đổi lựa chọn cũ.
- Không backfill dữ liệu cũ; không migration mới. Contract quyết định mở rộng thêm hành động; kind/start_date trong statement summary là tùy chọn để đọc được dữ liệu cũ.

## Bảo toàn dẫn chứng và trạng thái đánh giá

- Rà soát lại giữ nguyên raw label, source receipt, calculation ID và dẫn chứng của giá trị calculated không thay đổi. Backend chỉ cho giữ nguồn khi nguồn/fact cũ khớp chính xác và phạm vi tài chính phù hợp; vẫn chạy toàn bộ kiểm tra biên nhận và phép tính sẵn có.
- Số tính toán không được âm thầm biến thành statement_entry khi đổi kỳ, đơn vị hoặc dẫn chứng. UI khóa chỉnh giá trị/trích dẫn tính toán và yêu cầu gỡ đề xuất hoặc giữ phạm vi phù hợp trước khi tiếp tục.
- Chẩn đoán mới có thể được diễn giải lại khi đọc bản ghi cũ, không cập nhật graph hay metadata đã niêm phong trong DB. Dấu vết dùng để kiểm tra assessment còn hiện hành tiếp tục dùng metadata đã lưu, nên thay lời diễn giải không làm assessment cũ hết hiệu lực.
- Các dòng nguồn tương tự chỉ là gợi ý đối chiếu. Không tự hợp nhất biến, phân bổ dự phòng chung, thay phải thu thuần bằng phải thu gộp hoặc gán chi phí khấu hao thiếu bằng 0.
- Công thức, trọng số, chính sách, tổng điểm chính thức và điều kiện phát band không thay đổi trong đợt sửa này.

## Kiểm thử tự động

- `pnpm api:build`: PASS.
- `pnpm build`: PASS, bao gồm TypeScript.
- `pnpm check:aic`: kiến trúc PASS; 91/91 unit frontend; 20/20 kiểm tra tích hợp frontend.
- Bộ PostgreSQL dùng cluster riêng, không DB người dùng: 75/75 ca gồm intake, HTTP boundary, suy luận, scorer, kết quả giới hạn dữ liệu, nhập tài chính và workflow giao dịch.
- Kiểm tra bổ sung sau siết nhận diện ngày bắt đầu và phục hồi lựa chọn cũ: 15/15 ca intake/period source PASS.
- Kiểm tra sau bảo toàn hash đánh giá khi thay lời diễn giải: 28/28 ca intake và MVP workflow PASS.
- Kiểm tra frontend cuối cho bảo toàn calculated và giao diện đối chiếu: 11/11 PASS.

Các ca tài chính dùng dữ liệu tổng hợp kỹ thuật, không dùng số liệu khách hàng trong source/test/document này. Ca đủ điểm cũ 73,7/F2 và 82,5/F2 giữ nguyên; dữ kiện thiếu vẫn không được gán thành tổng điểm chính thức.

## Nghiệm thu ứng dụng local

Bản build được nạp qua `pnpm local:serve`; launcher xác nhận migration hiện hành, không áp migration mới. Bằng chứng UI và chi tiết hồ sơ thật được giữ trong thư mục báo cáo riêng tư, không đưa vào tài liệu này.

Nghiệm thu trên Chrome sau bản build cuối: kết quả đánh giá cũ tiếp tục hiện đúng trạng thái đã đánh giá, không bị gán stale chỉ vì diễn giải mới; nút Xác nhận lại và trạng thái đã xác nhận được tách đúng; tài liệu đã Giữ bản trước có nút Đối chiếu từng kỳ. Lựa chọn nguồn thật được giữ nguyên. Không tải lại tài liệu, chọn nguồn thay thế hay tạo đánh giá tài chính mới trong lượt nghiệm thu cuối này.

Luồng chọn/giữ nguồn từng kỳ, tiến trình chạy lâu, chẩn đoán nguồn và bảo toàn calculated đã được kiểm tra bằng các ca tự động tổng hợp; không tuyên bố đã chạy lại toàn bộ các nhánh đó bằng dữ liệu thật trên Chrome. Tổng điểm thật vẫn chỉ phát khi đủ điều kiện. Tên file XLS lỗi dấu trên ảnh ban đầu chưa thuộc danh sách sửa đã duyệt; cần kiểm tra tên gốc/đường truyền trước khi kết luận nguyên nhân.
