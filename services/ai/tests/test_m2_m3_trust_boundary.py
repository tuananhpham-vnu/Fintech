"""M2 -> M3 data path: real extraction output spliced into a G03 snapshot, evaluated by real `rules.evaluate`.

M3's own PaymentConditionResolver + semantic.guard run unchanged; only the model provider is a deterministic fake.
Invariant under test (fixed in rules/hard_cases.py): a payment condition that M2 left unverified (rejected, uncertain or OCR-derived) must not become
a trusted R08 result merely because a second LLM reads the same text.
"""
import copy
import hashlib
import json

import pymupdf
import pytest

import rules
from providers.semantic import PaymentConditionResolver
from runner.guards import evaluation_output_violations

from . import test_extraction as t
from .snapshots import doc, gold_input, snapshot_hash
from .test_extraction import storage  # noqa: F401  (fixture)

PAYMENT_KEY = "contract.payment_condition"
CONTRACT_LINES = [
    "HỢP ĐỒNG MÔ PHỎNG HĐ01",
    "Hợp đồng số: HĐ01. Phạm vi: S1.",
    "Bên cung cấp: Sao Mai Demo. Mã số thuế: 0000000001",
    "Bên mua: Bình Minh Demo. Mã số thuế: 0000000002",
    "Giá trị toàn bộ S1: 500000000 VND, đã gồm VAT.",
]
TAIL = "Không tính ngày nghiệm thu; không có điều kiện thanh toán bổ sung."
NEGATED = "Điều khoản thanh toán trong 30 ngày lịch sau nghiệm thu S1 không áp dụng."


class SecondLlm:
    """Provider for M3's resolver: a second model that 'reads' the clause and proposes the full condition."""

    model_id = "second-llm"

    def __init__(self, condition: dict):
        self.condition = condition
        self.calls: list[str] = []

    def generate_json(self, system, user, schema, temperature=0.0, media=()):
        from types import SimpleNamespace
        source = user.split("<tai_lieu>\n", 1)[1].rsplit("\n</tai_lieu>", 1)[0]
        self.calls.append(source)
        return SimpleNamespace(data={"condition": dict(self.condition), "quote": source})


def evaluation_input(extraction: dict) -> dict:
    data = gold_input(2)
    contract = doc(data["snapshot"], "04_contract.pdf")
    contract["extraction"] = extraction
    contract["extraction_hash"] = hashlib.sha256(json.dumps(extraction, ensure_ascii=False, sort_keys=True,
                                                            separators=(",", ":")).encode()).hexdigest()
    data["snapshot_hash"] = snapshot_hash(data["snapshot"])
    return data


def m2_extract(contracts, storage, clause: str, condition: dict, ocr_clause: bool = False) -> dict:
    """Run the real M2 pipeline; the clause sits on a text page or on an OCR-only second page."""
    snapshot = gold_input(2)["snapshot"]
    contract_doc = doc(snapshot, "04_contract.pdf")["document"]
    if ocr_clause:
        t.text_pdf(storage / "front.pdf", "\n".join(CONTRACT_LINES))
        t.scan_pdf(storage / "back.pdf", storage / "04_contract.pdf")
        merged = pymupdf.open(storage / "front.pdf")
        merged.insert_pdf(pymupdf.open(storage / "back.pdf"))
        (storage / "m3.pdf").write_bytes(merged.tobytes())
        page, ocr = 2, t.FakeOcr(f"{clause}\n{TAIL}")
    else:
        t.text_pdf(storage / "m3.pdf", "\n".join(CONTRACT_LINES + [clause, TAIL]))
        page, ocr = 1, None
    fields = t.contract_fields(**{PAYMENT_KEY: t.field(PAYMENT_KEY, None, clause, TAIL, page=page,
                                                       condition=condition)})
    request = {"schema_version": "1.0.2", "document_id": contract_doc["id"], "case_id": snapshot["case"]["id"],
               "type": "contract", "storage_key": "m3.pdf", "sha256": t.sha(storage / "m3.pdf")}
    out = t.make_service(contracts, storage, model=t.FakeModel(t.answer(fields)), ocr=ocr).extract(request)
    t.assert_valid(contracts, request, out)
    return out


def evaluate(contracts, extraction: dict, second_llm: SecondLlm | None):
    data = evaluation_input(extraction)
    assert contracts.violations("EvaluationInput", data) == []
    resolver = PaymentConditionResolver(second_llm, contracts) if second_llm else None
    out = rules.evaluate(data, semantic=resolver)
    assert contracts.violations("EvaluationOutput", out) == []
    assert evaluation_output_violations(data, out) == []
    r08 = next(a for a in out["assessments"] if a["issue_key"].startswith("R08:"))
    status = next(r for r in out["rule_results"] if r["rule_id"] == "R08")["status"]
    return r08, status, out


def condition_field(extraction):
    return next(f for f in extraction["fields"] if f["field_key"] == PAYMENT_KEY)


def assert_not_trusted(r08, status):
    assert r08["proposal"] != "candidate_resolved" and status != "pass"
    assert r08["computed_date"] is None
    assert "REVIEW_REQUIRED" in r08["reason_codes"]


# ------------------------------------------------------------------ controls (pass today)


def test_verified_text_condition_flows_to_m3_without_llm(contracts, storage):
    """Positive path: M2 verifies the text clause, M3 uses it deterministically and never calls an LLM."""
    extraction = m2_extract(contracts, storage, "Thanh toán toàn bộ trong 30 ngày lịch sau nghiệm thu S1.", t.CONDITION)
    assert (condition_field(extraction)["value"], condition_field(extraction)["quality"]) == (t.CONDITION, "readable")
    llm = SecondLlm(t.CONDITION)
    r08, status, _ = evaluate(contracts, extraction, llm)
    assert (r08["proposal"], status, r08["computed_date"]) == ("candidate_resolved", "pass", "2026-11-14")
    assert llm.calls == []


def test_m2_rejects_negated_clause(contracts, storage):
    extraction = m2_extract(contracts, storage, NEGATED, t.CONDITION)
    f = condition_field(extraction)
    assert (f["value"], f["quality"], f["missing_reason"]) == (None, "uncertain", "ambiguous")
    assert f["raw_value"].startswith(NEGATED)


def test_m2_rejected_clause_without_llm_stays_with_reviewer(contracts, storage):
    r08, status, _ = evaluate(contracts, m2_extract(contracts, storage, NEGATED, t.CONDITION), None)
    assert_not_trusted(r08, status)


def test_ocr_condition_without_unknowns_is_not_promoted(contracts, storage):
    """OCR keeps the value visible but uncertain; M3 neither trusts it nor sends it to the LLM."""
    extraction = m2_extract(contracts, storage, "Thanh toán toàn bộ trong 30 ngày lịch sau nghiệm thu S1.",
                            t.CONDITION, ocr_clause=True)
    assert condition_field(extraction)["quality"] == "uncertain"
    llm = SecondLlm(t.CONDITION)
    r08, status, _ = evaluate(contracts, extraction, llm)
    assert llm.calls == [] and r08["proposal"] != "candidate_resolved" and status != "pass"


# ------------------------------------------------------------------ trust boundary (fixed in rules/hard_cases.py)


def assert_suggestion_only(out, r08, status, source_state):
    assert_not_trusted(r08, status)
    assert {"LLM_SUGGESTION_UNVERIFIED", source_state} <= set(r08["reason_codes"])
    assert [d["code"] for d in out["diagnostics"] if d["field_key"] == PAYMENT_KEY] == ["LLM_SUGGESTION"]
    assert out["provenance"]["model_id"] == "second-llm+deterministic-rules"   # LLM use stays visible


def test_second_llm_cannot_verify_clause_m2_rejected(contracts, storage):
    extraction = m2_extract(contracts, storage, NEGATED, t.CONDITION)
    llm = SecondLlm(t.CONDITION)
    r08, status, out = evaluate(contracts, extraction, llm)
    assert len(llm.calls) == 1            # the LLM is consulted ...
    assert_suggestion_only(out, r08, status, "SOURCE_REJECTED_BY_EXTRACTION")   # ... but only as a suggestion


def test_second_llm_cannot_verify_ocr_condition(contracts, storage):
    partial = dict(t.CONDITION, other_conditions_state="unknown")
    extraction = m2_extract(contracts, storage, "Thanh toán toàn bộ trong 30 ngày lịch sau nghiệm thu S1.",
                            partial, ocr_clause=True)
    assert condition_field(extraction)["quality"] == "uncertain"
    assert extraction["pages"][1]["method"] == "ocr"
    llm = SecondLlm(t.CONDITION)
    r08, status, out = evaluate(contracts, extraction, llm)
    assert len(llm.calls) == 1
    assert_suggestion_only(out, r08, status, "SOURCE_OCR_UNVERIFIED")


def test_reviewer_correction_resolves_m2_rejected_clause_without_llm(contracts, storage):
    """The existing HITL flow (ReviewDecision correct_field) is how a suggestion becomes a fact."""
    extraction = m2_extract(contracts, storage, NEGATED, t.CONDITION)
    data = evaluation_input(extraction)
    snapshot = data["snapshot"]
    field_id = condition_field(extraction)["id"]
    snapshot["corrections"].append({
        "id": "6f1c2d3e-0000-4000-8000-0000000000c1", "case_id": snapshot["case"]["id"],
        "actor_id": snapshot["case"]["created_by"], "action": "correct_field", "target_id": field_id,
        "run_id": None, "case_revision": snapshot["case"]["revision"], "reason": "Đã đối chiếu điều khoản trên PDF",
        "created_at": "2026-10-16T02:00:00Z",
        "payload": {"source_case_revision": snapshot["case"]["revision"] - 1, "classification": None,
                    "request_revision": None, "approved_hash": None,
                    "correction": {"field_id": field_id, "old_value": None, "new_value": dict(t.CONDITION),
                                   "evidence_ids": [], "source_case_revision": snapshot["case"]["revision"] - 1}},
    })
    data["snapshot_hash"] = snapshot_hash(snapshot)
    assert contracts.violations("EvaluationInput", data) == []
    llm = SecondLlm(t.CONDITION)
    out = rules.evaluate(data, semantic=PaymentConditionResolver(llm, contracts))
    assert evaluation_output_violations(data, out) == []
    r08 = next(a for a in out["assessments"] if a["issue_key"].startswith("R08:"))
    assert (r08["proposal"], r08["computed_date"]) == ("candidate_resolved", "2026-11-14")
    assert llm.calls == [] and "REVIEW_REQUIRED" not in r08["reason_codes"]
