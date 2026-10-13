"""Protocol so sánh cố định (T13b): EvaluationOutput thực tế vs expected.

So sánh CHẶT các trường quyết định; evidence so như tập hợp (thứ tự producer không mang nghĩa).
KHÔNG so: assessment.id (contract chưa quy định cách tạo), summary/purpose/content (văn bản tự do),
provenance (mock/gold khác model thật). Không bao giờ sửa expected cho khớp output.
"""
from __future__ import annotations

RULE_FIELDS = ("status", "reason_codes", "issue_keys")
ASSESSMENT_FIELDS = ("issue_id", "rule_ids", "category", "severity", "proposal", "reason_codes",
                     "supported_amount", "unsupported_amount", "computed_date")
SUGGESTION_FIELDS = ("required_type", "contract_ref", "required_scope")


def _absence(basis: dict | None):
    if basis is None:
        return None
    return basis["checklist_version"], basis["required_type"], frozenset(basis["searched_document_ids"])


def compare(expected: dict, actual: dict) -> list[str]:
    diffs: list[str] = []
    for key in ("run_id", "case_id", "case_revision", "snapshot_hash", "status"):
        if expected[key] != actual[key]:
            diffs.append(f"{key}: expected {expected[key]!r}, got {actual[key]!r}")

    exp_rules = {r["rule_id"]: r for r in expected["rule_results"]}
    act_rules = {r["rule_id"]: r for r in actual["rule_results"]}
    for rule_id in sorted(exp_rules.keys() | act_rules.keys()):
        e, a = exp_rules.get(rule_id), act_rules.get(rule_id)
        if e is None or a is None:
            diffs.append(f"{rule_id}: missing in {'actual' if a is None else 'expected'}")
            continue
        for f in RULE_FIELDS:
            if e[f] != a[f]:
                diffs.append(f"{rule_id}.{f}: expected {e[f]!r}, got {a[f]!r}")
        if set(e["evidence_ids"]) != set(a["evidence_ids"]):
            diffs.append(f"{rule_id}.evidence_ids: set differs")

    exp_a = {x["issue_key"]: x for x in expected["assessments"]}
    act_a = {x["issue_key"]: x for x in actual["assessments"]}
    for key in sorted(exp_a.keys() ^ act_a.keys()):
        diffs.append(f"assessment {key}: only in {'expected' if key in exp_a else 'actual'}")
    for key in sorted(exp_a.keys() & act_a.keys()):
        e, a = exp_a[key], act_a[key]
        for f in ASSESSMENT_FIELDS:
            if e[f] != a[f]:
                diffs.append(f"assessment {key}.{f}: expected {e[f]!r}, got {a[f]!r}")
        if set(e["evidence_ids"]) != set(a["evidence_ids"]):
            diffs.append(f"assessment {key}.evidence_ids: set differs")
        if _absence(e["absence_basis"]) != _absence(a["absence_basis"]):
            diffs.append(f"assessment {key}.absence_basis differs")

    exp_s = {x["issue_id"]: x for x in expected["request_suggestions"]}
    act_s = {x["issue_id"]: x for x in actual["request_suggestions"]}
    for issue_id in sorted(exp_s.keys() ^ act_s.keys()):
        diffs.append(f"suggestion {issue_id}: only in {'expected' if issue_id in exp_s else 'actual'}")
    for issue_id in sorted(exp_s.keys() & act_s.keys()):
        e, a = exp_s[issue_id], act_s[issue_id]
        for f in SUGGESTION_FIELDS:
            if e[f] != a[f]:
                diffs.append(f"suggestion {issue_id}.{f}: expected {e[f]!r}, got {a[f]!r}")
        if set(e["evidence_ids"]) != set(a["evidence_ids"]):
            diffs.append(f"suggestion {issue_id}.evidence_ids: set differs")
    return diffs


def text_differences(expected: dict, actual: dict) -> list[str]:
    """Báo cáo (không làm fail) khác biệt văn bản tự do để BA xem wording."""
    notes = []
    act_a = {x["issue_key"]: x for x in actual["assessments"]}
    for e in expected["assessments"]:
        a = act_a.get(e["issue_key"])
        if a and a["summary"] != e["summary"]:
            notes.append(f"summary {e['issue_key']}: {a['summary']!r} vs gold {e['summary']!r}")
    return notes
