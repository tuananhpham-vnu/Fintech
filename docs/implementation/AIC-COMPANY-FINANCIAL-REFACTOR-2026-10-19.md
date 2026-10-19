# Refactor MVP BCTC theo Chốt nghiệp vụ

Nguồn nghiệp vụ: tab [Chốt nghiệp vụ](https://docs.google.com/document/d/1b51lfa8d8Gc32Wk3R6IPJszOgbLw1l6Do3Fa6BehgKU/edit?tab=t.l3perosvwfpe), cùng hai điều chỉnh trực tiếp của chủ dự án: giữ method hiện tại và xác nhận chung thay xác minh từng số liệu.

## Bổ sung sau khi đối chiếu toàn bộ ảnh/note và chat “Clarify what worker means”

- Chuẩn hóa ngày đầu kỳ từ nhãn năm/tháng/quý có bằng chứng trong nội dung. Quý II riêng là tháng 4–6, lũy kế 6 tháng là tháng 1–6; nhãn nhập nhằng hoặc niên độ khác không bị tự đoán. Worker vẫn gọi trích xuất nếu bước nhận diện chưa có ngày đầu kỳ; không bỏ qua cả BCTC chỉ vì trường đó null.
- Lưu bản xem và kết quả rỗng để người dùng có thể rà soát kỳ, chế độ kế toán, tiền tệ/đơn vị và bổ sung 14 đầu vào với trang/trích dẫn. Receipt của người rà soát có audit riêng, không giả làm kết quả AI. Có thể thực hiện từ hàng đợi hoặc thư viện sau khi đã xác nhận.
- Chặn xác nhận chung khi còn kỳ chưa giải quyết, file lỗi hoặc bản trùng chưa quyết định. File ngoài phạm vi BCTC ra khỏi hàng đợi nhưng vẫn tính là đã xử lý trong tiến trình. Loại một file chưa đóng góp số liệu cần lý do và giữ bản gốc/lịch sử.
- Bản thay thế chưa đọc đủ không tự ghi đè một nửa dữ liệu cũ. Có thể thử lại hoặc rà soát từng kỳ; giữ nguyên ID bộ số liệu và lịch sử phiên bản. Chỉ đánh dấu toàn bộ file cũ đã thay khi mọi kỳ mà file đó đang hỗ trợ đã được thay.
- Giữ nội dung và bản nháp khi polling cập nhật; lỗi tạm có retry giãn dần và không dừng polling sau 5 phút ở luồng intake. Khi lưu, dùng revision tại lúc mở form để báo xung đột thay vì ghi đè dữ liệu vừa thay đổi.
- PDF xem theo cuộn liên tục, render trang gần vùng nhìn. Xác nhận chung nằm cạnh nút tải; kết quả mặc định kỳ mới nhất, hai cơ sở báo cáo cùng kỳ mới cần lựa chọn. Thư viện/tổng quan có tên file và cảnh báo thiếu phạm vi đọc; bảng nhiều kỳ có màu phân biệt giá trị/rà soát/N/A.
- Ràng buộc phạm vi ngành với doanh nghiệp hiện tại, không cho tự gán pilot khác ngành. Có mã lỗi kỳ và request ID/status an toàn để truy nguyên lỗi provider, không lưu response chứa tài liệu hay API key.

Các thay đổi này không cần migration bổ sung sau 0022. Chưa xử lý lại BCTC riêng tư hoặc tự retry các intake cũ. Khởi động bằng `pnpm dev:all`, rồi chọn **Thử lại** hoặc **Rà soát kỳ / bổ sung số liệu** cho file đang kẹt.

Kiểm tra cuối lượt sửa: 211 test API trên PostgreSQL tạm, 701 Python (4 skipped), 77 frontend unit, 20 integration, lint/kiến trúc và production build đều qua. `pnpm dev:all --check` qua với cấu hình DeepSeek hiện tại, không gọi provider. Lượt kiểm tra trực quan mới chưa hoàn thành: bộ duyệt tự động chặn lệnh bật web test, chỉ trả `blocked by policy`; DB/API tổng hợp đã được dừng. Bằng chứng Chrome ở phần sau thuộc lượt triển khai trước.

## Luồng đã triển khai

1. Tạo hồ sơ doanh nghiệp, mục đích không bắt buộc. Form đối tác còn tên, quốc gia, MST, ngành; bỏ lời khai và lý do lưu.
2. Một vùng tải PDF/XLS/XLSX/JPG/PNG/ZIP, không chọn loại tài liệu, năm hay chế độ tải mới/thay thế thủ công. Việt Nam bật, Mỹ/Trung Quốc bị vô hiệu hóa.
3. Worker giữ file gốc, tạo bản xem khi cần, nhận diện kỳ từ nội dung, trích xuất số liệu theo từng kỳ. Thất bại, thiếu dữ liệu và hoàn thành được thể hiện riêng.
4. File trùng hoặc cùng kỳ/cơ sở báo cáo yêu cầu giữ/thay. Thay thế tạo phiên bản số liệu mới; không xóa phiên bản cũ. Tài liệu từ luồng cũ có thể đưa vào luồng mới tại thư viện.
5. Bảng rà soát gồm 14 đầu vào cần cho 7 chỉ tiêu. Có thể sửa giá trị đã trích xuất hoặc bổ sung giá trị AI chưa đọc được, gắn trang, trích dẫn, lý do và file gốc. Không tự thay số thiếu bằng 0.
6. Một xác nhận chung lưu người thao tác và ảnh chụp nguồn/phiên bản; tự hết hiệu lực khi có thay đổi. Không còn bước xác minh từng số liệu trong hồ sơ doanh nghiệp.
7. Mặc định chọn kỳ mới nhất khi không có nhiều cơ sở/phiên bản gây nhập nhằng. Tổng điểm, radar, ghi chú thành phần, điểm mạnh/trái và điểm yếu/phải, bảng 7 chỉ tiêu/hàng và kỳ báo cáo/cột.

API tạo giao dịch mới trả 410 và proxy không mở route đó. Lịch sử và việc đọc hồ sơ cũ vẫn có. Các luồng lịch sử không bị xóa khỏi cơ sở dữ liệu.

## Method

Giữ nguyên `fhi-method.ts`, `fhi-scorer.ts`, công thức, trọng số, ngưỡng, band và kiểm tra Decimal. Chính sách method và giới hạn phạm vi đang có vẫn áp dụng. Không tạo thêm thang điểm cho bốn ngành, không tính bình quân nhiều năm và không suy ra PD.

## Cập nhật môi trường

Migration mới: `apps/api/migrations/0022_company_financial_intake.sql`.
Migration thêm bảng intake/xác nhận chung và cho phép lý do đối tác là null; không xóa/chuyển đổi hàng dữ liệu cũ. Trên môi trường local đã cài Node dependencies, có `.venv`, PostgreSQL và root `.env`, chỉ cần:

```powershell
pnpm dev:all
```

Launcher kiểm tra/cài dependency AI còn thiếu, build API, kiểm tra checksum lịch sử migration, sao lưu DB trước migration còn thiếu và cập nhật quyền runtime theo `scripts/sandbox-runtime-grants.sql`. Sao lưu dùng `pg_dump`/`pg_restore` từ `AIC_POSTGRES_BIN` (Windows mặc định PostgreSQL 18), nằm trong thư mục Temp riêng tư và được in đường dẫn trong terminal. Sao lưu thất bại thì không bắt đầu migration. API vẫn chỉ kiểm tra schema khi tự khởi động; production dùng migration runner tường minh.

`DATABASE_URL` cần là kết nối owner của DB local; các URL API/worker phải cùng host/cổng/tên DB, không có query options. Launcher từ chối đích ngoài loopback hoặc `NODE_ENV=production`. Nó chờ AI/API sẵn sàng rồi bật cả ba worker và web; không chạy đồng thời hai launcher trên cùng cổng. Muốn web đã build: `pnpm build` rồi `pnpm local:serve`.

## Bằng chứng kiểm tra

| Kiểm tra | Kết quả |
| --- | --- |
| `pnpm api:test:mvp` | 211 passed, DB PostgreSQL tạm riêng |
| Pytest từ `services/ai`, `AI_LOAD_DOTENV=0` | 701 passed, 4 skipped |
| Frontend unit | 77 passed |
| Frontend integration contract checks | 20 passed |
| `pnpm --dir apps/web lint` | Passed: kiến trúc và định dạng |
| API build, web production build, TypeScript | Passed |
| Foundation schema/examples/checksum tests | 3 passed |
| `pnpm dev:all:test` (chuẩn bị local, DB tạm) | 5 passed: cấu hình/đường dẫn giữa terminal, chẩn đoán an toàn, chặn sai đích, backup/migration, bảo toàn dữ liệu/quyền, chạy lại, checksum sai |
| `pnpm dev:all` với cấu hình local hiện tại | Web/API/AI HTTP 200; ba worker hoạt động |


Đã kiểm thử API trên PostgreSQL tách biệt: tự tách năm, không phát điểm trước xác nhận, xác nhận chung cho toàn bộ facts/bridges, chấm điểm bằng method cũ, thay thế không tạo thêm kỳ đang hoạt động, sửa số liệu làm xác nhận cũ hết hiệu lực, phân quyền tenant/case và dữ liệu nguồn bất biến.

Lượt triển khai trước đã kiểm tra Chrome thật với API/PostgreSQL thật và AI transport double được ghi rõ là SYNTHETIC: tổng điểm 91.1/AIC-F1; xác nhận, phát điểm, sửa rồi rà soát/chấm lại và mở PDF nguồn. Ảnh kiểm tra lưu ở `.reports/financial-refactor-browser.png`. Không dùng ảnh này làm bằng chứng cho giao diện mới của lượt sửa bổ sung.

Đã gọi AI provider thật với PDF tổng hợp, không dùng BCTC riêng tư: nhận diện đúng hai kỳ 2024/2025; trích xuất 13/14 đầu vào, giữ một đầu vào chưa nhận diện là thiếu thay vì tự điền 0. Đây là smoke test, không phải chứng nhận độ chính xác trên toàn bộ BCTC thực tế.

PDF dài/scan vẫn có giới hạn tài nguyên: tối đa 16 trang trích xuất và 8 trang OCR mỗi kỳ; phát hiện quá phạm vi sẽ để cảnh báo/rà soát, không tuyên bố đã đọc toàn bộ. Bảng so sánh giữ điều kiện tương thích theo logic hiện tại. File Excel không có cached formula value hiển thị N/A và cần rà soát nguồn.

Các kiểm thử nghiệp vụ và bản xem trước ban đầu dùng DB tạm. Trong lượt sửa khởi chạy một lệnh, đã dùng `pnpm dev:all` trên DB local `aic_mvp_demo`: tạo/kiểm tra bản sao lưu trước khi áp 0022, đủ 22 migration; số lượng hồ sơ (4), assessment (10), bộ số liệu (2) giữ nguyên, intake mới bằng 0. Sao lưu lượt này: `C:/Users/52duc/AppData/Local/Temp/aic-dev-backup-fIOe0a/before-migration.dump` (126451055 byte), ACL chỉ cho người dùng hiện tại, SYSTEM và Administrators. Không xử lý lại tài liệu cũ, commit/push hoặc triển khai môi trường ngoài.

## Sửa lỗi khởi chạy từ PowerShell ngoài Codex

Chủ dự án gặp API dừng trước khi Nest khởi tạo, trong khi chạy bên trong Codex thành công. Chẩn đoán `pnpm dev:all --check` xác nhận `CONFIG_FILE_MISSING`. Đường dẫn policy cũ dưới `AppData/Local/AIC` thực tế được Windows chuyển hướng sang `AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/AIC`; PowerShell ngoài ứng dụng không nhìn thấy cùng file ở đường dẫn cũ.

Đã sao chép nguyên byte bản policy đang được duyệt tới `data/local/approved-fhi-policy.json`, đặt ACL riêng tư và cập nhật root `.env` dùng đường dẫn tương đối này. SHA-256 trước/sau: `87a0fbe031c9530de0744547428a2444609dc7b16d46c0adeab41d6d5afbaf98`. Không tạo/phê duyệt policy mới hoặc đổi method/phạm vi tổ chức. Cả `.env` và bản policy đều bị Git ignore.

Launcher ưu tiên cấu hình có trong root `.env` trước biến terminal trùng tên, chuẩn hóa đường dẫn từ gốc repo và kiểm tra cấu hình trước khi migration/bật dịch vụ. API ghi mã chẩn đoán cố định thay thông báo lỗi chung, không in URL DB, mật khẩu hoặc nội dung lỗi gốc. `--check` không bật dịch vụ hay sửa DB. Đã kiểm thử cấu hình terminal cũ/đường dẫn tương đối, tên biến khác chữ hoa trên Windows và giữ kín dữ liệu trong chẩn đoán; 5 kiểm thử startup đều qua. Chủ dự án xác nhận `pnpm dev:all` đã chạy thông trong đúng PowerShell từng báo lỗi.
