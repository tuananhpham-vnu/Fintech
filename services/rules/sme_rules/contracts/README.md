# sme_rules/contracts

Model Pydantic cho dữ liệu trao đổi. Thư mục này **chỉ chứa cấu trúc và bất biến**, không có logic nghiệp vụ.
Mọi model đều `frozen=True, extra="forbid"`, nên trường lạ hoặc sai kiểu bị từ chối ngay khi nhận.

| File | Model chính |
|---|---|
| `inputs.py` | `CaseSnapshot`, `CaseInfo`, `DocumentVersion`, `Evidence`, `Fact`, `ConfirmedLink`, `ApprovedRequestItem` và các enum (`DocType`, `Quality`, …) |
| `outputs.py` | `RuleResult`, `Finding`, `SuggestedRequest`, `Resolution`, `SuggestedRequestItem`, `RunOutput` |

Bất biến được kiểm tra trong model:

- `Evidence`: `bbox` chuẩn hóa 0–1 dạng `[x0, y0, x1, y1]`; không có bbox thì `precision = "page"`.
- `Finding`: phải có `evidence_ids` hoặc `absence_basis`.
- `RuleResult`: có `finding` khi và chỉ khi `status = "issue"`.

Khi đổi file trong thư mục này:

1. Cập nhật tài liệu.
2. Chạy `scripts/export_contracts.py`.
3. Cập nhật test.
4. Báo cho bên sử dụng.
