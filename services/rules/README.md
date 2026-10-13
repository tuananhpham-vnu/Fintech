# services/rules — Đối chiếu và kiểm chứng (P3)

`Facts + Evidence` (từ module đọc tài liệu) → `RuleResult[]`, `Findings + SuggestedRequests` (cho app hiển thị và chuyên viên duyệt).
Triển khai R01–R10 theo phần 07–09 của *Tài liệu triển khai MVP*, kèm test T01–T10.

```bash
python3 -m venv .venv && .venv/bin/pip install -e "services/rules[dev]"   # từ thư mục gốc repo
cd services/rules && ../../.venv/bin/python -m pytest -q                  # chạy test
../../.venv/bin/python scripts/export_contracts.py                        # xuất schema + JSON mẫu
```

## Dùng từ backend

```python
from sme_rules import RuleConfig, run_analysis, evaluate

output = run_analysis(snapshot, facts, RuleConfig())   # RunOutput: rule_results, findings, suggested_requests, resolutions, coverage
results = evaluate(snapshot, facts, RuleConfig())      # interface theo tài liệu: -> RuleResult[]
```

Mọi model là Pydantic v2, nên `output.model_dump(mode="json")` trả JSON có tiền dạng chuỗi thập phân.
JSON Schema và ví dụ 3 bước của case Sao Mai Demo nằm trong [packages/schemas/rules](../../packages/schemas/rules).

## Contract với hai phần còn lại

| Phía | Gửi/nhận | Ghi chú |
|---|---|---|
| Đọc tài liệu → P3 | `CaseSnapshot` + `Fact[]` | `Fact.field = "<doc_type>.<tên trường>"` theo phụ lục 33; tiền là chuỗi thập phân + `multiplier`; ngày ISO; trường không chắc dùng `quality=review_required`, không đoán. Mỗi fact `source_type=document` phải có evidence thuộc đúng `document_version_id`. |
| P3 → App | `RunOutput` | `finding` chỉ có khi `status=issue`; mọi finding có `evidence_ids` hoặc `absence_basis`. `resolution` (R10) chỉ là **đề xuất** `candidate_resolved`/`still_open`; reviewer mới đóng. |

Fact không hợp lệ (nguồn của file khác, ngoài snapshot, trùng trường, thiếu evidence) bị loại khỏi phân tích và trả về trong `input_issues`. Rule khi đó sẽ thấy thiếu dữ liệu và trả `unknown`, không bao giờ dùng nguồn sai.

`issue_key = <rule_id>:<subject>:<loại vấn đề>` và chỉ dùng ID nghiệp vụ (document_id, checklist item, request item), nên ổn định giữa các run. Bộ gold của benchmark chấm theo khóa này (`sme_rules/evaluation.py`).

## Cấu trúc

```
sme_rules/
  contracts/   inputs.py, outputs.py   — chỉ dữ liệu; đổi ở đây = đổi contract (cập nhật doc + test + export)
  config.py                             — checklist CL01, từ viết tắt, ngưỡng, câu chữ cấm, enabled_rules
  domain/      normalize, money, views, integrity, identity, linking, financials, transactions
  engine/      base.py (Rule), registry.py, runner.py
  rules/       r01_… → r10_…            — mỗi rule một file
  fixtures.py                           — SnapshotBuilder + golden case Sao Mai (giả lập)
  evaluation.py                         — precision/recall, giảm thời gian (N/A khi mẫu số 0)
```

Nguyên tắc thiết kế:

- **Mở rộng không sửa engine.** Rule mới là một class `Rule` cộng `@register`. Engine chỉ biết interface `evaluate(ctx)`.
- **Mỗi rule một trách nhiệm.** Logic dùng chung (chuẩn hóa tiền/MST/tên, xác định doanh nghiệp vay, nối chứng từ, cơ sở BCTC) nằm ở `domain/` để không lặp lại giữa các rule. Ví dụ R04 và R05 cùng gọi `assess_basis`, nên không phụ thuộc thứ tự chạy.
- **Rule chỉ đọc qua `CaseView`/`DocView`.** `value()` trả `None` cho trường đọc chưa chắc, nên dữ liệu mơ hồ tự động thành `unknown`.
- **Cấu hình tách khỏi code.** BA chỉnh checklist hoặc từ viết tắt qua `RuleConfig`. `enabled_rules` dùng để thu hẹp phạm vi (ví dụ còn 6 rule nếu G2 trễ).
- **Runner giữ các bất biến:** mỗi rule có ít nhất một kết quả; rule lỗi trả về `unknown INTERNAL_RULE_ERROR` và run chuyển `partial`; không trùng `issue_key`; chặn câu chữ cấm; log chỉ chứa ID.
- **Không float, không LLM tính tiền.** Mọi phép tính dùng `Decimal`.

## Thêm rule mới (ví dụ R11)

```python
# sme_rules/rules/r11_example.py
from ..engine.base import Rule, RuleContext
from ..engine.registry import register

@register
class R11Example(Rule):
    rule_id = "R11"
    title = "…"

    def evaluate(self, ctx: RuleContext):
        for doc in ctx.case.ready(DocType.CONTRACT):
            ...
            yield self.issue(ctx, "REASON_CODE", "Thông điệp…", subject=doc.document_id,
                             issue_type="loai_van_de", priority=Priority.MEDIUM, title="…",
                             evidence_ids=doc.evidence_ids("contract_no"))
```

Sau đó thêm `r11_example` vào `rules/__init__.py` và viết test pass/issue/unknown cho rule mới. Không cần sửa engine, contract hay rule khác.

## Quy ước kết quả đáng nhớ

- R01: file đang xử lý cho kết quả `unknown` (không kết luận thiếu). File lỗi hoặc chưa phân loại không được tính là đã cung cấp.
- R02/R03: chỉ so mã và tên của **doanh nghiệp vay** (bên mua/bán khác là bình thường). Mã chi nhánh hoặc OCR mơ hồ cho kết quả `unknown`.
- R06/R07: không dùng riêng số tiền để kết luận trùng. Hóa đơn điều chỉnh, phụ lục, hoặc VAT khác cơ sở cho kết quả `unknown`.
- R08: có biên bản đúng thì chỉ tính *hạn minh họa* (ngày lịch), không ghi đã thu. Ngày làm việc hoặc điều kiện khác cho kết quả `unknown`.
- R09: nghiệm thu hoặc hóa đơn không hỗ trợ phát biểu “đã thu”. Chứng từ có bên nhận khác không được ghép. Khớp một phần thì hiện cả số được hỗ trợ và số chưa rõ.
- R10: nộp sai hợp đồng hoặc sai loại giấy tờ cho `still_open`; nộp đúng chỉ cho `candidate_resolved`.

Liên kết chứng từ chỉ được nhận khi số tham chiếu khớp chắc chắn hoặc reviewer đã xác nhận (`ConfirmedLink`). Liên kết do LLM đề xuất không được coi là sự thật.
