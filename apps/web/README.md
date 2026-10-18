# AIC Rating — Frontend

Frontend chính nằm ở `apps/web`, nhánh làm việc của Đức là **`duc`**. Next.js 16.4 / React 19 / TypeScript; API NestJS ở `apps/api`, dịch vụ AI ở `services/ai`. Thư mục nhập `FE Fintech` không có trong checkout hiện tại. Các bản báo cáo tích hợp cũ là snapshot lịch sử, không mô tả đầy đủ runtime hiện nay.

## Chạy ứng dụng thật từ repo root

Cần Node.js >=22, pnpm 11.22.0, PostgreSQL và cấu hình riêng theo README gốc. Không đưa `.env`, mật khẩu, token hoặc PDF riêng tư vào commit.

```powershell
pnpm install --frozen-lockfile
pnpm dev:all
```

Web: http://127.0.0.1:3000/login; API: loopback 3001; AI: loopback 8100. Lệnh trên dùng cấu hình thật đang có, không tự tạo tài khoản hoặc reset dữ liệu. Nếu chỉ cần sửa frontend và API đã chạy:

```powershell
pnpm dev --hostname 127.0.0.1 --port 3000
```

Để chạy bản build local:

```powershell
pnpm build
pnpm local:serve
```

Không chạy đồng thời các lệnh này trên cùng cổng. `pnpm start` cần có build phù hợp trước đó. `qa:serve` là harness mô phỏng riêng, không dùng để nghiệm thu sản phẩm thật; cấu hình và tài khoản QA lịch sử xem [hướng dẫn kiểm thử cũ](docs/verification.md).

## Trạng thái sản phẩm ngày 18/10/2026

Giá trị chính: kiểm tra dữ kiện và sức khỏe tài chính doanh nghiệp. Bảy chỉ số FHI, kết quả thử nghiệm, nguồn số liệu và rà soát giao dịch được trình bày riêng. Sáu tab hồ sơ và hai workflow RECEIVABLE/PREPAYMENT vẫn giữ nguyên. Bộ chọn kỳ là xem từng bộ BCTC, chưa phải biểu đồ xu hướng nhiều năm.

Pilot được chủ dự án duyệt trong phạm vi AIC-FHI-1.0/version 1.0.0, ngành DISTRIBUTION_WHOLESALE_PILOT. Điểm thuộc backend, không do FE tự tính. Chỉ số **experimental / NOT VALIDATED**, PD=null; xem [runtime pilot](../../docs/implementation/AIC-PILOT-RUNTIME.md). Kết quả 82,5/AIC-F2 trong báo cáo UI là dữ liệu minh họa tổng hợp, không phải kết quả doanh nghiệp thật. Hồ sơ PDF thật còn thiếu dữ kiện/nguồn được xác minh không được thay bằng số minh họa để phát điểm.

- [Quyết định thiết kế và phạm vi thay đổi UX](../../docs/implementation/AIC-UX-REDESIGN-DECISIONS-2026-10-18.md)
- [Bằng chứng Chrome và phần chưa nghiệm thu](../../docs/implementation/AIC-FULL-UX-CHROME-UAT-2026-10-18.md)
- [Checkpoint trước đợt UX](../../docs/implementation/AIC-CHROME-RESUME-RESULT-2026-10-18.md)
- [Kiến trúc frontend](docs/frontend-architecture.md)

UI hỗ trợ Tiếng Việt, English và 简体中文. Nội dung nguồn, tên pháp nhân và lời khai gốc giữ nguyên ngôn ngữ. Chỉ tùy chọn ngôn ngữ được lưu localStorage; phiên, revision, dữ kiện, điểm và audit thuộc backend. Thông tin debug chỉ render khi môi trường development bật chủ ý; production không render panel debug. Đây là quy tắc trình bày, không thay cơ chế phân quyền backend.

## Cấu trúc và kiểm tra

```text
src/app/          Routes và proxy cùng origin
src/features/     Các module nghiệp vụ
src/components/   Shell, form, modal, trạng thái, feedback dùng chung
src/lib/i18n/     Nhãn và diễn giải ba ngôn ngữ
src/styles/       Token và bố cục; enterprise.css ghi đè trình bày
public/           Tài nguyên công khai; PDF.js được chuẩn bị khi install/build
```

```powershell
pnpm lint
pnpm typecheck
pnpm build
```

Lint bao gồm kiểm tra ranh giới kiến trúc và định dạng. Các suite `check:aic`/`check:qa` vẫn có trong repo nhưng **không được chạy để thay nghiệm thu bằng UI** trong đợt này theo yêu cầu chủ dự án. Xem từng thao tác thật và giới hạn bằng chứng trong báo cáo Chrome.

## Commit trên nhánh duc

Giữ các thay đổi chưa commit của phiên trước; xem từng diff trước khi stage. Không dùng `git add .` nếu chưa đánh giá toàn bộ working tree. Có thể stage từng file hoặc từng hunk với `git add -p`, rồi xem `git diff --cached` trước khi commit. Không stage `.next`, `node_modules`, `.reports`, `.env*`, dữ liệu DB, token lời mời, ảnh PDF riêng tư hoặc thư mục baseline ngoài repo. Hướng dẫn Git chung ở [README gốc](../../README.md#commit-và-push-trên-nhánh-duc). Đợt UX không tự commit, push, deploy hoặc cập nhật Notion.
