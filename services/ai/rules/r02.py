"""R02 — MST người vay trên tài liệu so với Case.borrower_tax_id.

Chỉ so các vai trò là người vay (bên cung cấp/borrower/payee); không bao giờ so bên mua/counterparty.
BCTC không ghi MST không tự gây issue.
"""
from __future__ import annotations

from linking import SnapshotView

from .common import Assessment, RuleOutcome, worst

import normalize

# loại tài liệu -> field mang MST của người vay
BORROWER_TAX_FIELD = {
    "registration": "borrower.tax_id",
    "loan_request": "borrower.tax_id",
    "financial_statement": "borrower.tax_id",
    "contract": "parties.borrower.tax_id",
    "acceptance_record": "parties.borrower.tax_id",
    "payment_record": "parties.payee.tax_id",
}


def issue_key(document_id: str) -> str:
    return f"R02:{document_id}:borrower_identity"


def mismatched_document_ids(view: SnapshotView) -> set[str]:
    """Tài liệu ghi MST người vay khác case: R08/R09/R10 không được pass nhờ các tài liệu này."""
    found = set()
    for doc in view.docs:
        key = BORROWER_TAX_FIELD.get(doc.type)
        if key and doc.usable and doc.state(key) == "readable":
            if normalize.tax_id(doc.value(key)) != view.borrower_tax_id:
                found.add(doc.id)
    return found


def evaluate(view: SnapshotView) -> RuleOutcome:
    statuses, reasons, evidence, assessments = [], [], [], []
    seen_docs = set()
    for doc in view.docs:
        key = BORROWER_TAX_FIELD.get(doc.type)
        if not key or not doc.usable:
            continue
        seen_docs.add(doc.id)
        state = doc.state(key)
        field = doc.get(key)
        if state == "absent":
            continue
        if state == "unclear":
            statuses.append("unknown")
            reasons.append("TAX_ID_UNREADABLE")
            continue
        normalized = normalize.tax_id(doc.value(key))
        if normalized is None:
            statuses.append("unknown")
            reasons.append("TAX_ID_FORMAT_UNRECOGNIZED")
        elif normalized == view.borrower_tax_id:
            statuses.append("pass")
            evidence += field.evidence_ids
            if issue_key(doc.id) in view.existing_issues:
                assessments.append(Assessment(
                    issue_key(doc.id), ["R02"], "supported", "high", "candidate_resolved",
                    f"MST người vay trên {doc.filename} nay khớp hồ sơ. Chờ reviewer xác nhận.",
                    ["IDENTITY_CONFIRMED"], field.evidence_ids))
        else:
            statuses.append("issue")
            evidence += field.evidence_ids
            assessments.append(Assessment(
                issue_key(doc.id), ["R02"], "identity_mismatch", "high", "still_open",
                f"MST người vay trên {doc.filename} ({doc.value(key)}) khác MST hồ sơ ({view.case['borrower_tax_id']}).",
                ["BORROWER_TAX_ID_MISMATCH"], field.evidence_ids))

    for key_, issue in view.existing_issues.items():
        if key_.startswith("R02:") and key_.split(":")[1] not in seen_docs:
            # Tài liệu gốc không còn trong snapshot: không tự candidate, để reviewer cân nhắc.
            assessments.append(Assessment(
                key_, ["R02"], "identity_mismatch", "high", "unknown",
                "Tài liệu gốc của vấn đề MST không còn trong hồ sơ hiện hành; reviewer cân nhắc với lý do.",
                ["REVIEW_REQUIRED", "SUBJECT_CHANGED"], [],
                {"checklist_version": "CL01-P0-v1", "searched_document_ids": view.document_ids,
                 "required_type": "other", "reason": "SUBJECT_CHANGED"}))
            statuses.append("unknown")

    status = worst(statuses, default="unknown")
    if not statuses:
        reasons.append("NO_BORROWER_IDENTITY")
    return RuleOutcome("R02", status, sorted(set(reasons)), list(dict.fromkeys(evidence)),
                       [a.issue_key for a in assessments], assessments)
