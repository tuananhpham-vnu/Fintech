"""R07 - Tổng hóa đơn hợp lệ so với giá trị hợp đồng, chỉ khi cùng cơ sở thuế/phạm vi."""
from __future__ import annotations

from collections import Counter
from decimal import Decimal
from typing import List

from ..contracts.inputs import DocType
from ..contracts.outputs import Priority, RuleResult
from ..domain.linking import contract_ref, linked_documents
from ..domain.money import display_vnd, fmt, money_from_fact
from ..domain.transactions import invoice_key
from ..engine.base import Rule, RuleContext
from ..engine.registry import register

AMOUNT_FIELD_BY_VAT_BASIS = {"inclusive": "gross_amount", "exclusive": "net_amount"}


@register
class R07InvoiceVersusContract(Rule):
    rule_id = "R07"
    title = "Giá trị hóa đơn và hợp đồng"

    def evaluate(self, ctx: RuleContext) -> List[RuleResult]:
        contracts = ctx.case.ready(DocType.CONTRACT)
        if not contracts:
            return [self.not_applicable(ctx, "NO_CONTRACT", "Hồ sơ chưa có hợp đồng để đối chiếu hóa đơn.")]
        return [self._check(ctx, contract) for contract in contracts]

    def _check(self, ctx: RuleContext, contract) -> RuleResult:
        subject = contract.document_id
        ref = contract_ref(contract)
        if ref is None:
            return self.unknown(ctx, "CONTRACT_NO_UNAVAILABLE", "Chưa đọc chắc số hợp đồng; chưa nối được hóa đơn.",
                                subject=subject)
        invoices = linked_documents(ctx.case, contract, DocType.INVOICE)
        if not invoices:
            return self.not_applicable(ctx, "NO_LINKED_INVOICE", f"Chưa có hóa đơn nối chắc với {ref}.", subject=subject)

        operands = {"contract_ref": ref, "invoice_version_ids": [d.id for d in invoices]}
        evidence = contract.evidence_ids("total_amount", "vat_basis")
        total = money_from_fact(contract.fact("total_amount")) if not contract.is_uncertain("total_amount") else None
        vat_basis = contract.value("vat_basis")
        currency = contract.value("currency")

        def unknown(code: str, message: str) -> RuleResult:
            return self.unknown(ctx, code, message, subject=subject, operands=operands, evidence_ids=evidence)

        if currency is not None and currency != ctx.config.base_currency:
            return self.not_applicable(ctx, "CURRENCY_OUT_OF_SCOPE", "Hợp đồng dùng ngoại tệ, ngoài phạm vi MVP.",
                                       subject=subject, operands=operands)
        if contract.value("amendments"):
            return unknown("AMENDMENT_BASIS_UNRESOLVED", "Hợp đồng có phụ lục; reviewer chọn phụ lục áp dụng trước khi so.")
        if total is None:
            return unknown("CONTRACT_AMOUNT_UNAVAILABLE", "Chưa đọc chắc giá trị hợp đồng.")
        if vat_basis not in AMOUNT_FIELD_BY_VAT_BASIS:
            return unknown("VAT_BASIS_UNSPECIFIED", "Hợp đồng chưa rõ giá trị gồm hay chưa gồm VAT.")
        if any(inv.value("adjustment_ref") for inv in invoices):
            return unknown("ADJUSTMENT_RELATION_UNRESOLVED",
                           "Có hóa đơn điều chỉnh/thay thế chưa xác định quan hệ; không cộng như hóa đơn thường.")
        keys = Counter(invoice_key(inv) for inv in invoices)
        if any(key is not None and count > 1 for key, count in keys.items()):
            return unknown("DUPLICATE_CANDIDATE_UNRESOLVED", "Có hóa đơn khả năng trùng; reviewer xử lý R06 trước.")

        amount_field = AMOUNT_FIELD_BY_VAT_BASIS[vat_basis]
        amounts = [(inv, money_from_fact(inv.fact(amount_field)) if not inv.is_uncertain(amount_field) else None)
                   for inv in invoices]
        if any(money is None for _, money in amounts):
            return unknown("INVOICE_AMOUNT_BASIS_MISSING",
                           f"Chưa có giá trị hóa đơn cùng cơ sở thuế với hợp đồng ({amount_field}); chưa kết luận.")

        invoiced = sum((money.amount for _, money in amounts), Decimal(0))
        evidence += [e for inv, _ in amounts for e in inv.evidence_ids(amount_field)]
        operands.update({
            "vat_basis": vat_basis,
            "amount_field": amount_field,
            "terms_vnd": {inv.id: fmt(money.amount) for inv, money in amounts},
            "invoiced_total_vnd": fmt(invoiced),
            "contract_total_vnd": fmt(total.amount),
        })
        if invoiced > total.amount:
            return self.issue(
                ctx, "INVOICE_TOTAL_EXCEEDS_CONTRACT",
                f"Tổng hóa đơn nối với {ref} là {display_vnd(invoiced)}, vượt giá trị hợp đồng {display_vnd(total.amount)} "
                f"trên cùng cơ sở thuế.",
                subject=subject, issue_type="invoice_exceeds_contract", priority=Priority.MEDIUM,
                title="Tổng hóa đơn vượt giá trị hợp đồng", evidence_ids=evidence, operands=operands,
            )
        return self.passed(ctx, "WITHIN_CONTRACT_VALUE", f"Tổng hóa đơn không vượt giá trị {ref}.",
                           subject=subject, operands=operands, evidence_ids=evidence)
