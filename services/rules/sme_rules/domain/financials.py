"""Cơ sở so sánh BCTC - dùng chung cho R04 (báo cáo) và R05 (chặn phép tính khi không đủ cơ sở)."""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import List, Optional

from ..config import RuleConfig
from ..contracts.inputs import CaseInfo
from ..contracts.outputs import RuleStatus
from .money import Money, money_from_fact, parse_decimal
from .views import DocView

BASIS_FIELDS = ("period_end", "statement_scope", "currency", "unit_multiplier")


@dataclass(frozen=True)
class FsBasis:
    status: RuleStatus
    reason_code: str
    missing: List[str] = field(default_factory=list)
    multiplier: Optional[Decimal] = None

    @property
    def comparable(self) -> bool:
        return self.status == RuleStatus.PASS


def assess_basis(doc: DocView, case: CaseInfo, config: RuleConfig) -> FsBasis:
    currency = doc.value("currency")
    if currency is not None and currency != config.base_currency:
        return FsBasis(RuleStatus.NOT_APPLICABLE, "CURRENCY_OUT_OF_SCOPE")
    missing = [name for name in BASIS_FIELDS if doc.value(name) is None]
    if doc.value("statement_scope") == "unknown":
        missing.append("statement_scope")
    multiplier = parse_decimal(doc.value("unit_multiplier"))
    if multiplier is None and "unit_multiplier" not in missing:
        missing.append("unit_multiplier")
    period_end = doc.date("period_end")
    if period_end is None and "period_end" not in missing:
        missing.append("period_end")
    if missing:
        return FsBasis(RuleStatus.UNKNOWN, "BASIS_INCOMPLETE", sorted(set(missing)))
    period_start = doc.date("period_start")
    expected = case.reporting_period
    if period_end != expected.end or (period_start is not None and period_start != expected.start):
        return FsBasis(RuleStatus.ISSUE, "PERIOD_MISMATCH", multiplier=multiplier)
    return FsBasis(RuleStatus.PASS, "BASIS_OK", multiplier=multiplier)


def fs_amount(doc: DocView, name: str, basis: FsBasis) -> Optional[Money]:
    if doc.is_uncertain(name):
        return None
    return money_from_fact(doc.fact(name), default_multiplier=basis.multiplier)
