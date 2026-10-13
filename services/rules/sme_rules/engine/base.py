"""Giao diện chung cho mọi rule.

Một rule chỉ cần khai báo `rule_id`, `title` và cài `evaluate(ctx)`. Các helper
`passed / issue / unknown / not_applicable` bảo đảm mọi kết quả cùng một hình dạng,
có run_id, rule_version và issue_key ổn định giữa các run.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, ClassVar, Dict, Iterable, List, Optional, Sequence

from ..config import RuleConfig
from ..contracts.inputs import CaseSnapshot
from ..contracts.outputs import (
    AbsenceBasis,
    Finding,
    Priority,
    Resolution,
    RuleResult,
    RuleStatus,
    SuggestedRequest,
)
from ..domain.views import CaseView


@dataclass(frozen=True)
class RuleContext:
    snapshot: CaseSnapshot
    case: CaseView
    config: RuleConfig

    @property
    def run_id(self) -> str:
        return self.snapshot.run_id

    def absence_basis(self) -> AbsenceBasis:
        return AbsenceBasis(
            checklist_version=self.config.checklist.version,
            inventory_snapshot=self.snapshot.snapshot_hash,
            checked_document_version_ids=[d.id for d in self.case.documents],
        )


def unique(items: Iterable[str]) -> List[str]:
    return list(dict.fromkeys(i for i in items if i))


class Rule(ABC):
    rule_id: ClassVar[str]
    title: ClassVar[str]
    rule_version: ClassVar[str] = "1.0"

    @abstractmethod
    def evaluate(self, ctx: RuleContext) -> Iterable[RuleResult]:
        """Trả ít nhất một RuleResult; không bao giờ trả pass để che lỗi hoặc thiếu dữ liệu."""

    def issue_key(self, subject: str, issue_type: str) -> str:
        return f"{self.rule_id}:{subject}:{issue_type}"

    def passed(self, ctx: RuleContext, reason_code: str, message: str, **kwargs: Any) -> RuleResult:
        return self._result(ctx, RuleStatus.PASS, reason_code, message, **kwargs)

    def unknown(self, ctx: RuleContext, reason_code: str, message: str, **kwargs: Any) -> RuleResult:
        return self._result(ctx, RuleStatus.UNKNOWN, reason_code, message, **kwargs)

    def not_applicable(self, ctx: RuleContext, reason_code: str, message: str, **kwargs: Any) -> RuleResult:
        return self._result(ctx, RuleStatus.NOT_APPLICABLE, reason_code, message, **kwargs)

    def issue(
        self,
        ctx: RuleContext,
        reason_code: str,
        message: str,
        *,
        subject: str,
        issue_type: str,
        priority: Priority,
        title: str,
        evidence_ids: Sequence[str] = (),
        absence_basis: Optional[AbsenceBasis] = None,
        suggested_request: Optional[SuggestedRequest] = None,
        possible_related: Sequence[str] = (),
        operands: Optional[Dict[str, Any]] = None,
        resolution: Optional[Resolution] = None,
    ) -> RuleResult:
        evidence = unique(evidence_ids)
        finding = Finding(
            issue_key=self.issue_key(subject, issue_type),
            priority=priority,
            title=title,
            description=message,
            evidence_ids=evidence,
            absence_basis=absence_basis,
            suggested_request=suggested_request,
            possible_related=list(possible_related),
        )
        return self._result(ctx, RuleStatus.ISSUE, reason_code, message, subject=subject,
                            operands=operands, evidence_ids=evidence, finding=finding, resolution=resolution)

    def _result(
        self,
        ctx: RuleContext,
        status: RuleStatus,
        reason_code: str,
        message: str,
        *,
        subject: str = "case",
        operands: Optional[Dict[str, Any]] = None,
        evidence_ids: Sequence[str] = (),
        finding: Optional[Finding] = None,
        resolution: Optional[Resolution] = None,
    ) -> RuleResult:
        return RuleResult(
            run_id=ctx.run_id,
            rule_id=self.rule_id,
            rule_version=self.rule_version,
            status=status,
            reason_code=reason_code,
            message=message,
            subject=subject,
            operands=operands or {},
            evidence_ids=unique(evidence_ids),
            finding=finding,
            resolution=resolution,
        )
