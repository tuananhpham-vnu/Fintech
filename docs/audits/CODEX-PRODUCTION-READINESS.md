# AIC Rating 2.0 — Independent Production Readiness Audit

**Ngày:** 16/10/2026, Asia/Saigon (UTC+7). **Auditor:** Codex, Principal Backend Engineer / Technical Lead. **Phạm vi:** AUDIT ONLY.

**Kết luận: NO-GO cho production/public upload và dữ liệu thật. GO có điều kiện cho tiếp tục phát triển từ prototype hiện có sau khi owner duyệt kế hoạch.** HTTP transport khả thi; chưa có production authentication, tenant/case authorization, persistence, immutable evidence hoặc async publication invariants đạt yêu cầu.

Có thể giữ khung của **12/15 file TypeScript backend hiện có (80% theo số file)**: 1 KEEP và 11 EXTEND; 3 file REPLACE. Đây là phép đếm khả năng kế thừa cấu trúc, **không phải 80% backend production đã hoàn thành**, không phải tỷ lệ dòng code giữ nguyên hoặc ước lượng công sức. Các workflow quan trọng hiện chưa tồn tại. Không cần xây lại toàn bộ NestJS hoặc FastAPI.

## 1. Phạm vi, nguồn và cách kiểm chứng

### 1.1. Workspace được audit

- Workspace: `C:\Users\52duc\Desktop\Fintech`, branch local **`duc`**.
- HEAD: `8b0b7ed9e983ba4a2ea4d43f79d1816eaad7dbf0`. Backend/web/docs phần lớn **untracked**, nên HEAD không đại diện đầy đủ snapshot được audit.
- Trạng thái tracked lúc bắt đầu: `.gitignore`, `README.md`, `apps/README.md` đã modified. Giữ nguyên thay đổi của người dùng; không checkout/reset/stage/commit/push/deploy.
- Đã đọc README gốc, `apps/web/AGENTS.md`, các README trong vùng audit; không tìm thấy AGENTS khác trong cây repository hoặc các đường dẫn ancestor đã kiểm tra.
- Đã đọc đủ bảy tài liệu bàn giao được yêu cầu: `FE-BE-AI-FEASIBILITY.md`, `CODEX-BACKEND-HANDOFF.md`, `PARALLEL-AGENT-EXECUTION.md`, ba `subagent-*-report.md`, `apps/api/README.md`.
- Đã kiểm toàn bộ 15 file `apps/api/src/**/*.ts`, bootstrap/package/workspace/config; kiểm frontend transport, proxy, decoders, consumer types, upload/evidence và các feature API; kiểm runner/backends/contracts/guards, extraction/storage/PDF, evaluator/normalization/linking và regression AI; kiểm bundle contracts, E2E script, synthetic fixtures và HTTP collection.
- Một file nguồn thiết yếu đang bị ignore: `.gitignore:30` có `storage/`, khiến **`apps/api/src/storage/storage.service.ts` không được Git liệt kê mặc định**. Đã đọc file này bằng đường dẫn trực tiếp và đưa vào số 15 file.

Fingerprint bổ sung cho snapshot local (không phải chữ ký release):

| Artifact | SHA-256 |
| --- | --- |
| `scripts/test-e2e-feasibility.cjs` | `f9a1531a91a4384308e72b37b276bc1c1b842a3b6d9cebc3522eca0686cd6a90` |
| Aggregate 15 file API TS | `3bc4969cc335748f7204e988044e5db7cda2555b8b4b886cf8d2f33ae5b723c9` |

Aggregate: sắp xếp path từ root bằng JavaScript `.sort()`, mỗi dòng là `path-with-forward-slashes + NUL + sha256(file)`, nối bằng LF, hash UTF-8 toàn chuỗi.

### 1.2. Notion đọc trực tiếp và thẩm quyền nguồn

Đọc trực tiếp trang master và toàn bộ chín trang được chỉ định, không chỉ dùng bản chép trong repository. Nguồn đều mang baseline AIC Rating 2.0.0 / CR-AIC-01 / METHOD-SYNC-01 ngày 16/10/2026; fetched pages không có thông báo truncated/unknown blocks trong kết quả nhận được. Trạng thái Notion `unverified` không được hiểu là BA approval hoặc nghiệm thu runtime.

| Nguồn | Nội dung dùng để đối chiếu |
| --- | --- |
| [00 — Master](https://app.notion.com/p/1790c2f0937d8344bc9781bc9b4efd32) | Phạm vi và phân quyền sở hữu đặc tả |
| [01 — Contracts & Data Model](https://app.notion.com/p/b940c2f0937d83f48e5b01d233063b85) | Organization khác counterparty, role, nguồn và snapshot |
| [02 — Rulebook](https://app.notion.com/p/e680c2f0937d8364bf9e818fed4ee4a6) | Workflow, waiver, review, revision và quota demo |
| [04 — Architecture](https://app.notion.com/p/a610c2f0937d83a7b753018a43729539) | NestJS API/worker, private AI, sole DB writer |
| [06 — Security](https://app.notion.com/p/d170c2f0937d837b9fcf01de41335f03) | Session/ACL/source/resource controls và negative tests |
| [08 — Database Design](https://app.notion.com/p/d390c2f0937d8381b34b01f3a4ab41bf) | Draft PostgreSQL, tenant constraints, TX, idempotency, lease |
| [09 — API](https://app.notion.com/p/4220c2f0937d8376beaa0142a0e2e425) | Catalogue, statuses, guard order, replay và publication |
| [10 — DTO](https://app.notion.com/p/ef40c2f0937d839a8799814ce182e69f) | Required/null/union, provenance, financial/source mapping |
| [12 — Frontend Integration](https://app.notion.com/p/9cd0c2f0937d82499c448102014376f1) | Consumer conventions và pending writes |
| [13 — Methodology](https://app.notion.com/p/bf10c2f0937d832d936281ed21fe903f) | FHI gates, scope, approval và độc lập Transaction Review |

Các câu Notion/README còn nói “chưa có apps/api” đã lạc hậu so với workspace local có prototype. Điều đó không biến draft API/DTO/DB thành contract đã phát hành. Trang 08 rõ ràng là **thiết kế draft, chưa có DDL executable được nghiệm thu**; không được chạy migration chỉ dựa trên danh sách bảng trong báo cáo Gemini.

### 1.3. Ranh giới thực nghiệm

- Chạy lại test nguyên trạng; không sửa assertion, test, frontend, AI service, database schema, contracts hoặc business rules.
- Node `v24.12.0`, pnpm `11.22.0`; Python venv dùng Python 3.12 theo traceback. Dùng dependency đã cài; không install/upgrade package.
- Next.js `:3000` và FastAPI `:8100` có sẵn. Health AI xác nhận **`mode=mock`**. Khởi động NestJS từ build mới ở `:3001`, dùng storage riêng trong TEMP, rồi chạy đúng E2E script từ repo root.
- Khởi động thêm FastAPI **live** riêng `127.0.0.1:18100`, console tắt, provider key/model để rỗng, storage chỉ tới synthetic fixtures. Không gọi provider bên ngoài hoặc dùng hồ sơ thật.
- Probe authorization/concurrency/unsafe upstream dùng NestJS process riêng, port động, dữ liệu RAM synthetic có tenant thứ hai và các dependency stub nêu rõ ở mục 3. Đây là fault injection có kiểm soát, không phải truy cập tenant thật hay chứng minh đã có DB đa tenant.
- Build/typegen/tests sinh cache, `dist`, assets và báo cáo máy theo toolchain hiện có; **file nội dung duy nhất do audit tạo là báo cáo này**. Không tạo bộ test mới trong repository.
- Browser interaction E2E và deploy thực tế: **NOT RUN**. `check:qa` harness frontend riêng: **NOT RUN**, không dùng harness RAM để nghiệm thu NestJS.

## 2. Verified current state

### 2.1. Kết quả chạy lại

| Lệnh / kiểm chứng | CWD | Actual | Kết luận giới hạn |
| --- | --- | --- | --- |
| `pnpm --filter @fintech/api build` | root | Exit 0, `tsc -p tsconfig.json` | PASS compile backend; không phải test authorization |
| `pnpm typecheck` | root | Exit 0, Next typegen + tsc | PASS frontend; root command không typecheck backend |
| `pnpm lint` | root | Boundaries PASS; Prettier PASS | 94 runtime files, 10 modules; không có ESLint trong pipeline này |
| `pnpm test` | root | Exit 0; 10 unit PASS, 18 integration checks PASS | Frontend consumer/proxy; không phải 18 DB/NestJS tests |
| `pnpm build` | root | Exit 0, Next.js 16.4.0 production bundle | PASS; không chứng minh click-through/browser |
| `node scripts/test-e2e-feasibility.cjs` | root | **25/25 log PASS**, exit 0 | HTTP feasibility với AI mock; script có các blind spots bên dưới |
| `..\..\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider` | `services/ai` | **361 passed, 1 failed, 4 skipped**, exit 1 | AI suite chưa xanh |
| Instantiate `runner.contracts.Contracts` | root / AI import path | Integrity, schema validation OK; 52 definitions | Bundle **1.0.2** còn hợp lệ, chưa phải public AIC2 |
| Live inspect HTTP `:18100` | riêng | Valid 200/live; wrong hash/path 422; missing key 403; corrupted PDF 422 | PDF inspection thật tồn tại và dùng được độc lập |

Lần đầu gọi pytest từ root nhận `360 passed, 2 failed, 4 skipped`: thêm một lỗi relative path `evaluation/adversarial-expected.json` trong `test_rules.py:245`. Chạy lại từ CWD README yêu cầu (`services/ai`) loại bỏ lỗi CWD, còn một fail thực tế. Không sửa file để đạt kết quả này.

Fail còn lại: `services/ai/tests/test_extraction.py:287` mong provenance `prompt_version=extraction-v1`, code `extraction/extractor.py:31` phát `extraction-v2`. Các assertion field/evidence trước đó của ca này chạy qua. Bằng chứng ủng hộ **stale assertion**; không đủ để kết luận live extraction production đã được kiểm định. Số chạy lại là **361 pass**, khác con số 360 trong bàn giao; không ép số cho khớp báo cáo cũ. Bốn test skipped không được tính PASS.

### 2.2. Đã có gì thật, phần nào là prototype

| Năng lực | Trạng thái đã xác minh |
| --- | --- |
| HTTP Next → Nest → FastAPI | Chạy thật; multipart, cookie và binary đi qua thật |
| SessionAuthGuard | Global APP_GUARD thật; missing/invalid/expired session bị chặn; không có case ACL |
| Identity/login | Prototype: mọi credential truthy tạo cùng user/org specialist seed |
| Case/counterparty detail | Seed RAM; list không thực thi cursor/limit hoặc tenant filter |
| Readiness | Seed `unconfigured`, numeric false; không phải policy engine |
| History | Endpoint thật nhưng luôn `items: []`; không có audit persistence |
| Upload/source | Ghi/đọc file local thật, dùng Buffer/sync I/O; chưa immutable storage |
| Inspect trong E2E 25 test | **Mock manifest lookup**, không parse staging PDF |
| Inspect ở live probe riêng | **PyMuPDF thật**, SHA-256/path kiểm thật |
| Extract trong E2E | Gold fixture; mock khớp `document_id + case_id + sha256` |
| Live extraction arbitrary PDF | Code có; probe provider-disabled trả 503; provider-backed end-to-end **NOT RUN** |
| Evidence adapter | Có rename `evidence_ids → evidence_refs` và evidence lookup 200; còn mất provenance/diagnostics/mode, thiếu backend source validation |
| Jobs | RAM status, inspect/extract tuần tự trong request rồi trả 202; chưa queue/worker |
| PostgreSQL/TX/lease/outbox | Chưa có implementation trong backend |
| Review/decisions/waiver/request/export/questionnaire/assessment | Chưa có backend nghiệp vụ tương ứng; UI/API consumer không chứng minh đã triển khai |
| FHI | Không có engine backend; policy giữ unconfigured; assessment null |

### 2.3. Vì sao 25/25 PASS chưa đủ

- Test 4 chỉ đòi HTTP 202 + document/job IDs; không tự yêu cầu job completed. Test 6 chỉ kiểm array, không kiểm oracle 7 field hoặc source ownership. Test 7 chỉ kiểm job ID, không assert state completed.
- Test 10–11 trực tiếp instantiate `AiClientService`, dùng port đóng hoặc stub response; đây là client tests trong cùng script, không phải 25 luồng HTTP ba tầng độc lập.
- Test 12 chỉ kiểm HTTP 200 và chuỗi `<!DOCTYPE html>`; không kiểm client hydration, upload dialog, PDF viewer hoặc sáu tab.
- Test 13 hiện lỗi ngay ở **mock inspect**, dù tên test nói extract/UI error handling. Actual job lỗi `INSPECTION_FAILED`; không có browser assertion.
- Test 15–16 đi qua Next proxy; PASS không chứng minh NestJS tự kiểm Origin/CSRF cho mọi mutation.
- Test 17 chỉ so status/doc ID; không assert revision, job count, audit count, response bytes, actor scope hoặc concurrency. Fixture ID cố định khiến kiểm doc ID càng yếu.
- Test 18 hardcode **400 `IDEMPOTENCY_MISMATCH`**, lệch yêu cầu hiện hành **409 `IDEMPOTENCY_CONFLICT`** tại Notion09 §6/§8 và Notion08.
- Test 24 có tên jobs/evidence nhưng code chỉ fetch **job**, không fetch evidence. Probe audit riêng mới kiểm evidence 200 và authorization gap.
- Test 25 dùng một cookie không tồn tại. Đây là invalid-session test; không có hai tenant/case memberships hợp lệ.
- Test 20 chỉ xác nhận seed readiness + assessment null; chưa có POST assessment để chứng minh 422 gate, scope hoặc verification guards.
- Script ghi RESULTS/console, kết thúc bằng `run()` (`:1031`), **không set exit code khi có FAIL/BLOCKED** và không có tổng kiểm bắt buộc 25. Exit 0 không đủ làm CI gate. Audit đã đọc từng kết quả PASS, không chỉ dựa exit code.

## 3. Findings và blocker có bằng chứng

Priority ở đây là mức chặn phát hành, không khẳng định hệ thống hiện đã bị khai thác. Mỗi probe dùng synthetic và không in credential/session/token vào báo cáo.

### PR-01 — P0: Authentication chỉ là fixture, không được cô lập khỏi production

**Evidence:** `apps/api/src/controllers/auth.controller.ts:28–46`, `state/in-memory-db.service.ts:225–239`, `config/configuration.ts:33`.

Login chỉ kiểm `!username || !password`, không kiểm tài khoản hoặc password hash; `createSession` luôn cấp USER_ID/ORG_ID seed. HTTP probe AU01 dùng username không tồn tại, password sai và Origin ngoại lai vẫn nhận **200 specialist**. Không có flag test-only hoặc startup gate cấm auth prototype khi production. Production config chỉ cấm default internal key, không chặn demo auth.

Cookie có HttpOnly/SameSite=Lax nhưng không Secure. Tên cookie, TTL hardcode trong guard/controller/DB; cấu hình `cookieName` không được sử dụng ở các nơi này. Có expiry và server-side logout RAM, nhưng không store bền vững, account disable/revocation policy, login rate limit hoặc hashing. Opaque session token không bắt buộc phải là JWT/có chữ ký; vấn đề là xác thực principal, hash/store/revoke/expiry và transport, không phải thiếu JWT.

**Trước release:** auth thật, secure cookie policy thống nhất, hashed session tokens, finite login limits, fail-closed test-only isolation, tests missing/invalid/expired/revoked/disabled và logout semantics.

### PR-02 — P0: Không có organization/case authorization; replay cũng rò dữ liệu

**Evidence:** `CasesController:37/45/57/69/117`, `CounterpartiesController:8/16`, `DocumentsController:21/45`, `JobsController:8`, `EvidenceController:8`; `SessionAuthGuard` chỉ lấy session và gắn req.user/session.

Không controller nào dùng principal để resolve resource scope; documents/jobs/evidence không có đường ownership được kiểm tới case membership. Không có membership model/service trong backend.

**HTTP probe ACL01:** khởi tạo AppModule thật với cookie parser/global guard, port động; trong fixture RAM đổi case PREPAYMENT và counterparty sang org B, thêm document/job/evidence synthetic B. Session hợp lệ org A nhận **200** cho list, foreign case/detail/readiness/history, foreign counterparty, **PDF bytes**, extraction, job và evidence. Expected outsider là **404**, không metadata. Probe ACL02 thêm session hợp lệ B vào session store rồi replay key của case A: **202, trả đúng document A**.

Fixture injection chỉ tạo điều kiện đa tenant mà seed hiện chưa có; request vẫn đi qua session guard và controller thật. Thiếu case membership được chứng minh bằng source; chưa có cơ chế để nghiệm thu same-org non-member. Không được ghi PASS isolation từ test cookie giả.

**Trước release:** session principal → organization + case membership → resource/nested reference, list filtering, current ACL trước replay. Test 2 org, 2 users trong cùng org nhưng khác case, direct IDs và nested IDs, positive control, revoked membership, PDF/export/replay không lộ payload.

### PR-03 — P1: Origin/CSRF không đồng bộ ở authoritative backend

**Evidence:** `apps/api/src/main.ts:15`, `AuthController:23/66`, `CasesController:97–113`; Next proxy `apps/web/src/app/api/v2/[...path]/route.ts`.

NestJS CORS không reject mutation ngoại Origin. CS01/CS02 upload direct với missing/wrong CSRF nhận **403 CSRF_REQUIRED/CSRF_MISMATCH**: phần vá upload có hiệu lực. Nhưng CS03 foreign Origin + valid CSRF + **không idempotency key** vẫn **202/job failed**. CS04 logout thiếu CSRF, foreign Origin vẫn **204**, và logout session đã revoke trả **401** vì global guard; Notion09 §8 yêu cầu cùng Origin vẫn 204 khi expired/revoked, active logout kiểm CSRF.

**Trước release:** backend guard order và auth-specific exceptions theo contract; không dựa riêng Next proxy. Không suy CORS là authorization. Giữ session model đã chốt, không tự chuyển JWT để né semantics.

### PR-04 — P1: Idempotency sai status, scope, fingerprint và in-flight behavior

**Evidence:** `CasesController:147–169/241/304`, `InMemoryDbService:311–321`, E2E `:780`.

1. Actual conflict khác hash/case = **400 IDEMPOTENCY_MISMATCH**; contract hiện hành = **409 IDEMPOTENCY_CONFLICT**. Test18 đang xác nhận lỗi contract này. Audit không sửa test hoặc code.
2. Header không bắt buộc ở NestJS; Map chỉ keyed bằng raw key, không organization/actor/operation; record không expiry/status/transaction.
3. Fingerprint chỉ caseId + file SHA; không gồm type, source_class, mode, replace/response target, revision và metadata có ý nghĩa. Probe ID01 cùng key/file đổi `contract → invoice` vẫn **202 cached contract**. Không được gọi đây là same payload.
4. Record chỉ tạo sau await AI. Probe ID02 giữ inspect bằng promise, gửi request đầu rồi request thứ hai cùng key với revision mới đọc trong lúc request đầu đang chạy; **202/202, hai document IDs, revision tăng 2**. Đây là refreshed-payload/in-flight gap có kiểm soát. Với hai request cùng expected revision trên process hiện tại, đoạn check+bump đồng bộ có thể chặn request thứ hai bằng 409; không khẳng định mọi concurrent request hiện đều double-write như mô tả Gemini.
5. ACL chưa kiểm trước replay; response giữ tham chiếu object RAM thay vì frozen response. Không có persistence/restart hoặc multi-process guarantee.

**Trước release:** freeze scope/canonical multipart hash, in-flight ownership, expiry/replay semantics; unique constraint/transaction trên DB; auth+ACL trước replay, revision sau exact replay lookup; atomic result + response + audit. Retry cùng ý định giữ key, payload khác phải conflict; thao tác mới dùng key mới.

### PR-05 — P0: Chưa có DB hoặc transaction invariants

**Evidence:** `state/in-memory-db.service.ts`, dependency list, `app.module.ts`, `CasesController:188–216`, history `:69–79`; Notion08.

Toàn bộ session/case/document/evidence/job/idempotency ở RAM. File ghi trước document/job/revision, không transaction/rollback/audit; restart mất metadata nhưng còn file. Không có composite tenant FKs, row locks/CAS, active-lineage/job constraints, atomic audit, lease fencing hoặc current-result publication. History rỗng không phải audit trail.

Notion08 còn mở column nullability/CHECK/defaults, precision/scale financial facts, relational-vs-JSONB, stale derivation, lock order/index và active-job constraints. **Không chọn schema/ORM và migrate ngay từ handoff.** Danh sách tám bảng Gemini không đủ; Notion còn sessions, memberships, review/runs/issues/decisions/requests, waiver, method/assessment, questionnaire/response/verification/invitation và idempotency. Evidence có thể embedded trong immutable payload theo draft; không tự bắt buộc bảng Evidence riêng.

### PR-06 — P0: Source/evidence chưa immutable, upload semantics chưa được thực thi

**Evidence:** `storage/storage.service.ts:33–75`, `DocumentsController:21–41`, `CasesController:171–222/269–280`, frontend upload schema.

- `fs.writeFileSync` dùng cùng storage key có thể overwrite. Probe ST01 save cùng doc ID hai buffer khác nhau: lần hai thành công, getFile trả hash mới. `/source` đọc theo ID không kiểm stored bytes với doc.hash/version; frontend viewer có hash check, nhưng đó không thay backend integrity.
- Fixture hash → fixed document ID trong gold case không có test-mode gate. Upload lại khác key có thể thêm nhiều inventory records cùng ID/version=1, đổi lineage, overwrite Map/file/evidence. Cần giữ fixture compatibility trong test adapter riêng, không dùng identity fixture cho production.
- `mode`, `source_class`, `replaces_document_id`, `response_request_id` frontend gửi chưa được controller xử lý. Mọi upload thành new lineage/version1; không replace lineage hoặc bind request, không validate nested references.
- `owner_party_ref = c.counterparty_id` cho mọi document. Không thể xử lý tài liệu nhiều chủ thể/role; nhưng **không được sửa mặc định sang organization_id** như Gemini đề xuất: tenant SME không mặc định là borrower, đối tác mới là subject được đánh giá. Phải dựa entity/party role/source và giữ unknown/mismatch.
- Multer `FileInterceptor('file')` không cấu hình parser limits; kiểm 10MiB sau khi buffer đã được nhận. Không quota 10 trang/file, 10 file/40 trang active/case; encrypted/embedded inspection flags chỉ log, không reject. Declared type mặc định contract, không runtime DTO validation; detected_type/classification_confident bị bỏ qua và doc tự `ready` sau extract.
- Storage confinement regex chặn traversal đã thử; chưa kiểm realpath/symlink ở backend local. Không khẳng định đã exploit symlink. Source serving là Buffer `res.send`, **không phải streaming**.

**Fault injection AI01:** stub upstream trả inspection 11 trang/encrypted/embedded/hash sai và extraction sai case/doc/hash/detected type, classification false; HTTP upload vẫn **202/document ready, pages=11**. Đây là kiểm backend guard với upstream bất thường, không cáo buộc FastAPI live thật đã phát output đó.

**Trước release:** inspect/reject trước accept theo Notion09, recheck quota/revision dưới lock, immutable storage key/version/hash, source verification, safe streaming, read-only AI access và atomic document/job/audit publication. Extraction thất bại sau accept vẫn giữ inventory; không xóa hồ sơ hoặc bịa facts.

### PR-07 — P1: AI adapter chỉ tương thích một phần, có lỗi error envelope và mất provenance

**Evidence:** `AiClientService:97–118/171–186`, `CasesController:257–280`; `services/ai/runner/errors.py:25`; schemas 1.0.2.

- AI lỗi theo **`{error:{code,message,request_id,details:[...]}}`**; client đọc `body.code/message/details`. Do đó `PROVIDER_UNAVAILABLE`, `SHA256_MISMATCH`, `PDF_INVALID`... mất mã/nội dung/details, bị thay `INSPECTION_FAILED`/`EXTRACTION_FAILED`. Có thể thấy ngay ở E2E13. Cần adapter explicit, giữ correlation được phép; public AIC error lại là flat envelope, không forward nhầm nested shape.
- Inspect chỉ kiểm typeof page_count/sha256/encrypted; extraction chỉ kiểm fields array. AI02 trả `{page_count:-1,sha256:'not-a-hash',encrypted:false}` vẫn được client nhận. AI03 chỉ `{fields:[]}` cũng được nhận. Không validate schema version/required fields/range/echo IDs/hash/registry/evidence relation trước persist.
- FastAPI có strict schema/integrity và semantic guards riêng; cần giữ. Backend vẫn phải tự kiểm input-snapshot/resource/source trước persist/publication, không gắn hash request vào evidence để che upstream mismatch.
- Rename evidence refs có giá trị, EV01 lookup bằng ref đã trả 200. Nhưng spread giữ cả legacy và new keys; fallback `[]` có thể giấu thiếu field. Chỉ lưu fields/evidence, bỏ pages/provenance/diagnostics/mode/actual classification; mất model/prompt/OCR/schema trace và nhãn **MOCK**. `ready` từ gold dễ bị UI trình bày như extraction thường.
- Doc types AIC frontend có 12, internal 1.0.2 có 8. `tax_report`, `delivery_record`, `collateral_document`, `debt_instrument` chưa có mapping/capability tương ứng. Không map bừa `other` để bỏ qua semantics.
- Registry finance 1.0.2 chỉ có borrower identity, period/scope/unit, assets/liabilities/equity/currency; chưa đủ current/quick assets, interest-bearing debt, EBIT/EBITDA bridge, interest/revenue/CFO cho FHI. R01/R02/R08/R09/R10 loan-oriented evaluator không tự thành AIC transaction/FHI engine.
- Client có timeout 30s/call; proxy 85s; service extraction budget mặc định 240s. Chưa có deadline/call/attempt budget chung, retry ownership, fencing/cancellation; không thêm retry ở mọi tầng tùy ý.

**Trước release:** versioned adapter matrix, strict input/output schemas và semantic source checks, explicit unsupported states, lossless immutable raw AI output/provenance/diagnostics, public projections có mode rõ. Giữ service/bundle1.0.2 cho consumer cũ; chỉ phát hành phiên bản mới khi mapping/schema cần thay đổi.

### PR-08 — P1: Async jobs và business workflows còn thiếu

**Evidence:** upload await inspect rồi await extract, không queue provider/worker process; sáu controller chỉ có 14 route handlers hiện có (auth3, counterparties2, cases5, documents2, jobs1, evidence1).

202 hiện trả sau xử lý AI; không durable enqueue, claim/lease/fencing, bounded retry endpoint, dedup active job, cancellation hoặc late-result gate. Case revision kiểm ở đầu request, không recheck dependencies trước ghi kết quả/current pointer. Không có frozen snapshot/history cho extraction/review/assessment.

Chưa có CRUD write counterparty/case/exposure, corrections/classification, review/issue decisions, waiver/revoke, requests approve/cancel/export, questionnaire/staff response/verification/invitation/respondent hoặc assessment/acknowledgement. Chín nhóm UI pending không phải toàn bộ backlog; một số feature API đã gửi request nhưng backend còn 404.

**Trước release từng luồng:** implement state machines theo Notion, atomic reason+actor+revision+audit, immutable approved export và dependency-based freshness. Waiver giữ finding/flag, không verified; resolve cần current completed evidence, partial/stale không đủ; draft request edit và cancel không bị bắt current-run guard sai. Không thêm role nội bộ thứ hai hoặc tự gửi email/link.

### PR-09 — P1: Financial method gates mới chỉ là seed, numeric release vẫn BLOCKED

**Evidence:** readiness seed và `assessment:null`; chưa có method registry, financial facts, assessment endpoint; Notion13.

Giữ nguyên quyết định đã chốt: một specialist; RECEIVABLE/PREPAYMENT là lõi; tenant khác assessed counterparty; FHI tách Transaction Review. Policy **unconfigured**, score/band/grade/pd phải null. Không coi lack of endpoint là bằng chứng đã có production method gate.

Numeric release cần versioned method/approval_log, đúng `DISTRIBUTION_WHOLESALE_PILOT`, bảy metric đủ dữ liệu verified/fresh cùng entity/period/basis/currency/unit, fact→evidence mapping, Decimal arithmetic và độc lập oracle. Không reweight khi thiếu metric; không đổi waiver thành đủ BCTC; không coi OCR confidence là verified; grade/pd luôn null v1.0. Reference config/scorer/30 fixtures được Notion mô tả là gói nguồn chưa đính trực tiếp, chưa nghiệm thu trong audit này.

Method approval là blocker **cho numeric output**, không cấm phát triển hoặc chạy document review không điểm. Audit không phê duyệt anchors/weights, không bật pilot hoặc tự tính score.

### PR-10 — P1: Reproducibility, deployment và security evidence chưa đủ

**Evidence:** `.gitignore:30/35`, `render.yaml`, `configuration.ts:16–43`, `RequestLoggingMiddleware:12/19`, fixtures/HTTP collection và E2E script.

- **Reproducible source:** storage service bị ignore, build local xanh có thể không tái lập sau clone. `docs/api-collection/**` và `docs/audits/**` cũng bị root `docs/*` ignore; báo cáo này vẫn tạo được local nhưng chưa được Git theo dõi. Không sửa ignore/stage trong audit.
- **Config:** không có dotenv loader trong backend dù README bảo tạo `.env`; cần launcher/env injection rõ. `Number(PORT) || 3001` làm PORT=`abc` hoặc `0` rơi về3001 thay vì fail. Probe CF01 xác nhận. Default storage tính từ `cwd/../..`, chạy `node apps/api/dist/main.js` ở root thành `C:\Users\52duc\storage`, khác chạy trong package; CF02 xác nhận. Cookie/TTL config không thực sự wired.
- **Logs:** middleware dùng `req.originalUrl || req.url`, nên có query string; câu Gemini “không log query parameter” sai. Chưa có bằng chứng secret thật đã lộ; phải kiểm sanitization/redaction và validate request ID, không log capability/raw secret. Header x-request-id không tự làm public error body có request_id/details.
- **Deployment:** file Render khai type web, bind0.0.0.0, console=1, lệch private boundary đã chốt. Không kiểm live deployment; không kết luận host hiện public hoặc secret đã lộ chỉ từ YAML. Chưa có bằng chứng backend deployment/restore/least privilege/parser process limits được nghiệm thu.
- **Fixtures:** valid PDF đúng hash báo cáo, 492171 byte, 1 trang và có nhãn synthetic. Nhưng hai case JSON có lineage bắt đầu `l100.../l200...` **không phải UUID**; consumer decoder chỉ kiểm string, không đủ tuyên bố “100% schema AIC”. Public AIC schema chưa có; fixture có metadata mở rộng và `ready` + extraction null, không phải positive readiness oracle. Negative vectors create-case trỏ endpoint chưa triển khai, dự kiến status/code chưa được release.
- **HTTP collection:** revision upload hardcode1, sau upload không cập nhật; source/extraction dùng docId gold cố định thay uploadedDocId dù upload synthetic sinh UUID khác; logout nằm trước các thao tác tiếp theo; capture nguyên Set-Cookie gồm attributes; không Origin trên mutations, active logout thiếu CSRF. Direct AI storage key `04_contract.pdf` chỉ hợp một cấu hình storage cụ thể. Có ích tham khảo, chưa phải collection production chạy liền mạch/đa client được chứng minh.

## 4. Đối chiếu báo cáo Gemini

| Tuyên bố | Kết luận audit |
| --- | --- |
| FE build/typecheck/architecture/10 unit/18 integration PASS | **Đúng, đã chạy lại**, phạm vi frontend consumer/proxy |
| Nest build PASS | **Đúng**, chỉ compile, cấu hình TS còn permissive và body:any |
| 25/25 PASS | **Tái lập được** với AI mock; không phải security/full workflow acceptance |
| SessionAuthGuard đã bảo vệ anonymous/invalid sessions | **Đúng**; không đồng nghĩa org/case isolation |
| Tenant ACL đã hoàn thiện / endpoints list theo org | **Sai nếu suy từ summary/table**; subagent BE có thừa nhận còn blocker, code không filter |
| Inspect trong cùng E2E mock là PyMuPDF thật | **Sai với code mode này**: MockBackend lấy manifest. Live inspect thật được audit kiểm riêng |
| Extract arbitrary PDF production đã thành công | **Không có evidence**; gold mock thành công, live provider-disabled503 |
| Auth giới hạn qa.specialist/TestOnly | **Sai nếu hiểu là giới hạn credential**: mọi truthy username/password; BE report đã nêu phần này chính xác hơn handoff |
| CSRF upload đã vá | **Đúng**, direct probe missing/wrong403; logout/Origin backend còn gap |
| Idempotency400 là contract đúng | **Sai** so với Notion09/08: phải409 IDEMPOTENCY_CONFLICT |
| Adapter đầy đủ schema validation và error mapping | **Quá mức**: partial shape checks, nested error bị đọc sai, mất provenance/mode/diagnostics |
| PDF source immutable và streaming | **Chưa đúng**: byte roundtrip thật nhưng overwrite được, đọc Buffer, chưa hash/version enforce |
| AI fail do prompt version | **Đúng cho fail còn lại khi đúng CWD**; suite hiện361 pass/1 fail/4 skip, không chứng minh provider quality |
| owner_party_ref phải đổi sang organization_id cho BCTC/registration | **Không được kế thừa đề xuất này**; nhầm tenant với assessed entity/borrower theo domain AIC2 |
| Bắt đầu bằng Prisma schema/migrate ngay; contract alignment làm cuối | **Sai thứ tự dependency**: contract/storage/transaction design phải freeze trước migration |
| Chuyển JWT là điều kiện để session an toàn | **Không bắt buộc**; session cookie/hashed store/revocation phải giữ theo contract, JWT là lựa chọn cần thiết kế riêng |
| Synthetic fixtures100% schema, collection sẵn chạy mọi client | **Chưa được chứng minh**, có lỗi/gap cụ thể tại PR-10 |
| Middleware không log query | **Sai**: dùng originalUrl |

Các mốc13/20/25 và mô tả vừa “đã vá” vừa “còn unauthenticated” trong tài liệu là snapshot lịch sử không đồng nhất. Nghiệm thu hiện tại dùng code + test chạy lại, không lấy dòng lịch sử làm trạng thái cuối.

## 5. Reusable modules — KEEP / EXTEND / REPLACE / REMOVE / BLOCKED

Mỗi file hiện có chỉ được tính một lần. EXTEND nghĩa là giữ vị trí/trách nhiệm/routing hoặc thuật toán có ích, nhưng phải thay phần implementation chưa đủ; không bảo đảm diff nhỏ.

| File trong `apps/api/src` | Phân loại | Quyết định kế thừa |
| --- | --- | --- |
| `guards/public.decorator.ts` | KEEP | Decorator metadata nhỏ, đúng trách nhiệm; giới hạn route public qua review |
| `main.ts` | EXTEND | Giữ Nest bootstrap/prefix; thêm config lifecycle, security guards, shutdown/health theo release |
| `app.module.ts` | EXTEND | Giữ composition/global guard; thay providers RAM bằng module ports; chỉ integrator sửa |
| `config/configuration.ts` | EXTEND | Giữ config interface; strict parsing, ổn định path, env loading/injection và actual wiring |
| `guards/session-auth.guard.ts` | EXTEND | Giữ global session boundary; real session port, config cookie, logout exception đúng contract; ACL tách rõ |
| `middleware/request-logging.middleware.ts` | EXTEND | Giữ duration/request correlation; sanitized path/request ID, structured redaction và error correlation |
| `ai-client/ai-client.service.ts` | EXTEND | Giữ HTTP route/header/timeout pattern; strict validator, nested error adapter, budget và provenance |
| `controllers/counterparties.controller.ts` | EXTEND | Giữ routes/list envelope; scoped queries/cursor và contract writes qua use cases |
| `controllers/cases.controller.ts` | EXTEND | Giữ upload route/response concept; tách use case, ACL/TX/idempotency/quota; bỏ fixture và sync extraction ở production |
| `controllers/documents.controller.ts` | EXTEND | Giữ source/extraction endpoints; authorized exact version/hash stream và released errors |
| `controllers/jobs.controller.ts` | EXTEND | Giữ status endpoint; resource scope, durable job repository, retry contract |
| `controllers/evidence.controller.ts` | EXTEND | Giữ lookup route; resolve case/tenant/version và source relations |
| `controllers/auth.controller.ts` | REPLACE | Thay login/logout implementation; vẫn giữ public endpoint semantics và session DTO |
| `state/in-memory-db.service.ts` | REPLACE | Production repositories/UoW/session/job stores thay RAM; giữ seed như test fixture riêng nếu cần |
| `storage/storage.service.ts` | REPLACE | Giữ ý tưởng server key/SHA/regex; thay sync mutable FS bằng immutable storage port + adapters |

**Tổng:** KEEP1 + EXTEND11 + REPLACE3 =15. Các đoạn cần **REMOVE khỏi production path**: any-password auth/seed-user assumption, fixed gold doc IDs, RAM idempotency, history/readiness giả lập và synchronous extract orchestration. Không xóa fixture/harness dùng hồi quy; cô lập vào test-only entry point.

| Module chưa có | Phân loại hiện tại | Điều kiện gỡ BLOCKED |
| --- | --- | --- |
| Public AIC DTO/validators/SDK | BLOCKED | AIC-B01 schema + consumer/producer compatibility freeze |
| PostgreSQL schema/migrations/UoW | BLOCKED | DB physical invariants, nullability, source storage và contract freeze |
| Real IAM/session + case membership | BLOCKED | Session lifecycle/cookie/rate limits và ACL contract freeze; không phải chờ method approval |
| Durable jobs/worker/publication | BLOCKED | Job/run enums, lease/retry budgets, snapshot/CAS contract |
| Corrections/classification/review/issues/waivers | BLOCKED | Source binding, action/state/revision/error contract |
| Requests/approved export/questionnaire/capability | BLOCKED | Frozen export và revision mapping; capability identity/consent/scope/lifecycle |
| Financial facts/method/assessment | BLOCKED | Fact/metric→evidence contract; method gates; numeric enablement còn BA/owner approval |

Ngoài backend: giữ frontend hiện có và guard pending; giữ FastAPI/bundle1.0.2 cho capabilities được chứng minh. E2E script **EXTEND khi được phép triển khai**, giữ regression intent và sửa expected theo contract có review; không giữ mã400 sai chỉ để bảo toàn25/25. Fixtures/collection cần chuẩn hóa sau release schema, không dùng làm nguồn nghiệp vụ.

## 6. Critical contract gaps cần freeze trước code production

“Freeze” là quyết định review + artifact versioned + expected tests; không chỉ đồng ý tên type TypeScript. Schema1.0.2 đang dùng không sửa tay; phát hành bundle mới song song nếu cần. Bảng sau là danh sách quyết định cần khóa, không tự chọn giá trị nghiệp vụ còn mở.

| ID | Contract cần khóa | Nguồn / artifact cần có | Người quyết định |
| --- | --- | --- | --- |
| F01 | Public operations + DTO required/nullable/unknown-field/enum/union; pagination; flat Error/request_id/details | Notion09/10 → OpenAPI + JSON Schema + examples/SDK/negative vectors AIC-B01 | Lead contract + BE/FE review; BA cho semantics |
| F02 | Session cookie name/path/Secure/SameSite, expiry/revoke/disable, login limits; Origin/CSRF và expired logout204 | Notion06/09; không mặc định chuyển JWT | Lead security + owner |
| F03 | Tenant/case principal, membership, outsider404/action403, nested-resource ownership và replay ACL | Notion01/06/08/09; composite key/query rules | Lead security + persistence |
| F04 | Idempotency scope org/actor/operation, canonical JSON/multipart fingerprint, in-flight, expiry/frozen response; **409 IDEMPOTENCY_CONFLICT** | Notion08/09; test vectors replay/conflict/concurrency | Lead contract + persistence |
| F05 | Case/request/response revision theo action, TX lock order, audit, job/current pointers, staleness dependencies | Notion02/08/09/10; request edit chỉ request revision; approve/cancel khác current-run guard | Lead domain + persistence |
| F06 | Upload new/replace/response; source_class; subject/party role; exact lineage/version/hash; page/size/case quota và statuses415/413/422 | Notion02/06/09/10; immutable storage/source reads | Lead document + contract |
| F07 | AI1.0.2 adapter: document types/registry/role mapping, missing_reason, evidence refs, PaymentCondition, error envelope, provenance/diagnostics/mode và unsupported capability | Notion04/10; strict schema + echo/source/field registry tests | Lead integration + AI owners Nguyên/Tuấn Anh |
| F08 | Durable job vs review/assessment state enums; partial semantics; attempt/deadline/call budget, fencing/CAS/publication | Notion02/04/08/10; enum jobs draft DB hiện khác FE, phải thống nhất | Lead persistence + worker + AI owners |
| F09 | Corrections/raw/effective layers; verify/resolve/dismiss/reopen; waiver/revoke; request approve/cancel/export frozen bytes | Notion01/02/09/10; actor/reason/state/source gates | Lead domain + BA |
| F10 | Questionnaire versions/unions, staff_transcribed vs SME_direct, verification target revision; respondent bearer capability scope/identity/consent/expiry/revoke/limits | Notion06/09/10/12; no internal role mới, no auto-send | Owner/BA + security + contract |
| F11 | FinancialStatementSet/Fact, decimal precision, currency/unit/period/basis/verified-entry; fact IDs khác evidence IDs; method artifact + financial_health/transaction_review mapping | Notion10/13; registry/approval_log, independent oracle | Nguyên/Tuấn Anh + financial reviewer + lead contract |
| F12 | Physical PostgreSQL constraints/index/JSONB-vs-relational, RESTRICT history, active lineage/job/waiver uniqueness, transaction/publication design | Notion08 còn draft; DDL review trước migration | **Một persistence owner duy nhất**, lead review |

Giữ nguyên phương pháp và chính sách từ Notion13. Việc phát hành DTO/DB không phê duyệt pilot. Không re-map seller=borrower, không nhầm organization=assessed entity, không tự thêm role reviewer/contributor hoặc blend score.

## 7. Backend implementation roadmap đề xuất

Đây là kế hoạch sau audit, **chưa được thực thi**. Không ước lượng ngày/công sức khi contract chưa khóa.

| Gate / thứ tự | Công việc | Điều kiện nghiệm thu trước bước kế |
| --- | --- | --- |
| G0 — Contract/design | Freeze F01–F12 theo phạm vi từng vertical slice; đầu tiên core/auth/ACL/source/jobs. Publish artifacts và compatibility matrix. Review physical model, chọn ORM/queue/storage qua quyết định kỹ thuật | Không còn required/null/error/revision/scope mơ hồ cho slice; owner/BA review semantics; FE/BE/AI consumers validate examples |
| G1 — Persistence + security foundation | PostgreSQL migrations/repositories/UoW/audit/idempotency, real user/session/case membership, global guards, config/error correlation | Migrate/restore isolated DB; two-org/same-org outsider404; lifecycle/CSRF/Origin; rollback và concurrent replay tests PASS |
| G2 — Documents + reliable async | Immutable storage, inspect trước accept/quota recheck, upload modes, atomic enqueue, process worker riêng, fenced lease/budgets, strict AI adapter, source/extraction/evidence reads | Valid upload202, worker terminal; bad/unsafe files rejected; replace không sửa nguồn cũ; provider fail rõ; no stale/duplicate publication; MOCK được bảo tồn/nhãn rõ |
| G3 — Human review/workflow | Correction/classification → review runs/issues → decisions/waiver/revoke → requests/draft/approve/export/cancel/history | Current/partial/stale/source guards đúng action; raw và approved export bất biến; reason/actor/revision/audit nguyên tử |
| G4 — Questionnaire/capability | Staff entry/verification, invitation/revoke, scoped respondent form/submit | Origin khác verification, sửa response invalidate verification; capability không đọc nội bộ; receipt chỉ sau success; không auto-send |
| G5 — Financial/method integration | Facts/period/unit verification, metrics/method adapter, readiness, assessment/ack/history; transaction review độc lập | Khi unconfigured/ngoài scope/thiếu verified facts: numeric create422, score/band/grade/pd null; oracle và two-workflow E2E đạt yêu cầu; chỉ bật pilot khi có phê duyệt riêng |
| G6 — Release acceptance | Full DB/HTTP/browser regression, abuse/parser budget, private topology/console off, least privilege, backup/restore/log redaction, deploy/recovery runbook | Không còn finding P0/P1 chưa xử lý hoặc exception được owner chấp thuận; independent review + owner Go/No-Go |

G4 có thể phát triển song song G3 sau G2 và F10. G5 phần fact/method contract/oracle có thể chuẩn bị sau G0; numeric publication chỉ tích hợp sau source/verification/snapshot gates. Không trì hoãn auth/ACL tới sau persistence feature, không mở pending frontend writes trước schema + server acceptance, không đặt contract alignment ở cuối.

Security kiểm từ G1 liên tục; G6 là nghiệm thu tích hợp, không phải lần đầu bắt đầu kiểm bảo mật. SSE/WebSocket/circuit breaker không mặc định là blocker: polling hiện hữu có thể giữ; ưu tiên durable jobs, finite budgets và correctness đã có bằng chứng thiếu.

## 8. Multi-agent execution plan

Kế hoạch phân công cho giai đoạn triển khai được duyệt; **audit này không dispatch agent triển khai**. Tên thư mục mới dưới đây là ownership đề xuất, chưa tạo. `apps/api/src` viết tắt là `API`; `apps/api/test` là `TEST` trong bảng.

### 8.1. Shared ownership rules

1. **Agent C — Contract Steward** là writer duy nhất cho bundle/schema/generated types/shared ports và contract fixtures. Bundle1.0.2 cũ giữ nguyên. FE/AI owners review mapping; agent khác gửi change request, không tự sửa schema.
2. **Agent P — Persistence Owner** là writer duy nhất cho ORM schema, entities, migrations, DB constraints/index và transaction/audit/idempotency repository implementations. Không để worker/workflow agent thêm cột hoặc tự generate migration. Mọi migration từ một chuỗi thứ tự đã review.
3. **Lead Integrator** sở hữu `main.ts`, `app.module.ts`, `config/configuration.ts`, package/lock/workspace, `.gitignore`, CI/deployment manifests và các controller cũ trong giai đoạn chuyển routing. Không để hai agent sửa CasesController đồng thời. Worker/document/workflow agents tạo module/use case riêng; lead nối controller sau review.
4. Mỗi agent chỉ sửa file scope đã giao. Shared interface freeze có version/hash; thay đổi breaking dừng dependents và review lại, không cast `any`/fallback[]/mở decoder để lấp gap.
5. Tests của từng module thuộc agent đó; integration/browser suite chung thuộc Agent Q. Không agent nào sửa expected của test do agent khác sở hữu để che lỗi. Root E2E cũ chỉ Q sửa sau khi contract đã thay đổi được duyệt.
6. Local `duc` và uncommitted work là baseline; không agent tự reset/commit/push/deploy. Tách checkout/worktree chỉ khi được phép ở lượt triển khai, và phải mang đúng snapshot local thay vì chỉ HEAD thiếu prototype.

### 8.2. Task register và acceptance

| Task ID / Owner | Exclusive file ownership | Dependencies / contract freeze | Acceptance criteria | Test bắt buộc | Thứ tự tích hợp |
| --- | --- | --- | --- | --- | --- |
| BE-00 / Lead | Decision records/design release trong docs; review toàn bộ, chưa code domain | Audit owner approval; Notion01/02/06/08/09/10/13 | Chốt phạm vi slices, ORM/queue/storage/session deployment, F01–F12 owners; không đổi business rules | Design review + traceability từng gap → artifact/test | 0 |
| BE-01 / Agent C | `packages/contracts/<new-AIC-release>/**`, generated types và `API/shared-ports/**`, contract vectors | BE-00; F01–F11 cho slice; FE/AI owner review | Machine-readable schemas/examples/generated types; compatibility old/new; declared unsupported capabilities | Producer/consumer validation, required-null/unknown-field/enum/money/role/error/multipart/hash golden vectors | 1; freeze trước consumers |
| BE-02 / Agent P | `apps/api/prisma/**` **nếu Prisma được chọn**, hoặc một migration/entity root được chọn; `API/database/**`, `TEST/database/**` | BE-01 + F03/F04/F05/F08/F12 | Tenant chain constraints, UoW/revision/audit/idempotency/lease repositories, active invariants; migrate/restore được | Real PostgreSQL tests: rollback after fault, same-tenant refs, concurrent writers, unique active constraints, fenced update, no audit loss | 2; nền cho mọi persistence consumer |
| BE-03 / Agent S | `API/auth/**`, `API/authorization/**`, `API/guards/**`, `API/middleware/**`, `TEST/security/**` | BE-01/F02/F03; auth/session/ACL ports freeze; BE-02 khi DB integration | Real identity/session, global resource ACL, logout/Origin/CSRF, rate limits, sanitized logging; public exceptions reviewed | Two org + same-org non-member, list/nested/PDF/replay ACL, expiry/revoke/disable/logout, wrong password, no test auth in production, secret canaries | 3; song song BE-02 qua frozen ports |
| BE-04 / Agent D | `API/storage/**`, `API/documents/**`, `TEST/documents/**`; **không** controller cũ/schema | BE-01/F06; storage/repository/job ports; BE-02/03 để integration | Immutable source/version, upload modes/owner role/quota/inspect gate, hash-checked reads; domain use cases không chứa worker loop | Bytes/hash/version, overwrite reject, replace/response foreign refs, encrypted/embedded/limits/traversal/symlink, restart/source restore | 4a; có thể làm song song BE-05/06 |
| BE-05 / Agent A | `API/ai-client/**`, `API/ai-adapters/**`, `TEST/ai-adapters/**`; không sửa services/ai hoặc legacy bundle | BE-01/F07/F08; AI owners review | Strict1.0.2 bridge, nested→public error mapping, evidence/role/null/unsupported mapping, lossless provenance/mode/diagnostics, explicit deadline | Malformed/extra/missing/schema/echo/hash/evidence tests; real live inspect; mock-labelled fixture E2E; provider down/timeout/429; no silent mock | 4b; độc lập DB implementation |
| BE-06 / Agent W | `API/jobs/**`, `API/workers/**`, `TEST/jobs/**` | BE-01/F08 và snapshot/lease/storage/AI ports; BE-02 khi integration | Durable enqueue/claim, finite budget, retry API, lease fencing, immutable result + current publication CAS; API202 trước extraction hoàn tất | Two workers, crash after claim/enqueue, duplicate delivery, expired lease, late response, revision/source change, retry exhaustion; no duplicate current result | 4c; tích hợp sau BE-02/04/05 |
| BE-07 / Agent R | `API/reviews/**`, `API/waivers/**`, `API/requests/**`, `API/history/**`, `TEST/review-workflows/**` | BE-01/F05/F09; BE-02/03/04/06; issue/snapshot ports | Findings/handling states riêng, corrections/classification, request state machine, frozen export, actual audit history; no auto-send | Partial/stale resolve reject; decision revision vs needs_recheck; waiver/revoke no false verification; draft edit/cancel/approve revision matrix; export hash after source change/cancel | 5a |
| BE-08 / Agent QN | `API/questionnaires/**`, `API/respondent/**`, `TEST/questionnaires/**` | BE-01/F10; BE-02/03; shared verification/source ports freeze | Versioned responses/verification, staff origin giữ nguyên, scoped token hash/lifecycle/receipt; không internal role thứ hai | Wrong case/question, expired/revoked token404, no score/PDF/notes access, skip/required unions, response revision invalidates verification, no implicit email | 5b; song song BE-07 |
| BE-09 / Agent M | `API/financial-facts/**`, `API/methods/**`, `API/assessments/**`, `TEST/financial/**` | BE-01/F11; financial reviewer; BE-02/03/04/06; source/verification interfaces từ07/08 | Readiness/method registry, financial/transaction outputs riêng, facts→source, immutable snapshots/ack; policy mặc định unconfigured | Unconfigured/out-of-scope/missing/conflicting/stale/waiver block numeric; decimal/unit/basis/period guards; independent30 oracle sau nhận gói nguồn; grade/pd null; không blend | 6; contract/oracle chuẩn bị sớm, publication tích hợp sau |
| BE-10 / Agent Q | `scripts/test-e2e-feasibility.cjs`, `TEST/integration/**`, `TEST/e2e/**`, `tests/fixtures/synthetic/**`, `docs/api-collection/**`, QA evidence | BE-01; các module hoàn tất từng slice; expected contract được review | Executable test gate với nonzero failures; isolated DB/storage; mock/live tách; collection chạy động; RECEIVABLE/PREPAYMENT workflows | Auth+ACL/source/concurrency/provider adverse paths + browser401/409 recovery, blocked/stale/history, locales, synthetic source; không dùng test mock làm live acceptance | Xuyên suốt; nghiệm thu cuối7 |
| BE-11 / Lead Integrator | Bootstrap/controllers cũ/config/package/lock/gitignore/CI/deploy/runbook | Các tasks đã review; F02/F08/ops decisions | Wiring modules, reproducible clone/build, private AI/console off, least privilege, finite resources, restore/runbook; owner approve trước deploy | Clean isolated checkout build/test, internal boundary probes, secret-log scan, backup/restore DB+PDF+export hashes, process shutdown/recovery | Sau từng wave; release gate cuối8 |

### 8.3. Waves và giao diện tránh collision

- **Wave0:** Lead + C khóa contracts và ports; P review physical invariants. Không chạy migration draft.
- **Wave1:** P và S làm DB/security song song theo ports; A làm adapter validation độc lập; Q chuẩn bị acceptance fixtures theo released schema. C chỉ xử lý contract review.
- **Wave2:** D làm source/upload, W làm worker, A hoàn thiện AI boundary. D không sửa workers; W không sửa storage/AI transport/schema. Lead nối controllers và AppModule một lần sau module acceptance.
- **Wave3:** R làm review/requests/waiver và QN làm questionnaire/capability song song; dùng chung frozen verification/audit/UoW ports, không cùng sửa verification schema. P xử lý mọi migration mới theo change request duy nhất.
- **Wave4:** M nối financial/method publication; Q nghiệm thu đủ hai luồng và negative tests; Lead hoàn tất release evidence. Method pilot approval là gate độc lập, không tự bật vì suite xanh.

Thứ tự merge/integration: **contract release → DB/UoW → auth/ACL → immutable storage + validated AI client → durable worker/document slice → review/requests & questionnaire → financial gates → end-to-end/deployment acceptance**. Module có thể được viết trước qua ports, nhưng không được công bố PASS trước integration dependencies.

## 9. Go / No-Go và điều kiện duyệt

**NO-GO production hiện tại**, dựa trên PR-01/02/05/06 và các gap có test/source evidence. Không nhận arbitrary Internet upload/dữ liệu thật; không bật numeric scoring. Local supervised synthetic transport demo có thể dùng nếu gắn rõ prototype + mock và không trình bày như production security/method validation.

**GO cho phát triển kế thừa sau owner approval**, với thứ tự G0→G6. Không cần rewrite frontend hoặc AI chỉ vì khác số version. Ưu tiên sửa auth/ACL và contract/error/idempotency/source correctness; sau đó durable persistence/worker và business workflows.

Điều kiện để xét lại production Go:

1. Contract release có review, compatibility và source/role/method mapping; DB invariants được khóa, không còn migration dựa ví dụ draft.
2. Auth/session thật; tenant + case + nested ACL, CSRF/Origin, current ACL trước replay; không test-auth reachable ở target.
3. PostgreSQL TX/audit/revision/idempotency và immutable storage vượt rollback/concurrency/restart/restore tests.
4. Durable worker fenced publication, finite retries/budgets, strict AI adapter, mock labels/provenance và provider failures không biến thành success.
5. Workflow acceptance đủ RECEIVABLE/PREPAYMENT, source/waiver/partial/stale/history/export và capability nếu phát hành.
6. Security/deployment evidence cho target thực, private AI/console off, sanitized logs và recovery; review độc lập, owner quyết định release. Numeric output còn đòi method approval riêng theo Notion13.

**Giới hạn bàn giao:** chỉ thêm báo cáo audit này; không sửa code/test/contract/schema/business rule, không commit/push/reset/deploy, không sửa Notion. Các finding chưa được vá trong lượt này. Báo cáo được tạo local dù đang bị `.gitignore` ignore; việc đưa báo cáo/storage source vào version control phải xử lý rõ trong lượt triển khai được duyệt, không force-add bí mật hoặc storage dữ liệu.
