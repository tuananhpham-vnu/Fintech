# Yêu cầu thực thi v2: hoàn tất phần còn thiếu từ sandbox0.3.1

**Hãy thực thi yêu cầu này ngay. Tôi yêu cầu triển khai code và tích hợp đầy đủ phạm vi MVP bên dưới, không yêu cầu review/chỉnh prompt. Nội dung file này là My request.**

Ngày17/10/2026, Asia/Saigon. Tiếp tục trên repository/WIP hiện có. Mục tiêu là sản phẩm có thể chạy và kiểm thử hai nghiệp vụ lõi để dự thi. Agent triển khai chịu trách nhiệm chất lượng code và test, nhưng **nghiệm thu độc lập sẽ do các agent khác thực hiện sau khi bàn giao**. Không tự tuyên bố đã được independent review hoặc kết luận thay reviewer.

## 0. Chỉ đạo tiếp tục từ báo cáo vừa bàn giao

Tôi đã nhận báo cáo `MVP_SANDBOX_PARTIAL / BROWSER_ACCEPTANCE_PENDING_OWNER_STACK` và README sandbox0.3.1 mới nhất. **Hãy thực thi tiếp ngay**, giữ toàn bộ source/WIP/index. Đây là chỉ đạo tiếp theo sau prompt cũ, không phải yêu cầu review/chỉnh prompt.

### Các phần đã có — giữ, tích hợp phần mở rộng và regression

- Exposure claims/conditions/declarations, exact source và409rebase.
- Issue resolve/dismiss/reopen, current-source guards, append-only decisions/history.
- Optional staff questionnaire, response revision và verification riêng.
- Document/storage/worker/review/request/response/waiver và các phần foundation trước đó.

Không coi các phần này đã browser-tested hoặc live-AI-tested. Không dựng implementation thứ hai chỉ vì yêu cầu F01–F12 bên dưới nhắc lại chúng. Các mục dưới đây là acceptance tổng thể để kiểm coverage, không phải danh sách tất cả phải viết lại.

### Phần mới cần triển khai — thứ tự ưu tiên

1. **Counterparty create/edit cơ bản:** khóa contract nguồn/revision/invalidation theo yêu cầu ởF01, triển khai UI/API/DB. Tạo record unresolved khác xác nhận identity; chưa có chứng cứ không được tự verified. Xác nhận pháp nhân có thể vẫn unavailable khi chưa đủ căn cứ, nhưng không vì thế đóng vĩnh viễn CRUD cơ bản. Không dùng hai counterparties bootstrap để thay chức năng này.
2. **Native invitations/respondent:** quyết định mới nhất của owner là form RIÊNG trong app, không Google Forms. Optional staff-text approval trước đó không phải lý do giữ link đóng mãi; implement capability scope/expiry/revoke, câu trả lời trực tiếp, receipt và specialist review theoF03/F04. Token chỉ xác nhận quyền truy cập được mời, không chứng minh danh tính pháp nhân. Tự chốt kỹ thuật/bounded development parameters; hỏi lại chỉ nếu phát sinh quyết định nghiệp vụ thực sự ngoài scope.
3. **Questionnaire-as-Exposure-source:** hiện chưa phát hành projection. Bổ sung mapping source record/response revision/origin/verification vào claims/declarations, giữ field ownership và source guards; không giả document hoặc chuyển câu trả lời thành verified settlement.
4. **Manual retry:** phát hành command/DTO/UI theo remaining budget/source/intent/reconciliation ởF09; không reset attempts hoặc dùng re-upload/new-key để né outcome chưa rõ.
5. **FinancialStatementSet/Fact, verification và pure FHI scorer:**F10/F11. Chưa có method/pilot approval thì score/band null; hoàn thiện code engine/contract/trace UI và canonical reference tests vẫn thực hiện được. Không lấy chưa duyệt phát điểm làm lý do bỏ engine/fact module, cũng không giả approval để demo số.
6. **Browser và live-model acceptance:** chạy ngay khi owner stack/config sẵn sàng; trong lúc chờ vẫn thực hiện1–5 và tests độc lập. Không dừng toàn phiên ở câu “stack ready chưa”.

Các phần mới cần đúng schemas/OpenAPI/ports/examples/grants/migrations/FE mapping; một shared-contract owner/migration writer. Những chi tiết contract kỹ thuật được tự khóa theo invariants/semantics đã duyệt; không tự ghi phê duyệt business mới. Khóa interface hẹp rồi code, thay vì tiếp tục bàn giao draft/preparation mà chưa implement.

### Owner stack và thực thi

Owner đã xác nhận CHƯA có demo sandbox. README hiện yêu cầu0001–0010; nếu phiên này thêm migration thì cập nhật danh sách, runtime grants và lệnh owner phải chạy. Chưa có sandbox thì không nói migrations đã chạy trên demo. Không dùng test cluster đã dừng làm demo URL.

Chuẩn bị một checklist setup ngắn, từng bước có expected result để owner chạy ordinary commands trong terminal được phép: fresh database/least-privilege roles, migration/grants/bootstrap insert-only, private cache, API/AI/worker/frontend. Không gửi secrets vào chat, không tự reset DB, không tạo alternate launcher để vượt Next startup rejection. Yêu cầu provider hiện có là `GEMINI_API_KEY` trong AI server environment theo README; native inspect thành công không chứng minh live extraction.

B03 public ingress và FHI activation vẫn riêng. Thực hiện local/sandbox và independent-review handoff; không deploy public hoặc tự mở numeric gate.

**Kết thúc phiên với code/tích hợp/test và một snapshot bàn giao độc lập. Nếu còn required feature chưa implement, ghi IMPLEMENTATION_PARTIAL; không đổi tên nó thành “chỉ còn fix bugs”.**

## 1. Bối cảnh và thứ tự nguồn

Đọc AGENTS.md áp dụng, git status/index, README, contract/decision log và báo cáo gần nhất; chỉ kiểm tra delta và modules liên quan. Không audit tổng quát lại dự án. Các chức năng đã có phải tái sử dụng và kiểm tra, không viết lại vì báo cáo cũ nói chưa tồn tại.

Nguồn cần đối chiếu: MVP-OWNER-DECISIONS.md; approved sandbox policy artifact; released foundation schemas/OpenAPI hiện tại; MVP-SANDBOX-README.md; execution/handoff mới nhất; nghiệp vụ và phương pháp trong Notion hiện hành. Master Notion: https://app.notion.com/p/1790c2f0937d8344bc9781bc9b4efd32. Trang phương pháp: https://app.notion.com/p/bf10c2f0937d832d936281ed21fe903f.

Giữ riêng yêu cầu đích, quyết định đã duyệt, code thực tế và bằng chứng nghiệm thu. Notion có thể chậm cập nhật; không dùng câu cũ “chưa có apps/api” để phủ nhận source local. Nếu connector không truy cập được, dùng nguồn local đã xác minh và ghi gap, không để lỗi connector làm dừng code độc lập.

Theo báo cáo gần nhất: Nest/PostgreSQL/auth/ACL; policy/case/exposure; canonical documents trong PostgreSQL; private cache; AI HTTP worker; review/request/response/waiver/history; frontend integration đã có. Baseline mới nhất: wire0.3.1-mvp-sandbox, migrations0001–0010, checkpoint314changedpaths, manifest390sourcefiles. Exposure editors, issue resolve/dismiss/reopen và optional staff questionnaire đã implement/tích hợp; không làm lại. Reference test snapshot:157backendPASS,25FEunit+18consumerPASS; chưa browser/live model acceptance. Xác minh trạng thái thực tế; HEAD không đại diện toàn bộ source mới. Không cộng các test counts ở snapshot khác nhau thành E2E PASS.

## 2. Phạm vi và quyền thực hiện

Core bắt buộc:

- RECEIVABLE: organization là seller, counterparty là buyer; đánh giá rủi ro đối tác/giao dịch bán chịu.
- PREPAYMENT: organization là buyer, counterparty là supplier; đánh giá rủi ro ứng trước/delivery/acceptance/refund.
- Một role nội bộ specialist; organization/case ACL vẫn bắt buộc. Respondent là capability bên ngoài, không role contributor hoặc public admin.
- FHI, Transaction Review, chất lượng chứng cứ và quyết định con người là các lớp riêng. Không tự duyệt cho vay, giải ngân, gửi email hoặc nộp bài.
- LOAN/DEBT_INVESTMENT giữ secondary, không mở marketplace hoặc tự đổi thành core.

**Quyết định scope mới nhất: form riêng trong ứng dụng; KHÔNG dùng Google Forms hoặc dịch vụ khảo sát bên thứ ba.** Hủy hướng Google Forms trước đó. Native respondent flow là một phần MVP phải implement và test, không giữ đóng vô thời hạn chỉ vì catalog câu hỏi cố định chưa có. Model/provider AI hiện có là dependency riêng; không diễn giải yêu cầu bỏ dịch vụ form bên thứ ba thành quyền thay provider hoặc tuyên bố dữ liệu AI luôn ở local.

Bạn được sửa FE/BE/DB/workers/storage/contracts/tests và docs liên quan để hoàn thiện phạm vi này. Giữ framework/UI layout hiện có; không redesign toàn bộ hoặc rewrite AI service. Ưu tiên backend adapter với legacy AI1.0.2. Nếu buộc phải đổi AI service/canonical bundle, trình rõ diff/phạm vi trước, không âm thầm phá consumer khác.

Được tự chốt chi tiết kỹ thuật thông thường: module/ports, SQL/index/locks, DTO projection, pagination, token transport, cấu hình development có giới hạn, lease/retry/deadline và test harness; ghi rationale. Không hỏi lại owner từng field kỹ thuật nếu suy ra được từ semantics đã duyệt. Chỉ hỏi khi thật sự thiếu quyết định nghiệp vụ hoặc có xung đột không thể giải quyết trong scope; gom một bảng ngắn, chỉ rõ lựa chọn khuyến nghị và việc bị chặn, tiếp tục phần độc lập.

Giữ B01/B02/B04 sandbox đã được owner duyệt theo decision log: policy effective từ lúc duyệt/version/hash cố định; claims proposed/actual khác verified; source declarations có phiên bản; replay24h theo scope đã duyệt. B03 public ingress và FHI pilot chưa được duyệt. Không giả approval/authority/timestamp và không tự mở production.

## 3. Danh mục bắt buộc phải hoàn thiện

Đầu phiên tạo một ma trận ngắn cho F01–F12 dưới đây: requirement → hiện trạng → file/contract → việc cần làm → acceptance. Dùng ma trận để triển khai liên tục; không dừng ở việc viết ma trận.

### F01 — Counterparty tạo/sửa thật

Tích hợp UI→API→DB cho tạo/chọn/sửa đối tác. Server cấp org/IDs/revision/actor; giữ identity unresolved cho dữ liệu chưa xác minh. Phân biệt counterparty record với xác nhận danh tính. Không tự coi tên hoặc MST người nhập là verified identity.

Chốt request/source/invalidation contract hẹp theo nguyên tắc đã có, giữ text identifiers và country; same-tenant constraints. Thay thuộc tính identity/source phải làm kết quả phụ thuộc stale và giữ audit. Sources theo phạm vi đã cấp, không cross-case refs. Nếu cần thay semantics identity approval ngoài các nguyên tắc này thì nêu đúng quyết định còn thiếu; không dùng hai counterparties bootstrap như bằng chứng create/edit hoàn tất.

### F02 — Case và Exposure editors đầy đủ

Tạo/sửa hai core cases qua UI thật, role pairs đúng, policy server chọn/pin. Implement editors cho conditions/claims/declarations, không chỉ amount/term/reference. Request projection riêng, không gửi server metadata hoặc persisted aggregate nguyên khối.

Proposed/active của case khác proposed/actual của claim; actual chỉ là lời khai, chưa verified. Paid/received đúng payer/payee; VND decimal/integer strings theo contract; unknown=null+reason. Term null có reason. Giữ source type/ID/revision; documents cần exact version/hash/evidence. Lời khai nhập tay/questionnaire vẫn lưu được unverified khi chưa có chứng từ. Không cộng trùng paid+received, không invoice→settlement hoặc tự tính verified outstanding từ claim chưa đủ căn cứ. Third-party payments giữ raw/limitation ngoài core, không ép role.

### F03 — Questionnaire nội bộ và chuyên viên nhập thay

Chuyên viên tạo questionnaire/câu hỏi bổ sung, lưu draft/version, xem trạng thái thiếu/trả lời/bỏ qua/xác minh. MVP có thể dùng câu hỏi text optional + skip reason do server khóa theo phiên bản; chưa cần một bộ catalog tài chính chuẩn mới hoặc form-builder phức tạp. Không tự đổi câu hỏi bổ sung thành scoring factor hoặc thay checklist/financial minimum.

Staff-transcribed và respondent trực tiếp là hai origins khác nhau, giữ reported_by/entered_by/actor/time. Verification độc lập origin; sửa câu trả lời invalidate verification cũ. Định nghĩa rõ ai được sửa trạng thái nào, không cho client/AI gửi verified rồi tin ngay.

### F04 — Form respondent riêng, link có scope và lifecycle

Implement luồng tạo invitation → chuyên viên tự chia sẻ link → respondent mở form riêng không cần tài khoản specialist → trả lời/skip đúng policy → submit thật → receipt. Chuyên viên đọc câu trả lời trong đúng case, xác minh hoặc yêu cầu bổ sung và xem history. Không tự gửi email.

Token entropy cao do CSPRNG, server lưu hash; raw secret chỉ trả khi tạo theo contract. Scope tới đúng organization/case/questionnaire version/question IDs; expiry/revocation/closed questionnaire được enforce ở server. Chọn TTL/rate limits development hữu hạn, configurable và ghi rõ, không tự gọi là final production policy. Rotation/reissue phải vô hiệu hóa hoặc quản lý token cũ theo rule đã công bố, không có link vĩnh viễn không thu hồi được.

Respondent không đọc/sửa score, internal notes, PDF nội bộ, arbitrary case/questions hoặc nâng quyền. Chặn mass assignment, cross-case IDs, replay/duplicate submit và sửa questionnaire ngoài token scope. Nếu questionnaire version đổi, dùng contract version binding rõ ràng, không âm thầm đổi câu hỏi của invitation đã phát.

Thiết kế transport tránh token lộ qua logs/referrer/history/third-party assets/analytics; không persist token vào localStorage. Không nhận org/case từ payload để cấp quyền. Có kiểm Origin/transport phù hợp capability và finite resource limits; không bắt respondent cookie specialist. Token đúng chỉ chứng minh capability, **không tự chứng minh người trả lời là đại diện pháp nhân đã xác minh**. Giữ respondent identity/source là self-reported tới khi specialist kiểm chứng; không bịa identity assurance hoặc mặc định thêm OTP/account role mới.

Acceptance gồm valid/invalid/expired/revoked/wrong-scope token, submit trùng, required/skip rule, source origin, response revision và cùng lúc revoke/submit. Dữ liệu form xử lý trong backend/database app; không chuyển nội dung sang dịch vụ khảo sát khác.

### F05 — Upload, immutable source, extraction và correction

Giữ và hoàn thiện new/replace/response upload, quota, inventory/job states, classification/source review, exact source viewer/evidence và correction. Canonical accepted PDF bytes ở PostgreSQL theo thiết kế đã có; private filesystem là materialized cache, không suy FS power-loss durability từ hash helper.

Source reads đúng tenant/case/document/version/hash/page, không fallback latest. Raw extraction immutable, correction append-only/overlay có actor/reason/source. Giá trị đã đúng chỉ cần verification hợp lệ, không bắt tạo correction giả. Duplicate field keys, wrong subject, dangling evidence/page mismatch không publish như successful current extraction. Thay nguồn giữ history và stale dependencies.

### F06 — ReviewRun và Transaction Review

Review independent numeric Assessment. Cả hai exposure có findings, severity/priority, limitations và evidence; không trả CLEAR từ dữ liệu unverified hoặc bỏ identity conflict. UNKNOWN không low-risk, CLEAR_FOR_REVIEW không approval. Không xem missing source là đã không trả, chưa tới hạn là overdue hoặc chậm delivery là default.

Giữ sáu nhóm BA là narrative có nguồn, không cộng điểm vào FHI. AI proposal-only; backend kiểm source/schema/semantics trước persist; chuyên viên xác nhận các hành động người. Có chỗ persist/read Transaction Review kể cả FHI unconfigured hoặc thiếu BCTC.

### F07 — Findings resolve/dismiss/reopen, verification và waiver

Implement thao tác đầy đủ trong UI/API/DB, với reason/evidence/revision/ACL và transition guards. Resolve chỉ khi đáp ứng current-source/current-run requirements; partial/stale/unknown hoặc waiver không đủ. Dismissal có lý do/chứng cứ; reopen giữ lịch sử. Supplement acknowledgement không tự resolve mọi finding, không verify settlement/identity/financial fact thay người.

Waiver/revoke theo từng policy row, giữ finding/limitation; identity conflict không thành đúng, financial minimum không waived thành đủ numeric. Bản thân một human decision tăng revision không tự phủ nhận ngay decision đó; data changes sau đó yêu cầu recheck theo dependencies.

### F08 — Requests, response, recheck và lịch sử

Draft/edit/approve/cancel/export đúng case/request revisions và guard; approved payload/export bytes/hash bất biến. Upload response bind exact approved request revision/hash/type/case. Wrong supplement giữ blocker; corrected replacement được review rồi recheck, chỉ giải quyết đúng finding có căn cứ. Không sửa lịch sử/nguồn/export cũ để hiển thị như đã luôn đúng.

### F09 — Manual retry và async lifecycle

UI/API retry cho failed retryable jobs, current authorization/input/revision và attempts/deadline budget. Public retry command có idempotency riêng, không reset attempts vô hạn hoặc reuse expired key để chạy ý định cũ. Frozen replay phải independent provider availability như nguyên tắc đã có.

Worker fencing/lease/attempts/snapshot/CAS; network ngoài DB TX dài. Chặn crash/late worker/expired fence/stale source/invalid output thành current publication. API/body/source limits, bounded transport/read cancellation; không silent mock fallback khi live fail.

### F10 — Financial facts và xác minh

Implement FinancialStatementSet/Fact registry và UI/server support cần cho7metric: entity/country/industry, period/FY-TTM-interim/basis/accounting regime/currency/unit; raw/normalized decimals; document version/hash/page/quote hoặc verified entry; provenance/adjustments/verification revision/actor/time.

Không thay total liabilities cho interest-bearing debt, finance expense cho interest, CFO cho EBITDA, hoặc net income cho EBIT. Quick assets cần thành phần; EBITDA cần cầu nối EBIT+D&A có nguồn. Thiếu bridge/fact hoặc không cùng kỳ/basis/unit thì null+reason, không tự annualize/FX hoặc bịa số. Áp rules đã chốt trong canonical method; điểm còn chưa rõ về tài chính ghi explicit unavailable, không invent finance policy để phát số.

### F11 — Pure FHI scorer và tích hợp có guard

Implement/test AIC-FHI-1.0/version1.0.0 theo canonical config/method và reference fixtures. Server-side Decimal, trace raw ratio→anchors→metric points→sum, không intermediate rounding. Metric IDs/max points: M01current15; M02quick10; M03equity/assets20; M04debt/EBITDA10; M05EBIT/interest15; M06EBIT/revenue10; M07CFO/revenue20. Bốn nhóm25/20/25/30.

Các anchors dưới đây chỉ nhắc lại đặc tả AIC hiện hành, không phải phương pháp Moody’s hoặc policy mới:

| Metric | Anchors giá trị:tỷ lệ điểm |
|---|---|
| M01 | 0:0; 0.75:0.2; 1.25:0.65; 2:1 |
| M02 | 0:0; 0.5:0.2; 1:0.75; 1.5:1 |
| M03 | -0.3:0; 0:0.1; 0.2:0.45; 0.4:0.8; 0.65:1 |
| M04 | 0:1; 1:0.9; 2.5:0.6; 4:0.3; 7:0 |
| M05 | 0:0; 1:0.15; 2:0.45; 4:0.8; 7:1 |
| M06 | -0.15:0; 0:0.2; 0.08:0.55; 0.2:1 |
| M07 | -0.15:0; 0:0.2; 0.08:0.65; 0.2:1 |

Nội suy tuyến tính từng đoạn, clamp endpoints. BandsF1≥85/F2≥70/F3≥55/F4≥40/F5<40; chỉ số nội bộ experimental, không credit rating/PD. Ví dụ canonical73.736111… hiển thị73.7/AIC-F2. Đối chiếu đầy đủ nguồn trước implement; nếu khác canonical config phải nêu mismatch, không âm thầm sửa method.

Đủ7metric verified và đúng scope DISTRIBUTION_WHOLESALE_PILOT mới có thể phát tổng khi method approval cho phép; thiếu bất kỳ metric không reweight. EBITDA≤0 blocker. Interest0 chỉ ngoại lệ M05 khi debt0 được verified, kèm flag; M04 vẫn cần EBITDA hợp lệ. Giá trị âm đúng nguồn không zero-fill.

Tích hợp API/readiness/components/strengths/weaknesses/limitations/source và UI; method unconfigured thì score/band null, grade/pd luôn null. Implement scorer và fixture tests **không bật pilot**. Không dùng fake approved method cho app để có số demo. Tách engine-ready, app-integrated và authorized-to-publish; policy activation là quyết định riêng. Nếu reference package30ca chưa có, tìm đúng artifact; không sinh30ca mới rồi gọi là đã chạy canonical30fixtures.

### F12 — FE thống nhất và khả năng phục hồi

Tất cả flow qua màn hình hiện có, không chỉ endpoint/direct HTTP. Không placeholder, mock saved hoặc silent disabled cho chức năng được giao; nếu thật sự blocked phải hiện lý do và ghi ma trận. Dữ liệu persist/reload/restart. 401/409 giữ draft đúng user/org và không tự replay mutation. Source unavailable không đổi source latest. Loading/error/partial/unknown/stale/revoked/expired rõ, không fake progress/confidence/PD. Ba locale en/zh-CN/vi, responsive, keyboard/focus và escaping text; locale không thay raw source/answer/export hoặc tạo mutation.

## 4. Thứ tự làm việc và chống giẫm file

Ưu tiên khóa interface của slice rồi implement vertical flow; schema→persistence→service/controller→FE→test. Giữ một shared-contract owner và một migration writer. Có thể dùng agent triển khai module độc lập sau khi interfaces khóa, với file ownership rõ. Những agent cùng tham gia implement không thay thế vòng review độc lập sau bàn giao.

Prompt cũ vừa hoàn tất; tiếp quản các phần đã làm và delta của yêu cầu này, không restart kế hoạch hoặc tạo implementation cạnh tranh. Quyết định native forms mới nhất thay hướng Google Forms và thay giới hạn “link public giữ đóng vì chưa có catalog”; vẫn phải implement capability/identity limitations đúng ở F04.

## 5. Kiểm thử bắt buộc của agent triển khai

Agent vẫn phải viết/chạy tests có giá trị và sửa lỗi trước bàn giao. Không đẩy code chưa compile hoặc lỗi đã biết cho reviewer với lý do “không tự đánh giá”. Self-test là baseline; reviewer độc lập nghiệm thu và thiết kế tests bổ sung sau.

- Build/typecheck/lint/contracts và regression phù hợp thay đổi; required/null/unknown fields, input-vs-persisted projection và consumer mapping.
- Real PostgreSQL/private storage cho rollback, constraints, auth/ACL, replay/conflict, source ownership, crash/concurrency/fencing/stale/immutable bytes.
- Browser walkthrough cả RECEIVABLE/PREPAYMENT: tạo đối tác/case → exposure/source upload/extract → review/correction/verification → request/export → wrong supplement → correct replacement/recheck → finding actions/history. Có waiver/revoke giữ limitations.
- Native form: specialist tạo/gửi link thủ công → browser context respondent riêng → submit/skip → specialist xem/xác minh → sửa/revoke/expire và quyền cross-case. Không dùng specialist session để giả lập respondent access thành công.
- AI **live model extraction** trên synthetic PDF/text/scan có oracle. Native live inspect khác model extraction; mock publication khác live accuracy. Kiểm quote/page/field/identity/period/unit, provider failure và unsupported input. Không dùng fixture server khi quay như live AI.
- FHI pure/reference tests, missingness/zero/negative/period/unit/scope/staleness guards, và application score-null khi chưa approved.
- Browser source viewer,3locale, reload/restart, 401/409, foreign references, duplicate submit và failed-job retry.

Runner FAIL phải nonzero; không sửa expected đúng để khớp code sai, skip test chỉ để xanh hoặc hạ assertion. Ghi actual commands/date/build/environment/mode và limitations. Không cộng overlap/historical tests; synthetic helper tests không chứng minh API/browser/live AI.

Nếu tool-policy chặn startup: báo ngay action/reason thực nhận, hướng dẫn owner chạy ordinary commands ở terminal được phép. Không alternate launcher/tool/port hoặc hướng dẫn né rejection. Không đánh browser/live tests PASS khi chưa chạy. Trong lúc chờ stack/config, tiếp tục code/test độc lập. Không yêu cầu owner dán credentials/key vào chat.

## 6. Bàn giao bản cố định cho các agent khác review/fix

Khi code phạm vi xong hoặc có blocker không thể tự giải quyết, tạo **một gói bàn giao review**, không tự gắn nhãn “independently verified”. Tái sử dụng docs hiện có, chỉ thêm những artifact cần thiết:

1. **MVP-FEATURE-MATRIX.md:** đủF01–F12, thao tác/route/UI, implementation paths, trạng thái implemented/integrated/tested/not-run/blocked, test/evidence và quyết định còn thiếu. Không để requirement rơi khỏi bảng.
2. **MVP-REVIEW-HANDOFF.md:** startup/migration/bootstrap an toàn; approved contracts/decisions/method state; hai walkthrough/native-form flow; fixture/oracle locations; test commands và các known limitations/bugs. Ghi rõ phạm vi chưa implement, khác bug, khác production-only work.
3. **Bản source cố định để review:** HEAD + working/index state + source file hashes đầy đủ gồm tracked/staged/untracked cần thiết. Khi chưa được commit, tạo source-only snapshot/patch package có bytes cần thiết cho reviewer nếu môi trường cho phép, loại secrets/runtime/private data/generated artifacts. HEAD hoặc inventory chỉ hashes không phải bản sao source; git diff một mình không chứa untracked files. Không để reviewer mở worktree từ HEAD rồi bỏ sót code mới. Nếu chưa freeze được thì ghi rõ và không review snapshot đang thay đổi như một bản cố định.
4. **Test evidence:** raw sanitized logs và expected/actual, mode, counts không cộng gộp, screenshots/video không chứa secrets; đánh dấu acceptance chưa chạy.
5. **NOTION-CURRENT-STATE-HANDOFF.md:** nội dung code/status/approved scope mới để đồng bộ tài liệu, giữ yêu cầu đích và không tự nâng checkbox/pilot.

Protocol cho giai đoạn sau, chưa tự chạy review thay owner:

- Reviewer khác agent triển khai đọc requirements/contracts/code snapshot và tự chạy/reproduce, không lấy báo cáo PASS của tác giả làm kết luận. Có thể dùng các agent khác nhau cho workflow/UI, backend/security/data integrity, AI/FHI.
- Mỗi finding có ID, severity, trigger, expected source, actual, reproduction/test, file/function và fix suggestion; phân biệt confirmed bug/missing feature/unverified concern/test gap.
- Fix agents được giao file ownership hoặc bản sao riêng; không nhiều writer sửa chung schema/SQL. Shared-contract/migration changes có một integrator.
- Mỗi bản sửa có regression test. Sau sửa, agent khác xác nhận reproduction không còn và kiểm regression; agent viết fix không tự là người duyệt cuối cho fix đó.
- Nếu owner chỉ định dừng triển khai để review, bàn giao rồi dừng writer; không tiếp tục sửa snapshot ngầm làm evidence mất hiệu lực.

## 7. Giới hạn và báo cáo cuối

Không commit/push/reset/deploy public hoặc migrate DB người dùng khi chưa được cho phép riêng. Giữ WIP/checkpoint/secrets exclusions; migrations chỉ môi trường disposable/sandbox được cấp, không sửa applied checksum file. Không sửa AI service/canonical1.0.2 ngoài quyền đã giao. Không tự gửi link/email/nộp bài hoặc bật FHI pilot.

Public ingress/TLS/trusted-IP, production retention, backup/restore hardening và data/provider production approval vẫn riêng; không dùng chúng làm lý do bỏ chức năng MVP, cũng không coi local tests là production certification.

Cuối phiên báo gọn:

1. F01–F12 phần nào code/tích hợp xong, phần nào còn thiếu và lý do.
2. Hai core workflows/native form/live extraction đã chạy thực tế tới đâu.
3. Tests đã chạy và failure/skip/not-run còn lại.
4. Snapshot và review handoff nằm đâu, có bao gồm code chưa commit không.
5. Những gì owner cần cung cấp/quyết định thật sự còn thiếu; tiếp tục phần độc lập trước khi kết thúc.

**Tên trạng thái bàn giao phải trung thực:** CODE_COMPLETE_AWAITING_INDEPENDENT_REVIEW khi đủ implementation scope; nếu còn feature bắt buộc chưa implement thì IMPLEMENTATION_PARTIAL; nếu code đủ nhưng browser/provider chưa chạy thì ghi rõ ACCEPTANCE_BLOCKED/NOT_RUN. Không đổi tên một phiên kết thúc thành MVP complete, không hứa không còn bugs và không tự chứng nhận chất lượng độc lập.
