# Nghiên cứu sửa pipeline đọc PDF: vi / en / zh-Hans

Ngày: 2026-10-17, Asia/Saigon. Phạm vi: nghiên cứu code, tài liệu chính thức và kiểm thử offline. Đây là phương án triển khai, không phải báo cáo đã sửa xong. Không sửa application code, `.env`, Frontend, DB, worker hoặc migration; không gọi provider hay upload hồ sơ thật trong đợt nghiên cứu này.

## Kết luận

Cần sửa cả ba tầng: chọn nguồn chữ đáng tin cậy, OCR đa ngôn ngữ và grounding theo ngôn ngữ. Thay model hoặc hạ ngưỡng ký tự hỏng đơn lẻ không giải quyết đủ vấn đề. Khả năng đọc vi/en/zh-Hans không tự động đồng nghĩa hỗ trợ mọi quy tắc nghiệp vụ của mọi quốc gia.

Giữ text nhúng khi tốt; OCR có giới hạn khi trang thiếu chữ, sai mapping font, sai thứ tự đọc hoặc có vùng ảnh chưa được đọc. Kết quả chưa đủ căn cứ phải chuyển rà soát, không tự lấp giá trị. Không thể cam kết mọi PDF đều đọc đúng, nhất là scan mờ, chữ viết tay, dấu chồng chữ hoặc file mã hóa.

## Bằng chứng đã có

- Phân tích read-only trước đó đã khớp SHA-256 file doanh nghiệp với bản upload. Trang nhìn rõ nhưng font chính Type0/Identity-H thiếu ToUnicode, text nhúng bị sai; detector vẫn trả needs_ocr=false. Tỷ lệ ký tự bị coi là hỏng khoảng 6,96% / 4,02%, dưới ngưỡng 30%. Kết quả lưu dùng đúng text đó, ocr_version=none. Không sao chép nội dung hồ sơ vào báo cáo.
- `services/ai/extraction/pdf.py`: `_garbled_ratio` chủ yếu nhận ký tự điều khiển/private/unassigned/replacement. Ký tự bị ánh xạ nhầm sang chữ, số hoặc ký hiệu hợp lệ có thể lọt qua.
- `services/ai/extraction/__init__.py`: đã có OCR_LANG nhưng mặc định `vie`; không có chiến lược chọn ngôn ngữ theo trang/vùng.
- `services/ai/extraction/ocr.py`: Tesseract dùng cố định `--psm 6`; prompt Gemini OCR nhấn mạnh tiếng Việt. Chưa có đường local OCR đã được xác minh cho ba ngôn ngữ.
- `services/ai/extraction/grounding.py`: nhãn có một phần tiếng Anh, nhưng vai trò, trạng thái, ngày viết bằng chữ và các mẫu Trung giản thể còn thiếu. `find_quote` hiện phụ thuộc các token cách nhau bởi khoảng trắng.
- `_Builder.field` đã hạ dữ liệu dựa OCR thành uncertain + OCR_UNVERIFIED; evidence OCR hiện precision=page, bbox=null. Phải giữ các bảo đảm này khi mở rộng.

Môi trường kiểm tra: không tìm thấy `tesseract` trên PATH hoặc vị trí cài chuẩn đã kiểm tra; không tìm thấy binary trong hai cây thư mục công cụ đã kiểm tra; venv không có paddleocr/pytesseract. Đây là kết quả trong phạm vi tìm kiếm, không khẳng định toàn bộ máy không có binary ở nơi khác. Chưa cài hoặc tải model.

## Kiểm thử thực thi trong đợt nghiên cứu

Lệnh chạy từ `services/ai`:

```powershell
& 'C:/Users/52duc/Desktop/Fintech/.venv/Scripts/python.exe' -B -m pytest tests/test_demo_pdf_regressions.py tests/test_extraction_roles.py -q -p no:cacheprovider
```

Kết quả: **31 passed**, 0 failed, 1 cảnh báo deprecation từ thư viện Starlette. Đây là hồi quy hiện có, không phải chứng nhận OCR ba ngôn ngữ.

Probe riêng chạy trực tiếp các hàm hiện tại với chuỗi synthetic, không LLM/mạng/DB:

| Probe | Kết quả hiện tại | Ý nghĩa |
| --- | --- | --- |
| Quote tiếng Việt NFD so với NFC | Khớp | Giữ hành vi đã có |
| Quote tiếng Anh khác xuống dòng giữa các từ | Khớp | Giữ hành vi đã có |
| Quote Trung giản thể nguyên văn | Khớp | Unicode Han tự nó không phải lỗi |
| Quote Han bị xuống dòng giữa các ký tự | Không khớp | Cần đối chiếu theo script, có mapping về offsets nguồn |
| `October 17, 2026` -> ISO | VALUE_NOT_IN_QUOTE | Thiếu mẫu ngày tiếng Anh |
| `2026年10月17日` -> ISO | VALUE_NOT_IN_QUOTE | Thiếu mẫu ngày Trung giản thể |
| Nhãn `付款金额` với số synthetic | UNVERIFIED_FIELD_LABEL | Thiếu nhãn grounding |
| `Payment status: completed` | VALUE_NOT_IN_QUOTE | Thiếu cue trạng thái tiếng Anh |
| `Seller` + `Tax ID` với MST Việt Nam synthetic | UNVERIFIED_FIELD_ROLE | Thiếu vai trò tiếng Anh |
| `单位：万元` | UNPARSEABLE_AMOUNT | Chưa hỗ trợ đơn vị Trung giản thể |

Những probe này tái hiện khoảng trống của code hiện tại; không đo chất lượng engine OCR. Output provider trước grounding của hồ sơ thật không được lưu, nên không thể khôi phục chính xác câu quote model đã đề xuất để phân tích sâu hơn mà không chạy lại.

Hai PDF synthetic khác được tạo và đọc hoàn toàn trong bộ nhớ: English dùng font chuẩn Helvetica và zh-Hans dùng font CJK `china-s`. Cả hai thiếu ToUnicode nhưng vẫn đọc đúng chuỗi gốc và không cần OCR. Điều này kiểm chứng rằng thiếu ToUnicode đơn lẻ không phải điều kiện đủ để ép OCR. Đây là native-text checks, không phải OCR checks.

## Thiết kế đề xuất

### P0 — Nhận diện và chọn nguồn chữ

- Phân tích từng trang và font thực sự được dùng: Type0/Identity-H thiếu ToUnicode là tín hiệu rủi ro, không phải quy tắc từ chối duy nhất. Font chuẩn hoặc CJK hợp lệ không được bị ép OCR chỉ vì không có ToUnicode.
- Kết hợp ký tự điều khiển, replacement/private chars, bất thường glyph-to-text, sự pha trộn script khó giải thích, cấu trúc dòng và độ phủ chữ/ảnh. Không dựa độc quyền vào từ điển tiếng Việt/Anh, tỷ lệ chữ ASCII hoặc khoảng trắng; Han thường không có khoảng trắng và tên riêng/mã định danh có thể hiếm.
- Giữ metadata chất lượng và lý do chọn text/OCR. Với trang nghi lỗi nhưng chưa chắc, thực hiện một lượt OCR có giới hạn rồi so sánh hai nguồn, đặc biệt các chuỗi số/mã. Không chọn bản chỉ vì nó có nhiều chữ hay model trích được nhiều trường hơn.
- Tránh vòng lặp OCR/model khi 0 trường: phân biệt không có trường theo loại tài liệu, đọc lỗi, nhãn chưa hỗ trợ và đề xuất model sai. Tối đa một đường phục hồi có budget; hết budget hoặc hai nguồn mâu thuẫn thì rà soát.
- Giữ giới hạn file/trang/pixel/thời gian hiện có, không xử lý ngầm phần đầu PDF dài như toàn bộ hồ sơ.

### P1 — OCR local ba ngôn ngữ

Baseline tích hợp ít thay đổi: adapter Tesseract hiện có, cung cấp engine và các traineddata `vie`, `eng`, `chi_sim` được pin phiên bản/hash. Kiểm tra language pack sẵn có khi khởi động; cấu hình thiếu không được âm thầm đổi sang cloud hoặc trả text rỗng như thành công.

- Ưu tiên `vie+eng` / `chi_sim+eng` khi có tín hiệu tin cậy, và hỗn hợp `vie+eng+chi_sim` khi chưa rõ hoặc trang trộn cả ba. Thứ tự và chất lượng cần benchmark; không khẳng định bật ba pack luôn tốt hơn chọn cặp.
- Không suy ngôn ngữ từ tên file; không nhận diện ngôn ngữ độc quyền từ chính text layer nghi hỏng. Dùng script/OSD/probe OCR có giới hạn và cho phép trạng thái mixed/unknown.
- Thử segmentation phù hợp bố cục: trang một khối, nhiều cột, biểu mẫu/bảng. Không áp `--psm 6` cho mọi trang. Giữ reading order và tọa độ dòng/từ khi engine cung cấp TSV/hOCR.
- Đánh giá xoay/nghiêng, chữ nhỏ và ảnh kém tương phản. Tài liệu Tesseract khuyến nghị ảnh ít nhất 300 DPI, nhưng A4 ở 300 DPI khoảng 8,7 triệu pixel, vượt cap 8 triệu hiện tại. Phải dùng adaptive DPI hoặc render vùng/tile có giới hạn tổng; không tăng giới hạn tùy tiện. Tiling cần xử lý overlap/dedup/thứ tự trước khi dùng làm evidence.
- Cache theo source hash + page + engine/model/language/preprocessing version; cache ở thư mục riêng có quyền hạn chế. Không nhét dữ liệu thật vào log/test fixtures.

Ứng viên đối chứng: PaddleOCR PP-OCRv5 có model Latin hỗ trợ tiếng Việt, model English, và cấu hình Chinese/English. Đây là các model/lộ trình khác nhau; không coi model Chinese mặc định đã hỗ trợ tiếng Việt. Chỉ chọn thay thế nếu benchmark trên corpus của ứng dụng chứng minh lợi ích về ký tự, trường, latency, bộ nhớ và khả năng chạy Windows/offline. Chưa benchmark hoặc cài đặt PaddleOCR.

### P2 — Extraction và grounding đa ngôn ngữ

- Prompt OCR/extraction phải cho phép vi/en/zh-Hans và trang hỗn hợp, chép nguyên ngữ, không dịch tên/quote. Bộ field_key chuẩn giữ nguyên khi ý nghĩa nghiệp vụ đã tương đương.
- Quote matching: giữ NFC; chỉ cho phép biến thể khoảng trắng/line wrap phù hợp script và giữ mapping về offsets nguyên bản. Không xóa mọi khoảng trắng/dấu câu, không transliterate, fuzzy-match tên/mã/số hoặc áp NFKC toàn cục để cho qua guard.
- Thêm nhãn, vai trò các bên, trạng thái và phủ định/giả định ở cả ba ngôn ngữ, kèm negative tests. Không suy borrower từ thứ tự xuất hiện hoặc tự đồng nhất Buyer/Borrower/买方.
- Ngày: thêm mẫu tháng tiếng Anh và `年/月/日`; với dạng số mơ hồ như 03/04/2026 cần ngữ cảnh locale đáng tin cậy hoặc rà soát. Không lấy ngôn ngữ English làm bằng chứng duy nhất cho thứ tự tháng/ngày.
- Tiền: xử lý dấu phân cách, full-width digits/punctuation qua phép chuẩn hóa có mapping, đơn vị và dấu âm theo quy tắc xác định. Không nhân đơn vị hai lần; giữ contract financial amount/unit_multiplier hiện có. Các đơn vị `万`/`亿` cần tests đơn vị riêng, không chỉ thêm từ vào regex.
- Đọc chữ Trung giản thể không tự cấp quyền đổi quy tắc MST Việt Nam. Mã đăng ký nước ngoài cần giữ nguyên dạng và loại định danh riêng; nếu cần đổi DTO/country semantics phải trình quyết định nghiệp vụ trước khi thay validator. Không nới tax_id thành chuỗi bất kỳ.
- Mở rộng phát hiện prompt injection theo vi/en/zh-Hans trong tài liệu; dữ liệu OCR vẫn không phải chỉ dẫn. Không dùng regex tiếng Việt làm ranh giới an toàn duy nhất.

### P3 — Evidence và trạng thái

- Giữ nguyên bytes/hash PDF; OCR tạo nguồn chữ dẫn xuất, có phiên bản và method/engine/lang. Không ghi đè PDF, published result hoặc human decision cũ. Nếu chạy lại, dùng retry/version flow được hỗ trợ thay vì sửa JSON trong DB.
- Quote phải khớp nguồn chữ thực tế được chọn trên đúng trang; từ OCR vẫn unverified và cần người đối chiếu ảnh. Confidence của OCR chỉ là tín hiệu chất lượng, không chứng minh một giá trị đúng.
- Chỉ đưa bbox nếu có tọa độ OCR hợp lệ và chuyển hệ tọa độ/rotation được kiểm thử; trước đó giữ page precision và bbox=null. Không dùng tọa độ lớp font hỏng để tô sáng chữ OCR.
- Tách job hoàn tất khỏi số trường dùng được. Chẩn đoán phải cho biết đọc lỗi, thiếu engine/language pack, không có field hay grounding thất bại. Mã trạng thái/diagnostic mới là đề xuất, cần đối chiếu schema/contract trước khi tích hợp; Frontend thuộc Antigravity.

## Tiêu chí nghiệm thu trước khi báo đã sửa

1. Corpus synthetic tối thiểu vi/en/zh-Hans cho sáu dạng mỗi ngôn ngữ: native text tốt, mapping font lỗi nhưng nhìn rõ, scan, text+ảnh, nhiều cột/bảng, xoay/nghiêng/chữ nhỏ; bổ sung trang song ngữ/ba ngôn ngữ, trang trắng, dấu chồng chữ và bản cố ý không đọc được.
2. Chạy engine OCR thật cục bộ cho cả ba, không dùng FakeModel để tuyên bố OCR PASS. Xác minh riêng tên có dấu/Han, mã, số tiền, ngày, vai trò và unit scale với ground truth synthetic.
3. Đo CER theo ngôn ngữ, exact match cho trường quan trọng, tỷ lệ giá trị sai được nhận, tỷ lệ chuyển review, thời gian/bộ nhớ. Không gộp chỉ số để che lỗi một ngôn ngữ. Ngưỡng chất lượng tổng cần chốt bằng benchmark, chưa có số đo để cam kết.
4. Negative tests phải từ chối quote sai trang, thay một chữ số, đảo bên, phủ định, mã khác quốc gia, ngày mơ hồ và prompt injection. So khớp CJK line wrap không được mở cửa cho ghép chữ từ hai cột.
5. Giữ các hồi quy PDF, grounding, quota, source/evidence binding và legacy route; chạy API/worker offline integration trên DB test/restore khi thay code. Không ghi fixtures vào DB chính.
6. Hồ sơ thật chỉ được đọc/OCR local trong phạm vi user đã cho phép; live extraction/OCR cloud cần quyền riêng. Không ghi kết quả thử nghiệm vào hồ sơ đang dùng nếu chưa có yêu cầu thực thi.

## Thứ tự triển khai sau nghiên cứu

1. Sửa detector + phục hồi OCR có giới hạn, kiểm chứng lỗi font đã tái hiện.
2. Provision engine local/ba language packs và benchmark corpus ba ngôn ngữ.
3. Mở rộng quote/labels/roles/dates/units và negative tests; giữ riêng quyết định định danh nước ngoài.
4. Tích hợp provenance/status, actual offline API/worker tests rồi bàn giao Antigravity browser acceptance.

Phạm vi file dự kiến: `services/ai/extraction/pdf.py`, `ocr.py`, `extractor.py`, `grounding.py`, `extraction/__init__.py`, tests và README liên quan. Chưa cần sửa FHI/rating hoặc migration để khắc phục đọc chữ; mọi thay đổi DTO/API phát sinh phải chốt riêng. Nghiên cứu này chưa thay bất kỳ file ứng dụng nào.

## Tài liệu chính thức

- [PyMuPDF: Missing or Unreadable Extracted Text](https://pymupdf.readthedocs.io/en/latest/recipes-common-issues-and-their-solutions.html): mapping/reading order lỗi và đường phục hồi OCR.
- [Tesseract: Command Line Usage](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html): multiple languages, thứ tự language pack, segmentation, TSV/hOCR.
- [Tesseract: Improve Quality](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html): DPI, deskew, segmentation/preprocessing.
- [Tesseract: Installation](https://tesseract-ocr.github.io/tessdoc/Installation.html): engine và language data riêng.
- [Tesseract tessdata_best](https://github.com/tesseract-ocr/tessdata_best): model LSTM, ứng viên đo chất lượng so với bản nhẹ.
- [PaddleOCR: PP-OCRv5 multilingual recognition](https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html): model và ngôn ngữ hỗ trợ; không thay thế benchmark ứng dụng.
