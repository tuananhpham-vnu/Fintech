# sme_rules/domain

Logic nghiệp vụ dùng chung cho các rule. Đặt ở đây để không lặp code và để mỗi phần có thể test riêng.

| File | Trách nhiệm | Dùng bởi |
|---|---|---|
| `normalize.py` | MST (giữ số 0 đầu, tách mã chi nhánh), tên (viết tắt, hoa/thường), số tham chiếu (`HĐ 01` → `HD01`), ngày ISO | Mọi rule |
| `money.py` | `Decimal`, quy đổi theo `multiplier`, đơn vị làm tròn từ số chữ số thập phân hiển thị; từ chối float | R05, R07, R09 |
| `views.py` | `CaseView` / `DocView`: lọc tài liệu theo trạng thái; `value()` trả `None` cho trường đọc chưa chắc | Mọi rule |
| `integrity.py` | Kiểm tra fact: thuộc snapshot, đúng loại tài liệu, evidence đúng version, không trùng trường | runner |
| `identity.py` | Xác định doanh nghiệp vay và vai trò các bên; phân loại khớp (`TAX_EXACT`, `TAX_MISMATCH`, `TAX_BRANCH`, …) | R02, R03, R09, R10 |
| `linking.py` | Nối hóa đơn, biên bản và chứng từ với hợp đồng: chỉ qua số tham chiếu khớp hoặc liên kết reviewer đã xác nhận | R07, R08, R09, R10 |
| `financials.py` | Cơ sở so sánh BCTC (kỳ, phạm vi, đơn vị, tiền tệ), dùng chung cho R04 và R05 | R04, R05 |
| `transactions.py` | Khoản thu khai báo, điều khoản thanh toán, khóa định danh hóa đơn | R06, R07, R08, R09 |

Nguyên tắc:

- Không suy diễn. Thiếu hoặc mơ hồ thì trả `None`, để rule quyết định `unknown`.
- Tên gần giống chỉ tạo ứng viên (`NAME_CANDIDATE`), không bao giờ tự hợp nhất pháp nhân.
- Số tham chiếu chỉ bỏ khoảng trắng và đổi Đ → D, giữ dấu `/` và `-` để tránh ghép nhầm hợp đồng.
