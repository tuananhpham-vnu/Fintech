"""Chuẩn hóa theo Contracts §9.2: NFC + trim; MST giữ 10 hoặc 10-3 chữ số; ref/scope uppercase bỏ khoảng trắng,
giữ dấu gạch (HĐ01-A khác HĐ01); tiền là Decimal, không float; ngày chỉ nhận ISO, không đoán locale."""
from __future__ import annotations

import re
import unicodedata
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

_DASHES = dict.fromkeys(map(ord, "‐‑‒–—−"), "-")
_TAX_ID = re.compile(r"^\d{10}(-\d{3})?$")
_AMOUNT = re.compile(r"^\d+(\.\d{1,2})?$")


def text(raw: object) -> str | None:
    if not isinstance(raw, str):
        return None
    value = unicodedata.normalize("NFC", raw).strip()
    return value or None


def tax_id(raw: object) -> str | None:
    value = text(raw)
    if value is None:
        return None
    value = re.sub(r"\s+", "", value).translate(_DASHES)
    return value if _TAX_ID.match(value) else None


def ref(raw: object) -> str | None:
    value = text(raw)
    if value is None:
        return None
    return re.sub(r"\s+", "", value).translate(_DASHES).upper() or None


def amount(raw: object) -> Decimal | None:
    value = text(raw)
    if value is None or not _AMOUNT.match(value):
        return None
    try:
        return Decimal(value)
    except InvalidOperation:
        return None


def format_amount(value: Decimal) -> str:
    """Chuỗi khớp pattern ^\\d+(\\.\\d{1,2})?$ của contract, không ký hiệu mũ."""
    rendered = format(value.quantize(Decimal("0.01")), "f")
    return rendered.rstrip("0").rstrip(".")


def iso_date(raw: object) -> date | None:
    value = text(raw)
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def due_date(event_date: date | None, offset_days: int | None, calendar_basis: str | None,
             counting_convention: str | None) -> date | None:
    """Specs §10: chỉ tính khi calendar_days + offset có nguồn + cách đếm xác định."""
    if event_date is None or offset_days is None or calendar_basis != "calendar_days":
        return None
    if counting_convention == "exclude_event_day":
        return event_date + timedelta(days=offset_days)
    if counting_convention == "include_event_day":
        return event_date + timedelta(days=max(offset_days - 1, 0))
    return None
