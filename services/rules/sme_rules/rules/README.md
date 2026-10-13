# sme_rules/rules

Mỗi file chứa một rule, tự đăng ký vào registry qua `@register`. Đặc tả nằm ở phần 07–09 của tài liệu.

| Rule | File | Kiểm tra | Mức khi có vấn đề |
|---|---|---|---|
| R01 | `r01_checklist.py` | Thiếu tài liệu bắt buộc theo checklist CL01 | medium; căn cứ là `absence_basis` |
| R02 | `r02_tax_id.py` | MST của doanh nghiệp vay khác giữa các tài liệu | high |
| R03 | `r03_name.py` | Cùng MST nhưng tên khác đáng kể | low |
| R04 | `r04_fs_basis.py` | BCTC sai kỳ hoặc thiếu nhãn cơ sở | medium |
| R05 | `r05_fs_equation.py` | Tài sản ≠ nợ + vốn, vượt ngưỡng làm tròn | medium |
| R06 | `r06_duplicate_invoice.py` | Hóa đơn có khả năng trùng (định danh, hash) | medium / low |
| R07 | `r07_invoice_vs_contract.py` | Tổng hóa đơn vượt hợp đồng trên cùng cơ sở thuế | medium |
| R08 | `r08_acceptance_condition.py` | Khoản thu phụ thuộc nghiệm thu nhưng thiếu biên bản | medium; high nếu khai đã đến hạn |
| R09 | `r09_received_claim.py` | Khai đã thu nhưng thiếu chứng từ thanh toán phù hợp | high |
| R10 | `r10_supplement_match.py` | Tài liệu bổ sung có khớp yêu cầu không | Đề xuất `still_open` / `candidate_resolved` |

## Thêm rule

1. Tạo `rNN_<ten>.py` chứa class kế thừa `Rule`, gắn `@register`, khai báo `rule_id` và `title`.
2. Trong `evaluate(ctx)`, dùng `ctx.case` và các hàm trong `domain/`. Không tự parse tiền, MST hay số tham chiếu.
3. Trả `unknown` khi dữ liệu thiếu hoặc mơ hồ, `not_applicable` khi rule không áp dụng. Không dùng `pass` để che việc chưa kiểm tra được.
4. Thêm một dòng import vào `__init__.py`.
5. Viết test có đủ ca pass, issue và unknown.

Đổi logic rule thì tăng `rule_version` và cần BA review câu chữ.
