"""Evaluator P0: EvaluationInput -> EvaluationOutput bằng 5 rule deterministic (R01, R02, R08, R09, R10).

Không cần provider/key: thiếu Gemini key chặn phần live, còn code deterministic vẫn chạy (T13b AC).
"""
from __future__ import annotations

import logging

from linking import SnapshotView

from . import acceptance, r01, r02, r09
from .hard_cases import flag_suspicious_documents
from .common import Assessment, RuleOutcome, absence_basis, assessment_id_for, issue_id_for

logger = logging.getLogger("rules")

RULE_SET_VERSION = "P0-1.0.2"
DETERMINISTIC_PROVENANCE = {"model_id": "deterministic-rules", "prompt_version": "rules-P0-1.0.2",
                            "ocr_version": "none", "schema_version": "1.0.2"}
RULE_ORDER = ("R01", "R02", "R08", "R09", "R10")


def _provenance(view: SnapshotView) -> dict:
    if not view.llm_used:
        return dict(DETERMINISTIC_PROVENANCE)
    return {**DETERMINISTIC_PROVENANCE, "model_id": f"{view.semantic.model_id}+deterministic-rules",
            "prompt_version": f"{view.semantic.prompt_version}+rules-P0-1.0.2"}


def _crashed(rule_id: str, exc: Exception) -> RuleOutcome:
    logger.error("rule %s crashed: %s", rule_id, type(exc).__name__)  # chỉ ID + loại lỗi, không log hồ sơ
    return RuleOutcome(rule_id, "unknown", ["INTERNAL_RULE_ERROR"])


def _run_rules(view: SnapshotView) -> dict[str, RuleOutcome]:
    outcomes: dict[str, RuleOutcome] = {}
    for rule_id, run in (("R01", lambda: r01.evaluate(view)), ("R02", lambda: r02.evaluate(view))):
        try:
            outcomes[rule_id] = run()
        except Exception as exc:
            outcomes[rule_id] = _crashed(rule_id, exc)
    try:
        mismatched = r02.mismatched_document_ids(view)
    except Exception as exc:
        mismatched = {d.id for d in view.docs}   # không xác minh được danh tính thì không cho pass nhờ tài liệu nào
        outcomes["R02"] = _crashed("R02", exc)
    try:
        outcomes["R08"], outcomes["R10"] = acceptance.evaluate(view, mismatched)
    except Exception as exc:
        outcomes["R08"], outcomes["R10"] = _crashed("R08", exc), _crashed("R10", exc)
    try:
        outcomes["R09"] = r09.evaluate(view, mismatched)
    except Exception as exc:
        outcomes["R09"] = _crashed("R09", exc)
    return outcomes


def _subject_changed(view: SnapshotView, issue: dict) -> Assessment:
    rule = issue["issue_key"].split(":", 1)[0]
    return Assessment(
        issue["issue_key"], [rule] if rule in RULE_ORDER else ["R01"], "insufficient_evidence", "medium", "unknown",
        "Căn cứ của vấn đề không còn áp dụng ở hồ sơ hiện hành; reviewer cân nhắc với lý do, không tự đóng.",
        ["REVIEW_REQUIRED", "SUBJECT_CHANGED"], [],
        absence_basis(view, "other", "SUBJECT_CHANGED"))


def evaluate(evaluation_input: dict, provenance: dict | None = None, semantic=None) -> dict:
    """Rule trước; ca khó mới gọi `semantic` (LLM qua guard); bị chặn thì REVIEW_REQUIRED cho người duyệt."""
    view = SnapshotView(evaluation_input, semantic)
    flag_suspicious_documents(view)
    run_id, case_id = evaluation_input["run_id"], evaluation_input["case_id"]
    outcomes = _run_rules(view)
    crashed = any("INTERNAL_RULE_ERROR" in o.reason_codes for o in outcomes.values())

    merged: dict[str, Assessment] = {}
    for rule_id in RULE_ORDER:
        for a in outcomes[rule_id].assessments:
            if a.issue_key not in merged:
                merged[a.issue_key] = a
    for key in list(merged):
        # Hồ sơ sạch từ đầu không tạo issue chỉ để candidate_resolved.
        if merged[key].is_candidate and key not in view.existing_issues:
            del merged[key]
        # Không đề xuất đóng từ run partial.
        elif crashed and merged[key].is_candidate:
            merged[key].proposal, merged[key].category = "unknown", "insufficient_evidence"
            merged[key].reason_codes = sorted(set(merged[key].reason_codes + ["RUN_PARTIAL"]))
    for key, issue in view.existing_issues.items():
        if key not in merged:
            merged[key] = _subject_changed(view, issue)

    approved_issue_ids = {r["issue_id"] for r in view.approved_requests}
    assessments, suggestions = [], []
    for a in merged.values():
        issue_id = issue_id_for(case_id, a.issue_key)
        assessments.append({
            "id": assessment_id_for(run_id, a.issue_key), "issue_id": issue_id, "issue_key": a.issue_key,
            "run_id": run_id, "rule_ids": a.rule_ids, "category": a.category, "severity": a.severity,
            "proposal": a.proposal, "summary": a.summary, "reason_codes": a.reason_codes,
            "evidence_ids": a.evidence_ids, "absence_basis": a.absence_basis,
            "supported_amount": a.supported_amount, "unsupported_amount": a.unsupported_amount,
            "computed_date": a.computed_date,
        })
        if a.suggestion and a.proposal == "still_open" and issue_id not in approved_issue_ids:
            suggestions.append({"issue_id": issue_id, **a.suggestion, "evidence_ids": a.evidence_ids})

    assessed_keys = {a["issue_key"] for a in assessments}
    rule_results = []
    for rule_id in RULE_ORDER:
        result = outcomes[rule_id].as_result()
        result["issue_keys"] = [k for k in result["issue_keys"] if k in assessed_keys]
        rule_results.append(result)

    return {
        "schema_version": evaluation_input["schema_version"],
        "run_id": run_id,
        "case_id": case_id,
        "case_revision": evaluation_input["case_revision"],
        "snapshot_hash": evaluation_input["snapshot_hash"],
        "status": "partial" if crashed else "completed",
        "rule_results": rule_results,
        "assessments": assessments,
        "request_suggestions": suggestions,
        "diagnostics": view.diagnostics,
        "provenance": dict(provenance or _provenance(view)),
    }
