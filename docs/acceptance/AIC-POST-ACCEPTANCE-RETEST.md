# AIC post-acceptance recovery — 17/10/2026

**Current status: DEMO_NO_GO / ACCEPTANCE_PARTIAL. Production: NO-GO.**

Đã xác định được provider trả HTTP429; đã sửa và kiểm chứng các lỗi grounding có nguồn, sửa focus dialog và nghiệm thu thêm23checkpoints browser độc lập. Chưa có successful live recovery. Historical PASS không được chuyển thành current PASS.

## Provider: nguyên nhân và retest

Trong run `D6IWaG`, actual browser upload → Next3000 → Nest3001 → job/worker → FastAPI8100 → Gemini thất bại. Diagnostics nội bộ của chính exception chain ghi:

```json
{"category":"RATE_LIMIT_OR_QUOTA","http_status":429,"operation":"extract","service_code":"PROVIDER_UNAVAILABLE","service_status":503}
```

File riêng còn có request UUID trùng UUID trong error envelope và document UUID đã validate. Không lưu provider body, prompt, header, key, cookie hay raw exception. Correlation envelope/log được kiểm chứng bằng integration unit test; diagnostic này là từ provider thật, không phải fake-model test. UI/job actual trả `failed`, `retryable=true`.

**Kết luận có bằng chứng:** upstream HTTP429 → adapter hết retry/budget hiện hành →503 `PROVIDER_UNAVAILABLE` → job failed. Không có bằng chứng timeout/DNS/5xx/auth/model-not-found gây lần lỗi này. **UNDETERMINED:**429 do giới hạn tốc độ hay quota nào, reset lúc nào; không đọc lỗi raw hoặc đoán billing. Không đổi key/model/quota/deadline/concurrency, không tăng request để dò quota.

Chỉ một document extraction được dispatch trong lượt chẩn đoán; adapter vẫn dùng retry policy cũ (tối đa3HTTP attempts, số thực tế không được đo riêng). Sau429, circuit trong test runner chặn PREPAYMENT upload và immediate retry. Sau đó chỉ chạy `recovery-independent`, không tạo document job/provider extraction. Không chạy lại subset3 hoặc10PDF live.

**Successful retry đúng failed job: BLOCKED bởi provider.** Lượt trước đã thử cùng job và vẫn thất bại; lượt này không retry vào429 đã biết. DB của lượt trước đã được disposable cleanup nên không thể nhận là đã khôi phục job đó. Harness hiện giữ binding snapshot và kiểm document ID/version/hash, job ID khi explicit retry; không tạo upload/job mới để che lỗi. Read-only SQL binding audit được thêm sau run chẩn đoán, vì vậy không tự nhận đã có SQL audit cho `D6IWaG`. Chỉ được ghi PASS successful recovery khi provider hoạt động và có actual retry/publication/source proof trong cùng sandbox session.

## Kết quả browser hiện tại

Case IDs chỉ trình bày bằng alias `REC-01`/`PRE-01`; UUID synthetic thật nằm trong evidence private. Fresh SCRAM PostgreSQL15432, migrations0001–0017, API/worker roles riêng, private storage; Next3000 của owner. Không dùng DB owner. AI service được cấu hình `live`; lượt độc lập có **0extraction calls**, không phải mock success.

| Bước | RECEIVABLE | PREPAYMENT | Evidence/assertion |
| --- | --- | --- | --- |
| Login sai/đúng; Counterparty create/edit; case | PASS | PASS | Generic401, persisted unresolved identity; đúng seller/buyer, exact amount/term |
| Upload/job/live extraction/source/correction | FAIL429 trong run chẩn đoán; BLOCKED lượt cuối | BLOCKED circuit429, BLOCKED lượt cuối | Không fallback mock; không nhận historical source-viewer PASS làm current |
| Review độc lập FHI; request approve/export | PASS | PASS | Review thật, current finding, frozen approved export bytes |
| Native questionnaire/invitation/submit/revoke | PASS ở REC-01 | NOT RUN native riêng PRE-01 | Context không specialist cookie; self-reported assurance, exact raw response; revoke deny |
| Review3locale ×desktop/mobile | PASS6/6 | PASS6/6 | Human labels, raw company/money giữ nguyên, viewport fit |
| Unknown amount/term +required reasons | PASS | PASS | Blank/whitespace reason không write; lưu/reopen null+reason, không zero-fill; roles/kind/stage không đổi |
| Actual paid claim, unknown amount/date | PASS | PASS | Payer/payee đúng core roles; versioned staff declaration do server cấp; actual vẫn unverified |
| Real409, giữ draft, explicit rebase/resubmit | PASS | PASS | Hai browser sessions cùng revision; một winner, stale writer409; không tự retry; refresh/rebase không write; chỉ resubmit rõ ràng mới tăng revision |
| Financial multi-set/manual verification/stale/source edit | PASS | PASS | Hai sets cần chọn rõ; manual-source fidelity decision có actor/revision; Exposure edit làm stale; sửa source tạo revision/reset unverified |
| FHI null gates | PASS | PASS | score/band/grade/pd/points null,7components không phát điểm, assessment disabled |
| Keyboard tab navigation/dialog Escape/focus | PASS | PASS | Arrow/Home/End chọn/focus đúng tab; Escape đóng clean dialog và trả focus về Edit |
| Unsaved draft discard +logout/relogin | PASS dùng cả hai cases | PASS dùng chung scenario | Draft không sang case khác; logout làm GET401; relogin không phục hồi draft đã bỏ; không chứng minh cross-identity isolation |

Final run `LRoHlB`: base browser **28PASS/2BLOCKED**. Nhóm recovery mới **23PASS/0FAIL/0BLOCKED/5NOT RUN** (bao gồm setup/read/cleanup checkpoints; không phải23workflow độc lập). Global **54PASS/2BLOCKED**, Node1parent FAIL, **exit1 đúng** vì live vẫn blocked. `provider-diagnostics.json=[]`, `job-binding-audit.json=[]` và live-step dispatch bị chặn; không upload PDF trong profile độc lập.

Run `xqQJk3` trước sửa có6FAIL (2textarea/filter selector mỗi workflow và2focus assertions),10dependents BLOCKED; được giữ nguyên bằng chứng. Run chẩn đoán đầu vô tình thấy helper subagent còn đang soạn và import nó; phần P1 của run đó **không được chấp nhận**. Đã sửa wiring: chỉ chạy helper khi opt-in `AIC_RECOVERY_SCENARIOS=true` sau freeze/review; lưu fingerprint. Run cuối dùng helper đã review. Không sửa kỳ vọng API để tạo PASS.

Đã mở xem ảnh failure để xác định lỗi, và ảnh thật REC-01 sau rebase/PRE-01 sau financial source edit. Screenshots mask credentials/readonly/alerts; không HAR/video/raw trace. Không tuyên bố full accessibility audit.

## Source changes và kiểm chứng

| Files | Thay đổi có căn cứ |
| --- | --- |
| `services/ai/runner/{app.py,provider_diagnostics.py}`, `tests/test_provider_diagnostics.py` | Opt-in content-free classification; UUID correlation với error envelope hiện hành, không đổi HTTP/envelope/schema. Unknown error giữ UNDETERMINED; không ghi raw message/body/header.14tests PASS |
| `services/ai/extraction/grounding.py`, `tests/test_post_acceptance_grounding.py` | ISO U+2010 comparison, Unicode heading parentheses, standalone `Số chứng từ:` +UNC token rõ ràng. Original6PDFs hash-bound, quotes/pages/raw/IDs giữ nguyên; negative roles/dates/payment/injection/amount tests. Before19FAIL/36PASS, after59PASS; không đổi55expectations cũ |
| `apps/web/src/components/ui/modal.tsx` | Reproduced focus loss sau Escape do dialog bị React remove trước passive cleanup. Restore opener còn connected chỉ khi body đang focused; không giành focus đã được UI mới chọn. Browser cả hai workflows PASS |
| `apps/web/tests/acceptance-preparation/{browser-flows.cjs,recovery-scenarios.cjs,recovery-scenarios.test.cjs,README.md}` | Provider circuit/blocked gates, exact upload/retry bindings; P1 UI mutations thật và fail accounting. Sửa selector prefix cho textarea persisted text/native selects; sửa nested `has` scope và nhãn verification theo JSX |
| `apps/api/test/acceptance-runtime/{mvp-acceptance.cjs,provider-diagnostic-reader.cjs,provider-diagnostic-reader.test.cjs}` | Stderr typed allowlist, không lưu raw stderr; diagnostics/job binding audit; reviewed helper opt-in/fingerprint; provider-independent profile.2parser tests PASS |
| `scripts/prepare-source-checkpoint.cjs`, `scripts/tests/source-checkpoint.test.cjs` | Chỉ thêm3new AI source/test paths cần backup; secrets/runtime/AI evidence vẫn bị loại. Không stage |
| `docs/implementation/MVP-SANDBOX-README.md` | Sửa sai tên env retry trong tài liệu: code đọc `AIC_DOCUMENT_AUTOMATIC_RETRY`, không đọc `AIC_WORKER_AUTOMATIC_RETRY`. Không thay cấu hình operator; tuning phải được owner duyệt |

Hai REC04 role fields vẫn unknown: heading đồng thời nêu seller/payee hoặc buyer/payer, ASCII cũng bị ambiguity guard loại. Không tự phê duyệt role equivalence để bỏ guard. Các `Số chứng từ` không phải UNC rõ ràng cũng không được mở rộng. Chi tiết/negative evidence: `docs/implementation/post-acceptance-grounding.md`; helper scope: `post-acceptance-ui.md`. Full10PDF accuracy/canonical30: NOT RUN.

Final commands/results (không cộng overlapping suites):

| Check | Actual result |
| --- | --- |
| `pnpm api:build` | PASS/0 |
| `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm check:aic` | PASS/0;51FE unit +18consumer checks; boundaries unchanged về architecture |
| `node --test` reviewed10files: prior8offline files +recovery-scenarios +provider-diagnostic-reader |58PASS/0FAIL/SKIP; exit0 |
| `.venv/Scripts/python.exe apps/api/test/acceptance-ai-fixtures/run_unit_suite.py` |435PASS/4SKIP/1existing warning, exit0;9.49s. Không network/.env reads.4skips như trước: symlink,2missing canonical scans,Tesseract |
| Profile `recovery` / `D6IWaG` | Real provider429; base28PASS/1FAIL/1BLOCKED; exit1. Preliminary P1 outcomes excluded as explained |
| Profile `recovery-independent` / `LRoHlB` |54globalPASS/2BLOCKED, exit1; P1subset23PASS;0extraction calls |
| Backend196/security27 | HISTORICAL PASS từ báo cáo trước, **không chạy lại**: không đổi Nest/auth/ACL/storage/worker source, contracts hoặc migrations |

## Còn thiếu và runbook

**BLOCKED:** current successful live PREPAYMENT/RECEIVABLE extraction và correct-job successful recovery. Owner cần kiểm rate/quota/billing/availability của **key/model hiện hành** ở provider; chỉ báo trạng thái/reset time, không gửi key. Chưa đủ căn cứ yêu cầu thay model/key/quota. Không polling live để đo giới hạn.

**NOT RUN browser:** source-match/positive field verify, replace +source invalidation, wrong/correct request supplements/recheck/ack; issue decisions/waiver/revoke; actual session expiry và cross-identity isolation. Source scenarios cần reviewed source-to-party oracle và provider hồi phục; workflow/auth scenarios còn lại cần fixture/scenario riêng. API có nút/route không có nghĩa đã browser PASS. Public ingress/trusted-IP và numeric FHI vẫn đóng như trước.

Owner có thể kiểm tra phần độc lập ngay, giữ frontend3000 đang chạy và để3001/8100/15432 trống:

```powershell
pnpm api:build
$env:AIC_ACCEPTANCE_LIVE='true'
$env:AIC_ACCEPTANCE_PROFILE='recovery-independent'
$env:AIC_RECOVERY_SCENARIOS='true'
node scripts/test-local-postgres.cjs --test-concurrency=1 apps/api/test/acceptance-runtime/mvp-acceptance.cjs
```

Lệnh tự tạo/cleanup DB/storage/process riêng; **exit1 là expected khi hai live steps BLOCKED**, phải đọc riêng coverage JSON. Không dùng lệnh này để tuyên bố toàn MVP PASS. Không chạy đồng thời với suite khác dùng15432. Không dùng `dev:all`/launcher cũ; không đặt secret vào CLI hoặc chia sẻ logs chưa kiểm.

Sau khi provider được owner xác nhận khả dụng, đổi **test profile** sang `recovery` cho một lượt hữu hạn; không đổi operational provider budgets. Cần có đúng failed job trong cùng sandbox còn sống để kiểm recovery: ghi document ID/version/hash +job ID, lỗi committed/retryable và source còn current; retry qua UI một lần, kiểm cùng IDs/hash, attempts/revision/idempotency và provenance live/publication thật. Nếu429 lặp lại, dừng; không new upload/new key nhằm che outcome. Job có outcome chưa rõ phải reconcile, không retry mù. Healthz200/mode live không chứng minh model hoạt động.

Demo thủ công chỉ trên sandbox riêng operator tạo theo `MVP-SANDBOX-README.md`, với credentials/operator/API/worker roles riêng; không migrate/reset DB làm việc. Dùng ordinary separate terminals API/AI/worker/Next, không public ingress. Khi live fail, hiển thị đúng failed/unknown và vẫn có thể trình bày các thao tác DB/review/financial độc lập; không phát score/PD.

Phương án synthetic/mock chỉ là **kế hoạch, chưa bật/chưa nghiệm thu**: sandbox khác, hai phía khai báo mode tương thích, fixture preflight trước; mọi response/provenance/UI phải ghi MOCK rõ ràng. Không đổi runtime live sang mock âm thầm hoặc dùng mock để tuyên bố successful recovery. Demo live chỉ xét GO sau current two-flow +successful recovery evidence; production vẫn NO-GO.

## Git và evidence

Branch `duc`, HEAD `8b0b7ed9e983ba4a2ea4d43f79d1816eaad7dbf0`; index418entries/314changed paths giữ nguyên. Không stage/commit/push/reset/deploy, không DB owner mutation. Checkpoint cũ `AIC-MVP-Acceptance-Final-20261017` vẫn verify SHA-256 `d84da9b82dc400de78e6691a0f0eff05eed5f2ce767ae52f4cae01b9311c72fd`.

Evidence private: `C:/Users/52duc/Desktop/AIC-Post-Acceptance-Recovery-20261017`, gồm sanitized diagnostic/preliminary/final logs +coverage/screenshots, `FINAL-STATE.json`, `MANIFEST.json` và checkpoint receipts. Checkpoint source mới riêng `C:/Users/52duc/Desktop/AIC-Post-Acceptance-Recovery-Source-20261017`; không overwrite checkpoint đã phát hành. Receipts ghi exact counts/hash sau source/tests/docs ổn định. Không copy DB/private-source/provider responses/secrets. Owned API/AI/worker/PG đã dừng; giữ Next3000 của owner.
