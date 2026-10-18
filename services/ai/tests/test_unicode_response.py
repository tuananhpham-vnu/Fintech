"""UTF-8 wire bytes and charset, including OCR text and Python diagnostics."""
import json

import httpx
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse

from extraction.ocr import GeminiOcr
from providers.gemini import GeminiConfig, GeminiProvider
from runner.app import create_app
from runner.errors import ServiceError
from . import test_extraction as t
from .conftest import HEADERS, make_settings
from .test_extraction import live_api, storage


def test_ocr_unicode_survives_provider_extraction_and_http(live_api, contracts, storage, gold):
    t.scan_pdf(storage / "scan.pdf", storage / "04_contract.pdf")
    source = next(e for e in gold.extractions if e["document_id"] == t.DOC_ID)["pages"][0]["text"]

    def ocr_reply(request):
        # Exercise the actual HTTPX/JSON decoding used by Gemini without any network call.
        envelope = {"candidates": [{"content": {"parts": [{"text": json.dumps({"text": source}, ensure_ascii=False)}]}}]}
        return httpx.Response(200, content=json.dumps(envelope, ensure_ascii=False).encode("utf-8"),
                              headers={"Content-Type": "application/json; charset=utf-8"})

    with httpx.Client(transport=httpx.MockTransport(ocr_reply)) as transport:
        provider = GeminiProvider(GeminiConfig(api_key="local-test-only", model_id="fake-ocr"), client=transport)
        client = live_api(model=t.FakeModel(t.answer(t.contract_fields())), ocr=GeminiOcr(provider))
        request = t.extract_request(storage, "scan.pdf")
        response = client.post("/internal/v1/extract", json=request, headers=HEADERS)

    assert response.status_code == 200
    body = json.loads(response.content.decode("utf-8", errors="strict"))
    t.assert_valid(contracts, request, body)
    assert body["pages"][0]["text"] == source and body["pages"][0]["method"] == "ocr"
    assert t.by_key(body)["contract.ref"]["value"] == "HĐ01"
    assert any("Giá trị" in e["quote"] for e in body["evidence"])
    assert any("cần người duyệt đối chiếu ảnh gốc" in d["message"] for d in body["diagnostics"])
    for text in ("HĐ01", "Giá trị", "cần người duyệt đối chiếu ảnh gốc"):
        assert text.encode("utf-8") in response.content
    # The compatibility header must not re-encode JSON or change the OCR trust boundary.
    assert response.content == JSONResponse(body).body
    assert len(body["fields"]) == 7 and all(f["value"] is not None for f in body["fields"])
    assert all(f["quality"] == "uncertain" and f["missing_reason"] == "ambiguous" for f in body["fields"])
    assert response.headers["content-type"] == "application/json; charset=utf-8"


def test_vietnamese_error_response_declares_utf8(contracts, examples):
    class UnavailableBackend:
        name = "live"

        def extract(self, payload):
            raise ServiceError(503, "PROVIDER_UNAVAILABLE", "Không thể đọc tài liệu HĐ01.")

    request = next(e["value"] for e in examples if e["schema"] == "ExtractionInput")
    app = create_app(make_settings(), backend=UnavailableBackend(), contracts=contracts)
    with TestClient(app) as client:
        response = client.post("/internal/v1/extract", json=request, headers=HEADERS)
    assert response.status_code == 503
    assert contracts.violations("Error", response.json()) == []
    assert "Không thể đọc tài liệu HĐ01.".encode("utf-8") in response.content
    assert response.headers["content-type"] == "application/json; charset=utf-8"
