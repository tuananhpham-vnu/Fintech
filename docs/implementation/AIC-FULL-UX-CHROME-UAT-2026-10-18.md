# AIC — Full UX / Chrome UAT, 18/10/2026

**UI_REDESIGN_STATUS: PARTIAL.** 32 nhóm màn/trạng thái đã quan sát; 42 ca UI trong bảng đã đạt trong phạm vi nêu; 41 file source frontend thay đổi so với baseline UX. Có bằng chứng Chrome thật cho các ca bên dưới; không tuyên bố toàn app production PASS. Bản sửa và định hướng ở [quyết định thiết kế](AIC-UX-REDESIGN-DECISIONS-2026-10-18.md). Checkpoint trước UX ở [báo cáo trước](AIC-CHROME-RESUME-RESULT-2026-10-18.md).

## Môi trường và cách nghiệm thu

- Ngày 18/10/2026, Asia/Saigon; phiên UX kéo dài qua nhiều checkpoint, các lượt cuối khoảng 10:32–11:07. Giờ chính xác theo ảnh/file và tool output; không suy thời gian từ tên file.
- Repo Fintech, branch `duc`, HEAD `9bf0635e8d8e695e79491c1ce527a9562826faef`, thay đổi chưa commit. Không commit/push/deploy/Notion write.
- Windows, Chrome thật profile được chủ dự án kết nối qua extension; có một lần mất kết nối, người dùng mở lại. Một lần chờ tín hiệu download hết thời gian làm reset phiên công cụ; dùng tab mới, không đổi sang kiểm HTTP để giả nghiệm thu.
- Next production build local ở `http://127.0.0.1:3000`, Nest API 3001, AI 8100, PostgreSQL hiện có. Đây là build production chạy local, không phải public production đã nghiệm thu.
- Dùng nút, tab, form và menu thật qua Chrome; đọc DOM/AX, canvas và kích thước render để hỗ trợ quan sát. Không gọi fetch/API trực tiếp để tạo kết quả kiểm thử. Không chạy suite unit/integration/E2E hoặc seed DB. Lint/typecheck/build là cổng bổ sung, theo yêu cầu chủ dự án không dùng script test thay UI.
- Viewport màn chính được kiểm bằng kích thước thực DOM: 1440,1280,1920,1024,768,390px. Một lần browser-scoped override tác động tab khác; ảnh 1280 chỉ được ghi sau khi dùng override đúng tab và xác nhận `innerWidth=1280`.
- Ảnh riêng tại `%LOCALAPPDATA%/AIC/ux-evidence-20261018/`, ngoài Git. Ảnh bắt đầu `private-real-` chứa PDF thật, không dùng trong bàn giao công khai. Không chụp token lời mời, mật khẩu hoặc URL capability. Trích dẫn nguồn vẫn nguyên văn.

## Dữ liệu dùng và thay đổi qua UI

Hồ sơ minh họa FHI đã có: `SYNTHETIC-FHI-UI-20261018`. Bộ 2025 có 14 dữ kiện tổng hợp, kết quả từ backend 82,5/AIC-F2, bảy điểm thành phần 15/7,5/16/9/12/10/13. Bộ 2024 có EBIT, khấu hao, nợ vay, lãi vay bằng 0, tổng điểm/band không được phát do EBITDA không dương. Không sửa số liệu hoặc quy tắc tính trong đợt UX.

Đã tạo qua UI: một câu hỏi minh họa, một lời mời nội bộ, một câu trả lời tự khai, một yêu cầu bổ sung nội bộ, và một hồ sơ minh họa có điều kiện thanh toán. Lời mời đã thu hồi, bộ câu hỏi đã đóng; câu trả lời vẫn chưa xác minh. Rà soát mới dùng revision 22, đánh giá mới dùng revision 23, ghi nhận xem ở revision 24; yêu cầu nháp/duyệt đưa hồ sơ tới revision 26. Không gửi email/thông điệp cho bên ngoài. Sau khi duyệt yêu cầu, stale được tái hiện đúng, đã chạy lại review revision27 và assessment revision28: kết quả mới nhất vẫn82,5/AIC-F2. Kết quả revision28 chưa được ghi nhận xem; nút còn để người dùng thao tác.

Hồ sơ mới `SYNTHETIC-UX-CONDITIONS-20261018`, case `932abac9-7916-4362-850b-290f3175dfbe`, revision 1: giao dịch minh họa 1.000.000 VND, 30 ngày, điều kiện thanh toán dự kiến, có nội dung phạm vi/kích hoạt và nguồn khai báo. Không chạy điểm cho hồ sơ này. Không xóa dữ liệu kiểm thử sau UAT để giữ audit.

Hồ sơ PDF thật chỉ đọc lại nguồn v1/v3 và kiểm đăng nhập lại. Không thay số liệu, không tải PDF mới hoặc gọi AI mới trong đợt UX; không phát điểm doanh nghiệp thật. Đầu vào/grounding chưa hoàn thiện của hồ sơ thật là gap đã ghi trong checkpoint trước.

## Ma trận góc nhìn người dùng: 32 nhóm màn/trạng thái đã quan sát

`D` = thay đổi trực tiếp component/copy, `S` = dùng style/status/error chung. Tất cả hàng dưới là OBSERVED; PASS chỉ giới hạn thao tác nêu trong hàng, không suy ra mọi nhánh nghiệp vụ. `NR` = chưa nghiệm thu keyboard đầy đủ. Locale VI trừ nơi ghi thêm; viewport CSS px. Cột khoảng trống/hierarchy mô tả đánh giá quan sát, không phải khảo sát người dùng theo thời gian 5 giây.

| ID / màn, route và entry                   | Câu hỏi cốt lõi                 | Copy leak trước → sau / tác động                     | Hierarchy / khoảng trống                             | Next action                | Locale / keyboard / viewport        | Before → after (tên ảnh)                                                  | UI interaction                                               |
| ------------------------------------------ | ------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | -------------------------- | ----------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| M01 Login `/login`, đăng xuất              | Vào hồ sơ thế nào?              | Định vị giao dịch → tài chính; D                     | Heading/form phân cấp; story giữ có chủ đích         | Đăng nhập                  | VI / form / 1440                    | không chụp trước → after-login-1440                                       | PASS login/relogin                                           |
| M02 Cases `/cases`, menu                   | Chọn hồ sơ nào?                 | UUID fallback → tên/nhãn; D                          | List dày, hero ngắn; không card rỗng                 | Tìm/tạo                    | VI / NR / 1440                      | before-cases → after-cases-1440                                           | PASS filter                                                  |
| M03 Cases, không khớp bộ lọc               | Vì sao không thấy hồ sơ?        | Thông báo phạm vi trang rõ; S                        | Một empty state thay list                            | Sửa bộ lọc                 | VI / input / 1440                   | không chụp trước → after-cases-no-match-1440                              | PASS                                                         |
| M04 Tạo giao dịch, Cases→Tạo               | Nhập thông tin gì?              | Nguồn không raw JSON; D                              | Nhóm vai trò, tiền/kỳ, khai báo/điều kiện            | Tạo mới                    | VI / form / 1440                    | before-case-dialog → after-case-dialog-1440                               | PASS tạo case điều kiện                                      |
| M05 Counterparties `/counterparties`       | Tìm đối tác nào?                | Không thêm status xác minh giả; S                    | List gọn; tìm trong trang                            | Chỉnh sửa                  | VI / input / 1440                   | before-counterparties → after-counterparties-1440                         | PASS filter                                                  |
| M06 Chỉnh sửa đối tác                      | Dữ liệu được xác minh chưa?     | Cảnh báo lời khai giữ nguyên; S                      | Form modal, label rõ                                 | Lưu/đóng                   | VI / Esc / 1440                     | before-party-dialog → after-party-dialog-1440                             | PASS mở/đóng; không lưu                                      |
| M07 Overview `#overview`                   | Hồ sơ đang ở đâu?               | Metadata kỹ thuật → summary 3 nhóm; D                | Điều kiện thu gọn; CTA rõ                            | Xem tài liệu/đánh giá      | VI / NR / 1440,768                  | before-overview → after-overview-1440                                     | PASS tab/CTA                                                 |
| M08 Files trống `#files`                   | Bổ sung nguồn ở đâu?            | Quota/loại tệp giữ rõ; S                             | Không thêm card số giả                               | Tải PDF                    | VI / NR / 1440                      | before-files → after-files-1440                                           | PASS empty/upload entry                                      |
| M09 Files có dữ liệu thật                  | Nguồn nào cần kiểm tra?         | Job UUID → Tài liệu theo thứ tự; D                   | Summary/work queue; file có việc cần xử lý           | Xem nguồn/rà trường        | VI / NR / 1440                      | trước trong checkpoint → ảnh private PDF                                  | PASS đọc nguồn; upload mới NR                                |
| M10 Upload modal                           | Tệp nào được nhận?              | Option ID → tên tài liệu; D                          | Trường nguồn bắt buộc, limits rõ                     | Chọn PDF/ZIP               | VI / Esc / 1440                     | không chụp trước → after-upload-dialog-1440                               | PASS mở/đóng, không upload                                   |
| M11 Review `#review`                       | Thiếu gì và vì sao?             | Policy/rule IDs khỏi strip; D                        | Tên phát hiện/lý do/CTA rõ                           | Xử lý hoặc yêu cầu         | VI / NR / 1440                      | before-review → after-review-1440                                         | PASS chạy rà soát                                            |
| M12 Xử lý phát hiện                        | Căn cứ xử lý là gì?             | Raw keys không render; D/S                           | Modal một việc; lý do bắt buộc                       | Lưu/đóng                   | VI / Esc / 1440                     | không chụp trước → AX trong phiên                                         | PASS mở/đóng; không quyết định thật                          |
| M13 Requests/history `#history`            | Hồ sơ thay đổi thế nào?         | Action enum/actor ID/fixture note → nhãn, ghi chú; D | Request và timeline tách, không suy vai trò actor    | Xem/làm mới                | VI / NR / 1440                      | before-history → after-history-1440                                       | PASS xem lịch sử                                             |
| M14 Soạn/duyệt yêu cầu                     | Cần đề nghị bổ sung gì?         | Run UUID khỏi header; D                              | Purpose/body và trạng thái nháp/duyệt                | Lưu/duyệt/tải              | VI / form / 1440                    | không chụp trước → after-request-dialog-1440, after-request-approved-1440 | PASS draft/approve/export                                    |
| M15 Information trống `#information`       | Bổ sung thông tin thế nào?      | Nhãn nhóm nghiệp vụ giữ; S                           | Một empty state và nút tạo                           | Bộ câu hỏi                 | VI / NR / 1440                      | before-information → after-information-empty-1440                         | PASS mở bộ câu hỏi                                           |
| M16 Tạo câu hỏi/lời mời                    | Hỏi ai, hỏi gì?                 | Fallback question ID → nhãn; D                       | Phạm vi câu hỏi rõ, lý do riêng                      | Lưu nội bộ                 | VI / form / 1440                    | không chụp trước → AX trong phiên                                         | PASS tạo/lưu                                                 |
| M17 Lời mời và sao chép                    | Chia sẻ liên kết bằng cách nào? | URL riêng khỏi input/DOM thường; D                   | CTA copy, phản hồi thành công, thời hạn rõ           | Sao chép/thu hồi           | VI / button / 1440                  | không chụp trước → after-invitation-copy-1440                             | PASS copy                                                    |
| M18 Respondent thiếu lời mời `/respondent` | Vì sao chưa trả lời được?       | Không render token/code; D/S                         | Error gọn, không form giả                            | Nhận lời mời phù hợp       | VI / NR / 1440                      | không chụp trước → AX trong phiên                                         | PASS error                                                   |
| M19 Respondent form                        | Nhập lời khai ở đâu?            | Không ID câu hỏi, không assessment nội bộ; D         | Một câu hỏi và danh tính tự khai                     | Xem trước                  | VI / form / 1440                    | không chụp trước → AX trong phiên                                         | PASS nhận đúng lời mời                                       |
| M20 Respondent preview                     | Tôi sắp gửi gì?                 | Trạng thái trước gửi đổi thành Trả lời; D            | Nội dung nguyên văn, sửa/gửi tách                    | Gửi                        | VI / form / 1440                    | không chụp trước → AX; copy cuối kiểm source                              | PASS preview trước sửa copy; copy mới chưa chạy lại form mới |
| M21 Receipt                                | Đã nhận câu trả lời chưa?       | Receipt ID thu gọn, thời gian được format; D         | Một biên nhận, giới hạn lời khai vẫn hiện            | Quay về chuyên viên        | VI / NR / 1440                      | không chụp trước → after-response-receipt-1440                            | PASS submit                                                  |
| M22 Response verification                  | Đây là lời khai hay xác minh?   | Nhãn chưa xác minh/nguồn giữ nguyên; S               | Trích nội dung và xác minh tách                      | Rà soát với nguồn          | VI / Esc / 1440                     | không chụp trước → after-answer-verification-1440                         | PASS mở/đóng; không xác minh giả                             |
| M23 Financial result `#assessment`         | Điểm, năm và giới hạn là gì?    | Key/path → kỳ, cảnh báo, điểm, mức; D                | Kết quả trước bảng, xuất hiện trong viewport desktop | Chọn kỳ/chạy/xem cách tính | VI/EN/zh / select / 1440,1280,1920  | before-financial → after-financial-1440                                   | PASS run 82,5/AIC-F2                                         |
| M24 Metric/source modal                    | Vì sao có điểm này?             | Công thức key → diễn giải, nguồn có nhãn; D          | Công thức → giá trị/điểm → dữ kiện nguồn             | Đối chiếu nguồn            | VI/EN / Esc+focus return /1440,1024 | mẫu lỗi baseline → after-metric-source-1440, after-metric-en-1440         | PASS                                                         |
| M25 Financial table                        | Số gì, nguồn và trạng thái nào? | total_assets/fixture path → Tổng tài sản/cảnh báo; D | Số canh phải; nguồn thu gọn, không mất số            | Xem nguồn/sửa/xác minh     | VI/EN/zh / NR /1440,390             | before-financial → after-facts-1440, after-facts-390                      | PASS expanded source                                         |
| M26 Financial editor                       | Nhập số liệu gốc thế nào?       | Raw label key → nhãn; D                              | Fieldset theo chỉ tiêu, modal scroll                 | Lưu/đóng có guard          | VI / Esc, giữ/bỏ /1440,390          | không chụp trước → after-financial-editor-390                             | PASS draft/leave/relogin                                     |
| M27 Financial verification                 | Được xác minh mục nào?          | Checkbox dùng tên chỉ tiêu; D                        | Scope xác minh và bridge rõ                          | Chọn nguồn/mục/lý do       | VI / native validation /1440        | không chụp trước → AX trong phiên                                         | PASS mở/required; lưu xác minh NR                            |
| M28 Khác kỳ kết quả                        | Có đang xem nhầm năm?           | Warning cụ thể thay mã; D                            | Điểm/band ẩn; kỳ kết quả ghi riêng                   | Chạy cho bộ đã chọn        | VI / select /1440                   | không chụp trước → AX trong phiên                                         | PASS mismatch                                                |
| M29 Năm 2024 EBITDA=0                      | Vì sao chưa có tổng điểm?       | Lý do thiếu điều kiện được dịch; D                   | 0 vẫn là 0, tổng/band không phát                     | Kiểm tra dữ kiện           | VI / select /1440                   | không chụp trước → after-history-stale-1440 (ảnh 2024)                    | PASS null guard                                              |
| M30 Lịch sử stale                          | Kết quả có còn hiện hành?       | stale → cần tính lại vì dữ liệu đổi; D               | Badge rõ và ẩn điểm theo guard                       | Tính lại                   | VI / select /1440                   | không chụp trước → AX trong phiên                                         | PASS                                                         |
| M31 PDF/source viewer                      | Đúng file, phiên bản, trang?    | UUID khỏi header; hash chỉ mở đối chiếu; D           | Tên/version/page → PDF, trích nguồn giữ nguyên       | Trang/zoom/xem nguồn       | VI / Esc /1440                      | checkpoint cũ → private-real-pdf-version3-page2-1440                      | PASS v1/v3/page/zoom/relogin                                 |
| M32 Session expired + draft                | Đăng nhập lại có mất nháp?      | Không lộ dữ liệu khi hết phiên; S                    | Login thay nội dung, dialog mở lại sau login         | Đăng nhập cùng tài khoản   | VI / form /1440                     | checkpoint trước → AX retainedDraft                                       | PASS giữ nháp; PDF clear                                     |

Không có route Settings riêng trong checkout. Account/role/logout/locale nằm ở shell. Không coi menu chưa tồn tại là đã nghiệm thu.

## 42 ca UI đã thực hiện, kết quả và bằng chứng

Bằng chứng `AX` là trạng thái Chrome đã đọc trực tiếp trong tool; không đồng nghĩa có ảnh cho mọi bước. Các ca có ảnh dùng tên ở ma trận. Không phải 42 phép kiểm độc lập trên tất cả viewport/locale: responsive và locale được lấy mẫu trên màn chính như ghi rõ.

| Ca  | Thao tác → kỳ vọng → quan sát                                                      | Kết quả      | Bằng chứng                                                                 |
| --- | ---------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------- |
| U01 | Đăng nhập lại cùng tài khoản → tiếp tục được → nhận lại dialog bản nháp            | PASS         | AX retainedDraft                                                           |
| U02 | Logout ở tab khác → PDF đóng/dọn canvas → 0 open dialog,0 canvas                   | PASS         | AX+DOM                                                                     |
| U03 | Tìm SYNTHETIC và lọc Trả trước → chỉ còn dòng phù hợp                              | PASS         | after-cases-1440, AX                                                       |
| U04 | Tìm chuỗi không tồn tại → empty trong phạm vi trang                                | PASS         | after-cases-no-match-1440                                                  |
| U05 | Tạo hồ sơ minh họa + điều kiện → lưu được → case mới revision1                     | PASS         | after-conditions-1440                                                      |
| U06 | Tìm đối tác/mở chỉnh sửa/Esc → modal đóng, không lưu                               | PASS         | after-party-dialog-1440                                                    |
| U07 | Đi sáu tab → đúng panel/URL hash                                                   | PASS         | before/after các tab                                                       |
| U08 | Files trống→Upload→Esc → quota/nguồn/loại rõ, không phát sinh upload               | PASS         | after-upload-dialog-1440                                                   |
| U09 | Mở PDF từ danh sách thật → đúng tài liệu/version                                   | PASS         | private-real-pdf-version3-page2-1440                                       |
| U10 | Review→Chạy rà soát → lưu revision22, warning còn nguyên                           | PASS         | after-review-1440                                                          |
| U11 | Mở bác bỏ phát hiện→đóng → có lý do/evidence, không đổi xử lý                      | PASS         | AX dialog                                                                  |
| U12 | Tạo nháp yêu cầu→duyệt → status approved, revision2                                | PASS         | after-request-approved-1440                                                |
| U13 | Tải bản đã duyệt → file nội dung dễ đọc, không raw keys                            | PASS         | Downloads/aic-document-request.txt,318 bytes                               |
| U14 | Tải bản ghi gốc để đối chiếu → giữ nguyên payload audit                            | PASS         | after-request-audit-disclosure-1440; ba file raw 914 bytes có cùng SHA-256 |
| U15 | Tạo câu hỏi minh họa → xuất hiện đúng nhãn/cờ optional                             | PASS         | AX                                                                         |
| U16 | Tạo invitation phạm vi → đúng câu hỏi/recipient minh họa                           | PASS         | AX                                                                         |
| U17 | Sao chép liên kết → thông báo thành công và clipboard có link local đúng định dạng | PASS         | after-invitation-copy-1440; không log link                                 |
| U18 | Mở link trong tab respondent đã có → form đúng thay vì missing                     | PASS sau sửa | AX; lỗi trước được tái hiện                                                |
| U19 | Submit thiếu tên → native required chặn; nhập rồi preview → đúng lời khai          | PASS         | AX; validationMessage                                                      |
| U20 | Gửi câu trả lời → receipt/time, không gửi đánh giá nội bộ                          | PASS         | after-response-receipt-1440                                                |
| U21 | Reload hồ sơ → lời khai trực tiếp vẫn unverified                                   | PASS         | AX                                                                         |
| U22 | Mở verify response rồi Esc → không nâng xác minh                                   | PASS         | after-answer-verification-1440                                             |
| U23 | Thu hồi lời mời→mở lại link → unavailable, không form                              | PASS         | after-revoked-invitation-1440                                              |
| U24 | Đóng questionnaire → lưu audit, phản hồi giữ nguyên                                | PASS         | AX history revision20→21                                                   |
| U25 | FY2025→Chạy đánh giá → backend trả82,5/AIC-F2                                      | PASS         | after-financial-1440                                                       |
| U26 | Ghi nhận đã xem → lưu lý do và nút disabled                                        | PASS         | AX acknowledged state                                                      |
| U27 | Chọn FY2024 khi resultFY2025 → warning khác kỳ, số ẩn                              | PASS         | AX                                                                         |
| U28 | Mở assessmentFY2024 → EBITDA=0, score/band trống; fact0 vẫn hiển thị               | PASS         | after-history-stale-1440, AX                                               |
| U29 | Mở assessmentrev10 → stale, score/band ẩn, ack disabled                            | PASS         | AX                                                                         |
| U30 | Mở chỉ số vốn/EBITDA → công thức+nguồn, Esc trả focus                              | PASS         | after-metric-source-1440, after-metric-1024                                |
| U31 | Expand nguồn Tổng tài sản → nhãn/cảnh báo, không key/path fixture                  | PASS         | after-facts-1440, AX                                                       |
| U32 | Mở financial verify + save trống → required, không ghi xác minh                    | PASS         | AX; không nhận là đã kiểm write                                            |
| U33 | Sửa version nháp→Esc→stay→Esc→discard → giá trị giữ rồi bỏ đúng                    | PASS         | AX                                                                         |
| U34 | PDFv1/v3 → nextpage2, PDFzoom125% → canvas render, không lỗi                       | PASS         | private-real-pdf-page2-125-1440                                            |
| U35 | Đăng nhập lại→mở PDFv3 → renderđược, không lỗi401                                  | PASS         | private-real-pdf-version3-page2-1440                                       |
| U36 | EN màn result/table/metric → label/formula/warning được dịch, số giữ               | PASS         | after-metric-en-1440, AX                                                   |
| U37 | zh-CN result/table → label/warning được dịch; tên/nguồn giữ                        | PASS         | AX                                                                         |
| U38 | Desktop1280/1920 → không tràn ngang trang; grid phù hợp                            | PASS         | after-financial-1280, after-financial-1920                                 |
| U39 | Tablet1024 modal/768main → CTA/tab dùng được, không tràn trang                     | PASS         | after-metric-1024, after-financial-768                                     |
| U40 | Mobile390 result/editor → tabwrap, modal nằm trong viewport                        | PASS smoke   | after-financial-390, after-financial-editor-390                            |
| U41 | Mobiletable → client302/scroll630, document375 ở viewport390                       | PASS smoke   | after-facts-390                                                            |
| U42 | Render điều kiện đã lưu → loại/phạm vi/kích hoạt/kỳ/nguồn, không JSON              | PASS         | after-conditions-1440                                                      |

## Lỗi tìm thấy → sửa → kiểm lại

1. Raw fact keys/fixture paragraph: đã bỏ khỏi render thông thường, mở nguồn tổng tài sản sau sửa thấy nhãn và cảnh báo minh họa. Không đổi raw quote hoặc dữ kiện backend.
2. Kết quả bị đẩy xuống sau mô tả dài: đã đổi thứ tự, chụp lại1440 cùng hồ sơ; cảnh báo NOT VALIDATED xuất hiện trước điểm.
3. Health status vẫn báo có điểm khi UI không cho xem vì chưa chọn/khác kỳ/stale: status hiển thị cần kiểm tra theo visibility hiện hành, không đổi payload điểm.
4. Link mới trong tab respondent có sẵn không nhận token: thêm xử lý fragment mở document mới, trước/sau được tái hiện qua Chrome và gửi nhận receipt thật.
5. Preview trước submit dùng nhãn Đã gửi: đã đổi nhãn thao tác chưa gửi thành Trả lời ba ngôn ngữ. Không tạo thêm một questionnaire chỉ để xác nhận copy cuối; phần copy này còn cần lặp UI ở form mới.
6. Strip review lộ method/policy IDs: chuyển vào debug development; đọc lại Chrome không còn lộ ở strip.
7. Lịch sử lộ câu hệ thống capability, suy tất cảactor thành chuyên viên: mapping câu hệ thống và nhãn Đã ghi nhận trung tính, không suy danh tính/vai trò.
8. Export gọi là văn bản nhưng trả JSON audit: nội dung tải chính lấy purpose/content từ bản duyệt server, kiểm file thực tế318bytes không IDs; bản gốc vẫn giữ trong disclosure đối chiếu, không sửa approved payload.
9. Hộp chỉ số khi đang chọn kỳ khác đã được kiểm lại: hiển thị kỳ của kết quả đã lưu, không gọi nhầm là kỳ đang chọn. Điểm thành phần vẫn ẩn theo guard mismatch; nguồn 2025 được ghi rõ.
10. Source header có dấu phân tách lặp, aria Zoom chỉEnglish: đã sửa; mở lạiPDFv3 thấy header chuẩn và nhãn Độ phóng to PDF.

## STATIC gates và phạm vi chưa đủ

- `pnpm --filter @fintech/web lint`: PASS ranh giới112runtimefiles/11modules, format. Đã chạy lại cuối sau khi cập nhật README/docs.
- `pnpm --filter @fintech/web typecheck`: PASS.
- `pnpm --filter @fintech/web build`: PASS Next16.4, các route sinh đúng. Đã khởi động lại owned launcher với build mới.
- Các suite chức năng tự động: NOT RUN theo yêu cầu user; không dùng làm bằng chứng UI.
- Không coi PASS ở width/locale lấy mẫu là full cross-product UAT.

| Phần chưa nghiệm thu                                      | Trạng thái / lý do / việc cần tiếp                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser zoom200% thật                                     | NOT RUN: gửiCtrl+plus không làm đổi DPR/innerWidth, nên không nhận là zoom. PDFzoom125% là ca khác. Cần thao tác zoomChrome trực tiếp và đối chiếu form/bảng |
| Toàn bộrole/tenant/permission403                          | NOT RUN: chỉ có tài khoản specialist; không suy từ quyền đang có                                                                                             |
| Networkoffline/timeout/429/5xx/retry/concurrent409        | NOT RUN trong đợt UX; missing/revoked link và relogin đã kiểm, không đủ thay các nhánh này                                                                   |
| ZIP/quota/unsafe ZIP, upload replacement/response thực tế | NOT RUN lại sau UX; chỉ mởform/quan sáttrạng thái có sẵn. Bằng chứng checkpoint cũ không tự nâng thành full UX PASS                                          |
| Dữ kiện âm/rất lớn/nhiều nguồn/legacy/answerJSONphức tạp  | PARTIAL: số0/null và giá trị giao dịch lớn đã quan sát; chưa có bộ dữ liệu đại diện đầy đủ để nghiệm thu cách trình bày mọi shape                            |
| Keyboard/screen reader/AA toàn app/200%                   | PARTIAL: Esc/focus/modal/nativevalidation có bằng chứng; chưa full keyboardwalkthrough hoặc screenreader/contrast mọi tổ hợp                                 |
| Responsive mọi route/form/3locale                         | PARTIAL: matrix lấy mẫu financialmain/modal/table; không tuyên bố mọi popup ở390 đãPASS                                                                      |
| Xu hướng nhiều năm                                        | GAP: selector và history đãcó; chưa phải chartxu hướng, không tự tính thêm ở FE                                                                              |
| Hồ sơ PDF thật đủ điểm                                    | BLOCKED nghiệp vụ dữ kiện/nguồn theo checkpoint; không thay bằng dữ liệu minh họa                                                                            |

Những điểm trên ngăn tuyên bố full app/production PASS. Chúng không làm mất các ca đã kiểm trực tiếp. Ưu tiên tiếp: zoom/keyboard và trạng thái lỗi; quyền/tenant với tài khoản phù hợp; upload/legacy/dữ kiện cực trị; sau đó nghiệm thu responsive/locale rộng và dữ kiện doanh nghiệp thật.

## Bằng chứng, Git và bàn giao

Các before/after cùng1440 được lưu riêng khi có dữ liệu tương ứng; không có before cho mọi trạng thái mới, đã ghi rõ trong ma trận. Ảnh nội bộ không được đưa vào Git. Tải văn bản thực tế nằm Downloads, không stage. Không lưu URL lời mời/token trong báo cáo.

Danh sách source khác baseline UX (không bao gồm các file dirty có sẵn từ phiên trước):

- `apps/web/src/app/layout.tsx`
- `apps/web/src/components/feedback/error-notice.tsx`
- `apps/web/src/components/ui/status.tsx`
- `apps/web/src/components/ui/technical-details.tsx`
- `apps/web/src/features/assessments/components/factor-detail.tsx`
- `apps/web/src/features/assessments/components/fhi-breakdown.tsx`
- `apps/web/src/features/assessments/components/risk-assessment.tsx`
- `apps/web/src/features/auth/components/login.tsx`
- `apps/web/src/features/cases/components/case-list.tsx`
- `apps/web/src/features/cases/components/exposure-editors.tsx`
- `apps/web/src/features/cases/components/transaction-dialog.tsx`
- `apps/web/src/features/cases/components/transaction-overview.tsx`
- `apps/web/src/features/cases/components/workspace.tsx`
- `apps/web/src/features/cases/helpers/exposure-inputs.ts`
- `apps/web/src/features/cases/helpers/exposure-text.ts`
- `apps/web/src/features/documents/components/archive-receipt.tsx`
- `apps/web/src/features/documents/components/document-explorer.tsx`
- `apps/web/src/features/documents/components/document-summary-card.tsx`
- `apps/web/src/features/documents/components/documents.tsx`
- `apps/web/src/features/documents/components/dossier-archive-banner.tsx`
- `apps/web/src/features/documents/components/extraction-review.tsx`
- `apps/web/src/features/documents/components/field-correction.tsx`
- `apps/web/src/features/documents/components/upload-dialog.tsx`
- `apps/web/src/features/evidence/components/pdf-view.tsx`
- `apps/web/src/features/evidence/components/source-viewer.tsx`
- `apps/web/src/features/financial/components/financial-registry.tsx`
- `apps/web/src/features/financial/labels.ts`
- `apps/web/src/features/history/components/case-history.tsx`
- `apps/web/src/features/questionnaires/components/invitation.tsx`
- `apps/web/src/features/questionnaires/components/non-financial-information.tsx`
- `apps/web/src/features/questionnaires/components/respondent-form.tsx`
- `apps/web/src/features/questionnaires/components/staff-response.tsx`
- `apps/web/src/features/questionnaires/native-copy.ts`
- `apps/web/src/features/requests/components/request-draft.tsx`
- `apps/web/src/features/requests/components/requests-history.tsx`
- `apps/web/src/features/review/components/document-review.tsx`
- `apps/web/src/lib/i18n/messages.ts`
- `apps/web/src/lib/i18n/product-copy.ts`
- `apps/web/src/lib/i18n/review-i18n.ts`
- `apps/web/src/styles/enterprise.css`
- `apps/web/src/styles/index.css`

Đối chiếu binary diff trước/sau UX: 23 phần diff tracked ngoài apps/web và docs giống nhau; không có thay đổi code xuyên lớp do đợt UX. Fresh Chrome tab cuối ghi nhận 0 console error gần đây; không suy thành không có lỗi trong mọi phiên. Viewport override đã được reset.

Toàn bộ working tree vẫn chưa commit trên duc. Những thay đổi backend/AI/contracts ngoài đợt UX vẫn được bảo toàn; cần review từng hunk khi stage, không dùng danh sách UX này để ghi đè/xóa công việc cũ. Baseline private còn nguyên. README FE đã cập nhật lệnh chạy thật, giới hạn QA, trạng thái pilot và cách commit có chọn lọc.
