# AIC — Quyết định thiết kế và remediation frontend, 18/10/2026

## Kết luận và phạm vi

Đã thực thi thay đổi frontend trong working tree `duc`, tiếp nối checkpoint Chrome trước đó. Không thay backend, AI, contracts, migration, cấu hình pilot hoặc cách phát điểm trong đợt UX này. Trạng thái nghiệm thu toàn phạm vi: **PARTIAL**; chi tiết thao tác thật, giới hạn và ảnh ở [báo cáo UAT](AIC-FULL-UX-CHROME-UAT-2026-10-18.md). Build local thành công không đồng nghĩa production đã được nghiệm thu toàn bộ.

Căn cứ là brief UX chủ dự án cung cấp ngày 18/10, checkpoint hiện có, source và Chrome thật. Không truy cập nguồn tham khảo thiết kế bên ngoài trong đợt này; không nhận là đã đồng bộ Figma hoặc Notion. Định vị sức khỏe tài chính được áp dụng vào copy và thứ tự nội dung, giữ nguyên các route, sáu tab và domain giao dịch.

## Baseline, ownership và bảo toàn

- Workspace: Fintech; branch `duc`; HEAD `9bf0635e8d8e695e79491c1ce527a9562826faef`.
- Working tree đã có nhiều thay đổi từ các phiên triển khai trước, gồm cả backend/AI. Không coi các file đó là thay đổi của đợt UX này; không reset, stash, clean, merge hoặc ghi đè chúng.
- Trước sửa UX đã sao lưu `src`, docs FE, trạng thái Git và binary diff tại thư mục private `%LOCALAPPDATA%/AIC/ux-baseline-20261018/`. Baseline triển khai cũ và backup DB riêng vẫn giữ nguyên.
- Không có bằng chứng chắc chắn để kết luận tất cả tiến trình ngoài phiên đều thuộc agent khác; chỉ quản lý cây tiến trình launcher local do phiên này tạo. PostgreSQL không bị dừng/reset.
- Migration 0019 giữ SHA-256 `1BC930CFADDF4DD024CF10CCF5A868DEFA1AF0B7E9A7973721D8B24C8DE2DEB5` khi đối chiếu lại.
- Chỉ sửa code dưới `apps/web` và tài liệu UX. Dữ liệu kiểm thử mới chỉ được nhập qua UI vào hồ sơ minh họa nội bộ đã có; không sửa hồ sơ tài liệu thật.

## Vấn đề và quyết định

| Trước                                                          | Sau                                                                                                           | Mục đích                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Panel kỹ thuật lộ fact key, UUID, actor ID, đường dẫn fixture  | Nhãn nghiệp vụ tập trung; ghi chú minh họa rút gọn; debug chỉ trong development có cờ bật                     | Hiểu số liệu và nguồn mà không đọc mã                                  |
| Bảng dữ kiện và mô tả dài lấn kết quả                          | Bộ chọn kỳ → cảnh báo → điểm/mức/phương pháp → nhận định → điều kiện/cách tính → chi tiết chỉ số → bảng nguồn | Thấy kết quả và giới hạn trước, xem sâu khi cần                        |
| Các bộ BCTC cùng hiển thị, dễ nhầm kỳ                          | Bảng chỉ hiện bộ đang chọn, nhãn kỳ riêng cho kết quả đã lưu                                                  | Không dùng chéo năm hoặc che mismatch                                  |
| Công thức raw key                                              | Bảy diễn giải bằng ngôn ngữ tài chính; nguồn có giá trị, đơn vị và xác minh                                   | Giải thích EBIT/EBITDA, tài sản nhanh và vì sao có điểm                |
| Nhiều metadata giao dịch cùng mức                              | Ngữ cảnh giao dịch thu gọn; overview có tài liệu, rà soát, kết quả và hành động                               | Giữ workflow, giảm nhiễu                                               |
| Lịch sử lộ actor UUID và action enum                           | Tên hành động được dịch, thời gian/revision và ghi chú; không suy đoán vai trò tác nhân                       | Không bịa tên/vai trò người thực hiện; audit backend vẫn giữ định danh |
| Liên kết lời mời chứa capability hiện trực tiếp                | Nút sao chép, xác nhận sao chép, lỗi quyền clipboard có thông điệp                                            | Giảm lộ liên kết trong HTML/ảnh UI thông thường                        |
| Mở lời mời trong tab respondent có sẵn không nhận fragment mới | Bắt thay đổi fragment để mở document mới; giữ beforeunload guard bản nháp                                     | Không mang câu trả lời cũ sang lời mời khác                            |
| Tải văn bản đã duyệt trả JSON audit                            | Tải nội dung từ bản đã duyệt; bản ghi gốc giữ trong phần đối chiếu có nhãn rõ                                 | Không gửi nhầm UUID/enum trong văn bản cho người nhận                  |
| Điều kiện/nguồn lịch sử hiện JSON                              | Hiển thị các trường nghiệp vụ đã nhận diện; mục lịch sử không hỗ trợ giữ cảnh báo kiểm tra nguồn              | Không đổi dữ liệu hoặc tự nâng trạng thái xác minh                     |

## Visual system

Light mode, xanh đậm nhận diện, nền xám xanh nhạt, card trắng có viền mảnh, màu hổ phách cho cảnh báo. Không dùng màu xanh để suy ra phê duyệt tín dụng. Font hệ thống Segoe UI/Noto Sans/Microsoft YaHei/PingFang SC/Arial hỗ trợ VI/EN/zh, số tabular. Heading 24–32px, body 14px/1.55, caption 12–13px; grid theo nhịp 4/8px, radius 6–10px, bóng rất nhẹ.

Sidebar desktop 216px (190px ở khung nhỏ), content tối đa 1500px. Grid chỉ số 2 cột, 3 cột ở màn rộng, 1 cột mobile. Sáu tab được wrap; dưới 900px dùng điều hướng ngang sẵn có. Bảng tài chính canh phải số, có caption kỳ và scroll container riêng; không cắt số để né overflow. Modal giới hạn chiều cao viewport, header sticky, đóng bằng Escape và trả focus cho nút mở. Giữ cơ chế leave guard và native validation.

Không khẳng định toàn app đạt WCAG AA: focus/keyboard và một số kích thước đã quan sát, nhưng chưa có nghiệm thu screen reader/contrast mọi tổ hợp, forced colors hoặc browser zoom 200% thật.

## Nguyên tắc copy và dữ liệu

`product-copy.ts` là mapping trình bày mới; kết hợp i18n/status/financial labels hiện có. `presentNote` chỉ áp dụng ghi chú chuyên viên/provenance; không áp vào trích dẫn PDF hoặc tên pháp nhân. Chuỗi tổng hợp hiển thị cảnh báo ngắn; đường dẫn phát triển không nằm ở UI nghiệp vụ. Unknown system code dùng fallback cần kiểm tra; không trả raw enum/stack ra màn hình. API vẫn là nguồn dữ liệu, không sinh giá trị thay thế.

Bảng số giữ giá trị gốc và chuẩn hóa; null là thiếu, không thành 0. Xác minh là trạng thái từ backend, không suy ra từ confidence OCR. Chọn bộ BCTC không tự chạy đánh giá. Mismatch/stale làm ẩn điểm theo guard cũ; phản hồi respondent mới gửi vẫn chưa xác minh. Ghi nhận xem đánh giá không phê duyệt giao dịch. Cảnh báo experimental/NOT VALIDATED và dữ liệu minh họa luôn phải đọc được trên màn kết quả.

Debug có điều kiện development + cờ bật chủ ý và phiên hợp lệ; production không render children debug. Đây không phải một mô hình cấp quyền bảo mật mới; dữ liệu API, source tuple, audit và bằng chứng nguyên gốc vẫn giữ ở backend. Hash nguồn chỉ mở khi cần đối chiếu; không xóa hash.

## Nghiệp vụ giữ nguyên và gap

- Không đổi trọng số 15/10/20/10/15/10/20, AIC-F1–F5 hoặc PD=null.
- Có điểm 82,5/AIC-F2 từ backend trên dữ kiện tổng hợp đã xác minh trong luồng UI. Không dùng làm bằng chứng xếp hạng doanh nghiệp thật.
- Có nhiều kỳ và lịch sử kết quả; **chưa có biểu đồ xu hướng/nhận định nhiều năm**. Đây là gap sản phẩm, không tự suy ra từ bộ chọn năm.
- Hồ sơ PDF thật vẫn cần giải quyết dữ kiện, phạm vi BCTC và xác minh nguồn theo checkpoint trước; không sửa parser/backend để UI hiện điểm.
- Mục dữ liệu lịch sử không nhận diện không được tự chuyển thành đối tượng mới. Các định dạng câu trả lời phức tạp ngoài text và các điều kiện legacy chưa có dữ liệu đại diện để nghiệm thu đủ.
- Bộ nhận diện ghi chú kỹ thuật không phải DLP tổng quát. Trích dẫn nguồn vẫn nguyên văn; không tuyên bố loại bỏ mọi thông tin nhạy cảm tùy ý khỏi dữ liệu người dùng nhập.

## Nhóm file thực thi

- Presentation dùng chung: `src/styles/enterprise.css`, `src/styles/index.css`, `src/lib/i18n/{messages,product-copy,review-i18n}.ts`, `src/components/ui/{status,technical-details}.tsx`, `src/components/feedback/error-notice.tsx`.
- Màn lõi: `features/assessments/components`, `features/financial/{labels,components/financial-registry}`, `features/cases/components`, helpers exposure; nguồn/PDF, review và history.
- Workflow còn lại: documents (upload/explorer/extraction/archive), requests, questionnaires/respondent/invitation, login và metadata app. README FE cập nhật runtime hiện tại, nhánh duc và cách stage có chọn lọc.
- Danh sách chính xác file UX khác baseline được ghi trong UAT; không suy từ `git status` toàn repo để gán ownership.

## Tiếp tục sau bàn giao

1. Hoàn thành những hàng NOT RUN trong UAT, ưu tiên zoom 200% thật, role/tenant, lỗi mạng/429, ZIP/quota và dữ kiện tài chính dài/âm.
2. Nghiệm thu định dạng legacy và case nhiều nguồn/điều kiện/câu trả lời; mapping bổ sung phải dựa contract và dữ liệu đại diện, giữ source tuple.
3. Hoàn thiện dữ kiện/nguồn hồ sơ PDF thật theo checkpoint nghiệp vụ. Thiết kế xu hướng nhiều năm cần đầu vào/contract rõ; không dùng FE để suy diễn điểm.
4. Sau đó mới quyết định nghiệm thu toàn app/production. Không có commit/push/deploy hoặc cập nhật Notion trong đợt UX này.
