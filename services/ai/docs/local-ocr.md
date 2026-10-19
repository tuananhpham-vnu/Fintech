# OCR local cho BCTC

Ở gốc repo:

```powershell
pnpm ai:ocr:setup
```

Lệnh tạo `.venv-docling` riêng, cài Docling 2.140.0 và PyTorch CPU, tải model layout,
TableFormer accurate, EasyOCR tiếng Việt/Anh vào `data/local/docling/models`.
Hai thư mục runtime/model đều được Git bỏ qua. Manifest ghi phiên bản package và
SHA256 của trọng số để phân biệt phiên bản OCR trong cache/provenance.

Chọn trong `.env`:

```dotenv
AI_PROVIDER=gemini
GEMINI_MODEL_ID=gemini-3.1-flash-lite
OCR_ENGINE=docling
```

Giữ `GEMINI_API_KEY`, các biến backend/DB/storage đang dùng. Không cần thêm key OCR.
`pnpm dev:all --check` kiểm tra cấu hình và model đã tải, không gọi Gemini hay OCR tài liệu.
Khởi động bằng `pnpm dev:all` như trước.

Các tùy chọn nâng cao chỉ cần khi dùng đường dẫn/engine khác:

| Biến | Mặc định |
|---|---|
| `DOCLING_PYTHON` | Python trong `.venv-docling` của repo |
| `DOCLING_ARTIFACTS_PATH` | `data/local/docling/models` của repo |
| `DOCLING_ENGINE` | `easyocr` |
| `DOCLING_LANG` | `vi,en` |

Lệnh setup chuẩn bị bộ EasyOCR `vi,en`. Các engine nâng cao khác cần dependency,
trọng số local và mã ngôn ngữ phù hợp riêng; setup này không tải sẵn mọi engine.

Runtime Docling chỉ sử dụng model local đã tải; tắt remote services và tải tự động.
Tiến trình con không nhận API key, DB URL hoặc internal key. Một tiến trình giữ
model giữa các trang; hết deadline thì dừng cả cây tiến trình trên Windows.
Không tự đổi sang cloud OCR khi local OCR lỗi.

Ảnh trang được renderer hiện tại giới hạn ở 200 dpi và hạn mức pixel/bytes.
EasyOCR dùng scale 2 trên ảnh này: thử trên BCTC thật cho thấy scale 1 bỏ sót
nhãn in đậm ở dòng tổng tài sản. Không dùng scale 3 mặc định vì chi phí CPU cao.
Ngưỡng giữ chữ OCR là 0.3; ngưỡng 0.5 mặc định loại mất một số tổng tiền đọc đúng
trong file thật. Chữ/số được giữ vẫn là `unverified`, cần đối chiếu bản gốc.
Nhãn trong ô bảng được sắp theo tọa độ OCR gốc, không sửa hoặc tạo thêm chữ/số.
Các số 0/ô trống vẫn khác nhau; OCR không đọc được thì không tự điền 0.

Trên CPU, lần nạp model và đọc một tài liệu nhiều trang có thể mất vài phút.
Discovery/import với OCR local có budget tổng 600 giây, nằm trong lease worker
15 phút; HTTP worker chờ tối đa 615 giây. Upload vẫn đi qua hàng đợi.
Các trang đọc thành công được cache có giới hạn trong bộ nhớ theo hash/trang/engine/
ngôn ngữ/phiên bản model, không phải cơ chế lưu vô thời hạn.

## Kỳ báo cáo

`period_resolution.py` xác minh kỳ hiện tại từ nguồn; nhận kỳ so sánh từ nhãn
“Năm trước” cùng tiêu đề năm trong báo cáo kết quả/lưu chuyển tiền khi niên độ
dương lịch đã rõ. “Số đầu năm” riêng lẻ không tạo đủ kỳ thu nhập năm trước.
Niên độ lệch hoặc thiếu ngữ cảnh không được suy diễn bằng cách trừ một năm.

Kỳ trùng được hợp nhất. Ngày lập/ký không tạo kỳ báo cáo. Chẩn đoán `period_issues`
lưu kỳ, trang, mã lý do và mức độ; chỉ vấn đề chưa giải quyết mới chặn xác nhận
chung. Dữ liệu lịch sử không có trường này vẫn đọc được; cần thử lại để tạo chẩn
đoán mới thay cho cảnh báo chung của phiên bản cũ.

Nếu model trả nhầm kỳ hiện tại khi được yêu cầu kỳ so sánh, import cho phép một
lần trích xuất lại toàn bộ theo cột được yêu cầu. Không đổi nhãn năm trên số tiền
cũ; kết quả vẫn phải khớp phạm vi yêu cầu và qua kiểm tra nguồn, số và ngữ nghĩa.

OCR local vẫn có thể nhận sai chữ hoặc số. Giữ bước kiểm tra quote, ngữ nghĩa,
nguồn, số liệu thiếu và xác nhận chung; không coi kết quả OCR là dữ liệu đã xác minh.
