"""Xác định doanh nghiệp vay và vai trò các bên trong từng tài liệu (dùng cho R02, R03, R10)."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, List, Optional, Tuple

from ..config import RuleConfig
from ..contracts.inputs import DocType, Quality
from .normalize import TaxId, name_similarity, normalize_name, normalize_tax_id
from .views import CaseView, DocView

IDENTITY_DOC_TYPES = (
    DocType.LOAN_REQUEST,
    DocType.FINANCIAL_STATEMENT,
    DocType.CONTRACT,
    DocType.INVOICE,
    DocType.ACCEPTANCE_RECORD,
)

# Tài liệu tự khai là của doanh nghiệp vay: (trường tên, trường mã số thuế)
_DECLARED_FIELDS = {
    DocType.REGISTRATION: ("borrower_name", "tax_id"),
    DocType.LOAN_REQUEST: ("borrower_name", "tax_id"),
    DocType.FINANCIAL_STATEMENT: ("entity_name", "tax_id"),
}
# Tài liệu hai bên với trường riêng: (vai trò, trường tên, trường mã số thuế)
_PAIR_FIELDS = {
    DocType.INVOICE: (("seller", "seller_name", "seller_tax_id"), ("buyer", "buyer_name", "buyer_tax_id")),
    DocType.PAYMENT_RECORD: (("payer", "payer_name", None), ("payee", "payee_name", None)),
}
# Tài liệu nhiều bên dạng danh sách [{name, tax_id, role}]
_LIST_FIELDS = {DocType.CONTRACT: "parties", DocType.ACCEPTANCE_RECORD: "parties"}


class MatchKind(str, Enum):
    TAX_EXACT = "tax_exact"
    TAX_BRANCH = "tax_branch"
    TAX_MISMATCH = "tax_mismatch"
    TAX_UNCERTAIN = "tax_uncertain"
    NAME_ONLY = "name_only"
    NAME_CANDIDATE = "name_candidate"
    NOT_FOUND = "not_found"


@dataclass(frozen=True)
class PartyMention:
    doc: DocView
    role: str
    name: Optional[str]
    tax_raw: Optional[str]
    tax_quality: Quality
    fact_names: Tuple[str, ...]
    declared: bool

    @property
    def evidence_ids(self) -> List[str]:
        return self.doc.evidence_ids(*self.fact_names)


@dataclass(frozen=True)
class Borrower:
    name: Optional[str]
    name_key: str
    tax: TaxId
    source: DocView
    fact_names: Tuple[str, ...]

    @property
    def evidence_ids(self) -> List[str]:
        return self.source.evidence_ids(*self.fact_names)


@dataclass(frozen=True)
class BorrowerMatch:
    kind: MatchKind
    mention: Optional[PartyMention] = None
    similarity: Optional[float] = None


def _raw(doc: DocView, name: Optional[str]) -> Tuple[Any, Quality]:
    """Giá trị kèm chất lượng, kể cả khi mơ hồ, để rule phân biệt 'khác' với 'đọc chưa chắc'."""
    fact = doc.fact(name) if name else None
    if fact is None or fact.value in (None, ""):
        return None, Quality.READABLE
    return fact.value, fact.quality


def party_mentions(doc: DocView) -> List[PartyMention]:
    doc_type = doc.doc_type
    if doc_type in _DECLARED_FIELDS:
        name_field, tax_field = _DECLARED_FIELDS[doc_type]
        name, _ = _raw(doc, name_field)
        tax, quality = _raw(doc, tax_field)
        return [PartyMention(doc, "borrower", name, tax, quality, (name_field, tax_field), True)]
    if doc_type in _PAIR_FIELDS:
        mentions = []
        for role, name_field, tax_field in _PAIR_FIELDS[doc_type]:
            name, _ = _raw(doc, name_field)
            tax, quality = _raw(doc, tax_field)
            fields = tuple(f for f in (name_field, tax_field) if f)
            mentions.append(PartyMention(doc, role, name, tax, quality, fields, False))
        return mentions
    if doc_type in _LIST_FIELDS:
        field = _LIST_FIELDS[doc_type]
        parties, quality = _raw(doc, field)
        if not isinstance(parties, list):
            return []
        return [
            PartyMention(doc, str(p.get("role", "unknown")), p.get("name"), p.get("tax_id"), quality, (field,), False)
            for p in parties if isinstance(p, dict)
        ]
    return []


def resolve_borrower(case: CaseView, config: RuleConfig) -> Optional[Borrower]:
    """Danh tính chuẩn lấy từ giấy đăng ký; thiếu thì dùng đề nghị vay."""
    for doc_type in (DocType.REGISTRATION, DocType.LOAN_REQUEST):
        name_field, tax_field = _DECLARED_FIELDS[doc_type]
        for doc in case.ready(doc_type):
            tax = normalize_tax_id(doc.value(tax_field))
            if tax is not None:
                name = doc.value(name_field)
                return Borrower(name, normalize_name(name, config.abbreviations), tax, doc, (name_field, tax_field))
    return None


def match_borrower(doc: DocView, borrower: Borrower, config: RuleConfig) -> BorrowerMatch:
    mentions = party_mentions(doc)
    if not mentions:
        return BorrowerMatch(MatchKind.NOT_FOUND)
    declared = [m for m in mentions if m.declared]
    if declared:
        return _classify(declared[0], borrower, config)
    for mention in mentions:
        tax = normalize_tax_id(mention.tax_raw)
        if tax is not None and tax.base == borrower.tax.base:
            return _classify(mention, borrower, config)
    for mention in mentions:
        if borrower.name_key and normalize_name(mention.name, config.abbreviations) == borrower.name_key:
            return _classify(mention, borrower, config)
    scored = [(_similarity(m, borrower, config), m) for m in mentions]
    best_score, best = max(scored, key=lambda pair: pair[0])
    if best_score >= config.name_candidate_threshold:
        return BorrowerMatch(MatchKind.NAME_CANDIDATE, best, best_score)
    return BorrowerMatch(MatchKind.NOT_FOUND)


def names_equal(mention: PartyMention, borrower: Borrower, config: RuleConfig) -> bool:
    return bool(borrower.name_key) and normalize_name(mention.name, config.abbreviations) == borrower.name_key


def _similarity(mention: PartyMention, borrower: Borrower, config: RuleConfig) -> float:
    return name_similarity(normalize_name(mention.name, config.abbreviations), borrower.name_key)


def _classify(mention: PartyMention, borrower: Borrower, config: RuleConfig) -> BorrowerMatch:
    similarity = _similarity(mention, borrower, config)
    if mention.tax_raw in (None, ""):
        kind = MatchKind.NAME_ONLY if names_equal(mention, borrower, config) else MatchKind.NAME_CANDIDATE
        return BorrowerMatch(kind, mention, similarity)
    tax = normalize_tax_id(mention.tax_raw)
    if mention.tax_quality != Quality.READABLE or tax is None:
        kind = MatchKind.TAX_UNCERTAIN
    elif tax == borrower.tax:
        kind = MatchKind.TAX_EXACT
    elif tax.base == borrower.tax.base:
        kind = MatchKind.TAX_BRANCH
    else:
        kind = MatchKind.TAX_MISMATCH
    return BorrowerMatch(kind, mention, similarity)
