# sme_rules

Package Python của module đối chiếu. Chỉ có hai điểm vào công khai:

```python
from sme_rules import RuleConfig, run_analysis, evaluate
```

Luồng xử lý trong một lần chạy:

```
CaseSnapshot + Fact[]
  └─ domain/integrity.sanitize_facts   loại fact có nguồn sai → input_issues
  └─ domain/views.CaseView              lớp đọc dữ liệu cho rule
  └─ engine/runner                      chạy từng Rule trong registry, cô lập lỗi
       └─ rules/r01 … r10               mỗi rule dùng domain/* để chuẩn hóa và nối chứng từ
  └─ RunOutput                          rule_results, findings, suggested_requests, resolutions, coverage
```

| Thư mục/file | Vai trò | Phụ thuộc được phép |
|---|---|---|
| [contracts/](contracts) | Model dữ liệu vào/ra | Chỉ pydantic |
| `config.py` | Checklist, từ viết tắt, ngưỡng, câu chữ cấm | contracts |
| [domain/](domain) | Logic nghiệp vụ dùng chung | contracts, config |
| [engine/](engine) | Interface Rule, registry, runner | contracts, config, domain |
| [rules/](rules) | R01–R10 | engine, domain, contracts |
| `fixtures.py` | `SnapshotBuilder` và golden case Sao Mai (giả lập) | contracts |
| `evaluation.py` | Precision/recall và giảm thời gian cho benchmark | Không phụ thuộc |

Phụ thuộc chỉ đi theo một chiều, từ dưới lên. `domain` không import `engine` hay `rules`, và một rule không import rule khác.
