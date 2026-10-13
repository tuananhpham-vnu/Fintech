"""R06 - Hóa đơn có khả năng trùng. Không dùng riêng số tiền để kết luận."""
from __future__ import annotations

from collections import OrderedDict
from typing import List

from ..contracts.inputs import DocType
from ..contracts.outputs import Priority, RuleResult
from ..domain.transactions import invoice_key
from ..engine.base import Rule, RuleContext
from ..engine.registry import register

KEY_FIELDS = ("seller_tax_id", "template_no", "series", "invoice_no")


@register
class R06DuplicateInvoice(Rule):
    rule_id = "R06"
    title = "Hóa đơn có khả năng trùng"

    def evaluate(self, ctx: RuleContext) -> List[RuleResult]:
        invoices = ctx.case.ready(DocType.INVOICE)
        if not invoices:
            return [self.not_applicable(ctx, "NO_INVOICE", "Hồ sơ chưa có hóa đơn.")]
        results: List[RuleResult] = []

        by_hash: "OrderedDict[str, list]" = OrderedDict()
        for doc in invoices:
            by_hash.setdefault(doc.version.file_hash, []).append(doc)
        for file_hash, docs in by_hash.items():
            if len({d.document_id for d in docs}) > 1:
                results.append(self.issue(
                    ctx, "DUPLICATE_UPLOAD", "Cùng một file hóa đơn được tải lên nhiều lần.",
                    subject=f"hash_{file_hash[:16]}", issue_type="duplicate_upload", priority=Priority.LOW,
                    title="File hóa đơn tải lên lặp",
                    evidence_ids=[e for d in docs for e in d.evidence_ids("invoice_no")],
                    operands={"document_version_ids": [d.id for d in docs]},
                ))

        groups: "OrderedDict[tuple, list]" = OrderedDict()
        for docs in by_hash.values():
            representative = docs[0]
            key = invoice_key(representative)
            if key is None:
                results.append(self.unknown(ctx, "INVOICE_KEY_INCOMPLETE",
                                            "Thiếu định danh hóa đơn (MST bên bán, mẫu số, ký hiệu, số); chưa xét trùng.",
                                            subject=representative.document_id,
                                            evidence_ids=representative.evidence_ids(*KEY_FIELDS)))
            else:
                groups.setdefault(key, []).append(representative)

        for key, docs in groups.items():
            if len(docs) < 2:
                continue
            operands = {"invoice_key": list(key), "document_version_ids": [d.id for d in docs]}
            evidence = [e for d in docs for e in d.evidence_ids(*KEY_FIELDS)]
            if any(d.value("adjustment_ref") for d in docs):
                results.append(self.unknown(ctx, "ADJUSTMENT_RELATION_UNRESOLVED",
                                            "Cùng định danh nhưng có ghi chú điều chỉnh/thay thế; reviewer xác định quan hệ.",
                                            subject="invoice_" + "_".join(key), operands=operands, evidence_ids=evidence))
                continue
            results.append(self.issue(
                ctx, "POSSIBLE_DUPLICATE_INVOICE",
                "Các file khác nhau có cùng định danh hóa đơn; có khả năng trùng, cần reviewer xác minh.",
                subject="invoice_" + "_".join(key), issue_type="possible_duplicate", priority=Priority.MEDIUM,
                title="Hóa đơn có khả năng trùng", evidence_ids=evidence, operands=operands,
            ))

        if not results:
            results.append(self.passed(ctx, "NO_DUPLICATE_FOUND", "Không phát hiện hóa đơn trùng định danh.",
                                       operands={"checked_version_ids": [d.id for d in invoices]}))
        return results
