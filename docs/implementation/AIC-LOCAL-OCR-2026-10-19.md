# Triển khai OCR local và nhận diện kỳ BCTC — 19/10/2026

## Phạm vi

Tích hợp chọn lọc sửa lỗi Unicode PDF (`9f1b165`) và hướng OCR Docling
(`e2f0faf`) đã có trên GitHub. Không merge toàn bộ nhánh vì cấu hình provider và
nghiệp vụ trong workspace hiện tại đã thay đổi độc lập.

Gemini `gemini-3.1-flash-lite` tiếp tục nhận diện ngữ nghĩa, kỳ và đề xuất số liệu.
Docling 2.140.0 + EasyOCR `vi,en` + TableFormer accurate đọc chữ/bảng tại máy.
Root `.env` chọn `OCR_ENGINE=docling`; không cần API key OCR mới.

## Thay đổi

- Kiểm glyph không ánh xạ Unicode thay vì chỉ nhìn chuỗi ký tự trông có vẻ hợp lệ.
  BCTC 2025 bị lỗi lớp chữ ở cả 8 trang nên được chuyển sang OCR.
- Runtime OCR riêng, model tải một lần; tiến trình giữ model giữa các trang,
  chạy CPU và không nhận key Gemini/internal hoặc URL database.
- Giữ các ô bảng và sắp mảnh chữ theo vị trí gốc; không tự sửa hoặc tạo số.
- Tăng độ nét OCR và giữ kết quả confidence từ 0.3 cho rà soát. Thử nghiệm thực
  cho thấy scale 1 bỏ nhãn tổng tài sản; ngưỡng 0.5 bỏ một tổng tiền đọc đúng
  có confidence 0.423. Mọi số liệu vẫn là `unverified`.
- Nhận kỳ so sánh từ “Năm trước” + tiêu đề năm cùng báo cáo kết quả/lưu chuyển
  tiền khi niên độ dương lịch có căn cứ. Không suy ra năm trước từ số dư đầu kỳ.
- Loại ngày lập/ký khỏi căn cứ kỳ; hợp nhất kỳ trùng. Chẩn đoán chứa kỳ, trang,
  mã lý do và mức độ; chỉ vấn đề chưa giải quyết mới chặn xác nhận chung.
- Cho phép một lần model trích lại toàn bộ nếu chọn nhầm cột năm. Không đổi
  năm trên số tiền của lần trả lời cũ.
- Giữ kiểm tra quote, ngữ nghĩa, số, nguồn, xác nhận chung và phương pháp chấm
  điểm hiện tại. Không tự bổ sung số 0, xác minh hoặc phát điểm.

## Vận hành

Trên máy này đã cài runtime và tải model. Máy mới chạy `pnpm ai:ocr:setup` một
lần; sau đó vẫn khởi động bằng `pnpm dev:all`.

`pnpm dev:all --check` kiểm tra cấu hình/provider và model local, không gọi API
AI hay OCR tài liệu. Discovery/import có budget 600 giây; worker chờ 615 giây
và gia hạn lease trước mỗi kỳ. OCR CPU có thể mất vài phút cho tài liệu 8 trang.

Hướng dẫn cấu hình: `services/ai/docs/local-ocr.md`.

## Kiểm thử tự động

- AI: **750 passed, 4 skipped**.
- API build: thành công.
- Toàn bộ `pnpm api:test:mvp`: **215 passed** trên PostgreSQL test riêng; có kiểm
  kỳ so sánh chưa giải quyết chặn xác nhận và rà soát đúng kỳ mới gỡ chặn,
  retry giữ liên kết cũ, cùng timeout HTTP OCR. Các kiểm thử startup riêng cũng qua.
- Frontend: **78 unit + 20 integration**, kiểm kiến trúc và TypeScript đã qua.
- Khởi động lại stack: API `/api/v2/health/ready` trả `ready`; AI `/healthz`
  trả `ok`, mode `live`; Chrome mở được hồ sơ.

## Kiểm thử tài liệu thật

Chi tiết chẩn đoán và OCR theo trang nằm trong `.reports/docling-rollout/`
(chỉ dùng tại máy, có dữ liệu tài chính; không đưa vào Git).

BCTC 2024 (`HKVINA_BCTC_2024.pdf`):

- 8/8 trang OCR được đọc, gồm trang 4 và 8 trước đây bị Gemini RECITATION.
- Nhận FY 2024 và FY 2023 riêng lẻ; không có warning chặn về kỳ.
- FY 2024: 10/14 chỉ tiêu; FY 2023: 9/14 chỉ tiêu.
- FY 2024 còn thiếu: tương đương tiền không bị hạn chế, phải thu thương mại
  thuần, tổng nợ chịu lãi, khấu hao và phân bổ. FY 2023 còn thiếu thêm tiền mặt
  vì nhãn model đề xuất chưa đủ căn cứ, bị guard loại.
- Chỉ kiểm thử trích xuất, không ghi lại hồ sơ 2024 hoặc xác nhận/chấm điểm.

BCTC 2025 (`BCTC NAM 2025.pdf`), chạy trực tiếp trên Chrome:

- Đọc đủ 8 trang; nhận FY 2025 và cột so sánh FY 2024, riêng lẻ.
- Discovery không có warning hoặc period issue. Không còn thông báo vàng về
  kỳ và trang 4/8 như trước; bước xác nhận chung không còn bị chặn bởi kỳ.
- Hai kỳ đều lưu **9/14** chỉ tiêu; provenance là
  `gemini-3.1-flash-lite` + `docling-2.140.0/easyocr:vi,en:aic-tables-v4`,
  prompt `financial-import-v2`. Không có OCR failure, mọi fact là `unverified`.
- Năm 2025 cập nhật bộ `993050fb-2c9f-4b8a-a27d-3e9aa03384c0` lên revision 2;
  năm so sánh 2024 tạo một bộ riêng. Tổng cộng đúng 2 bộ hiện hành, không trùng kỳ.
- Kiểm đúng cột tổng tài sản: 2025 là 126.346.084.916; cột so sánh 2024 là
  88.370.470.127. Các số này từ BCTC 2025, không đồng nhất ngầm với file 2024 riêng.
- Còn 5 mục N/A: bốn mục ở trên và **nợ ngắn hạn**. Nhãn nợ ngắn hạn trong lần
  OCR/model này chưa qua kiểm ngữ nghĩa (`UNSUPPORTED_FINANCIAL_LABEL`), cần
  đối chiếu/bổ sung từ trang 2. Không nới guard hoặc dùng tổng nợ thay nợ ngắn hạn.
- Lượt cũ đã hết 3 lần thử do các lỗi kỹ thuật phát hiện trong kiểm thử; đã lưu
  lý do loại lượt lỗi khỏi hàng đợi rồi upload đúng bản gốc và chọn thay bộ số
  liệu hiện có qua UI. Lịch sử, PDF và phiên bản dữ liệu trước vẫn giữ nguyên.
- Intake mới: `932825d1-eded-4839-9d53-55ba920c8020`; trạng thái cuối
  `needs_review` do thiếu chỉ tiêu. Chưa bấm xác nhận chung hoặc chấm điểm.

Ảnh kiểm thử nằm tại `.reports/docling-rollout/2025-chrome-files.jpg` và
`2025-chrome-review.jpg`; snapshot DB chỉ đọc tại `2025-live-snapshot.json`.

## Giới hạn cần giữ rõ

OCR đọc được trang không đồng nghĩa mọi chỉ tiêu đã đủ để chấm điểm. Các dòng
không đọc rõ, không có nguồn hoặc không đúng định nghĩa method vẫn thiếu/N/A.
Ví dụ phải thu khách hàng chưa chứng minh được giá trị thuần, tổng nợ chịu lãi
không được cộng ngầm từ thành phần, khấu hao không tự coi là khấu hao và phân bổ.
Những mục này cần người rà soát bổ sung từ BCTC hoặc chấp nhận thiếu theo nghiệp vụ.

Hồ sơ Chrome hiện dùng thông tin test MST `456`, ngành `123`, trong khi tài liệu
nhận MST `0109320470`; ngành trên hồ sơ đang ngoài phạm vi thí điểm. Không sửa
thông tin đối tác hoặc tiêu chí chấm điểm trong lượt kiểm thử OCR này.

Kết quả xử lý cũ không được sửa ngầm. Chạy “Thử lại” tạo lần xử lý và provenance
mới; giữ lịch sử, dữ liệu và xác nhận cũ theo cơ chế phiên bản hiện tại.

## Lỗi timeout phát hiện trong kiểm thử Chrome

Lượt chạy lúc 12:24–12:29 ngày 19/10 thất bại tại worker trong khi AI tiếp tục
đọc và trả discovery 200 sau đó. Thời điểm ngắt tương ứng khoảng 300 giây.
`AbortSignal.timeout(615000)` không tự nâng timeout chờ header mặc định của
Node/Undici. [Tài liệu Undici](https://undici.nodejs.org/api/Dispatcher) xác nhận
timeout header mặc định 300 giây.

Đã dùng dispatcher riêng cho từng lần gọi AI, đồng bộ timeout header/body và
deadline tổng (prepare 255 giây, discovery/extract 615 giây), hủy dispatcher
khi kết thúc. Không thay timeout toàn cục của các HTTP client khác. Thêm Undici
7.30.1 vào dependency API và lockfile.

Test `financial-intake-http.cjs` rút ngắn budget mặc định để tái hiện lỗi: gọi
fetch thông thường bị timeout, gọi qua intake với dispatcher riêng đọc được
response chậm và vẫn qua kiểm hợp đồng. Test đã qua; có trong `api:test:mvp`.

Lượt tiếp theo phát hiện schema backend vẫn cố định `financial-import-v1` trong
khi service trả `financial-import-v2`. Đã cập nhật generator/schema chấp nhận cả
hai phiên bản (giữ receipt lịch sử), đồng bộ các mã lỗi OCR và thêm test kiểm
output service thật bằng chính schema backend. Integration API dùng receipt v2.

Sửa thêm việc retry cùng file bị lỗi: giữ liên kết tới các kỳ/kết quả trước,
không ghi đè một phần hoặc làm mất liên kết khi kỳ mới thất bại. Có regression
test PostgreSQL kiểm ID và revision của bộ số liệu không đổi trong trường hợp này.
