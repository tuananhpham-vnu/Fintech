# Phase 2 — Git tracking và checkpoint đề xuất

## Current MVP v2 byte checkpoint — 17/10/2026

This section supersedes older path counts below. Original314 staged changed paths are preserved; v2 modifications/new files are intentionally not silently restaged. `git ls-files` confirms storage.service.ts and the audit tracked; `git check-ignore -v --no-index` shows narrow allow exceptions. Env secrets and runtime storage remain ignored. Added only a narrow allow rule for sanitized technical `docs/implementation/evidence/mvp-v2/*.txt`; no credential/runtime/PDF rule relaxed.

Read-only allowlist scan has0blockers; removed runtime pending-contract helper is explicitly recorded as deletion and retained only under test helpers. The source-only byte package `C:/Users/52duc/Desktop/AIC-MVP-Review-v0.4.0-20261017/` is the review checkpoint: current source including untracked/unstaged bytes, older index bytes, Git metadata, SHA256 manifest and verification script. Full source/index hashes are inside the package, not merely an inventory. Canonical AI1.0.2 source/contracts unchanged. No commit/push/reset/user-data backup. Final source inventory remains a supplementary hash list, not the byte checkpoint.

After independent review/owner approval, use the read-only scanner then explicitly review/stage intended changes and commit only when requested. No commit/stage command was automatically executed for this v2 delta.

## Historical checkpoints

**Cập nhật 17/10:** owner đã cho phép cleanup whitespace trên14file.127 diagnostics được xử lý và kiểm staged diff sau review/stage theo [document report](BACKEND-DOCUMENT-PREPARATION-REPORT.md). Checkpoint mới gồm270 changed paths; các số127FAIL/259paths bên dưới là mốc lịch sử trước cleanup. Không commit/push; canonical AI/PDF bytes giữ nguyên.

17/10/2026, branch `duc`, HEAD `8b0b7ed9e983ba4a2ea4d43f79d1816eaad7dbf0`.

## Cập nhật sau yêu cầu chuẩn bị checkpoint

User đã cho phép chuẩn bị checkpoint (chưa commit/push). Lead dùng `scripts/prepare-source-checkpoint.cjs` để dry-run path allowlist/content scan rồi stage chính xác candidate paths. Source/API/frontend hiện hành, assets cần thiết, docs kỹ thuật, contracts foundation và3 migrations được đưa vào index; root plan cá nhân, archive logo trùng lặp, secrets/runtime/generated data được loại. Các PDF mới chỉ thuộc11 synthetic fixtures đã đọc/đối chiếu nhãn và pin SHA256, gồm malformed fixture dùng negative test; không thêm PDF thực tế.

Command chuẩn bị: `node scripts/prepare-source-checkpoint.cjs` (read-only); `--stage` thực hiện `git add` với pathspec từ danh sách đã kiểm, không force-add. Nếu có provider token/private key/URL credential không được duyệt hoặc staged path ngoài allowlist, script dừng trước stage. URL giả chứa user/password chỉ được miễn trừ ở đúng file negative-test frontend đã review, không phải miễn trừ chung cho credentials.5 tests kiểm quy tắc path, PDFs, secret patterns và ngoại lệ hẹp.

Scan theo pattern và manual path/PDF review không thay thế secret scanner chuyên dụng; không tuyên bố kiểm tra bao phủ mọi dạng secret. Cần owner review staged diff trước commit. Index đã chuẩn bị giúp source có Git blob để review, **chưa phải commit lịch sử hoặc backup ngoài máy**. Các đoạn “chưa stage” bên dưới ghi baseline preparation trước yêu cầu mới; xem [báo cáo incremental](BACKEND-PHASE-2-INCREMENTAL.md) và `git diff --cached --stat` cho trạng thái hiện tại.

Staged checkpoint hiện gồm259 changed paths, thêm `.gitattributes` binary rules cho đúng thư mục synthetic PDF để ngăn CRLF conversion. `git diff --cached --check` còn FAIL exit2 do127 whitespace/EOF diagnostics từ14 text files có sẵn; không tự sửa frontend/handoff hoặc bỏ check. Source/PDF index consistency và path/secret-pattern verification được kiểm riêng, không coi whitespace FAIL là đã PASS.

## Đã kiểm tra

- `git status --short --branch`: foundation, frontend và nhiều tài liệu/scripts vẫn **untracked**. Lúc bắt đầu lượt này có233 file untracked trong apps/api, apps/web, docs, scripts, tests và foundation contracts (số tăng khi tạo deliverables mới).
- `git ls-files --stage apps/api docs/audits/CODEX-PRODUCTION-READINESS.md`: không có kết quả. Source hiện diện trên đĩa nhưng chưa có checkpoint Git; branch/HEAD không chứa những file này.
- `git diff --cached --stat`: rỗng; không tự stage/commit. Root README/apps README/.gitignore có thay đổi từ trước, được giữ nguyên.
- `git check-ignore -v`: các negation cho storage `.ts` và technical docs hoạt động; `apps/api/.env`, runtime storage vẫn bị ignore. `.env.example` là file mẫu discoverable. Không mở thêm ignore rule trong lượt này.
- `git ls-files` scan theo filename không thấy `.env`, `.pem`, `.key`, hoặc runtime/private/holdout/real directory trong index. Đây là kiểm tra tên file, **không chứng nhận không có secret trong nội dung**. Sáu PDF fixtures đã tracked từ baseline không được thêm/sửa.
- `git diff --exit-code` cho tracked FE/AI/legacy contracts sạch; vì FE untracked, kiểm tra này không đủ chứng minh mọi FE byte bất biến. Các agent chỉ được ghi trong scope backend mới/runbook/preflight; không có lệnh ghi frontend/AI trong lượt này.
- SHA256 feasibility script vẫn `f9a1531a91a4384308e72b37b276bc1c1b842a3b6d9cebc3522eca0686cd6a90`.

`scripts/source-checkpoint-inventory.cjs` dùng Git candidate list và SHA256 để tạo [inventory](phase-2-source-inventory.json) của technical source/config/docs; bỏ secrets theo tên, binary/PDF/runtime/real/holdout, dependencies và symlink. Nó chỉ đọc và ghi JSON ra stdout, không stage hay copy source. Manifest chứa hashes, **không phải backup**, và không bao gồm chính nó. Tracked unchanged source cũng được liệt kê để hỗ trợ đối chiếu. Chạy lại sau khi source thay đổi nếu muốn manifest mới.

## Checkpoint đề xuất, chưa thực hiện

Ưu tiên một **local Git checkpoint do owner chủ động tạo sau review**, trước đổi branch/merge/cập nhật phụ thuộc hoặc triển khai slice tiếp theo. Không cần push để bảo toàn snapshot local. Chưa có authorization commit trong lượt này nên agent không thực hiện stage/commit.

1. Kiểm tra diff tracked và inventory/untracked. Review riêng root WIP, technical docs và source mới; kiểm secret nội dung với công cụ nội bộ đã duyệt. Không dùng force-add/`git add .` hoặc bỏ ignore hàng loạt.
2. Stage có chọn lọc source/config/backend/FE hiện hành và tài liệu đã review. Các path dự kiến: `.gitignore`, `README.md`, `apps/README.md`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/api`, `apps/web`, `packages/contracts/aic-foundation`, technical docs trong `docs/integration`, `docs/audits`, `docs/implementation`, `docs/api-collection`, scripts đã review và synthetic fixtures đã xác nhận nguồn. `.env.example` được review, không stage `.env*` chứa giá trị thật. Không tự thêm PDF mới; synthetic PDF cũng chỉ thêm sau xác nhận provenance.
3. `git diff --cached --name-status`, `--stat`, `--check` và nội dung diff phải thể hiện đủ SQL/source/storage service/audit/contracts. Kiểm tra staged binary/secrets; file kế hoạch cá nhân `AIC_REFACTOR_PLAN.md` không tự đưa vào checkpoint.
4. Owner tạo local commit với thông điệp mô tả foundation + Phase2 preparation, rồi kiểm `git status` và `git show --stat`. Không push hoặc deploy từ kế hoạch này.

Nếu chưa muốn commit, lựa chọn thay thế là snapshot **source có allowlist** ra thư mục backup riêng và verify restore/hash trên bản sao trước tiếp tục thay đổi lớn. Không tự tạo archive ở đây vì user yêu cầu đề xuất checkpoint, chưa chọn cách lưu. Snapshot phải chứa untracked source và modified tracked files; `git diff`/`git bundle` chỉ với HEAD sẽ bỏ sót phần lớn foundation. Không coi `stash` hoặc branch mới từ HEAD là backup cho untracked/ignored data.

**Rủi ro còn lại:** inventory giúp phát hiện thiếu/thay đổi, không phục hồi được bytes nếu mất workspace. Checkpoint thật vẫn chờ owner chọn/tạo hoặc cho phép tạo. Không reset, checkout/rebase, clean, xóa WIP, commit hay push trong lượt này.
