"""Tiền dùng Decimal; JSON dùng chuỗi thập phân. Không bao giờ dùng float."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping, Optional

from ..contracts.inputs import Fact

ONE = Decimal(1)


@dataclass(frozen=True)
class Money:
    amount: Decimal
    currency: Optional[str]
    rounding_unit: Decimal
    raw: Optional[str] = None


def parse_decimal(value: Any) -> Optional[Decimal]:
    if isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value if value.is_finite() else None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, str):
        try:
            parsed = Decimal(value.strip())
        except InvalidOperation:
            return None
        return parsed if parsed.is_finite() else None
    return None


def _multiplier(value: Any) -> Optional[Decimal]:
    if value is None:
        return ONE
    parsed = parse_decimal(value)
    return parsed if parsed is not None and parsed > 0 else None


def scale(value: Any, multiplier: Any = None, currency: Optional[str] = None,
          raw: Optional[str] = None) -> Optional[Money]:
    """"500" trong bảng đơn vị triệu -> 500000000; đơn vị làm tròn suy từ số chữ số thập phân hiển thị."""
    number = parse_decimal(value)
    factor = _multiplier(multiplier)
    if number is None or factor is None:
        return None
    exponent = number.as_tuple().exponent
    decimals = -exponent if isinstance(exponent, int) and exponent < 0 else 0
    return Money(
        amount=number * factor,
        currency=currency,
        rounding_unit=ONE.scaleb(-decimals) * factor,
        raw=raw,
    )


def money_from_fact(fact: Optional[Fact], default_multiplier: Any = None,
                    default_currency: Optional[str] = None) -> Optional[Money]:
    if fact is None or fact.value is None:
        return None
    multiplier = fact.multiplier if fact.multiplier is not None else default_multiplier
    return scale(fact.value, multiplier, fact.currency or default_currency, fact.raw_value)


def money_from_mapping(item: Mapping[str, Any], amount_key: str = "amount") -> Optional[Money]:
    return scale(item.get(amount_key), item.get("multiplier"), item.get("currency"), item.get("raw_amount"))


def fmt(amount: Decimal) -> str:
    """Chuỗi thập phân cho JSON, không dùng ký hiệu mũ."""
    return format(amount, "f")


def display_vnd(amount: Decimal) -> str:
    whole = amount == amount.to_integral_value()
    text = f"{int(amount):,}" if whole else f"{amount:,.2f}"
    return text.replace(",", "_").replace(".", ",").replace("_", ".") + " VND"
