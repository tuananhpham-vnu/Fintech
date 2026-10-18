# Tiếp tục nghiệm thu Chrome: PDF/session và FHI — 18/10/2026

**Kết luận:** lỗi PDF giữ lỗi phiên cũ đã kiểm lại thành công; phát hiện và sửa thêm đăng xuất liên tab không che PDF đang mở. Luồng tính điểm thật qua UI đã cho **82.5 / AIC-F2** trên dữ liệu tổng hợp có đáp án tính tay. Đây chưa phải nghiệm thu phát điểm cho doanh nghiệp thật hoặc PASS toàn sản phẩm.

## Checkpoint và phạm vi thay đổi

- Repo local `Fintech`, branch `duc`, HEAD `9bf0635e8d8e695e79491c1ce527a9562826faef`, chưa commit/push/merge/deploy công khai.
- Working tree đã có nhiều thay đổi từ các lượt triển khai trước; giữ bản sao 14 file baseline và toàn bộ file báo cáo mới. Không stash/reset/clean/checkout hoặc sửa migration đã áp dụng.
- Lượt tiếp tục này sửa `apps/web/src/features/auth/session-provider.tsx`, `features/assessments/components/{risk-assessment,fhi-breakdown,factor-detail}.tsx`, `lib/utils/format.ts`, `lib/i18n/review-i18n.ts` và tài liệu. Bản sửa `features/evidence/components/source-viewer.tsx` có sẵn được đọc và kiểm lại, không viết đè.
- Không thể quy toàn bộ diff hiện có cho một lượt hoặc một agent. Không có xác nhận quyền sở hữu từng hunk của agent khác; cần review riêng trước khi stage/commit cả nhóm.
- Giữ RECEIVABLE/PREPAYMENT và lịch sử cũ. Định hướng tài chính tham khảo/bảy metric/đa năm trong handoff được ghi nhận; không bổ sung loan recommender, duyệt khoản vay hay dự báo PD. Định vị giao dịch trong README/spec cũ còn cần đồng bộ có chủ đích, không tự viết lại Notion.

## P0 PDF sau đăng xuất/đăng nhập

### Nguyên nhân và bản sửa được kiểm

Lỗi đã ghi nhận ở lượt trước: cùng document ID/hash sau đăng nhập lại không làm effect tải nguồn chạy lại, nên lỗi/URL thuộc phiên trước còn trong state. Bản sửa đang có buộc evidence loader và PDF effect phụ thuộc phiên (tổ chức/người dùng/CSRF trong bộ nhớ), chỉ tải khi session ready, xóa URL/error khi đổi phiên; cleanup hủy request và revoke object URL. Không đưa token vào DOM, URL, localStorage hoặc báo cáo.

Kiểm lại trên Chrome: mở v3 trang 1 → đóng → đăng xuất ở tab khác → mở nguồn trên tab cũ → hiện yêu cầu đăng nhập → đăng nhập trên chính tab đó → PDF v3/8 trang hiện lại bằng blob URL mới, không còn lỗi phiên cũ. Lặp lại hai lần thành công; chuyển trang 1→2 và đóng/mở lại được.

Phát hiện mới bằng UI: **để PDF đang mở** rồi đăng xuất ở tab khác vẫn thấy canvas và blob link ở tab cũ. SessionProvider trước đó chỉ biết logout trong tab hiện tại hoặc nhận 401 từ request tiếp theo.

Sửa tối thiểu: SessionProvider phát sự kiện `logout` qua BroadcastChannel cùng origin sau khi logout server thành công. Các tab còn lại chuyển sang expired và xóa CSRF; PDF effect hủy tải/revoke blob theo lifecycle đã có. Không gửi thông tin người dùng, session ID hay credential trên channel; không thay ACL/API contract.

### Kết quả trực tiếp sau build mới

| Ca manual Chrome | Quan sát | Kết quả |
| --- | --- | --- |
| PDF đang mở → logout tab khác | Tab PDF tự hiện màn đăng nhập lại; source link và PDF canvas không còn xuất hiện, không cần bấm một API action khác | PASS trong Chrome đang dùng |
| Đăng nhập lại cùng tab | Đúng document v3/hash, đúng quote và trang 2/8; blob URL khác trước; không lỗi phiên cũ | PASS |
| Đóng PDF sau relogin | Trở về hộp rà soát trường dữ liệu BCTC v3, 5/9; nội dung vẫn còn | PASS |
| Bản nháp tài chính + source PDF → logout/relogin | PDF được che rồi tải mới; đóng PDF thấy nguyên `UAT-DRAFT-NOT-SAVED` và evidence đã chọn | PASS |
| Đóng bản nháp chưa lưu | Hiện cảnh báo thay đổi chưa lưu; chủ động Bỏ thay đổi; không lưu dữ kiện vào hồ sơ thật | PASS |
| Tài khoản/tổ chức khác | Chỉ có một credential được cung cấp | NOT RUN |
| Instrument revoke/cancel ở mức engine; kiểm browser không hỗ trợ BroadcastChannel | Code cleanup đã đọc; chưa instrument hoặc thử browser khác | NOT RUN |

Bằng chứng riêng tư ngoài Git: `source-after-relogin.jpg`, `source-expired-rerun.jpg`, `source-other-tab-logout-before-fix.jpg`, `source-other-tab-logout-after-fix.jpg`, `source-other-tab-relogin-after-fix.jpg` trong `%LOCALAPPDATA%/AIC/ui-acceptance-20261018`.

Các thao tác thực hiện qua UI. Thử thu HTTP events qua browser debugger không trả được response trace đầy đủ; không gán mã HTTP giả cho các quan sát trên. Readiness API được mở trực tiếp trên Chrome, hiện `{"status":"ready"}`. Bằng chứng PDF là nội dung canvas, version/page/hash và phục hồi phiên; không phải một bộ kiểm thử HTTP độc lập.

## FHI: dữ liệu tổng hợp qua luồng thật

[Bản gốc fixture và đáp án tính tay](AIC-FHI-SYNTHETIC-UI-FIXTURE-2026-10-18.md) được viết trước khi quan sát điểm. Nhập, lưu, xác minh, review, run assessment và acknowledgement đều thực hiện trên Chrome; không seed DB hoặc gọi API để tạo kết quả.

Hồ sơ mới `91c0f61e-5d4a-47ae-8f63-67f604c7a04b`, ref `SYNTHETIC-FHI-UI-20261018`, dùng đối tác synthetic có sẵn. Hai bộ nguồn nhập tay tách riêng FY2025/FY2024. Reasons/provenance ghi rõ technical synthetic; không xác nhận doanh nghiệp thật, không chạy giao dịch.

| Bước | Quan sát thực tế | Kết quả |
| --- | --- | --- |
| Nhập 14 dữ kiện FY2025 chưa verify, review rồi assessment rev4 | Score/band trống, fact chưa verify và bridge bị chặn | PASS |
| Verify đủ 14 fact, chưa xác nhận bridge, review/assessment rev7 | M01/M03/M05/M06/M07 có tỷ số; M02/M04 bị chặn; tổng điểm/band vẫn trống | PASS |
| Verify bridge đúng bản gốc tổng hợp, review/assessment rev10 | Điểm thành phần 15, 7.5, 16, 9, 12, 10, 13; tổng 82.5, AIC-F2 | PASS |
| Thêm bộ FY2024 | UI yêu cầu chọn rõ bộ; kết quả rev10 đánh stale, không còn hiện điểm; acknowledgement khóa | PASS |
| FY2024 debt=interest=EBIT=D&A=0, verify cùng bộ, review/assessment rev14 | M04 bị chặn vì EBITDA không dương; M05 hiển thị ngoại lệ không nợ vay đã xác minh; tổng score/band trống | PASS |
| Chuyển bộ FY2024 ↔ FY2025 | Kết quả thuộc bộ khác có cảnh báo, không gán điểm của bộ trước cho bộ đang chọn | PASS |
| Chọn FY2025, chạy assessment rev15 | Lại ra đúng 82.5/F2 và bảy điểm thành phần | PASS |
| Acknowledge rev16, reload và chọn lại FY2025 | Nội dung/lý do ghi nhận tồn tại; không tự làm stale; kết quả vẫn đúng | PASS |
| Việt/Anh/Trung | Giữ nguyên 82.5/F2, nhãn metric và câu điểm mạnh đúng ngôn ngữ; không tự dịch raw nguồn/lời khai | PASS cho vùng kết quả đã thử |

IDs để đối chiếu UI:

- FY2025 set `62023486-c181-4167-a490-6e296d3104e6`.
- FY2024 set `13d7fb30-e979-4245-8c7b-4a0dadf29606`.
- Assessment rev7 `3c78717e-6343-4c77-8dc5-898708aeca97`; rev10 `4c549fa7-3a43-4074-bb1a-4800d0b775c1`; rev14 `45f6c7cd-c86d-4689-8544-3190353e2102`; rev15 `b35328d5-befd-4785-bfb4-ab1488743434`.

Pilot vẫn AIC-FHI-1.0/1.0.0, trọng số 15/10/20/10/15/10/20, experimental / NOT VALIDATED, PD=null. Không thay artifact, band threshold, verify gate hoặc chuẩn hóa lại trọng số để ra điểm. Fixture không chứng minh calibration, các mốc biên/nội suy còn lại hoặc acceptance dữ liệu thật.

Sửa hiển thị phát hiện từ ca điểm thật: bỏ số 0 dư bằng xử lý chuỗi (không ép Number/không làm tròn thêm), bản địa hóa nhãn metric và câu điểm mạnh do rubric sinh; mô tả điều kiện FHI dẫn về readiness hiện hành thay vì khẳng định đang khóa mọi lúc. Điểm và contract không thay đổi.

## BCTC thật: kết quả còn thiếu và nguyên nhân

UI đọc lại kết quả đã lưu của PDF v3: **5/9 có giá trị**, `AI: live`. Không gọi Gemini lại trong lượt tiếp tục này. Năm trường có giá trị là tên đơn vị, MST, kỳ kết thúc 2025-12-31, hệ số 1, VND; vẫn cần kiểm chứng của người có thẩm quyền. Không dùng usable count như verified count.

| Trường còn null | Đối chiếu nguồn | Phân loại / việc tiếp theo |
| --- | --- | --- |
| Basis riêng lẻ/hợp nhất | UI không có quote đủ rõ; không suy ra từ loại công ty/tên file/mẫu biểu | Thiếu bằng chứng phạm vi; cần chỉ rõ nguồn hoặc xác nhận có provenance |
| Tổng tài sản | Dòng tổng ở PDF trang 2; nguồn có hai cột năm và mã/công thức dòng | Hạn chế extraction/grounding bảng; không phải tài liệu không có con số |
| Tổng nợ phải trả | Dòng tổng ở PDF trang 2, cùng cấu trúc nhiều cột | Cần định vị đúng cột kỳ, mã dòng và quote bằng chứng |
| Vốn chủ sở hữu | Dòng tổng ở PDF trang 3, cùng cấu trúc nhiều cột | Cần định vị đúng cột kỳ và provenance, không lấy số đầu tiên trong dòng |

Render riêng trang 2/3 bằng Poppler xác nhận các con số có trên ảnh. Kiểm tra text layer độc lập bằng pypdf thấy glyph mã hóa không tương ứng chữ/số hiển thị; PDF không có AcroForm field. UI diagnostics có `GARBLED_TEXT_LAYER`, `OCR_USED`, `QUOTE_NOT_FOUND`, `UNGROUNDED_VALUE`, `OCR_UNVERIFIED`. Guard hiện tại dành cho số đứng ngay sau nhãn không đủ chứng minh cột kỳ trên bảng có mã/công thức và hai số năm. Không nới guard, sửa bảng char theo riêng HK VINA hoặc hard-code giá trị.

Ảnh render và PDF thật ở ngoài Git. Báo cáo này không chép số tài chính/địa chỉ/liên hệ từ báo cáo thật. Case thật không được phát điểm: thiếu scope/verified facts/quick-assets và EBITDA bridge; thông tin pháp nhân khai báo của case cũng chưa tương đương pháp nhân trong tài liệu.

## Ma trận phạm vi: bằng chứng trước và lượt tiếp tục

| Phạm vi | Bằng chứng trước gián đoạn | Lượt tiếp tục này |
| --- | --- | --- |
| Request draft/approve sau Assessment; stale draft | Đã ghi UI trong biên bản trước | Không tạo/duyệt request thêm; không đổi workflow backend |
| Export request | Chrome đã lưu file | Không chạy lại |
| Questionnaire submit/receipt, revoke/reissue/skip/close | Đã ghi UI và receipt trong biên bản trước | Không submit thêm |
| Upload/replace/source snapshot race, Gemini live | Bản v3 5/9 đã xử lý live | Đọc lại qua UI và đối chiếu PDF; không upload hay gửi AI thêm |
| RECEIVABLE/PREPAYMENT review/assessment | Đã thử hai core flows | RECEIVABLE với bộ tài chính synthetic được kiểm sâu; PREPAYMENT không mở rộng |
| PDF/auth/source/form recovery | Ca phục hồi chưa chốt | Đã tái hiện, sửa thêm liên tab, kiểm lại trực tiếp như trên |
| Seven-metric numeric result | Chưa có positive UI | Có positive synthetic, negative bridge/EBITDA, selection/history/ack như trên |
| Desktop 1920×1080 | Sáu tab/back-forward/keyboard đã ghi ở lượt trước | DOM viewport 1905×1080 sau trừ scrollbar, scrollWidth=clientWidth; kiểm các modal/kết quả tài chính; không full retest mọi màn |
| Mobile/tablet | Owner yêu cầu để sau | NOT RUN |

## Kiểm tra tĩnh và runtime

Sau những chỉnh sửa FE cuối cùng, đã chạy và thành công:

```text
pnpm --filter @fintech/web exec prettier --write <các file FE vừa sửa>
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

`lint`: architecture boundaries 110 runtime files, 11 modules, không cycle/orphan; Prettier đạt. TypeScript và Next build đạt. `pnpm api:build`/Python syntax đã chạy ở lượt triển khai trước, không ghi thành rerun trong lượt FE này. Không chạy hoặc viết automated functional/regression suite theo yêu cầu owner kiểm UI; do đó automated regression status **NOT RUN**, không lấy static checks thay E2E.

Đã khởi động lại đúng launcher session-owned khi rebuild, không dừng PostgreSQL hay tiến trình lạ. Web 3000, API 3001, AI 8100 và hai worker khởi động. API readiness trên Chrome trả ready. Đây là stack local dùng web production build; không phải public HTTPS production acceptance. Còn warning DEP0190 từ cách launcher gọi pnpm.cmd; chưa thay launch mechanism trong lượt fix FE.

Migration 0019 không đổi; SHA-256 vẫn `1BC930CFADDF4DD024CF10CCF5A868DEFA1AF0B7E9A7973721D8B24C8DE2DEB5`. Không migrate/reset/seed/cleanup dữ liệu cũ trong lượt tiếp tục. Hồ sơ synthetic và lịch sử kiểm thử được giữ lại, chưa dọn.

## Việc chưa hoàn tất, theo mức ưu tiên

| Ưu tiên | Phần chưa xong | Đường tái hiện / hành động cụ thể |
| --- | --- | --- |
| P1 | Phát điểm doanh nghiệp thật | Mở case BCTC thật: 5/9 usable nhưng chưa đủ verified FHI. AI/backend cần xử lý bảng có cột kỳ/provenance; chuyên viên cần cung cấp bộ đã kiểm đủ scope, 14 fact và bridge. Không đổi null thành 0 |
| P1 | Phân tích đa năm và giải thích đầy đủ | Hiện chọn/tính từng bộ độc lập; chưa có nghiệm thu hoặc implementation đầy đủ cho bảng so sánh năm, discontinuity closing/opening, diễn giải nguồn theo năm. Backend/contracts/FE cần một hạng mục riêng, giữ công thức pilot |
| P1 | Kiểm tenant/người dùng khác | Chỉ có credential specialist một tổ chức. Cần tài khoản/tổ chức thử tách biệt để kiểm source/history/assessment/phiên qua UI; không mở rộng quyền tài khoản hiện tại |
| P1 | Production runtime acceptance | Chưa chạy HTTPS ingress, restore backup thực sự, recovery sau crash/worker restart hoặc kiểm vận hành production; backup decrypt/list không thay restore |
| P2 | Edge cases arithmetic/source | Positive anchors, missing bridge và zero EBITDA đã thử; chưa phủ mọi denominator âm/0, band boundary, decimal precision, duplicate evidence hoặc source mutation khi đang verify |
| P2 | Retry/ZIP và workflow adverse | Chưa chạy lại positive retry, quota, corrupt/encrypted/hash mismatch, ZIP lớn/nested/long-PDF, invitation expiry/rate limit và response ack positive bằng đúng subject |
| P2 | UI/source wording và BA scope | Các màn giao dịch còn theo spec cũ. Core output trong handoff ưu tiên financial health tham khảo; đồng bộ định vị/copy có kiểm soát, không xóa modules/histories hoặc thay logic chỉ để có score |

Không còn lỗi P0 đã tái hiện mà bỏ chưa sửa trong phạm vi PDF/session của lượt này. Câu này không phải chứng nhận không có P0 ở những luồng chưa kiểm.

## Git và bàn giao

Không push/deploy/ghi Notion. Private policy, credentials, cookies, PDF thật, DB backup, screenshots và invitation tokens không thêm vào Git. Nhánh `duc` giữ toàn bộ thay đổi chưa commit; [biên bản tổng](AIC-IMPLEMENTATION-AND-DESKTOP-UAT-2026-10-18.md) giữ bằng chứng các lượt trước. Bước review tiếp theo cần xem từng nhóm API/migration/contracts/FE/AI và file mới trước khi stage; không commit cả working tree một cách mù quáng.
