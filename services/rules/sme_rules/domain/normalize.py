"""Chuẩn hóa định danh, tên, số tham chiếu và ngày (phần 04 - Chuẩn hóa trước khi so sánh)."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from difflib import SequenceMatcher
from typing import Any, Mapping, Optional

_TAX_ID = re.compile(r"^(\d{10})(?:-?(\d{3}))?$")
_SEPARATORS = re.compile(r"[\s.–—]")
_PUNCTUATION = re.compile(r"[^\w\s]")


@dataclass(frozen=True)
class TaxId:
    base: str
    branch: Optional[str] = None

    @property
    def canonical(self) -> str:
        return f"{self.base}-{self.branch}" if self.branch else self.base


def normalize_tax_id(raw: Any) -> Optional[TaxId]:
    """Giữ số 0 đầu, bỏ khoảng trắng/dấu chấm; mã chi nhánh 3 số tách riêng."""
    if raw is None:
        return None
    match = _TAX_ID.match(_SEPARATORS.sub("", str(raw)))
    if not match:
        return None
    return TaxId(base=match.group(1), branch=match.group(2))


def normalize_name(raw: Optional[str], abbreviations: Mapping[str, str]) -> str:
    """So khớp tên không phân biệt hoa/thường, khoảng trắng, dấu câu và dạng viết tắt đã khai báo."""
    if not raw:
        return ""
    text = _PUNCTUATION.sub(" ", unicodedata.normalize("NFC", raw).lower())
    tokens = []
    for token in text.split():
        tokens.extend(abbreviations.get(token, token).split())
    return " ".join(tokens)


def name_similarity(left: str, right: str) -> float:
    """Chỉ dùng để tạo ứng viên cần xác minh, không dùng để tự hợp nhất."""
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, left, right).ratio()


def normalize_ref(raw: Any) -> Optional[str]:
    """Số hợp đồng/hóa đơn: bỏ khoảng trắng, chữ hoa, Đ -> D. Không bỏ dấu phân cách để tránh ghép nhầm."""
    if raw is None:
        return None
    text = unicodedata.normalize("NFC", str(raw)).upper().replace("Đ", "D")
    text = "".join(ch for ch in unicodedata.normalize("NFD", text) if not unicodedata.combining(ch))
    text = re.sub(r"\s+", "", text)
    return text or None


def parse_date(value: Any) -> Optional[date]:
    """Chỉ nhận ISO YYYY-MM-DD; chuỗi ngày mơ hồ phải được P2/reviewer xác định trước."""
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value.strip())
        except ValueError:
            return None
    return None
