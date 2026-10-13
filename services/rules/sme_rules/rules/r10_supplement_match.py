"""R10 - Tài liệu bổ sung phù hợp yêu cầu.

Upload qua đúng request chỉ là ngữ cảnh, không phải bằng chứng khớp. Hệ thống chỉ đề xuất
candidate_resolved / still_open; reviewer mới là người đóng request.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from ..contracts.inputs import ApprovedRequestItem, Classification
from ..contracts.outputs import Priority, ProposalStatus, Resolution, RuleResult
from ..domain.identity import MatchKind, match_borrower, resolve_borrower
from ..domain.linking import contracts_by_ref
from ..domain.normalize import normalize_ref
from ..domain.views import DocView
from ..engine.base import Rule, RuleContext, unique
from ..engine.registry import register

# Sai khác chắc chắn -> still_open; còn lại chỉ là chưa đủ dữ liệu -> unknown
DEFINITE_MISMATCHES = {"DOCUMENT_TYPE_MISMATCH", "CONTRACT_REF_MISMATCH", "BORROWER_TAX_ID_MISMATCH"}
BORROWER_OK = {MatchKind.TAX_EXACT, MatchKind.NAME_ONLY}


@dataclass
class ResponseCheck:
    doc: DocView
    problems: List[str] = field(default_factory=list)

    @property
    def matches(self) -> bool:
        return not self.problems

    @property
    def definite_mismatch(self) -> bool:
        return any(p in DEFINITE_MISMATCHES for p in self.problems)


@register
class R10SupplementMatchesRequest(Rule):
    rule_id = "R10"
    title = "Tài liệu bổ sung phù hợp yêu cầu"

    def evaluate(self, ctx: RuleContext) -> List[RuleResult]:
        items = ctx.snapshot.request_items
        if not items:
            return [self.not_applicable(ctx, "NO_APPROVED_REQUEST", "Chưa có yêu cầu bổ sung đã duyệt.")]
        return [self._check_item(ctx, item) for item in items]

    def _check_item(self, ctx: RuleContext, item: ApprovedRequestItem) -> RuleResult:
        responses = ctx.case.responses_to(item.id)
        subject = item.id
        if not responses:
            return self.not_applicable(ctx, "AWAITING_RESPONSE", "Chưa nhận tài liệu phản hồi cho yêu cầu này.",
                                       subject=subject)
        ready = [d for d in responses if d.is_ready]
        pending = [d for d in responses if d.is_pending]
        checks = [self._check_response(ctx, item, doc) for doc in ready]
        operands = {
            "request_item_id": item.id,
            "expected_document_type": item.document_type.value,
            "expected_contract_ref": item.contract_ref,
            "responses": [{"document_version_id": c.doc.id, "problems": c.problems,
                           "contract_ref": c.doc.value("contract_ref")} for c in checks],
            "pending_version_ids": [d.id for d in pending],
        }
        matching = [c for c in checks if c.matches]
        if matching:
            evidence = [e for c in matching for e in c.doc.evidence_ids("contract_ref", "acceptance_date", "record_no")]
            return self.passed(
                ctx, "CANDIDATE_RESOLVED",
                "Tài liệu bổ sung khớp loại giấy tờ, hợp đồng và doanh nghiệp; đề xuất đủ căn cứ, chờ reviewer xác nhận.",
                subject=subject, operands=operands, evidence_ids=evidence,
                resolution=self._resolution(item, ProposalStatus.CANDIDATE_RESOLVED, evidence),
            )
        if pending or not checks or not all(c.definite_mismatch for c in checks):
            return self.unknown(ctx, "RESPONSE_NEEDS_REVIEW",
                                "Tài liệu bổ sung đang xử lý hoặc chưa đọc chắc định danh; chưa đề xuất kết quả.",
                                subject=subject, operands=operands,
                                evidence_ids=[e for c in checks for e in c.doc.evidence_ids("contract_ref")])

        evidence = [e for c in checks for e in c.doc.evidence_ids("contract_ref", "parties")]
        for contract in contracts_by_ref(ctx.case, normalize_ref(item.contract_ref)):
            evidence += contract.evidence_ids("contract_no")
        problems = sorted({p for c in checks for p in c.problems})
        return self.issue(
            ctx, "SUPPLEMENT_DOES_NOT_MATCH",
            f"Tài liệu bổ sung chưa phù hợp yêu cầu ({', '.join(problems)}); yêu cầu vẫn mở.",
            subject=subject, issue_type="mismatch", priority=Priority.MEDIUM,
            title="Tài liệu bổ sung chưa khớp yêu cầu",
            evidence_ids=evidence, operands=operands, possible_related=item.finding_issue_keys,
            resolution=self._resolution(item, ProposalStatus.STILL_OPEN, evidence),
        )

    @staticmethod
    def _check_response(ctx: RuleContext, item: ApprovedRequestItem, doc: DocView) -> ResponseCheck:
        check = ResponseCheck(doc)
        if doc.doc_type is None or doc.version.classification != Classification.CONFIRMED:
            check.problems.append("DOCUMENT_TYPE_UNCONFIRMED")
        elif doc.doc_type != item.document_type:
            check.problems.append("DOCUMENT_TYPE_MISMATCH")
        if item.contract_ref:
            actual = doc.ref("contract_ref")
            if actual is None:
                check.problems.append("CONTRACT_REF_UNAVAILABLE")
            elif actual != normalize_ref(item.contract_ref):
                check.problems.append("CONTRACT_REF_MISMATCH")
        borrower = resolve_borrower(ctx.case, ctx.config)
        if borrower is None:
            check.problems.append("BORROWER_IDENTITY_UNAVAILABLE")
        else:
            kind = match_borrower(doc, borrower, ctx.config).kind
            if kind == MatchKind.TAX_MISMATCH:
                check.problems.append("BORROWER_TAX_ID_MISMATCH")
            elif kind not in BORROWER_OK:
                check.problems.append("BORROWER_NOT_CONFIRMED")
        return check

    @staticmethod
    def _resolution(item: ApprovedRequestItem, proposal: ProposalStatus, evidence: List[str]) -> Resolution:
        return Resolution(request_item_id=item.id, proposal=proposal,
                          related_issue_keys=list(item.finding_issue_keys), evidence_ids=unique(evidence))
