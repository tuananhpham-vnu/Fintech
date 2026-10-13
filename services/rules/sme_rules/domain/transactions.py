"""Cấu trúc giao dịch đọc từ fact: khoản thu khai báo, điều khoản thanh toán, khóa hóa đơn."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import List, Optional, Tuple

from .money import Money, money_from_mapping
from .normalize import normalize_ref, normalize_tax_id, parse_date
from .views import DocView


class ClaimType(str, Enum):
    EXPECTED = "expected"
    DUE = "due"
    RECEIVED = "received"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class ReceiptClaim:
    loan_request: DocView
    index: int
    claim_type: ClaimType
    amount: Optional[Money]
    expected_date: Optional[date]
    contract_ref: Optional[str]
    contract_ref_raw: Optional[str]

    @property
    def evidence_ids(self) -> List[str]:
        return self.loan_request.evidence_ids("expected_receipts")


def receipt_claims(loan_request: DocView) -> Tuple[List[ReceiptClaim], bool]:
    """Trả (danh sách khoản thu, có_mơ_hồ). Phát biểu đọc chưa chắc không được dùng làm căn cứ."""
    if loan_request.is_uncertain("expected_receipts"):
        return [], True
    items = loan_request.value("expected_receipts") or []
    claims = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        try:
            claim_type = ClaimType(item.get("claim_type", "unknown"))
        except ValueError:
            claim_type = ClaimType.UNKNOWN
        claims.append(ReceiptClaim(
            loan_request=loan_request,
            index=index,
            claim_type=claim_type,
            amount=money_from_mapping(item),
            expected_date=parse_date(item.get("expected_date")),
            contract_ref=normalize_ref(item.get("contract_ref")),
            contract_ref_raw=item.get("contract_ref"),
        ))
    return claims, False


@dataclass(frozen=True)
class PaymentTerm:
    event_type: Optional[str]
    event_ref: Optional[str]
    offset_days: Optional[int]
    calendar_basis: Optional[str]
    concurrent_conditions: Tuple[str, ...]


def payment_terms(contract: DocView) -> Optional[List[PaymentTerm]]:
    """None khi chưa đọc được điều khoản (khác với danh sách rỗng)."""
    items = contract.value("payment_terms")
    if not isinstance(items, list):
        return None
    terms = []
    for item in items:
        if not isinstance(item, dict):
            continue
        offset = item.get("offset_days")
        terms.append(PaymentTerm(
            event_type=item.get("event_type"),
            event_ref=item.get("event_ref"),
            offset_days=offset if isinstance(offset, int) and not isinstance(offset, bool) else None,
            calendar_basis=item.get("calendar_basis"),
            concurrent_conditions=tuple(item.get("concurrent_conditions") or ()),
        ))
    return terms


def invoice_key(invoice: DocView) -> Optional[Tuple[str, str, str, str]]:
    """Định danh hóa đơn: MST bên phát hành + mẫu số + ký hiệu + số. Thiếu một phần -> None."""
    seller = normalize_tax_id(invoice.value("seller_tax_id"))
    parts = [normalize_ref(invoice.value(name)) for name in ("template_no", "series", "invoice_no")]
    if seller is None or any(p is None for p in parts):
        return None
    return (seller.canonical, parts[0], parts[1], parts[2])
