"""Xuất JSON Schema và JSON mẫu của contract P3 ra packages/schemas/rules.

Chạy: python scripts/export_contracts.py  (từ services/rules)
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sme_rules import run_analysis  # noqa: E402
from sme_rules.contracts import CaseSnapshot, Fact, RunOutput  # noqa: E402
from sme_rules.fixtures import sao_mai_golden  # noqa: E402

OUT = ROOT.parents[1] / "packages" / "schemas" / "rules"


def write(name: str, payload) -> None:
    path = OUT / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT.parents[1])}")


def main() -> None:
    (OUT / "examples").mkdir(parents=True, exist_ok=True)
    write("case_snapshot.schema.json", CaseSnapshot.model_json_schema())
    write("fact.schema.json", Fact.model_json_schema())
    write("run_output.schema.json", RunOutput.model_json_schema())
    for stage in (1, 2, 3):
        snapshot, facts = sao_mai_golden(stage)
        write(f"examples/sao_mai_stage{stage}_input.json",
              {"snapshot": snapshot.model_dump(mode="json"), "facts": [f.model_dump(mode="json") for f in facts]})
        write(f"examples/sao_mai_stage{stage}_output.json", run_analysis(snapshot, facts).model_dump(mode="json"))


if __name__ == "__main__":
    main()
