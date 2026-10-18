# Document slice preparation — review package

17/10/2026, Asia/Saigon. **DOCUMENT_DRAFT_REVIEW_READY / CONCRETE_WRITES_BLOCKED.** Branch `duc`, HEAD `8b0b7ed9e983ba4a2ea4d43f79d1816eaad7dbf0`. Tiếp tục từ independent slice, không audit toàn bộ, không commit/push/reset/deploy hoặc migrate DB người dùng.

## Thay đổi thực tế

- [B01–B04](PHASE-2-DECISIONS.md) được chuẩn hóa thành vấn đề → đề xuất cụ thể → thay thế → tác động FE/BE/DB/API → quyết định cần duyệt. Creator membership, policy version cố định và session/throttle tạm giữ nguyên trạng thái đã được duyệt.
- B01 có [policy artifact draft](drafts/case-policy.draft.json): scope core/VND/organization assignment, ngày hiệu lực đề xuất20/10, reject overlap/no-match,7 checklist rows required/conditional/optional/waivable. Status draft/ineligible, approval/effective_from null, method null và pilot false. Chưa có runtime loader/registry/migration.
- B02 có [schema JSON2020-12 draft](drafts/exposure.schema.draft.json) và [examples](drafts/exposure.examples.draft.json):3 ví dụ hợp lệ,1 incomplete claim,14 invalid vectors. Tách proposed/active của case khỏi proposed/actual của claim, claim khỏi verified; mô tả VND strings, null/reasons, source ownership, verification và stale dependencies. Persisted aggregate không được nhận nguyên làm request; server fields cần projection riêng sau release.
- B03 đối chiếu Next allowlist, Nest loopback và AI deployment blueprint; đề xuất private ingress→Next→Nest→AI, peer/header rules và authenticated handoff thay thế. Ghi rõ environment facts còn thiếu; chưa chỉnh FE/proxy trust.
- B04 cụ thể hóa A:response/replay24h, hourly body cleanup, minimal tombstone không thời hạn/no reuse. B:72h/90ngày, purge+possible reuse với guarantee giới hạn. Scope/fingerprint/result từng operation có trong bảng; chưa áp retention hoặc cleanup vào runtime.
- [Document contract draft](DOCUMENT-SLICE-CONTRACT-DRAFT.md) gom upload new/replace/response, immutable identity/storage, intent→durable object→T-accept, orphan/crash/TX, job/lease/fencing/retry/publication CAS và AI boundary. Mỗi invariant có scenario;17 fault/concurrency cases là kế hoạch, NOT RUN trên real store+PostgreSQL. Chưa có concrete writes/worker publication.
- Implemented opt-in [raw-response helper](../../apps/api/src/ai-adapters/raw-response.ts), README và tests. Đọc native WHATWG Response status200, JSON/UTF8, explicit maxBytes/read deadline, cancellation; dùng validator1.0.2 hiện có, giữ body/provenance/diagnostics/mode. Helper chưa nối vào runtime, không fetch/network/error mapper/DB/worker. Deadline không preempt synchronous parsing/native PDF; byte cap không là process-memory cap; cancellation best effort.
- [Notion handoff](NOTION-CURRENT-STATE-HANDOFF.md) hoàn chỉnh local: branch/index, requirement→path→evidence→gap→next action, implemented/integrated/tested/mock/live, chat decisions và nội dung cho master04/05/08/09/10/14. Title/destination05/14 chưa có evidence mới; operator xác nhận trước paste. Không ghi Notion hoặc đánh tasks Done/pilot.

## Whitespace và checkpoint

Đã xử lý đúng127 diagnostics trên14 text files:123 trailing-whitespace và4 EOF blocks. Chỉ trim ASCII trailing whitespace/excess blank EOF, giữ encoding/BOM/EOL và nội dung khác whitespace.3 API files chỉ bỏ blank EOF;2 TypeScript AST comparisons PASS.27 Markdown hard breaks được chuyển thành line breaks thường, cosmetic đã ghi trong [evidence](WHITESPACE-CLEANUP-EVIDENCE.md). Không sửa canonical AI/legacy artifacts hoặc PDF bytes.

Giữ259 staged paths từ trước và stage đúng reviewed list của lượt này; checkpoint cuối gồm270 changed paths.3 migrations cũ và11 synthetic PDF hashes giữ nguyên;2 untracked personal plan/logo archive vẫn ngoài index. Inventory được làm mới. Không `git add .`, force-add, commit/push; staging chưa là lịch sử commit hoặc backup ngoài máy. Content pattern scan có giới hạn, không claim comprehensive secret scanner.

Final checks: staged diff whitespace sạch, working/index consistency, reviewed-path/secret-pattern scan và canonical AI/PDF bytes.127 FAIL trong báo cáo cũ là trạng thái trước cleanup, không xóa/sửa evidence lịch sử để che nó.

## Kiểm thử thực chạy

| Kiểm tra | Kết quả và giới hạn |
| --- | --- |
| `pnpm api:test:response-capture` | Build PASS;26 PASS/0 FAIL/0 SKIP trên compiled helper với native Response/Headers/Streams và synthetic bytes. Không live service/AI accuracy claim. |
| `pnpm check:document-drafts` | PASS: policy inactive/checklist consistent,3 valid+1 incomplete+14 invalid Exposure vectors. Draft consistency, không production API hoặc business verification. |
| Whitespace comparison |14/14 non-whitespace/BOM/EOL checks,3 API prefix checks,2 AST checks PASS; whitespace-ignoring Git diff rỗng trên đúng14 file trước stage. |
| Git staged check/content/bytes | PASS sau review/stage; canonical AI/legacy artifacts và11 synthetic PDFs không đổi bytes. |
|156 preparation suite | NOT RERUN; giữ historical156 PASS riêng.26 test mới không là full-stack PASS. |
| Full FE→BE→AI/browser/proxy | NOT RUN/BLOCKED; chưa có evidence gỡ startup restriction; không retry/alternate launcher lượt này. |
| Real-store faults/concurrency, PG document/jobs, live extraction | NOT RUN; contracts/implementation chưa có, không dùng helper tests thay. |
| Full AI / FE build / PG foundation suite | NOT RUN lượt này; không đổi logic liên quan cần chạy lại toàn bộ, không nâng historical results thành current PASS. |

## Owner cần duyệt chính xác

1. B01:duyệt/sửa7 checklist rows và waiver scopes, organization/exposure scope, approval authority/evidence, hiệu lực20/10 hoặc mốc khác, reject overlap/no-match. Không hỏi lại creator membership hoặc immutable version.
2. B02:chọn JSON aggregate+relational bindings hoặc relational; duyệt/sửa claim/condition/date/null/source/verification/stale và input projection. Chọn cách lưu không tự duyệt semantics.
3. B03:cung cấp topology host/TLS/LB/peer/network/key facts, rồi chọn private-header A hoặc authenticated-handoff B.8h/30m/throttle tiếp tục là cấu hình tạm đã duyệt.
4. B04:chọn A24h/tombstone không hết hạn/no reuse hoặc B72h/90ngày/purge+reuse với guarantee giới hạn; duyệt operation fingerprint/status và in-flight reconciliation. Chưa automatic cleanup.
5. Document S1:freeze identity/source classes/limits/new-replace/store operations/backend/durable-intent TX/error/status. S2 response còn request contract. S3 worker còn states/lease/budget/snapshot/publication CAS. Có thể duyệt từng subset, không phải chờ FHI hoặc toàn claim workflow.

## Nhiệm vụ song song tiếp theo

| Exclusive owner | Files | Dependencies | Acceptance |
| --- | --- | --- | --- |
| Lead contracts | Shared packages/ports và draft docs | Owner freeze subset được release | Machine DTO/errors/examples/input projection+negative vectors; một writer |
| Notion sync operator | Các blocks master04/05/08/09/10/14 đã xác nhận | Handoff evidence và đúng destination | Link paths/tests, partial states, không all Done/pilot; không sửa local code |
| Storage QA preparation | Dedicated harness/matrix files | Plan độc lập; execute cần chosen store/ports | Barriers/fault injection trên real backend, không mock durability |
| Persistence writer | `apps/api/migrations/**`, `src/database/**` | Approved S1 intent/source/uniqueness | Real PG rollback/concurrency/restart; một migration writer |
| Concrete store agent | New store adapter files, không SQL/shared DTO | Frozen store port+chosen backend | Create-if-absent/overwrite denial/exact version/durable ack/orphan races |
| Document API agent | New document domain/controller files | Released DTO+repositories+store | Session/ACL/revision/quota/idempotency, durable202 only |
| AI adapter agent | `src/ai-adapters/**`, dedicated tests | Technical capture độc lập; mapping/error release cần frozen ports | Giữ strict validation/provenance/mock labels; không AI service edits |
| Worker agent | `src/workers/**`, `src/jobs/**` | Approved S3 schema/fence/snapshot/source ports | Late worker0updates; crash/retry một publication effect; exact source+CAS |

Jason chỉ sửa14 cleanup files+evidence; Mill chỉ viết new raw helper/docs/tests. Lead sở hữu draft/contracts/handoff/package/integration. Hai agent đã đóng; không DTO/SQL writers cạnh tranh. Không concrete document/case/exposure/counterparty writes, worker publication hoặc FHI pilot được mở.
