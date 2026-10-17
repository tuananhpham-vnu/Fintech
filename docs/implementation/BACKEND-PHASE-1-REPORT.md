# AIC Rating 2.0 — Backend Phase 1 Report

**Hoàn tất:** 17/10/2026, Asia/Saigon; bắt đầu16/10/2026. **Branch:** `duc`. **Status: PHASE_1_PARTIAL.**

Nền tảng PostgreSQL/session/ACL/scoped reads và transaction/idempotency đã triển khai, được kiểm thử trên PostgreSQL thật. Các mutation phụ thuộc policy/Exposure chưa chốt giữ đóng. Public deployment còn blocker client-IP qua proxy; không tuyên bố production-ready. Không commit, push, reset hoặc deploy.

## 1. Baseline và phạm vi được duyệt

- Tiếp quản workspace local, giữ thay đổi chưa commit. HEAD vẫn `8b0b7ed9e983ba4a2ea4d43f79d1816eaad7dbf0`; HEAD không chứa toàn bộ prototype/web/docs untracked.
- Đọc README/AGENTS, audit `docs/audits/CODEX-PRODUCTION-READINESS.md` và bảy tài liệu handoff; đối chiếu lại source local, bundle1.0.2 và Notion01/06/08/09/10 qua connector. Những nhận định cũ trong README/Notion rằng chưa có backend không được dùng để phủ nhận code local.
- Giữ NestJS/Express, route prefix `/api/v2`, session cookie architecture và FE consumer conventions. Không rewrite frontend hoặc AI service.
- Không scoring, review/waiver, AI worker, questionnaire/capability hoặc production document pipeline trong phase này.
- Owner đã bổ sung quyết định trực tiếp trong chat. Phân biệt rõ quyết định đã duyệt, cấu hình kỹ thuật tạm và business contracts chưa chốt bên dưới.

## 2. Git tracking — P0 đã xử lý

Writer `.gitignore`: subagent Sagan; main review. Không stage file nào.

| Kiểm tra | Before | After |
| --- | --- | --- |
| `apps/api/src/storage/storage.service.ts` | Bị `storage/` ignore | Discoverable/untracked; exception chỉ `.ts` trực tiếp trong source directory |
| `docs/audits/CODEX-PRODUCTION-READINESS.md` | Bị `docs/*` ignore | Discoverable/untracked |
| `docs/api-collection/README.md`, `.http` | Bị ignore | Discoverable/untracked |
| `docs/implementation/*.md` | Bị ignore | Contract freeze và báo cáo này discoverable |
| Runtime `storage/staging/*.pdf`, source-storage non-code | Ignore | Vẫn ignore |
| `.env*` trừ `.env.example`, keys, caches, dist, private/holdout/real data | Ignore | Vẫn ignore; secret rules đặt sau docs exceptions |
| Unknown exported doc directories/attachments | Ignore | Vẫn ignore, không mở rộng theo suy đoán |

Đã dùng `git check-ignore -v`, `git ls-files`, `git ls-files --others --exclude-standard`, `git status`. `git ls-files` không liệt kê các source/docs mới vì **chưa stage/commit**; việc sửa ignore chỉ làm chúng discoverable, không tự đưa vào index. Agent quét112.601 ignored paths, loại112.502 dependency/runtime/private/generated paths và phục hồi5 file bị ignore sai;87 file export cũ vẫn ignore. Sáu PDF fixture contracts vốn đã tracked từ baseline vẫn giữ nguyên, không thêm PDF mới.

Ví dụ sau sửa:

```text
!/apps/api/src/storage/*.ts      apps/api/src/storage/storage.service.ts
!/docs/**/*.md                  docs/audits/CODEX-PRODUCTION-READINESS.md
!/docs/**/*.md                  docs/implementation/BACKEND-PHASE-1-REPORT.md
.env*                           apps/api/.env
storage/                        storage/staging/private.pdf
/docs/**/private/               docs/audits/private/customer.json
```

Các dòng negation chứng minh đường dẫn được mở, không phải vẫn bị ignore. Chưa force-add secrets/runtime data; index không bị thay đổi bằng thao tác stage/reset.

## 3. Contract freeze và nguồn xác nhận

Single shared-contract owner: **Codex Lead**. Biên giới chi tiết tại [PHASE-1-CONTRACT-FREEZE.md](PHASE-1-CONTRACT-FREEZE.md). Artifacts mới tách khỏi bundle AI cũ:

- `packages/contracts/aic-foundation/schemas.json`: JSON Schema Draft7 cho Organization/User, Login/Session/Error, read-only Counterparty/Case/Exposure, History và pagination.
- `packages/contracts/aic-foundation/openapi.json`: tám operation đọc/auth đang hoạt động, OpenAPI3.1.
- `VERSION=0.1.0-foundation`, `SHA256SUMS`, README và generator `scripts/generate-foundation-contract.cjs`.
- `apps/api/src/foundation/ports.ts`: `PH1-PORTS-1`, DI tokens, database/UoW/config/principal/session interfaces; khóa trước khi auth/persistence chạy song song.

Đây là **scoped implementation freeze**, không phải phát hành đầy đủ public AIC2, approval mọi null/union nghiệp vụ, method approval hoặc release production. Legacy1.0.2 files/checksums được giữ nguyên; folder mới không sửa schema/API của AI.

### 3.1. Những yêu cầu đã rõ từ Notion

| Contract | Quyết định áp dụng | Nguồn |
| --- | --- | --- |
| Principal/domain | Organization là tenant, Counterparty là đối tác được đánh giá; một role specialist; server cấp IDs/org/actor | [01](https://app.notion.com/p/b940c2f0937d83f48e5b01d233063b85), [10](https://app.notion.com/p/ef40c2f0937d839a8799814ce182e69f) |
| Authentication/session | Password hash; session token hash-only; HttpOnly/Secure/SameSite; expiry/revoke; no prototype credentials | [06](https://app.notion.com/p/d170c2f0937d837b9fcf01de41335f03), [08](https://app.notion.com/p/d390c2f0937d8381b34b01f3a4ab41bf) |
| ACL | Counterparty scope theo org; case/history cần cả org và membership; outsider404, missing session401; không client gán quyền | [06](https://app.notion.com/p/d170c2f0937d837b9fcf01de41335f03), [09](https://app.notion.com/p/4220c2f0937d8376beaa0142a0e2e425) |
| Session mutation | Login kiểm Origin; active logout kiểm Origin/CSRF; expired/revoked logout vẫn204 với Origin hợp lệ; auth không ghi idempotency | [09 §8](https://app.notion.com/p/4220c2f0937d8376beaa0142a0e2e425) |
| Revision/TX | Positive revision, row locks; data/revision/audit/replay result commit nguyên tử; backend sole business writer | [08](https://app.notion.com/p/d390c2f0937d8381b34b01f3a4ab41bf) |
| Idempotency | Scope org/actor/operation; auth + current ACL trước replay; cùng key khác payload409 IDEMPOTENCY_CONFLICT | [08](https://app.notion.com/p/d390c2f0937d8381b34b01f3a4ab41bf), [09](https://app.notion.com/p/4220c2f0937d8376beaa0142a0e2e425) |
| Wire | Flat JSON, flat Error(code,message,request_id,details),204 không body; required/null distinction; unknown input fields rejected | [09](https://app.notion.com/p/4220c2f0937d8376beaa0142a0e2e425), [10](https://app.notion.com/p/ef40c2f0937d839a8799814ce182e69f) |
| Exposure reads | Bốn role pairs, VND integer string, term không tự suy, không borrower/seller mapping mặc định | [01](https://app.notion.com/p/b940c2f0937d83f48e5b01d233063b85), [10](https://app.notion.com/p/ef40c2f0937d839a8799814ce182e69f) |

### 3.2. Quyết định owner trực tiếp trong Phase 1

| Quyết định | Trạng thái triển khai |
| --- | --- |
| Creator hợp lệ cùng org tự có membership trong cùng transaction; không cấp org-wide; không role mới | Migration0002 AFTER INSERT trigger, rollback atomic đã kiểm. Chưa mở case-creation API |
| New case phải dùng approved/effective policy, version được lưu cố định; chưa có thì BLOCKED | Không invent default/registry; public POST/cases503; DB trigger cấm đổi policy_version đã gắn |
| Conditions/paid/received claims chưa duyệt | Không tạo field/enum/write rule; read existing JSON bảo toàn; PATCH exposure giữ đóng |
| Session absolute8h, idle30min; cookie HttpOnly, production Secure, Lax | Configurable temporary defaults; server kiểm thời gian DB thật; không kéo dài absolute expiry khi touch idle |
|5 failed logins/account-IP/15min, sau đó block15min; không lộ username tồn tại | Persistent hashed composite bucket, chỉ failures; attempt thứ5 trả401 và đặt block, tiếp theo429; không extend block mỗi request |
| Các giá trị security là cấu hình kỹ thuật ban đầu, không final policy | Ghi rõ trong config/example/README/report; chưa coi là business/security policy cuối |

### 3.3. Chuẩn hóa kỹ thuật do Lead thực hiện

- **Không chọn ORM theo handoff một cách mặc định.** Đối chiếu code cho thấy chưa có ORM/entity/migration framework đang dùng; Prisma/TypeORM sẽ thêm metadata/codegen nhưng vẫn phải thiết kế composite FKs, locks và TX. Chọn `pg` + explicit SQL migrations/UoW cho slice này, giữ NestJS hiện có. Transaction dùng cùng checked-out client theo [node-postgres guidance](https://node-postgres.com/features/transactions); không dùng pool.query để ghép transaction.
- Tables ở schema `aic`; UUID/timestamptz, tenant composite FKs/RESTRICT, revision safe positive bigint, audit append-only. Exposure amount giữ chuỗi chính xác trong JSONB và positive24-digit CHECK tương ứng sức chứa draft numeric(24,0), chưa tạo cột financial amount/precision mới hoặc float conversion. Đây là lựa chọn physical storage cho read-only slice, không release Exposure writes.
- Random32-byte opaque session token; SHA-256 của token và CSRF mới persist. CSRF HMAC versioned, trả login/me nhưng không trả session token JSON. Password versioned scrypt với salt riêng, bounded fixed cost và timing-safe comparison; không thêm password-content business policy. Tham khảo API thư viện [Node crypto](https://nodejs.org/api/crypto.html).
- JSON request hash sort object keys, giữ array order/null, bind case ID + expected revision + payload. Scoped key bind org/actor/operation/case/key. Advisory lock và row locks giữ trên cùng TX, current auth/ACL trước replay; response/status lưu cùng audit/revision.
- Session được **recheck sau mọi serialization lock** trước replay/work. Review độc lập phát hiện nguy cơ hết hạn khi chờ lock; đã vá và có real-PG test cả absolute/idle × cached/fresh request.
- Login không account-only lockout, không tin X-Forwarded-For tùy ý. Direct API tách bucket theo socket peer; proxy issue ở mục8 chưa được giải quyết bằng suy đoán.
- Idempotency retention chưa duyệt: bắt buộc supplied config, ví dụ chỉ local/test; expired key không tự được reuse, không automatic cleanup.
- OpenAPI không công bố write schema chưa chốt. Opaque conditions trong read model chỉ bảo toàn dữ liệu, không được dùng làm schema write.

## 4. Những phần đã triển khai thực tế

| Module / file | Phần triển khai và kế thừa |
| --- | --- |
| `main.ts`, `app.module.ts` | Giữ Nest bootstrap/prefix; default foundation, parameterized app factory cho tests, loopback, finite JSON body limit, lifecycle shutdown, sanitized startup failure |
| `config/configuration.ts` | Stable root path thay cwd assumption, strict env parsing, HTTPS production, cookie/TTL/idle/throttle wiring, DATABASE_URL required/no RAM fallback; AI transport config riêng để không làm legacy client tests phụ thuộc DB |
| `src/database/*` | Pool/readiness/shutdown, single-client TX/rollback, explicit checksum migration runner, portability helper, database handoff |
| `src/auth/*` | Real password/session/controller/guard, Origin/CSRF, expiry/revoke/idle/disabled account, persistent failed-login buckets, no default account |
| `guards/public.decorator.ts` | Kế thừa nguyên mẫu public metadata; auth mới tái sử dụng |
| `controllers/cases`, `counterparties` | Giữ đường dẫn/list envelopes; chuyển sang scoped SQL repository, cursor pagination, actual persisted audit history; mutations chưa đủ schema trả503 |
| `src/foundation/*` | Frozen ports, repository, output validators, flat errors/request IDs/no-store, canonical hash, CaseMutations UoW primitive |
| `src/prototype/*` | Bảo tồn controller auth/cases/counterparties và README cũ cùng module test-only; legacy documents/jobs/evidence/storage/AI chỉ được wire ở mode này |
| `src/state/in-memory-db.service.ts`, legacy storage/client | Giữ cho regression harness; không còn là persistence/auth của default app |
| `.env.example`, API/root READMEs, package scripts/lock | Cấu hình/run/migrate/test rõ, versions reproducible; docs không còn nói apps/api chưa tồn tại |

Runtime dependency thêm có giới hạn: `pg`, `express` direct dependency, `ajv`, `ajv-formats`; types thêm `@types/pg`. Không nâng cấp AI/front-end hoặc chọn queue/ORM/storage provider ngoài phạm vi.

### API đang hoạt động

```text
POST /api/v2/auth/login
GET  /api/v2/auth/me
POST /api/v2/auth/logout
GET  /api/v2/counterparties
GET  /api/v2/counterparties/:id
GET  /api/v2/cases
GET  /api/v2/cases/:id
GET  /api/v2/cases/:id/history
```

`POST /cases`, `PATCH /cases/:id/exposure`, `POST/PATCH counterparties` là fail-closed stubs503 `CONTRACT_NOT_RELEASED`, không ghi dữ liệu; update theo ID kiểm ACL trước khi báo pending. Documents/jobs/evidence/readiness/review/assessment routes chưa được public foundation wire. Case detail không fabricate empty workflows/readiness/score. FE optional expansions tiếp tục báo pending theo consumer hiện có.

**CaseMutations** là implementation nền tảng được test bằng real sessions/SQL, **chưa gắn vào business mutation API**. Vì vậy replay/conflict/revision acceptance trong phase này là ở service/UoW boundary thật, không phải tuyên bố đã có Exposure write endpoint409. Không thêm API kiểm thử/admin public để làm test PASS.

## 5. Database migrations đã chạy

Sử dụng PostgreSQL18.4 đã có binary trên máy để tạo **cluster riêng trong TEMP**, bind `127.0.0.1:15432`, SCRAM auth, credentials random không ghi vào source/report. Không dùng/reset/deploy database đang chạy của người dùng. Suite tạo các database `aic_phase1_test_<random>` và runtime roles riêng, không DROP/TRUNCATE database có sẵn.

| Migration | Đã thực thi | Nội dung |
| --- | --- | --- |
| `0001_foundation.sql` | PASS trên database trống thật |9 core tables: organizations,users,sessions,counterparties,cases,case_memberships,idempotency_keys,audit_events,login_attempts; composite FKs/CHECK/index/append-only audit |
| `0002_creator_membership_policy_immutability.sql` | PASS | Creator membership trigger cùng transaction; cấm đổi case policy_version; không auto-grant cả org hoặc invent registry |
| `0003_authorization_row_locks.sql` | PASS | Ba narrow SECURITY DEFINER row-lock functions; fixed search_path/qualified refs, PUBLIC execute revoked, operator cấp runtime EXECUTE cụ thể |
| Rerun/checksum/readiness | PASS | Rerun applied=[], checksum tamper bị từ chối; empty reachable DB không auto-migrate và startup fail-closed; LF/CRLF checksum helper tương đương |

Có thêm `aic.schema_migrations` là ledger, không tính thành business entity. SQL migration canonicalization chuyển CRLF→LF trước execute/hash; runtime readiness so version/checksum migration mới nhất. Migration runner kiểm toàn bộ applied-prefix/checksums. Không tự chạy migration khi API startup; operator migration role tách runtime role.

Final integration database: **`aic_phase1_test_6651015fbf7c`**. Runtime role dùng NOSUPERUSER/NOCREATEDB/NOCREATEROLE, không sở hữu schema, không CREATE table, không UPDATE users/memberships, không UPDATE/DELETE audit. Tests xác nhận các quyền cấm này. Fix quan trọng khi integration: PostgreSQL row locks cần UPDATE privilege; dùng narrow definer lock functions thay vì cấp users/membership DML chỉ để auth/ACL lock.

Đây **không phải tenant RLS**: app queries/functions dùng server principal để scope. Stolen DB credentials/arbitrary SQL không được coi là đã được tenant-isolate; deployment phải tiếp tục least privilege và secret protection. Schema owner/operator có thể thay DDL; append-only trigger không là tamper-proof ledger chống schema owner.

Không chạy migration vào production; không tạo policy approved. Cluster test được dừng cuối phiên; dữ liệu test được giữ trong TEMP, không đưa vào Git. Không để API child processes của suite chạy sau kiểm thử.

## 6. Kiểm thử thực tế

| Bộ kiểm tra | Actual cuối | Ý nghĩa / giới hạn |
| --- | --- | --- |
| `pnpm api:build` | PASS | TypeScript compile NestJS và modules kế thừa |
| `pnpm api:test` với explicit loopback disposable DB URL + opt-in | **40/40 PASS,0 failed/skipped** |13 crypto/transport helpers +26 PG/HTTP subtests +1 parent test; **không dùng mock DB/auth** |
| `pnpm test` | PASS | FE boundaries94 files/10 modules;10 unit;18 consumer/proxy checks |
| `pnpm lint` | PASS | FE architecture + Prettier |
| `pnpm typecheck` | PASS | FE Next typegen + tsc |
| `pnpm build` | PASS | FE production bundle, không browser click-through |
| AI pytest từ `services/ai` | **361 PASS,1 FAIL,4 SKIP** | Fail cũ `test_extraction.py:287`: extraction-v1 assertion vs extraction-v2; AI/test không sửa |
| Legacy bundle integrity | PASS |52 definitions và SHA256SUMS1.0.2 vẫn hợp lệ; tracked legacy contract/AI diff không đổi |
| Legacy AiClient constructor independent of DB | PASS | Giữ phần client unit tests của baseline không bị DATABASE_URL requirement mới làm gãy |
| Production prototype rejection | PASS | Config từ chối mode prototype dù enable=true khi NODE_ENV=production |
| `scripts/test-e2e-feasibility.cjs` full three-service run | **NOT RUN / BLOCKED trong Phase1** | Automatic approval review từ chối start Next local3000; không suy kết quả cũ thành PASS mới |
| Browser/real HTTPS/public deployment | NOT RUN | Không deploy; không tuyên bố proxy/client-IP hoặc TLS topology đã nghiệm thu |
| `git diff --check` | PASS | Không whitespace error trong tracked diff |

Không đánh đồng40 foundation tests với25 feasibility tests. Script feasibility nguyên trạng, SHA256 vẫn `f9a1531a91a4384308e72b37b276bc1c1b842a3b6d9cebc3522eca0686cd6a90`. Assertion400 ở harness legacy vẫn là debt được audit ghi nhận; **foundation** dùng409 `IDEMPOTENCY_CONFLICT`, không đổi assertion cũ để ép PASS. Không dùng prototype/gold mock để chứng minh production behavior.

### Security / transaction scenarios đã PASS

- Invalid/unknown/disabled credentials401 cùng mã, prototype credentials không đăng nhập được; extra/type-invalid login input422; foreign Origin403.
- Password scrypt thật, hash-only stored session/CSRF, configured cookie name, actual Secure/HttpOnly/Lax header với production transport config. Không tuyên bố đã test browser HTTPS transport.
- Missing/invalid/revoked/absolute-expired/idle-expired session401; account disable có hiệu lực. Active access touch idle nhưng không đổi absolute expiry.
- Active logout thiếu/sai CSRF hoặc sai Origin403; valid logout204 và server revoke; expired/revoked/no-session logout204 với Origin hợp lệ.
- Cross-org case/counterparty/history404; same-org non-member case404; lists/cursor không lộ row khác org/case; source amounts lớn hơn JS safe integer được giữ nguyên string.
- Creator membership nhìn thấy trong cùng transaction và rollback cùng case; policy mutation bị DB reject; foreign tenant FK/role/amount/term sai bị reject.
- Data+revision+audit+idempotency response commit nguyên tử; exact replay không side effect; khác payload409, stale revision409; concurrent same scoped key một write; key không là global Map theo actor/operation/case.
- Revoked membership/session không được đọc cached replay; actual persisted history scoped; runtime không xóa audit, owner UPDATE audit cũng bị trigger chặn.
-5 failed/account-IP được persist rồi429, block gần15min, IP khác có bucket khác trên **direct service**; sau hết block/window reset đúng; không reset window vì success.
- Hai child API process chạy lần lượt dùng lại cùng PostgreSQL và cookie: case revision/session còn nguyên qua process restart.
- Actual PG lock wait vượt absolute hoặc idle expiry: cached replay/fresh work đều401; callback không chạy và revision không đổi.

Những failure trong quá trình integration (missing direct express dependency; SQL row locks cần quyền; stale CWD probe) được điều tra và sửa nguyên nhân. Final suite không hạ assertions hoặc thay bằng mock. AI fail tồn tại từ baseline vẫn để FAIL, không che bằng tổng số foundation PASS.

## 7. Multi-agent thực thi và ownership

| Agent | File ownership thực tế | Kết quả |
| --- | --- | --- |
| Main / Lead | Shared ports/contracts/generator, config/composition/controllers/core-UoW, tests/report/package/lock | Khóa interfaces trước delegation, integrate/review và chạy PG/HTTP suite |
| Sagan / PH1-GIT | Chỉ `.gitignore` | Tracking evidence trước/sau, không stage/delete |
| James / PH1-DB | Chỉ `src/database/**`, `migrations/**` | Single migration writer; SQL/DB runner; main thực thi trên isolated PG |
| Erdos / PH1-AUTH | Chỉ `src/auth/**` | Session/auth/password/guards/helpers; không sửa ports/schema/package |
| Raman / independent review | Read-only | Tìm proxy-peer bucket issue và expiry-after-lock gap; main sửa gap thứ hai + real-PG tests, issue proxy còn mở |

Không agent cùng sửa schema/shared contracts. Auth/persistence chỉ chạy song song sau `PH1-PORTS-1`; thay interfaces idle/block do owner quyết định được main cập nhật và thông báo cả hai. Main tiếp quản integration sau agent hoàn tất, không có code-write collision. Các agent đã đóng sau bàn giao; không tự tạo chat/worktree/commit hoặc giao việc triển khai ngoài phase.

## 8. BLOCKED / quyết định cần trước Phase 2

### B01 — Approved/effective policy selection

Chưa có version registry/approval artifact đủ để chọn policy cho case mới. POST/cases giữ503, không dùng `AIC-TRANSPORT-TEST`/draft/pilot. DB giữ version immutable khi đã có record operator/test. Cần owner chốt cấu trúc phê duyệt/hiệu lực và selection contract; không nhầm policy với financial method.

### B02 — Exposure/claims/source contract

Conditions, paid/received claims, null-term explanation, provenance/source ownership và effect on staleness chưa khóa. Không triển khai writes dựa trên JSON opaque. Đề xuất để owner chọn:

| Phương án chuẩn hóa | Tác động |
| --- | --- |
| Typed discriminated union cho từng condition/claim trong JSONB versioned | FE phải map form/decoder theo discriminator; BE schema validate union + cross-field/source guards; giữ aggregate transaction; không tự chọn enum hoặc semantics |
| Relational condition/claim/source records | Stronger FK/queryability/version provenance; thêm migrations/repositories và mapping từ FE aggregate; cần chốt cardinality/state/source/precision trước |
| Transition adapter cho persisted/read opaque fields | Giữ FE reads tương thích; không cho tạo/sửa opaque payload; versioned migration sang một trong hai phương án trên sau owner review |

Phase1 dùng cách thứ ba **chỉ cho reads**, không tuyên bố nó là write schema. Counterparty identity/source mutation cũng chờ binding/invalidation contract, tránh tạo verified identity hoặc stale handling giả. Organization tax-ID business requiredness không được phát hành từ lựa chọn nullable của internal bootstrap table.

### B03 — Trusted client-IP qua proxy — production blocker

Backend dùng socket peer và cố ý không tin untrusted forwarding headers. Với topology Next → Nest loopback, mọi browser có cùng proxy peer; attacker có thể làm shared account/proxy bucket bị block. Vì thế direct API test IP khác không là nghiệm thu browser account/IP isolation.

Đề xuất Phase2: chốt trusted ingress/hops và chống spoofing; edge/proxy strip/rewrite Forwarded headers từ peer đáng tin, Nest chỉ nhận identity/IP từ designated private ingress (hoặc authenticated signed handoff), kèm finite resource limits. Test qua **actual proxy**: attacker clientA bị block, clientB cùng account không bị lock; client tự gửi XFF không bypass. Không bật `trust proxy=true` đại trà, không dùng account-only lockout để vá. Owner duyệt topology trước khi chỉnh transport/FE proxy hoặc deploy. Final threshold/security policy cũng cần đánh giá vận hành thêm.

### B04 — Idempotency retention và operation integration

Primitive đã có, chưa public mutation contract. Cần duyệt retention/cleanup và map operation/body/status khi triển khai từng write; expired key hiện fail-closed409, không tự reuse. Không được chỉ truyền arbitrary body vào callback rồi coi business validation đã xong; future work phải validate trước TX và không gọi AI/network side effects trong DB TX.

### B05 — Ngoài phạm vi / chưa nghiệm thu

Document/evidence immutable storage + worker/job/publication schemas, review/waiver/requests, capability và financial facts/method/approval còn theo audit roadmap. Không có fake readiness/scoring. Real-data rights/production parser containment/private deployment/restore vẫn là gate riêng. Legacy three-service regression còn phải chạy lại sau khi môi trường cho phép start Next; browser E2E chưa chạy. Không có grant/revoke/transfer sharing API ngoài creator trigger đã duyệt.

## 9. Nhiệm vụ song song tiếp theo

Giữ một contract owner, một SQL migration writer. Những task dưới đây là đề xuất, chưa dispatch triển khai:

| Task | Owner đề xuất / exclusive files | Dependency / acceptance |
| --- | --- | --- |
| PH2-C01 | Lead contract: `packages/contracts/aic-foundation/**`, `foundation/ports.ts`, contract docs | Owner B01/B02/B04; freeze full command shapes/examples/vectors trước writers; không agent khác sửa contracts |
| PH2-P01 | Persistence owner: `migrations/**`, `src/database/**` | Sau command/source schema freeze; migration/TX/FK/source invariants, single writer |
| PH2-S01 | Security/ingress agent: backend auth + approved transport scope | Sau B03 topology approval; actual proxy two-IP/spoofing tests; không sửa schema/ports tùy ý |
| PH2-D01 | Document agent: `src/documents/**`, storage implementation | Sau immutable storage/upload/source ports; exact version/hash/tenant tests; không sửa workers/SQL |
| PH2-A01 | AI adapter agent: `src/ai-client/**`, `src/ai-adapters/**` | Có thể chuẩn bị adapter validation theo old1.0.2 và frozen boundary; preserve mode/provenance/diagnostics, strict schema+source guards; không sửa AI service hoặc scoring |
| PH2-W01 | Worker agent: `src/workers/**`, `src/jobs/**` | Sau jobs/lease/retry/snapshot contract + P/D/A ports; fenced publication/crash/concurrency tests |
| PH2-Q01 | QA: integration/E2E fixtures/collection | Frozen outputs; rerun legacy baseline + real PG through proxy; no edits expected schemas để che mismatch |

Thứ tự integration: approved contracts → schema/UoW changes → auth/proxy → storage + strict AI adapter → durable worker/document slice. Review/scoring không tự đưa vào các tasks foundation này. Main owns wiring/package/lock và independent review.

## 10. Kết luận bàn giao

**PHASE_1_PARTIAL** — phần foundation không bị chặn đã triển khai và được kiểm thử thật (40/40). Các business mutations giữ đóng đúng chỉ đạo vì thiếu approved policy/Exposure/source contracts; client-IP qua proxy là production blocker cần xử lý trước public deployment. AI baseline còn một FAIL đã biết; full legacy feasibility/browser chưa được chạy lại do giới hạn môi trường.

Không tự commit, push, reset, deploy hoặc migrate database người dùng. Frontend source, AI service và legacy1.0.2 contracts không bị sửa. Runtime credentials/test data không được đưa vào Git. Trước Phase2, owner cần chốt B01–B04 và phạm vi transport/source release; không cần viết lại NestJS từ đầu.

Automatic approval review đã từ chối hành động khởi chạy Next.js local cổng3000; tool chỉ cung cấp lý do “blocked by policy”. Không thử vượt rejection bằng tool/đường chạy khác; bộ three-service feasibility được ghi NOT RUN/BLOCKED, không mượn PASS từ audit trước.
