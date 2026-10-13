"""R03 - Tên doanh nghiệp vay chưa khớp. Tên gần giống chỉ tạo ứng viên, không tự hợp nhất."""
from __future__ import annotations

from typing import List

from ..contracts.outputs import Priority, RuleResult
from ..domain.identity import IDENTITY_DOC_TYPES, MatchKind, match_borrower, names_equal, resolve_borrower
from ..engine.base import Rule, RuleContext
from ..engine.registry import register


@register
class R03NameConsistency(Rule):
    rule_id = "R03"
    title = "Tên doanh nghiệp chưa khớp"

    def evaluate(self, ctx: RuleContext) -> List[RuleResult]:
        borrower = resolve_borrower(ctx.case, ctx.config)
        if borrower is None or not borrower.name_key:
            return [self.unknown(ctx, "BORROWER_IDENTITY_UNAVAILABLE",
                                 "Chưa đọc chắc tên và mã số thuế doanh nghiệp vay.")]
        results: List[RuleResult] = []
        compared = []
        for doc in (d for t in IDENTITY_DOC_TYPES for d in ctx.case.ready(t)):
            if doc.id == borrower.source.id:
                continue
            match = match_borrower(doc, borrower, ctx.config)
            mention = match.mention
            if mention is None or not mention.name:
                continue
            operands = {
                "document_version_id": doc.id,
                "borrower_name": borrower.name,
                "document_name": mention.name,
                "party_role": mention.role,
                "similarity": round(match.similarity or 0.0, 3),
            }
            evidence = borrower.evidence_ids + mention.evidence_ids
            subject = f"{doc.document_id}:{mention.role}"
            if match.kind == MatchKind.TAX_EXACT:
                if names_equal(mention, borrower, ctx.config):
                    compared.append(doc.id)
                else:
                    results.append(self.issue(
                        ctx, "NAME_REQUIRES_VERIFICATION",
                        "Cùng mã số thuế nhưng tên doanh nghiệp khác đáng kể; cần xác minh.",
                        subject=subject, issue_type="name_mismatch", priority=Priority.LOW,
                        title="Tên doanh nghiệp vay cần xác minh",
                        evidence_ids=evidence, operands=operands,
                    ))
            elif match.kind == MatchKind.NAME_ONLY:
                compared.append(doc.id)
            elif match.kind == MatchKind.NAME_CANDIDATE:
                results.append(self.unknown(ctx, "NAME_WITHOUT_TAX_ID",
                                            "Tên gần giống nhưng tài liệu không có mã số thuế; chưa đủ căn cứ.",
                                            subject=subject, operands=operands, evidence_ids=evidence))
        if not results:
            if not compared:
                return [self.not_applicable(ctx, "NO_NAME_TO_COMPARE",
                                            "Chưa có tài liệu khác chứa tên doanh nghiệp vay để so.")]
            results.append(self.passed(ctx, "NAME_CONSISTENT", "Tên doanh nghiệp vay khớp sau chuẩn hóa.",
                                       operands={"compared_version_ids": compared}))
        return results
