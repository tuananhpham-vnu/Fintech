# Triển khai AIC và nghiệm thu UI desktop — 18/10/2026

**Trạng thái:** đang triển khai/nghiệm thu; không phải biên bản PASS toàn bộ sản phẩm.
**Baseline:** branch `duc`, HEAD `9bf0635e8d8e695e79491c1ce527a9562826faef`, có 14 file local trước khi bắt đầu. Không commit/push hoặc ghi Notion trong lượt này.

**Checkpoint sau gián đoạn:** xem [kết quả tiếp tục Chrome/PDF và FHI](AIC-CHROME-RESUME-RESULT-2026-10-18.md). Đã kiểm lại PDF/relogin và sửa thêm logout liên tab; positive synthetic đủ bảy metric ra 82.5/AIC-F2. Các ghi chú “chưa positive” ở biên bản ban đầu bên dưới không áp dụng cho fixture tổng hợp mới; acceptance phát điểm dữ liệu doanh nghiệp thật vẫn chưa xong.

## 1. Phê duyệt và phạm vi

Owner đã duyệt hoàn thiện code sản phẩm và yêu cầu nghiệm thu trực tiếp UI desktop ngang, không thay bằng script test chức năng. Owner cũng xác nhận riêng pilot AIC-FHI-1.0/1.0.0, ngành `DISTRIBUTION_WHOLESALE_PILOT`, AIC-F1–F5, experimental / NOT VALIDATED, PD=null. Xem [bản ghi pilot/runtime](AIC-PILOT-RUNTIME.md).

Quyền xử lý bằng Gemini đối với báo cáo trong Desktop/DATA TEST FINTECH đã được cấp trước đó. Các bản ghi tạo thêm đều mang mục đích kiểm tra kỹ thuật local. Không gửi yêu cầu cho đối tác ngoài ứng dụng, không tự xác nhận pháp nhân hoặc biến lời khai/AI thành dữ kiện tài chính đã được người có thẩm quyền xác minh.

## 2. Thay đổi code và dữ liệu

| Phần | Đã triển khai | Giới hạn chứng minh |
| --- | --- | --- |
| Assessment | Run/read/history/acknowledge thật; snapshot/hash/trace bất biến; current readiness; tách tạo kết quả với phát điểm | UI đã tạo kết quả có financial component bị chặn; positive đủ bảy metric chưa nghiệm thu |
| FHI policy | Artifact server kiểm method hash, ngày hiệu lực, ngành và tổ chức; mặc định unconfigured khi thiếu | Pilot được owner duyệt; không có validation/calibration độc lập |
| Persistence | Migration 0019 và hai bảng append-only; grants API riêng | Không sửa dữ liệu cũ để làm checklist đạt |
| Financial registry | Giữ null points ngoài Assessment; dùng chung lựa chọn bộ BCTC; giữ điều kiện verify/quick-assets/EBITDA bridge | Không suy ra ngành, cột năm hoặc giá trị thiếu từ tên file |
| Source UI | Usable count unknown khác 0; kỳ AI đề xuất khác kỳ đã kiểm; decoder dossier chặt hơn | Negative malformed-response acceptance chưa đủ |
| Workflow freshness | Assessment/ack không làm cũ nguồn review/request; vẫn kiểm CP revision và đủ chuỗi audit | Request draft/approve sau Assessment đã thử thành công trên UI |
| Upload | Loại nguồn thành select; mã gửi khớp API; phân biệt các file trùng tên khi thay phiên bản | File/byte/page/tenant guards giữ tại backend |
| Errors/status | Hiển thị riêng file thất bại; mô tả nguồn cũ dễ hiểu; bỏ thông báo chờ API không còn đúng | Giữ lỗi không retry được theo policy; không reset attempts/fence |
| PDF/AI | Nhận nhãn kỳ “Tại ngày”, nhãn tổng cộng tài sản và subject heading trên BCTC có đánh số; prompt provenance v3 | Không nới guard số tiền/cột năm; kết quả live mới phải đọc riêng |
| Runtime | Production document mode tường minh, guard HTTPS/private storage/live AI/nonowner DB role, probes; local launcher checks ports and runs both workers | Runtime nghiệm thu hiện vẫn local, web dùng `next start`; chưa chạy production HTTPS |

Không sửa schema AI 1.0.2 đã phát hành. Bundle bổ sung [aic-assessment](../../packages/contracts/aic-assessment/README.md) có schema/OpenAPI riêng, được backend nạp sau foundation. Gói tham chiếu scorer/golden fixtures do báo cáo nguồn nhắc tới chưa được cung cấp đầy đủ; không tuyên bố parity với các file đó.

## 3. Bảo toàn baseline và migration

Snapshot ngoài Git: `%LOCALAPPDATA%/AIC/implementation-baseline-20261018-024150-521`, gồm bản sao 14 file cũ, binary patch và operational receipts. Thư mục được giới hạn ACL cho người dùng hiện tại/SYSTEM/Administrators.

Trước migration 0019 đã tạo backup PostgreSQL nhất quán, mã hóa DPAPI trước khi ghi ra đĩa, kiểm tra decrypt/hash và danh mục pg_restore. Backup mới này **chưa được thực hiện restore**. Sau migration, fingerprint đầy đủ của **44 bảng cũ ngoài migration ledger không đổi**. Có 47 bảng/19 migration. SELECT/INSERT hai bảng mới chỉ cấp cho API runtime role; worker không được cấp quyền mới. Runtime local đang dùng các restricted role có sẵn qua wrapper riêng, không dùng connection operator.

`.env` chỉ được thêm đường dẫn private artifact pilot; bản trước thay đổi được lưu mã hóa. Không ghi mật khẩu, Gemini key, internal key hoặc raw invitation token vào Git/báo cáo này.

## 4. Kiểm tra kỹ thuật đã chạy

- `pnpm lint`: đạt static architecture boundaries và Prettier; không phải functional UI acceptance.
- `pnpm typecheck`, `pnpm api:build`, `pnpm build`: đã chạy thành công trong lượt triển khai. Bản web mới nhất đã qua TypeScript và Next build.
- `node --check scripts/dev-all.cjs` và Python `py_compile` cho các file extraction thay đổi: đạt kiểm tra cú pháp.
- Migration được chạy bằng runner hiện có; API/AI/PDF worker/ZIP worker đã khởi động thực tế.

Không chạy unit/integration/API/pytest/automated browser test suites trong lượt triển khai này. Các thao tác UI bên dưới dùng Chrome thật qua công cụ browser, không gọi API trực tiếp để thay cho thao tác người dùng.

## 5. Bằng chứng UI thực tế

Trình duyệt: Chrome extension kết nối được; viewport desktop 1440×900. Web tại `http://127.0.0.1:3000`, PostgreSQL và AI live. Mobile/tablet chưa kiểm theo yêu cầu owner.

Hồ sơ kỹ thuật: `275b3e13-9c4a-4436-96e1-5d59ed43f768`, tham chiếu `KIEM-THU-UI-20261018-0110`. Dữ liệu khai báo đối tác trong hồ sơ này chưa tương đương xác minh pháp nhân nguồn BCTC.

| Luồng | Thao tác thật và quan sát |
| --- | --- |
| Login/relogin | Đăng nhập tài khoản được cung cấp thành công; sau gián đoạn nhiều giờ thấy phiên hết hạn, đăng nhập lại và tải lại dữ liệu được |
| Review → Assessment | Rà soát lại revision 15→16, bấm Chạy đánh giá, lưu kết quả revision 17 và xuất hiện trong lịch sử; financial score/band trống vì thiếu verified facts |
| Acknowledge | Ghi nhận đã xem với lý do kỹ thuật, revision 18; nút bị khóa khi đã ghi nhận; reload vẫn giữ thời gian/lý do và không tự biến kết quả thành stale |
| Request stale | Duyệt bản nháp gắn review cũ bị chặn, nội dung giữ lại, có request ID tra soát |
| Request current | Phát hiện lỗi thật: draft mới sau Assessment bị STALE_REVIEW; sửa audit freshness rồi thao tác lại thành công revision 19, duyệt revision 20 |
| Export request | Bấm tải văn bản đã duyệt; Chrome lưu file 902 byte trong Downloads. Công cụ chờ sự kiện download bị timeout nên dùng file được trình duyệt lưu làm bằng chứng phụ |
| PDF response | Chọn BCTC 2025 thật, response binding đúng request. Lần đầu bị 422 vì UI nhận mô tả source class; nhập mã hợp lệ được tiếp nhận. Select mới đã được kiểm lại trên UI |
| Source race | Trong lúc extraction, thao tác questionnaire làm case đổi revision; job `5999acb5-a2c5-4e4e-ae00-c10458d66858` bị giữ lại `STALE_DOCUMENT_SNAPSHOT`, không công bố kết quả cũ; retry disabled đúng policy |
| Replace source | UI chọn đúng PDF thất bại nhờ tên/version/status/ID, nộp bản nguồn v2; giữ nguyên lịch sử phiên bản cũ và request binding. Job `4af746cf-95a2-47fa-baa4-977a7d42f162` hoàn tất, revision 26; summary live 4/9, mã số thuế đúng nguồn, số tiền nhiều cột vẫn null |
| PDF viewer | BCTC 8 trang mở được, chuyển 1→8, thử zoom 75%/100%; ảnh trang cuối có nội dung, nút Tiếp khóa tại 8/8 |
| Questionnaire | Tạo bộ riêng với nội dung rõ kiểm tra kỹ thuật; tạo lời mời nội bộ một câu hỏi; mở tab respondent riêng, preview rồi submit; nhận biên nhận `9627a8f5-d466-482e-94a2-4e3ad066c6e5` |
| Response projection | Reload phía chuyên viên thấy câu trả lời, nhãn chưa xác minh; mở lại cùng quyền trả lời thấy cùng biên nhận. Hai tab Chrome, chưa phải bằng chứng tenant isolation ở hai tổ chức |
| Revoke/reissue/skip/close | Thu hồi lời mời cũ → link cũ bị chặn; cấp link mới; thiếu lý do bỏ qua không qua được preview. Sửa lỗi preview thiếu lý do, kiểm lại và submit nhận biên nhận `ba723786-b86e-47d0-b858-532e68c670f3`. Đóng bộ câu hỏi, staff entry/invite disabled; phản hồi vẫn chưa xác minh |
| Correction/classification | Sửa kỳ v2 thành 2025-12-31 đúng dòng nguồn trên trang 1, revision 27; phân loại BCTC chỉ trang 1 và giữ subject unresolved, revision 28. Không dùng mã thuế khai báo `123` như một pháp nhân đã xác minh |
| Response recheck negative | Rà soát lại revision 34 rồi ghi nhận bổ sung bị chặn đúng `RESPONSE_SOURCE_REVIEW_REQUIRED`. UI đã tách thông báo điều kiện nguồn khỏi revision conflict; bản nháp giữ nguyên |
| Assessment history/stale | Sau thay nguồn/lời khai, kết quả revision 17 hiện stale, nút acknowledgement disabled. Chạy kết quả mới revision 35; select lại revision 17 vẫn hiển thị đúng phiên bản cũ/stale, quay về latest được |
| Explorer | Tìm chuỗi không tồn tại → empty và reset; tìm BCTC → 3 nguồn hiện hành; nhóm theo loại; kết hợp failed filter → empty; reset về 5 nguồn |
| Financial source editor | Chọn quote Tổng tài sản v2, biểu mẫu hiện quote/trang 2 và link nguồn. Mở được PDF đúng hash/version/trang rồi quay lại vẫn giữ editor. Không lưu bộ tài chính khi subject/scope/bridge chưa có căn cứ |

Ảnh riêng tư nằm tại `%LOCALAPPDATA%/AIC/ui-acceptance-20261018`, gồm `assessment-created.jpg`, `request-stale-blocked.jpg`, `questionnaire-receipt.jpg`, `pdf-last-page.jpg`. Không đưa PDF thật hoặc hình chứa thông tin liên hệ vào Git.

## 6. Phần còn cần nghiệm thu

Các dòng này là **chưa đủ bằng chứng**, không được đánh PASS từ build hoặc từ code đã tồn tại:

- Bộ BCTC thật đủ bảy metric, ngành/basis/kỳ/unit có căn cứ, verify và bridge assertions do người có thẩm quyền kiểm; positive score/band, source links, nhiều bộ BCTC và source-change staleness.
- Positive retry được server cho phép, replay/double submit, quota/encryption/corrupt/hash mismatch; không tạo lỗi nhà cung cấp giả hoặc reset budget để đạt ca kiểm.
- Request response → source review → recheck → acknowledge thành công với nguồn thật đúng subject; các nhánh thiếu review phải bị chặn.
- Questionnaire expiry/rate limit và staff-entry/verification; skip/revoke/reissue/close đã thử ở bộ câu hỏi kỹ thuật nhưng chưa phải toàn bộ adverse cases. Không xác minh câu trả lời kỹ thuật như lời khai đối tác thật.
- Hai tổ chức/người dùng có quyền khác nhau qua UI; hiện chỉ có tài khoản chuyên viên được cung cấp.
- PREPAYMENT có chứng từ milestone/refund phù hợp, issue decisions và waiver/revoke; secondary exposure và outside-pilot numeric block.
- ZIP 30/60/mixed/nested/long-PDF, worker restart/recovery; các bằng chứng backend lịch sử không thay thế lượt UI mới.
- Full desktop navigation/back/forward/keyboard/modal/long text và ba ngôn ngữ; production HTTPS ingress, runtime roles, backup restore/rollout.

Không kết luận “mọi tính năng đã chạy hết” hoặc “production ready” trước khi có bằng chứng cho các mục liên quan đến phạm vi phát hành.
