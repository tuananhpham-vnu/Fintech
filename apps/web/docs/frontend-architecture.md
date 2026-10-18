# Kiến trúc frontend AIC Rating

## Tích hợp monorepo — 16/10/2026

Source chuẩn: `apps/web`; bản nhập `apps/FE Fintech` nguyên vẹn, được ignore. Root package/workspace/lock quản lý web. Chưa có `apps/api`; `/api/v2` chỉ proxy public API tương lai. Đã sửa vòng đời resource, source/PDF, hash routing, country và decoder. Thêm `assessments/fhi.ts` (tham chiếu hiển thị, không scorer), `fhi-breakdown.tsx`; FHI riêng transaction_review, BA narrative không điểm.

Dùng pnpm 11.22.0 từ root. [Audit](integration-audit.md) và [nguồn mới](specification/current-sync.md) ưu tiên hơn phần mô tả bản nhập dưới đây. Những tham chiếu backup ngoài dự án bên dưới là ghi chú lịch sử, chưa xác minh lại trong lượt này.

Baseline: AIC Rating 2.0.0 / CR-AIC-01. Báo cáo mô tả nghiệp vụ và ranh giới hệ thống; cây thư mục này là lựa chọn triển khai của dự án Next.js.

## Cây thư mục

```text
src/
  app/                        Route, layout, providers, error boundaries, API proxy
  features/
    auth/                     Login và vòng đời session
    counterparties/           Danh sách và tạo/sửa đối tác
    cases/                    Giao dịch, exposure và workspace sáu tab
    documents/                Upload, phiên bản, extraction, correction, jobs
    evidence/                 PDF đúng document/version/page/hash
    review/                   Review run, issue decision, waiver và revoke
    questionnaires/           Câu hỏi, nhập thay, xác minh, invite, respondent
    assessments/              Readiness, factor, kết quả và acknowledgement
    requests/                 Yêu cầu bổ sung, quyết định và export
    history/                  Audit timeline và phân trang
  components/                 Layout, UI, feedback và form dùng chung
  hooks/                      Resource, mutation và leave guard dùng chung
  lib/
    api/                      HTTP transport, DTO, decoder, proxy policy
    auth/                     Session context
    i18n/                     Locale và thông báo EN/VI/ZH
    domain/                   Quy tắc vai trò và trạng thái chung
    utils/                    Tiền, ngày giờ, giá trị và điều hướng
  styles/
    index.css                 Entry CSS duy nhất, giới hạn Tailwind vào src
    base.css                  Nền tảng và thành phần dùng chung
    workspace.css             Bố cục nghiệp vụ và responsive
    theme.css                 Màu sắc, typography và giao diện AIC

public/                       Icon và tài nguyên công khai
scripts/
  prepare-pdf-assets.cjs       Sinh PDF.js worker/fonts/CMaps/WASM cục bộ
  lib/report.cjs              Ghi kết quả kiểm tra vào .reports
  qa/                         Harness và seed dữ liệu QA trên loopback
tests/
  architecture/               Ranh giới, chu kỳ, file không được sử dụng
  unit/                       Validation và quy tắc hiển thị nghiệp vụ
  integration/                Consumer/proxy và HTTP QA
  helpers/                    Bộ nạp TypeScript cho test
  fixtures/                   Dữ liệu/PDF tổng hợp, không public
  e2e/README.md               Checklist kiểm thử trình duyệt
docs/
  specification/              Bản đọc báo cáo AIC 2.0, tên file theo chủ đề
  backend-integration.md      Hợp đồng và những phần còn chờ backend
  verification.md             Kết quả kiểm tra và giới hạn
```

`.next/`, `node_modules/`, `public/pdfjs/` và `.reports/` là dữ liệu sinh tự động, được gitignore. Cache TypeScript nằm trong `.next/cache/`. Bản lưu code/demo, audit, ảnh kiểm thử và script tạm cũ đã chuyển sang thư mục `FE Fintech Backups` cạnh dự án, không còn nằm trong source tree.

## Phân chia trách nhiệm

Các file ở root phục vụ công cụ của dự án:

| File                             | Vai trò                                                                  |
| -------------------------------- | ------------------------------------------------------------------------ |
| `package.json`, `pnpm-lock.yaml` | Lệnh chạy, dependency, cấu hình Prettier và phiên bản thư viện được khóa |
| `next.config.mjs`                | Cấu hình Next.js và HTTP security headers                                |
| `tsconfig.json`, `next-env.d.ts` | Cấu hình TypeScript và kiểu do Next.js tự sinh                           |
| `postcss.config.mjs`             | Pipeline CSS/Tailwind                                                    |
| `.env.example`                   | Mẫu cấu hình kết nối backend, không chứa secret                          |
| `.gitignore`, `.prettierignore`  | Loại file tự sinh khỏi Git và formatter                                  |
| `README.md`, `AGENTS.md`         | Hướng dẫn chạy và quy tắc làm việc với repository                        |

Cấu hình Prettier nằm trong trường `prettier` của `package.json`; không còn `.prettierrc.json` riêng. Các file cấu hình còn lại giữ vị trí root để công cụ tự tìm đúng khi chạy lệnh từ dự án.

- `src/app` chỉ nối route/layout với feature, không chứa biểu mẫu hoặc dựng HTTP request. URL giữ nguyên: `/login`, `/cases`, `/cases/:caseId`, `/counterparties`, `/respondent`. URL preview cũ dùng 404 mặc định.
- Mỗi feature có `api.ts` riêng, sở hữu endpoint, payload, decoder và idempotency của nghiệp vụ.
- `components/` trong feature chứa tương tác; `hooks/` điều phối đọc/polling/refresh; `schemas.ts` chuẩn hóa form; `model.ts` chứa quy tắc hiển thị. Không tạo file rỗng để đủ mẫu.
- `src/components`, `src/hooks` và `src/lib` không import feature hoặc route. Workspace ghép các feature qua interface rõ ràng; không có global API object.
- LocaleProvider độc lập SessionProvider. Shell giữ children khi hết phiên; đăng nhập lại không tự phát lại write. Workspace được key theo case ID.
- Import alias `@/*` trỏ tới `src/*`. Test nạp cùng alias, không có lớp tương thích đường dẫn cũ.

## Quy tắc theo báo cáo

| Nghiệp vụ                                                              | Module                         |
| ---------------------------------------------------------------------- | ------------------------------ |
| Một role nội bộ specialist; respondent có scope riêng                  | auth, questionnaires           |
| PREPAYMENT/RECEIVABLE lõi, LOAN/DEBT_INVESTMENT phụ                    | cases, counterparties          |
| Sáu tab, kể cả khi numeric rating bị chặn                              | cases và các feature workspace |
| Tài liệu gốc bất biến; source đúng phiên bản/trang/hash                | documents, evidence            |
| Review độc lập numeric readiness; waiver không biến finding thành đúng | review, assessments            |
| Origin và verification của câu trả lời tách biệt                       | questionnaires                 |
| Hiển thị yếu/tốt/red flags và khác biệt profile; FE không tính score   | assessments                    |
| Văn bản export do server phê duyệt; audit actor/reason/revision/refs   | requests, history              |
| Chỉ lưu preference ngôn ngữ trong localStorage                         | lib/i18n                       |

## Kiểm soát cấu trúc

`pnpm check:architecture` kiểm cả import tĩnh và dynamic import: đường dẫn tồn tại, không đi ra khỏi `src`, chiều phụ thuộc, API không nhập UI, route mỏng, không vòng import và không file code bị bỏ rơi. Kiểm tra cũng chặn việc xuất hiện lại các thư mục lịch sử ở root.

Chín nhóm write chưa được phát hành hợp đồng vẫn trả `CONTRACT_NOT_RELEASED`. Việc dọn code không làm thay đổi phạm vi nghiệp vụ hoặc xác nhận đã có backend thật.

Lệnh chạy tại [README](../README.md); trạng thái nghiệm thu tại [verification.md](verification.md).
