# AIC specialist UX remediation — 18/10/2026

Status: **PARTIAL / live-demo first-time specialist exit FAIL**. 19 recorded issues now have scoped fixes with Chrome evidence, including UX01 on an isolated company-health workspace. UX16 remains blocked for the complete real-source journey. Company-first rollout to the live demo is pending; this is not a whole-product or deployment PASS. Latest continuation evidence and test results are in section 9.

Baseline: branch duc, HEAD 9bf0635e8d8e695e79491c1ce527a9562826faef. Existing dirty FE/API/AI/contracts retained. Private source/index/working diff baseline: C:/Users/52duc/AppData/Local/AIC/ux-remediation-baseline-20261018-120633. Browser evidence: C:/Users/52duc/AppData/Local/AIC/ux-remediation-20261018/.

Owned launcher node18028 (scripts/dev-all.cjs --built-web), API30268, Next23416, AI24252 are the stack started in this chat's preceding audit. PostgreSQL and unrelated processes must stay untouched.

## Issue → owner → acceptance plan before edits

| Issues     | Narrow components/contracts                                   | Required Chrome acceptance                                                                   |
| ---------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| UX02/03/04 | assessment presentation, FHI breakdown, workspace overview    | stale/mismatch/historic result badges, narrative, acknowledgement; FY2024/FY2025/rev4/latest |
| UX08/15    | readiness actions, Financial Registry verification            | correct form/period/fact/source, bridge context, cancel/dirty guard                          |
| UX01       | case creation/domain/schema; counterparties/case list         | company-first assessment without invented exposure; preserve old cases                       |
| UX06       | versioned server comparison + registry/assessment UI          | compatible verified years, gaps/basis/currency/unit/source/currentness                       |
| UX07       | assessment report preview/print                               | genuine source-grounded current or complete blocked report, distinct from request export     |
| UX14/16    | extraction correction/classification, source viewer, registry | PDF→fact with exact provenance, source-return keeps draft; no HK VINA auto-verification      |
| UX05/09    | assessment hierarchy, financial workbench, shared modal/CSS   | 1280/1440/1920, summary + next action, keyboard/draft                                        |
| UX10/11    | metric labels/decimal presentation/exception state            | %/times, raw precision, zero-interest exception vs blocked EBITDA                            |
| UX12/13    | upload helpers, VI/EN/ZH labels                               | truthful PDF/ZIP policy, no API jargon, validation                                           |
| UX17/18    | Files lineage/job/receipt components                          | filename/version/current vs old jobs, retry explanation, source-return                       |
| UX19/20    | scoped selection, workspace tab keyboard                      | reload/back/forward, invalid ID, arrow/home/end/modifier                                     |

Checkpoint A precedes broad redesign. Calculation weights, method, provenance, policy, source checks and historical results are not changed to force scores. NO COMMIT/PUSH/DEPLOY/NOTION WRITE.

## 1. Kết quả và ranh giới nghiệm thu

Đã thực hiện ba checkpoint, không chạy lại một đợt audit tổng thể. Checkpoint A được kiểm tra trên Chrome khoảng 12:11–12:12 trước khi thêm so sánh năm, báo cáo và workbench. Checkpoint B/C được kiểm tra khoảng 12:18–12:44, ngày 18/10/2026, UTC+7. Chrome kết nối browser 3, vai trò Sandbox specialist / Chuyên viên. Ảnh là capture thật, không phải mockup.

Đã tách xác minh của bản đánh giá lưu trước khỏi dữ kiện hiện hành; không gán lại nguồn mới cho snapshot cũ. Nhận định cũ được đặt trong phần lịch sử có thời điểm, không xuất hiện như kết luận hiện hành khi đổi năm hoặc nguồn stale. Trạng thái lưu phân tích không còn mang nghĩa có điểm hợp lệ. Cổng tính toán, quyền truy cập và lịch sử append-only được giữ nguyên.

Có endpoint đọc mới `GET /api/v2/cases/:id/financial-trends`, hợp đồng `AIC-FINANCIAL-TRENDS-1`. Máy chủ kiểm tra tương thích và lấy tỷ số từ scorer hiện có; FE chỉ định dạng. Có báo cáo xem trước, HTML tải xuống và in trình duyệt. Đã tạo và kiểm tra PDF thật qua chức năng in của Chrome, cho cả nhánh bị chặn và nhánh có điểm synthetic. Không có export PDF ký số hoặc dịch vụ PDF phía máy chủ.

**Cập nhật sau continuation:** đã tạo/select hồ sơ đánh giá doanh nghiệp độc lập với giao dịch trên DB tạm; xem mục9. Chưa triển khai migration0020 vào DB demo. HK VINA giữ nguyên 5/9 usable, các số nhiều cột/nhiều năm chưa grounded không được đưa thành dữ kiện xác minh. Xem đề xuất phạm vi cụ thể tại `docs/implementation/AIC-COMPANY-HEALTH-WORKSPACE-BLOCKER-2026-10-18.md`. Scope company-first đã được chủ sản phẩm xác định; không phải chờ xác nhận lại mục tiêu nghiệp vụ.

## 2. Bảo toàn workspace, dữ liệu và phiên bản

- Trước và sau: branch `duc`, HEAD `9bf0635e8d8e695e79491c1ce527a9562826faef`. Git status trước có 99 entries, sau có 114 entries; đây là entries của status, không phải số file source của riêng lần sửa này. Nhiều thay đổi FE/API/AI/contracts đã tồn tại trước remediation.
- Bản sao source/index/working diff trước sửa ở thư mục private nêu trên. So sánh status không có entry trước nào bị loại bỏ. Không reset/clean/stash/checkout, không stage/commit/push/merge/deploy.
- Build cuối: `apps/web/.next/BUILD_ID = y_BCaJcQ0_MMzaooFhjbJ`. Ảnh checkpoint sớm thuộc các production build trung gian trên cùng HEAD dirty; ảnh `FINAL-*` là lượt retest build cuối. Không có commit SHA mới để gán cho các ảnh.
- Chỉ dừng và thay launcher do phiên này sở hữu qua Ctrl+C. Stack cuối lắng nghe loopback: Next PID29448 :3000, API PID26988 :3001, AI PID28312 :8100. Log private `final-stack.log`; không dừng PostgreSQL hoặc dịch vụ không liên quan.
- Không chạy migration/reset/seed trên `aic_mvp_demo`, không sửa policy hoặc snapshot cũ. Không gửi PDF thật sang AI, không ghi Notion, không gửi email/invitation hay thông điệp ngoài.
- API integration dùng cluster PostgreSQL tạm riêng :15432, owner `aic_test_owner`, được script xác minh đường dẫn trước test; cluster đã dừng. Diagnostic directories: `aic-pg-check-UpjjQQ`, `aic-pg-check-rFdLmY` dưới Temp. Không dùng URL DB chính.

### Tài nguyên UI và mutation được thực hiện

| Ký hiệu | Tài nguyên                                  | Loại dữ liệu / thay đổi                                                                                                    |
| ------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A       | case `91c0f61e-5d4a-47ae-8f63-67f604c7a04b` | Synthetic có sẵn, giữ revision32; FY2024 âm tính, FY2025 cash chưa xác minh; chỉ đọc trong remediation                     |
| B       | case `275b3e13-9c4a-4436-96e1-5d59ed43f768` | Hồ sơ kiểm thử gắn PDF thật; revision39, 5/9 usable giữ nguyên; chỉ mở nguồn/form, nhập lý do nháp rồi discard, không Save |
| V       | case `5893474f-a500-406a-a683-00317032a23f` | **Mới**, `SYNTHETIC-UX-REMEDIATION-20261018`, Buyer Alpha synthetic; lưu qua UI, giữ lịch sử, không xóa                    |

V dùng workflow legacy RECEIVABLE để thử chức năng hiện hữu, **không phải bằng chứng company-first đã hoàn thành**. Amount/term giữ null với lý do kiểm thử, không bịa giá trị giao dịch. Nguồn nhập tay ghi rõ authored technical fixture, no real-company/professional verification. Các quyết định do coding agent điều khiển UI để so với bản gốc synthetic, không giả danh chuyên viên đã xác minh doanh nghiệp thật.

Lịch sử V: rev1 tạo case; rev2 lưu 14 dữ kiện; rev3 đối chiếu 14 giá trị nhưng chưa chọn bridge; rev4 review; rev5 đánh giá bị chặn; rev6 xác nhận riêng bridge theo định nghĩa fixture; rev7 review lại; rev8 kết quả 82.5/AIC-F2. Không thay đổi giá trị hoặc lịch sử của A/B để lấy điểm mong muốn. Chiến lược giữ fixture: giữ tên synthetic, nguồn và lý do, giữ append-only history cho tái hiện; không cleanup bằng xóa dữ liệu.

## 3. Bảng 20 vấn đề

`FIXED + UI PASS` dưới đây áp dụng cho hành vi và tài nguyên đã ghi, không bao hàm mọi edge case hoặc mọi màn hình trong ứng dụng. Những phép thử chưa chạy được ghi riêng ở mục 6.

| ID   | Kết quả                             | Nguyên nhân / thay đổi commit-free                                                                                                                                                                                                                                                | Bằng chứng UI                                                                                                           |
| ---- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| UX01 | **FIXED + UI PASS — isolated rollout only** | Added immutable case purpose, versioned company creation/Workspace union, true null transaction fields; existing financial gates/report/trend reused. Migration0020 tested only on disposable DB; live0019 creation fails closed. | C01–C17; section9. No fake RECEIVABLE or invented amount/term. |
| UX02 | FIXED + UI PASS                     | `fhi-breakdown.tsx`: nhãn xác minh tại thời điểm lưu tách với current fact; cảnh báo snapshot không chứa đủ giá trị gốc; không lấy current facts làm nguồn lịch sử.                                                                                                               | A-after-m02-historical-vs-current; M02 lưu verified, cash hiện tại unverified vẫn giữ nguyên                            |
| UX03 | FIXED + UI PASS                     | `risk-assessment.tsx`: current result đòi cùng set, không stale, hết loading; narrative lịch sử có ngày và collapsed; acknowledgement chặn stale/mismatch.                                                                                                                        | A-after-2024-rev4, C-reload-keeps-2025-rev4, FINAL-negative-FY2024-report                                               |
| UX04 | FIXED + UI PASS                     | `workspace.tsx`, risk assessment: review saved / analysis saved / current experimental result phân biệt; không dùng job completed làm score readiness.                                                                                                                            | Overview A trước/sau quan sát; C-files-guidance-jobs; V current rev8                                                    |
| UX05 | FIXED + UI PASS                     | `assessment-next-actions`, workbench CSS: kỳ + cảnh báo + trạng thái + việc tiếp theo đặt trước kết quả chi tiết.                                                                                                                                                                 | C-assessment-1280x900, C-header-1440x900, C-header-1920x1080                                                            |
| UX06 | FIXED + UI PASS                     | `financial-trends.ts`, registry/controller, versioned schema, `financial-insights.tsx`: server comparison, exact source references, verified-only monetary values, existing gated FHI metrics.                                                                                    | A 2024/2025 comparison, C-assessment-1440x900; 2024 M04 blocked, 2025 M02/M04 blocked, verified facts vẫn hiển thị đúng |
| UX07 | FIXED + UI PASS                     | Report chụp dữ liệu thật khi mở, identity/scope/time, 7 components/inputs, sources/verification, comparisons, findings, limitations. Current score và blocked report đều đã có đầu ra Chrome PDF.                                                                                 | B-final-report-preview, VALID-final-report-preview; PDF kiểm tra riêng, xem mục 5                                       |
| UX08 | FIXED + UI PASS                     | Blocker thành task list; CTA chọn kỳ, edit/verify facts, review tài liệu; focus/highlight cash chưa xác minh, giữ scope. Điều kiện phương pháp không có đường sửa điểm giả.                                                                                                       | A-after-verification-context; C-verification-workbench-1280; V bridge-gates-still-blocked                               |
| UX09 | FIXED + UI PASS                     | Modal rộng 1180px, editor hai cột, sticky title chứa kỳ/đơn vị và Save; nút đóng giữ dirty guard; nguồn mở từ form, giữ draft.                                                                                                                                                    | C-verification-workbench-1280; B-correction-draft-preserved / dirty-guard; VALID-financial-input-draft                  |
| UX10 | FIXED + UI PASS                     | `presentation.ts`: %/lần/倍, exact decimal string shifting; repeating fraction chỉ approximate display có dấu ≈, không dùng lại cho scorer.                                                                                                                                       | Report 2 lần, 40%, 20%, 8%; VI/EN/中文; unit tests có precision và dấu âm                                               |
| UX11 | FIXED + UI PASS                     | Ngoại lệ M05 cần đúng server flag VERIFIED_ZERO_INTEREST_ZERO_DEBT; không coi mọi decimal=null là ngoại lệ. M04 EBITDA0 tiếp tục blocked.                                                                                                                                         | A FY2024 trong comparison và FINAL-negative-FY2024-report                                                               |
| UX12 | FIXED + UI PASS                     | `messages.ts`, upload helpers: PDF trực tiếp vs ZIP dossier có giới hạn riêng; dropzone, file chooser, helper thống nhất PDF/ZIP.                                                                                                                                                 | C-upload-copy-PDF-ZIP; không upload lại PDF thật                                                                        |
| UX13 | FIXED + UI PASS                     | Loại bỏ API/endpoint/contract jargon khỏi helper được sửa; nhãn tài chính/units/status mới có VI/EN/ZH; mã kỹ thuật trong disclosure khi cần.                                                                                                                                     | C-upload-copy-PDF-ZIP, C-language-English, C-language-Chinese; nguồn gốc/quote không dịch                               |
| UX14 | FIXED + UI PASS                     | `field-correction.tsx`, classification và wiring: mở exact evidence hoặc document/version/hash ngay trong form; giữ draft.                                                                                                                                                        | B-correction-source-v3-page2, B-correction-draft-preserved, B-classification-source-v3                                  |
| UX15 | FIXED + UI PASS                     | Verification form có period/basis/currency/unit/regime/source version, current status, decision time, actor/reason disclosure; original entry/quote và bridge riêng.                                                                                                              | A-after-verification-context; C-verification-workbench-1280; V explicit fact/bridge captures                            |
| UX16 | **BLOCKED — phần hướng dẫn đã sửa** | Files có đường dẫn và các bước đến bộ BCTC; picker nguồn của Registry vẫn giữ exact provenance. Chưa chứng minh full real PDF→đủ 7 metrics→company report: nguồn B chỉ 5/9 usable, nhiều cột chưa grounded, và full real-source acceptance chưa có đủ dữ kiện grounded. Không đoán hay auto-import/verify. | B-HK-extraction-5-of-9-unchanged; B-source/form captures; C-files-guidance-jobs                                         |
| UX17 | FIXED + UI PASS                     | `DocumentLineage`: chuỗi nguồn phân biệt các file trùng tên, v1/v3 riêng, referenced/old badge dựa trạng thái; native audit disclosure giữ lineage/hash. Không suy ra v3 là latest của mọi v1 cùng filename.                                                                      | C-source-families-1280; nguồn v3/page2 đã đối chiếu                                                                     |
| UX18 | FIXED + UI PASS                     | Jobs ghi rõ nhật ký xử lý, lỗi cũ giữ truy vết và phân biệt nguồn hiện hành; retry disabled có lý do/hướng xử lý, không phải chỉ số job khó hiểu.                                                                                                                                 | C-files-guidance-jobs; failed job cũ, receipt processing completed và retry reason cùng quan sát được                   |
| UX19 | FIXED + UI PASS                     | Session storage chỉ giữ set/assessment IDs, scope theo user+case; backend ACL/currentness vẫn kiểm lại; không ghi facts/token vào URL/storage.                                                                                                                                    | C-reload-keeps-2025-rev4, C-back-forward-context; V score-persists-reload                                               |
| UX20 | FIXED + UI PASS                     | Tab key handler bỏ qua Ctrl/Meta/Alt trước Home/End/Arrow.                                                                                                                                                                                                                        | Chrome Home→Overview, End→History, ArrowLeft→Assessment, Ctrl+Home giữ tab; C-keyboard-arrow-returns-assessment         |

## 4. Nhật ký UI trước/sau và test ID

Prefix ảnh private **P** = `C:/Users/52duc/AppData/Local/AIC/ux-remediation-20261018/`. Mỗi tên ảnh bên dưới thêm `.jpg`. Manifest `P/browser-evidence.json` có URL và giờ UTC của từng capture. Ảnh trước audit cũ vẫn ở manifest được dẫn trong prompt; không tái tạo ảnh trước bằng code.

| Test | Dữ liệu / bước thao tác thật                                                                                              | Kỳ vọng → quan sát                                                                                                                                                                             | State / evidence                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A01  | A trước sửa: mở Assessment2025, M02                                                                                       | Trước: metric verified/current cash unverified không có mốc rõ. Sau: saved verification/current verification riêng, snapshot limitation hiện.                                                  | PASS; before-assessment, before-m02 → A-after-m02-historical-vs-current                                                |
| A02  | Chọn FY2024, chọn bản rev4, chuyển latest; reload                                                                         | Không hiện điểm/nhận định cũ như current, ack stale disabled. Đúng.                                                                                                                            | PASS; A-after-2024-rev4; C-reload-keeps-2025-rev4; FINAL-negative-FY2024-report                                        |
| A03  | A chọn FY2025 → CTA unverified fact                                                                                       | Mở đúng form FY2025, cash được focus/highlight, không chọn checkbox hộ người dùng. Đúng.                                                                                                       | PASS; A-after-verification-context; C-verification-workbench-1280                                                      |
| A04  | Overview và Files                                                                                                         | Đã lưu phân tích/review không đồng nghĩa score ready; job/receipt có ngữ cảnh riêng. Đúng.                                                                                                     | PASS; overview AX, C-files-guidance-jobs                                                                               |
| B01  | B → Files → Library → v3 extraction → sửa Tổng tài sản → nhập lý do nháp → nguồn                                          | Exact PDF v3/page2/quote; đóng nguồn giữ reason và missing=true. Đúng; chưa nhập/sửa số tài chính thật.                                                                                        | PASS; B-correction-source-v3-page2, B-correction-draft-preserved                                                       |
| B02  | Đóng form dirty → chọn Bỏ thay đổi; mở Classification → nguồn                                                             | Dirty guard hiện; source v3, đóng về đúng form; không lưu. Đúng.                                                                                                                               | PASS; B-correction-dirty-guard, B-classification-source-v3                                                             |
| B03  | B extraction và guide                                                                                                     | 5/9 usable tiếp tục cần đối chiếu, không tự tạo facts/score. Đúng; full real journey chưa đủ căn cứ.                                                                                           | PASS negative / full path BLOCKED; B-HK-extraction-5-of-9-unchanged                                                    |
| B04  | A comparison FY2024/FY2025, chọn năm từ bảng                                                                              | Verified revenue/profit/cash/debt/equity theo từng năm; M04 zero EBITDA và M02 cash unverified không vẽ/thay số giả. Đúng.                                                                     | PASS; C-assessment-1440x900, FY2024 report                                                                             |
| B05  | A mở báo cáo2025 và2024                                                                                                   | Score/band giữ trống; lý do chặn đúng kỳ, không có old maximum-points narrative. Đúng.                                                                                                         | PASS; B-report-blocked-2025, FINAL-negative-FY2024-report                                                              |
| V01  | Tạo V từ danh sách qua UI; chọn CP synthetic; amount/term unknown có lý do                                                | Hồ sơ mới được lưu, banner synthetic; đây vẫn là legacy transaction.                                                                                                                           | PASS fixture / company-first BLOCKED; VALID-owned-synthetic-case-created                                               |
| V02  | Nhập 14 giá trị reference, FY2025, standalone, VN_TT133,VND×1, unaudited, source synthetic; Save                          | Lưu rev2, facts vẫn unverified/score blocked. Đúng. Ngày được nhập thành công bằng AX date control; locator fill ban đầu chưa nhập được và native validation ngăn Save, không có fake success. | PASS; VALID-financial-input-draft, VALID-before-verification-blocked                                                   |
| V03  | Đối chiếu raw/normalized 14 values với original entry; chọn từng fact, chưa chọn bridges; Save → Review → Assess          | Facts verified trong fixture nhưng M02/M04 tiếp tục chặn, tổng null ở rev5. Đúng.                                                                                                              | PASS; VALID-explicit-fixture-facts-no-bridges, VALID-bridge-gates-still-blocked, VALID-assessment-without-bridges-null |
| V04  | Chọn riêng 3 bridge assertions có trong original fixture, ghi rõ lý do coding-agent synthetic; Save → Review lại → Assess | Rev8 =82.5/AIC-F2, 7 points đúng, PD không phát. Đúng.                                                                                                                                         | PASS; VALID-fixture-bridge-assertions-explicit, VALID-score-82-5-F2-seven-components                                   |
| V05  | Reload V → mở report có điểm → Chrome print                                                                               | Kỳ/score giữ đúng; 7 ratios, inputs, caveats, current findings và refs trong PDF. Đúng.                                                                                                        | PASS; VALID-score-persists-reload, VALID-final-report-preview, PDF mục 5                                               |
| C01  | Home/End/ArrowLeft/Ctrl+Home khi focus tab                                                                                | Chuyển tab đúng với phím thường; modifier không tự đổi tab. Đúng.                                                                                                                              | PASS; C-keyboard-arrow-returns-assessment                                                                              |
| C02  | Chọn year/history → Reload; danh sách → Back/Forward                                                                      | User/case context giữ đúng, không có facts trong URL. Đúng.                                                                                                                                    | PASS; C-reload-keeps-2025-rev4, C-back-forward-context                                                                 |
| C03  | Viewports1280×900,1440×900,1920×1080; VI→EN→中文→VI                                                                       | Title/status/actions đọc được, tables cuộn trong container khi cần; desktop1920 clientWidth=scrollWidth=1905, không page overflow ngang.                                                       | PASS scope quan sát; C-_size_, C-language-English/Chinese                                                              |
| C04  | Browser zoom shortcut Ctrl+plus qua tool                                                                                  | Không đổi width1905 hoặc DPR1; không đủ bằng chứng zoom thật200%. Không thay bằng pageScale để gọi là browser zoom.                                                                            | BLOCKED tooling / 200% NOT RUN                                                                                         |

## 5. Đầu ra báo cáo và hồi quy tính toán

PDF riêng tư, không đưa vào Git:

- `P/B-report-blocked-2025.pdf`: Chrome/Skia, A4 landscape, 8 trang có nội dung; đã render từng trang để xem, không có trang trắng hoặc nhận định maximum-points cũ. Bản trước sửa CSS in còn giữ `B-report-before-print-fix.pdf` để truy vết.
- `P/VALID-report-82-5-F2.pdf`: Chrome/Skia, A4 landscape, 9 trang gồm toàn bộ nguồn fixture, 82.5/AIC-F2 và caveats; đã render xem cả 9 trang, không mất bảng/cắt số hoặc trang trắng. Appendix nguồn đầy đủ còn dài; đây là bản in ban đầu chưa ký.
- Print dùng `Page.printToPDF` qua capability CDP được phép của tab Chrome đang mở report; không dựng PDF mô phỏng bằng script. PDF được kiểm tra bằng Poppler + pypdf sau khi in. Native Save dialog chưa tự động hóa; không tuyên bố test được hộp Save của hệ điều hành.
- Link HTML đã xuất hiện trong UI. `downloadMedia` báo **Blob downloads are not supported by this browser**: tooling BLOCKED cho kiểm tra tải HTML, không coi đó là app FAIL/PASS. Không truy cập/bypass `chrome://downloads`.

| Hồi quy                    | Expected                                                                                                                       | Observed                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| V reference 7 points       | 15 /7.5 /16 /9 /12 /10 /13                                                                                                     | Chrome rev8 đúng cả bảy; reload giữ đúng                                           |
| Tổng / band                | 82.5 / AIC-F2                                                                                                                  | Chrome và PDF đúng, chỉ synthetic                                                  |
| Weights                    | 15/10/20/10/15/10/20                                                                                                           | Giữ nguyên; server tests và report cùng giá trị                                    |
| Thiếu bridge               | M02/M04 null, không redistribute                                                                                               | V rev5 UI chặn đúng trước khi xác nhận riêng                                       |
| EBITDA0                    | M04 blocked dù debt0                                                                                                           | A FY2024 UI/PDF đúng                                                               |
| Debt/interest0             | M05 chỉ áp verified flag exception                                                                                             | A FY2024 hiển thị lý do ngoại lệ, M04 vẫn chặn                                     |
| Unverified/current change  | Không phát score hiện hành; historical narrative tách                                                                          | A cash unverified, rev4/latest/differentFY đúng                                    |
| Money precision / units    | Không float/FX/annualize source data                                                                                           | Unit tests exact decimal, original raw values giữ nguyên; FE chỉ định dạng         |
| Scope/comparison           | Full-calendar FY, actual/known regime, cùng entity/country/industry/pilot/basis/regime/currency/unit; restatement/gaps flagged | 2-year UI và server reference rules PASS; UI từng loại incompatibility chưa chạy   |
| PD / official credit claim | PD null; experimental/not validated                                                                                            | Server guards/tests giữ nguyên; UI/PDF không phát PD, loan approval hoặc safe term |

## 6. Business journey coverage và phần chưa chạy

| Journey                                      | Coverage                                                                                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login/session                                | Existing specialist session sống qua restart; không đọc/copy cookie/token. Fresh login/logout/relogin **NOT RUN** để không kết thúc session đang dùng khi chưa có flow phục hồi đã xác minh. |
| Company-first entry                          | **BLOCKED UX01**; V legacy không thay thế bằng chứng này.                                                                                                                                    |
| Files/OCR→correction→source                  | UI PASS readonly B, exact v3/page2, draft/dirty guard PASS. Không gọi AI/upload thật.                                                                                                        |
| PDF→Financial Registry→explicit verification | Guide/routes/source access đã sửa. Synthetic manual-entry path Save/verify PASS. Full real-PDF path **BLOCKED UX16**, không làm giả đủ dữ kiện.                                              |
| Score blocked / available                    | A negative và V rev5/rev8 đều live Chrome PASS, có reload.                                                                                                                                   |
| Multi-year                                   | A hai năm verified facts + per-metric blocked/gaps PASS. UI shifted periods/FX/basis mismatch/rejected decisions **NOT RUN**; server rules/test có kiểm.                                     |
| Current/stale findings                       | A2024/2025/rev4/latest và V current report PASS.                                                                                                                                             |
| Manager report                               | Blocked và scored preview/Chrome PDF PASS; HTML download tooling BLOCKED; unsigned, không server-signed PDF.                                                                                 |
| History                                      | Assessment picker/reload/Back/Forward PASS. Chưa retest mọi request/event-history filter.                                                                                                    |
| Requests                                     | Không sửa workflow request/export hiện hữu. Real-UI draft/approve/export/reply/ack end-to-end **NOT RUN** trong remediation; isolated API regression PASS.                                   |
| Permissions                                  | Isolated tenant/case ACL, staleness, locks/replay PASS gồm new trend read. UI foreign/invalid stored ID injection và account-switch **NOT RUN**, không giả UI PASS từ unit tests.            |
| i18n/keyboard                                | Checked new headings/blockers/units at VI/EN/zh-CN and standard tab keys/Ctrl+Home. Không chứng nhận mọi chuỗi/mọi field; Meta/Alt browser-specific shortcuts và screen reader **NOT RUN**.  |
| Responsive/accessibility                     | 1280/1440/1920 observed; visible focus/dirty guard/labels observed. Real200% zoom tooling BLOCKED; tablet/mobile/full WCAG/contrast audit **NOT RUN**.                                       |

T01/T02/T05/T06/T07/T08/T09/T10 có scoped implementation và UI evidence tương ứng bảng20 issues. T03 company entry vẫn BLOCKED; T04 real-source full journey PARTIAL/BLOCKED. Không lấy các control chưa retest trong audit cũ làm PASS mới.

## 7. Commands và kiểm tra kỹ thuật

Các lệnh validation thực chạy từ repository root (trừ lệnh có `--filter` tự chuyển workspace):

```powershell
pnpm typecheck
pnpm api:build
pnpm build
pnpm lint
pnpm check:aic
node --test apps/api/test/financial-trends.cjs apps/api/test/fhi-scorer.cjs
node scripts/test-local-postgres.cjs --test-concurrency=1 apps/api/test/mvp-workflow.integration.cjs
node --test apps/web/tests/unit/financial-presentation.test.cjs apps/web/tests/unit/business-inputs.test.cjs apps/web/tests/unit/response-validation.test.cjs
node --require 'C:/Users/52duc/AppData/Local/AIC/ux-remediation-20261018/baseline-preload.cjs' --test apps/web/tests/unit/financial-labels.test.cjs apps/web/tests/unit/review-i18n.test.cjs
pnpm local:serve
```

Prettier chỉ chạy `--write` trên các source/test đã chạm trong remediation, không format toàn repo. Build có hai lần lỗi trung gian do missing translation keys, unused import và BigInt literal target; đã sửa, build cuối PASS. Chuyển sang `BigInt(...)` không đổi target build hoặc phép tính scorer.

| Check                                | Kết quả thực                                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Final web build/typecheck            | PASS, Next16.4 production, BUILD_ID nêu trên                                                                                                                                                                                               |
| API build                            | PASS                                                                                                                                                                                                                                       |
| Lint                                 | PASS: architecture117 runtime files/11 modules/no cycles-orphans; toàn bộ Prettier check PASS                                                                                                                                              |
| FHI + trend rules                    | **10/10 PASS**, gồm82.5 oracle, all anchors, source/scope gates, EBITDA/zero-debt, exact value, rejected vs unverified                                                                                                                     |
| Disposable PostgreSQL workflow       | **13/13 PASS**, gồm existing workflows/ACL/concurrency/source fidelity và new comparison contract                                                                                                                                          |
| Focused FE semantic/precision checks | **16/16 PASS**                                                                                                                                                                                                                             |
| `pnpm check:aic` aggregate           | **FAIL**, không đánh dấu xanh. Demo render tests có dependency/mock issues; financial-label render không nạp module JSX; review-i18n kỳ vọng ID/raw rule cũ. Không sửa implementation để trả lại debug codes cho UI.                       |
| Baseline comparison subset           | Cùng current tests nhưng đọc source từ private before-copy: **9 PASS/3 FAIL**. Xác nhận ba lỗi financial-label/review-i18n đã có trước lần sửa này. Không suy ra tất cả failure khác là pre-existing; các failure khác chưa phân loại hết. |

Private logs: `lint-results.txt`, `baseline-unit-results.txt`, `final-stack.log`. Pure tests không thay cho UI acceptance. Không dùng ảnh từ mock/render tests làm bằng chứng UI.

## 8. Diff theo lớp và việc còn lại

- **FE:** assessment presentation/actions, scoped selection, keyboard, wide modal/workbench, financial precision/exception, source access trong correction/classification, source-family labels/jobs/upload copy; new financial insights/report HTML/print CSS và three-locale specialist copy.
- **BE:** một read-only trend service method/route và pure comparison/verified fact projection. Không sửa scorer formulas, publication gates, auth/ACL, human verification mutation hoặc AI transport.
- **Contracts:** additive FinancialTrendsV1 schema/OpenAPI/read contract; `baseline_metrics` giữ standalone selected-set ratios cho report dù comparison bị loại. Continuation bổ sung migration0020 và company-health contracts; chỉ chạy DB tạm, xem mục9.
- **Tests:** source/scope/precision rules +82.5 oracle và comparison ACL/contract assertions; existing inputs/history semantics giữ nguyên.
- **AI:** không có thay đổi do remediation này; các AI dirty changes đã tồn tại trước baseline.

Remaining P1: UX01 đã có vertical slice và legacy regression trên DB tạm, còn controlled rollout vào DB demo; UX16 cần tài liệu/số liệu grounded đúng kỳ, basis và đơn vị trước khi có đủ7 metrics của doanh nghiệp thật. Không có owner approval mới đang chờ trong turn này; scope company-first đã rõ, không được mở gate hay bịa nguồn để lấp chỗ thiếu.

Remaining P2 (cập nhật): aggregate frontend mock-test failures đã xử lý,72unit+20integrationPASS ở mục9; bổ sung UI edge cases chưa chạy ở mục6; kiểm tra true200% zoom; benchmark comparison với nhiều statement sets (hiện re-evaluate mỗi set, chưa đo tải nhiều năm); rút gọn source appendix/report pagination nếu yêu cầu bản manager ngắn hơn. Không tuyên bố full WCAG hay production rollout ready.

**Next agent task cụ thể:** xem mục9: kiểm tra và chuẩn bị controlled rollout company-health v1 với backup đã xác minh; không chạy migration lên DB demo khi chưa có chỉ thị riêng. Với UX16, cần nguồn tài chính grounded đúng nhãn/cột kỳ/basis/đơn vị, giữ HK VINA 5/9 usable đến khi có căn cứ thật. Các kết quả unit, UI và migration phải được báo riêng.

**NO COMMIT / PUSH / DEPLOY / NOTION WRITE. Overall vẫn PARTIAL/FAIL cho live demo; company-first vertical slice đã UI PASS trên DB tạm.**

## 9. Continuation: company-health vertical slice, 18/10/2026

Mục này cập nhật các kết luận cũ ở mục1–8. Những số build, PID và kết quả test phía trên là các checkpoint lịch sử. Không dùng chúng như tình trạng tiến trình hiện tại.

### Thay đổi thực tế

Đã triển khai mục đích hồ sơ bất biến `company_health`, khác với `transaction` cũ. Request mới chỉ nhận phiên bản hợp đồng, doanh nghiệp và lý do; không nhận số tiền, kỳ hạn, vai trò hoặc loại exposure. Hồ sơ công ty lưu exposure, exposure_kind, lifecycle và transaction-policy bằng SQL NULL thật. Không tạo exposure version/declaration giả. Nút chính trên danh sách là tạo đánh giá doanh nghiệp; giao dịch cũ vẫn có nút riêng.

`POST /api/v2/company-assessments`, `GET /api/v2/company-assessments/capabilities`, Workspace union, company Assessment v1, JSON Schema và OpenAPI đã có implementation. Session/Origin/CSRF, tenant/counterparty access, case ACL, creator membership, audit reason và idempotency giữ nguyên cơ chế hiện có. Company assessment dùng cùng Financial Registry/scorer, yêu cầu nguồn và cầu nối xác minh; không cần review checklist hợp đồng/thanh toán. Báo cáo bị chặn được lưu rõ ràng khi chưa đủ nguồn/phương pháp. Transaction review không xuất hiện trong hồ sơ công ty.

Tài liệu thiết kế/rollout: `docs/implementation/AIC-COMPANY-HEALTH-CONTRACT-V1.md`. Migration `0020_company_health_workspaces.sql` mở rộng schema, giữ nguyên biểu thức kiểm tra giao dịch cũ trong purpose guard, thêm discriminator/shape check và trigger bất biến; không xóa dữ liệu hay sửa snapshot. Chỉ chạy trên cluster riêng. App startup chấp nhận0019 cho giao dịch và kiểm checksum0020 nếu đã có; tạo company fail-closed khi chưa cài0020.

### Chrome manual acceptance — công ty riêng, không có giao dịch

Thời gian chính: 13:15–13:28 UTC+7, Chrome browser3, tab947933347, môi trường `http://127.0.0.1:3100`, API3101, PostgreSQL15433. DB `aic_company_uat`, dữ liệu authored SYNTHETIC; không nối DB demo, không upload PDF thật hoặc gọi AI bên ngoài. Nguồn fixture đã ghi tại `docs/implementation/AIC-COMPANY-HEALTH-SYNTHETIC-UAT.md`. Không cấu hình FHI publication policy trong UI harness, vì vậy score/band đúng là null. Numeric82.5/F2 có test PostgreSQL riêng với policy ghi rõ synthetic test only, không giả phê duyệt phương pháp thật.

Hồ sơ C do UI tạo: `321eb511-f25e-4d4f-99fa-d92e913a42d3`, revision8. Nguồn chứng cứ private: `C:/Users/52duc/AppData/Local/AIC/company-uat-cEFe5L/browser/manifest.json`. Mọi ảnh ở bảng dưới nằm cùng thư mục, đuôi `.jpg`.

| Test | Thao tác thực trong Chrome | Kết quả quan sát | Trạng thái / ảnh |
| --- | --- | --- | --- |
| C01–C03 / UX01 | Đăng nhập, Cases → Tạo hồ sơ đánh giá doanh nghiệp → chọn công ty tổng hợp + lý do → Lưu | Không có amount/term/kind/roles. Điều hướng vào hồ sơ công ty đã lưu, banner synthetic; tabs overview/files/financial/history. | PASS: C01-list-company-primary, C02-create-no-exposure-fields, C03-company-created-overview |
| C04–C05 / UX15 | Nhập FY2025, riêng lẻ, VN_TT133, VNDx1, 14 số và nguồn gốc cụ thể; lưu; chọn năm; chạy đánh giá | Persist rev2/3; dữ kiện chưa xác minh, bridges thiếu và method chưa cấu hình; score/band trống, không có stale strengths. Không yêu cầu review hợp đồng giả. | PASS: C04-facts-draft-source-context, C05-company-unverified-assessment-blocked |
| C06 / UX15 | Mở Bản nhập gốc, đọc nguồn synthetic; chọn từng14 fact và riêng3 bridge; lý do ghi coding-agent technical fixture only; lưu | Rev4, verified theo fixture đúng kỳ; đánh giá rev3 trở thành historical/stale. Chưa có method policy nên không phát điểm. | PASS: C06-explicit-fixture-verification |
| C07–C08 / UX06 | Thêm FY2024 bằng nguồn authored riêng, chưa xác minh → chọn kỳ → đọc bản gốc → chọn từng fact/bridge, lưu → Reload | Năm chưa verified được để trống. Sau explicit fixture verification, bảng có2024: revenue360/EBIT72/CFO28.8,2025:400/80/32. Các tỷ số1.086956… được ghi xấp xỉ; %/lần đúng; không có FX/annualization/fill. | PASS: C07-trend-2024-unverified-gap, C08-company-two-year-trend-after-reload |
| C09 / UX07 | Chạy đánh giá FY2024 → xem preview → Chrome Page.printToPDF | Rev8 đã lưu; report đúng2024, đủ7metric/inputs, source/verification, hai năm, lý do method chưa cấu hình, synthetic/NOT VALIDATED; điểm vẫn trống. Không có transaction review. | PASS: C09-company-FY2024-report; company-health-FY2024-blocked.pdf |
| C10–C12 / UX13/history | Mở lịch sử → English → 简体中文 → VI | Đủ8event, company creation có nhãn riêng; history không còn nhãn yêu cầu giao dịch. Nguyên văn nguồn giữ nguyên. | PASS: C10-final-company-history, C11-company-history-English, C12-company-history-Chinese |
| C13 / UX05 | Đặt viewport1280/1440/1920x900, đọc năm chọn và chụp; reset viewport | Document scrollWidth1265/1425/1905 tương ứng, không tràn ngang document; kỳ2024 giữ nguyên. | PASS: C13-company-final-1280/1440/1920 |
| C14–C15 / session | Đăng xuất, đăng nhập lại bằng cùng credential tổng hợp → mở công ty từ danh sách → financial | Phiên mới được xác thực; không mất hồ sơ/2năm/trend; không dùng cookie/API thay cho UI login. | PASS: C14-logout-login-screen, C15-relogin-company-retained |
| C16–C17 | Reload build sau sửa nhãn Chinese back → mở report và chờ nội dung hoàn chỉnh | `返回档案列表`; report vẫn đúng công ty,2024 và method blocker; không có giá trị score cũ. | PASS: C17-FINAL-company-report-loaded; C16 là frame chuyển trạng thái, không dùng một mình làm bằng chứng loaded |

Bản PDF9trang được render toàn bộ bằng Poppler1300px và đọc cả9ảnh `company-report-page-1.png`…`-9.png`. Không có trang trắng/clipping hoặc năm bị gán lại. Phụ lục nguồn dài vì14fact cùng nguyên văn nguồn synthetic; đây là hạn chế độ gọn, không phải PDF ký số/server export. Trang9 ít nội dung nhưng có tham chiếu snapshot; không gọi là trang trắng. PDF số synthetic82.5/F2 từ checkpoint trước vẫn là chứng cứ riêng, không biến thành điểm công ty thật.

Sau user tiếp tục, tiến trình gắn phiên trước không còn lắng nghe. Giữ nguyên cluster/data/chứng cứ cEFe5L trên đĩa; không reset/xóa/reseed nó. Tạo cluster mới iErsIk để kiểm tra phần hạn chế trên build cuối. Khởi động launcher sở hữu bằng Start-Process hidden; không mở terminal window và không dừng PostgreSQL khác. Chứng cứ cuối bổ sung được ghi riêng; không gộp ID/revision của hai cluster.

Retest cuối lúc13:46–13:48UTC+7: Chrome tab947933418, company-only case
`4ba35f96-1208-4134-bfb8-90d9a09b750d`, revision3, build
`9rzC6ly8ILlE0qqrcjJsu`. Tạo qua UI, nhập14fact synthetic FY2025 chưa xác minh,
lưu/chọn kỳ/chạy assessment, mở Hạn chế trong Registry và preview báo cáo.
Disclosure hiển thị đủ4hạn chế: method chưa phê duyệt, xác minh nguồn không xác
nhận pháp nhân, không FX/annualization/profit proxy/reweight, exact reconciliation.
Report giữ đủ4blocker method/facts/quick-assets/EBITDA bridge; score/bandnull.
**UI PASS** cho sửa production nhỏ cuối này. Evidence riêng:
`C:/Users/52duc/AppData/Local/AIC/company-uat-iErsIk/browser/manifest.json`,
`FINAL-registry-limitations.jpg`, `FINAL-company-blocked-report.jpg` cùng thư mục.
Đã giữ mở tab báo cáo cho người dùng; toàn bộ fixture cuối này vẫn chưa verified.

Owned processes tại checkpoint13:47: demo launcher30344, API25752:3001,
Next27816:3000, AI29164:8100; isolated launcher/API23088:3101,
Next24368:3100, PostgreSQL21928:15433. Chỉ là PID quan sát tại thời điểm đó;
xác minh lại workspace/command line trước khi dừng. Thư mục storage dùng đường
dẫn canonical thật, DACL riêng cho current user/SYSTEM/Administrators; không
bypass kiểm tra PrivateDocumentFiles. Không ghi credential vào Git/report.

### Test tự động — kết quả mới thay cho lỗi cũ

| Kiểm tra | Kết quả |
| --- | --- |
| `pnpm api:build` | PASS |
| `pnpm typecheck`, `pnpm build` | PASS; build cuối `9rzC6ly8ILlE0qqrcjJsu`, Next16.4 production |
| `pnpm lint` | PASS119runtimefiles/11modules/no cycles-orphans, Prettier toàn bộ PASS |
| `node scripts/test-local-postgres.cjs --test-concurrency=1 apps/api/test/company-health-migration.cjs apps/api/test/mvp-workflow.integration.cjs` | **15/15PASS**; cluster15432 dừng sạch, diagnostic `aic-pg-check-pULorv` |
| Scorer/trend + company decoder/precision/response tests | **23/23PASS** |
| `pnpm check:aic` sau sửa test harness/kỳ vọng | **PASS72/72unit +20frontend integration**, architecturePASS |

Test migration thực0019→0020: tạo legacy sentinel trước expansion, so sánh toàn bộ row cũ nguyên vẹn sau expansion (chỉ thêm purpose=transaction), startup0019PASS, company capabilityfalse/create503 trước expansion, capabilitytrue sau, invalid legacy null-fields và shape bị DB chặn, purpose bất biến, checksum0020 sai làm startupFAIL, replay migrate không chạy lại. Các lần này chỉ trên disposable database, không phải demo.

Test company service: không nhận exposure/amount/term, cross-tenant create/read/get assessment bị từ chối, concurrent create cùng key chỉ có1hồ sơ, replay bất biến và conflict request, không tạo exposure version, finance unverified/bridge chưa xác nhận không có điểm; policy test + verification rõ nguồn mới có82.5/AIC-F2,7components và PDnull. Sửa dữ kiện làm snapshot cũ stale nhưng score lịch sử không bị sửa; stale acknowledgement bị chặn. Giao dịch/request/waiver/questionnaire/source/case-lock regressions vẫn PASS.

Sáu lỗi aggregate trước được phân loại và sửa **test**: missingSessionProvider, loaderTSX, kỳ vọng raw machineID/rule và extraction-year tự verified không còn phù hợp. Test mới giữ kiểm tra source object bất biến, productionDOM không leak diagnostics, unverified year không tự verified. Một lỗi integration tiếp theo là fixture dùng detailed archive có members trong summary-list; sửa fixture đúng wire schema và giữ assertion reject thêm trường. Demo render tests ghi output vào temp riêng, không dùng đường dẫn người viết test; headless artifact capture chuyển thành opt-in, không dùng làm Chrome acceptance. Có sửa production nhỏ: Financial Registry hiển thị disclosure hạn chế vốn thiếu, không bỏ caveat để làm test xanh.

Private aggregate logs: `C:/Users/52duc/AppData/Local/AIC/ux-remediation-20261018/company-final-check-aic.log` (FAILtrước), `company-final-check-aic-fixed.log` (PASSsau). FHI scorer/method/Decimal hash so baseline đều **unchanged=true**. Không thay formulas/weights/gates để làm demo đạt điểm.

### Demo và rollout còn lại

Read-only proof lúc13:33UTC+7: `company-demo-readonly-proof.json` cùng thư mục log, BEGIN READ ONLY/ROLLBACK; DB `aic_mvp_demo` vẫn migration0019, purpose expansionabsent; A rev32, B rev39, V rev8. Không có migration/reset/seed/write demo trong continuation. Healthready trảready khi restart code mới trên schema0019. Browser demo hết session, full login/retest main DB cuối **BLOCKED credential/session**, không khai báoUIpass cho bước đó; không đọc/đổi credential của người dùng.

UX01: implementation/UI trên isolated workspacePASS; live rolloutBLOCKED theo quy định bảo vệ DB trong prompt. UX16: real HK VINA5/9usable vẫnBLOCKED bởi thiếu grounded multiyear/multicolumn facts; không bịa source, import, legal identity hoặc human verification. Sửa này không thay input/scoring validity của nguồn thật.

Pending: operator-controlled0020rollout với backup đã xác minh; đủ nguồn hợp lệ cho UX16; true200%browserzoom và edge cases chưa chạy ở mục6; nhiều-year performance benchmark; rút gọn source appendix theo yêu cầu sau. Không có owner approval cho deploy/migrate main DB được suy diễn từ yêu cầu continue.

Branch vẫnduc, HEAD9bf0635e8d8e695e79491c1ce527a9562826faef; dirty entries132 sau cập nhật docs. Giữ tất cả99entries baseline, không reset/stash/clean/stage/commit/push/merge/deploy/Notion. FE+BE+contracts/tests/docs thay đổi bổ sung, AI source không sửa trong continuation.
