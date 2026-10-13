"""R01 - Thiếu tài liệu theo checklist."""
from __future__ import annotations

from typing import Iterator

from ..contracts.outputs import Priority, RuleResult, SuggestedRequest
from ..engine.base import Rule, RuleContext
from ..engine.registry import register


@register
class R01ChecklistDocuments(Rule):
    rule_id = "R01"
    title = "Thiếu tài liệu theo checklist"

    def evaluate(self, ctx: RuleContext) -> Iterator[RuleResult]:
        case = ctx.case
        unclassified = case.needs_classification()
        for item in ctx.config.checklist.items:
            ready = case.ready(item.doc_type)
            pending = case.pending(item.doc_type)
            failed = case.failed(item.doc_type)
            operands = {
                "checklist_item": item.id,
                "checklist_version": ctx.config.checklist.version,
                "ready_version_ids": [d.id for d in ready],
                "pending_version_ids": [d.id for d in pending],
                "failed_version_ids": [d.id for d in failed],
                "unclassified_version_ids": [d.id for d in unclassified],
            }
            if len(ready) >= item.min_count:
                yield self.passed(ctx, "DOCUMENT_PRESENT", f"Đã có {item.label}.",
                                  subject=item.id, operands=operands)
            elif pending:
                yield self.unknown(ctx, "DOCUMENT_PROCESSING",
                                   f"Có file đang xử lý; chưa kết luận thiếu {item.label}.",
                                   subject=item.id, operands=operands)
            elif unclassified:
                yield self.unknown(ctx, "UNCLASSIFIED_DOCUMENTS",
                                   f"Có file chưa xác nhận loại; cần phân loại trước khi kết luận thiếu {item.label}.",
                                   subject=item.id, operands=operands)
            else:
                failed_note = " File lỗi không được tính là đã cung cấp hợp lệ." if failed else ""
                yield self.issue(
                    ctx, "MISSING_REQUIRED_DOCUMENT",
                    f"Chưa tìm thấy {item.label} trong hồ sơ đã cung cấp.{failed_note}",
                    subject=item.id,
                    issue_type="missing",
                    priority=Priority.MEDIUM,
                    title=f"Thiếu {item.label}",
                    absence_basis=ctx.absence_basis(),
                    suggested_request=SuggestedRequest(type=item.doc_type, purpose=f"Bổ sung {item.label}"),
                    operands=operands,
                )
