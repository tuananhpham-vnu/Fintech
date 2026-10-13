"""R04 - Cơ sở so sánh BCTC (kỳ, phạm vi, đơn vị, tiền tệ)."""
from __future__ import annotations

from typing import List

from ..contracts.inputs import DocType
from ..contracts.outputs import Priority, RuleResult, RuleStatus, SuggestedRequest
from ..domain.financials import BASIS_FIELDS, assess_basis
from ..engine.base import Rule, RuleContext
from ..engine.registry import register


@register
class R04FinancialStatementBasis(Rule):
    rule_id = "R04"
    title = "Cơ sở so sánh BCTC"

    def evaluate(self, ctx: RuleContext) -> List[RuleResult]:
        statements = ctx.case.ready(DocType.FINANCIAL_STATEMENT)
        if not statements:
            if ctx.case.pending(DocType.FINANCIAL_STATEMENT):
                return [self.unknown(ctx, "FINANCIAL_STATEMENT_PROCESSING", "BCTC đang được xử lý.")]
            return [self.not_applicable(ctx, "NO_FINANCIAL_STATEMENT", "Chưa có BCTC để xét cơ sở so sánh.")]
        period = ctx.case.info.reporting_period
        results = []
        for doc in statements:
            basis = assess_basis(doc, ctx.case.info, ctx.config)
            evidence = doc.evidence_ids("period_start", *BASIS_FIELDS)
            operands = {
                "document_version_id": doc.id,
                "expected_period": {"start": period.start.isoformat(), "end": period.end.isoformat()},
                "period_start": doc.value("period_start"),
                "period_end": doc.value("period_end"),
                "statement_scope": doc.value("statement_scope"),
                "unit_multiplier": doc.value("unit_multiplier"),
                "currency": doc.value("currency"),
                "missing": basis.missing,
            }
            kwargs = dict(subject=doc.document_id, operands=operands, evidence_ids=evidence)
            if basis.status == RuleStatus.PASS:
                results.append(self.passed(ctx, basis.reason_code, "BCTC đúng kỳ checklist và đủ nhãn để so sánh.", **kwargs))
            elif basis.status == RuleStatus.NOT_APPLICABLE:
                results.append(self.not_applicable(ctx, basis.reason_code,
                                                   "BCTC dùng ngoại tệ, ngoài phạm vi MVP; không tự đổi tỷ giá.", **kwargs))
            elif basis.status == RuleStatus.UNKNOWN:
                results.append(self.unknown(ctx, basis.reason_code,
                                            f"Thiếu nhãn cơ sở BCTC: {', '.join(basis.missing)}; chưa so sánh được.", **kwargs))
            else:
                results.append(self.issue(
                    ctx, basis.reason_code,
                    f"BCTC không đúng kỳ checklist ({period.start.isoformat()} – {period.end.isoformat()}); không so số liệu trực tiếp.",
                    issue_type="period_mismatch", priority=Priority.MEDIUM,
                    title="BCTC không đúng kỳ được chọn",
                    suggested_request=SuggestedRequest(
                        type=DocType.FINANCIAL_STATEMENT,
                        purpose=f"Bổ sung BCTC kỳ {period.start.isoformat()} – {period.end.isoformat()}",
                    ),
                    **kwargs,
                ))
        return results
