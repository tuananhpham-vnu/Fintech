"""Nối chứng từ với hợp đồng: chỉ bằng số tham chiếu khớp chắc hoặc liên kết reviewer đã xác nhận.

Liên kết do LLM đề xuất không được nhận ở đây khi còn mơ hồ.
"""
from __future__ import annotations

from typing import Iterable, List, Optional

from ..contracts.inputs import DocType, LinkRelation
from .views import CaseView, DocView

_RELATION_BY_TYPE = {
    DocType.INVOICE: LinkRelation.CONTRACT_INVOICE,
    DocType.ACCEPTANCE_RECORD: LinkRelation.ACCEPTANCE,
    DocType.PAYMENT_RECORD: LinkRelation.PAYMENT,
}


def contract_ref(contract: DocView) -> Optional[str]:
    return contract.ref("contract_no")


def contracts_by_ref(case: CaseView, ref: Optional[str]) -> List[DocView]:
    if ref is None:
        return []
    return [doc for doc in case.ready(DocType.CONTRACT) if contract_ref(doc) == ref]


def linked_documents(case: CaseView, contract: DocView, doc_type: DocType) -> List[DocView]:
    ref = contract_ref(contract)
    confirmed = case.linked_target_ids(contract.id, _RELATION_BY_TYPE[doc_type])
    return [
        doc for doc in case.ready(doc_type)
        if doc.id in confirmed or (ref is not None and doc.ref("contract_ref") == ref)
    ]


def linked_payments(case: CaseView, contract: Optional[DocView], claim_ref: Optional[str],
                    invoices: Iterable[DocView] = ()) -> List[DocView]:
    """Chứng từ thanh toán nối qua hợp đồng, số hóa đơn đã nối, hoặc liên kết reviewer."""
    refs = {r for r in (claim_ref, contract_ref(contract) if contract else None) if r}
    invoice_nos = {inv.ref("invoice_no") for inv in invoices} - {None}
    confirmed = case.linked_target_ids(contract.id, LinkRelation.PAYMENT) if contract else set()
    return [
        doc for doc in case.ready(DocType.PAYMENT_RECORD)
        if doc.id in confirmed
        or doc.ref("contract_ref") in refs
        or doc.ref("invoice_ref") in invoice_nos
    ]
