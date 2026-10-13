"""Semantic guards chạy SAU khi output đã qua JSON Schema (contracts §9.2, §10).

Schema không bắt được: echo sai run/case/hash, evidence ngoài snapshot (cross-case),
issue_id không đúng UUIDv5, existing issue thiếu assessment, AI ghi human_status.
Mọi vi phạm -> 422 INVALID_MODEL_OUTPUT; không bao giờ sửa output cho "đẹp".
"""
from __future__ import annotations

import uuid
from collections import Counter
from typing import Any

from .contracts import Violation

ISSUE_NAMESPACE = uuid.UUID("254068b3-5226-4c48-86c1-42c8c85cd381")
P0_RULE_IDS = ("R01", "R02", "R08", "R09", "R10")
ECHO_FIELDS = ("schema_version", "run_id", "case_id", "case_revision", "snapshot_hash")


def issue_id_for(case_id: str, issue_key: str) -> str:
    return str(uuid.uuid5(ISSUE_NAMESPACE, f"{case_id}:{issue_key}"))


def _contains_key(payload: Any, key: str) -> bool:
    if isinstance(payload, dict):
        return key in payload or any(_contains_key(v, key) for v in payload.values())
    if isinstance(payload, list):
        return any(_contains_key(v, key) for v in payload)
    return False


def inspection_output_violations(inp: dict, out: dict) -> list[Violation]:
    if out["sha256"] != inp["sha256"]:
        return [Violation("/sha256", "must echo input sha256")]
    return []


def extraction_output_violations(inp: dict, out: dict) -> list[Violation]:
    found = [Violation(f"/{f}", f"must echo input {f}") for f in ("document_id", "case_id", "sha256") if out[f] != inp[f]]
    pages = [p["page"] for p in out["pages"]]
    if pages != list(range(1, len(pages) + 1)):
        found.append(Violation("/pages", "pages must be contiguous 1..N"))
    evidence_ids = [e["id"] for e in out["evidence"]]
    if len(evidence_ids) != len(set(evidence_ids)):
        found.append(Violation("/evidence", "evidence ids must be unique"))
    for i, ev in enumerate(out["evidence"]):
        if ev["document_id"] != inp["document_id"] or ev["page"] not in pages:
            found.append(Violation(f"/evidence/{i}", "evidence must reference this document and an existing page"))
    for i, field in enumerate(out["fields"]):
        if field["document_id"] != inp["document_id"] or not set(field["evidence_ids"]) <= set(evidence_ids):
            found.append(Violation(f"/fields/{i}", "field must reference this document and its own evidence"))
    return found


def evaluation_output_violations(inp: dict, out: dict) -> list[Violation]:
    found: list[Violation] = []
    for field in ECHO_FIELDS:
        if out[field] != inp[field]:
            found.append(Violation(f"/{field}", "must echo EvaluationInput"))

    rule_ids = [r["rule_id"] for r in out["rule_results"]]
    if sorted(rule_ids) != list(P0_RULE_IDS):
        found.append(Violation("/rule_results", "must contain R01,R02,R08,R09,R10 exactly once"))

    snapshot = inp["snapshot"]
    document_ids = {d["document"]["id"] for d in snapshot["documents"]}
    evidence_ids = {e["id"] for d in snapshot["documents"] if d["extraction"] for e in d["extraction"]["evidence"]}

    keys = Counter(a["issue_key"] for a in out["assessments"])
    for key, count in keys.items():
        if count > 1:
            found.append(Violation("/assessments", f"issue_key {key} assessed {count} times in one run"))

    assessed_ids = set()
    for i, a in enumerate(out["assessments"]):
        where = f"/assessments/{i}"
        assessed_ids.add(a["issue_id"])
        if a["run_id"] != inp["run_id"]:
            found.append(Violation(f"{where}/run_id", "must equal input run_id"))
        if a["issue_id"] != issue_id_for(inp["case_id"], a["issue_key"]):
            found.append(Violation(f"{where}/issue_id", "must be UUIDv5(namespace, case_id:issue_key)"))
        if not set(a["evidence_ids"]) <= evidence_ids:
            found.append(Violation(f"{where}/evidence_ids", "evidence must belong to this snapshot"))
        basis = a["absence_basis"]
        if basis and not set(basis["searched_document_ids"]) <= document_ids:
            found.append(Violation(f"{where}/absence_basis", "searched documents must belong to this snapshot"))
        if not a["evidence_ids"] and not basis:
            found.append(Violation(where, "assessment needs evidence_ids or absence_basis"))

    for issue in snapshot["existing_issues"]:
        if issue["id"] not in assessed_ids:
            found.append(Violation("/assessments", f"existing issue {issue['issue_key']} has no assessment"))

    for i, r in enumerate(out["rule_results"]):
        if not set(r["evidence_ids"]) <= evidence_ids:
            found.append(Violation(f"/rule_results/{i}/evidence_ids", "evidence must belong to this snapshot"))
        if not set(r["issue_keys"]) <= set(keys):
            found.append(Violation(f"/rule_results/{i}/issue_keys", "issue_keys must have an assessment"))

    for i, s in enumerate(out["request_suggestions"]):
        if s["issue_id"] not in assessed_ids:
            found.append(Violation(f"/request_suggestions/{i}/issue_id", "suggestion must target an assessed issue"))
        if not set(s["evidence_ids"]) <= evidence_ids:
            found.append(Violation(f"/request_suggestions/{i}/evidence_ids", "evidence must belong to this snapshot"))

    if _contains_key(out, "human_status"):
        found.append(Violation("/", "AI output must not contain human_status"))
    return found
