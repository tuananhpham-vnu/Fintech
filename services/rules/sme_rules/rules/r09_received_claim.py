"""R09 - Phát biểu đã thu tiền chưa được hỗ trợ bởi chứng từ thanh toán.

Nghiệm thu/hóa đơn không đủ hỗ trợ phát biểu đã thu. Chứng từ phải khớp giao dịch,
bên nhận và thời điểm; khớp một phần thì hiện phần được hỗ trợ và phần chưa rõ.
"""
from __future__ import annotations

from decimal import Decimal
from typing import List, Optional, Tuple

from ..config import RuleConfig
from ..contracts.inputs import DocType
from ..contracts.outputs import Priority, RuleResult, SuggestedRequest
from ..domain.identity import Borrower, resolve_borrower
from ..domain.linking import contracts_by_ref, linked_documents, linked_payments
from ..domain.money import Money, display_vnd, fmt, money_from_fact
from ..domain.normalize import normalize_name
from ..domain.transactions import ClaimType, ReceiptClaim, receipt_claims
from ..domain.views import DocView
from ..engine.base import Rule, RuleContext
from ..engine.registry import register

TITLE = "Phát biểu đã thu tiền chưa có chứng từ phù hợp"


@register
class R09ReceivedClaimSupport(Rule):
    rule_id = "R09"
    title = "Phát biểu đã thu tiền chưa được hỗ trợ"

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
            claims.extend(c for c in found if c.claim_type == ClaimType.RECEIVED)
        if claims:
            borrower = resolve_borrower(ctx.case, ctx.config)
            results.extend(self._check(ctx, claim, borrower) for claim in claims)
        if not results:
            results.append(self.not_applicable(ctx, "NO_RECEIVED_CLAIM", "Đề nghị vay không khai khoản đã thu."))
        return results

    def _check(self, ctx: RuleContext, claim: ReceiptClaim, borrower: Optional[Borrower]) -> RuleResult:
        ref = claim.contract_ref_raw or "hồ sơ"
        subject = f"{claim.loan_request.document_id}:receipt_{claim.index}"
        if claim.amount is None or (claim.amount.currency not in (None, ctx.config.base_currency)):
            return self.unknown(ctx, "CLAIM_AMOUNT_UNAVAILABLE", "Chưa đọc chắc số tiền khai đã thu (VND).",
                                subject=subject, evidence_ids=claim.evidence_ids)
        if borrower is None:
            return self.unknown(ctx, "BORROWER_IDENTITY_UNAVAILABLE",
                                "Chưa xác định doanh nghiệp vay nên chưa đối chiếu được bên nhận tiền.",
                                subject=subject, evidence_ids=claim.evidence_ids)

        contracts = contracts_by_ref(ctx.case, claim.contract_ref)
        contract = contracts[0] if len(contracts) == 1 else None
        invoices = linked_documents(ctx.case, contract, DocType.INVOICE) if contract else []
        candidates = linked_payments(ctx.case, contract, claim.contract_ref, invoices)
        request_date = claim.loan_request.date("request_date")

        accepted: List[Tuple[DocView, Money]] = []
        rejected = []
        for payment in candidates:
            reason, money = self._match(payment, borrower, request_date, ctx.config)
            if reason:
                rejected.append({"document_version_id": payment.id, "reason": reason})
            else:
                accepted.append((payment, money))

        claimed = claim.amount.amount
        supported = sum((m.amount for _, m in accepted), Decimal(0))
        evidence = claim.evidence_ids + [e for p, _ in accepted for e in p.evidence_ids("amount", "date", "payee_name")]
        operands = {
            "contract_ref": claim.contract_ref,
            "claimed_vnd": fmt(claimed),
            "supported_vnd": fmt(supported),
            "unclear_vnd": fmt(max(claimed - supported, Decimal(0))),
            "matched_payment_version_ids": [p.id for p, _ in accepted],
            "rejected_candidates": rejected,
        }
        if supported >= claimed:
            return self.passed(ctx, "PAYMENT_DOCUMENT_FOUND",
                               f"Có chứng từ thanh toán phù hợp {display_vnd(supported)}; reviewer xác minh trước khi ghi nhận.",
                               subject=subject, operands=operands, evidence_ids=evidence)
        request = SuggestedRequest(type=DocType.PAYMENT_RECORD, contract_ref=claim.contract_ref,
                                   purpose=f"Chứng từ thanh toán cho khoản khai đã thu từ {ref}")
        if supported > 0:
            return self.issue(
                ctx, "RECEIVED_CLAIM_PARTIALLY_SUPPORTED",
                f"Khai đã thu {display_vnd(claimed)} từ {ref}; chứng từ phù hợp hỗ trợ {display_vnd(supported)}, "
                f"phần {display_vnd(claimed - supported)} chưa có chứng từ phù hợp trong hồ sơ.",
                subject=subject, issue_type="received_claim", priority=Priority.HIGH, title=TITLE,
                evidence_ids=evidence, operands=operands, suggested_request=request,
            )
        return self.issue(
            ctx, "RECEIVED_CLAIM_UNSUPPORTED",
            f"Khai đã thu {display_vnd(claimed)} từ {ref} nhưng chưa có chứng từ thanh toán phù hợp trong hồ sơ.",
            subject=subject, issue_type="received_claim", priority=Priority.HIGH, title=TITLE,
            evidence_ids=evidence, operands=operands, suggested_request=request,
        )

    @staticmethod
    def _match(payment: DocView, borrower: Borrower, request_date, config: RuleConfig):
        """Trả (lý do loại, None) hoặc ("", số tiền). Không tự ghép chứng từ có bên nhận khác."""
        payee = normalize_name(payment.value("payee_name"), config.abbreviations)
        if not payee or payee != borrower.name_key:
            return "PAYEE_NOT_BORROWER", None
        money = money_from_fact(payment.fact("amount")) if not payment.is_uncertain("amount") else None
        if money is None:
            return "AMOUNT_UNAVAILABLE", None
        if money.currency not in (None, config.base_currency):
            return "CURRENCY_OUT_OF_SCOPE", None
        paid_on = payment.date("date")
        if paid_on is None:
            return "DATE_UNAVAILABLE", None
        if request_date is not None and paid_on > request_date:
            return "PAID_AFTER_STATEMENT", None
        return "", money
