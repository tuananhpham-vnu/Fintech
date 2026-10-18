# Fintechathon / AIC Rating — Đánh giá hiện trạng và lộ trình production

> Đây là snapshot phân tích **trước khi triển khai**. Sau báo cáo, owner đã duyệt hoàn thiện code và kích hoạt pilot đúng phạm vi. Trạng thái triển khai mới được ghi tại [runtime/pilot](AIC-PILOT-RUNTIME.md) và báo cáo nghiệm thu UI đi kèm; các nhận định “chưa có Assessment/chưa được duyệt pilot” bên dưới phản ánh baseline lịch sử.

**Ngày chốt báo cáo:** 18/10/2026, Asia/Saigon.

**Phạm vi:** toàn hệ thống đang có trong workspace, ưu tiên nghiệm thu UI desktop ngang theo yêu cầu chủ dự án.

**Baseline:** branch **duc**, HEAD **9bf0635e8d8e695e79491c1ce527a9562826faef**, cộng 14 file đang sửa local từ các lượt trước.
**Loại tài liệu:** báo cáo phân tích và phương án triển khai để chủ dự án xem xét; không phải phê duyệt nghiệp vụ, biên bản nghiệm thu hay lệnh triển khai.

> **Kết luận phát hành: CHƯA ĐỦ ĐIỀU KIỆN đưa toàn bộ chức năng đánh giá AIC lên production.** Hệ thống đã có nhiều chức năng thật và bằng chứng xử lý PDF qua AI live, PostgreSQL và UI. Phần còn lại tập trung ở luồng Assessment, chất lượng dữ liệu tài chính, phê duyệt/kiểm định phương pháp và vận hành production. Không cần xây lại toàn bộ dự án.
>
> Theo yêu cầu “Không triển khai nếu tôi chưa duyệt”, lượt lập báo cáo chỉ đọc source/tài liệu và tạo báo cáo. Không sửa source ứng dụng, cấu hình, secrets hay cơ sở dữ liệu; không chạy migration, gửi thêm tài liệu sang AI, triển khai cloud hoặc bật điểm FHI.

**Cách đọc nhanh:** §1 để xem kết luận; §6 để xem các khoảng trống; §15 để giao việc; §16–17 để nghiệm thu và quyết định phát hành. Các phần còn lại giải thích kiến trúc, dữ liệu và điều kiện của kế hoạch.

## 1. Kết luận dành cho chủ dự án

### 1.1. Dự án đang ở đâu?

Dự án đã vượt mức giao diện mẫu: có frontend nối API, backend nền tảng dùng PostgreSQL, đăng nhập/session, phân quyền theo tổ chức/hồ sơ, lưu tài liệu nguồn, worker xử lý PDF/ZIP, review, yêu cầu bổ sung, questionnaire, nguồn tài chính có phiên bản và bộ tính FHI tham chiếu. Một số luồng này đã chạy qua trình duyệt thật với PDF thật.

Tuy nhiên, **“upload được”, “AI trả kết quả”, “build thành công” và “đủ điều kiện phát hành đánh giá tài chính” là các mức khác nhau**. BCTC đã thử có job live hoàn tất nhưng chỉ 3/9 trường được summary phân loại usable; các trường tài chính quan trọng vẫn bị giữ lại vì chưa đủ chứng cứ. Nút đánh giá đang khóa theo readiness của backend; việc đổi nút thành enabled không hoàn thiện Assessment.

Hai chặng phát hành cần được quản lý riêng:

| Chặng | Sản phẩm thực sự cung cấp | Điều kiện |
| --- | --- | --- |
| **Production xử lý hồ sơ có người thẩm định** | Dữ liệu thật; tài khoản thật; upload/lưu nguồn; trích xuất AI live; chuyên viên kiểm chứng; review/findings; yêu cầu bổ sung; lịch sử | Hoàn tất các gate kỹ thuật, dữ liệu, bảo mật, vận hành và UAT. Các đầu ra chưa đủ điều kiện phải trả unknown/blocked. Không cần giả lập điểm để phát hành chặng này. |
| **Production có điểm FHI trong phạm vi được duyệt** | Toàn bộ chặng trên cộng Assessment có nguồn, method/version, điểm thành phần, band và xác nhận của người | Thêm phê duyệt phương pháp, đối chiếu reference/goldens, kiểm định độc lập và phê duyệt phạm vi sử dụng thực tế. Trang 13 hiện chưa cấp quyền này. |

Đây là đề xuất chia giai đoạn, **chưa phải quyết định thu hẹp yêu cầu**. Nếu chủ dự án yêu cầu ngay bản production có điểm FHI, chặng thứ hai thuộc đường bắt buộc trước ngày phát hành. Không gọi một bản chỉ xử lý hồ sơ là “đã xong toàn bộ AIC”.

### 1.2. Hướng tốt nhất

1. Giữ stack và các cơ chế nguồn/phiên bản/phân quyền đã có.
2. Khóa lại baseline có thể build và tái hiện; bảo toàn code local và các tài liệu bàn giao.
3. Chốt contract và phạm vi sản phẩm; hoàn thiện readiness, Assessment, nguồn tài chính và Transaction Review.
4. Sửa chất lượng đọc BCTC bằng oracle có người đối chiếu; duy trì kiểm chứng thủ công có nguồn khi AI chưa đọc đủ.
5. Thiết kế môi trường staging/production riêng, AI private, PostgreSQL có backup/restore, worker được quản lý và giám sát.
6. Nghiệm thu trực tiếp toàn bộ luồng desktop, sau đó mới phát hành trong phạm vi đã duyệt.

Không đề xuất đổi framework, ghép lại một frontend thứ hai, thay PostgreSQL, đưa thêm Kubernetes hoặc viết lại queue khi chưa có nhu cầu đo được.

## 2. Cách đọc bằng chứng và giới hạn báo cáo

### 2.1. Nhãn bằng chứng

| Nhãn | Ý nghĩa |
| --- | --- |
| **SOURCE** | Xác nhận bằng source/cấu hình hiện tại trong lượt đọc này. Chưa mặc nhiên chứng minh hành vi runtime. |
| **UI-18** | Thao tác thật ngày 18/10 được ghi ở báo cáo UI và evidence riêng tư. Phạm vi là trình duyệt trong ứng dụng, không phải Chrome extension. |
| **HIST** | Kết quả thực thi đã được ghi trong báo cáo/lưu chứng cứ trước đó. Không chạy lại trong lượt lập báo cáo. |
| **CHƯA NGHIỆM THU** | Có thể có code nhưng chưa đủ bằng chứng cho hành vi hoặc môi trường cần xét. |
| **ĐỀ XUẤT** | Công việc/thiết kế/tiêu chí khuyến nghị, chưa được triển khai hoặc phê duyệt. |

Lượt này đọc cấu trúc workspace, manifests, các module liên quan và tài liệu triển khai có mục tiêu; không khẳng định đã đọc từng dòng mọi dependency, mọi test hay toàn bộ kho Notion. Không thực hiện pentest hoặc kiểm tra tài khoản cloud. Trạng thái dịch vụ, PID, billing, quyền DB đang dùng và cấu hình trên cloud không được suy ra từ các báo cáo cũ.

Không có lượt UI mới hoặc chạy lại full regression trong quá trình viết báo cáo. Lần kiểm tra công cụ trình duyệt gần nhất trong chuỗi công việc trả “Local browser use is disabled in Work settings”. Vì vậy báo cáo giữ nguyên các mục chưa kiểm chứng, không thay bằng kiểm tra HTTP rồi gọi đó là nghiệm thu UI.

### 2.2. Thứ tự nguồn nghiệp vụ

1. Chỉ dẫn trực tiếp mới nhất của chủ dự án.
2. Nội dung **Trang 13 — AIC-FHI-1.0/version 1.0.0** do người dùng dán; cập nhật 16/10/2026.
3. Các quyết định đã ghi rõ phạm vi trong tài liệu owner, yêu cầu MVP v2, contract và báo cáo triển khai có nguồn.
4. Source hiện tại để xác định phần thực sự tồn tại.
5. Báo cáo cũ để theo dõi lịch sử; không dùng nhận định prototype cũ phủ nhận những cơ chế đã được bổ sung.

Không đồng nhất tài liệu yêu cầu với bằng chứng phần mềm đã làm xong. Trang 09–10 và JSON tại §8 Trang 13 cần được đối chiếu trước khi phát hành contract mới. Lượt này không đọc được lại toàn bộ Notion trực tiếp; snapshot local và phần người dùng cung cấp là cơ sở đã có.

## 3. Kiến trúc hiện tại và phần cần giữ

### 3.1. Cấu trúc và công nghệ

| Khối | Hiện trạng SOURCE | Quyết định đề xuất |
| --- | --- | --- |
| Workspace | pnpm 11.22.0; Node yêu cầu >=22; hai package web và API | Giữ monorepo; chốt một bản Node được kiểm thử trên CI/production. |
| Frontend | Next.js 16.4.0 App Router; React 19; TypeScript; Tailwind; lucide-react; PDF.js | Giữ ứng dụng chính; refactor có phạm vi, không dựng lại UI từ đầu. |
| Backend | NestJS 11 / Express; pg; AJV; TypeScript | Giữ nền tảng auth, ACL, transactions và validation; hoàn thiện các module nghiệp vụ. |
| Hợp đồng | Public /api/v2; legacy AI 1.0.2; các schema foundation, demo và dossier | Giữ tương thích; version hóa hoặc adapter rõ ràng cho phần AIC 2.0. |
| Dữ liệu | PostgreSQL; 18 migration trong source; canonical source bytes cùng metadata/lineage trong DB | Giữ nguồn chuẩn và lịch sử; không chuyển storage trước khi có kế hoạch bảo toàn. |
| Worker | Worker extraction PDF và worker intake dossier riêng; DB job/lease/fencing | Giữ; bổ sung lifecycle và khả năng chạy production có nghiệm thu. |
| AI/OCR | Python >=3.11; FastAPI, Pydantic, jsonschema, httpx, PyMuPDF; Gemini live hoặc mock rõ mode | Giữ phần inspect/extract/grounding; hoàn thiện chất lượng và tích hợp đánh giá. |
| Công cụ phát triển | Launcher local; script build/test; runtime local và QA server riêng | Giữ phục vụ phát triển; không dùng launcher local thay process manager production. |
| Tài liệu | Contract, audit, implementation, acceptance, handoff và evidence local | Dọn trạng thái hiện hành/lịch sử; giữ tài liệu kỹ thuật cần commit ở nơi không bị ignore. |

Thư mục C:/Users/52duc/Desktop/Fintech/apps/FE Fintech **không có trong danh sách thư mục hiện tại**. Quy tắc ignore cho bản import còn tồn tại. Do đó báo cáo không xác nhận lại nội dung bản import hoặc kết luận rằng có thể xóa một bản khác trên máy. Frontend đang đánh giá và đề xuất phát hành là C:/Users/52duc/Desktop/Fintech/apps/web. Không xóa hoặc khôi phục bản import trong lượt này.

### 3.2. Luồng thực tế

    Trình duyệt
      → Next.js UI + proxy cùng origin /api/v2
      → NestJS: session / CSRF / ACL / revision / idempotency
      → PostgreSQL: hồ sơ, nguồn chuẩn, review, facts, jobs, audit

    PDF upload → ghi nguồn + job → extraction worker
      → materialize private cache → AI inspect/extract → kiểm tra kết quả
      → publish bằng transaction + fence → UI polling / source viewer

    ZIP dossier → ghi archive + job intake → dossier worker
      → reader ZIP riêng → đăng ký nguồn từng member
      → inspect / extraction jobs → cùng luồng PDF

    Financial set + nguồn được kiểm chứng → bộ tính Decimal tham chiếu
      → hiện tại chỉ xuất ratios / blockers / source trace
      → points / score / band / grade / PD của ứng dụng vẫn null

### 3.3. Những nền tảng đã có, không cần xây lại

- Session lưu trong PostgreSQL, token ngẫu nhiên và lưu hash; kiểm hết hạn, idle, revoke, user disabled.
- Mật khẩu được hash bằng scrypt có salt; kiểm so sánh timing-safe; có chi phí KDF cho bản ghi đăng nhập không hợp lệ.
- Cookie HttpOnly, SameSite; Secure theo production config; Origin và CSRF cho mutation.
- Phân quyền theo tổ chức/hồ sơ và cơ chế khóa/transaction cho cập nhật.
- Idempotency, expected revision, audit và phiên bản nguồn/human decisions.
- Nguồn PDF canonical, private cache, kiểm byte/hash và source-bound evidence.
- Worker có lease, heartbeat, bounded attempts và fencing trước khi công bố.
- Registry tài chính có raw/normalized values, nguồn, revision và xác minh riêng; Decimal chính xác cho bộ tính FHI.

Sự hiện diện các cơ chế này không thay cho kiểm thử xâm nhập, quyền runtime production hoặc UAT. Nhưng chúng là tài sản cần giữ khi hoàn thiện.

## 4. Mức hoàn thiện theo chức năng

| Chức năng | Source hiện tại | Bằng chứng/giới hạn | Việc còn lại |
| --- | --- | --- | --- |
| Login/session | Có backend thật | UI-18 đăng nhập sai/đúng; chưa đủ logout/expiry/relogin UI | Nghiệm thu toàn vòng session và cấu hình ingress. |
| Đối tác | CRUD, provenance và revision; tạo/sửa giữ identity unresolved | HIST kiểm tra PG/HTTP; chưa có nghiệm thu UI đầy đủ | Chốt và triển khai nếu cần luồng xác nhận pháp nhân có người chịu trách nhiệm. Không cho OCR tự xác nhận. |
| Hồ sơ/Exposure | Có hai core flow và phân biệt lời khai/verified | UI-18 tạo hồ sơ kỹ thuật, reload giữ dữ liệu | UAT hai luồng với nguồn hợp lệ, edit/concurrency và negative cases. |
| PDF | Upload, lưu canonical, extract, source viewer | UI-18 hai PDF live; evidence mở được | Tập dữ liệu đại diện, phiên bản nguồn, ACL, session và đầu vào xấu. |
| ZIP dossier | Intake/manifest/member/extraction đã có | UI-18 ZIP hai PDF hoàn tất sau khi worker được khởi động; HIST 30/60 trên restored DB offline | UI batch lớn, restart, partial failure, polling, lỗi nhập liệu. |
| Review/Transaction Review | Có ReviewRun/findings/history độc lập điểm | UI-18 chạy và lưu review, stale sau đổi dữ liệu | Đối chiếu đủ quy tắc RECEIVABLE/PREPAYMENT và sáu nhóm BA; settlement thực tế chưa hoàn thiện. |
| Issues/waiver | Resolve/dismiss/reopen, waiver/revoke trong backend/UI | HIST; UI chưa thao tác đủ | Fixture có căn cứ và người duyệt; không waiver financial core hoặc xác minh hộ. |
| Request bổ sung | Draft/edit/approve/cancel/export, response/recheck đã có code | UI-18 tạo/sửa nháp và stale conflict; chưa phát hành/trả lời hoàn chỉnh | Chuỗi request → tài liệu thay thế → recheck → history → acknowledge. |
| Questionnaire | Versioned form, staff response, verify; native invitation/respondent có code | HIST HTTP; UI-18 mới tạo nháp | Hai browser context, expiry/revoke/reissue, submit/skip/replay; chốt public ingress. |
| Financial registry | Statement set/facts/version/source/verification/selection | SOURCE và HIST; UI chưa positive save/verify | Nhập thật có nguồn, định danh/kỳ/basis/đơn vị/bridge; positive/negative UAT. |
| FHI engine | Có bảy metric, anchors, trace, band, Decimal | Reference tests nội bộ; chưa canonical 30 hoặc kiểm định thực tế | Parity độc lập, policy version/approval, orchestration và acceptance. |
| Assessment phát hành | FE có action/API consumer, proxy có allowlist | Backend hiện tại chưa có luồng Assessment tương ứng hoàn chỉnh; readiness khóa | Bổ sung persistence, execution, stale, acknowledge và result contract. |
| Đa ngôn ngữ | vi/en/zh-CN trong kiến trúc hiện tại | UI kiểm một phần label; chưa toàn bộ form | Dọn nhãn, a11y, ngày/số/tiền và toàn bộ trạng thái. |
| Responsive | Desktop sáu tab đã mở ở 1440×900 | Không có overflow trong panel được đo; chưa toàn bộ thao tác | Desktop trước. Mobile/tablet hoãn theo yêu cầu; phạm vi hỗ trợ phải ghi rõ. |
| Production operation | Có nền tảng local, backup local và một blueprint AI | Chưa có release toàn stack, SLO/on-call/DR production | Hoàn thiện hạ tầng, secrets, monitoring, CI/CD và runbook. |

Không có cơ sở để gán “đã hoàn thành 90%” hay cộng số test thành tỷ lệ hoàn thiện. Một blocker phát hành vẫn có thể nằm trong phần code rất nhỏ.

## 5. Bằng chứng đã có và điều chưa được chứng minh

### 5.1. UI thật ngày 18/10

| Quan sát | Kết luận được phép |
| --- | --- |
| Sáu tab desktop 1440×900, zoom 100%, ảnh và layout metrics | Đã kiểm bố cục cơ bản sáu tab tại kích thước này. |
| Upload PDF T2, live job hoàn tất, summary 1/1 usable; mở source | Đường upload → AI live → trả kết quả → source viewer đã chạy với ca đó. |
| Upload BCTC, pending → terminal, summary 3/9 usable | Pipeline chạy nhưng **chưa đủ dữ kiện tài chính để chấm FHI**. Không suy ra accuracy 33% trên quần thể. |
| ZIP hai PDF; ban đầu chờ vì thiếu worker; sau bổ sung launcher xử lý hoàn tất | Đã xử lý được ZIP nhỏ thực tế. Trạng thái cuối có quan sát DOM; chưa có ảnh cuối do công cụ mất quyền. |
| Review thật, nháp câu hỏi, nháp request; conflict stale được hướng dẫn | Một phần workflow có persistence và revision hoạt động qua UI. |
| PDF đổi trang/zoom; current page khác quote page | Bản sửa nhãn/trang đã có quan sát thực tế trong phạm vi ghi nhận. |
| Chặn PDF >10 MiB, ZIP >32 MiB, RAR/XLSX tại chọn file | Preflight UI từ chối đúng các ca đã thử; không chứng minh backend chịu tải hoặc mọi bypass bị chặn. |
| Chuyển web sang next start và reload được case/session/ZIP | Production build của **web** chạy local được. Không chứng minh backend document runtime production đã được mở. |

BCTC bị giữ lại ở identity/period/amount với các mã UNVERIFIED_FIELD_ROLE, UNVERIFIED_FIELD_LABEL, INCOMPLETE_AMOUNT; có dấu hiệu OCR_USED/GARBLED_TEXT_LAYER. Hướng xử lý là cải thiện đối chiếu nguồn, cột năm, mã chỉ tiêu và bridge. Không bỏ grounding để ép số hiển thị.

### 5.2. Kiểm tra kỹ thuật đã thực thi trước báo cáo

| Nguồn | Kết quả lịch sử | Giới hạn |
| --- | --- | --- |
| Sau các sửa UI mới | typecheck, lint, Next build, launcher syntax và diff check exit 0 | Không chạy lại trong lượt báo cáo. Lint là architecture + Prettier, không phải ESLint. |
| Python compileall ba file đã sửa | Exit 0 | Chỉ xác nhận compile cú pháp, không phải oracle tài chính. |
| MVP execution 17/10 | Backend 196 PASS; FE 34 unit + 18 consumer; boundary 274 PASS/4 SKIP | Snapshot/mode ghi trong tài liệu; có overlap, không cộng thành số E2E. |
| AI regression 17/10 | 361 PASS / 1 FAIL / 4 SKIP | Failure provenance extraction-v1/v2 vẫn là kết quả gần nhất được ghi; phải chạy lại và phân xử, không tự sửa expected để xanh. |
| DB Gate B 17/10 | Backup mã hóa, restore thật sang cluster riêng, migration 0018, restricted roles; HTTP 10/10 trên bản restore | Mô hình extraction offline synthetic; không phải chất lượng Gemini hoặc production cloud. |
| Dossier batch trong Gate B | 30/60 PDF, 89 publications, member 12 trang giữ lại chờ review | Không phải UI batch live và không chứng minh xử lý đầy đủ PDF dài. |
| Ví dụ FHI Trang 13 | Tổng tham chiếu 5309/72 = 73,736111…; hiển thị 73,7 / AIC-F2 | Ví dụ synthetic và kiểm tra toán; không phải Assessment đã phát hành trên hồ sơ thật. |

Báo cáo UI có phần “lịch sử trước khi kiểm thử mở lại”. Các hàng BLOCKED trong phần lịch sử không phủ nhận kết quả mới ở đầu tài liệu; kết quả mới cũng không đóng mọi acceptance còn lại.

## 6. Các khoảng trống và rủi ro ưu tiên

P0 ở đây là **điều kiện chặn phạm vi phát hành liên quan**, không phải khẳng định đã có sự cố khai thác. P1 là việc cần làm cho release đó; P2 là phần sau phạm vi đầu tiên nếu chủ dự án chấp nhận.

| ID | Ưu tiên | Nhận định và bằng chứng | Cách xử lý/đóng |
| --- | --- | --- | --- |
| R01 | P0 | SOURCE: document runtime chỉ nhận local và bị từ chối khi NODE_ENV=production; các module nghiệp vụ đăng ký có điều kiện; hai worker cũng chặn production | Thiết kế promotion runtime có validation/test và cấu hình triển khai. Không chỉ xóa guard hoặc đổi env. |
| R02 | P0 cho điểm | SOURCE: readiness luôn numeric_assessment_allowed=false; method unconfigured; registry luôn trả score/band/grade/PD null | Policy có version và approval; readiness tính động từ nguồn hiện tại; giữ fail-closed. |
| R03 | P0 cho Assessment | SOURCE: FE/proxy có assessments routes nhưng backend chưa có thực thi/persistence Assessment tương ứng | Chốt contract, thêm orchestration, lưu kết quả bất biến, stale, acknowledge và HTTP acceptance. |
| R04 | P0 cho FHI thực tế | Trang 13 ghi rõ pilot chưa duyệt và chưa production validated | Duyệt phương pháp, độc lập kiểm định, scope và use policy; không đổi trạng thái để hợp thức hóa số. |
| R05 | P0 cho kết quả tài chính đáng tin | UI-18 BCTC chưa đọc đủ các số quan trọng | Oracle, parser/grounding/period/role; đường nhập và kiểm chứng có nguồn được UAT. |
| R06 | P0 trước dữ liệu nhạy cảm production | Chưa xác minh billing/retention/DPA/region thực tế của nhà cung cấp | Chủ dự án chọn cấu hình dữ liệu, xác nhận tài khoản và điều kiện; không suy từ việc có GEMINI_API_KEY. |
| R07 | P0 trước public | SOURCE: render.yaml hiện chỉ AI web public, test console bật, branch main; không phải blueprint toàn hệ thống | AI private, console tắt, ingress/secret/storage rõ; artifact release đúng version. Chưa biết cloud có dùng manifest này hay không. |
| R08 | P0 trước public | CHƯA NGHIỆM THU production: TLS/host/proxy/IP trust, isolation PDF, auth/ACL qua ingress, giới hạn nguồn lực | Threat review có phạm vi; negative tests qua staging thật, process/container limits và fail-closed. |
| R09 | P0 vận hành | Có restore local nhưng backup DPAPI phụ thuộc Windows account/profile; chưa có DR off-host được nghiệm thu | Backup độc lập host, quản lý khóa, restore rehearsal và RPO/RTO được duyệt. |
| R10 | P1 | SOURCE: usable count có thể đếm value không null nhưng quality không phải missing dù unreadable/thiếu evidence | Đồng bộ định nghĩa với summary server; phân biệt unavailable, zero usable và usable. |
| R11 | P1 | SOURCE: period helper có thể đánh isVerified=true chỉ vì có period và evidence_refs | Chỉ nhãn verified từ human verification hiện hành và đúng source revision; kiểm lại suggestion path. |
| R12 | P1 | SOURCE: dossier decoders chưa đối xứng schema ở unknown keys/date-time/safe integer | Decoder chặt theo contract đã khóa; từ chối payload sai và UI lỗi có thể phục hồi. |
| R13 | P1 | SOURCE/HIST: Transaction Review hiện còn giới hạn; verified settlement/outstanding null; no findings trả UNKNOWN | Bổ sung quy tắc thiếu và dữ liệu xác minh theo scope; không mặc định CLEAR hoặc trừ invoice như payment. |
| R14 | P1 | Nhiều luồng có code nhưng thiếu UI acceptance: financial save/verify, respondent, replace/response/retry, acknowledgement | Hoàn tất ma trận UI ở §16 bằng nguồn/fixture hợp lệ. |
| R15 | P1 | Chưa tìm thấy pipeline .github hay Dockerfile/compose trong inventory hiện tại; chưa có bằng chứng release toàn stack tái lập được | Thiết lập CI và deployment artifact; điều tra external CI nếu có, không kết luận GitHub không có check nào. |
| R16 | P1 | AI full regression gần nhất còn 1 FAIL/4 SKIP; canonical 30 chưa có byte artifact | Phân xử fail, cung cấp/phiên bản hóa oracle và chạy lại trên release candidate. |
| R17 | P1 | SOURCE: root config kiểm explicit test key khác với AI transport kiểm key sau fallback | Đóng thiếu/blank/default production key thống nhất; kiểm config fail-closed. Không suy ra đã khai thác được vì runtime nghiệp vụ hiện còn khóa. |
| R18 | P1 | SOURCE: API bind 127.0.0.1; shared source path/cache gắn topology local; chưa có probes/metrics production được chứng minh | Chọn bind/private network, volume và process ownership; readiness, queue lag, alerts và trace IDs. |
| R19 | P1 | UI-18 dev restart từng Loading/HMR/ChunkLoadError; production web reload được | Tách dev/release build; chẩn đoán từ log/runtime phù hợp; giữ assets theo release và UAT reload/deploy. |
| R20 | P1 | Docs có nội dung prototype/acceptance cũ; handoff local bị ignore; dirty code chưa thành release snapshot | Một current-state index; snapshot manifest, review và commit có chọn lọc sau duyệt. |
| R21 | P2 theo scope | Mobile/tablet, mọi locale và a11y chưa nghiệm thu đầy đủ | Có thể phát hành desktop-only nếu được duyệt và ghi phạm vi; mobile không được gọi PASS. A11y desktop quan trọng vẫn làm trong release đầu. |

Các điểm cần tái hiện thêm, **chưa gọi là bug đã xác nhận**: polling nuốt lỗi; reload chỉ chọn archive mới nhất; fallback 404 sang legacy dùng lại intent/key; source response thiếu hash target trong một số nhánh; session hết hạn giữa lúc giữ draft. Chúng thuộc bài nghiệm thu adverse/concurrency, không được sửa nghiệp vụ chỉ theo phỏng đoán.

## 7. Methodology: đã đủ gì và phải bổ sung gì?

### 7.1. Trang 13 đủ để lập trình tiếp

Trang 13 đã định nghĩa công thức, trọng số, mốc nội suy, bands, missingness, evidence, scope, loại giao dịch, staleness và điều kiện nghiệm thu. Không còn đúng nếu nói “không có methodology nên không thể làm”.

SOURCE hiện tại cũng đã có bộ tính Decimal và registry theo hướng đó. Bộ tính tham chiếu sử dụng BigInt rational, không làm tròn giữa chừng; phân band theo tổng chính xác rồi mới format hiển thị.

| Metric | Công thức chuẩn | Điểm tối đa |
| --- | --- | ---: |
| M01 | Current assets / current liabilities | 15 |
| M02 | Quick assets / current liabilities | 10 |
| M03 | Equity / assets | 20 |
| M04 | Interest-bearing debt / EBITDA có bridge | 10 |
| M05 | Operating profit / interest expense | 15 |
| M06 | Operating profit / net revenue | 10 |
| M07 | Cash from operations / net revenue | 20 |
| Tổng | Bốn nhóm 25 / 20 / 25 / 30 | 100 |

Không phải tạo phương pháp mới; công việc là đóng những khoảng trống triển khai, contract, kiểm định và phê duyệt.

### 7.2. Bốn lớp phải hoàn thiện riêng

| Lớp | Đã có | Cần bổ sung |
| --- | --- | --- |
| Đặc tả | Trang 13 đầy đủ cho implementation thử nghiệm | Chốt các policy cần finance reviewer; lấy đúng Trang 09–10 khi chốt wire contract. |
| Reference engine | Code bảy metric, anchors, bands và tests tự tác giả | Đối chiếu artifacts độc lập; golden parity; reason-code mapping; approval config. |
| Application Assessment | Registry/ratio UI; FE action; source/revision primitives | Luồng chạy, lưu, đọc, stale, acknowledge; state axes; immutable result và policy binding. |
| Giá trị sử dụng thực tế | Chưa có validation độc lập được cung cấp | Multi-review, dữ liệu đại diện, sai số được duyệt, scope sử dụng; không có PD ở v1. |

Ba tệp được Trang 13 nhắc tới nhưng **không đính kèm bytes trong nội dung đã gửi**:

- AIC_Method_Config_v1.0_PILOT.json
- AIC_Reference_Scorer_v1.0.py
- AIC_Method_30_Golden_Fixtures_v1.0.json

Chưa có parity acceptance với các artifacts này. Nếu không lấy được bản gốc, chủ dự án có thể duyệt một gói reference mới do người độc lập xây từ đặc tả, gắn version và expected results rồi review. Không giả danh gói mới là 30 fixture gốc. Việc thiếu artifact không cản phần tích hợp đã rõ yêu cầu sau khi được cho phép triển khai.

### 7.3. Các policy tài chính phải có người duyệt

- Phạm vi doanh nghiệp/ngành: v1 chỉ DISTRIBUTION_WHOLESALE_PILOT; các ngành khác xử lý hồ sơ và findings, không phát điểm ngoài scope.
- Quick assets: eligibility và không đếm trùng tiền/tương đương tiền/đầu tư/phải thu; phần bị hạn chế phải loại đúng.
- EBITDA: bridge EBIT + khấu hao/phân bổ có nguồn; xử lý khoản bất thường và leases nhất quán.
- Tolerance balance sheet: 0,5% trong Trang 13 chỉ phục vụ fixture; code hiện chọn exact reconciliation và blocker khi lệch. Phải duyệt tolerance production thay vì âm thầm đổi.
- Ngoại lệ debt=0/interest=0 của M05 không miễn M04; EBITDA<=0 vẫn chặn theo đặc tả.
- Cùng entity/kỳ/basis/currency/units; không annualize hoặc trộn actual/forecast/FX theo suy đoán.
- Verification chứng minh fidelity của dữ kiện/nguồn, không tự xác nhận legal identity, audit status hoặc giá trị phương pháp.
- Trạng thái nghiệp vụ/kết quả và cách dùng: pilot hiện chỉ demo/nghiên cứu; dùng cho quyết định thực tế cần approval và validation riêng.

Reason codes cần đồng bộ trước khi khóa contract: tài liệu dùng EBITDA_NONPOSITIVE và NO_DEBT_NO_INTEREST; code dùng EBITDA_NON_POSITIVE và VERIFIED_ZERO_INTEREST_ZERO_DEBT. Chọn canonical/mapping có version; không đổi tên âm thầm làm hỏng consumer.

### 7.4. Không gộp bốn trục trạng thái

1. Vòng đời phương pháp: unconfigured → configured_pilot → validation_pending → validated_for_limited_use → retired, theo điều kiện được duyệt.
2. Readiness/kết quả tài chính: đủ nguồn/thiếu nguồn/blocked/eligible, theo schema phát hành.
3. Assessment job: queued/running/completed/failed và các trạng thái khác nếu contract đã quy định.
4. Transaction disposition: BLOCKED / FOLLOW_UP / CLEAR_FOR_REVIEW / UNKNOWN.

Stale là quan hệ kết quả với input/version hiện tại, phải được xác định rõ trong contract; không dùng nó để xóa kết quả cũ. HTTP/job hoàn tất có thể vẫn trả kết quả tài chính blocked. CLEAR_FOR_REVIEW không đồng nghĩa giao dịch được phê duyệt.

### 7.5. Giới hạn của sản phẩm và nguồn nghiên cứu

AIC-FHI là rubric độc lập do AIC đề xuất; không gọi AIC-F1–F5 là credit rating Moody’s, không quy đổi sang Aaa/Aa/Baa hoặc PD, không mô tả là xác suất thanh toán và không tự động duyệt/từ chối giao dịch. v1 tiếp tục pd=null. Điểm cao không xóa vấn đề giao hàng/hoàn tiền; điểm thấp không tự bác bỏ đối tác.

Theo chính Trang 13, tài liệu Moody’s là nguồn nghiên cứu có giới hạn sử dụng; không sao chép scorecard/ngưỡng/trọng số hoặc quảng cáo được Moody’s cấp phép khi chưa có quyền. Với validation, dùng báo cáo công khai/được phép hoặc synthetic ghi nhãn; issuer rating không tự là oracle đúng cho FHI của AIC.

## 8. Kiến trúc production đề xuất

### 8.1. Topology đầu tiên

    Người dùng desktop
        │ HTTPS, domain cố định
        ▼
    Reverse proxy / ingress
        ▼
    Next.js web + proxy API
        │ private network
        ▼
    NestJS API ──────────────── PostgreSQL private
        │                          ▲       │
        │                      jobs/data   └→ backup mã hóa ngoài host
        │                          │
        ├─ Dossier worker ─────────┤
        └─ Extraction worker ──────┘
                    │ private request + service auth
                    ▼
            AI/OCR service private
            ├─ PDF processing có resource isolation
            └─ Provider AI đã duyệt dữ liệu/region/billing

    Canonical source: PostgreSQL.
    Cache file materialized: private, kiểm hash, có giới hạn và lifecycle.
    Quyền: mỗi process chỉ có secret/DB/storage permissions cần thiết.

**Khuyến nghị đầu tiên:** một môi trường ứng dụng Linux được quản lý bằng container hoặc service manager, DB private có backup độc lập; AI/worker colocated với cache private theo thiết kế được kiểm chứng. Nếu cloud bắt buộc tách host, phải thiết kế cách chuyển nguồn bảo toàn hash/ACL thay vì giả định file path trên máy này đọc được từ máy khác.

Đây là thiết kế đề xuất, chưa chọn nhà cung cấp hoặc mua dịch vụ. Một application host là điểm lỗi đơn; chỉ phù hợp khi owner chấp nhận downtime/SLO của release đầu. Nếu yêu cầu HA, phải thêm application replicas, database HA và giải quyết shared cache, lease, global concurrency, version skew trước phát hành.

Next.js khuyến nghị reverse proxy khi self-host để xử lý request bất thường, giới hạn và rate limiting. Release phải giữ build/assets nhất quán khi triển khai nhiều bản; thiếu assets hoặc version skew có thể làm navigation lỗi. Chọn cơ chế immutable artifact và rollout tương ứng, không suy ra đây chắc chắn là nguyên nhân Loading hiện tại. [Tài liệu Next.js](https://nextjs.org/docs/app/guides/self-hosting)

### 8.2. Điều chỉnh tối thiểu cần làm

- Production runtime có danh sách module và env validation rõ; bỏ phụ thuộc vào local-only registration bằng thay đổi được review.
- API bind theo topology: loopback nếu cùng host; private interface/container network nếu khác process namespace. Không mở mọi service ra public mặc định.
- Worker entrypoints production riêng hoặc cấu hình được kiểm soát; startup probes, health, graceful shutdown và fencing không bị mất.
- Cache cùng namespace đường dẫn/quyền đối với backend và AI; non-root, không webroot; không cho client chọn path.
- AI test console tắt ở production; internal endpoints chỉ private và có service auth.
- Web/proxy không cache dữ liệu tenant; CDN chỉ cho immutable public assets; kiểm tải PDF/download qua session/ACL.
- Gắn release ID, contract hash, model/prompt/method versions với deployment và kết quả.

Giữ PostgreSQL làm nguồn canonical trong release đầu giúp tránh dual-write DB/object storage khi chưa cần. Nếu sau này chuyển sang object storage: dùng private immutable object, hash/version binding, cơ chế commit nhất quán và restore/retention đồng bộ; đó là change có migration riêng.

## 9. Kế hoạch frontend

### 9.1. Những sửa cần làm trước acceptance

| Hạng mục | Hành vi cần đạt |
| --- | --- |
| Usable summary | Tôn trọng summary authoritative; dữ liệu chưa có/không đọc được không biến thành “0 trường”; unreadable không thành usable. |
| Năm/kỳ đã xác minh | Evidence hiện diện chỉ là có nguồn. Nhãn verified phải dựa vào xác minh của người đúng revision; filename/suggestion vẫn là dự đoán. |
| Decoder | Required/extra fields, enum, date-time, integer bounds, null và số dạng chuỗi phải đúng schema. Lỗi payload hiển thị rõ, không render nửa dữ liệu như đã hợp lệ. |
| Readiness/nút đánh giá | Hiện blocker cụ thể theo backend; phân biệt chạy review và chạy Assessment. Chỉ enable khi backend cho phép; backend vẫn kiểm lại khi POST. |
| Assessment result | Phân biệt no result, queued/running, blocked, failed, provisional nếu được phép, completed, stale và acknowledged; không có điểm mẫu/fallback số. |
| Financial entry | Nhập/chọn statement set, kỳ/basis/currency/units, raw/normalized, từng source và bridge; đọc lại sau reload; xác minh bằng hành động riêng. |
| Draft/session/conflict | 401 có đường đăng nhập lại; 409 cho giữ/sao chép nội dung và refresh nguồn; không tự gửi mutation cũ với revision mới. |
| Source viewer | Đổi PDF/trang/zoom/reload không đổi quote/version/hash; giải thích khi hết phiên, bị thu hồi quyền, thiếu nguồn hoặc hash sai. |
| Batch/progress | Intake và extraction là hai giai đoạn; đếm member rõ; failed/zero/needs_review riêng; mất worker/timeout không treo im lặng. |
| Locale/a11y | Label/error/keyboard/focus/contrast/đọc số và ngày đúng, không lẫn thuật ngữ verified với AI confidence. |

### 9.2. Routing, UI và tài nguyên

Giữ routes login, cases, case detail, counterparties, respondent cùng hash tabs hiện có; nghiệm thu deep-link/reload/back-forward và chuyển hồ sơ. Tách UI state theo case/source/version để tránh kết quả cũ xuất hiện khi đổi nhanh.

Giữ PDF worker/assets được chuẩn bị theo phiên bản thư viện; kiểm CSP và blob/worker URL trên production build. Không siết CSP bằng một chuỗi sao chép làm hỏng PDF.js hoặc native respondent.

Scope đầu tiên: desktop ngang. Ngoài kích thước 1440×900 đã quan sát, phải chốt các kích thước desktop thực tế cần hỗ trợ, zoom và mức phóng đại chữ; kiểm modal/long text/bảng lớn. Mobile/tablet là backlog riêng theo yêu cầu hiện tại.

## 10. Backend, domain và Assessment thật

### 10.1. Assessment cần là một luồng hoàn chỉnh

Sau khi owner duyệt triển khai và contract được khóa, triển khai theo chuỗi:

1. Kiểm session/tenant/case membership, Origin/CSRF, expected revision, idempotency.
2. Chụp input snapshot: case/exposure, counterparty revision, document versions/hashes, facts/verification, selected financial set, policy/method version.
3. Tính readiness từ snapshot; trả blockers có mã và nguồn. Không bỏ qua blockers bằng flag phía client.
4. Chạy financial metrics bằng engine deterministic; AI chỉ đề xuất extraction/findings/narrative có nguồn.
5. Chạy Transaction Review độc lập; không blend FHI vào giao dịch hoặc dùng score để xóa red flags.
6. Trước publish, kiểm phiên bản/nguồn/phê duyệt còn hiệu lực; fence theo attempt/job nếu bất đồng bộ.
7. Lưu kết quả và trace bất biến, limitation, provenance, thời điểm, actor; mọi historical result vẫn truy xuất được theo ACL.
8. GET/poll trả đúng trạng thái; human acknowledge lưu bằng mutation có audit, không tự đồng nghĩa phê duyệt giao dịch.
9. Thay nguồn/fact/kỳ/role/exposure/policy/method làm kết quả liên quan stale; chạy lại tạo kết quả mới.

Cần quyết định orchestration theo contract và thời lượng đo được: tính FHI thuần có thể đồng bộ, nhưng phần cần gọi model dài nên có job/poll và timeout rõ. Không tự thêm enum/endpoint từ JSON minh họa Trang 13.

### 10.2. Quyền sở hữu logic

Trang 13 phân công AI Evaluation làm metric/evaluation, còn repo hiện đã có engine Decimal ở backend. **Đề xuất dùng một engine production có thẩm quyền duy nhất, tái sử dụng engine đã có**, và reference scorer độc lập làm oracle. AI Evaluation phụ trách findings/narrative và đối chiếu đầu vào theo contract.

Đây là quyết định kiến trúc cần thống nhất giữa Đức, Tuấn Anh và BA khi triển khai; không tự di chuyển công thức hoặc duy trì hai engine production có khả năng lệch nhau. Nếu đội chọn AI service làm nơi tính chính thức, adapter và parity vẫn bắt buộc; backend vẫn chịu trách nhiệm policy/readiness/publish.

### 10.3. Quy tắc giao dịch và định danh

- RECEIVABLE: proposed khác booked; invoice khác tiền đã nhận; ngày quá hạn phụ thuộc due trigger đã xác minh; outstanding chỉ tính từ các thành phần đã kiểm chứng.
- PREPAYMENT: planned advance khác actual payment; milestone/delivery/refund/guarantee có chứng cứ; chậm giao không tự là default.
- Pháp nhân/role mâu thuẫn phải chặn kết luận liên quan. Quy trình tạo/sửa counterparty hiện giữ unresolved; cần chốt ai có quyền xác nhận identity, nguồn nào, audit và khi nào mất hiệu lực.
- Bao phủ sáu nhóm BA: pháp lý, tín dụng, ngành/cạnh tranh, thanh toán, tài chính, bảo đảm/khả năng thu hồi nếu có. Không tự tuyên bố đã kiểm CIC hoặc nguồn ngoài chưa kết nối.
- Kết quả không có findings vẫn có thể UNKNOWN nếu thiếu nguồn; chỉ CLEAR_FOR_REVIEW khi đáp ứng tiêu chí được duyệt.
- Native invitation là capability có phạm vi và thời hạn, không chứng minh người trả lời là đại diện pháp nhân. Chưa gửi email/tin nhắn tự động nếu chưa có yêu cầu riêng.

## 11. AI/OCR và chất lượng tài liệu

### 11.1. Pipeline mục tiêu

1. Nhận đúng source bytes/hash/version từ backend; validate size, type và page policy.
2. Inspect PDF và chất lượng text layer; phân biệt text, scan, encrypted/corrupt, garbled.
3. Xác định loại, pháp nhân/role, kỳ/basis/đơn vị bằng chứng cụ thể; chưa rõ thì unresolved.
4. Đọc bảng theo hàng/cột/kỳ; giữ raw label, raw value, vị trí và quote; không coi mã chỉ tiêu hoặc số năm là số tiền.
5. Chuẩn hóa deterministic; không tự chọn tỷ giá, cộng nợ, thay proxy EBITDA hoặc lấp 0.
6. Ground từng field và phát hiện xung đột; chỉ đề xuất, không tự human-verify.
7. Schema validation và source binding trước publish; trường bị chặn phải có reason, pipeline vẫn có trạng thái nhất quán.
8. Reviewer đối chiếu và lưu xác nhận/sửa có nguồn; sửa input làm verification cũ stale.

Đường kiểm chứng thủ công có nguồn là một phần của vận hành thật, không phải mock. Nó không thay được ngưỡng chất lượng AI nếu sản phẩm hứa tự động trích xuất ở mức cụ thể.

### 11.2. Bộ dữ liệu nghiệm thu

Theo Trang 13, tối thiểu có các nhóm 4 PDF text, 4 scan, 4 báo cáo/quy định thực tế được phép và 4 invoice/contract synthetic. Ghi rõ nhóm có overlap hay độc lập; không tự tính tổng nếu cùng tài liệu được dùng nhiều nhóm.

Mỗi tài liệu cần oracle độc lập: pháp nhân, role, kỳ, basis, đơn vị, giá trị, trang/quote và trạng thái unknown hợp lý. Phải có negative/multisource: hai cột năm, OCR xấu, đơn vị nghìn/triệu/tỷ, vốn âm, lãi vay bằng 0, sai pháp nhân, thiếu bridge, statement thay phiên bản và tài liệu quốc tế.

Đo riêng: field precision/recall, sai số critical fields, evidence validity, đúng kỳ/đơn vị/role, tỷ lệ abstain, thời gian reviewer sửa, latency/cost theo tài liệu. Ngưỡng đạt phải được BA/financial reviewer và owner chốt trước khi chạy nghiệm thu. Không dùng confidence model làm accuracy hay xác suất trả nợ.

### 11.3. Tính ổn định và nguồn lực

- AI mặc định mock nếu không đặt mode. Production phải yêu cầu live/config phù hợp một cách rõ ràng và kiểm mode thực tế; lỗi provider không được fallback mock.
- Pin/review model, prompt, OCR path, contract và dependency; model/prompt thay đổi phải chạy regression và canary.
- Timeout HTTP không đảm bảo đã dừng native PDF parsing. Tách tác vụ native có giới hạn CPU/RAM/process/time, kill/recycle và phục hồi job bằng fence.
- ZIP reader hiện đã spawn helper riêng, lọc env, có timeout/output caps. Cần hoàn thiện resource isolation còn thiếu, không mô tả sai rằng toàn bộ ZIP đang chạy không giới hạn trong API.
- Budget provider/concurrency hiện chủ yếu theo process; scale replicas phải có tổng budget/rate-limit và queue backpressure được kiểm.
- PDF dài hơn policy hiện cần giữ nguồn và needs_review; nếu thêm chunking phải thiết kế coverage/page mapping/merge/retry. Không tăng max-pages rồi gọi là hoàn thiện.
- Không log raw PDF, prompts, provider response hoặc secrets vào log chung. Capture chẩn đoán chỉ opt-in có quyền và retention.

## 12. Bảo mật và quản trị dữ liệu

### 12.1. Đăng nhập ứng dụng và service auth là hai lớp

Tài khoản chuyên viên đăng nhập qua session của AIC. INTERNAL_API_KEY xác thực backend/worker gọi AI service; GEMINI_API_KEY dùng AI service gọi provider. Không đưa hai key này vào trình duyệt hoặc dùng chúng thay mật khẩu người dùng.

Production phải từ chối missing/blank/test-default keys, dùng secret store hoặc injection riêng theo môi trường, có rotation/revocation và audit vận hành. Không công bố giá trị .env trong tài liệu, Git hoặc màn hình lỗi. Tài khoản/khóa thử nghiệm đã được chia sẻ trong quá trình phát triển không được mang sang production; cấp credentials riêng.

Hoàn thiện account provisioning, thay/khôi phục mật khẩu hoặc SSO, disable/revoke session, phân quyền quản trị và quyền xác minh/duyệt. MFA/SSO chọn theo đối tượng sử dụng và risk policy; không mặc định tự viết một hệ IAM phức tạp nếu giải pháp quản lý phù hợp hơn.

### 12.2. Ingress và tenant isolation

- TLS, frontend origin cố định, host allowlist và secure cookies; không để production rơi về dev-origin equivalence.
- Reverse proxy phải có chính sách trusted proxy/IP; login throttle hiện dùng socket peer có thể chỉ thấy proxy. Không tin toàn bộ X-Forwarded-For do client gửi.
- Kiểm 401/403/404, CSRF/Origin, replay sau mất quyền, download nguồn, respondent bearer, rate/size limits và cross-tenant trực tiếp qua ingress thật.
- No-store cho response riêng tư/token; token invitation chỉ xuất hiện lúc được cấp và người dùng chủ động chia sẻ; không vào analytics/log/referrer.
- CSP hiện có frame-ancestors/base-uri/object-src và các header cơ bản; chưa phải đầy đủ chính sách script/style/connect. Thiết kế theo UI/PDF worker thực tế và rollout có kiểm chứng.

### 12.3. Tệp không tin cậy

Giữ allowlist loại, caps, hash, private storage và quyền upload. Rà soát ZIP traversal/symlink/nested archive/bomb, malformed/encrypted PDF, parser exploits và resource exhaustion. Antivirus/sandbox/CDR nếu áp dụng phải bảo toàn nguồn gốc và phân biệt bản derivative; không gửi hồ sơ nhạy cảm lên dịch vụ scan công cộng.

Đây là hướng hardening phù hợp khuyến nghị kiểm type thực, giới hạn, quyền truy cập, vị trí storage và sandbox của OWASP, không phải chứng nhận an toàn. [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

### 12.4. Điều kiện dùng nhà cung cấp AI với hồ sơ thật

Chưa xác minh Cloud Project/billing/region/DPA hiện tại. Việc owner đã cho phép Gemini xử lý thư mục thử nghiệm không đồng nghĩa mọi hồ sơ khách hàng production đã được phép gửi.

Google phân biệt Unpaid và Paid Services: unpaid có thể dùng input/output để cải thiện sản phẩm và có human review; paid Gemini API qua project có billing hoạt động không dùng prompts/responses để cải thiện sản phẩm, nhưng vẫn có lưu giới hạn cho abuse monitoring. Phải kiểm tài khoản thực tế và điều kiện áp dụng trước dữ liệu nhạy cảm production. [Gemini API Terms](https://ai.google.dev/gemini-api/terms)

Paid không tự đồng nghĩa zero retention. Nếu tổ chức yêu cầu guaranteed zero retention hoặc thỏa thuận enterprise, đánh giá đường Vertex AI và cấu hình/chính sách tương ứng; một số chức năng như Search grounding và Files có retention riêng. [Google — Zero data retention](https://ai.google.dev/gemini-api/docs/zdr)

Owner/người phụ trách dữ liệu cần chốt: quyền sử dụng báo cáo, thông báo/đồng ý, vị trí xử lý, data minimization, retention, quyền truy cập, xử lý sự cố và xóa dữ liệu. Báo cáo này không kết luận tuân thủ pháp luật tại bất kỳ quốc gia nào.

## 13. PostgreSQL, nguồn chuẩn, backup và migration

### 13.1. Giữ invariant dữ liệu

Giữ source bytes/hash/version, lineage, facts, human decisions, review, kết quả cũ, replay và audit. Không reset DB, sửa lịch sử migration, xóa failed jobs hoặc thay nguồn chỉ để chạy được nút.

Migration runner hiện dùng advisory lock, kiểm ledger là prefix đúng thứ tự và checksum của toàn lịch sử, áp dụng từng migration bằng transaction. Startup không tự migrate; database service kiểm kết nối và migration đầu cuối theo source. Production cần bước migration có operator/release gate, rehearsal và quyền riêng.

Tách role migration/owner khỏi API, intake và extraction; least privilege và ACL phải được kiểm bằng kết nối thật của release. Gate B đã chứng minh restricted roles trên runtime local tại thời điểm đó; không suy ra launcher khác hoặc production cũng dùng đúng role.

### 13.2. Backup production

Backup DPAPI CurrentUser hiện có là bằng chứng restore local tốt, nhưng phụ thuộc tài khoản/profile Windows và không đủ kế hoạch mất cả máy.

Đề xuất backup mã hóa ngoài host, quản lý khóa có recovery, retention và kiểm restore định kỳ. Nếu RPO yêu cầu phục hồi sát thời điểm, chọn managed PITR hoặc base backup + WAL archiving đã được diễn tập. Logical dump không thay được WAL/PITR. [PostgreSQL — PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)

Nghiệm thu phục hồi phải bao gồm source bytes/hash, schemas/ledger, tài khoản/ACL, sessions theo chính sách, facts/decisions, jobs/leases, assessments và audit. Restore sang môi trường biệt lập, chặn outbound và side effects, không replay việc gửi yêu cầu hoặc gọi AI một cách vô ý.

RPO (mất tối đa bao nhiêu dữ liệu), RTO (khôi phục trong bao lâu), retention và người trực khôi phục do owner chốt. Chưa có số được duyệt nên báo cáo không hứa SLA.

### 13.3. Dung lượng và hiệu năng

PDF/ZIP trong PostgreSQL làm tăng DB, WAL, backup và thời gian restore. Đo growth, indexes, query plans và connection pools trên dữ liệu đại diện; mỗi API/worker/replica nhân thêm connections. Không lấy pool max của một process làm ngân sách toàn DB.

Tách retention cache tạm với canonical sources và audit. Cơ chế purge hiện chưa được duyệt production; giải quyết legal hold, xóa dữ liệu và immutable audit bằng policy/schema thiết kế rõ, không bật cron xóa theo phỏng đoán.

## 14. CI/CD, deployment và quan sát vận hành

### 14.1. Release phải tái lập được

- Một release manifest: commit + dirty-source resolution, migrations/checksums, contracts hashes, Node/pnpm/Python/dependency versions, model/prompt/method, build IDs.
- Node dùng lockfile đã review; Python cần dependency resolution/lock tái lập cho production và các native/system dependencies đã kiểm.
- Security/license/SBOM scan có phạm vi và xử lý findings. Báo cáo chưa chạy scan; không kết luận dependency có CVE chỉ từ tuổi phiên bản.
- Build web/API/AI artifact một lần, promote chính artifact qua staging/production; không build đè lên thư mục đang phục vụ.
- CI không chứa PDF thật/secrets. Live AI acceptance dùng dữ liệu được phép, budget và secret scope riêng.
- Chốt release branch/tag từ duc sau review; render.yaml đang nhắm main không tự phản ánh code local hiện tại. Không tự đổi branch hoặc push trong lượt này.

### 14.2. Phạm vi các lệnh hiện tại

| Lệnh ở root | Phạm vi thực tế |
| --- | --- |
| pnpm build / pnpm start | Web Next.js; không build/chạy toàn hệ thống. |
| pnpm typecheck / pnpm lint / pnpm test | Frontend; lint gồm boundaries + Prettier, test gọi check:aic. |
| pnpm api:build | TypeScript backend. |
| pnpm api:start | Backend compiled; không tự khởi động hai worker/AI. |
| pnpm api:migrate | Migration operator, cần DB và quyền phù hợp. Không đưa vào startup tự động. |
| pnpm api:test:mvp | Bộ kiểm backend trên harness PostgreSQL local/disposable theo script; không phải browser UAT. |
| pnpm dev:all | Launcher phát triển local, nay có cả worker ZIP; không là production supervisor. |
| pnpm qa:serve | QA server riêng; không được dùng để tuyên bố hệ thống production live. |

CI cần bổ sung/chọn rõ coverage tài chính, questionnaire/capability, dossier và Assessment mới theo test inventory, vì một lệnh root xanh không bao trùm mọi module. Dùng tests hiện hữu có giá trị; không cần tạo test chỉ để lặp lại implementation. UI acceptance vẫn phải trực tiếp trên trình duyệt.

### 14.3. Logs, probes và alerts

Phân biệt liveness (process sống) và readiness (DB/schema/contract/config sẵn sàng nhận việc); provider outage không nhất thiết làm API đọc hồ sơ chết theo. Worker cần heartbeat và queue health, không chỉ TCP port.

Chỉ số cần có: API latency/error; auth/CSRF/ACL denials; queue age/lag; lease expired/retry/fence failures; PDF inspect/extract time; usable/zero/blocked theo lý do; provider timeout/429/cost; CPU/RAM/disk; DB connections/locks/storage/backup age; stale và acknowledgement.

Trace theo request/job/case opaque IDs, release/mode/model/prompt/contract/method; không log business values và raw source. Alert phải có người nhận và runbook; không đặt ngưỡng tùy ý trước baseline tải.

## 15. Backlog triển khai đề xuất

Đây là phân công theo vai trò và tên trong Trang 13, không phải xác nhận các thành viên đã nhận việc. QA/DevOps/security/finance reviewer cần được owner chỉ định nếu chưa có.

| ID | Ưu tiên | Gói việc / owner đề xuất | Phụ thuộc | Tiêu chí hoàn tất |
| --- | --- | --- | --- | --- |
| W01 | P0 | Baseline + handoff/README current-state — Đức | Owner duyệt bắt đầu | Snapshot đủ 14 file local, contracts/migrations/docs; không mất handoff; tái lập đúng bản từ checkout sạch. |
| W02 | P0 | Scope, data policy và release approvals — Owner + BA + finance | Không | Chốt release có/không điểm, ngành/giao dịch, desktop, khách hàng/người dùng, dữ liệu/provider và người ký. |
| W03 | P0 | Contract freeze AIC 2.0 — Đức + Tuấn Anh + Nguyên | W02, Trang 09–10 | DTO/version/reason codes/state axes/compatibility/approval semantics có ví dụ và review; không trộn 1.0.2. |
| W04 | P1 | CO01/CO02/CO03 và UI source-state — Đức/FE | W03 phần liên quan | Usable/unknown/verified/decoder đúng contract, reload và malformed response không phát dữ liệu sai. |
| W05 | P0 cho nguồn tài chính | Financial/identity/bridge workflow — Đức + BA/finance | W03 | Nhập/chọn/xác minh nguồn thật; exact tuple; source change stale; không tự xác nhận pháp nhân. |
| W06 | P0 cho AI đạt scope | BCTC extraction + oracle — Nguyên + finance reviewer | W02, W03 | Tập tài liệu có quyền và expected độc lập; kỳ/cột/đơn vị/role/amount đúng ngưỡng duyệt; abstain đúng, có trace. |
| W07 | P0 cho điểm | Method artifacts + parity + approval registry — Tuấn Anh + Đức + finance | W02, reference package | Bảy metric match oracle/goldens; approval/version/scope bất biến, default unconfigured; không tự bật pilot. |
| W08 | P0 cho Assessment | Orchestration/persistence/readiness/stale/ack — Đức + Tuấn Anh | W03, W05, W07 cho điểm | Run/read/poll/replay/race/source change/history/ack đúng contract qua API thật và UI. |
| W09 | P1 | Transaction Review đủ scope — Đức + Tuấn Anh + BA | W03, W05, nguồn phù hợp | Hai core flows; proposed/actual/payment/due/refund/milestone đúng; findings có nguồn, không auto-approval. |
| W10 | P1 | Request/questionnaire/respondent/replace/retry acceptance — Đức + QA | W03, fixture và quyền hợp lệ | UI đầy đủ cả positive/negative, hai context, expiry/revoke/stale; không phát request thật chỉ để test. |
| W11 | P0 production | Runtime promotion + topology/cache — Đức + DevOps | W02, W03 | API và hai worker chạy production theo config mới, private AI/cache đúng, probes và restart/fence đạt. |
| W12 | P0 public | Ingress/auth/secrets/upload isolation — Đức + DevOps/security | W11, data policy | TLS/Origin/CSRF/ACL/throttle/rotation/resource limits được kiểm qua ingress; console off, no mock fallback. |
| W13 | P0 vận hành | DB roles + backup/PITR/restore — DevOps/DB + Đức | W02 RPO/RTO, W11 | Least privilege; backup off-host; restore sang môi trường riêng đạt mục tiêu; nguồn/audit không mất. |
| W14 | P1 | CI, artifacts, logs/alerts/runbooks — Đức + DevOps | W01, W11 | Build/test tri-service có manifest; failure chặn release; health/queue/cost/backup alerts và rollback rehearsal. |
| W15 | P1 | Regression + desktop UAT — QA + BA + Đức | W04–W14 theo release scope | Mỗi hàng §16 có evidence và kết quả; release candidate cố định; không còn blocker/P1 chưa có quyết định. |
| W16 | P0 cho dùng điểm thật | Independent method validation — finance reviewers + Owner | W05–W09, dataset | Hai reviewer, tối thiểu theo Trang 13; report/scope/sai số/limitations, signed limited-use decision nếu đạt. |
| W17 | P0 phát hành | Staging soak + production release — Owner + Đức + DevOps | Gate ở §17 | Checklist có chữ ký, backup/revert, người trực, canary trong scope; smoke/readiness và theo dõi sau release. |
| W18 | P2 theo scope | Mobile/tablet, mở ngành/quốc gia/currency, PDF dài nâng cao — nhóm phù hợp | Release ổn định + policy mới | Spec, validation và acceptance riêng; không lẫn với cam kết desktop v1. |

Các việc có thể làm song song sau duyệt: W04/05/06/07 và thiết kế W11–14 sau khi W02/03 cung cấp đầu vào. W08 không chờ AI đọc hoàn hảo mọi tài liệu nếu đã có nguồn nhập/kiểm chứng hợp lệ, nhưng không được publish FHI khi thiếu facts hoặc approval.

## 16. Kế hoạch kiểm thử trực tiếp UI desktop

### 16.1. Nguyên tắc thực hiện

Chạy trên release candidate/staging với backend/worker/DB thật và AI live cho ca được phép; không dùng QA server/fixture response để thay bằng chứng tích hợp. Có thể dùng tài liệu synthetic được gắn nhãn cho negative/race/destructive scenarios; các ca xử lý thật dùng báo cáo có quyền và oracle.

Thao tác bằng UI bình thường. Không sửa DOM/React state, chạy SQL để biến dữ liệu thành verified, reset attempts hoặc bypass readiness. Dữ liệu cần sửa trong test phải đi qua đúng chức năng và giữ lịch sử. Không gửi request, cấp token hoặc xác nhận tài chính hộ người dùng nếu fixture/ủy quyền không phù hợp.

Mỗi ca ghi: release ID, browser/version/viewport, mode/provider/model, user role/tenant, input hash, case/job/result IDs, bước thao tác, expected/actual, ảnh/DOM proof, lỗi console/network đã che dữ liệu, issue và retest. Evidence chứa hồ sơ thật giữ private. Browser không dùng được thì ca BLOCKED, không PASS.

### 16.2. Ma trận acceptance

| Ca | Thao tác / expected chính | Trạng thái bằng chứng hiện có |
| --- | --- | --- |
| U01 | Login sai/đúng, thông báo không lộ user tồn tại | Đã quan sát một phần UI-18. |
| U02 | Logout, route bảo vệ, expiry/idle/relogin; giữ/sao chép draft | Chưa đủ UI. |
| U03 | Hai user/tenant: list/detail/PDF/job/history không truy cập chéo | HIST backend; UI cần chạy. |
| U04 | Tạo/sửa/chọn đối tác; unknown và identity conflict hiển thị đúng | Chưa đủ UI. |
| U05 | RECEIVABLE: seller/buyer, proposed/booked, amount/term unknown | Tạo hồ sơ kỹ thuật đã chạy; core flow có nguồn chưa đủ. |
| U06 | PREPAYMENT: buyer/supplier, planned/actual, milestone/refund | Chưa đủ UI. |
| U07 | Upload PDF đúng loại, reload và xem nguồn/hash/version | Hai PDF live đã chạy; regression release cần lặp. |
| U08 | Text/scan/garbled/corrupt/encrypted/wrong type và size caps | Một phần caps đã chạy; tập tài liệu chưa đủ. |
| U09 | Pending → terminal, failed/zero/usable/needs_review, mất worker | Đã thấy nhiều trạng thái; recovery chưa đủ. |
| U10 | ZIP nhỏ/30/60 members; progress counters và reload | ZIP nhỏ UI chạy; 30/60 mới có HIST backend offline. |
| U11 | ZIP mixed/nested/traversal/bomb/duplicate; rejection không mất nguồn hợp lệ | Cần staging/negative acceptance có kiểm soát. |
| U12 | PDF dài quá policy: giữ source, needs_review, không giả coverage | HIST backend; UI chưa đủ. |
| U13 | Retry server cho phép thành công; hết budget disabled; double click/reload | Disabled đã thấy; positive còn thiếu. |
| U14 | Đổi phiên bản/response document, giữ source cũ và stale đúng | Mới xem options; chưa submit UI. |
| U15 | Viewer trang đầu/giữa/cuối, zoom, đổi tài liệu, current page/quote page | Một phần đã chạy; trang cuối BCTC và đổi nguồn còn thiếu. |
| U16 | Viewer khi expired session/revoke quyền/hash mismatch/source missing | Chưa đủ UI. |
| U17 | Explorer search/group/filter/reset/empty, nhiều archive và refresh | Một phần đã chạy; batch/multi-archive còn thiếu. |
| U18 | Document review verify/correct/identity/source mismatch theo nguồn | Chưa đủ UI; không fake human verification. |
| U19 | Review → findings → resolve/dismiss/reopen có lý do và audit | Run đã chạy; chuỗi quyết định còn thiếu. |
| U20 | Waiver/revoke đúng allowed requirement, không unlock financial facts | Chưa đủ UI. |
| U21 | Request draft/edit/approve/export/cancel → response → recheck/history | Nháp/edit/stale conflict đã chạy; phần còn lại chưa đủ. |
| U22 | Questionnaire staff draft/publish/answer/verify/close/version | Nháp đã chạy; chưa đủ UI. |
| U23 | Invitation ở context riêng: token/submit/skip/receipt/replay | HIST HTTP; UI context riêng chưa chạy. |
| U24 | Invitation expired/revoked/reissued/closed/rate limit; old token bị chặn | HIST HTTP; UI chưa đủ. |
| U25 | Financial set positive save/select/reload; fact raw/normalized/source | Chưa chạy positive UI; nhập date bằng tool từng không thành công. |
| U26 | Verify facts và quick-assets/EBITDA bridge; sửa nguồn làm stale | HIST backend; UI chưa đủ. |
| U27 | Sai kỳ/basis/đơn vị/entity, duplicate facts, missing/negative/zero | Cần UI + oracle; blocked có giải thích. |
| U28 | Unconfigured không phát điểm; approved scope/ngoài scope theo policy | Unconfigured đã thấy; activation chưa được duyệt. |
| U29 | Assessment đủ điều kiện → job/result/components/source/band | Chưa có luồng phát hành hoàn chỉnh; không PASS. |
| U30 | Assessment stale do đổi file/fact/exposure/method; history còn nguyên | Cần implementation và UI acceptance. |
| U31 | Human acknowledge/recheck; không auto approve transaction | Chưa đủ UI. |
| U32 | Hai cửa sổ sửa cùng case, double submit, reload sau timeout | Cần UI race/replay; không tự gửi intent mới khi outcome chưa rõ. |
| U33 | Deep-link sáu tab, back/forward, direct refresh, đổi case nhanh | Sáu tab đã mở; chưa đủ mọi routing interaction. |
| U34 | Desktop sizes được duyệt, long text/table, modal scroll, zoom/focus/keyboard | 1440×900 cơ bản đã đo; phần còn lại chưa đủ. |
| U35 | vi/en/zh-CN toàn bộ workflow, ngày/số/tiền, error/empty/disabled | Mới kiểm một số labels. |
| U36 | Restart/rollout web/API/worker trong lúc dùng, không mất draft/source/job/result | Web production reload đã chạy; full controlled recovery còn thiếu. |

Bộ API/DB/contract/regression kiểm invariant và adverse cases khó quan sát bằng UI; **không thay thế U01–U36**. Khi triển khai sau này, dùng các test hiện có và bổ sung chỉ nơi thay đổi/rủi ro cần bảo vệ. Lượt báo cáo không viết bộ code test mới.

## 17. Các gate phát hành và lộ trình

### 17.1. Trình tự

| Giai đoạn | Mục tiêu | Đầu ra review được | Điều kiện qua |
| --- | --- | --- | --- |
| G0 — Chốt baseline/scope | Biết chính xác đang phát hành gì | W01–03, approved scope, contract và manifest | Không có mâu thuẫn policy/contract chưa phân xử trong scope. |
| G1 — Hoàn thiện nguồn và nghiệp vụ | Hồ sơ/facts/review/Assessment đi xuyên suốt | W04–10, oracle, parity và trace | Hai core flows đúng; stale/unknown/blocked đúng; không tự xác minh. |
| G2 — Staging như production | Runtime, ingress, storage, worker, secrets, backup và observability | W11–14, deployment/runbooks/restore evidence | Production config chạy thật; private boundaries và recovery đạt mục tiêu duyệt. |
| G3 — Acceptance release candidate | Desktop và các invariant có evidence | W15, U01–U36 theo phạm vi; danh sách lỗi còn lại | Không còn blocker và không có ngoại lệ P1 chưa được owner ký chấp nhận. |
| G4 — Method limited-use | Cho phép phát điểm thật trong scope | W16 + validation/approval log | Finance/owner duyệt; đầy đủ facts/version/source; PD vẫn null. |
| G5 — Release có kiểm soát | Đưa đúng artifact lên production và theo dõi | W17, smoke/canary, rollback và on-call | Tất cả gate bắt buộc theo scope đã qua; owner ký phát hành riêng. |

G1 và G2 có thể chạy song song có kiểm soát sau G0. G4 có thể bắt đầu sớm ở phần chuẩn bị dataset/review, nhưng không đóng trước khi có kết quả tích hợp và kiểm định. Release xử lý hồ sơ không có điểm có thể không chờ G4 **nếu owner duyệt scope đó**; release toàn bộ đánh giá phải qua G4.

Không đưa lịch “xong trong N ngày” khi chưa có chủ sở hữu, dung lượng tài liệu, scope, SLA và điều kiện provider. Sau G0 nên ước lượng từng work package, ghi phụ thuộc và dự phòng, rồi owner chốt lịch theo năng lực thực tế.

### 17.2. Checklist Go/No-Go

| Gate | Bằng chứng phải có trước production |
| --- | --- |
| Functional | RECEIVABLE và PREPAYMENT end-to-end, nguồn/role/proposed/actual, request/recheck/history, lỗi và stale. |
| Financial | Exact source/period/basis/unit/bridge; không zero-fill; đủ metric và method approval nếu phát điểm. |
| Reference | Canonical 30 hoặc reference thay thế được duyệt, expected độc lập, boundary/negative parity không lỗi. |
| AI | Text/scan/BCTC/contract oracle; ngưỡng critical-field/evidence được duyệt; lỗi provider không mock fallback. |
| Security | Tenant isolation, auth/session/CSRF/Origin, ingress trust, token, secrets, upload isolation và dependency findings trong scope. |
| Data | Quyền nguồn/provider/retention; backup/restore off-host; không mất source, history hoặc audit. |
| Operations | Health/readiness, queue/fence/retry, resource/cost alerts, runbook, người trực và escalation. |
| Performance | Tải đại diện, concurrency, latency và RSS toàn process tree; SLO được owner duyệt và đo đạt. |
| Release | Artifact/versions/checksums, staging parity, migration rehearsal, rollback, source snapshot review. |
| Human approval | Người thẩm định/finance/owner có thẩm quyền ký đúng phạm vi; không suy ra approval từ việc chạy test. |

Với FHI, tối thiểu giữ các gate G01–G07 Trang 13: provenance 100% cho facts dùng tính điểm; arithmetic 30/30; AI document oracle; hai core E2E; hai reviewer độc lập tối thiểu 10 hồ sơ theo phương pháp; PD null khi chưa calibration; rà soát quyền nguồn và mô tả sản phẩm. Các điều kiện này là nền tảng, chưa thay thế hardening production ở bảng trên.

## 18. Triển khai, rollback và bảo toàn dữ liệu

Đây là runbook đề xuất, chưa thực thi:

1. Freeze release candidate; review diff và manifest, xác nhận không có secrets/real PDFs/private evidence trong artifact.
2. Xác nhận backup mới và khả năng restore, cấu hình/secret riêng, migration plan và compatibility.
3. Trên staging biệt lập, triển khai cùng artifact; chạy schema/contract/config checks, smoke, UAT, recovery/load được duyệt.
4. Nếu có migration, dùng role operator, lock/timeout và rehearsal; ưu tiên expand/contract, giữ bản cũ đọc được trong rollout.
5. Lên production với ingress/worker drain phù hợp; không kill job rồi sửa attempts. Ghi release marker, kiểm health/readiness, login/ACL và queue.
6. Canary trong phạm vi dữ liệu/người dùng đã được phép; quan sát error, cost, stale và chất lượng trước mở rộng.
7. Rollback ứng dụng chỉ khi schema/contract tương thích; quay đúng artifact và assets. **Rollback không mặc định restore DB đè lên dữ liệu mới.**
8. Nếu phải phục hồi DB, dừng writes có kiểm soát, owner đánh giá tác động/RPO, restore sang target riêng, kiểm hash/audit và đối soát side effects trước cutover.

Không chỉnh migration đã áp dụng. Không thay PDF nguồn. Không xóa failed jobs hay reset budgets để “dọn xanh”. Không đặt lại mật khẩu người dùng hiện có cho nghiệm thu. Những dữ liệu kỹ thuật mới phải có namespace/provenance và chính sách giữ/xóa được duyệt.

## 19. Năng lực, chi phí và tiêu chí lựa chọn hạ tầng

Chưa đủ dữ liệu để báo giá cloud hoặc chọn size máy có cơ sở. Cần thu:

| Đầu vào | Tại sao cần |
| --- | --- |
| Số người đồng thời, hồ sơ/ngày, PDF và trang/hồ sơ | Định queue, worker throughput, latency và provider quota. |
| Tỷ lệ scan/OCR, bảng phức tạp, tài liệu dài | CPU/RAM/token và thời gian review khác nhiều so với PDF text. |
| Dung lượng raw/member/versions và retention | Canonical DB, WAL, backup, restore và cache disk. |
| SLO, RPO/RTO, giờ phục vụ và người trực | Quyết định single host/HA, managed DB/PITR và ngân sách vận hành. |
| Provider account/region/model và điều kiện dữ liệu | Giá, quota, retention, private connectivity và hợp đồng. |
| Số lần extract/retry/recheck mỗi hồ sơ | Chi phí không chỉ bằng một lần upload. |

Ước tính sau đo:

- Lưu trữ = source/versions/archives + metadata/indexes + WAL + backups theo retention + cache peak.
- AI = số trang/lượt OCR + tokens input/output + retry/recheck + các dịch vụ tính phí riêng.
- Thông lượng worker xấp xỉ số worker hữu hiệu / thời gian xử lý trung bình, nhưng phải kiểm p95, queue wait và provider quota.
- Chi phí cố định = app compute + DB + backup/storage + logs/monitoring/network + support; chi phí biến đổi chủ yếu theo xử lý tài liệu và provider.

Gate B từng đo Node RSS khoảng 297 MB trong bài offline, **không gồm Python/PostgreSQL/toàn process tree**, nên không dùng con số đó chọn máy production. Proxy/API/ZIP có buffering và encode/decode nhiều bản; đo peak memory theo tổng concurrency. Không tăng workers chỉ vì một PDF nhỏ chạy được.

## 20. Các quyết định và đầu vào cần chủ dự án chốt

**Bổ sung sau khi đọc Google Doc gốc ngày 18/10/2026:** đã lấy bản xuất văn bản của IDEA FINTECH, đọc phần “Chốt idea hiện hành” và trả lời BA, đối chiếu Trang 11 local và Trang 13 người dùng cung cấp. Nhiều câu ở bảng cũ đã có quyết định sản phẩm; không yêu cầu owner chốt lại. Yêu cầu hiện tại của owner là hoàn thiện sản phẩm chạy thật, bao gồm đánh giá; phương án phát hành không có điểm chỉ là lựa chọn chia giai đoạn, không tự thay thế mục tiêu đó.

| Mục | Phần đã chốt / việc còn lại | Trách nhiệm tiếp theo |
| --- | --- | --- |
| D01 — Đầu ra đánh giá | Đã chốt điểm/band khi phương pháp cho phép, điểm thành phần, nhận xét và nguồn. Không hỏi lại có cần chức năng này. | Đội hoàn thiện Assessment; owner/finance duyệt điều kiện phát số và phạm vi sử dụng thực tế. |
| D02 — Người dùng/nghiệp vụ/thị trường | Đã chốt SME, một Chuyên viên, RECEIVABLE/PREPAYMENT lõi, nợ phụ, demo Việt Nam. Ngành tính điểm theo Trang 13. | Tái sử dụng quyết định; chỉ cần thông tin quy mô người dùng/tenant thực tế để sizing và chốt rollout production nếu vượt phạm vi đã duyệt. |
| D03 — Phương pháp và người ký | Trang 13 đã có công thức; chưa có approval/validation production. | Owner/BA chỉ định người duyệt tài chính; ký đúng version/scope sau kiểm định, không suy từ chốt idea. |
| D04 — Engine/contract | Đã chốt AI đọc/đề xuất, code tính, chuyên viên xác minh. Vị trí engine và adapter là quyết định kỹ thuật trong invariant đã có. | Đức/Tuấn Anh/Nguyên đối chiếu contract, đề xuất và review; không đẩy việc thiết kế API hay chọn thư viện sang owner. |
| D05 — Provider và dữ liệu | Quyền thử Gemini với thư mục đã chỉ định đã có; điều kiện production cho dữ liệu khách hàng chưa được xác minh. | Owner/người phụ trách dữ liệu chốt quyền nguồn, retention, điều kiện provider; đội kiểm cấu hình thực tế. |
| D06 — Vận hành | Chưa thấy ngân sách, topology, SLO/RPO/RTO production được chốt trong phần AIC của Google Doc. | Owner chọn mức dịch vụ/ngân sách sau đề xuất có cơ sở; đội thiết kế hạ tầng và recovery tương ứng. |
| D07 — Phân công | Phân tách AI/code/chuyên viên đã chốt; phân công dev có ở Notion. Chưa đủ bằng chứng người nhận vai trò vận hành/finance sign-off. | Chỉ định người chịu trách nhiệm production, sự cố và nghiệm thu; không hỏi lại role sản phẩm. |
| D08 — Thiết bị và tài liệu | Desktop trước đã được owner chỉ đạo; không hỏi lại mobile. Caps hiện tại có trong contract/source. | Đội nghiệm thu desktop/caps; chỉ đưa vấn đề mở rộng PDF dài/giới hạn lên owner khi thực sự cần đổi scope/policy. |

Các nguyên tắc workflow cũng đã có: tài liệu theo giao dịch, waiver có lý do vẫn giữ cảnh báo; financial minimum không được miễn để phát số; bổ sung sai giữ flag, đúng thì recheck và lưu lịch sử; nguồn trực tiếp và nhập thay tách verification. Đội chịu trách nhiệm triển khai chúng.

Những đầu vào còn phải phê duyệt/cung cấp được rút gọn thành: **(1)** người duyệt và policy tài chính/use scope; **(2)** tiêu chí nghiệm thu chất lượng/sai số cùng kết quả validation; **(3)** quyền và điều kiện xử lý dữ liệu production; **(4)** mức dịch vụ/ngân sách và người vận hành. Tập reference/oracle và contract là deliverable cần có, không phải yêu cầu owner tự thiết kế API hoặc thuật toán.

Đội cần đối chiếu **Trang 09–10**, Trang 11 snapshot hiện có và ba reference artifacts Trang 13; chỉ xin bổ sung đúng phiên bản/nội dung còn thiếu sau khi kiểm nguồn local. Không bắt người dùng copy lại mọi trang đã có.

Google Doc còn có câu “chưa có trọng số/ngưỡng” và “chưa code FE/BE”. Câu thứ nhất phải đọc cùng Trang 13 đã có đặc tả AIC-FHI; câu thứ hai là trạng thái lịch sử, không mô tả source hiện tại. Demo Việt Nam không tự là quyết định triển khai khách hàng thật. Các idea khác nằm trong cùng tài liệu không được ghép vào scope AIC.

Không cần chờ đủ mọi tài liệu để làm phần đã rõ sau khi được owner duyệt. Với phần chưa quy định, ghi câu hỏi/decision record và giữ blocked/unknown theo contract; không tự đặt business rules.

## 21. Git, tài liệu và trạng thái bàn giao báo cáo

- Branch vẫn duc; báo cáo không pull/merge/chuyển branch/commit/push.
- Có 14 file source/README/launcher đã sửa trước báo cáo; cần giữ và review như một phần baseline. Không rollback hoặc ghi đè chúng.
- Các handoff local trong docs/handoffs hiện bị ignore từ parent; vì vậy một file tồn tại local không có nghĩa đã được lưu trên GitHub.
- Báo cáo này đặt trong thư mục implementation được cho phép chứa tài liệu kỹ thuật. Trước commit vẫn phải review nội dung, ignore status và evidence; không force-add toàn bộ docs hoặc storage.
- Chưa cập nhật Notion trong lượt này. Muốn đồng bộ sau duyệt nên đưa executive status, work packages, gate/evidence và link release; không đưa raw PDFs, credentials hoặc private screenshots.
- Báo cáo không chứng nhận “toàn hệ thống PASS”. Phạm vi đã quan sát, lịch sử thực thi và việc còn thiếu được tách ở §4–6 và §16.

**Bước triển khai đầu tiên sau khi owner duyệt:** W01–W03, sau đó hoàn thiện nguồn/UI và Assessment theo contract, song song dựng staging/backup/monitoring. Không bắt đầu bằng enable nút, bỏ guard hay thay score null thành số.

## 22. Nguồn truy vết

Các liên kết dưới đây trỏ tới bản local đã đọc hoặc tài liệu chính thức; source có thể thay đổi sau ngày báo cáo. Các tài liệu lịch sử chứa baseline khác phải đọc theo ngày/phạm vi, không trộn số liệu thành kết quả hiện hành.

| Mã | Nguồn |
| --- | --- |
| S01 | [Trang 13 do người dùng cung cấp](<C:/Users/52duc/.codex/attachments/d1cc38ba-17fe-45ae-8959-fa72468625f9/Pasted text.txt>) — SHA-256 **668D5B3369FB7B0A1E1C3A3D6CEF41C350EFC386351DA295A25196414D746024**. |
| S02 | [Yêu cầu MVP v2](C:/Users/52duc/Desktop/Fintech/docs/implementation/requirements/AIC_MVP_Complete_Remaining_Features_v2.md), [owner decisions](C:/Users/52duc/Desktop/Fintech/docs/implementation/MVP-OWNER-DECISIONS.md). |
| S03 | [Feature matrix](C:/Users/52duc/Desktop/Fintech/docs/implementation/MVP-FEATURE-MATRIX.md), [execution report](C:/Users/52duc/Desktop/Fintech/docs/implementation/MVP-EXECUTION-REPORT.md), [FHI reference](C:/Users/52duc/Desktop/Fintech/docs/implementation/FHI-ENGINE-REFERENCE.md). |
| S04 | [Kết quả UI 18/10](C:/Users/52duc/Desktop/Fintech/docs/handoffs/AIC_MANUAL_CHROME_FIX_RESULT.md), [kế hoạch UI](C:/Users/52duc/Desktop/Fintech/docs/handoffs/AIC_MANUAL_CHROME_FIX_PLAN.md), [evidence private](C:/Users/52duc/AppData/Local/AIC/ui-retest-20261018-0107). |
| S05 | [DB Gate B](C:/Users/52duc/Desktop/Fintech/docs/implementation/DB_GATE_B_EXECUTION.md). |
| S06 | [Root scripts](C:/Users/52duc/Desktop/Fintech/package.json), [web manifest](C:/Users/52duc/Desktop/Fintech/apps/web/package.json), [API manifest](C:/Users/52duc/Desktop/Fintech/apps/api/package.json), [Python manifest](C:/Users/52duc/Desktop/Fintech/services/ai/pyproject.toml). |
| S07 | [Configuration](C:/Users/52duc/Desktop/Fintech/apps/api/src/config/configuration.ts:56), [module registration](C:/Users/52duc/Desktop/Fintech/apps/api/src/foundation/foundation.module.ts:38), [bootstrap/bind](C:/Users/52duc/Desktop/Fintech/apps/api/src/main.ts:9). |
| S08 | [Extraction worker entrypoint](C:/Users/52duc/Desktop/Fintech/apps/api/src/documents/run-worker.ts), [dossier worker entrypoint](C:/Users/52duc/Desktop/Fintech/apps/api/src/documents/run-dossier-worker.ts). |
| S09 | [Session service](C:/Users/52duc/Desktop/Fintech/apps/api/src/auth/session.service.ts), [password](C:/Users/52duc/Desktop/Fintech/apps/api/src/auth/password.ts), [guard](C:/Users/52duc/Desktop/Fintech/apps/api/src/auth/session.guard.ts), [auth controller](C:/Users/52duc/Desktop/Fintech/apps/api/src/auth/auth.controller.ts). |
| S10 | [Readiness/ReviewRun](C:/Users/52duc/Desktop/Fintech/apps/api/src/foundation/mvp-workflow.service.ts:499), [counterparty lifecycle](C:/Users/52duc/Desktop/Fintech/apps/api/src/foundation/mvp-counterparty.service.ts). |
| S11 | [Financial registry](C:/Users/52duc/Desktop/Fintech/apps/api/src/financial/financial-registry.service.ts:338), [controller](C:/Users/52duc/Desktop/Fintech/apps/api/src/controllers/mvp-financial.controller.ts). |
| S12 | [Method](C:/Users/52duc/Desktop/Fintech/apps/api/src/financial/fhi-method.ts), [Decimal](C:/Users/52duc/Desktop/Fintech/apps/api/src/financial/decimal.ts), [scorer](C:/Users/52duc/Desktop/Fintech/apps/api/src/financial/fhi-scorer.ts). |
| S13 | [FE Assessment action](C:/Users/52duc/Desktop/Fintech/apps/web/src/features/assessments/components/risk-assessment.tsx:64), [proxy allowlist](C:/Users/52duc/Desktop/Fintech/apps/web/src/lib/api/proxy-policy.ts), [proxy handler](C:/Users/52duc/Desktop/Fintech/apps/web/src/app/api/v2/[...path]/route.ts). |
| S14 | [Document helpers](C:/Users/52duc/Desktop/Fintech/apps/web/src/features/documents/groups.ts), [decoders](C:/Users/52duc/Desktop/Fintech/apps/web/src/lib/api/decoders.ts:506), [security headers](C:/Users/52duc/Desktop/Fintech/apps/web/next.config.mjs). |
| S15 | [Document worker](C:/Users/52duc/Desktop/Fintech/apps/api/src/documents/document-worker.ts), [dossier worker](C:/Users/52duc/Desktop/Fintech/apps/api/src/documents/dossier-worker.ts), [ZIP reader](C:/Users/52duc/Desktop/Fintech/apps/api/src/documents/document-archive.ts). |
| S16 | [Database service](C:/Users/52duc/Desktop/Fintech/apps/api/src/database/database.service.ts), [migration runner](C:/Users/52duc/Desktop/Fintech/apps/api/src/database/migrate.ts), [migrations](C:/Users/52duc/Desktop/Fintech/apps/api/migrations). |
| S17 | [AI service guide](C:/Users/52duc/Desktop/Fintech/services/ai/README.md), [AI config](C:/Users/52duc/Desktop/Fintech/services/ai/runner/config.py), [AI runner](C:/Users/52duc/Desktop/Fintech/services/ai/runner/app.py). |
| S18 | [Render blueprint](C:/Users/52duc/Desktop/Fintech/render.yaml), [dev launcher](C:/Users/52duc/Desktop/Fintech/scripts/dev-all.cjs), [ignore rules](C:/Users/52duc/Desktop/Fintech/.gitignore). |
| S19 | [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [PostgreSQL PITR](https://www.postgresql.org/docs/current/continuous-archiving.html), [OWASP upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) — truy cập 18/10/2026. |
| S20 | [Gemini API terms](https://ai.google.dev/gemini-api/terms), [retention guidance](https://ai.google.dev/gemini-api/docs/zdr) — truy cập 18/10/2026; cần đối chiếu tài khoản và điều kiện áp dụng thực tế. |
| S21 | [IDEA FINTECH — Google Doc gốc](https://docs.google.com/document/d/1b51lfa8d8Gc32Wk3R6IPJszOgbLw1l6Do3Fa6BehgKU/edit), [bản xuất văn bản private](C:/Users/52duc/AppData/Local/AIC/idea-review-20261018/IDEA-20261018-023011-148.txt:171) — tải trực tiếp 18/10/2026, SHA-256 **B5A252E7AABC5F764B91E165605200F00165C5666C5FFBF4D56A02158B12C773**; phần chốt hiện hành dòng 171–195, BA 201–283. [Trang 11 snapshot](C:/Users/52duc/Desktop/Fintech/docs/AIC_Report_Cleanup_2026-10-16/source/83e0c2f0937d82848f6081a001d0b767.md). Không phải bằng chứng đã thao tác Google Docs bằng UI. |

Không đính kèm raw hồ sơ thật, giá trị .env, credentials, ciphertext backup hoặc screenshots chứa tài liệu khách hàng vào báo cáo này.

### Kiểm tra bàn giao tài liệu

Đã so sánh tracked diff với baseline đầu lượt lập báo cáo: nội dung thay đổi của 14 file có sẵn vẫn giữ nguyên. Báo cáo là file mới, chưa commit/push và không bị Git ignore. Đã kiểm các liên kết local tồn tại; đây là kiểm tra tài liệu, không phải một lần kiểm thử ứng dụng. Không chạy lại build, full regression hoặc UI trong lượt này.

Bản sao dự phòng của báo cáo được giữ tại C:/Users/52duc/AppData/Local/AIC/production-report-20261018, ngoài repository; receipt riêng ghi SHA-256 của hai bản để đối chiếu.
