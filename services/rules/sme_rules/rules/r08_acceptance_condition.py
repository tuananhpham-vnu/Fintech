"""R08 - Khoản thu phụ thuộc nghiệm thu.

Tách điều kiện thành event_type / offset_days / calendar_basis; nghiệm thu chỉ hỗ trợ
kiểm tra điều kiện, không chứng minh tiền đã về. Ngày làm việc không tính như ngày lịch.
"""
from __future__ import annotations

from datetime import timedelta
from typing import List, Optional

from ..contracts.inputs import DocType
from ..contracts.outputs import Priority, RuleResult, SuggestedRequest
from ..domain.linking import contracts_by_ref, linked_documents
from ..domain.transactions import ClaimType, ReceiptClaim, payment_terms, receipt_claims
from ..domain.views import DocView
from ..engine.base import Rule, RuleContext
from ..engine.registry import register

ACCEPTANCE = "acceptance"
CALENDAR_DAYS = "calendar_days"
IN_SCOPE_CLAIMS = (ClaimType.EXPECTED, ClaimType.DUE)


@register
class R08AcceptanceDependentReceipt(Rule):
    rule_id = "R08"
    title = "Khoản thu phụ thuộc nghiệm thu"

    def evaluate(self, ctx: RuleContext) -> List[RuleResult]:
        results: List[RuleResult] = []
        claims: List[ReceiptClaim] = []
        for loan_request in ctx.case.ready(DocType.LOAN_REQUEST):
            found, uncertain = receipt_claims(loan_request)
            if uncertain:
                results.append(self.unknown(ctx, "RECEIPT_STATEMENT_UNCERTAIN",
                                            "Phát biểu khoản thu trong đề nghị vay đọc chưa chắc; cần reviewer kiểm tra.",
                                            subject=loan_request.document_id,
                                            evidence_ids=loan_request.evidence_ids("expected_receipts")))
            claims.extend(c for c in found if c.claim_type in IN_SCOPE_CLAIMS)
        results.extend(self._check(ctx, claim) for claim in claims)
        if not results:
            results.append(self.not_applicable(ctx, "NO_EXPECTED_RECEIPT",
                                               "Đề nghị vay không nêu khoản dự kiến thu hoặc đến hạn thu."))
        return results

    def _check(self, ctx: RuleContext, claim: ReceiptClaim) -> RuleResult:
        ref = claim.contract_ref_raw or "?"
        if claim.contract_ref is None:
            return self.unknown(ctx, "RECEIPT_CONTRACT_UNSPECIFIED", "Khoản thu không nêu hợp đồng nguồn; cần xác minh.",
                                subject=f"{claim.loan_request.document_id}:receipt_{claim.index}",
                                evidence_ids=claim.evidence_ids)
        contracts = contracts_by_ref(ctx.case, claim.contract_ref)
        if len(contracts) != 1:
            code = "CONTRACT_NOT_IN_FILE" if not contracts else "AMBIGUOUS_CONTRACT"
            return self.unknown(ctx, code, f"Chưa xác định duy nhất hợp đồng {ref} trong hồ sơ đã cung cấp.",
                                subject=f"ref_{claim.contract_ref}", evidence_ids=claim.evidence_ids)
        contract = contracts[0]
        subject = contract.document_id
        evidence = claim.evidence_ids + contract.evidence_ids("payment_terms")
        terms = payment_terms(contract)
        if terms is None:
            return self.unknown(ctx, "PAYMENT_TERMS_UNAVAILABLE", f"Chưa đọc chắc điều khoản thanh toán của {ref}.",
                                subject=subject, evidence_ids=evidence)
        acceptance_terms = [t for t in terms if t.event_type == ACCEPTANCE]
        if not acceptance_terms:
            return self.not_applicable(ctx, "NOT_ACCEPTANCE_DEPENDENT",
                                       f"Điều khoản thanh toán của {ref} không phụ thuộc nghiệm thu.",
                                       subject=subject, evidence_ids=evidence)

        operands = {
            "contract_ref": claim.contract_ref,
            "claim_type": claim.claim_type.value,
            "terms": [{"event_type": t.event_type, "offset_days": t.offset_days, "calendar_basis": t.calendar_basis,
                       "concurrent_conditions": list(t.concurrent_conditions)} for t in acceptance_terms],
        }
        records = linked_documents(ctx.case, contract, DocType.ACCEPTANCE_RECORD)
        if not records:
            return self._missing_acceptance(ctx, claim, ref, subject, evidence, operands)
        return self._check_conditions(ctx, records, acceptance_terms, ref, subject, evidence, operands)

    def _missing_acceptance(self, ctx, claim: ReceiptClaim, ref: str, subject: str, evidence, operands) -> RuleResult:
        due = claim.claim_type == ClaimType.DUE
        message = (
            f"Đề nghị vay khai khoản thu từ {ref} đã đủ điều kiện thu nhưng chưa tìm thấy biên bản nghiệm thu "
            f"trong hồ sơ đã cung cấp." if due else
            f"Khoản dự kiến thu từ {ref} phụ thuộc nghiệm thu; chưa tìm thấy biên bản nghiệm thu trong hồ sơ đã cung cấp. "
            f"Cần xác minh điều kiện thanh toán."
        )
        return self.issue(
            ctx, "DUE_CLAIM_WITHOUT_ACCEPTANCE" if due else "ACCEPTANCE_NOT_PROVIDED", message,
            subject=subject, issue_type="acceptance",
            priority=Priority.HIGH if due else Priority.MEDIUM,
            title="Chưa có căn cứ nghiệm thu cho khoản dự kiến thu",
            evidence_ids=evidence, operands=operands,
            suggested_request=SuggestedRequest(type=DocType.ACCEPTANCE_RECORD, contract_ref=claim.contract_ref,
                                               purpose=f"Xác minh điều kiện thanh toán của {ref}"),
        )

    def _check_conditions(self, ctx, records: List[DocView], terms, ref: str, subject: str, evidence,
                          operands) -> RuleResult:
        record = self._latest_dated(records)
        operands["acceptance_record_version_ids"] = [r.id for r in records]
        if record is None:
            return self.unknown(ctx, "ACCEPTANCE_DATE_UNAVAILABLE", "Có biên bản nghiệm thu nhưng chưa đọc chắc ngày nghiệm thu.",
                                subject=subject, operands=operands,
                                evidence_ids=evidence + [e for r in records for e in r.evidence_ids("acceptance_date")])
        accepted_on = record.date("acceptance_date")
        evidence = evidence + record.evidence_ids("acceptance_date", "contract_ref")
        operands["acceptance_date"] = accepted_on.isoformat()

        def unknown(code: str, message: str) -> RuleResult:
            return self.unknown(ctx, code, message, subject=subject, operands=operands, evidence_ids=evidence)

        due_dates = []
        for term in terms:
            if term.offset_days is None:
                return unknown("OFFSET_DAYS_UNAVAILABLE", "Chưa đọc chắc số ngày thanh toán sau nghiệm thu.")
            if term.calendar_basis != CALENDAR_DAYS:
                return unknown("BUSINESS_DAY_CALENDAR_UNAVAILABLE",
                               "Điều khoản tính theo ngày làm việc hoặc chưa rõ cách tính; chưa có lịch để tính hạn.")
            if term.concurrent_conditions:
                return unknown("OTHER_CONDITIONS_REQUIRE_REVIEW",
                               "Đã có nghiệm thu; điều khoản còn điều kiện khác cần reviewer kiểm tra.")
            due_dates.append((accepted_on + timedelta(days=term.offset_days)).isoformat())
        operands["illustrative_due_dates"] = due_dates
        return self.passed(
            ctx, "ACCEPTANCE_BASIS_FOUND",
            f"Đã có biên bản nghiệm thu nối với {ref}; hạn thanh toán minh họa {', '.join(due_dates)}. "
            f"Đây là căn cứ điều kiện, không phải ghi nhận đã thu tiền.",
            subject=subject, operands=operands, evidence_ids=evidence,
        )

    @staticmethod
    def _latest_dated(records: List[DocView]) -> Optional[DocView]:
        dated = [r for r in records if r.date("acceptance_date") is not None]
        return max(dated, key=lambda r: r.date("acceptance_date")) if dated else None
