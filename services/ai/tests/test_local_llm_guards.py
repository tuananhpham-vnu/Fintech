"""Guard cho output của model local nhỏ (gemma3:4b): nhận cách ghi ngày theo nguồn khi không mơ hồ,
và chặn field văn bản tự do lấy nhầm dòng không liên quan. Offline."""
from __future__ import annotations

import json

import pytest

from extraction import grounding as g
from runner.config import DEFAULT_CONTRACTS_DIR

REGISTRY = g.Registry.from_json(json.loads((DEFAULT_CONTRACTS_DIR / "field-registry.json").read_text("utf-8")))


@pytest.mark.parametrize("value, quote, expected", [
    ("2026-10-15", "Ngày nghiệm thu: 15/10/2026.", "2026-10-15"),
    ("15/10/2026", "Ngày nghiệm thu: 15/10/2026.", "2026-10-15"),     # cách ghi của nguồn
    ("15/10/2026", "Từ 15/10/2026 đến 20/10/2026.", None),            # hai ngày: mơ hồ
    ("16/10/2026", "Ngày nghiệm thu: 15/10/2026.", None),             # sai một chữ số
    ("10/15/2026", "Ngày nghiệm thu: 15/10/2026.", None),             # kiểu tháng trước không có trong nguồn
])
def test_source_style_dates(value, quote, expected):
    assert g.check_value("acceptance.date", "string", value, quote, REGISTRY).value == expected


def _span(text, quote):
    start = text.index(quote)
    return g.Span(1, start, start + len(quote), quote)


def test_scope_text_must_come_from_an_acceptance_sentence():
    text = ("BIÊN BẢN NGHIỆM THU MÔ PHỎNG\nSYNTHETIC | Dữ liệu kiểm thử, không có giá trị giao dịch\n"
            "Nghiệm thu toàn bộ S1, giá trị 500000000 VND.")
    banner = "Dữ liệu kiểm thử, không có giá trị giao dịch"
    assert g.check_source("acceptance.scope_text", "string", banner, [_span(text, banner)], [text],
                          REGISTRY).problem == "UNVERIFIED_FIELD_LABEL"
    good = "Nghiệm thu toàn bộ S1"
    assert g.check_source("acceptance.scope_text", "string", good, [_span(text, good)], [text],
                          REGISTRY).value == good


def test_positional_schema_only_for_grammar_providers(contracts):
    from types import SimpleNamespace
    from extraction.extractor import Extractor
    keys = [f["field_key"] for f in REGISTRY.fields("acceptance_record")]
    local = Extractor(contracts, SimpleNamespace(positional_schema=True), None).response_schema("acceptance_record")
    fields = local["properties"]["fields"]
    assert (fields["minItems"], fields["maxItems"]) == (len(keys), len(keys)) and "items" not in fields
    assert [p["anyOf"][0]["properties"]["field_key"]["enum"] for p in fields["prefixItems"]] == [[k] for k in keys]
    assert fields["prefixItems"][0]["anyOf"][0]["properties"]["evidence"]["minItems"] == 1
    cloud = Extractor(contracts, SimpleNamespace(), None).response_schema("acceptance_record")
    assert "prefixItems" not in cloud["properties"]["fields"]
