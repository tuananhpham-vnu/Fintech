"""R01 — đủ bốn nhóm giấy tờ theo CL01-P0-v1 (quy ước demo, không phải quy định ngân hàng)."""
from __future__ import annotations

from linking import SnapshotView

from .common import DOC_LABELS, Assessment, RuleOutcome, absence_basis, worst

REQUIRED_TYPES = ("registration", "loan_request", "financial_statement", "contract")
NOT_READY_REASON = {
    "failed": "UNREADABLE_SOURCE",
    "review_required": "NEEDS_CLASSIFICATION",
    "uploaded": "DOCUMENT_NOT_READY",
    "processing": "DOCUMENT_NOT_READY",
}


def issue_key(doc_type: str) -> str:
    return f"R01:{doc_type}:checklist"


def evaluate(view: SnapshotView) -> RuleOutcome:
    statuses, reasons, assessments = [], [], []
    for doc_type in REQUIRED_TYPES:
        present = view.of_type(doc_type, usable_only=False)
        usable = [d for d in present if d.usable]
        key = issue_key(doc_type)
        if usable:
            statuses.append("pass")
            if key in view.existing_issues:
                assessments.append(Assessment(
                    key, ["R01"], "supported", "medium", "candidate_resolved",
                    f"Đã có {DOC_LABELS[doc_type]} đọc được. Chờ reviewer xác nhận.",
                    ["DOCUMENT_PROVIDED"], usable[0].evidence()))
        elif present:
            # File có mặt nhưng lỗi/chưa xong/chưa xác nhận loại: unknown, không gọi là chưa nộp.
            statuses.append("unknown")
            codes = sorted({NOT_READY_REASON.get(d.document["processing_status"], "NEEDS_CLASSIFICATION") for d in present})
            reasons += codes
            if key in view.existing_issues:
                assessments.append(Assessment(
                    key, ["R01"], "insufficient_evidence", "medium", "unknown",
                    f"Có file {DOC_LABELS[doc_type]} nhưng chưa đọc được; chưa kết luận đã nộp đủ.", codes, [],
                    absence_basis(view, doc_type, "File có mặt nhưng chưa có extraction dùng được")))
        else:
            statuses.append("issue")
            label = DOC_LABELS[doc_type]
            assessments.append(Assessment(
                key, ["R01"], "missing_document", "medium", "still_open",
                f"Thiếu {label} theo checklist {absence_basis(view, doc_type, '')['checklist_version']}.",
                ["MISSING_DOCUMENT"], [], absence_basis(view, doc_type, f"Không có {label} trong snapshot"),
                suggestion={"required_type": doc_type, "contract_ref": None, "required_scope": None,
                            "purpose": "Bổ sung giấy tờ bắt buộc theo checklist",
                            "content": f"Vui lòng bổ sung {label}."}))
    return RuleOutcome("R01", worst(statuses), reasons, [], [a.issue_key for a in assessments], assessments)
