# Phase 2 — gói quyết định B01–B04

**Cập nhật sau snapshot bên dưới:** Owner đã trực tiếp duyệt B01/B02/B04 cho MVP sandbox, được ghi tại [decision log](MVP-OWNER-DECISIONS.md). Artifact approved tách riêng khỏi draft; B03 public và FHI vẫn chưa duyệt. Các API/local implementation đã phát hành theo bundle0.3.0; xem [báo cáo thực thi](MVP-EXECUTION-REPORT.md). Nội dung “chưa phê duyệt” dưới đây là lịch sử đề xuất, không phải trạng thái hiện tại của sandbox.

17/10/2026, Asia/Saigon. **DRAFT FOR OWNER REVIEW — chưa phê duyệt, chưa kích hoạt.** Lead là writer duy nhất của shared contracts. Các artifact dưới đây nằm trong docs, không được API/worker/registry load. Chưa thêm DTO/SQL production.

## Đã được duyệt, không hỏi lại

| Quyết định trong chat                                                                                | Hiện trạng                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Creator cùng org tự có case membership trong transaction; không org-wide hoặc role mới               | Migration0002; case creation vẫn đóng vì các contract khác                                                                                       |
| Approved/effective policy và version cố định; khác financial method                                  | DB đã immutable version, chưa có approved artifact/registry                                                                                      |
| Session8h, idle30m, HttpOnly/Secure production/SameSite=Lax;5 failures/account-IP trong15m, block15m | Đã triển khai/configurable; **cấu hình kỹ thuật tạm đã được cho phép**, chưa final security policy; socket peer chưa trusted-client-IP qua proxy |
| Chưa chốt claim/conditions; giữ writes đóng, không FHI pilot                                         | Case/exposure/counterparty503; production document/job routes chưa đăng ký                                                                       |

Đối chiếu hẹp với source và Notion snapshot01/02/09/10 trong `apps/web/docs/specification`, contract freeze và Phase1 report. Preparation trước connector404; không audit/fetch toàn bộ lại hoặc tuyên bố đã đọc được thay đổi Notion mới. Invariant kế thừa khác với rule mới ghi **đề xuất** dưới đây.

## Bảng chọn nhanh

| Mục | Khuyến nghị A                                                                  | Thay thế B                                                      | Cần duyệt                                                                           |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| B01 | Artifact/operator registry, explicit scope, reject overlap/no match            | Approval workflow trong app/DB, cần quyền/transitions riêng     | Checklist/waiver từng dòng, approval evidence/authority, scope/effectivity/overlap  |
| B02 | Versioned JSON aggregate + relational source bindings                          | Relational từng condition/claim/verification                    | Semantics và source/verification/null/stale; chọn cách lưu không tự duyệt nghiệp vụ |
| B03 | Ingress kiểm soát, Next/Nest private, strip/rewrite IP và peer allowlist       | Authenticated handoff qua host/trust boundary                   | Topology thực, IP authority, A/B; không blanket trust proxy                         |
| B04 | Response/replay24h, tombstone không thời hạn, không reuse; hourly body cleanup | Response/replay72h, tombstone90ngày, sau purge key có thể reuse | Window/retention/cleanup/reuse cùng guarantee; không chỉ đổi env                    |

## B01 — Policy hồ sơ

**Vấn đề:** một chuỗi policy_version chưa chứng minh policy đã được duyệt và đang có hiệu lực.

Artifact thực để review: [case-policy.draft.json](drafts/case-policy.draft.json), version `AIC-CASE-DRAFT-2026-10-17.1`. `status=draft`, `runtime_eligible=false`, `approval=null`, `effective_from=null`. Ngày hiệu lực **đề xuất nếu được duyệt**:20/10/2026 00:00+07, không có end date; không phải lịch deploy hoặc activation thật.

A đề xuất:

- Core RECEIVABLE/PREPAYMENT, VND, proposed/active, assignment theo organization được chỉ định; không tự áp mọi tenant, không mở auxiliary debt.
- Eligibility: approved + approval evidence + scope khớp + `from <= case.created_at < until`, until có thể null; clock từ DB transaction, UTC instant. Reject overlapping approved assignments; nếu creation vẫn thấy nhiều match thì fail closed, không chọn newest. Không match thì reject, không draft/pilot/default fallback.
- Persist version + approved artifact hash cùng case và creator membership. Không reselect policy cho case cũ. Hash/registry/assignment constraints cần migration sau khi duyệt; chưa có trong Phase1.
- Artifact có7 checklist rows: required identity source; required/nonwaivable financial minimum cho numeric; conditional contract, delivery/acceptance, paid/received, refund/guarantee; optional tax/invoice khi chưa bị một claim/condition kích hoạt. Mỗi row có when/waivable/waiver_scope/missing_behavior.
- Waiver chỉ xử lý thiếu hồ sơ có limitation; không biến identity/payment/condition thành verified. Financial minimum không được waiver thành đủ numeric, identity mismatch không thành kết luận đúng. **Chi tiết classification/activation/waiver scope từng row là đề xuất mới cần duyệt**, không coi Notion đã chốt chúng.

B linh hoạt hơn nhưng cần workflow/quyền/history mới; không tự thêm business role. Policy không phải FHI method: artifact giữ method null, pilot false, không cho numeric khi chưa có method approval riêng.

**Tác động:** FE nhận version từ server, không gửi approved flag. BE registry/resolver; DB immutable artifact/assignments. Chỉ sau B01+B02+B04 và released create DTO mới mở `POST /api/v2/cases`; B01 không tự mở waiver/review/scoring. Document trên case hợp lệ đã có không nhất thiết chờ policy creation mới.

**Owner chọn:** A/B; duyệt/sửa checklist, scope, approval authority/evidence, ngày hiệu lực và overlap/no-match rule. Sau đó phát hành approved artifact riêng; draft không tự thành approved.

## B02 — Exposure/conditions/claims/source

**Vấn đề:** actual có thể chỉ là lời khai; nguồn thiếu khác0. Thay cách lưu không tự định nghĩa quyền xác minh hoặc staleness.

A: core payload versioned JSONB, bindings tới document/version/source/decision quan hệ để có tenant FK; immutable raw payload/source/history tách effective aggregate. B: relational toàn bộ conditions/claims; mạnh query/FK, nhiều migrations/mapping FE hơn. Đây là lựa chọn kỹ thuật; semantics vẫn cần duyệt dù chọn A/B.

[Schema draft](drafts/exposure.schema.draft.json) là **persisted aggregate proposal**, JSON Schema2020-12, chưa là request DTO/API. [Examples](drafts/exposure.examples.draft.json):3 core valid records,1 incomplete claim,14 invalid vectors. `scripts/check-document-drafts.cjs` kiểm self-consistency offline, không là implementation auth/verification.

| Chủ đề         | Quy tắc cụ thể đề xuất, chưa áp dụng                                                                                                                                                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle      | Giữ FE `lifecycle_stage=proposed                                                                                                                                                                                                                                                                                                                          | active`. `claim.event_state=proposed | actual` riêng: actual nghĩa claimant nói sự kiện đã xảy ra, **không nghĩa verified**. Proposed không có occurred date/verification hoặc realized amount. Không tự chuyển case active từ extraction. |
| Direction      | RECEIVABLE org seller/counterparty buyer, payer=counterparty/payee=org; PREPAYMENT ngược lại. Paid do payer khai, received do payee khai. Third-party payments chưa thuộc core draft: giữ raw/source+limitation, không ép map người thứ ba thành counterparty.                                                                                            |
| Currency/money | VND, exposure positive integer string≤24digits; claim amount nonnegative string≤24digits hoặc null+missing/unreadable/conflicting+reason. Không float/FX. Không cộng paid+received observations của cùng event, không tự tính net outstanding; settlement matching riêng.                                                                                 |
| Date/term      | ISO calendar date; actual unknown date có reason. Không dự báo due date từ OCR. Term null bắt buộc `not_agreed                                                                                                                                                                                                                                            | source_missing                       | ambiguous`; term numeric≥0 thì reason=null. Missing date không tự là overdue, null không là0.                                                                                                       |
| Condition      | kind payment/delivery/acceptance/refund/guarantee/other; scope/trigger_text/due_on; reported_state proposed/reported_satisfied/unknown. Unknown cần reason; reported_satisfied cần source, chưa phải human verified.                                                                                                                                      |
| Source         | Mỗi paid/received claim cần≥1 exact document/version/hash binding. Org/case/counterparty scope server-bound phải khớp; evidence thuộc exact source. Counterparty_id ở binding là assessed party của case, không giả mọi source do counterparty phát hành. Document còn owner_party_ref/issuer role riêng.                                                 |
| Verification   | State proposal unverified/verified/rejected tách origin/event_state; AI chỉ candidate. Actor/time/source_revision/reason do server cấp. Client/AI không tự gửi verified. Chưa implement/release human decision transitions.                                                                                                                               |
| Stale          | Edit exposure/claim/verification tạo revision+audit. Dependency snapshot ghi exact source version/hash, effective inputs, policy/method. Thay dependency/replace source làm derived results stale, giữ historical raw/decision; waiver/confidence không verified. Unrelated optional data chỉ ảnh hưởng khi thay declared dependency/checklist inventory. |

Valid incomplete: proposed receivable100M chưa term/contract, reason=not_agreed, claims=[]; vẫn review limitations, không giả obligation. Prepayment25M paid actual10M có source nhưng unverified; chưa thành verified settlement. Actual received amount/date unreadable: null+reasons, không là0 hoặc proof nonpayment. Invalid: role sai, numeric money, null-term thiếu reason, foreign org/case, paid không source, verified thiếu server decision,30/02, unknown field.

**Tác động:** FE cần versioned decoder/forms sau release; hiện conditions opaque/read-only giữ nguyên. Input projection loại org/case/actor/verification server fields; editable payload+expected revision+source IDs được resolve server-side. Schema full record không được nhận nguyên từ client. DB source FKs/immutable revisions/decision bindings chưa migrate. B01/B02/B04+DTO mới mở case/exposure writes; counterparty identity/source/invalidation chốt riêng trước create/update. Document source slice có thể được duyệt riêng, không phải chờ scoring/claim workflows.

**Owner chọn:** A/B storage; duyệt/sửa từng rule trong bảng, enum/nullability/source/verification/invalidation. Chọn JSONB không tự phê duyệt nghĩa paid/received.

## B03 — Ingress/client-IP

**Source hiện có:** Next route chỉ forward allowlist không có Forwarded/XFF/client-IP; Nest listen127.0.0.1, dùng socket peer. Backend URL cần `/api/v2`, public origin configurable. Chưa có deployment/ingress config cho Next/Nest. `render.yaml` chỉ là AI web blueprint có internal key/test console; không chứng minh cloud runtime hoặc private AI, không sửa nó ở đây.

A đề xuất cho operator review: **Browser HTTPS443 → ingress duy nhất → private Next3000 → private Nest3001 → private AI8100**, DB/storage private; một host/private namespace hoặc private network được kiểm soát. Không public ports3000/3001/8100; giữ same-origin Next proxy.

1. Ingress xác định IP từ socket hoặc documented trusted upstream; strip client Forwarded/XFF/X-Real-IP/X-AIC-Client-IP rồi ghi một canonical private IP header.
2. Next chỉ nhận ingress qua peer/network isolation, forward đúng private header. Không tin XFF browser. Đây là FE transport change cần release riêng, chưa code.
3. Nest `trust proxy=false`, custom resolver chỉ nhận header khi socket peer thuộc exact designated Next allowlist. Missing/invalid context trong trusted production mode fail closed, không fallback socket gộp bucket. Loopback không tự chứng minh process identity; operator phải xác nhận host/network isolation.
4. Hash account+trustedIP cho throttle; không đổi session/Origin/CSRF hoặc giá trị tạm đã duyệt.

B nếu cross-host/peer isolation không đủ: authenticated handoff Next→Nest bằng mTLS hoặc HMAC-SHA256. HMAC proposal bind method+canonical path/query+exact body digest+IP+timestamp+nonce; timestamp allowance30s, anti-replay nonce60s, key rotation có overlap. Chưa chọn format/runtime/key store hoặc thêm config. Chữ ký IP giả không chữa ingress sai.

**Thiếu môi trường:** nơi host từng service, TLS termination, CDN/LB/header authority, exact peer/CIDR/network policy, key management/operator/process isolation. Port reference không phải assertion deployment hiện có.

**Acceptance:** actual proxy clientA/B khácIP cùng account, A vượt throttle không khóa B; forged/multiple forwarding/private headers không bypass; public Nest không truy cập được; missing context reject; signed expiry/replay/body mismatch nếu B; HTTPS secure cookie/Origin. Direct API tests không phải proxy acceptance.

**Owner chọn:** topology thật+A/B; không hỏi lại8h/30m/throttle. B03 mở gate public/staging auth/transport, không tự mở business mutations; không cần business migration.

## B04 — Idempotency/retention

**Hiện có:** case primitive scope org/actor/operation/case, canonical request hash; current session/ACL recheck sau lock trước replay; expired409, không cleanup/reuse. TTL config explicit chưa có production value. Chưa có in-flight/tombstone/body-pruning schema.

A cụ thể đề xuất:

- Replay window và full response retention **24h từ commit**, không sliding. Exact replay trả frozen status/body, không body job hiện tại.
- Sau24h cùng key409 `IDEMPOTENCY_CONFLICT`, không re-execute. Cleanup body hourly sau approval, skip record còn in-flight/reference chưa ổn định; cleanup failure giữ record/fail closed, không xóa audit/document/source.
- Tombstone tối thiểu: scoped key digest, request fingerprint, operation/subject và commit/expiry metadata; **không thời hạn, không automatic purge, không reuse trong scope**. Có chi phí/linkable metadata, owner phải duyệt; không còn retention chưa xác định trong lựa chọn A. Không giữ raw payload/full response trong tombstone.
- Unique in-flight reservation; exact concurrent request chờ có budget hoặc409 same conflict code/details reason=in_progress (details proposal). Không sinh thêm document/job. Pending intent không expire thành quyền chạy lại khi storage/DB outcome chưa reconciled.
- Current auth/Origin/CSRF/ACL trước frozen replay; exact replay trước revision check. Pre-accept validation errors/rollback không cache successful replay. Ambiguous commit phải lookup/reconcile trước side effect. Accepted202 rồi AI failed vẫn cùng frozen upload outcome; retry worker là command khác.

B: replay/body72h, tombstone90ngày, hourly body cleanup/daily tombstone purge; sau90ngày key có thể reuse và late retry có thể tạo side effect lại. Guarantee giới hạn retention; owner phải chấp nhận rủi ro hoặc sửa con số. Không áp A+B cùng lúc. Env là cách cấu hình, không có thẩm quyền rút guarantee đã cam kết cho record cũ.

| Operation proposal                   | Scope/fingerprint bổ sung                                                                                                                                         | Frozen result / gap                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| case.create                          | org/actor/op/key; counterparty+validated exposure+policy selection input; chưa có case ID                                                                         | 201 exact Case/version; cần org mutation primitive mới, không ép dùng existing case-only helper                                                              |
| exposure.update                      | org/actor/op/case/key; expected revision+validated payload+exact source IDs/versions                                                                              | 200 exact case/revision; source validation trong TX                                                                                                          |
| counterparty.create/update           | org/actor/op/subject-or-create/key; own revision khi update+identity/source input                                                                                 | 201/200 snapshot; related-case invalidation chưa chốt                                                                                                        |
| document.upload.new/replace/response | org/actor/op/case/key; expected revision+type/source_class+owner+mode+target lineage/version hoặc approved request ID/revision+SHA256/size+persisted display name | 202 exact Document/Job/accepted revision. Boundary/MIME transport/cookie/CSRF không fingerprint; đổi semantic metadata hoặc persisted filename phải conflict |
| job.retry                            | org/actor/op/case/job/key; expected case/job revision+retry command                                                                                               | 202 exact newly created attempt outcome; public replay không thay lease fencing                                                                              |

Canonical JSON giữ null/absence/array order/string money, stable key sort. Multipart hash exact bytes riêng, không raw boundary; source IDs/revision/metadata validate trước hashing. Algorithm/version/vectors cần freeze trước route. Body hiện NOTNULL trong DB nên proposal pruning cần migration; chưa triển khai cleanup.

**Tác động:** FE giữ key cho unchanged retry, đổi key khi edit; expired conflict cần outcome/reconciliation, không tự tạo key mới để replay write. BE/DB cần intent/unique/tombstone/pruning. Owner duyệt A/B hoặc số khác cùng retention/cleanup/reuse, operation/result semantics. B04 chưa đủ tự mở route khi source/job/case contracts khác còn thiếu.

## Document release gate

[DOCUMENT-SLICE-CONTRACT-DRAFT.md](DOCUMENT-SLICE-CONTRACT-DRAFT.md) tập trung upload/storage/TX/job/lease/AI/publication cùng acceptance từng invariant. Pure integrity/raw capture có thể code độc lập. Concrete writes/publication chỉ sau owner freeze subset contracts liên quan. Không phải chờ FHI method hoặc toàn bộ claims để release một document slice nhỏ đã được duyệt.
