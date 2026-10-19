# Đánh giá doanh nghiệp khi dữ liệu nguồn không đầy đủ

Ngày 19/10/2026. Bản sửa bổ sung kết quả có giới hạn dữ liệu cho hồ sơ company_health. Không yêu cầu nguồn phải có thêm tài liệu và không suy diễn chi phí khấu hao/phải thu thuần từ dữ liệu không đủ căn cứ.

## Hành vi

- Hồ sơ đủ 7/7 chỉ tiêu: tổng điểm, band, công thức, trọng số và chính sách hiện hành giữ nguyên.
- Hồ sơ chưa đủ chỉ tiêu nhưng đã rà soát, nguồn còn hiệu lực, trong phạm vi được duyệt: trả thêm `financial_health.partial_assessment`. UI hiển thị điểm của phần đủ dữ liệu, mẫu số là tổng trọng số của chính các chỉ tiêu đó, số chỉ tiêu và khoảng tổng điểm có thể đạt nếu phần còn lại đáp ứng điều kiện method.
- Ví dụ **tổng hợp kỹ thuật**, không phải số của doanh nghiệp thật: 5/7 chỉ tiêu đạt 66/80 điểm; phần chưa xác định có tối đa 20 điểm; khoảng 66–86/100. Không chuẩn hóa 66/80 thành 82,5/100 và không gán phần thiếu bằng 0.
- Khoảng được tính từ tổng điểm thành phần đã đủ điều kiện tới tổng đó cộng trọng số tối đa của phần chưa xác định. Cộng bằng phân số chính xác; cận hiển thị làm tròn ra ngoài. Đây là giới hạn có điều kiện của rubric, không phải khoảng tin cậy, band hoặc PD.
- Tổng điểm chính thức, band, grade và PD vẫn null khi chưa đủ dữ liệu. Điểm thành phần được hiển thị từ summary riêng, không thay trường điểm chính thức hoặc sửa facts.
- Đã sửa thông báo “Chưa có kết quả” cho assessment hiện hành đã completed nhưng chưa phát tổng điểm. UI hiện thời điểm đánh giá và điều kiện còn thiếu.

## Giới hạn áp dụng

Chỉ company_health, policy đang hoạt động, đã xác nhận rà soát. Các blocker được phép cho summary là MISSING_FACT, UNVERIFIED_FACT, QUICK_ASSETS_UNAVAILABLE, EBITDA_BRIDGE_UNAVAILABLE. Source stale, sai scope, policy chưa cấu hình, xung đột bảng cân đối, EBITDA không dương, lỗi nguồn và blocker lạ đều không được đi vào nhánh này. Hồ sơ giao dịch không được thêm summary.

Một assessment mới lưu summary trong snapshot JSON bất biến; không migration, backfill hay cập nhật assessment cũ. Payload cũ không có trường mới vẫn đọc được. Thay đổi nguồn làm snapshot stale và UI ẩn summary cho tới rà soát/chạy lại. Cần bấm Chấm điểm một lần sau cập nhật code để tạo snapshot có summary.

## Thành phần

- API: `apps/api/src/financial/partial-assessment.ts`, được gọi trong AssessmentService.run; scorer gốc không thay đổi.
- Contract: chỉ thêm thuộc tính tùy chọn vào CompanyHealthAssessmentV1 trong schemas/OpenAPI. `scripts/extend-partial-assessment.cjs` và hook cuối generator bảo toàn extension khi sinh lại contract.
- Frontend: decoder kiểm tra ID, trọng số, phạm vi số và ngữ cảnh company; company-result kiểm tra case/set/revision/confirmation/readiness; DataLimitedScore chỉ trình bày số do backend tính.
- Không có điều kiện riêng theo MST/tên công ty hoặc giá trị của một khách hàng. Không dùng dữ liệu tài chính thật trong tests/source/docs này.

## Kết quả kiểm tra

- `pnpm api:build`: PASS.
- `node --test apps/api/test/fhi-scorer.cjs apps/api/test/partial-assessment.cjs`: 8/8 PASS. Bộ đầy đủ cũ vẫn 73,7/F2 và 82,5/F2 theo fixture tương ứng; summary không mutate engine.
- `node scripts/test-local-postgres.cjs --test-concurrency=1 apps/api/test/financial-intake.integration.cjs apps/api/test/mvp-workflow.integration.cjs apps/api/test/fhi-scorer.cjs apps/api/test/partial-assessment.cjs`: 34/34 PASS trên cluster test mới, không kết nối DB người dùng. Bao gồm persistence summary, facts trước/sau không đổi, ACL tenant khác bị chặn, kết quả đầy đủ lịch sử giữ nguyên và các luồng giao dịch cũ.
- `pnpm check:aic`: kiến trúc PASS, 86/86 unit frontend và 20/20 integration contract PASS. Có ca stale, sai case/set, policy, scope, parsing và SSR ba ngôn ngữ.
- `pnpm typecheck`, `pnpm build`, `pnpm dev:all --check`: PASS.
- Đã chạy `pnpm local:serve` bằng build mới. Launcher xác nhận migrations hiện hành, không áp migration mới; API/AI/web ready.

## Giới hạn nghiệm thu UI

Đã tải lại hồ sơ thật và thấy nguồn/phiên còn đọc được, nhưng kết nối Chrome sau đó bị ngắt. Công cụ Windows dừng vì không xác minh được URL trình duyệt. Chưa thực hiện lần chấm mới qua UI sau bản sửa, chưa có ảnh nghiệm thu UI cuối hoặc số summary thực tế của doanh nghiệp. Không coi kết quả test tổng hợp là kết quả khách hàng.

Nguồn và bản ghi cũ không bị sửa để làm đủ điểm trong lượt triển khai này. Việc đánh giá lại trên UI sẽ tạo assessment mới, giữ lịch sử trước đó.
