"""T13b/T14a — rule tests từ JSON gold + biến thể T04/T06/T08/T09/T21/T22/T24, A01/A04/A05.

Mọi input biến thể phải qua schema EvaluationInput; mọi output phải qua schema + semantic guards.
"""
import pytest

import rules
import tests.test_app  # noqa: F401  (đảm bảo module test được nạp để kiểm tham chiếu)
import tests.test_contracts  # noqa: F401
import tests.test_providers  # noqa: F401
from evaluation.compare import compare
from runner.guards import evaluation_output_violations

from .snapshots import (GOLD, acceptance_record, blank_field, doc, gold_input, payment_record, remove, set_field,
                        variant)


@pytest.fixture
def run(contracts):
    def _run(evaluation_input: dict) -> dict:
        assert contracts.violations("EvaluationInput", evaluation_input) == [], "test input must be schema-valid"
        output = rules.evaluate(evaluation_input)
        assert contracts.violations("EvaluationOutput", output) == []
        assert evaluation_output_violations(evaluation_input, output) == []
        return output
    return _run


def rule(output: dict, rule_id: str) -> dict:
    return next(r for r in output["rule_results"] if r["rule_id"] == rule_id)


def only_assessment(output: dict, prefix: str) -> dict:
    found = [a for a in output["assessments"] if a["issue_key"].startswith(prefix)]
    assert len(found) == 1, [a["issue_key"] for a in output["assessments"]]
    return found[0]


# ---------- Gold G01–G03 (protocol cố định) ----------

@pytest.mark.parametrize("index", [0, 1, 2], ids=["G01", "G02", "G03"])
def test_gold_cases_match_expected(run, index):
    assert compare(GOLD[index]["expected"], run(gold_input(index))) == []


def test_t06_wrong_contract_keeps_one_issue_open_without_duplicate_request(run):
    out = run(gold_input(1))
    a = only_assessment(out, "R08:")
    assert (a["proposal"], a["category"], a["rule_ids"]) == ("still_open", "mismatched_document", ["R08", "R10"])
    assert rule(out, "R10")["status"] == "issue"
    assert out["request_suggestions"] == []   # request đã approved, không đề xuất trùng


def test_g03_wrong_old_file_does_not_negate_correct_new_file(run):
    a = only_assessment(run(gold_input(2)), "R08:")
    assert (a["proposal"], a["computed_date"], a["supported_amount"]) == ("candidate_resolved", "2026-11-14", "500000000")


# ---------- T04: R01 missing vs unknown; R02 chỉ người vay ----------

def test_t04_missing_registration_is_issue_with_absence_basis(run):
    out = run(variant(0, lambda s: remove(s, "01_registration.pdf")))
    a = only_assessment(out, "R01:registration")
    assert (rule(out, "R01")["status"], a["category"], a["evidence_ids"]) == ("issue", "missing_document", [])
    assert a["absence_basis"]["required_type"] == "registration"
    assert any(s["required_type"] == "registration" for s in out["request_suggestions"])


def test_t04_failed_file_is_unknown_not_missing(run):
    def failed(s):
        d = doc(s, "01_registration.pdf")
        d["document"].update(processing_status="failed", error_code="PDF_INVALID")
        d["extraction"], d["extraction_hash"] = None, None
    out = run(variant(0, failed))
    assert rule(out, "R01")["status"] == "unknown"
    assert "UNREADABLE_SOURCE" in rule(out, "R01")["reason_codes"]
    assert not [a for a in out["assessments"] if a["issue_key"].startswith("R01:")]


def test_t04_borrower_tax_mismatch_is_flagged_counterparty_is_not(run):
    out = run(variant(0, lambda s: set_field(doc(s, "04_contract.pdf"), "parties.borrower.tax_id", "0000000009")))
    a = only_assessment(out, "R02:")
    assert (a["category"], a["severity"]) == ("identity_mismatch", "high")
    assert rule(out, "R08")["status"] == "unknown"   # không pass nhờ hợp đồng sai doanh nghiệp

    out = run(variant(0, lambda s: set_field(doc(s, "04_contract.pdf"), "parties.counterparty.tax_id", "0000000099")))
    assert rule(out, "R02")["status"] == "pass"


# ---------- T08: received ----------

def _received(s):
    set_field(doc(s, "03_loan_request.pdf"), "receipt.claim_type", "received")


def test_t08_received_with_only_acceptance_is_insufficient(run):
    out = run(variant(2, _received))
    a = only_assessment(out, "R09:")
    assert (a["proposal"], a["category"], a["severity"]) == ("still_open", "insufficient_evidence", "high")
    assert a["reason_codes"] == ["RECEIVED_WITHOUT_PAYMENT_RECORD"]


def test_t08_partial_payment_quantified_not_resolved(run):
    out = run(variant(2, lambda s: (_received(s), payment_record(s, "07_payment_200m.pdf", "200000000"))))
    a = only_assessment(out, "R09:")
    assert (a["proposal"], a["supported_amount"], a["unsupported_amount"]) == ("still_open", "200000000", "300000000")


def test_t08_pending_or_multiple_payments_are_unknown(run):
    out = run(variant(2, lambda s: (_received(s), payment_record(s, "p.pdf", "500000000", status="pending"))))
    assert rule(out, "R09")["status"] == "unknown"
    out = run(variant(2, lambda s: (_received(s), payment_record(s, "a.pdf", "200000000"),
                                    payment_record(s, "b.pdf", "300000000"))))
    assert only_assessment(out, "R09:")["reason_codes"] == ["MULTIPLE_PAYMENTS_REQUIRE_SUM"]


def test_expected_claim_never_becomes_received(run):
    out = run(gold_input(2))
    assert rule(out, "R09")["status"] == "not_applicable"


# ---------- T09 / A04 / A05: sai scope, thiếu tiền, phụ lục ----------

def test_t09_wrong_scope_response_stays_open(run):
    out = run(variant(1, lambda s: acceptance_record(s, "NT03_S2.pdf", acceptance__ref="NT03", acceptance__scope_ref="S2")))
    a = only_assessment(out, "R08:")
    assert (a["proposal"], a["category"]) == ("still_open", "mismatched_document")
    assert "SUPPLEMENT_SCOPE_MISMATCH" in a["reason_codes"]


def test_t09_a05_partial_acceptance_is_quantified_and_beats_wrong_file(run):
    out = run(variant(1, lambda s: acceptance_record(s, "NT04.pdf", acceptance__ref="NT04", acceptance__amount="200000000")))
    a = only_assessment(out, "R08:")
    assert (a["proposal"], a["category"]) == ("still_open", "insufficient_evidence")
    assert (a["supported_amount"], a["unsupported_amount"], a["computed_date"]) == ("200000000", "300000000", None)
    assert rule(out, "R10")["status"] == "issue"


def test_t09_a01_unresolved_other_conditions_block_candidate(run):
    def annex(s):
        condition = dict(doc(s, "04_contract.pdf")["extraction"]["fields"][-1]["value"])
        condition.update(other_conditions=["Phụ lục 01 thay Điều 4"], other_conditions_state="present")
        set_field(doc(s, "04_contract.pdf"), "contract.payment_condition", condition, raw="Điều 4 + Phụ lục 01")
    out = run(variant(2, annex))   # G03 vẫn còn file sai HĐ02: điều kiện HĐ chưa giải quyết vẫn thắng
    a = only_assessment(out, "R08:")
    assert (a["proposal"], a["computed_date"], a["reason_codes"]) == ("unknown", None, ["OTHER_CONDITIONS_UNRESOLVED"])
    assert rule(out, "R08")["status"] == "unknown"


def test_a04_filename_does_not_decide_match(run):
    out = run(variant(1, lambda s: doc(s, "05_wrong_record.pdf")["document"].update(filename="NT_HĐ01_correct.pdf")))
    assert only_assessment(out, "R08:")["category"] == "mismatched_document"


# ---------- T21: ngày, đơn vị, tiền tệ ----------

def _condition(s, **changes):
    d = doc(s, "04_contract.pdf")
    condition = dict(next(f for f in d["extraction"]["fields"] if f["field_key"] == "contract.payment_condition")["value"])
    condition.update(changes)
    set_field(d, "contract.payment_condition", condition, raw="Điều 4 (biến thể test)")


@pytest.mark.parametrize("changes, expected_date", [
    ({}, "2026-11-14"),
    ({"counting_convention": "include_event_day"}, "2026-11-13"),
    ({"calendar_basis": "business_days"}, None),
    ({"counting_convention": "unknown"}, None),
])
def test_t21_due_date_only_for_specified_calendar_days(run, changes, expected_date):
    a = only_assessment(run(variant(2, lambda s: _condition(s, **changes))), "R08:")
    assert (a["proposal"], a["computed_date"]) == ("candidate_resolved", expected_date)


def test_t21_foreign_currency_and_unreadable_date_are_unknown(run):
    # Bỏ file sai để cô lập ca "chỉ mơ hồ" (Specs §2: nếu còn file sai xác định thì still_open/mismatched)
    def usd(s):
        remove(s, "05_wrong_record.pdf")
        set_field(doc(s, "06_correct_record.pdf"), "money.currency", "USD")

    def no_date(s):
        remove(s, "05_wrong_record.pdf")
        blank_field(doc(s, "06_correct_record.pdf"), "acceptance.date", "ambiguous")
    for mutate, code in ((usd, "UNSUPPORTED_CURRENCY"), (no_date, "ACCEPTANCE_DATE_UNCLEAR")):
        out = run(variant(2, mutate))
        a = only_assessment(out, "R08:")
        assert (a["proposal"], a["reason_codes"]) == ("unknown", [code])
        assert rule(out, "R10")["status"] == "unknown"


def test_definite_mismatch_outranks_ambiguous(run):
    out = run(variant(2, lambda s: set_field(doc(s, "06_correct_record.pdf"), "money.currency", "USD")))
    assert only_assessment(out, "R08:")["category"] == "mismatched_document"


# ---------- T22: hồ sơ sạch không cảnh báo giả ----------

def test_t22_clean_first_run_creates_no_issue(run):
    def clean(s):
        s["requests"], s["existing_issues"] = [], []
        doc(s, "06_correct_record.pdf")["document"]["response_request_id"] = None
        remove(s, "05_wrong_record.pdf")
    out = run(variant(2, clean))
    assert out["assessments"] == [] and out["request_suggestions"] == []
    assert [r["status"] for r in out["rule_results"]] == ["pass", "pass", "pass", "not_applicable", "not_applicable"]


# ---------- T24 ----------

def test_t24_condition_not_acceptance_is_not_applicable(run):
    out = run(variant(0, lambda s: _condition(s, event_type="other")))
    assert rule(out, "R08")["status"] == "not_applicable"
    assert not [a for a in out["assessments"] if a["issue_key"].startswith("R08:")]


def test_t24_other_request_type_is_not_r10(run):
    out = run(variant(1, lambda s: s["requests"][0].update(required_type="payment_record")))
    assert rule(out, "R10") == {"rule_id": "R10", "status": "not_applicable", "reason_codes": ["UNSUPPORTED_REQUEST_TYPE"],
                                "evidence_ids": [], "issue_keys": []}


# ---------- Run partial ----------

def test_rule_crash_gives_partial_and_never_candidate(run, monkeypatch):
    def boom(*_):
        raise RuntimeError("boom")
    monkeypatch.setattr(rules.r09, "evaluate", boom)
    out = run(gold_input(2))
    assert out["status"] == "partial"
    assert rule(out, "R09") == {"rule_id": "R09", "status": "unknown", "reason_codes": ["INTERNAL_RULE_ERROR"],
                                "evidence_ids": [], "issue_keys": []}
    assert only_assessment(out, "R08:")["proposal"] == "unknown"


def test_existing_issue_whose_subject_disappeared_is_unknown(run):
    out = run(variant(1, lambda s: _condition(s, event_type="other")))
    a = only_assessment(out, "R08:")
    assert (a["proposal"], a["reason_codes"]) == ("unknown", ["REVIEW_REQUIRED", "SUBJECT_CHANGED"])


def test_adversarial_expected_references_existing_tests():
    import json
    import pathlib
    import sys
    data = json.loads(pathlib.Path("evaluation/adversarial-expected.json").read_text("utf-8"))
    assert [v["id"] for v in data["vectors"]] == [f"A{i:02d}" for i in range(1, 15)]
    for vector in data["vectors"]:
        refs = vector.get("pytest", [])
        for ref in [refs] if isinstance(refs, str) else refs:
            module, name = ref.split("::")
            module_name = "tests." + pathlib.Path(module).stem
            assert hasattr(sys.modules[module_name], name), ref
