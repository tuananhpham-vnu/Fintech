"""Kiểu dữ liệu chung cho 5 rule P0 và các hằng số của decision tables (T13b)."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

CHECKLIST_VERSION = "CL01-P0-v1"
ISSUE_NAMESPACE = uuid.UUID("254068b3-5226-4c48-86c1-42c8c85cd381")

DOC_LABELS = {
    "registration": "giấy đăng ký doanh nghiệp",
    "loan_request": "đề nghị vay",
    "financial_statement": "báo cáo tài chính",
    "contract": "hợp đồng",
    "acceptance_record": "biên bản nghiệm thu",
    "payment_record": "chứng từ thanh toán",
    "invoice": "hóa đơn",
    "other": "tài liệu khác",
}

# Thứ tự ưu tiên khi gộp trạng thái rule
STATUS_RANK = {"issue": 0, "unknown": 1, "pass": 2, "not_applicable": 3}


def issue_id_for(case_id: str, issue_key: str) -> str:
    return str(uuid.uuid5(ISSUE_NAMESPACE, f"{case_id}:{issue_key}"))


def assessment_id_for(run_id: str, issue_key: str) -> str:
    """Contract không quy định cách tạo assessment.id; đề xuất (chờ chốt với Đức): UUIDv5(run_id:issue_key)."""
    return str(uuid.uuid5(ISSUE_NAMESPACE, f"{run_id}:{issue_key}"))


def worst(statuses: list[str], default: str = "pass") -> str:
    return min(statuses, key=STATUS_RANK.__getitem__) if statuses else default


@dataclass
class Assessment:
    issue_key: str
    rule_ids: list[str]
    category: str
    severity: str
    proposal: str
    summary: str
    reason_codes: list[str]
    evidence_ids: list[str]
    absence_basis: dict | None = None
    supported_amount: str | None = None
    unsupported_amount: str | None = None
    computed_date: str | None = None
    suggestion: dict | None = None  # RequestSuggestion chưa có issue_id/evidence_ids

    @property
    def is_candidate(self) -> bool:
        return self.proposal == "candidate_resolved"


@dataclass
class RuleOutcome:
    rule_id: str
    status: str
    reason_codes: list[str] = field(default_factory=list)
    evidence_ids: list[str] = field(default_factory=list)
    issue_keys: list[str] = field(default_factory=list)
    assessments: list[Assessment] = field(default_factory=list)

    def as_result(self) -> dict:
        # Reason codes của rule chỉ ghi khi unknown/not_applicable cần giải thích; issue/pass giải thích ở assessment.
        reasons = self.reason_codes if self.status in ("unknown", "not_applicable") else []
        return {"rule_id": self.rule_id, "status": self.status, "reason_codes": reasons,
                "evidence_ids": self.evidence_ids, "issue_keys": self.issue_keys}


def absence_basis(view, required_type: str, reason: str) -> dict:
    return {"checklist_version": CHECKLIST_VERSION, "searched_document_ids": view.document_ids,
            "required_type": required_type, "reason": reason}
