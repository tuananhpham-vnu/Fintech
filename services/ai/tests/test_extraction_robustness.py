"""P0 robustness: PDF resource limits, time budget/concurrency, mixed text+scan pages. No network, no paid calls."""
from __future__ import annotations

import threading
import time
import zlib
from types import SimpleNamespace

import httpx
import pymupdf
import pytest

from extraction import Config, Service, llm, pdf
from extraction.extractor import Extractor, Settings as ExtractorSettings
from extraction.llm import CallGate, Deadline, call_json
from providers.gemini import GeminiConfig, GeminiProvider, ProviderUnavailable
from runner.errors import ServiceError

from . import test_extraction as t
from .test_extraction import storage  # noqa: F401  (fixture)

FIXTURE_TEXT = (t.DEFAULT_FIXTURES_DIR / "04_contract.pdf")


def service(contracts, storage, model=None, ocr=None, limits=None, deadline_s=60.0):
    return Service(Config(storage_dir=storage),
                   lambda: Extractor(contracts, model, ocr, ExtractorSettings(deadline_s=deadline_s, limits=limits)))


def code(call):
    with pytest.raises(ServiceError) as info:
        call()
    return info.value.status, info.value.code


def tiny_gray(side=10):
    return pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, side, side), False)


def image_bomb(path, side: int):
    """A4 page with one image whose dictionary declares side x side pixels; the flate stream is a few hundred KB."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(page.rect, pixmap=tiny_gray())
    xref = page.get_images(full=True)[0][0]
    inflater, chunk, parts, left = zlib.compressobj(9), b"\0" * (4 << 20), [], side * side
    while left > 0:
        parts.append(inflater.compress(chunk[:min(left, len(chunk))]))
        left -= len(chunk)
    parts.append(inflater.flush())
    doc.update_stream(xref, b"".join(parts), compress=False)
    for key, value in (("DecodeParms", "null"), ("SMask", "null"), ("Filter", "/FlateDecode"), ("Width", str(side)),
                       ("Height", str(side)), ("BitsPerComponent", "8"), ("ColorSpace", "/DeviceGray")):
        doc.xref_set_key(xref, key, value)
    path.write_bytes(doc.tobytes())
    return path


def content_bomb(path, decoded_bytes: int):
    """One page whose content stream inflates to `decoded_bytes` of whitespace from a tiny compressed stream."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((40, 60), "Hợp đồng số: HĐ01")
    xref = page.get_contents()[0]
    inflater, chunk, parts, left = zlib.compressobj(9), b" " * (4 << 20), [], decoded_bytes
    while left > 0:
        parts.append(inflater.compress(chunk[:min(left, len(chunk))]))
        left -= len(chunk)
    parts.append(inflater.flush())
    doc.update_stream(xref, b"".join(parts), compress=False)
    doc.xref_set_key(xref, "Filter", "/FlateDecode")
    path.write_bytes(doc.tobytes())
    return path


@pytest.fixture
def no_native_render(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("get_pixmap must not run for an oversized page")
    monkeypatch.setattr(pymupdf.Page, "get_pixmap", forbidden)


# ------------------------------------------------------------------ 1. resource limits


def test_page_limit_enforced_before_any_page_text(contracts, storage, monkeypatch):
    """Reported issue: an 11-page PDF had the text of all 11 pages extracted before the 10-page limit applied."""
    t.text_pdf(storage / "eleven.pdf", *[f"Trang {i}" for i in range(1, 12)])
    calls = []
    original = pdf._page_info
    monkeypatch.setattr(pdf, "_page_info", lambda *a: calls.append(a) or original(*a))
    svc = service(contracts, storage, model=t.FakeModel(t.answer(t.contract_fields())))
    assert code(lambda: svc.extract(t.extract_request(storage, "eleven.pdf"))) == (413, "PDF_TOO_MANY_PAGES")
    assert calls == []
    assert svc.inspect(t.inspect_request(storage, "eleven.pdf"))["page_count"] == 11   # inspect still reports it


def test_thousand_page_pdf_is_cheap_to_inspect_and_rejected_for_extract(contracts, storage):
    doc = pymupdf.open()
    for _ in range(1000):
        doc.new_page()
    (storage / "thousand.pdf").write_bytes(doc.tobytes())
    svc = service(contracts, storage, model=t.FakeModel(t.answer(t.contract_fields())))
    started = time.perf_counter()
    assert svc.inspect(t.inspect_request(storage, "thousand.pdf"))["page_count"] == 1000
    assert code(lambda: svc.extract(t.extract_request(storage, "thousand.pdf"))) == (413, "PDF_TOO_MANY_PAGES")
    assert time.perf_counter() - started < 5


def test_oversized_page_is_not_rendered(contracts, storage, no_native_render):
    """Reported issue: a 14400pt page would have been rendered at 200 dpi = 40000 x 40000 pixels."""
    doc = pymupdf.open()
    page = doc.new_page(width=14400, height=14400)
    page.insert_image(pymupdf.Rect(0, 0, 100, 100), pixmap=tiny_gray())
    (storage / "huge.pdf").write_bytes(doc.tobytes())
    ocr = t.FakeOcr("Hợp đồng số: HĐ01.")
    svc = service(contracts, storage, model=t.FakeModel(t.answer(t.contract_fields())), ocr=ocr)
    assert code(lambda: svc.extract(t.extract_request(storage, "huge.pdf"))) == (413, "PDF_TOO_LARGE")
    assert ocr.pages == []


@pytest.mark.parametrize("width,height,expected_dpi", [(595, 842, 200), (842, 1191, 200), (1191, 1684, None)])
def test_render_size_is_capped(width, height, expected_dpi):
    limits = pdf.Limits()
    zoom = pdf.render_zoom(width, height, limits)
    pixels = (width * zoom) * (height * zoom)
    assert pixels <= limits.max_render_pixels and max(width, height) * zoom <= limits.max_render_side
    if expected_dpi:
        assert round(zoom * 72) == expected_dpi
    else:
        assert limits.min_ocr_dpi <= zoom * 72 < 200        # A2 is downscaled, still legible


def test_tiny_pdf_declaring_huge_image_is_rejected_before_decode(contracts, storage, no_native_render):
    path = image_bomb(storage / "bomb.pdf", 12000)
    assert path.stat().st_size < 400_000                    # 144M declared pixels in a few hundred KB
    ocr = t.FakeOcr("x")
    svc = service(contracts, storage, model=t.FakeModel(t.answer(t.contract_fields())), ocr=ocr)
    assert code(lambda: svc.extract(t.extract_request(storage, "bomb.pdf"))) == (413, "PDF_TOO_LARGE")
    assert ocr.pages == []


def test_content_stream_bomb_rejected_before_text_extraction(contracts, storage, monkeypatch):
    path = content_bomb(storage / "zip.pdf", 64_000_000)
    assert path.stat().st_size < 200_000
    original = pymupdf.Page.get_text
    monkeypatch.setattr(pymupdf.Page, "get_text", lambda *a, **k: pytest.fail("get_text ran on a content bomb"))
    svc = service(contracts, storage, model=t.FakeModel(t.answer(t.contract_fields())))
    assert code(lambda: svc.extract(t.extract_request(storage, "zip.pdf"))) == (413, "PDF_TOO_LARGE")
    monkeypatch.setattr(pymupdf.Page, "get_text", original)
    assert svc.inspect(t.inspect_request(storage, "zip.pdf"))["page_count"] == 1    # inspect never parses content


@pytest.mark.parametrize("limits", [pdf.Limits(max_page_text_chars=200), pdf.Limits(max_text_chars=200)])
def test_text_volume_is_bounded(contracts, storage, limits):
    svc = service(contracts, storage, model=t.FakeModel(t.answer(t.contract_fields())), limits=limits)
    assert code(lambda: svc.extract(t.extract_request(storage))) == (413, "PDF_TOO_LARGE")


def test_ocr_image_and_ocr_text_are_bounded(contracts, storage):
    t.scan_pdf(storage / "scan.pdf", storage / "04_contract.pdf")
    request = t.extract_request(storage, "scan.pdf")
    small_png = service(contracts, storage, model=t.FakeModel(t.answer(t.contract_fields())), ocr=t.FakeOcr("x"),
                        limits=pdf.Limits(max_ocr_png_bytes=1000))
    assert code(lambda: small_png.extract(request)) == (413, "PDF_TOO_LARGE")
    flood = service(contracts, storage, model=t.FakeModel(t.answer(t.contract_fields())),
                    ocr=t.FakeOcr("Hợp đồng " * 10_000))
    assert code(lambda: flood.extract(request)) == (413, "PDF_TOO_LARGE")


def test_normal_fixture_is_unaffected(contracts, storage):
    out = service(contracts, storage, model=t.FakeModel(t.answer(t.contract_fields()))).extract(t.extract_request(storage))
    assert out["pages"][0]["method"] == "text" and t.by_key(out)["contract.amount"]["value"] == "500000000"


# ------------------------------------------------------------------ 2. time budget and concurrency


class SlowModel(t.FakeModel):
    def __init__(self, delay: float, *answers):
        super().__init__(*answers)
        self.delay = delay

    def generate_json(self, *args, **kwargs):
        time.sleep(self.delay)
        return super().generate_json(*args, **kwargs)


def test_remaining_budget_and_token_cap_reach_the_provider(contracts, storage):
    model = t.FakeModel(t.answer(t.contract_fields()))
    before = time.monotonic()
    service(contracts, storage, model=model, deadline_s=30).extract(t.extract_request(storage))
    call = model.calls[0]
    assert before + 29 < call["deadline"] <= time.monotonic() + 30
    assert call["max_output_tokens"] == llm.EXTRACTION_MAX_OUTPUT_TOKENS


def test_result_arriving_after_deadline_is_rejected(contracts, storage):
    svc = service(contracts, storage, model=SlowModel(0.4, t.answer(t.contract_fields())), deadline_s=0.2)
    assert code(lambda: svc.extract(t.extract_request(storage))) == (503, "PROVIDER_UNAVAILABLE")


def test_no_repair_call_after_budget_is_spent(contracts, storage):
    model = SlowModel(0.3, t.answer(t.contract_fields()[:-1]), t.answer(t.contract_fields()))
    svc = service(contracts, storage, model=model, deadline_s=0.2)
    assert code(lambda: svc.extract(t.extract_request(storage))) == (503, "PROVIDER_UNAVAILABLE")
    assert len(model.calls) == 1


def test_ocr_pages_stop_when_budget_is_spent(contracts, storage):
    t.scan_pdf(storage / "p1.pdf", storage / "04_contract.pdf")
    doc = pymupdf.open(storage / "p1.pdf")
    doc.insert_pdf(pymupdf.open(storage / "p1.pdf"))
    (storage / "two_scans.pdf").write_bytes(doc.tobytes())

    class SlowOcr(t.FakeOcr):
        def page_text(self, png, page, deadline):
            time.sleep(0.3)
            return super().page_text(png, page, deadline)
    ocr = SlowOcr("Hợp đồng số: HĐ01. Phạm vi: S1.")
    svc = service(contracts, storage, model=t.FakeModel(t.answer(t.contract_fields())), ocr=ocr, deadline_s=0.2)
    assert code(lambda: svc.extract(t.extract_request(storage, "two_scans.pdf"))) == (503, "PROVIDER_UNAVAILABLE")
    assert ocr.pages == [1]


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def test_gemini_attempt_timeout_and_backoff_respect_deadline():
    clock, timeouts = Clock(), []

    def handler(request):
        timeouts.append(request.extensions["timeout"]["read"])
        return httpx.Response(503)
    provider = GeminiProvider(GeminiConfig(api_key="k", model_id="m", max_retries=2),
                              client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=clock.sleep, clock=clock)
    with pytest.raises(ProviderUnavailable):
        provider.generate_json("s", "u", {}, deadline=clock() + 1.5)
    assert timeouts == [1.5, 0.5]          # each attempt gets only what is left; no attempt after the backoff to 2s
    assert clock.now == 1001.0             # slept once (1s); the 2s backoff would have outlived the budget


def test_gemini_body_and_retries_unchanged_without_budget():
    bodies = []

    def handler(request):
        bodies.append(request)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "{}"}]}}]})
    client = httpx.Client(transport=httpx.MockTransport(handler), timeout=90.0)
    provider = GeminiProvider(GeminiConfig(api_key="k", model_id="m"), client=client)
    provider.generate_json("s", "u", {})
    provider.generate_json("s", "u", {}, max_output_tokens=512)
    import json
    first, second = (json.loads(b.content)["generationConfig"] for b in bodies)
    assert "maxOutputTokens" not in first and second["maxOutputTokens"] == 512
    assert bodies[0].extensions["timeout"]["read"] == 90.0     # no per-request override: client timeout as before


def test_call_gate_limits_concurrency_and_rejects_overflow():
    gate, release = CallGate(limit=2, max_waiting=1), threading.Event()
    peak, lock, results = [0], threading.Lock(), []

    class Blocking:
        model_id = "blocking"

        def generate_json(self, *args, **kwargs):
            with lock:
                peak[0] = max(peak[0], gate.active)
            release.wait(5)
            return SimpleNamespace(data={"ok": True})

    def worker():
        try:
            results.append(call_json(Blocking(), "s", "u", {}, Deadline(5), "test", gate=gate))
        except ServiceError as exc:
            results.append(exc.code)
    threads = [threading.Thread(target=worker) for _ in range(3)]
    for th in threads:
        th.start()
    deadline = time.monotonic() + 5
    while (gate.active, gate.waiting) != (2, 1) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert (gate.active, gate.waiting) == (2, 1)
    with pytest.raises(ServiceError) as overflow:          # queue full: rejected immediately, not queued
        call_json(Blocking(), "s", "u", {}, Deadline(5), "overflow", gate=gate)
    assert overflow.value.code == "PROVIDER_UNAVAILABLE"
    release.set()
    for th in threads:
        th.join(5)
    assert peak[0] == 2 and results.count({"ok": True}) == 3


def test_waiting_for_a_slot_is_bounded_by_the_budget():
    gate = CallGate(limit=1, max_waiting=4)
    with gate.slot(Deadline(5), "holder"):
        started = time.monotonic()
        with pytest.raises(ServiceError) as info:
            with gate.slot(Deadline(0.2), "waiter"):
                pass
        assert time.monotonic() - started < 1.5
    assert "budget" in info.value.message


def test_parallel_extractions_share_the_process_gate(contracts, storage, monkeypatch):
    monkeypatch.setattr(llm, "GATE", CallGate(limit=2, max_waiting=10))
    active, peak, lock = [0], [0], threading.Lock()

    class Counting(t.FakeModel):
        def generate_json(self, *args, **kwargs):
            with lock:
                active[0] += 1
                peak[0] = max(peak[0], active[0])
            time.sleep(0.1)
            with lock:
                active[0] -= 1
            return super().generate_json(*args, **kwargs)
    svc = service(contracts, storage, model=Counting(t.answer(t.contract_fields())))
    outputs = []
    threads = [threading.Thread(target=lambda: outputs.append(svc.extract(t.extract_request(storage))))
               for _ in range(6)]
    for th in threads:
        th.start()
    for th in threads:
        th.join(10)
    assert len(outputs) == 6 and peak[0] == 2


# ------------------------------------------------------------------ 3. mixed text header + scanned body


def header_and_scan(path, header: str = "CÔNG TY SAO MAI DEMO - BẢN SAO HỢP ĐỒNG ĐÃ KÝ VÀ SCAN"):
    pix = pymupdf.open(FIXTURE_TEXT)[0].get_pixmap(dpi=100, colorspace=pymupdf.csGRAY)
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_htmlbox(pymupdf.Rect(40, 20, 555, 50), header)
    page.insert_image(pymupdf.Rect(0, 60, 595, 842), pixmap=pix)
    path.write_bytes(doc.tobytes())
    return path


def test_text_header_does_not_suppress_ocr_of_scanned_body(contracts, storage, gold):
    """Reported issue: an embedded text header (>= 20 chars) made the scanned contract body invisible."""
    header_and_scan(storage / "mixed.pdf")
    info = pdf.inspect((storage / "mixed.pdf").read_bytes(), with_pages=True)
    assert (info.pages[0].needs_ocr, info.pages[0].ocr_reason) == (True, "image_region")
    body = next(g for g in gold.extractions if g["document_id"] == t.DOC_ID)["pages"][0]["text"]
    ocr = t.FakeOcr(body)
    request = t.extract_request(storage, "mixed.pdf")
    out = service(contracts, storage, model=t.FakeModel(t.answer(t.contract_fields())), ocr=ocr).extract(request)
    t.assert_valid(contracts, request, out)
    assert ocr.pages == [1] and out["pages"][0]["method"] == "ocr"
    assert out["provenance"]["ocr_version"] == "fake-ocr-1"
    codes = {d["code"] for d in out["diagnostics"]}
    assert {"OCR_USED", "PARTIAL_TEXT_LAYER", "OCR_UNVERIFIED"} <= codes
    amount = t.by_key(out)["contract.amount"]
    assert (amount["value"], amount["quality"]) == ("500000000", "uncertain")   # OCR facts stay uncertain


def test_text_pdf_with_logo_is_not_ocred(contracts, storage):
    doc = pymupdf.open(FIXTURE_TEXT)
    doc[0].insert_image(pymupdf.Rect(480, 20, 560, 100), pixmap=tiny_gray(40))
    (storage / "logo.pdf").write_bytes(doc.tobytes())
    ocr = t.FakeOcr("should not be used")
    request = t.extract_request(storage, "logo.pdf")
    out = service(contracts, storage, model=t.FakeModel(t.answer(t.contract_fields())), ocr=ocr).extract(request)
    assert ocr.pages == [] and out["pages"][0]["method"] == "text"
    assert t.by_key(out)["contract.amount"]["quality"] == "readable"


def test_text_page_over_full_page_background_is_not_ocred(storage):
    lines = [f"Điều {i}. Bên mua thanh toán theo tiến độ đã thỏa thuận tại phụ lục {i} của hợp đồng." for i in range(1, 40)]
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(page.rect, pixmap=tiny_gray(50))                     # letterhead / watermark background
    page.insert_htmlbox(pymupdf.Rect(40, 40, 555, 800), "<br>".join(lines))
    info = pdf.inspect(doc.tobytes(), with_pages=True)
    assert info.pages[0].needs_ocr is False


# ------------------------------------------------------------------ 4. text layer whose fonts lost their Unicode map


def strip_tounicode(doc):
    for page in doc:
        for font in page.get_fonts():
            doc.xref_set_key(font[0], "ToUnicode", "null")
    return pymupdf.open("pdf", doc.tobytes())


def html_page(html):
    doc = pymupdf.open()
    doc.new_page(width=595, height=842).insert_htmlbox(pymupdf.Rect(40, 40, 555, 800), html)
    return doc


def inserted_page(text, fontname):
    doc = pymupdf.open()
    doc.new_page().insert_text((40, 60), text, fontname=fontname)
    return doc


VI_TEXT = "Hợp đồng số HĐ01. Bên vay: Công ty TNHH Minh Anh. Mã số thuế: 0109876543"
ZH_TEXT = "企业名称：示例科技有限公司"


@pytest.mark.parametrize("text", [VI_TEXT, ZH_TEXT], ids=["vi", "zh"])
def test_text_page_with_unmapped_identity_font_is_ocred(text):
    """AI-001: Identity-H font without ToUnicode yields readable-looking glyph ids (no images on the page)."""
    page = pdf.inspect(strip_tounicode(html_page(text)).tobytes(), with_pages=True).pages[0]
    assert text not in page.text
    assert (page.needs_ocr, page.ocr_reason, page.image_count) == (True, "garbled", 0)


@pytest.mark.parametrize("text, fontname", [("Company name: SAMPLE LTD. Tax ID: 0109876543", "helv"),
                                            (ZH_TEXT + " 税号 91110000", "china-s")], ids=["helvetica", "cjk-cmap"])
def test_standard_fonts_without_tounicode_keep_native_text(text, fontname):
    page = pdf.inspect(strip_tounicode(inserted_page(text, fontname)).tobytes(), with_pages=True).pages[0]
    assert page.text.strip() == text and page.needs_ocr is False


def test_native_table_is_not_ocred():
    rows = [["STT", "Hạng mục", "Thành tiền"], ["1", "Thép cuộn", "1.860.000.000"], ["2", "Xi măng", "1.160.000.000"]]
    html = "<table>" + "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows) + "</table>"
    page = pdf.inspect(html_page(html).tobytes(), with_pages=True).pages[0]
    flat = " ".join(page.text.split())                       # ô hẹp có thể xuống dòng giữa chữ
    assert page.needs_ocr is False and all(c in flat for r in rows for c in r)


def test_garbled_text_layer_is_replaced_by_ocr(contracts, storage):
    (storage / "broken.pdf").write_bytes(strip_tounicode(html_page(ZH_TEXT)).tobytes())
    ocr = t.FakeOcr(ZH_TEXT)
    pages, notes, used = Extractor(contracts, None, ocr).read_pages(SimpleNamespace(data=(storage / "broken.pdf")
                                                                                    .read_bytes()), Deadline(60))
    assert used and ocr.pages == [1] and (pages[0].method, pages[0].text) == ("ocr", ZH_TEXT)
    assert {"OCR_USED", "GARBLED_TEXT_LAYER"} <= {n[0] for n in notes}
