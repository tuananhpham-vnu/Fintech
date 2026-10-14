"""Sinh runner/console/presets.json: các ca mẫu (dữ liệu giả lập) cho trang test console /console.

Gồm gold G01–G03 (kèm expected), biến thể của export_evaluator_outputs và ca khó Gemini của hybrid_smoke.
Chạy lại khi đổi contract hoặc gold: cd services/ai && ../../.venv/bin/python scripts/build_console_presets.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from export_evaluator_outputs import CASES as VARIANTS  # noqa: E402
from hybrid_smoke import CASES as HARD_CASES, hard_case  # noqa: E402
from runner.config import DEFAULT_CONTRACTS_DIR  # noqa: E402
from runner.contracts import Contracts  # noqa: E402
from tests.snapshots import GOLD  # noqa: E402

OUT = ROOT / "runner" / "console" / "presets.json"

DESCRIPTIONS = {
    "G01-missing-acceptance": "Gold G01: thiếu biên bản nghiệm thu S1 → R08 issue, still_open/missing_document",
    "G02-wrong-contract": "Gold G02: biên bản nghiệm thu sai hợp đồng → R08 + R10 issue, mismatched_document",
    "G03-candidate": "Gold G03: đã có biên bản đúng → candidate_resolved/supported",
    "partial-acceptance-200m": "Biến thể G02: nghiệm thu một phần 200 triệu → partial",
    "received-partial-payment-200m": "Biến thể G03: khoản phải thu đã nhận, ủy nhiệm chi 200 triệu",
    "unknown-foreign-currency": "Biến thể G03: biên bản ghi USD → unknown",
    "H1-gold-clause-unstructured": "Gemini: điều khoản thanh toán dạng văn bản tự do (cần GEMINI_API_KEY)",
    "H2-paraphrase": "Gemini: diễn đạt lại điều khoản (cần GEMINI_API_KEY)",
    "H3-underspecified": "Gemini: điều khoản thiếu thông tin → phải unknown",
    "H4-injection": "Gemini: prompt injection trong hồ sơ → không được candidate_resolved",
}


def main() -> int:
    contracts = Contracts(DEFAULT_CONTRACTS_DIR)
    examples = {e["name"]: e["value"] for e in contracts.load("examples.json")}
    gold_expected = {f"G0{i + 1}": GOLD[i]["expected"] for i in range(len(GOLD))}
    presets = []
    for name, build in VARIANTS.items():
        presets.append({"id": name, "group": "Rule deterministic", "operation": "evaluate",
                        "description": DESCRIPTIONS[name], "input": build(),
                        "expected": gold_expected.get(name[:3]) if name.startswith("G0") else None})
    for name, (raw, proposal) in HARD_CASES.items():
        presets.append({"id": name, "group": "Ca khó (Gemini + HITL)", "operation": "evaluate",
                        "description": DESCRIPTIONS[name], "input": hard_case(raw),
                        "expected_r08_proposal": proposal})
    for operation in ("inspect", "extract"):
        presets.append({"id": f"{operation}-example", "group": "Extraction (chờ Nguyên)", "operation": operation,
                        "description": f"Example '{operation} request' trong contracts; live hiện trả 503",
                        "input": examples[f"{operation} request"]})

    schemas = {"evaluate": "EvaluationInput", "inspect": "InspectionInput", "extract": "ExtractionInput"}
    for p in presets:
        problems = contracts.violations(schemas[p["operation"]], p["input"])
        if problems:
            print(f"FAIL {p['id']}: {[x.as_detail() for x in problems][:3]}")
            return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(presets, ensure_ascii=False, indent=1) + "\n", "utf-8")
    print(f"{len(presets)} presets -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
