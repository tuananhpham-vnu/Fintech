"""R05 - Phương trình BCTC: tài sản = nợ phải trả + vốn chủ sở hữu (Decimal, có tolerance làm tròn)."""
from __future__ import annotations

from typing import List

from ..contracts.inputs import DocType
from ..contracts.outputs import Priority, RuleResult, RuleStatus
from ..domain.financials import assess_basis, fs_amount
from ..domain.money import display_vnd, fmt
from ..engine.base import Rule, RuleContext
from ..engine.registry import register

TERMS = ("total_assets", "total_liabilities", "equity")
FORMULA = "delta = total_assets - total_liabilities - equity"


@register
class R05BalanceSheetEquation(Rule):
    rule_id = "R05"
    title = "Kiểm tra phương trình BCTC"

    def evaluate(self, ctx: RuleContext) -> List[RuleResult]:
        statements = ctx.case.ready(DocType.FINANCIAL_STATEMENT)
        if not statements:
            if ctx.case.pending(DocType.FINANCIAL_STATEMENT):
                return [self.unknown(ctx, "FINANCIAL_STATEMENT_PROCESSING", "BCTC đang được xử lý.")]
            return [self.not_applicable(ctx, "NO_FINANCIAL_STATEMENT", "Chưa có BCTC để kiểm tra phương trình.")]
        return [self._check(ctx, doc) for doc in statements]

    def _check(self, ctx: RuleContext, doc) -> RuleResult:
        basis = assess_basis(doc, ctx.case.info, ctx.config)
        evidence = doc.evidence_ids(*TERMS)
        subject = doc.document_id
        if basis.status == RuleStatus.NOT_APPLICABLE:
            return self.not_applicable(ctx, basis.reason_code, "BCTC ngoài phạm vi tiền tệ của MVP.", subject=subject)
        if basis.status == RuleStatus.ISSUE:
            return self.not_applicable(ctx, "PERIOD_NOT_SELECTED", "BCTC không đúng kỳ checklist; không tính phương trình.",
                                       subject=subject)
        if not basis.comparable:
            return self.unknown(ctx, "BASIS_INCOMPLETE", "Chưa đủ đơn vị/kỳ/phạm vi báo cáo để tính.",
                                subject=subject, operands={"missing": basis.missing})

        amounts = {name: fs_amount(doc, name, basis) for name in TERMS}
        missing = [name for name, money in amounts.items() if money is None]
        if missing:
            return self.unknown(ctx, "TERM_UNAVAILABLE", f"Chưa đọc chắc chỉ tiêu: {', '.join(missing)}.",
                                subject=subject, operands={"missing": missing}, evidence_ids=evidence)

        assets, liabilities, equity = (amounts[name] for name in TERMS)
        delta = assets.amount - liabilities.amount - equity.amount
        tolerance = sum((m.rounding_unit for m in amounts.values())) / 2
        operands = {
            "formula": FORMULA,
            "raw": {name: doc.fact(name).raw_value or str(doc.fact(name).value) for name in TERMS},
            "normalized_vnd": {name: fmt(m.amount) for name, m in amounts.items()},
            "delta_vnd": fmt(delta),
            "tolerance_vnd": fmt(tolerance),
        }
        if abs(delta) > tolerance:
            return self.issue(
                ctx, "EQUATION_DIFFERENCE",
                f"Tổng tài sản chênh {display_vnd(abs(delta))} so với nợ phải trả cộng vốn chủ sở hữu "
                f"(ngưỡng làm tròn {display_vnd(tolerance)}). Cần reviewer xem nguồn.",
                subject=subject, issue_type="equation_difference", priority=Priority.MEDIUM,
                title="Phương trình BCTC chưa cân", evidence_ids=evidence, operands=operands,
            )
        return self.passed(ctx, "EQUATION_BALANCED", "Phương trình BCTC cân trong ngưỡng làm tròn.",
                           subject=subject, operands=operands, evidence_ids=evidence)
