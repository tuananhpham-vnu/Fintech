from decimal import Decimal

from sme_rules.config import DEFAULT_ABBREVIATIONS
from sme_rules.domain.money import display_vnd, scale
from sme_rules.domain.normalize import normalize_name, normalize_ref, normalize_tax_id, parse_date


def test_tax_id_keeps_leading_zero_and_strips_separators():
    assert normalize_tax_id(" 0100 000.001 ").canonical == "0100000001"
    assert normalize_tax_id("0100000001-001").branch == "001"
    assert normalize_tax_id("0100000001001").canonical == "0100000001-001"
    assert normalize_tax_id("12345") is None
    assert normalize_tax_id(None) is None


def test_name_abbreviations_and_case():
    full = normalize_name("Công ty TNHH Sao Mai Demo", DEFAULT_ABBREVIATIONS)
    assert normalize_name("CTY  tnhh Sao Mai demo.", DEFAULT_ABBREVIATIONS) == full
    assert normalize_name("Công ty trách nhiệm hữu hạn Sao Mai Demo", DEFAULT_ABBREVIATIONS) == full


def test_t04_unit_normalization():
    # 500 triệu và 500000 nghìn bằng nhau sau chuẩn hóa
    assert scale("500", "1000000").amount == scale("500000", "1000").amount == Decimal("500000000")


def test_rounding_unit_from_display_precision():
    assert scale("1000", "1000000").rounding_unit == Decimal("1000000")
    assert scale("398.5", "1000000").rounding_unit == Decimal("100000")


def test_money_rejects_float_and_garbage():
    assert scale(500.0) is None
    assert scale("abc") is None
    assert scale("500", "0") is None


def test_refs_and_dates():
    assert normalize_ref("HĐ 01") == normalize_ref("hd01") == "HD01"
    assert normalize_ref("HĐ02") != normalize_ref("HĐ01")
    assert parse_date("2026-10-15").isoformat() == "2026-10-15"
    assert parse_date("03/04/26") is None  # chuỗi mơ hồ không tự đoán


def test_display_vnd():
    assert display_vnd(Decimal("500000000")) == "500.000.000 VND"
