# Evaluation protocol (khóa ở T13b, dùng cho T14a–T17b)

Code so sánh: `evaluation/compare.py`. Protocol này **cố định trước khi chạy**: không sửa expected cho khớp output, không đổi protocol sau khi xem kết quả. Đổi protocol phải tăng version và ghi lý do.

## So sánh EvaluationOutput với expected

| Nhóm | So sánh chặt | Không so (lý do) |
|---|---|---|
| Echo | `run_id`, `case_id`, `case_revision`, `snapshot_hash`, `status` | — |
| RuleResult | `status`, `reason_codes`, `issue_keys`; `evidence_ids` so như **tập hợp** | Thứ tự evidence (thứ tự producer không mang nghĩa) |
| Assessment (ghép theo `issue_key`) | `issue_id`, `rule_ids`, `category`, `severity`, `proposal`, `reason_codes`, `supported_amount`, `unsupported_amount`, `computed_date`, `absence_basis` (checklist, required_type, tập searched_document_ids), tập evidence | `id` (D-01: contract chưa quy định cách tạo), `summary` (văn bản tự do; được *báo cáo* để BA xem wording) |
| RequestSuggestion (ghép theo `issue_id`) | `required_type`, `contract_ref`, `required_scope`, tập evidence | `purpose`, `content` (văn bản, reviewer được sửa) |
| Provenance | — | Mock/gold khác model thật |

Một case **đạt** khi `compare()` trả danh sách rỗng. Kết quả có tính cả `unknown`: unknown được thống kê riêng, không tính là đúng và không tính là sai của rule.

## Bộ dữ liệu và nhãn

| Bộ | Nguồn | Dùng để | Không được dùng để |
|---|---|---|---|
| G01–G03 | `packages/contracts/fixtures/golden-cases.json` | Regression dev và tích hợp | Kết luận chất lượng tổng quát (đây không phải holdout) |
| Biến thể T04–T24, A01/A04/A05 | `tests/snapshots.py` dựng từ gold, phải qua schema | Kiểm decision table | Đo hiệu quả |
| Spike provider | `scripts/provider_spike.py` (7 variant × N lượt) | Chọn model/prompt | Tuyên bố độ chính xác |

## Chỉ số (T16b), báo cáo trung thực

- Mẫu số luôn ghi rõ: precision = đúng / tổng phát hiện, recall = đúng / tổng gold, `N=0` → `N/A` (không ghi 100%).
- Unknown, lỗi provider, timeout và run partial được ghi riêng, không loại khỏi mẫu số.
- Không dùng AI tự chấm làm gold duy nhất. Gold do người lập, reviewer (Nguyên) xác nhận.
- Chỉ dev set thì chỉ kết luận trên dev. Không tuyên bố tiết kiệm 30% khi chưa đo baseline cùng task/input.
- Mỗi lần chạy ghi: commit SHA, hash fixture, model_id, prompt_version, rule_set_version, kết quả thô.
