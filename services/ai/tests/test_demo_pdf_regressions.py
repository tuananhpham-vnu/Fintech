"""Audit regressions: synthetic PDFs only; no network, fixtures or gold edits."""
import unicodedata
from pathlib import Path
import re

import pymupdf
import pytest

from extraction import pdf, grounding
from runner.errors import ServiceError
from . import test_extraction as t
from .test_extraction import storage  # noqa: F401


def test_separator_maps_to_exact_original_offsets_and_quote():
    source = "prefix\nGiá\x03trị\x03hợp\x03đồng: (1.250.000) VND."
    quote = "Giá trị hợp đồng: (1.250.000) VND."
    span = grounding.find_quote(1, source, quote, [])
    assert span and span.text == source[span.start:span.end]
    assert "\x03" in span.text
    assert grounding.find_quote(1, source, quote, [(span.start, span.end)]) is None
    assert grounding.find_quote(1, source.replace("\x03", "\x04"), quote, []) is None
    assert grounding.find_quote(2, source, quote.replace("1.250.000", "1.250.001"), []) is None


def test_unicode_quote_mapping_returns_source_not_normalized_copy():
    source = "start " + unicodedata.normalize("NFD", "Tên doanh nghiệp: Công ty Tổng hợp")
    span = grounding.find_quote(1, source, "Tên doanh nghiệp: Công ty Tổng hợp", [])
    assert span and span.start == 6 and span.end == len(source)
    assert span.text == source[6:]


def test_separator_keeps_amount_sign_and_unit_guards(contracts):
    registry = grounding.Registry.from_json(contracts.load("field-registry.json"))
    quote = "Giá\x03trị\x03hợp\x03đồng: (1.250.000) VND"
    checked = grounding.check_value("contract.amount", "decimal", "-1250000", quote, registry)
    assert checked.value == "-1250000" and checked.problem == "NEGATIVE_AMOUNT"
    assert grounding.check_value("contract.amount", "decimal", "1250000", quote, registry).value is None
    unit = grounding.check_value("financial.unit_multiplier", "decimal", "1000000", "Đơn\x03vị: triệu đồng", registry)
    assert unit.value == "1000000"


def test_actual_pdf_font_control_separator_through_extractor(contracts, storage):
    font_path = next((path for path in [Path("C:/Windows/Fonts/arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")] if path.is_file()), None)
    if font_path is None:
        pytest.skip("Synthetic CID=3 font regression needs Arial or DejaVu Sans")
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_font(fontname="demo", fontfile=str(font_path))
    page.insert_text((30, 60), "Contract ref: DEMO001. Contract amount: 1250000 VND.", fontname="demo")
    changed = 0
    for font in page.get_fonts():
        kind, value = doc.xref_get_key(font[0], "ToUnicode")
        if kind != "xref":
            continue
        xref = int(value.split()[0])
        cmap = doc.xref_stream(xref)
        if b"<0003> <00a0>" in cmap or b"<0003> <0020>" in cmap:
            # Space glyph CID=3 remains visually a space. The faulty ToUnicode
            # control mapping reproduces the audited reader output on exact bytes.
            cmap = re.sub(rb"<0003> <(?:00a0|0020)>", b"<0003> <0003>", cmap)
            doc.update_stream(xref, cmap)
            changed += 1
    assert changed
    (storage / "font-control.pdf").write_bytes(doc.tobytes())
    doc.close()
    provider = t.FakeModel(t.answer(t.contract_fields(**{
        "contract.ref": t.field("contract.ref", "DEMO001", "Contract ref: DEMO001."),
        "contract.amount": t.field("contract.amount", "1250000", "Contract amount: 1250000 VND."),
    })))
    result = t.make_service(contracts, storage, provider).extract(t.extract_request(storage, "font-control.pdf"))
    assert "\x03" in result["pages"][0]["text"]
    assert "\x03" not in provider.calls[0]["user"]
    fields = {field["field_key"]: field for field in result["fields"]}
    assert fields["contract.ref"]["value"] == "DEMO001"
    assert fields["contract.amount"]["value"] == "1250000"
    assert "\x03" in fields["contract.ref"]["raw_value"]
    assert any(note["code"] == "TEXT_SEPARATOR_NORMALIZED" for note in result["diagnostics"])
    for evidence in result["evidence"]:
        assert evidence["quote"] in result["pages"][evidence["page"] - 1]["text"]


def test_vector_ink_is_ocr_and_real_blank_is_blank():
    doc = pymupdf.open()
    ink = doc.new_page()
    ink.draw_rect(pymupdf.Rect(40, 40, 260, 200), color=(0, 0, 0), fill=(0, 0, 0))
    doc.new_page()
    info = pdf.inspect(doc.tobytes(), with_pages=True)
    assert info.pages[0].image_count == 0 and info.pages[0].text == ""
    assert info.pages[0].needs_ocr and info.pages[0].ocr_reason == "vector_content"
    assert not info.pages[0].blank
    assert info.pages[1].blank and not info.pages[1].needs_ocr
    doc.close()


def test_garbled_without_images_requires_ocr(monkeypatch):
    doc = pymupdf.open()
    doc.new_page()
    raw = doc.tobytes()
    original = pymupdf.Page.get_text
    monkeypatch.setattr(pymupdf.Page, "get_text", lambda self, kind="text", *a, **kw:
                        "\ufffd" * 40 if kind == "text" else original(self, kind, *a, **kw))
    info = pdf.inspect(raw, with_pages=True)
    assert info.pages[0].needs_ocr and info.pages[0].ocr_reason == "garbled"
    doc.close()


def test_vector_without_ocr_reports_provider_not_parser(contracts, storage):
    doc = pymupdf.open()
    doc.new_page().draw_rect(pymupdf.Rect(20, 20, 150, 150), fill=(0, 0, 0))
    (storage / "vector.pdf").write_bytes(doc.tobytes())
    svc = t.make_service(contracts, storage)
    assert t.error_code(lambda: svc.extract(t.extract_request(storage, "vector.pdf"))) == (503, "PROVIDER_UNAVAILABLE")
    doc.close()


def test_actual_vector_pdf_uses_ocr_and_evidence_remains_unverified(contracts, storage):
    doc = pymupdf.open()
    doc.new_page().draw_rect(pymupdf.Rect(20, 20, 150, 150), fill=(0, 0, 0))
    (storage / "vector.pdf").write_bytes(doc.tobytes())
    ocr = t.FakeOcr("Hợp đồng số: HĐ01. Phạm vi: S1.")
    svc = t.make_service(contracts, storage, t.FakeModel(t.answer(t.contract_fields())), ocr)
    result = svc.extract(t.extract_request(storage, "vector.pdf"))
    assert ocr.pages == [1]
    assert any(d["code"] == "VECTOR_OCR_USED" for d in result["diagnostics"])
    field = next(f for f in result["fields"] if f["field_key"] == "contract.ref")
    assert field["value"] == "HĐ01" and field["quality"] == "uncertain"
    assert result["evidence"][0]["bbox"] is None
    doc.close()


def test_vector_probe_respects_native_resource_guard(monkeypatch):
    doc = pymupdf.open()
    doc.new_page(width=100000, height=100000)
    monkeypatch.setattr(pymupdf.Page, "get_pixmap", lambda *a, **kw: pytest.fail("oversized native render"))
    with pytest.raises(ServiceError) as error:
        pdf.inspect(doc.tobytes(), with_pages=True)
    assert error.value.code == "PDF_TOO_LARGE"
    doc.close()
