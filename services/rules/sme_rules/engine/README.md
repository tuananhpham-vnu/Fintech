# sme_rules/engine

Khung chạy rule. Engine không biết nội dung từng rule; nó chỉ làm việc với interface `Rule`.

| File | Vai trò |
|---|---|
| `base.py` | `Rule` (abstract): khai báo `rule_id`, `title`, `rule_version` và cài `evaluate(ctx)`. Các helper `passed / issue / unknown / not_applicable` tạo `RuleResult` cùng hình dạng, với `issue_key = rule_id:subject:issue_type`. `RuleContext` chứa snapshot, `CaseView` và config. |
| `registry.py` | `RuleRegistry` và decorator `@register`; chặn trùng `rule_id`; `create(enabled)` tạo rule theo thứ tự ID |
| `runner.py` | `run_analysis()` / `evaluate()`; `load_default_registry()` trả registry đã có đủ R01–R10 |

Runner bảo đảm các điều sau với **mọi** rule, kể cả rule viết sau này:

| Bất biến | Khi vi phạm |
|---|---|
| Có ít nhất một `RuleResult` | `unknown INTERNAL_RULE_ERROR` |
| Không ném exception | `unknown INTERNAL_RULE_ERROR`, run `partial`, các rule khác vẫn chạy |
| `issue_key` không trùng trong run | `unknown INTERNAL_RULE_ERROR` |
| Không chứa câu chữ cấm (`RuleConfig.forbidden_phrases`) | `unknown INTERNAL_RULE_ERROR` |

Log chỉ ghi `rule_id`, `run_id` và tên loại lỗi, không ghi nội dung exception vì có thể chứa dữ liệu hồ sơ.

Dùng registry riêng (ví dụ cho test hoặc bộ rule thử nghiệm):

```python
registry = RuleRegistry()
registry.register(MyRule)
run_analysis(snapshot, facts, registry=registry)
```
