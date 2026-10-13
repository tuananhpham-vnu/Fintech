# packages/schemas/rules/examples

Ví dụ thật do engine sinh ra từ golden case **Sao Mai Demo** (phần 35 tài liệu; mọi tên, mã và số liệu đều giả lập).
Có thể dùng làm mock API cho frontend và làm mẫu đầu ra cho module đọc tài liệu.

| Bước | Input | Output | Điều cần thấy |
|---|---|---|---|
| 1. Hồ sơ ban đầu | `sao_mai_stage1_input.json` | `sao_mai_stage1_output.json` | R08 issue: thiếu biên bản nghiệm thu HĐ01, kèm yêu cầu bổ sung |
| 2. Nộp nhầm biên bản HĐ02 | `sao_mai_stage2_input.json` | `sao_mai_stage2_output.json` | R10 `still_open` (CONTRACT_REF_MISMATCH); R08 vẫn mở |
| 3. Nộp biên bản đúng HĐ01 | `sao_mai_stage3_input.json` | `sao_mai_stage3_output.json` | R10 `candidate_resolved`; R08 pass, hạn minh họa 2026-11-14 |

Input có dạng `{"snapshot": CaseSnapshot, "facts": Fact[]}`, có thể gửi thẳng tới `POST /api/v1/analyze` của demo.
