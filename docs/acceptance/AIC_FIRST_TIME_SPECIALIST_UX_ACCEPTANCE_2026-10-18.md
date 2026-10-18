# AIC Rating — First-time specialist UI/UX & business acceptance

Ngày 18/10/2026, Asia/Saigon. Chế độ: AUDIT / OBSERVE / REPORT ONLY.

## 1. Executive verdict

**FAIL về khả năng chuyên viên mới tự hoàn thành nhiệm vụ lập báo cáo đánh giá sức khỏe doanh nghiệp nhiều năm. Coverage: PARTIAL.** Đây là kết luận về trải nghiệm đã quan sát, không phải chứng nhận độ tin cậy tài chính, độ chính xác mô hình hoặc nghiệm thu production. Không suy FAIL cho mọi chức năng chưa thử.

Sản phẩm có nền tảng sử dụng được: nhận diện giao diện nhất quán; sáu tab rõ; viewer PDF mở đúng phiên bản/trang và quay về được; bảy chỉ số có giải thích tiếng Việt; dữ liệu minh họa và hạn chế phương pháp được cảnh báo; điểm/band bị giữ trống khi kết quả cũ hoặc chưa đủ điều kiện. Tuy nhiên, bước tạo hồ sơ còn buộc người dùng nghĩ theo giao dịch, trạng thái xác minh có chỗ mâu thuẫn, thiếu tổng hợp xu hướng đa năm và chưa tìm thấy chức năng xuất báo cáo sức khỏe doanh nghiệp. Không chứng minh được hành trình hoàn chỉnh từ đăng nhập tới báo cáo cho quản lý.

Ưu tiên trước đợt nghiệm thu tiếp: UX-02/03/04 về cách đọc kết quả cũ và xác minh; UX-01 về điểm bắt đầu; UX-06/07/16 về coverage nghiệp vụ. Không phát hiện P0 trong phạm vi quan sát; các ca quyền/tenant/đổi phiên chưa chạy không được coi an toàn chỉ từ kết luận này.

### Môi trường và bảo toàn

- Website: http://127.0.0.1:3000, Chrome thật qua browser integration; root chuyển tới /cases. Phiên có sẵn: “Sandbox specialist”, role “Chuyên viên”. Không đọc hoặc ghi credentials.
- Lượt đầu: ảnh từ 11:21:32 đến 11:29:34; tiếp tục từ 11:41 đến 11:43. Đây là thời điểm bằng chứng, không phải phép đo thời gian thao tác của người thật.
- Desktop: viewport mặc định có ảnh 1351×592; override đã thử 1440×900, 1280×800, 1920×1080. Ảnh vùng nội dung có thể trừ scrollbar. Đã reset override, trở về Tiếng Việt.
- Branch duc, HEAD 9bf0635e8d8e695e79491c1ce527a9562826faef. Working tree đã có nhiều thay đổi API/AI/FE và tài liệu; không quy chúng cho audit này.
- Không sửa source/CSS/API/DB/Notion, không stash/reset/clean/checkout/commit/push/deploy. Chỉ tạo báo cáo này và bằng chứng ngoài Git. Không lưu mutation nghiệp vụ; hai lần Save với form bắt buộc trống bị native validation chặn. Các thay đổi thử trên form chưa lưu đã bỏ.
- Khi tiếp tục, Chrome báo ERR_CONNECTION_REFUSED. Đã chạy đúng lệnh có sẵn pnpm local:serve trên build hiện có, không build/migrate/seed; Chrome mở lại được danh sách với phiên còn hiệu lực. Worker ghi idle khi khởi động. Không coi sự kiện stack dừng giữa phiên là lỗi sản phẩm đã xác định nguyên nhân.

### Năm câu hỏi chốt

| Câu hỏi | Trả lời từ bằng chứng |
| --- | --- |
| Chuyên viên mới có tự lập báo cáo từ đăng nhập không? | **Chưa chứng minh được; nhiệm vụ đầu-cuối chưa đạt.** Bắt đầu từ phiên đã đăng nhập. Điểm mắc đầu tiên là “Tạo giao dịch” và yêu cầu tiền/thời hạn; tiếp theo là biến trích xuất thành dữ kiện đủ nguồn, xử lý blockers và thiếu tổng hợp/xuất báo cáo. Login/relogin chưa chạy. |
| Một trang có ngay điểm/trạng thái, lý do, xu hướng, bằng chứng, việc cần làm không? | **Không.** Điểm/trạng thái có nhưng cách diễn giải mâu thuẫn; lý do và việc cần làm nằm dưới fold; bằng chứng cần mở chi tiết; không tìm thấy xu hướng nhiều năm. Xem E60–62, E66, E81. |
| Có lộ kỹ thuật/synthetic/debug/backend code không? | Có mã phương pháp/version, revision/lần cập nhật, LIVE, chỉ dẫn “API”, reference kiểm thử, v1/v3, hệ số đơn vị và thuật ngữ “giá trị hiệu lực”. Không thấy raw fact_key, total_assets, null, stack trace hoặc đường dẫn docs trong các vùng đã đọc. Danh mục đầy đủ những gì gặp ở mục 7; không suy toàn app đã sạch. |
| Đúng đánh giá doanh nghiệp nói chung hay giống phê duyệt khoản vay/giao dịch? | Hero và tab tài chính nói sức khỏe doanh nghiệp; entry, form và danh sách vẫn xoay quanh giao dịch. **Có lệch định vị brief mới**, nhưng chưa thấy nút phê duyệt khoản vay, tự đề xuất hạn mức/kỳ hạn hoặc PD. Không suy rằng phải xóa RECEIVABLE/PREPAYMENT. |
| Phần nào chạy thật, phần nào synthetic? | Đã tương tác UI local thật để đọc danh sách, hồ sơ, thư viện, PDF, trích xuất lưu sẵn, metrics và lịch sử. Các số tài chính hai năm dùng để thử là synthetic có nhãn. Không chạy lại OCR/AI, không phát hành điểm mới, không xác minh hồ sơ thật. Điểm 82,5/AIC-F2 chỉ là bằng chứng synthetic của lượt trước trong handoff, không là kết quả quan sát hiện hành hay điểm công ty thật. |

## 2. First 60 seconds — cảm nhận tự khám phá

Không đọc source, báo cáo bàn giao hay Notion trước khi ghi first-impression. Trước mở Chrome chỉ đọc prompt, hướng dẫn công cụ và liệt kê tên file dự án; chưa đọc nội dung ứng dụng/flow. Ghi nhận Phase A ở file phase-a-first-impression.json ngoài Git trước Phase C. Đây là mô phỏng vai chuyên viên bởi agent, không phải nghiên cứu với người mới được tuyển độc lập; prompt đã cho biết mục tiêu bảy metric và hạn chế synthetic. Không có stopwatch hoặc dữ liệu để tuyên bố SLA 60 giây.

| Câu hỏi trong phút đầu | Câu trả lời từ UI | Mức tự khám phá |
| --- | --- | --- |
| AIC làm gì? | “Kiểm tra số liệu doanh nghiệp, xem bảy chỉ số sức khỏe tài chính và truy xuất bằng chứng…” | Nhìn thấy ngay; tốt. E01. |
| Tôi làm gì đầu tiên? | Nút chính “Tạo giao dịch”; tôi muốn đánh giá doanh nghiệp nên phải đoán mở hồ sơ có sẵn. | Chưa rõ; needs improvement. E01/E82. |
| Đánh giá ai? | Danh sách có tên và MST; chọn SYNTHETIC Buyer Alpha. Khi tải chi tiết từng xuất hiện nhãn chung và dấu — trước tên thật của bản ghi. | Sau tải có thể biết; trạng thái chuyển tiếp dễ gây lẫn. E01/E02. |
| Kết quả quan trọng nhất? | Hero hứa sức khỏe tài chính; danh sách ưu tiên nghiệp vụ, tiền và ngày lịch. Chưa thấy sức khỏe/readiness ngay trên danh sách. | Phải vào hồ sơ và tab tài chính. E01/E60. |

Nhận xét ở góc nhìn nghiệp vụ: “Tôi hiểu công cụ giúp đọc sức khỏe tài chính, nhưng không rõ vì sao phải tạo giao dịch khi chỉ có BCTC. Tôi tìm được bảy chỉ số, song chữ Hoàn tất, điểm trống và yêu cầu chạy lại xuất hiện cùng nhau làm tôi không chắc phần nào dùng được để báo cáo.”

## 3. Journey replay — hành động UI và kết quả

Nhiệm vụ: có BCTC nhiều năm, cần trình bày sức khỏe, điểm mạnh/yếu và nguồn cho quản lý. Dùng hồ sơ minh họa hiện có, không giả lập thành công bằng API/DOM mutation/seed. “UI” dưới đây là click/select/fill/key thật qua Chrome; đọc AX là quan sát giao diện. Hypothesis từ code chỉ dùng sau Phase A.

| Thời điểm địa phương | Hành động trực tiếp → quan sát | Bằng chứng / độ khó |
| --- | --- | --- |
| 11:21:32 | Mở root → danh sách; đọc hero và CTA. | E01; mục đích rõ, điểm bắt đầu chưa rõ. |
| 11:21:36 | Click hồ sơ Buyer Alpha minh họa → tổng quan, tài liệu 0, review/health “Hoàn tất”, readiness cần chọn BCTC/chạy lại. | E02; một click từ danh sách. |
| 11:21:39–47 | Click tab sức khỏe → chọn 2025 → mở hệ số thanh toán hiện hành. Score/band trống, có tỷ số và giải thích. | E03–05; từ danh sách tối thiểu 3 click và 1 chọn dropdown để tới metric. Không phải tổng click toàn audit. |
| 11:22:56–59 | Escape đóng metric/trả focus → mở Nguồn gốc số liệu Tiền → tab Tài liệu. Nguồn nhập tay minh họa; danh sách tài liệu rỗng. | E06/E07; không truy ra PDF ở case này. |
| 11:23:08–15 | Mở Tải PDF → chọn Thay thế phiên bản → chưa có nguồn thay thế → đóng; mở Rà soát hồ sơ. | E08–10; form có hướng dẫn PDF/ZIP không nhất quán. Không upload. |
| 11:23:19–42 | Mở phi tài chính/bộ câu hỏi; Save trống bị chặn. Chọn trạng thái verified thử, đóng → guard; Tiếp tục chỉnh sửa giữ chọn, Bỏ thay đổi hủy. | E11–17; guard là điểm tốt. Chưa ghi xác minh. E16 thực tế là guard, không phải lịch sử. |
| 11:23:42–52 | Mở lịch sử, disclosure phê duyệt, form yêu cầu; Next lịch sử chuyển trang; mở sửa hồ sơ. | E18–22; lịch sử đọc được; metadata revision còn nổi. |
| 11:24:04–33 | Mở xác minh tài chính và form sửa/tạo BCTC; đóng không lưu. Mở lần lượt đủ 7 metric. | E23–26-7; form dài; metric M02 có nhãn verified trái với Tiền unverified. |
| 11:24:38–56 | Chọn 2024 → UI cảnh báo kết quả lưu thuộc bộ khác, ẩn điểm; mở cách tính và chọn lịch sử rev4; reload. | AX trực tiếp + E28–33; sau reload năm/lịch sử trở về chưa chọn/latest. E27 chỉ chụp vùng metric, không có header năm. |
| 11:25:00–41 | Đối tác → tìm chuỗi không có → form thêm/sửa → Save trống bị chặn; về danh sách → form tạo, chọn Trả trước, bật Chưa rõ, thêm khai báo/điều kiện → bỏ nháp; lọc Trả trước. | E34–41, E82 bổ sung ảnh form đúng; E39 là ảnh danh sách chụp trước frame modal, không dùng chứng minh form. |
| 11:25:46–26:54 | Case trả trước minh họa không có tài liệu/dữ kiện. Mở case kiểm thử gắn HK VINA chỉ đọc → thư viện, nhóm/lọc BCTC, viewer v3, trang 1→2, zoom150%, đóng về bộ lọc; mở extraction5/9, nguồn có quote, form sửa/verify/classify; đóng không lưu. | E42–58; viewer/return tốt. Chỉ đọc trích xuất đã lưu, không gửi lại AI. |
| 11:27:09–36 | Kiểm tra desktop1440/1280/1920, đổi VI→EN→ZH→VI. | E60–64; nhãn kết quả/metric dịch được, tên/nguồn giữ nguyên. E59 là overview sau phím Home, không là assessment. |
| 11:27:51–28:03 | Click Tải văn bản đã duyệt → không nhận event download trong12s; trang không có thay đổi/confirmation. | E65; chưa xác minh được file, không kết luận export lỗi. Trang Downloads bị browser policy chặn, không vượt chặn. |
| 11:29:03–34 | Mở lại M02 để xác nhận mâu thuẫn; ArrowRight/Left chuyển tab; Ctrl+Home khi focus tab sức khỏe chuyển sang overview; mở ngữ cảnh giao dịch. | E66–70; Ctrl+Home tái hiện lần hai. |
| 11:41–43 | Website tạm từ chối kết nối → launcher hiện có → Chrome vào lại. Thử tìm kiếm hồ sơ có/không có kết quả, refresh, điều kiện, mở form ack/hủy rồi đóng; Back/Forward; chụp lại header khác kỳ và form tạo sau frame ổn định. Cuộn bảng tỷ số2024. | E71–83; M05 hiển thị — cùng “Có kết quả tính toán”, M07 hiển thị0.08 không %. |

Câu hỏi nghiệp vụ: “Con số/năm nào?” trả lời sau click hợp lý ở metric, nhưng snapshot và nguồn hiện hành có thể lẫn; “Đã lưu chưa?” guard bản nháp trả lời rõ; “Sửa sai thế nào?” có form, nhưng thiếu nguồn cạnh form; “Cảnh báo tài chính hay lỗi hệ thống?” còn lẫn trong các block dài; “Tiếp theo?” có readiness nhưng chưa dẫn đúng field.

## 4. SCREEN & CONTROL COVERAGE MATRIX

PASS chỉ áp dụng hành vi ghi ở từng dòng. Mở form PASS không suy thao tác lưu PASS. FAIL là vấn đề nhìn thấy, BLOCKED là điều kiện không đủ; NOT RUN là chưa thực hiện. Không tuyên bố đã test mọi control/toàn bộ UI. Các ảnh có thể chỉ chứa phần viewport; AX trong phiên bổ sung nội dung ngoài fold.

| ID | Màn hình / control / trạng thái | Kết quả | Quan sát / giới hạn | Evidence |
| --- | --- | --- | --- | --- |
| C01 | Root → /cases, phiên có sẵn, shell/role | PASS | Vào danh sách được, role hiện rõ | E01/E72 |
| C02 | Login mới, login error, logout/relogin, khác identity | BLOCKED | Không có credentials được cấp cho audit; không logout phiên dùng chung rồi không thể phục hồi | Không chạy |
| C03 | Danh sách hồ sơ: search có/không kết quả, clear | PASS | SYNTHETIC lọc đúng, chuỗi lạ có empty | E73/E74 |
| C04 | Filter Trả trước | PASS | Chỉ còn Supplier Beta | E41 |
| C05 | Filter cho vay/đầu tư nợ, sort, phân trang danh sách | NOT RUN | Hai nút trang disabled ở tập hiện có; không thấy sort control | E01 |
| C06 | Refresh danh sách, mở case | PASS | Tải lại; case mở đúng | E72–76 |
| C07 | Tạo giao dịch: mở/đóng, chọn loại, Chưa rõ, thêm dòng | PASS | Vai trò đổi đúng, lý do thiếu hiện; bỏ nháp được | E40/E82 |
| C08 | Tạo giao dịch: submit/lưu thành công | NOT RUN | Không tạo record mới khi chưa có rollback nghiệp vụ không phá lịch sử | E82 |
| C09 | Đối tác: danh sách/search/empty | PASS | Có tên, MST, trạng thái chưa xác nhận | E34/E35 |
| C10 | Thêm/sửa đối tác: mở form, required trống | PASS | Chặn Save trống; không ghi record | E36–38 |
| C11 | Đối tác: save, duplicate/foreign identity, xác minh pháp nhân | NOT RUN | Chưa đủ nguồn, không xác minh thay chuyên viên | E38 |
| C12 | Sáu tab, shell Back link | PASS | Mỗi tab hiện panel/URL hash tương ứng | E02/E07/E10/E11/E18/E60 |
| C13 | Overview: status/readiness | FAIL | Hoàn tất đồng thời cần chọn/chạy lại, dễ hiểu sai | E02/E59/E76 |
| C14 | Context/Điều kiện hợp đồng expand/collapse | PASS | Vai trò/empty được trình bày; không JSON | E70/E75 |
| C15 | Sửa hồ sơ: mở/đóng | PASS | Có trường tiền/hạn/khai báo/điều kiện | E22 |
| C16 | Sửa hồ sơ: lưu, xóa dòng đã lưu, đổi nghĩa vụ | NOT RUN | Audit không lưu thay đổi hồ sơ | E22 |
| C17 | Files empty | PASS | Thấy quota và upload; hướng dẫn bắt đầu còn ít | E07/E42 |
| C18 | Upload form; New→Replace, required source, disabled submit | PASS | Hiện trường liên quan; không có nguồn để replace ở synthetic | E08/E09 |
| C19 | Upload PDF/ZIP thật, drag/drop, replace/response, quota/error | NOT RUN | Không upload/khởi chạy AI; chỉ xem receipt lưu sẵn | E44 |
| C20 | Upload wording PDF/ZIP và chỉ dẫn API | FAIL | Hai thông điệp định dạng xung đột, guidance kỹ thuật lộ | E08 |
| C21 | Intake receipt và job status/error có sẵn | PASS | Receipt100%, lưu2 nguồn; job thất bại có lời giải thích | E44/E45 |
| C22 | Retry thất bại | BLOCKED | Nút Thử lại disabled, không phát job mới | E44 |
| C23 | Thư viện: mở/quay lại, nhóm năm→loại, filter BCTC | PASS | Đổi grouping; còn3 BCTC; filter giữ sau viewer | E45–47/E51 |
| C24 | Thư viện: search/năm/status/Cần xử lý/clear filter/collapse | NOT RUN | Thấy controls nhưng chưa thử từng nhánh | E45/E47 |
| C25 | Viewer v3 load, Next1→2, zoom150%, close/return | PASS | PDF render được; loading tạm thời kết thúc | E49/E50b/E51 |
| C26 | Viewer Previous, link download nguồn, disclosure hash/version | NOT RUN | Không thử các control này; không chép hash/bytes ra report | E49 |
| C27 | Extraction review:5/9, thiếu/unusable, nguồn/quote | PASS | Phân biệt usable với verified; field thiếu bị khóa verify | E52–54 |
| C28 | Extraction correction/verification/classification form mở/đóng | PASS | Có lý do; identity match có ba lựa chọn | E55–57 |
| C29 | Correction/verify/classify/manual review submit | NOT RUN | Hồ sơ gắn dữ liệu thật, chỉ đọc | E55–57 |
| C30 | Document Review: findings/stale/status | PASS | Thiếu tài liệu và unresolved thấy rõ | E10 |
| C31 | Run review, resolve/dismiss/waiver/revoke | BLOCKED | Resolve/dismiss disabled ở synthetic stale; không run để đổi lịch sử | E10 |
| C32 | Phi tài chính: câu hỏi/câu trả lời và origin/unverified | PASS | Đọc được lời khai minh họa, trạng thái tách biệt | E11 |
| C33 | Bộ câu hỏi form: mở/required trống/đóng | PASS | Save trống bị native required chặn | E12/E13 |
| C34 | Xác minh câu trả lời: select thử, dirty guard/stay/discard | PASS | Giữ bản nháp khi stay, discard về unverified | E14–17 |
| C35 | Invite/reissue/copy link/close/nhập thay/respondent submit | BLOCKED | Bộ minh họa đã đóng; nút invite/staff disabled. Không tạo invitation mới | E11 |
| C36 | Chọn2025/2024 và đồng bộ selector trên/dưới | PASS | Bảng đổi năm; khác bộ có warning; không gán score chéo | E81 + AX |
| C37 | FHI/band trống khi stale/mismatch/thiếu điều kiện | PASS | Không dùng0 thay thiếu; acknowledgement bị khóa | E60/E66/E81 |
| C38 | MetricM01: mở giải thích/nguồn/Escape trả focus | PASS | Tỷ số2 có công thức; synthetic rõ | E05 |
| C39 | MetricM02: mở chi tiết | FAIL | Verified của metric và unverified của Tiền cùng màn | E26-2/E66 |
| C40 | MetricM03: mở chi tiết | PASS | Có công thức và nguồn; chưa kiểm release điểm | E26-3 |
| C41 | MetricM04: mở chi tiết | PASS | Có giải thích EBITDA và nguồn; gate2024 giữ trống | E26-4/E83 |
| C42 | MetricM05: mở chi tiết | PASS | Có mô tả trả lãi; xem C47 cho nhãn ngoại lệ2024 | E26-5 |
| C43 | MetricM06: mở chi tiết | PASS | Có giải thích biên lợi nhuận; chưa có đơn vị% dễ đọc | E26-6 |
| C44 | MetricM07: mở chi tiết | PASS | Có giải thích dòng tiền; chưa có đơn vị% dễ đọc | E26-7 |
| C45 | Strengths/weaknesses khi result stale/khác kỳ | FAIL | Nhận định tích cực vẫn hiện dù điểm bị ẩn | E62/E81 |
| C46 | Hạn chế/cách tính/readiness expand | PASS | Cảnh báo thử nghiệm/PD trống vẫn đọc được | E29/E30 |
| C47 | Bảng tỷ số2024/ngoại lệ không nợ-lãi | FAIL | M05 — nhưng “Có kết quả tính toán”; thiếu lý do cụ thể ngay card | E83 |
| C48 | Bảng dữ kiện/provenance nhập tay | PASS | Năm/basis/VND/unit và verified/unverified hiển thị | E06/E24 |
| C49 | Tạo/sửa BCTC và verify form mở/đóng | PASS | Có scope/source/reason/bridge controls; chưa submit | E23–25 |
| C50 | Tạo/sửa/verify BCTC lưu, chạy assessment, ack kết quả | NOT RUN | Không phát điểm hoặc thay verification để tạo positive demo | E60 |
| C51 | Assessment history chọnrev4 | PASS | Đổi bản lưu; vẫn có stale/mismatch guard | E31/E32 |
| C52 | Reload giữ selected year/history | FAIL | Về chưa chọn/latest; hash assessment còn | E33 |
| C53 | Requests: xem approved, expand bản đối chiếu, mở nháp | PASS | Nội dung minh họa, nguồn bản duyệt có disclosure riêng | E18–20 |
| C54 | Request ack/cancel mở rồi đóng | PASS | Yêu cầu lý do; chưa thực hiện mutation | E77/E78 |
| C55 | Request create/approve/cancel/ack submit | NOT RUN | Không thay lịch sử hay gửi yêu cầu | E20/E77/E78 |
| C56 | Tải văn bản đã duyệt | BLOCKED | Click đã chạy, event timeout12s; file chưa xác minh; chrome://downloads bị policy chặn | E65 |
| C57 | Tải bản ghi phê duyệt gốc | NOT RUN | Chỉ mở disclosure | E19 |
| C58 | Lịch sử Next từ trang1→2 | PASS | Hiện event cũ, Next disabled trang cuối | E21 |
| C59 | Lịch sử Previous/Refresh | NOT RUN | Thấy nút; chưa click riêng | E18/E21 |
| C60 | VI→EN→ZH→VI tại assessment | PASS | Nhãn/metric/limitations dịch; chưa phủ mọi form/locale | E63/E64 |
| C61 | Desktop1280/1440/1920 | PASS | Bố cục mẫu đọc được; chưa phải kiểm mọi route hoặc browser zoom | E60–62 |
| C62 | Escape, focus return, ArrowLeft/Right | PASS | Modal trả focus; phím đổi tab đúng | E05/E67/E68 |
| C63 | Ctrl+Home khi focus tab | FAIL | Tự chuyển assessment→overview thay vì hành vi cuộn trang mong đợi | E68/E69 |
| C64 | Browser Back/Forward | PASS | Trở lại list rồi đúng route/hash assessment; chưa giữ selected year khi remount | E79/E80 |
| C65 | 403/409/429/5xx/offline/tenant/screen reader/zoom200% | NOT RUN | Không mock hoặc tạo fault; không đủ account/dữ liệu đại diện | Không chạy |
| C66 | Runtime dừng→launcher cũ→Chrome vào lại | PASS | Khôi phục được; chưa đo crash/restore hoặc production recovery | E71/E72 |

## 5. Top 20 UX/business issues

Severity là ưu tiên trong mục tiêu chuyên viên mới, không phải mức lỗi số học đã chứng minh. Cột H là **hypothesis**, chưa phải root cause xác nhận bằng backend/network. A = /cases/91c0f61e-5d4a-47ae-8f63-67f604c7a04b; B = /cases/275b3e13-9c4a-4436-96e1-5d59ed43f768. Ảnh xem mục 11.

| ID / mức | Màn hình / ảnh | Tái hiện → actual | Expected / tác động nghiệp vụ | H: nguyên nhân suy luận | Sửa cụ thể → browser retest |
| --- | --- | --- | --- | --- | --- |
| UX-01 P1 | /cases, form tạo; E01/E82 | Muốn đánh giá doanh nghiệp → CTA Tạo giao dịch; chỉ hai loại core, tiền/hạn bắt buộc hoặc phải khai thiếu. | Bắt đầu từ doanh nghiệp+BCTC; tránh bịa ngữ cảnh hoặc đoán Chưa rõ. | Domain cũ còn làm entry chính. | Thêm “Tạo hồ sơ đánh giá doanh nghiệp”, giao dịch tùy chọn sau BA/contract duyệt → người mới tạo hồ sơ không khai giao dịch giả. |
| UX-02 P1 | A#assessment/M02; E66 | Chọn 2025→M02: “Đã xác minh”, Tiền “Chưa xác minh”, kết quả chung stale. | Nêu xác minh của bản lưu và dữ kiện hiện hành riêng; tránh hiểu metric đủ nguồn hiện tại. | Component bản lưu ghép với facts hiện hành trong fhi-breakdown. | Nguồn theo snapshot hoặc diff rõ, badge “Bản lưu đã cũ” → đổi verification phải nhất quán ở header/badge/source/ack; score vẫn null. |
| UX-03 P1 | A#assessment; E62/E81 | Chọn 2024 hoặc để stale: điểm trống nhưng Điểm mạnh vẫn “đạt điểm tối đa”. | Nhận định có năm/currentness; tránh chép kết luận cũ cho năm mới. | Guard điểm chưa áp cho narrative. | Tách nhận định “Bản lưu 2025 — không dùng cho kỳ đang chọn” → thử 2024/2025/rev4/latest/reload không gán nhầm narrative. |
| UX-04 P1 | A#overview/#assessment; E02/E59/E60 | Health “Hoàn tất” trong khi cần chọn BCTC, chạy lại và chưa có điểm. | Phân biệt xử lý xong với đủ điều kiện; tránh tưởng hồ sơ đã hoàn thiện. | Job completed là nhãn trạng thái ưu tiên. | “Đã có kết quả lưu — cần cập nhật” và “Chưa đủ dữ liệu phát điểm” → thử stale/missing, không còn Hoàn tất đơn độc. |
| UX-05 P2 | A#assessment; E60–62 | Header/context/method card lớn; readiness và next action dưới fold, kể cả 1920. | Màn đầu cho biết trạng thái, lý do và bước tiếp theo; giảm cuộn khi báo quản lý. | Các section ngang cấp; method chiếm một phần ba hàng kết quả. | Summary gọn, blockers/CTA cạnh status, method vào detail → kiểm 1280/1440/1920 thấy hành động chính ngay. |
| UX-06 P1 | A#assessment; E81/E83 + AX | Hai bộ 2024/2025 chỉ xem riêng; không tìm thấy bảng trend hoặc nhận xét biến động. | So sánh nhiều năm với kỳ/basis/currency/source; selector chưa đáp ứng nhiệm vụ. | UI/contract theo từng bộ; handoff cũng ghi gap. | Thiết kế bảng so sánh với backend xác định tương thích và opening/closing → thử khác basis/unit/kỳ, thiếu năm; không tự suy trend ở FE. |
| UX-07 P1 | A#assessment/#history; E18/E62 | Chỉ thấy tải văn bản yêu cầu bổ sung, không thấy báo cáo sức khỏe để trình quản lý. | Summary có nguồn, giới hạn và thời điểm; hiện thiếu deliverable cuối. | Output tập trung vào document request. | Mẫu report và contract export riêng sau duyệt → preview/download đúng pháp nhân/kỳ/version, không nhầm request export. |
| UX-08 P1 | A#assessment/readiness; E60/E66 + AX | Run disabled; blocker bridge/tài sản nhanh chỉ là câu chữ, không tới field cần xử lý. | Biết thiếu gì, nguồn nào, xử lý ở đâu; tránh đoán và đi vòng. | Blocker được dịch text nhưng chưa có action mapping. | Checklist có metric/fact/source và CTA focus đúng field → thử M02/M04, quay về giữ năm. |
| UX-09 P2 | A#assessment/editor; E24/E25 | Modal hẹp chứa 14 fact với nhiều ô; Save cuối form dài. | Rà nhiều số nhưng giữ scope, nguồn và trạng thái lưu. | Modal chung chứa toàn registry. | Workbench rộng hoặc các bước Scope→Dữ kiện→Nguồn, footer cố định và dirty guard → keyboard/source-return/cancel ở 1280/1440. |
| UX-10 P2 | A#assessment/ratios; E26-3/E26-6/E83 | Vốn 0.4, margin 0.2, CFO 0.08, current 2 thiếu đơn vị %/lần rõ. | 40%, 20%, 8%, 2 lần kèm raw detail; tránh đọc 0.08 thành 0.08%. | Formatter decimal chung chưa có đơn vị theo metric. | Formatter theo tỷ số/locale, giữ precision gốc → VI/EN/ZH không đổi công thức hoặc rounding server. |
| UX-11 P2 | A#assessment/ratios2024; E83 | M05 “—” nhưng “Có kết quả tính toán”; không nêu ngoại lệ cụ thể đang áp dụng. | Phân biệt ngoại lệ không áp dụng với missing/error. | Exception map vào badge tính xong trong khi raw_ratio null. | Nhãn ngoại lệ không có nợ/lãi khi server trả đúng trường hợp; M04 vẫn blocked → thử 0 nợ/0 lãi và có nợ/0 lãi, không Infinity hoặc phát điểm sai. |
| UX-12 P2 | Upload; E08 | Heading/quota “Chỉ PDF”, dropzone “PDF hoặc ZIP”; chưa rõ control/quota ZIP. | Hướng dẫn định dạng nhất quán để không chọn nhầm file. | Copy của hai luồng intake chưa tách. | Chọn PDF/ZIP và giới hạn tương ứng → upload synthetic trong môi trường được phép, thử reject/retry; giữ guard. |
| UX-13 P2 | Upload/type; E08/E20 | “Danh sách chỉ gồm các loại API đã hỗ trợ…”, khuyên chọn Khác; Đề nghị vay còn trong danh sách. | Hướng dẫn theo tác vụ, nêu hạn chế extraction mà không bắt hiểu API. | Guidance kỹ thuật vào help nghiệp vụ. | Copy “Chưa thấy loại phù hợp? Chọn Khác; một số nội dung cần nhập/kiểm tra thủ công” → VI/EN/ZH giữ hạn chế, không API guidance thường. |
| UX-14 P2 | B#files/correction; E53–57 | Form sửa/verify/classify có quote hoặc giá trị, thiếu nút mở nguồn ngay tại form. | Đối chiếu đúng version/page khi sửa, không phải đóng form để nhớ số. | Form tác vụ tách callback/context viewer. | Xem nguồn cạnh field, giữ draft/focus khi quay về → sửa synthetic chưa lưu, mở PDF, đóng, không mất nháp hoặc tự verify. |
| UX-15 P1 | A#assessment/verify; E23 | Form checkbox và bridge không có source link, kỳ/đơn vị/trạng thái hiện hành mỗi dòng. | Xác minh có context; tránh tick theo trí nhớ/hàng loạt. | Verify form tối giản danh sách chọn. | Scope và source/status từng hàng, review bridge có nguồn, count cố định → thử chọn/bỏ/đổi nguồn/stale/cancel; save trên synthetic riêng sau có rollback. |
| UX-16 P1 | B#files→#assessment; E52/E58 | Extraction 5/9; tổng tài chính còn trống giá trị hiệu lực; registry chưa có bộ dữ kiện. | Đường hoàn thiện facts có pháp nhân/kỳ/nguồn; hiện hành trình bị đứt. | Extraction và registry tách workflow; grounding bảng chưa đủ. | Queue dữ kiện cần hoàn thiện và nhập có evidence; backend/OCR xử lý cột kỳ → thử PDF→fact→verify→readiness; sai năm/pháp nhân phải chặn. |
| UX-17 P2 | B#files/library; E45–47/E51 | Nhiều file cùng tên/năm, hai v1 và v3; grouping theo loại còn hiện LIVE. | Phân biệt lineage/version/current để chọn đúng nguồn. | Filename+version chưa đủ nhận diện chuỗi tài liệu. | Nhóm chuỗi phiên bản, current badge, ngày nguồn; LIVE trong detail → mở đúng v1/v3, về đúng filter, không tự chuyển latest. |
| UX-18 P2 | B#files/status; E44/E45 | Receipt hoàn tất nhưng có “Tài liệu5 Thất bại”; retry khóa, job thiếu tên file rõ. | Phân biệt receipt/job cũ/nguồn hiện hành và cách xử lý. | Các summary khác scope/time có nhãn ngang cấp. | Job có tên/version/time, lý do khóa retry, CTA phù hợp → stale job không đè kết quả mới; đọc rõ thành công/lỗi trong history. |
| UX-19 P2 | A#assessment/reload; E33/E80 | Chọn năm/history→reload hoặc remount→chưa chọn/latest. | Giữ context khi quay về; không lưu hồ sơ nhạy cảm vào localStorage. | Selection chỉ ở useState của màn. | ID trong route/query hoặc navigation state, revalidate ACL/version → reload/Back/Forward giữ đúng; invalid/foreign ID không lộ dữ liệu. |
| UX-20 P2 | A tablist; E68/E69 | Focus Sức khỏe→Ctrl+Home→Overview, tái hiện hai lần. | Ctrl+Home cuộn đầu trang; Home đơn vẫn điều hướng tab. | Handler Home/End không xét modifier. | Bỏ qua Ctrl/Meta/Alt trong tab handler → thử Home/End/Arrow và Ctrl+Home/End, focus/hash không nhảy sai. |

Điểm nhỏ ngoài Top20: native required báo English trong VI (E13/E37); datepicker tháng/ngày ở form VI (E24); label lặp trong form dài; quốc gia mã VN và các ô provenance thiếu ví dụ (E36). Chưa đo contrast ratio, không kết luận vi phạm WCAG bằng cảm giác.

## 6. Business completeness — đối chiếu BA / spec / UI

Nguồn ưu tiên cho mục tiêu lượt audit là brief chủ dự án giao. Phase C mới đọc các nguồn sau:

- N1: [00 — Báo cáo tổng hợp và kế hoạch triển khai](https://app.notion.com/p/1790c2f0937d8344bc9781bc9b4efd32).
- N2: [11 — Nghiệp vụ và Frontend mở rộng](https://app.notion.com/p/83e0c2f0937d82848f6081a001d0b767).
- N3: [12 — Frontend hiện hành và tích hợp](https://app.notion.com/p/9cd0c2f0937d82499c448102014376f1).
- N4: [13 — AIC Rating Methodology v1.0 — Internal Pilot](https://app.notion.com/p/bf10c2f0937d832d936281ed21fe903f).
- Local: AIC-CHROME-RESUME-RESULT-2026-10-18.md; AIC-UX-REDESIGN-DECISIONS-2026-10-18.md; AIC-FULL-UX-CHROME-UAT-2026-10-18.md trong docs/implementation; apps/web/docs/specification/current-sync.md; README và trích source hẹp để định vị module sửa.

Fetch Notion trả last_edited_at 16/10/2026 08:34:14.305Z, verification.state=unverified; không thấy cờ truncated/unknown_block_count trong kết quả trả. Không suy metadata này thành BA approval mới. N1/N2 còn ghi RECEIVABLE/PREPAYMENT là core; N3 còn ghi chín nhóm writes CONTRACT_NOT_RELEASED, policy unconfigured. UI local có dữ liệu workflow lưu sẵn và “Đã cấu hình pilot”; handoff 18/10 ghi runtime mới. Đây là **khác biệt mốc tài liệu/runtime**. Không dùng trạng thái 16/10 phủ định UI 18/10, cũng không tự sửa Notion hay xác nhận mọi write đã phát hành. Trong lượt UI này chưa gặp CONTRACT_NOT_RELEASED trên đường đã thử; writes chưa submit vẫn chưa được nghiệm thu.

| Yêu cầu trong brief / spec liên quan | Điều thấy trực tiếp trên màn hình | Coverage nghiệp vụ | Gap / phân biệt |
| --- | --- | --- | --- |
| Onboarding cho chuyên viên mới | Hero rõ nhưng CTA giao dịch, phiên đăng nhập sẵn | FOUND & TESTED một phần; login BLOCKED BY DATA OR ACCESS | Chưa có bằng chứng từ login tới báo cáo |
| Danh sách doanh nghiệp/hồ sơ, đúng pháp nhân | Có danh sách, search và form tạo/sửa; pháp nhân case và nguồn cần reviewer đối chiếu | FOUND & TESTED đọc/form; saves FOUND BUT NOT TESTED | Không tự xác minh pháp nhân từ tên file hoặc MST khai báo |
| Đánh giá doanh nghiệp nói chung | Entry và fields còn yêu cầu ngữ cảnh giao dịch | MISSING entry độc lập trong vùng khảo sát | Xung đột brief mới với N1/N2; cần quyết định model/contract, giữ lịch sử |
| RECEIVABLE/PREPAYMENT | Hai option tạo, vai trò đổi đúng; mở case cả hai | FOUND & TESTED một phần | N1/N2 vẫn core; chưa có yêu cầu xóa toàn module |
| Tự cho vay/hạn mức/kỳ hạn/PD | Không thấy recommender/approve loan; có loại Đề nghị vay và filter luồng phụ | OUT OF CURRENT BA SCOPE đối với recommender/quyết định cho vay | Không coi nhãn khoản vay cũ là chức năng phê duyệt đã chạy |
| One-ZIP/PDF intake và trạng thái | Có upload form, receipt ZIP và job status lưu sẵn | FOUND BUT NOT TESTED đầu-cuối mới | Không upload hoặc gọi AI thêm; quota chưa thử |
| Danh sách/viewer/version/page/quote | Có library, filter, PDF v3/trang 2/zoom, quote, return | FOUND & TESTED | Source download và hash disclosure chưa thử |
| OCR review/correction/verified/evidence | Review 5/9, form correction/classification/verify, nguồn đúng trang | FOUND & TESTED đọc/form; writes FOUND BUT NOT TESTED | 5 usable không là 5 verified; chưa đủ bộ tài chính |
| Registry/kỳ/basis/currency/unit/source | Hai bộ synthetic, 14 fact/bộ, form nguồn | FOUND & TESTED đọc/form | Hồ sơ thật chưa có bộ đủ điều kiện; save gate chưa rerun |
| Bảy metric/per-year/readiness/FHI | Mở đủ bảy; 2024 EBITDA bị chặn; 2025 unverified/stale; điểm trống | FOUND & TESTED negative/display; positive BLOCKED BY DATA OR ACCESS trong lượt này | 82,5/F2 handoff là synthetic lịch sử, không current PASS |
| Verification nhất quán | M02 verified cùng Tiền unverified | PRESENT BUT BROKEN về diễn giải trạng thái | Không là bằng chứng backend đã phát điểm trái gate |
| Trend đa năm và opening/closing | Chỉ selector/history, không bảng trend | MISSING trong UI khảo sát | Không coi chọn năm là phân tích đa năm |
| Strengths/weaknesses/findings/action | Có sections, findings/flags, readiness | FOUND & TESTED; PRESENT BUT BROKEN ở narrative cũ | Blockers thiếu liên kết tới field; tên sáu nhóm phi tài chính không chứng minh narrative đầy đủ |
| Request/history | Approved record, form nháp/ack/hủy, history Next | FOUND & TESTED đọc/form; writes FOUND BUT NOT TESTED | Không gửi email hoặc lời mời ra ngoài |
| Search/filter/i18n | Search/filter danh sách; library nhóm/lọc loại; VI/EN/ZH assessment | FOUND & TESTED lấy mẫu | Global search, sort và mọi form/locale chưa thử |
| Export/share báo cáo sức khỏe | Chỉ thấy request export; file download chưa xác minh | MISSING health-report control; request export BLOCKED BY DATA OR ACCESS/tooling | Request export không thay health report |
| Failure/permission/retry/relogin | Có job error, retry disabled; restart stack đọc lại được | FOUND & TESTED trạng thái sẵn; role/tenant/relogin BLOCKED BY DATA OR ACCESS | Không mock faults hoặc suy production acceptance |

## 7. Information architecture và copy redesign đề xuất

Trang đầu nên trả lời ngay: doanh nghiệp nào, kỳ nào, nguồn đã đủ chưa, hồ sơ nào cần xử lý. CTA “Tạo hồ sơ đánh giá”; danh sách ưu tiên tên/MST/quốc gia, kỳ cập nhật, trạng thái đủ dữ liệu, việc cần làm và trạng thái kết quả. Tiền/thời hạn giao dịch đặt ở phần mở rộng khi nghiệp vụ cần. Giữ hồ sơ cũ và metadata nguồn.

Trang đánh giá: pháp nhân + kỳ + basis + đơn vị → trạng thái hiện hành và giới hạn thử nghiệm/synthetic → lý do/next action → nhận định đúng kỳ → so sánh năm nếu đủ dữ liệu → bảy metric → facts/evidence/history → phương pháp/chi tiết kỹ thuật. Khi stale, cả narrative và verification phải có mốc phiên bản; không chỉ ẩn số điểm. Không đổi null thành 0 hoặc tính score/PD ở FE.

### Thuật ngữ đã gặp trên UI và vị trí đề xuất

Danh mục sau chỉ gồm thuật ngữ/metadata gặp trong các vùng đã đọc. Tên pháp nhân và quote nguồn giữ nguyên. Trạng thái xác minh, nguồn, hạn chế mô hình và nhãn synthetic vẫn phải rõ; chỉ metadata sâu mới thu gọn.

| Term/copy hiện thấy — vị trí | Nhãn VI / EN / ZH đề xuất | Vị trí chi tiết / nguyên tắc |
| --- | --- | --- |
| Tạo giao dịch — /cases | Tạo hồ sơ đánh giá / New business assessment / 新建企业评估 | Ngữ cảnh giao dịch ở bước tùy chọn sau BA/contract duyệt |
| Bán chịu/Trả trước — header, form, filter | Bán chịu / Trade credit / 赊销; Trả trước / Prepayment / 预付款 | Giữ tên nghiệp vụ, giải thích vai trò; không xóa module |
| SYNTHETIC Buyer Alpha, SYNTHETIC-FHI-UI-20261018, KIEM-THU-* — name/ref/list | Dữ liệu minh họa / Illustrative test data / 测试示例数据 | Banner luôn rõ; giữ tên gốc và ref trong chi tiết ngữ cảnh |
| Đoạn cảnh báo minh họa lặp ở từng fact | Nhãn minh họa nhất quán / Test-data label / 测试数据标识 | Banner cho section và nguồn từng fact khi mở; giảm lặp đoạn dài |
| AIC-FHI-1.0/1.0.0 — card và heading | Phương pháp AIC thử nghiệm / Experimental AIC method / AIC试验方法 | Version đầy đủ ở phương pháp; CHƯA KIỂM ĐỊNH luôn thấy |
| PD — cảnh báo/hạn chế | Chưa ước tính xác suất vỡ nợ / Default probability not estimated / 尚未估计违约概率 | Giới hạn trọng yếu ở summary; PD trong glossary, không tạo số |
| AIC-F1..F5 — được brief/spec mô tả; chưa thấy band số hiện hành | Mức sức khỏe tài chính thử nghiệm / Experimental financial health band / 试验性财务健康分档 | Khác credit grade; không giả lập band cho ảnh audit |
| Lần cập nhật/Revision 31→32 — header/history | Cập nhật lúc… / Updated at… / 更新于… | Số revision trong timeline đối chiếu; không bỏ truy vết |
| v1/v3; synthetic-fhi-2025-v1 — library/form | Phiên bản nguồn / Source version / 来源版本 | Version cạnh nguồn; phân biệt lineage, không bắt đoán hash |
| LIVE · chế độ dịch vụ AI — library Theo loại | Trích xuất bằng AI / AI extracted / AI提取 | Chưa xác minh vẫn rõ; provider mode trong chi tiết xử lý |
| “các loại API đã hỗ trợ” — upload help | Các loại tài liệu có thể đọc / Supported document types / 支持的文件类型 | API vào chi tiết kỹ thuật; hạn chế extraction vẫn rõ |
| Giá trị hiệu lực — metric/OCR/form | Giá trị đang dùng / Value used / 当前采用值 | Cạnh giá trị gốc và nguồn; không ngụ ý đã verified |
| Số thập phân gốc — BCTC form | Số liệu theo tài liệu / Source amount / 原始金额 | Ví dụ format và đơn vị; giữ precision gốc trong detail |
| Hệ số đơn vị, VND ×1 — form/scope | Đơn vị: đồng/nghìn/triệu / Unit: base/thousand/million / 单位：元/千/百万 | Hệ số chính xác ở chuẩn hóa; không tự đổi FX |
| Cơ sở/Riêng lẻ/Hợp nhất — selector/form | Phạm vi BCTC / Statement basis / 报表口径 | Hiện rõ khi so sánh; giải thích ngắn riêng lẻ/hợp nhất |
| EBIT/EBITDA — metric/bridge | Lợi nhuận hoạt động / Operating profit / 营业利润; EBITDA có cầu nối / Bridged EBITDA / 有依据的EBITDA | Giữ đúng chỉ tiêu, công thức và nguồn; không thay thế chỉ tiêu |
| Thành phần tài sản nhanh không trùng — verify | Đã kiểm các khoản không bị tính hai lần / Checked for double counting / 已检查重复计入 | Cạnh đúng fact/nguồn; glossary tài chính mở được |
| Bản ghi phê duyệt/mã tham chiếu nội bộ — history | Bản lưu đối chiếu / Audit record / 审核留档 | Disclosure hiện có phù hợp; raw payload không là nút tải chính |
| “1234” trong ghi chú event xác minh — history | Giữ ghi chú người rà soát / Reviewer note / 审核备注 | Không đoán là backend ID; tách note với system metadata |
| “Group by” — accessible name library tablist | Nhóm tài liệu / Group documents / 文件分组 | Localize accessible label cùng nhãn visible |
| “Please fill out this field”, ngày MM/DD/YYYY — form VI | Vui lòng nhập trường bắt buộc / Required field / 请填写必填项 | Native message tùy browser; app có inline validation và ngày theo locale |

Các token total_assets, fact_key, source_type, verified raw enum, null, ID/hash, đường dẫn docs, stack trace và SYNTHETIC TECHNICAL FIXTURE ONLY **không thấy nguyên văn trên màn thường đã khảo sát**. Hash ở disclosure đối chiếu nguồn chưa expand; không ghi là leak đã quan sát. Không gán raw kỹ thuật từ code vào bằng chứng UI.

## 8. Visual design quality và UI system đề xuất

Giao diện có nền sáng, sidebar xanh đậm, card trắng/viền mảnh, icon và spacing tương đối nhất quán; tiếng Việt/Trung render được. Nhãn trạng thái có chữ nên không chỉ dựa màu. Đây là điểm tốt đã thấy, chưa phải chứng nhận accessibility AA.

| Khu vực | Vấn đề cụ thể / tác động | Hướng sửa |
| --- | --- | --- |
| Assessment 1280/1440 | Header/context/tabs/cảnh báo chiếm phần lớn viewport; lý do chặn và next action dưới fold | P1/P2: summary gọn, method metadata thu gọn, blocker/CTA sát status |
| Assessment 1920 | Card weakness rỗng và method ít nội dung vẫn chiếm diện tích; khoảng trống không giúp so sánh | P2: grid theo nội dung, summary hai vùng; chart/table chỉ khi đủ nguồn |
| BCTC editor | Modal hẹp, dài, nhiều label lặp và hai lớp scroll; khó giữ kỳ/đơn vị khi rà fact cuối | P1/P2: workbench, sticky context/footer; số và nguồn cùng hàng |
| Metric modal | Cảnh báo minh họa lặp; badge xanh verified mâu thuẫn dễ gây đọc lướt sai | P1: ưu tiên currentness/verification, nguồn và phương pháp có vị trí riêng |
| Files/job history | Receipt, cards, status và nút nguồn dàn dài; file/version trùng | P2: queue công việc có action; phân biệt thiếu dữ liệu với lỗi hệ thống |
| Typography/caption | MST/version/kỳ chữ nhỏ màu xám; tỷ số thiếu đơn vị và decimal locale | P2: body 14–16px, caption 12–13px có contrast đo được; số tabular, %/lần rõ |

UI system đề xuất: nhịp 4/8px, khoảng cách section 16/24px; heading 24–28px, section heading 18–20px; line height phù hợp tiếng Việt/Trung. Xanh đậm là màu chính, amber cho cần xử lý, green chỉ cho trạng thái đúng phạm vi. Tách job/currentness/readiness/verification bằng nhãn. Đo contrast và thử keyboard/browser zoom 200% trước nghiệm thu. Đây là target thiết kế, chưa sửa CSS hoặc đo đạt.

### Before → after cho ba màn ưu tiên — mô tả, chưa triển khai

1. **Danh sách — E01.** Chú thích ảnh: trên phải là “Tạo giao dịch”; giữa là tiền/ngày lịch, thiếu readiness. After: “Tạo hồ sơ đánh giá”; hàng doanh nghiệp có kỳ/trạng thái/việc cần làm; ngữ cảnh giao dịch mở rộng. Giữ nhãn minh họa và định danh nguồn.
2. **Sức khỏe — E62/E81.** Chú thích ảnh: hàng ba card có hai giá trị — và method version; Điểm mạnh cũ bên dưới, readiness chưa vào khung. After: pháp nhân+kỳ+currentness; “Chưa đủ điều kiện phát điểm” cùng lý do/CTA; nhận định cũ tách rõ; trend và evidence truy cập ngay. Không vẽ trend thiếu nguồn.
3. **Dữ kiện — E24.** Chú thích ảnh: modal giữa chỉ thấy scope phía trên; facts và Save sâu phía dưới. After: bảng nhập rộng, scope luôn hiện, source pane khi chọn, footer Lưu/Hủy với trạng thái nháp. Không tự xác minh khi sửa chỉ tiêu.

Ảnh gốc kèm chú thích vị trí ở trên; không có mockup hoặc ảnh “đã sửa”, không trình bày cải tiến như đã implement.

## 9. Constraints, confidence và not-tested

- **Confidence cao** cho state/control/text đã đọc qua Chrome: M02 mixed verification, mất năm sau reload, Ctrl+Home đổi tab, viewer/page/zoom/return, dirty guard. Việc chưa tìm thấy trend/report giới hạn trong navigation đã duyệt.
- **Confidence vừa** cho discoverability và visual hierarchy. Đây là agent role test, chưa có usability study với người thật; không đếm toàn click hay lấy tool roundtrip làm thời gian người dùng.
- Login, tenant khác, 403, đổi tài khoản: chưa có account/credentials phù hợp. Không logout phiên dùng chung rồi không thể phục hồi. Handoff cũ có PDF/relogin PASS không là rerun lượt này.
- Không có positive FHI/write acceptance mới. Buyer Alpha đang stale, Tiền 2025 unverified; không nâng verification để khôi phục 82,5. Không kiểm lại tính đúng mọi component/band boundary. PD=null là phạm vi yêu cầu; không đọc HTTP payload để chứng minh field.
- HK VINA: chỉ đọc nguồn/trích xuất lưu sẵn; 5/9 usable chưa đủ verified FHI. Không chép số BCTC/địa chỉ/điện thoại/MST trên tài liệu thật vào report. Ảnh viewer/extraction giữ ngoài Git, chỉ dùng nội bộ.
- Upload/ZIP/quota/corrupt/encrypted/source mutation/concurrent409/retry positive/AI: NOT RUN. Chưa có kế hoạch rollback không phá lịch sử cho record test mới, nên không tạo/upload/rerun mutation. Đợt sau cần case synthetic có owner, lý do và ID từng operation, giữ lịch sử; không xóa DB chính.
- Export: đã click request export nhưng event không về trong 12 giây, chưa có file được công cụ xác nhận. Browser policy chặn chrome://downloads vì protocol không được phép; không vượt qua CDP/OS/filesystem. Ghi BLOCKED, chưa kết luận lỗi ứng dụng. Không gửi yêu cầu ra đối tác.
- Mobile/tablet, browser zoom 200%, screen reader, forced colors, contrast measurement, mọi form × ba locale: NOT RUN. PDF zoom 150% là ca khác.
- Một số ảnh chụp sát chuyển trạng thái còn frame trước: E16 là guard, E27 không chứa header năm, E39 là list, E59 là overview; đã loại khỏi chứng minh sai nội dung và bổ sung E66/E81/E82/E83. Ảnh loading không là load failure; E50b là trang 2 đã render.
- Không chạy lint/build/test suite để thay UI. Chỉ đọc source hẹp sau first-use để định vị hypothesis/module; không audit toàn codebase.

## 10. Next-action checklist sau khi owner duyệt

Backlog sau đã cụ thể để review, chưa triển khai trong audit. Chưa có P0 tái hiện. P1 xử lý trước; P2 có quick wins. Các path dưới tương đối với apps/web/src và đã xác nhận tồn tại sau Phase A, trừ module mới được nêu rõ.

| Task / ưu tiên | File/module dự kiến | Acceptance criteria bắt buộc browser |
| --- | --- | --- |
| T01 P1 — snapshot, verification, narrative; UX02–04 | features/assessments/components/risk-assessment.tsx; fhi-breakdown.tsx; hooks/use-assessment.ts; features/cases/components/transaction-overview.tsx | Stale/khác kỳ/unverified không có badge/narrative hiện hành nhầm mốc; điểm/band/ack giữ gate; thử hai năm, rev4 và latest |
| T02 P1 — readiness thành việc làm được; UX08 | risk-assessment.tsx; features/financial/components/financial-registry.tsx; features/cases/components/workspace.tsx | Blocker đến đúng fact/source/bridge; quay về giữ năm; không tự xác minh |
| T03 P1 — entry đánh giá doanh nghiệp; UX01 | features/cases/components/case-list.tsx; transaction-dialog.tsx; features/counterparties/components/counterparty-dialog.tsx; lib/i18n | BA/BE duyệt model trước; tạo hồ sơ không khai tiền/hạn giả; giao dịch cũ vẫn mở đúng |
| T04 P1 — nguồn→registry; UX14–16 | features/documents/components/extraction-review.tsx; field-correction.tsx; document-classification.tsx; financial-registry.tsx; features/evidence/components/source-viewer.tsx | Case test được duyệt: quote/page/version đúng; mở nguồn giữ draft; xác minh đúng fact; sai pháp nhân/kỳ bị chặn; không nới OCR guard |
| T05 P1 — so sánh đa năm; UX06 | features/financial và features/assessments; API/contract design riêng | Backend xác định kỳ/basis/unit tương thích; bảng có nguồn; thiếu nguồn không vẽ trend; thử closing/opening không khớp |
| T06 P1 — report cho quản lý; UX07 | features/assessments; features/evidence; module/contract export mới | Preview/export đúng pháp nhân/kỳ/source/method/currentness; synthetic/experimental rõ; không PD hoặc loan recommendation |
| T07 P2 quick win — copy/đơn vị/ngoại lệ; UX10–13 | features/financial/labels.ts; financial-registry.tsx; lib/i18n/product-copy.ts; messages.ts; features/documents/components/upload-dialog.tsx | %/lần đúng; raw precision còn trong detail; M05 ngoại lệ khác missing; PDF/ZIP nhất quán; VI/EN/ZH không có API guidance thường |
| T08 P2 — phân cấp và workbench; UX05/09 | styles/enterprise.css; styles/index.css; financial-registry.tsx; assessments/components | 1280/1440/1920 thấy status/lý do/CTA; scope/source/save dễ đọc; keyboard và browser zoom 200% thật |
| T09 P2 — lineage và job actions; UX17/18 | features/documents/components/document-explorer.tsx; document-groups.tsx; dossier-archive-banner.tsx; documents.tsx | Phân biệt v1/v3/current và job cũ; nguồn trả đúng filter; retry disabled có lý do và bước xử lý |
| T10 P2 quick win — selection/keyboard; UX19/20 | features/cases/components/workspace.tsx; risk-assessment.tsx | Reload/Back/Forward giữ năm/history; foreign/invalid ID không lộ nguồn; Home/End/Arrow đúng tablist; Ctrl+Home/End không đổi tab |

Owner cần chốt ưu tiên và phạm vi doanh nghiệp–giao dịch với BA trước thay đổi lớn. Không commit/push tự động.

## 11. Evidence index và cách tái kiểm

Evidence root ngoài Git: C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/.

E01 là file prefix 01-; E26-2..E26-7 là sáu ảnh metric; E50b là ảnh PDF đã render; E83 là tỷ số/ngoại lệ 2024. evidence-manifest.json ghi đường dẫn, SHA-256, kích thước và metadata thời gian file; không chứa PDF/token/credential. File modification time không thay đồng hồ click. Các mốc replay lấy từ tool observations.

First-impression: phase-a-first-impression.json. AX lưu riêng cho form tài chính, metric2–7, Chinese assessment, lỗi kết nối và bảng tỷ số cuối; phần còn lại ở tool transcript. Ảnh viewport không chứng minh mọi nội dung ngoài fold.

Ảnh có tài liệu thật chỉ mở nội bộ, không chép vào Git hoặc báo cáo công khai. Các ảnh ưu tiên đã kiểm hình: E01, E08, E23, E24, E52, E60–62, E66, E82, E83. E16/E27/E39/E59 có giới hạn nội dung đã ghi rõ; không lấy filename làm bằng chứng.

### Liên kết ảnh tiêu biểu

- [01-first-impression.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/01-first-impression.jpg)
- [08-upload-form.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/08-upload-form.jpg)
- [17-dirty-confirmation.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/17-dirty-confirmation.jpg)
- [23-financial-verification.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/23-financial-verification.jpg)
- [24-financial-edit.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/24-financial-edit.jpg)
- [33-reload-loses-year.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/33-reload-loses-year.jpg)
- [45-document-library.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/45-document-library.jpg)
- [49-viewer-loaded.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/49-viewer-loaded.jpg)
- [50b-viewer-page2-loaded.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/50b-viewer-page2-loaded.jpg)
- [52-extraction-review.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/52-extraction-review.jpg)
- [60-assessment-1440-actual.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/60-assessment-1440-actual.jpg)
- [61-assessment-1280.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/61-assessment-1280.jpg)
- [62-assessment-1920.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/62-assessment-1920.jpg)
- [66-quick-ratio-verification-conflict.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/66-quick-ratio-verification-conflict.jpg)
- [68-keyboard-before-ctrl-home.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/68-keyboard-before-ctrl-home.jpg)
- [69-keyboard-ctrl-home-changes-tab.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/69-keyboard-ctrl-home-changes-tab.jpg)
- [71-resume-connection-refused.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/71-resume-connection-refused.jpg)
- [72-after-launcher.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/72-after-launcher.jpg)
- [81-mismatched-year-header.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/81-mismatched-year-header.jpg)
- [82-case-create-receivable-settled.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/82-case-create-receivable-settled.jpg)
- [83-ratio-zero-interest-and-units.jpg](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/83-ratio-zero-interest-and-units.jpg)

[Danh mục đầy đủ 89 ảnh, kèm SHA-256](C:/Users/52duc/.codex/visualizations/2026/10/18/01a14d3d-eae1-7260-a738-39d669f0eae9/aic-ux-audit/evidence-manifest.json).
