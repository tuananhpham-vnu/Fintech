"""Khoản thu khai trong đề nghị vay + hợp đồng chính được nối bằng ref (không bằng tên file/tên công ty)."""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

import normalize
from linking import Doc, SnapshotView, unique

from .hard_cases import resolve_payment_condition

LOAN_RECEIPT_FIELDS = ("loan.amount", "money.currency", "receipt.amount", "receipt.contract_ref",
                       "receipt.scope_ref", "receipt.claim_type", "receipt.expected_date")


@dataclass
class Receipt:
    claim_type: str | None
    amount: Decimal | None
    ref: str | None
    scope: str | None
    ref_raw: str | None
    scope_raw: str | None
    loan_request: Doc | None
    contract: Doc | None = None
    contract_amount: Decimal | None = None
    counterparty_tax_id: str | None = None
    condition: dict | None = None
    problems: list[str] = field(default_factory=list)   # lý do unknown (thiếu/mơ hồ)
    hitl_reasons: list[str] = field(default_factory=list)  # ca khó/LLM: REVIEW_REQUIRED, LLM_ASSISTED, ...
    evidence_ids: list[str] = field(default_factory=list)

    def issue_key(self, rule: str, suffix: str, tax_id: str) -> str:
        marker = f"DOC-{self.loan_request.id}" if self.loan_request else "DOC-none"
        return f"{rule}:{tax_id}:{self.ref or marker}:{self.scope or marker}:{suffix}"

    @property
    def label(self) -> str:
        return f"{self.ref_raw or '?'}/{self.scope_raw or '?'}"


def read_receipt(view: SnapshotView) -> Receipt | None:
    """None khi hồ sơ không có đề nghị vay dùng được (R01 xử lý)."""
    loans = view.of_type("loan_request")
    if not loans:
        return None
    loan = loans[0]
    receipt = Receipt(
        claim_type=loan.value("receipt.claim_type"),
        amount=normalize.amount(loan.value("receipt.amount")),
        ref=normalize.ref(loan.value("receipt.contract_ref")),
        scope=normalize.ref(loan.value("receipt.scope_ref")),
        ref_raw=normalize.text(loan.value("receipt.contract_ref")),
        scope_raw=normalize.text(loan.value("receipt.scope_ref")),
        loan_request=loan,
    )
    if len(loans) > 1:
        receipt.problems.append("MULTIPLE_LOAN_REQUESTS")
    if loan.state("receipt.claim_type") != "readable" or receipt.claim_type == "unknown":
        receipt.problems.append("CLAIM_TYPE_UNCLEAR")
    if receipt.ref is None or receipt.scope is None:
        receipt.problems.append("RECEIPT_REF_OR_SCOPE_UNCLEAR")
    if loan.value("money.currency") not in (None, "VND"):
        receipt.problems.append("UNSUPPORTED_CURRENCY")

    receipt.evidence_ids = loan.evidence(LOAN_RECEIPT_FIELDS)
    contracts = [c for c in view.of_type("contract") if receipt.ref and normalize.ref(c.value("contract.ref")) == receipt.ref]
    if len(contracts) != 1:
        receipt.problems.append("CONTRACT_NOT_FOUND" if not contracts else "AMBIGUOUS_CONTRACT")
        return receipt

    contract = contracts[0]
    receipt.contract = contract
    receipt.contract_amount = normalize.amount(contract.value("contract.amount"))
    receipt.counterparty_tax_id = normalize.tax_id(contract.value("parties.counterparty.tax_id"))
    cache_key = ("payment_condition", contract.id)
    if cache_key not in view.cache:   # R08 và R09 cùng đọc: chỉ gọi LLM một lần mỗi run
        view.cache[cache_key] = resolve_payment_condition(view, contract, view.semantic)
    resolution = view.cache[cache_key]
    receipt.condition, receipt.hitl_reasons = resolution.condition, list(resolution.reason_codes)
    if contract.value("money.currency") not in (None, "VND"):
        receipt.problems.append("UNSUPPORTED_CURRENCY")
    if normalize.tax_id(contract.value("parties.borrower.tax_id")) != view.borrower_tax_id:
        receipt.problems.append("CONTRACT_BORROWER_NOT_VERIFIED")
    contract_scope = normalize.ref(contract.value("contract.scope_ref"))
    if contract_scope and receipt.scope and contract_scope != receipt.scope:
        receipt.problems.append("RECEIPT_SCOPE_NOT_IN_CONTRACT")

    financials = view.of_type("financial_statement")
    currency_basis = [e for f in financials for e in f.evidence(["money.currency"])]
    receipt.evidence_ids = unique(contract.evidence() + receipt.evidence_ids + currency_basis)
    return receipt
