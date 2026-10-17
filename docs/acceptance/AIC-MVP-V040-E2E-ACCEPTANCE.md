# AIC MVP v0.4.0 — nghiệm thu tích hợp thực tế

Ngày kiểm chứng: 17/10/2026, Asia/Saigon. Phạm vi: thực thi yêu cầu orchestration đã được owner xác nhận, trên working tree local; không phải audit lại toàn bộ nghiệp vụ.

## 1. Baseline và an toàn dữ liệu

- Branch `duc`; HEAD `8b0b7ed9e983ba4a2ea4d43f79d1816eaad7dbf0`. Có 314 paths trong index từ trước; index không được stage/reset/commit trong lần nghiệm thu này. HEAD không đại diện toàn bộ ứng dụng đã kiểm thử.
- Snapshot cũ `C:/Users/52duc/Desktop/AIC-MVP-Review-v0.4.0-20261017` chỉ dùng đối chiếu; không restore đè lên working tree. Manifest SHA-256: `a96cbf6c6d97d663bc944a3a7bccc639896b107eeb219d40603a91952a6f5176`.
- Checkpoint trước sửa: `C:/Users/52duc/Desktop/AIC-MVP-Acceptance-Baseline-20261017`; 441 source +397 index copies, hash từng file đã kiểm tra. Manifest SHA-256: `a361e077617067acd786c22c842e4be5018fcb23b5ff0363a746dc8e21c08517`.
- Checkpoint đầu **không hoàn chỉnh**: loại toàn bộ hai launcher mới có credential nhúng (`scripts/dev-all.cjs`, `start-dev.ps1`); giữ hash/lý do, không sao chép secret. Sau kiểm chứng, thay launcher bằng fail-closed để loại credential/process killing khỏi source; không chạy launcher cũ. Checkpoint cuối được ghi tại mục 9 và manifest bên ngoài repo.
- `git ls-files` xác nhận `apps/api/src/storage/storage.service.ts` và báo cáo audit đã tracked. `git check-ignore -v` xác nhận tài liệu acceptance được unignore, `.env` vẫn ignore. Bổ sung allowlist tài liệu acceptance và launcher đã làm an toàn; không force-add dữ liệu.
- Không đọc/in ra credential từ `.env` trong báo cáo. Harness chỉ nạp provider/model/prompt nội bộ khi chạy live. **Không dùng PostgreSQL password hay database của owner**: launcher dùng binary PostgreSQL18 đã cài để tạo cluster mới với SCRAM password ngẫu nhiên tại port15432. Chạy migrations0001–0017 chỉ trong database tạm do phiên sở hữu; API/worker dùng hai role riêng không superuser/createdb/createrole.
- Storage tạm dùng private Windows DACL; không đưa DB, runtime source objects, customer PDF, key, cookie, CSRF hay invitation token vào Git/checkpoint. Không commit/push/deploy. Frontend3000 do owner khởi động; không tìm cách khởi động Next qua đường khác sau tool-policy rejection.

## 2. Ba gói Gemini: tiếp nhận có kiểm định

| Gói | Inventory và kết luận | Thực tế kế thừa |
| --- | --- | --- |
| UI | 9 specs/24 cases; original suite **NOT RUN**. Selector/label đã cũ; trường hợp chỉ đếm element, chấp nhận 0 kết quả, không tạo xung đột409 thật; selector `saveButton` không tồn tại; flow native/financial chưa chứng minh mutation. Setup có credential/default record/retry làm mất isolation. | Ý định scenario; viết browser helper mới, mỗi lần tenant/DB mới, thao tác ghi qua UI, cùng session chỉ dùng GET bổ sung; không interception/mock success. Chi tiết: `docs/implementation/acceptance-ui-review.md`. |
| Backend/security | Original hai stress scripts + runner **NEVER EXECUTED**. Có fallback DB không an toàn, URL credential logging/on-disk child credentials, disable immutable trigger, race/crash coverage chưa đủ và che teardown error. | Hai suite mới + harness/child/protection/runner: 6 scripts dưới `apps/api/test/acceptance-security/`. Identity proof, exact runtime grants, owner-only process cleanup. Chi tiết: `docs/implementation/acceptance-be-review.md`. |
| AI | 10/10 synthetic PDF hash đúng, native inspect10/10. Ground truth không thể tin nguyên trạng:18/54 quotes không exact, font biến dấu, nội dung bị cắt, enum sai,17/76 registry slots chưa có oracle, narrative mâu thuẫn. | Giữ nguyên PDF bytes/hash; curate oracle riêng từ nguồn thật. Subset3 PDF: text, image-only scan, visible injection prefix. Không dùng phần payload bị cắt để tuyên bố chống injection đầy đủ. Chi tiết: `docs/implementation/acceptance-ai-review.md`. |

Gemini i18n patch có trong working tree và đã đối chiếu với snapshot; không overwrite patch. Baseline FE checks PASS không chứng minh patch đúng: probe độc lập ban đầu4PASS/5FAIL. Các lỗi nguyên văn/fallback/own-property được tái hiện rồi sửa; probe sau sửa PASS. Một subagent phụ trách nhãn financial, lead tích hợp và kiểm thử browser; shared contracts/migrations không đổi.

## 3. Những gì đã sửa thực tế

| Defect có bằng chứng | Sửa tối thiểu và kiểm chứng |
| --- | --- |
| Launcher nhúng credential, khởi động/kill nhiều process | `scripts/dev-all.cjs`, `start-dev.ps1` fail-closed; bỏ ExecutionPolicy Bypass khỏi command package. Test xác nhận không spawn/kill/credential và exit1; không chạy bản unsafe. |
| Private-cache provisioning thất bại vì `Set-Acl` module không nạp được trong PowerShell runtime | Dùng `[IO.Directory]::SetAccessControl` với cùng user/SYSTEM/admin DACL, như launcher PG hiện hành. Test Windows thật kiểm tra private ACL và từ chối path có sẵn. Không nới quyền. |
| i18n dictionary nhận inherited properties; mapper sửa raw unknown text; missing_reason do staff có thể bị dịch nhầm | Own-property checks; giữ byte nguyên văn unknown/raw slots; nhãn generic có raw trong disclosure. Sửa `review-i18n.ts`, `status.tsx`, `extraction-review.tsx`, `document-review.tsx`, `messages.ts`; regression kiểm tra raw company/value/quote/hash/page và prototype keys. |
| Native respondent hiện unavailable dù invitation hợp lệ trong Next development | Effect đọc token rồi xóa fragment; Strict Mode replay đọc fragment rỗng và ghi đè token. `respondent-form.tsx` dùng ref bảo đảm chỉ consume một lần. Browser cookie-free submit/receipt và revoke denial đã PASS; không thay assurance/auth semantics. |
| Financial registry/reference cards hiển thị system keys và công thức raw làm nhãn chính | Nhãn en/vi/zh-CN tại `features/financial/labels.ts`, registry và `fhi-breakdown.tsx`; raw codes/formulas ở details. Không thay input value, formula, scoring hay source text. Tests kiểm tra labels/unknown/prototype/render/raw preservation/null gate. |
| Extraction/correction headings hiển thị namespace legacy và field codes | `features/documents/field-labels.ts` có nhãn35registry keys/3locale; tích hợp trong extraction-review/field-correction. Giữ source seller/payee và buyer/payer theo1.0.2, không đổi thành application roles; unknown/version khác dùng generic, raw key ở details.5unit tests +render probe +browser RECEIVABLE3locale PASS. |
| AI unit vẫn đòi prompt `extraction-v1` | Commit HEAD, extractor và schema xác nhận v2 có chủ đích. Chỉ sửa literal expectation +rationale trong `services/ai/tests/test_extraction.py`; không sửa AI implementation. Full units362PASS/4SKIP. |
| Harness UI dùng exact label chứa option text; đọc legacy endpoint qua proxy không cho phép; stale component sau hash navigation | Sửa selectors theo JSX, refresh trước scenario độc lập, poll dữ liệu async. Legacy provenance kiểm tra qua authenticated Nest session của runtime; **không mở proxy allowlist** để làm test PASS. Không thay kỳ vọng wire/API. |

`scripts/test-e2e-feasibility.cjs` đã có reporter exit accounting từ slice trước: import không chạy suite, assertion FAIL/empty/fatal/nonzero được kiểm thử bằng process tests. Chạy lại regression hiện tại; không dùng prototype runner làm chứng cứ production behavior, không đổi expectation400/409 để đạt PASS.

## 4. Runtime và bằng chứng

Harness mới: `apps/api/test/acceptance-runtime/mvp-acceptance.cjs`. Chỉ chạy qua launcher disposable có opt-in/identity proof; verify current_user/database/data_directory/postmaster +password proof. Frontend3000 của owner → Next `/api/v2` proxy → Nest3001 → PostgreSQL15432/actual worker → FastAPI8100 mode live → provider thật. `X-AI-Mode`, schema1.0.2, source hash và provenance đều được kiểm tra. Chromium installed1243 được chỉ định bằng executable path; không cài browser mới.

Mỗi lần chạy tạo random synthetic specialist/org/case, private storage, internal key, runtime roles. Finally dừng process/cluster thuộc phiên và xóa đúng DB/roles tạm. Không stop frontend của owner. Không trace/HAR/video vì có thể ghi credentials/token; screenshot che password và tất cả readonly inputs. Không chụp URL chứa token fragment.

Bằng chứng lưu riêng tại `C:/Users/52duc/Desktop/AIC-MVP-Acceptance-Evidence-20261017` với private ACL; manifest file/hash bên ngoài repo. Chỉ copy synthetic screenshots, exports, sanitized logs/JSON; không copy `private-source`, DB hay credential files. Evidence paths gốc trong JSON là historical temp paths; bản sao lưu bền tương ứng nằm dưới evidence root.

| Run | Kết quả và cách diễn giải |
| --- | --- |
| `RTLMMl` / profile full |3 PDF live subset PASS15/15; hai core API→DB→worker→liveAI→DB/source PASS. Browser lúc đó FAIL do selector; tổng run exit1. Không gọi whole run PASS. |
| `L8kh2I` / profile browser |30/30 browser steps +3 runtime checks PASS; Node1test/1PASS, exit0. Hai core đi từ browser upload tới actual worker/liveAI, source canvas/hash/zoom, correction giữ raw;21 screenshots,2 exports. Đây là lần cả hai flow browser PASS, trước bổ sung financial labels cuối. |
| `BbKkxD` / bổ sung financial checks |29PASS/4FAIL checkpoints, exit1. Một job không completed (chưa đủ diagnostic để kết luận nguyên nhân),1 asynchronous company-name assertion,2 primary-code leaks. Giữ kết quả; sửa wait và FHI presentation rồi test lại. |
| `l5C4AT` / financial presentation retest |32PASS/1FAIL checkpoints, exit1. Cả12 locale/viewport review checks, native lifecycle,2financial null gates +vi/zh mobile checks PASS. PREPAYMENT upload job `failed`, `retryable=true`, `PROVIDER_UNAVAILABLE`; không có mock fallback, không publish success. Giữ FAIL, không gọi đây là PASS toàn bộ. |
| `GcZBmG` / source release retest |34checkpoints:32PASS/2FAIL;30browser steps:29PASS/1FAIL; Node1test/1FAIL, exit1. RECEIVABLE upload/live/source/correction và extraction headings3locale PASS. PREPAYMENT initial-provider attempt FAIL; một explicit UI retry vào cùng job cũng `PROVIDER_UNAVAILABLE`, nên flow FAIL. Không tạo upload mới để retry, không xóa first failure khỏi gate.27screenshots +2exports; các review locale/native/financial checks PASS. |

Các lỗi harness ban đầu (payload thiếu role/source_origin, thiếu Chromium mặc định, PowerShell provisioning, selector exact, legacy proxy404) được ghi trong logs/debug runs; không phải lỗi contract đã được chứng minh. Rerun browser không gọi lại subset3 PDF đã PASS. Các lần chạy đều serial trên15432.

## 5. Ma trận hai workflow

`HISTORICAL PASS` là bằng chứng đã chạy thật, không tự biến thành PASS cho build mới. `NOT RUN` là chưa có browser coverage trong lần này, dù unit/integration có thể đã cover.

| Hành vi | RECEIVABLE | PREPAYMENT | Điều được chứng minh |
| --- | --- | --- | --- |
| Invalid/valid login; Counterparty create/edit | PASS | PASS dùng chung setup | Login sai401; persisted unresolved identity, không tự verify |
| Case creation, amount, term và party roles | PASS | PASS | Organization seller/counterparty buyer; organization buyer/counterparty seller; money string nguyên vẹn |
| Browser PDF upload → live worker → extraction | HISTORICAL PASS +latest RECEIVABLE PASS | HISTORICAL PASS; latest FAIL provider unavailable | Không mock, exact schema/hash/provenance; thất bại không publish |
| Source viewer canvas +hash +zoom | HISTORICAL PASS | HISTORICAL PASS | PDF thật render; hash browser kiểm chứng, raw version/source giữ nguyên |
| Field null correction/raw preservation | HISTORICAL PASS | HISTORICAL PASS | Effective null, raw field và legacy output bất biến; không tuyên bố legal/payment verification |
| Run document review độc lập FHI | PASS | PASS | Findings thật; numeric method unconfigured không chặn document review |
| Request draft/approve/export | PASS | PASS | Gắn current finding, approved frozen payload; download bytes=authenticated re-export |
| Review en/vi/zh-CN ×desktop/mobile | PASS6/6 | PASS6/6 | Known code/severity/summary localization; raw company và số tiền không dịch; viewport fit |
| Native questionnaire/invitation/submit/revoke | PASS trên RECEIVABLE | NOT RUN browser riêng | Context không specialist cookies; assurance=self_reported_capability_only; SME_direct, entered_by=null, raw answer giữ nguyên; original token bị deny sau revoke |
| Financial create/decimal/manual provenance/null gates | PASS | PASS | Raw1000.25, normalized1000.25, unverified;7metrics; score/band/grade/pd/points null; run assessment disabled |
| Financial vi/zh mobile | PASS | PASS | System codes trong details; nguyên văn source label còn nguyên; không kích hoạt FHI |
| Positive source match/field verify, replace/stale, Exposure edits/claims/unknown term | NOT RUN browser | NOT RUN browser | Không suy ra từ sự hiện diện của nút |
| Issue decisions/waiver/revoke; wrong/correct request supplement/recheck/ack | NOT RUN browser | NOT RUN browser | Cần scenario riêng, không tuyên bố complete MVP feature acceptance |
| Financial multi-set/human verify/stale; session expiry/draft isolation/keyboard | NOT RUN browser | NOT RUN browser | Các regression BE/consumer không thay thế browser |

Đã mở và xem screenshots thật của cả hai source viewers, review EN/VI/ZH desktop/mobile, native receipt và financial VI/ZH mobile. Một số ảnh fullPage dài được render thu nhỏ; chứng cứ fit viewport còn có assertion browser. Không tuyên bố keyboard/accessibility audit đầy đủ. Trong screenshot test case subject vẫn unresolved: PDF synthetic không tự làm identity hoặc settlement thành verified. Review trở thành stale sau request mutation là hành vi được giữ nguyên.

## 6. Commands và kết quả đã quan sát

Từ repo root; không cộng gộp số tests có phần overlap. Node parent tests không phải leaf scenarios độc lập.

| Command/suite | Mode | Result / exit |
| --- | --- | --- |
| `pnpm api:build` | Build thật | PASS/0 |
| `pnpm build` | Next production build | PASS/0 trên source trước final presentation refinement; final build cập nhật ở mục9 |
| `pnpm typecheck` | Current FE | PASS/0; không bỏ qua lỗi duplicate key đã phát hiện và sửa |
| `pnpm lint` | Boundaries +Prettier | PASS/0 sau sửa; baseline lint FAIL5files chỉ formatting được giữ trong log |
| `pnpm check:aic` | Architecture/unit/consumer |46unitPASS +18consumerPASS;102runtime files/11modules, exit0 trước final extraction-label addition |
| `pnpm api:test:mvp` | Disposable real PostgreSQL |196PASS,0fail/skip/cancel, exit0;40.954s. Không thay app BE source sau baseline |
| `node apps/api/test/acceptance-security/run-security-tests.cjs --run` | Disposable PG, actual services/worker, AI stub portions explicit | Lead serial repeat27/27PASS=25leaf+2parents,0skip/cancel, exit0;22.001s; clusterf2JjGY stopped |
| Independent noDB protections/runner/cache/adapter helper/i18n tests | Native Windows ACL +unit/fake boundaries |40PASS/0 trước thêm1FHI render probe; latest focused10i18n+2browser harnessPASS/0 |
| `node --test scripts/tests/feasibility-runner.test.cjs .../browser-flows.test.cjs` | Runner process assertions |15PASS/0; tests assert false PASS logs/empty/fatal/import behavior and blocked dependents |
| `.venv/Scripts/python.exe .../run_unit_suite.py` | Offline AI suite, no provider/network/.env loading |362PASS/4SKIP/1warning, exit0;10.36s |
| `.../review_bundle.py` | Physical synthetic PDF review |10hashes/10native inspectPASS; oracle defects retained |
| `.../offline_checks.py` | Actual grounding with deterministic fake model |FAIL/1 retained:8missing of40scored values,24 attribute mismatches,3/6docs all scored attributes match. Không phải live accuracy |
| Reviewed actual live subset | FastAPI +real provider |3/3docs PASS,15/15 scored values; missing0/incorrect0; source/schema/quote/page/provenance checks. Không đại diện full10PDF/canonical30 |

BE crash tests dùng actual worker child chết sau materialize/heartbeat. Đoạn AI stall và recovery publication **MOCK**, không là bằng chứng provider extraction. Coverage có hai hướng ordering của capability revoke/close và worker fences; noDB protections7PASS. Không reproduce source/business defect trong stress suite.

AI4SKIP: Windows symlink privilege,2 canonical scan PDFs thiếu, Tesseract chưa cài. OCR scan live subset dùng Gemini thật; không thay thế canonical fixtures. AI service implementation và frozen1.0.2 bundle không đổi. Chưa chạy canonical30/parity và chưa phê duyệt method/pilot.

Reproduce controlled browser (frontend3000 phải do owner khởi động bằng lệnh bình thường):

```powershell
$env:AIC_ACCEPTANCE_LIVE='true'
$env:AIC_ACCEPTANCE_PROFILE='browser'
node scripts/test-local-postgres.cjs --test-concurrency=1 apps/api/test/acceptance-runtime/mvp-acceptance.cjs
```

Không chạy đồng thời với DB stress/regression; không tự đổi sang DB có sẵn. `profile=full` còn chạy subset3 +hai API pipelines, tăng số provider calls; chỉ dùng khi cần kiểm tra lại lớp đó. FAIL/BLOCKED làm Node exit khác0, không silent success.

## 7. Blockers còn lại và quyết định phát hành

1. **Live provider chưa ổn định trong các lượt lặp**: latest PREPAYMENT có `PROVIDER_UNAVAILABLE`, retryable; explicit UI retry đã được thực hiện đúng vào cùng job nhưng provider vẫn unavailable. Chưa xác định upstream quota/network/model availability bằng chứng nào; không tự quy cho nguyên nhân cụ thể. Không đổi key/model, tăng quota hoặc fallback mock. Cần phục hồi availability và kiểm chứng successful recovery trước một demo không có người điều phối.
2. **AI layout support gaps thật, chưa sửa service**: ISO date với U+2010 bị loại; labelled party IDs với Unicode parentheses bị role guard loại; nhãn `Số chứng từ` không được payment-ref guard nhận. Giữ raw/evidence và unknown; không ép ground truth hoặc silently verify. Chưa chấp nhận toàn bộ10PDF benchmark.
3. **Coverage thiếu nêu tại ma trận**: cần bổ sung browser scenario cụ thể theo release scope, không thêm vòng audit chung. Full MVP feature acceptance chưa hoàn thành.
4. **Public ingress/trusted client IP chưa chốt**: Next proxy/client IP/anti-spoofing vẫn blocker production. Không blanket trust proxy, không public deploy.
5. **FHI numeric chưa được duyệt**: method/pilot và canonical30 chưa có; toàn bộ null gates giữ nguyên. Demo document/Transaction Review được phép, không demo điểm tín dụng/PD giả.
6. Credential từng nhúng trong launcher không được copy vào checkpoint; cần owner tự xử lý rotation nếu đã chia sẻ credential đó ra ngoài. Không đổi credential/database của owner trong phiên.

**Production: NO-GO. Full MVP acceptance: PARTIAL.** Controlled local demo đã có bằng chứng chạy thật hai workflow, nhưng chưa cấp GO vô điều kiện khi provider còn FAIL ở lượt lặp. Chỉ dùng bộ synthetic đã kiểm chứng, mạng/provider hoạt động, không public exposure, không numeric FHI và thông báo rõ phần chưa nghiệm thu. Kết luận cuối sau retest ghi tại mục9; historical PASS không xóa FAIL mới.

## 8. Công việc song song tiếp theo

| Task | Owner/file ownership | Dependency và acceptance |
| --- | --- | --- |
| ACC-UI-02 | UI test agent; chỉ specs mới dưới acceptance-preparation | Dùng shared runtime của lead, serial DB. Unknown amount/term/claims,409 giữ draft, issue/waiver, wrong/correct supplement; thao tác thật +assert persisted effect. Không sửa contract/source chung. |
| ACC-AI-02 | AI specialist; branch/scope AI riêng sau owner duyệt sửa service | Tái hiện3grounding gaps bằng original bytes/quotes; đề xuất exact normalization-for-comparison không sửa evidence/roles; guard negative tests +live limited subset. Không đổi1.0.2 business meaning. |
| ACC-SEC-02 | Security agent; noDB/proxy specs riêng | Trusted ingress contract do owner chốt trước implementation. Chưa chốt vẫn có thể viết anti-spoofing negative tests/đề xuất topology. |
| ACC-FIN-02 | Financial test agent; scenarios riêng | Multi-set/manual verify/stale/source change; mọi rating field null; canonical parity chỉ sau nhận reference package và phê duyệt method. |
| ACC-OPS-02 | Lead/operator | Safe final checkpoint; provider failure/manual retry reproducibility; runbook local stack, no userDB mutation. Shared runtime/migrations/contracts chỉ một writer. |

Các agent review ban đầu đã đóng sau hoàn thành; không tiếp tục sửa trùng file. Không tạo thread hoặc gửi message ra ngoài dự án.

## 9. Final verification và checkpoint

Final source verification, sau tích hợp nhãn extraction và FHI:

| Check | Kết quả cuối |
| --- | --- |
| `pnpm build` | PASS/exit0, Next production build, routes gồm proxy/cases/counterparties/respondent |
| `pnpm typecheck` | PASS/exit0 |
| `pnpm lint` | PASS/exit0;103runtime files/11modules, Prettier PASS |
| `pnpm check:aic` |51unitPASS +18consumerPASS, exit0 |
| Independent noDB suite (same8files ở mục6, gồm runner/cache/security/adapter/browser/i18n) |42PASS,0fail/skip/cancel; exit0. Có11offline rendering/i18n probes; không gọi đây là live browser |
| Final real browser `GcZBmG` |FAIL/exit1 như mục4; không tự chạy tiếp provider sau một explicit retry thất bại |
| Git index integrity |397source entries được chụp trước giữ nguyên OID/mode;21AI evidence entries không copy đã có nguyên trạng ở HEAD, không phải stage mới.314changed paths trong index không bị chỉnh. `index-integrity.json` ngoài repo ghi bằng chứng |
| AI/contracts integrity với pre-acceptance checkpoint |Chỉ `services/ai/tests/test_extraction.py` thay đổi; implementation AI và các contracts giữ byte nguyên trạng |
| Cleanup |Owned PG/API/AI/worker đã dừng;3001/8100/15432 không có listener;frontend3000 của owner vẫn giữ nguyên |

Final source checkpoint dùng thư mục mới `C:/Users/52duc/Desktop/AIC-MVP-Acceptance-Final-20261017`. `source/` giữ working source mới, `index/` giữ staged bytes riêng; **không restore index đè source**. Chạy scanner trước copy và verify manifest/hash từng file, kiểm tra không có file lạ/symlink. Kết quả machine-readable tại `C:/Users/52duc/Desktop/AIC-MVP-Acceptance-Evidence-20261017/checkpoint-final.json` và `checkpoint-final-verify.json`; số file và manifest hash chính xác nằm trong các receipt này để không tạo self-hash vòng tròn trong báo cáo được snapshot.

Evidence root có `MANIFEST.json` cho sanitized logs/JSON/screenshots/exports và `FINAL-STATE.json` ghi branch/HEAD/status/counts/checkpoint. Chứng cứ raw/runtime private không được đưa vào repo. Đây là nghiệm thu của working tree chưa commit, chưa kiểm chứng trên máy khác hoặc public deployment.

**Kết luận bàn giao: ACCEPTANCE_PARTIAL / CONTROLLED_LIVE_DEMO_NO_GO / PRODUCTION_NO_GO.** Không có blocker mới cần sửa schema/nghiệp vụ; việc ưu tiên tiếp là xử lý provider availability bằng diagnostic an toàn, sau đó kiểm tra đúng failed-job recovery và các browser scenario còn thiếu. Nền tảng và các flow đã PASS được giữ lại, không rewrite backend. Không tuyên bố MVP hoàn tất từ các helper/unit tests hoặc historical PASS.
