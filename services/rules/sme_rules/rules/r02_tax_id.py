"""R02 - Mã số thuế của doanh nghiệp vay chưa khớp giữa các tài liệu."""
from __future__ import annotations

from typing import List

from ..contracts.outputs import Priority, RuleResult
from ..domain.identity import IDENTITY_DOC_TYPES, MatchKind, match_borrower, resolve_borrower
from ..engine.base import Rule, RuleContext
from ..engine.registry import register

_NOT_COMPARED = {MatchKind.NAME_ONLY, MatchKind.NAME_CANDIDATE}


@register
class R02TaxIdConsistency(Rule):
    rule_id = "R02"
    title = "Mã số thuế chưa khớp"

    def evaluate(self, ctx: RuleContext) -> List[RuleResult]:
        borrower = resolve_borrower(ctx.case, ctx.config)
        if borrower is None:
            return [self.unknown(ctx, "BORROWER_TAX_ID_UNAVAILABLE",
                                 "Chưa đọc chắc mã số thuế doanh nghiệp vay từ giấy đăng ký hoặc đề nghị vay.")]
        results: List[RuleResult] = []
        compared = []
        for doc in (d for t in IDENTITY_DOC_TYPES for d in ctx.case.ready(t)):
            if doc.id == borrower.source.id:
                continue
            match = match_borrower(doc, borrower, ctx.config)
            mention = match.mention
            operands = {
                "document_version_id": doc.id,
                "borrower_tax_id": borrower.tax.canonical,
                "document_tax_id": mention.tax_raw if mention else None,
                "party_role": mention.role if mention else None,
                "match": match.kind.value,
            }
            evidence = borrower.evidence_ids + (mention.evidence_ids if mention else [])
            subject = f"{doc.document_id}:{mention.role if mention else 'borrower'}"
            if match.kind == MatchKind.TAX_EXACT:
                compared.append(doc.id)
            elif match.kind in _NOT_COMPARED:
                continue
            elif match.kind == MatchKind.TAX_MISMATCH:
                results.append(self.issue(
                    ctx, "TAX_ID_MISMATCH",
                    f"Mã số thuế của doanh nghiệp vay ({mention.role}) trong tài liệu khác mã trên giấy đăng ký.",
                    subject=subject, issue_type="tax_mismatch", priority=Priority.HIGH,
                    title="Mã số thuế doanh nghiệp vay chưa khớp",
                    evidence_ids=evidence, operands=operands,
                ))
            elif match.kind == MatchKind.TAX_BRANCH:
                results.append(self.unknown(ctx, "BRANCH_TAX_ID_REQUIRES_VERIFICATION",
                                            "Tài liệu dùng mã chi nhánh; reviewer cần xác minh quan hệ với pháp nhân vay.",
                                            subject=subject, operands=operands, evidence_ids=evidence))
            elif match.kind == MatchKind.TAX_UNCERTAIN:
                results.append(self.unknown(ctx, "TAX_ID_UNCERTAIN",
                                            "Mã số thuế đọc chưa chắc; cần reviewer kiểm tra nguồn.",
                                            subject=subject, operands=operands, evidence_ids=evidence))
            else:
                results.append(self.unknown(ctx, "BORROWER_NOT_IDENTIFIED",
                                            "Chưa xác định được bên nào trong tài liệu là doanh nghiệp vay.",
                                            subject=doc.document_id, operands=operands, evidence_ids=evidence))
        if not results:
            if not compared:
                return [self.not_applicable(ctx, "NO_TAX_ID_TO_COMPARE",
                                            "Chưa có tài liệu khác chứa mã số thuế doanh nghiệp vay để so.")]
            results.append(self.passed(ctx, "TAX_ID_CONSISTENT",
                                       "Mã số thuế doanh nghiệp vay khớp trên các tài liệu đã so.",
                                       operands={"compared_version_ids": compared}))
        return results
