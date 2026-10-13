# services/rules/scripts

| Script | Việc làm |
|---|---|
| `export_contracts.py` | Sinh JSON Schema (`CaseSnapshot`, `Fact`, `RunOutput`) và ví dụ input/output của 3 bước Sao Mai vào [packages/schemas/rules](../../../packages/schemas/rules) |

```bash
cd services/rules && ../../.venv/bin/python scripts/export_contracts.py
```

Chạy lại script mỗi khi đổi `sme_rules/contracts/`, câu chữ của rule, hoặc fixture Sao Mai, rồi commit cả các file JSON đã sinh.
