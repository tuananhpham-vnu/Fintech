"""Xuất EvaluationOutput thật của evaluator deterministic cho gold + biến thể -> evidence/evaluator-outputs/.

Cho Đức dựng UI các trạng thái missing / mismatched / partial / unknown / candidate mà không cần chạy service.
Chạy: cd services/ai && ../../.venv/bin/python scripts/export_evaluator_outputs.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import rules  # noqa: E402
from runner.config import DEFAULT_CONTRACTS_DIR  # noqa: E402
from runner.contracts import Contracts  # noqa: E402
from runner.guards import evaluation_output_violations  # noqa: E402
from tests.snapshots import acceptance_record, doc, gold_input, payment_record, set_field, variant  # noqa: E402


def _received(s):
    set_field(doc(s, "03_loan_request.pdf"), "receipt.claim_type", "received")


CASES = {
    "G01-missing-acceptance": lambda: gold_input(0),
    "G02-wrong-contract": lambda: gold_input(1),
    "G03-candidate": lambda: gold_input(2),
    "partial-acceptance-200m": lambda: variant(1, lambda s: acceptance_record(s, "NT04.pdf", acceptance__ref="NT04",
                                                                              acceptance__amount="200000000")),
    "received-partial-payment-200m": lambda: variant(2, lambda s: (_received(s), payment_record(s, "UNC.pdf", "200000000"))),
    "unknown-foreign-currency": lambda: variant(2, lambda s: (s["documents"].remove(doc(s, "05_wrong_record.pdf")),
                                                              set_field(doc(s, "06_correct_record.pdf"), "money.currency", "USD"))),
}


def main() -> int:
    contracts = Contracts(DEFAULT_CONTRACTS_DIR)
    out_dir = ROOT / "evidence" / "evaluator-outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, build in CASES.items():
        evaluation_input = build()
        output = rules.evaluate(evaluation_input)
        problems = contracts.violations("EvaluationInput", evaluation_input) + contracts.violations("EvaluationOutput", output) \
            + evaluation_output_violations(evaluation_input, output)
        if problems:
            print(f"FAIL {name}: {[p.as_detail() for p in problems][:3]}")
            return 1
        (out_dir / f"{name}.input.json").write_text(json.dumps(evaluation_input, ensure_ascii=False, indent=2) + "\n", "utf-8")
        (out_dir / f"{name}.output.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", "utf-8")
        summary = [(a["proposal"], a["category"]) for a in output["assessments"]]
        print(f"ok  {name:32} {[r['status'] for r in output['rule_results']]} {summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
