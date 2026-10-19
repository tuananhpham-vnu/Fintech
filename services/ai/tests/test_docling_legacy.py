"""DoclingOcr (OCR local qua tiến trình con): version, text NFC, lỗi -> 503, cấu hình. Script giả, không cần docling."""
from __future__ import annotations

import sys
import textwrap

import pytest

from extraction import ocr
from extraction.llm import Deadline
from runner.errors import ServiceError

FAKE = textwrap.dedent('''
    import json, sys
    if "--version" in sys.argv:
        print(json.dumps({"version": "docling-test/auto"})); sys.exit(0)
    data = sys.stdin.buffer.read()
    if b"FAIL" in data:
        sys.exit(3)
    text = "Ho\\u031b\\u0323p \\u0111o\\u0302\\u0300ng s\\u00f4\\u0301: HĐ01\\n\\u4f01\\u4e1a\\u540d\\u79f0 | Sao Mai"
    print(json.dumps({"text": text, "version": "docling-test/ocrmac"}))
''')


@pytest.fixture
def fake_docling(tmp_path, monkeypatch):
    script = tmp_path / "docling_page.py"
    script.write_text(FAKE, encoding="utf-8")
    monkeypatch.setattr(ocr, "DOCLING_SCRIPT", script)
    return ocr.DoclingOcr(sys.executable)


def test_page_text_is_nfc_and_version_reports_engine(fake_docling):
    assert fake_docling.version == "docling-test/auto"
    text = fake_docling.page_text(b"\x89PNG data", 1, Deadline(30))
    assert text == "Hợp đồng số: HĐ01\n企业名称 | Sao Mai"
    assert fake_docling.version == "docling-test/ocrmac"


def test_subprocess_failure_is_unavailable(fake_docling):
    with pytest.raises(ServiceError) as info:
        fake_docling.page_text(b"\x89PNG FAIL", 2, Deadline(30))
    assert (info.value.status, info.value.code) == (503, "PROVIDER_UNAVAILABLE")


def test_missing_python_is_unavailable(tmp_path):
    with pytest.raises(ServiceError) as info:
        ocr.DoclingOcr(str(tmp_path / "nope"))
    assert info.value.code == "PROVIDER_UNAVAILABLE"


def test_docling_is_default_engine_when_configured(monkeypatch):
    from extraction import Config
    monkeypatch.setattr("runner.config.load_dotenv", lambda *a, **k: [])
    monkeypatch.delenv("OCR_ENGINE", raising=False)
    monkeypatch.setenv("DOCLING_PYTHON", sys.executable)
    assert Config.from_env().ocr_engine == "docling"
    monkeypatch.delenv("DOCLING_PYTHON")
    assert Config.from_env().ocr_engine == "none"
