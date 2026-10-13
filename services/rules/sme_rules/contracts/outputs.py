"""Hợp đồng đầu ra: RuleResult, Findings + SuggestedRequests cho backend/frontend."""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import Field, model_validator

from .inputs import ContractModel, DocType


class RuleStatus(str, Enum):
    PASS = "pass"
    ISSUE = "issue"
    UNKNOWN = "unknown"
    NOT_APPLICABLE = "not_applicable"


class Priority(str, Enum):
    """Mức ưu tiên xem xét, không phải mức rủi ro tín dụng."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ProposalStatus(str, Enum):
    CANDIDATE_RESOLVED = "candidate_resolved"
    STILL_OPEN = "still_open"


class RunStatus(str, Enum):
    COMPLETED = "completed"
    PARTIAL = "partial"


class AbsenceBasis(ContractModel):
    checklist_version: str
    inventory_snapshot: str
    checked_document_version_ids: List[str] = Field(default_factory=list)


class SuggestedRequest(ContractModel):
    type: DocType
    purpose: str
    contract_ref: Optional[str] = None


class Finding(ContractModel):
    issue_key: str
    priority: Priority
    title: str
    description: str = ""
    evidence_ids: List[str] = Field(default_factory=list)
    absence_basis: Optional[AbsenceBasis] = None
    suggested_request: Optional[SuggestedRequest] = None
    possible_related: List[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _must_be_traceable(self) -> "Finding":
        if not self.evidence_ids and self.absence_basis is None:
            raise ValueError("finding needs evidence_ids or absence_basis")
        return self


class Resolution(ContractModel):
    """Đề xuất của hệ thống cho một request item; reviewer mới là người đóng."""

    request_item_id: str
    proposal: ProposalStatus
    related_issue_keys: List[str] = Field(default_factory=list)
    evidence_ids: List[str] = Field(default_factory=list)


class RuleResult(ContractModel):
    run_id: str
    rule_id: str
    rule_version: str
    status: RuleStatus
    reason_code: str
    message: str
    subject: str = "case"
    operands: Dict[str, Any] = Field(default_factory=dict)
    evidence_ids: List[str] = Field(default_factory=list)
    finding: Optional[Finding] = None
    resolution: Optional[Resolution] = None

    @model_validator(mode="after")
    def _finding_iff_issue(self) -> "RuleResult":
        if (self.status == RuleStatus.ISSUE) != (self.finding is not None):
            raise ValueError("finding is required for issue and forbidden otherwise")
        return self


class SuggestedRequestItem(ContractModel):
    """Một yêu cầu bổ sung đề xuất, gom nhiều finding cùng loại giấy tờ/hợp đồng."""

    request_key: str
    document_type: DocType
    contract_ref: Optional[str] = None
    purposes: List[str] = Field(default_factory=list)
    finding_issue_keys: List[str] = Field(default_factory=list)


class InputIssue(ContractModel):
    object_type: str
    object_id: str
    code: str


class RunOutput(ContractModel):
    run_id: str
    snapshot_hash: str
    rule_set_version: str
    status: RunStatus
    rule_results: List[RuleResult] = Field(default_factory=list)
    findings: List[Finding] = Field(default_factory=list)
    suggested_requests: List[SuggestedRequestItem] = Field(default_factory=list)
    resolutions: List[Resolution] = Field(default_factory=list)
    input_issues: List[InputIssue] = Field(default_factory=list)
    coverage: Dict[str, Dict[str, int]] = Field(default_factory=dict)
