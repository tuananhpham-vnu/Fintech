# AIC Rating — FinTechathon 2026

Frontend và API hiện dùng PostgreSQL, lưu nguồn bất biến, worker PDF/ZIP, rà soát hồ sơ/giao dịch, yêu cầu bổ sung, bảng câu hỏi và Assessment có lịch sử/ghi nhận đã xem. Migrations hiện đến **0021**. Hợp đồng AI 1.0.2 được giữ nguyên; hợp đồng Assessment bổ sung nằm tại [aic-assessment](packages/contracts/aic-assessment/README.md). Luồng [đọc BCTC Việt Nam / Mỹ / Trung Quốc](docs/implementation/AIC-INTERNATIONAL-FINANCIAL-IMPORT-2026-10-18.md) dùng contract riêng, đối chiếu nguồn và xác minh trước khi tính tỷ số; chưa có điểm tín dụng/PD quốc tế đã kiểm định. Xem [runtime và phạm vi pilot được duyệt](docs/implementation/AIC-PILOT-RUNTIME.md). Code đã kiểm chứng local theo phạm vi từng báo cáo; chưa chứng nhận toàn hệ thống production.

Nhánh làm việc của Đức: **`duc`**. Commit và push công việc trên nhánh này; bàn giao vào `main` qua pull request để người phụ trách module đối ứng review.

Frontend hiện hành: **`apps/web`**, được tích hợp từ thư mục nhập `apps/FE Fintech` và đối chiếu Notion AIC 2.0.0 / CR-AIC-01 / METHOD-SYNC-01 ngày 16/10/2026. Checkout hiện không còn thư mục nhập đó; workspace ứng dụng gồm `apps/web` và `apps/api`.

AIC phục vụ chuyên viên SME đánh giá khách hàng trước bán chịu (RECEIVABLE) và nhà cung cấp trước trả trước (PREPAYMENT). LOAN/DEBT_INVESTMENT là luồng phụ. FHI thử nghiệm và rà soát giao dịch là hai đầu ra riêng. Owner đã duyệt pilot AIC-FHI-1.0/1.0.0 cho phân phối/bán buôn; máy chủ chỉ kích hoạt cho tổ chức/phạm vi ghi trong artifact riêng. Đủ bảy metric và dữ kiện được xác minh mới có điểm/band thử nghiệm. Thiếu artifact vẫn `unconfigured`; credit grade và PD luôn trống.

```text
apps/web (Next.js / React / TypeScript)
  → same-origin /api/v2 proxy
  → apps/api (NestJS foundation: PostgreSQL, session, ACL và scoped reads)
  → backend strict adapter → legacy AI service1.0.2

services/ai + bundle contracts1.0.2: giữ nguyên; local worker đã có, chưa production-certified
```

Không cấu hình `AIC_BACKEND_URL` vào AI service hoặc `/api/v1`. Contract đầy đủ AIC2 còn pending; contract foundation giới hạn nằm tại `packages/contracts/aic-foundation`. Proxy chưa cấu hình backend trả `503 BACKEND_NOT_CONFIGURED`; không tự thay bằng mock. Xem [backend README](apps/api/README.md) và [báo cáo Phase 1](docs/implementation/BACKEND-PHASE-1-REPORT.md) để biết phạm vi đã kiểm thử và phần BLOCKED.

## Chạy frontend từ gốc repo

Node.js 22 trở lên, pnpm **11.22.0**; lockfile chuẩn là `pnpm-lock.yaml` ở gốc.

```powershell
pnpm install --frozen-lockfile
pnpm dev --hostname 127.0.0.1 --port 3000
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Xem [frontend README](apps/web/README.md) để chạy QA tổng hợp riêng và cấu hình backend tương lai. `lint` gồm kiểm tra ranh giới kiến trúc và Prettier; chưa có ESLint trong dependency gốc.

Để chạy cả stack local, cần PostgreSQL đang hoạt động, `.venv` đã cài dependency AI và root `.env` có cấu hình thật. Sau khi build API, chạy từ gốc repo:

```powershell
pnpm api:build
pnpm build
pnpm local:serve
```

Lệnh này chạy web đã build tại `http://127.0.0.1:3000`, API `3001`, AI live `8100`, worker PDF đơn và worker tiếp nhận/trích xuất ZIP. Dùng `pnpm dev:all` nếu cần Next development mode. Giữ cửa sổ terminal mở; `Ctrl+C` dừng các dịch vụ do lệnh tạo. `pnpm dev` chỉ chạy frontend. Không chạy hai stack cùng lúc; `EADDRINUSE` nghĩa là cổng đang được một tiến trình khác dùng. Launcher kiểm tra cổng trước khi khởi động, không tự dừng tiến trình khác. ZIP tối đa 32 MiB; PDF đơn tối đa 10 MiB và 10 trang. Kết quả trích xuất vẫn cần đối chiếu nguồn.

Kiểm thử local ngày 18/10/2026 đã mở Chrome thật ở desktop 1440×900: chạy/lưu Assessment có giới hạn dữ liệu, ghi nhận đã xem, yêu cầu bổ sung và lời mời/câu trả lời có biên nhận. PDF thật và ZIP nhỏ đã có bằng chứng live; BCTC còn dữ kiện bị giữ lại do grounding và cần kiểm chứng tài chính. Xem [báo cáo triển khai và nghiệm thu UI](docs/implementation/AIC-IMPLEMENTATION-AND-DESKTOP-UAT-2026-10-18.md) để biết từng ca đã chạy/phần còn thiếu. `next start` trong launcher này chỉ là bản web production build chạy local; backend vẫn là local runtime. Không đồng nhất với nghiệm thu deployment production qua HTTPS.

Lượt tiếp tục trên Chrome desktop đã kiểm và sửa PDF sau đổi phiên/đăng xuất liên tab; luồng tính điểm thật qua UI cho **82.5/AIC-F2 trên bộ số liệu tổng hợp có đáp án tính tay**, giữ null khi thiếu bridge hoặc EBITDA không dương. Dữ liệu doanh nghiệp thật vẫn chưa đủ điều kiện phát điểm. Xem [checkpoint Chrome/FHI và các việc còn thiếu](docs/implementation/AIC-CHROME-RESUME-RESULT-2026-10-18.md) cùng [bản gốc fixture kỹ thuật](docs/implementation/AIC-FHI-SYNTHETIC-UI-FIXTURE-2026-10-18.md); không xem fixture là BCTC thật hoặc calibration.

Nguồn đặc tả: [master Notion hiện hành](https://app.notion.com/p/00-AIC-Rating-B-o-c-o-t-ng-h-p-k-ho-ch-tri-n-khai-1790c2f0937d8344bc9781bc9b4efd32), [UI](https://app.notion.com/p/9cd0c2f0937d82499c448102014376f1), [AIC-FHI-1.0](https://app.notion.com/p/bf10c2f0937d832d936281ed21fe903f). [Đối chiếu phiên bản nguồn](apps/web/docs/specification/current-sync.md) ghi rõ phần đã đọc trực tiếp và snapshot cũ.

## Commit và push trên nhánh duc

Thực hiện các lệnh từ **gốc repo `Fintech`**, không chạy trong thư mục frontend. Nhánh local `duc` đã được tạo từ commit `8b0b7ed` của checkout hiện tại, giữ nguyên code AI sẵn có và các thay đổi frontend chưa commit. Vì nền này có commit AI từ `nguyen`, kiểm tra cả danh sách commit và diff của PR trước khi merge vào `main`.

### 1. Kiểm tra trước commit

```powershell
git branch --show-current
git status --short
git diff
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Nhánh hiện tại phải là `duc`. `git diff` chưa hiển thị nội dung file untracked; các file mới sẽ hiện trong diff sau khi stage ở bước 2. Kiểm thử HTTP QA cần hai dịch vụ local riêng; xem [hướng dẫn frontend](apps/web/README.md). Ghi đúng kết quả đã chạy và giới hạn kiểm tra vào PR; kết quả frontend không thay thế nghiệm thu AI/backend.

### 2. Stage đúng phần tích hợp frontend

Lượt hoàn thiện hiện tại có cả API, migration, contracts, AI và tài liệu. Hãy xem riêng các phần này trong `git diff`; lệnh stage frontend bên dưới không bao gồm chúng. Khi đã review, stage rõ từng file/nhóm liên quan, chẳng hạn `apps/api`, `packages/contracts/aic-assessment`, các file AI thay đổi, launcher và tài liệu triển khai. Giữ bản báo cáo readiness mới và baseline local; không dùng reset/clean để làm working tree sạch trước commit.

```powershell
git add -- .gitignore README.md apps/README.md package.json pnpm-workspace.yaml pnpm-lock.yaml apps/web
git diff --cached --stat
git diff --cached --check
git diff --cached
```

Lệnh này đưa source, tests, public assets, `.env.example`, tài liệu frontend và cấu hình workspace vào commit. File kế hoạch riêng như `AIC_REFACTOR_PLAN.md` chỉ thêm khi đã xem và muốn bàn giao cùng; không nằm trong danh sách mặc định trên.

Các file local được ignore: `node_modules/`, `.next/`, `.reports/`, `public/pdfjs/` sinh tự động, `.venv/`, `.env`/`.env.local` và bản nhập `apps/FE Fintech/`. Giữ root `pnpm-lock.yaml` trong commit để người khác cài đúng dependency. Không force-add secret, cache hoặc hồ sơ thật.

Nếu stage nhầm một file, bỏ riêng file đó khỏi stage rồi kiểm tra lại:

```powershell
git restore --staged -- path/to/file
```

### 3. Commit, push và review

Sau khi đã xem nội dung staged:

```powershell
git commit -m "feat(web): integrate AIC frontend into monorepo"
git push -u origin duc
```

Lần push đầu đặt upstream `origin/duc`; các lần sau dùng `git push`. Mở PR **base `main` ← compare `duc`**, nêu thay đổi, các lệnh kiểm tra, phần mock/pending và lỗi còn mở. Khi push bị từ chối do remote có commit mới, fetch và đối chiếu trước; không force-push hoặc reset để vượt lỗi.

### 4. Các lần làm việc tiếp theo

Commit hoặc lưu riêng thay đổi đang làm trước khi chuyển nhánh/cập nhật. Khi working tree sạch:

```powershell
git switch duc
git fetch origin
git merge origin/main
```

Nếu có conflict, xử lý và kiểm tra lại rồi commit/push trên `duc`. Giữ nhánh `duc` để tiếp tục làm việc sau khi PR được merge; không cần tạo lại nhánh cho mỗi lần bàn giao.

## Lịch sử kỹ thuật

Mô tả Blueprint 1.0.2 trước đây được giữ nguyên tại [README lịch sử](apps/web/docs/history/blueprint-1.0.2-readme.md). Định vị sản phẩm và hướng dẫn commit hiện hành nằm trong README này.
