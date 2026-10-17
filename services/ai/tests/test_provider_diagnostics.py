"""Offline diagnostics tests. Mock transports do not prove provider availability."""
import json
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from extraction.llm import Deadline, call_json
from providers.gemini import GeminiConfig, GeminiProvider, ProviderError, ProviderUnavailable
from runner.app import create_app
from runner.config import MODE_LIVE
from runner.errors import ServiceError
from runner.provider_diagnostics import PREFIX, classify, emit_failure
from .conftest import HEADERS, example, make_settings


@pytest.mark.parametrize("status,category", [
    (429, "RATE_LIMIT_OR_QUOTA"), (500, "UPSTREAM_SERVER_ERROR"),
    (503, "UPSTREAM_SERVER_ERROR"), (401, "UPSTREAM_AUTH_REJECTED"),
    (403, "UPSTREAM_AUTH_REJECTED"), (404, "UPSTREAM_NOT_FOUND"),
    (400, "UPSTREAM_HTTP_ERROR"),
])
def test_real_adapter_failure_classified_without_retry_or_envelope_changes(status, category):
    calls = []
    def handler(request):
        calls.append(1)
        return httpx.Response(status, text="PRIVATE_PROVIDER_BODY API_KEY=not-to-log")
    provider = GeminiProvider(GeminiConfig("private-test-key", "synthetic-model", max_retries=0),
                              client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(ServiceError) as failed:
        call_json(provider, "private system prompt", "private document", {}, Deadline(10), "field extraction")
    assert len(calls) == 1
    assert (failed.value.status, failed.value.code) == (503, "PROVIDER_UNAVAILABLE")
    assert classify(failed.value) == {"category": category, "http_status": status}


@pytest.mark.parametrize("cause,category", [
    ("timeout", "TIMEOUT"), ("deadline", "DEADLINE"),
    ("ConnectError", "NETWORK_OR_TRANSPORT"), ("ReadError", "NETWORK_OR_TRANSPORT"),
])
def test_known_adapter_terminal_reasons(cause, category):
    assert classify(ProviderUnavailable(f"Gemini unavailable after 3 attempts ({cause})")) == {"category": category}


def test_unknown_exception_payloads_and_forged_messages_never_become_diagnostic_content(monkeypatch, caplog):
    monkeypatch.setenv("AIC_SAFE_PROVIDER_DIAGNOSTICS", "1")
    secret = 'RAW_PROMPT secret-cookie #token=capability https://private.invalid/?key=private'
    for cause in [RuntimeError(secret), ProviderError(secret), ProviderUnavailable(secret),
                  ProviderUnavailable("Gemini unavailable after 3 attempts (HTTP 429)\n" + secret)]:
        error = ServiceError(503, "PROVIDER_UNAVAILABLE", "Safe service error")
        error.__cause__ = cause
        event = emit_failure(error, "extract", str(uuid.uuid4()), str(uuid.uuid4()))
        assert event["category"] == "UNDETERMINED"
    assert secret not in caplog.text and "private.invalid" not in caplog.text
    assert "secret-cookie" not in caplog.text and "key=private" not in caplog.text


def test_disabled_or_invalid_correlation_emits_nothing(monkeypatch, caplog):
    error = ServiceError(503, "PROVIDER_UNAVAILABLE", "secret")
    monkeypatch.delenv("AIC_SAFE_PROVIDER_DIAGNOSTICS", raising=False)
    assert emit_failure(error, "extract", str(uuid.uuid4()), str(uuid.uuid4())) is None
    monkeypatch.setenv("AIC_SAFE_PROVIDER_DIAGNOSTICS", "1")
    assert emit_failure(error, "extract\nsecret", str(uuid.uuid4()), str(uuid.uuid4())) is None
    assert emit_failure(error, "extract", "private-document-name", "private-request-id") is None
    assert not caplog.records


def test_error_envelope_request_id_matches_content_free_server_event(monkeypatch, caplog, contracts, examples):
    monkeypatch.setenv("AIC_SAFE_PROVIDER_DIAGNOSTICS", "1")
    class FailingBackend:
        name = "live"
        def extract(self, payload):
            raise ServiceError(503, "PROVIDER_UNAVAILABLE", "Model provider unavailable during field extraction.") from ProviderUnavailable("Gemini unavailable after 3 attempts (HTTP 429)")
    client = TestClient(create_app(make_settings(MODE_LIVE), FailingBackend(), contracts))
    payload = example(examples, "extract request")
    response = client.post("/internal/v1/extract", json=payload, headers=HEADERS)
    body = response.json()
    assert response.status_code == 503
    assert contracts.violations("Error", body) == []
    assert set(body) == {"error"} and set(body["error"]) == {"code", "message", "request_id", "details"}
    records = [r.getMessage() for r in caplog.records if r.name == "runner.provider_diagnostics"]
    assert len(records) == 1
    event = json.loads(records[0].removeprefix(PREFIX))
    assert event == {"operation": "extract", "request_id": body["error"]["request_id"],
                     "document_id": payload["document_id"], "service_code": "PROVIDER_UNAVAILABLE",
                     "service_status": 503, "http_status": 429, "category": "RATE_LIMIT_OR_QUOTA"}
    assert "storage_key" not in records[0] and "sha256" not in records[0] and "X-Internal-Key" not in records[0]
