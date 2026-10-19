"""Offline HTTP-adapter and real pipeline regressions; no external API calls."""
import base64
import json
from dataclasses import replace

import httpx
import pytest

from providers.base import ProviderError, ProviderUnavailable
from providers.deepseek import DeepSeekConfig, DeepSeekProvider
from providers.factory import create_provider, model_id
from providers.gemini import GeminiProvider
from extraction.llm import Deadline, MalformedOutput, call_json
from extraction.ocr import ProviderOcr
from runner.config import Settings
from runner.__main__ import health
from runner.provider_diagnostics import classify


def reply(data, finish="stop"):
    return httpx.Response(200, json={"model": "deepseek-flash", "choices": [
        {"message": {"content": json.dumps(data, ensure_ascii=False)}, "finish_reason": finish}],
        "usage": {"total_tokens": 42}})


def provider(handler, retries=0, clock=lambda: 0.0):
    sleeps = []
    return DeepSeekProvider(DeepSeekConfig("synthetic-key", max_retries=retries),
        client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=sleeps.append, clock=clock), sleeps


def test_request_uses_bearer_json_mode_schema_and_selected_model():
    calls = []
    p, _ = provider(lambda request: calls.append(request) or reply({"value": "0"}))
    result = p.generate_json("Synthetic system", "Synthetic document", {"type": "object"}, max_output_tokens=16384)
    request = calls[0]
    assert str(request.url) == "https://api.deepseek.com/chat/completions"
    assert request.headers["Authorization"] == "Bearer synthetic-key"
    assert "x-goog-api-key" not in request.headers
    body = json.loads(request.content)
    assert body["model"] == "deepseek-flash" and body["thinking"] == {"type": "disabled"}
    assert body["response_format"] == {"type": "json_object"} and body["max_tokens"] == 16384
    assert '"type": "object"' in body["messages"][0]["content"]
    assert result.data == {"value": "0"} and result.usage["total_tokens"] == 42


@pytest.mark.parametrize("base", ["https://api.deepseek.com", "https://api.deepseek.com/v1/"])
def test_base_url_joins_without_double_slash(base):
    calls = []
    p = DeepSeekProvider(DeepSeekConfig("synthetic-key", base_url=base),
        client=httpx.Client(transport=httpx.MockTransport(lambda request: calls.append(request) or reply({}))))
    p.generate_json("s", "u", {})
    assert str(calls[0].url) == base.rstrip("/") + "/chat/completions"


@pytest.mark.parametrize("base", ["http://api.deepseek.com", "https://key:secret@api.deepseek.com", "https://api.deepseek.com?key=secret", "https://api.deepseek.com/chat/completions"])
def test_invalid_endpoint_fails_before_sending_credentials(base):
    with pytest.raises(ProviderUnavailable, match="Invalid DEEPSEEK_BASE_URL"):
        DeepSeekProvider(DeepSeekConfig("synthetic-key", base_url=base))


def test_selected_provider_requires_its_own_key_and_never_falls_back(monkeypatch):
    with pytest.raises(ProviderUnavailable, match="DEEPSEEK_API_KEY"):
        create_provider({"AI_PROVIDER": "deepseek", "GEMINI_API_KEY": "synthetic-gemini"})
    with pytest.raises(ProviderUnavailable, match="GEMINI_API_KEY"):
        create_provider({"AI_PROVIDER": "gemini", "DEEPSEEK_API_KEY": "synthetic-deepseek"})
    with pytest.raises(ProviderUnavailable, match="AI_PROVIDER"):
        create_provider({"AI_PROVIDER": "unsupported"})
    assert isinstance(create_provider({"GEMINI_API_KEY": "synthetic-gemini"}), GeminiProvider)
    p = create_provider({"AI_PROVIDER": "deepseek", "DEEPSEEK_API_KEY": "synthetic-deepseek", "MODEL_ID": "gemini-legacy"})
    assert p.model_id == "deepseek-flash"
    assert model_id({"GEMINI_MODEL_ID": "gemini-new", "MODEL_ID": "gemini-legacy"}) == "gemini-new"
    assert model_id({"AI_PROVIDER": "deepseek", "DEEPSEEK_MODEL_ID": "deepseek-v4-pro"}) == "deepseek-v4-pro"
    p._client.close()


def test_transient_errors_retry_with_bounded_backoff():
    calls = []
    p, sleeps = provider(lambda r: calls.append(r) or (httpx.Response(503) if len(calls) < 3 else reply({"ok": True})), retries=2)
    result = p.generate_json("s", "u", {})
    assert result.attempts == 3 and sleeps == [1, 2]


@pytest.mark.parametrize("status", [400, 401, 402, 403, 404, 307])
def test_auth_payment_and_other_permanent_failures_are_not_retried_or_redirected(status, caplog):
    calls = []
    p, sleeps = provider(lambda r: calls.append(r) or httpx.Response(status, text="private document and key", headers={"Location": "https://elsewhere.invalid"}), retries=2)
    with pytest.raises(ProviderError) as failed:
        p.generate_json("private system", "private document", {})
    assert str(failed.value) == f"DeepSeek HTTP {status}"
    assert len(calls) == 1 and not sleeps
    assert "private document" not in caplog.text and "synthetic-key" not in caplog.text


def test_retry_after_is_capped_and_overall_deadline_stops_retries():
    calls = []
    p, sleeps = provider(lambda r: calls.append(r) or httpx.Response(429, headers={"Retry-After": "999"}), retries=2)
    with pytest.raises(ProviderUnavailable):
        p.generate_json("s", "u", {}, deadline=10)
    assert len(calls) == 1 and not sleeps
    assert classify(ProviderUnavailable("DeepSeek unavailable after 3 attempts (HTTP 429)")) == {"category": "RATE_LIMIT_OR_QUOTA", "http_status": 429}


def test_timeout_and_transport_errors_are_sanitized_and_classified():
    def timeout(request):
        raise httpx.ReadTimeout("private upstream body")
    p, _ = provider(timeout)
    with pytest.raises(ProviderUnavailable) as failed:
        p.generate_json("s", "u", {})
    assert classify(failed.value) == {"category": "TIMEOUT"}
    assert "private" not in str(failed.value)


def test_expired_and_late_results_are_not_accepted():
    calls = []
    now = [5.0]
    def handle(request):
        calls.append(request); now[0] = 20.0
        return reply({"ok": True})
    p, _ = provider(handle, clock=lambda: now[0])
    with pytest.raises(ProviderUnavailable): p.generate_json("s", "u", {}, deadline=4)
    assert not calls
    with pytest.raises(ProviderUnavailable): p.generate_json("s", "u", {}, deadline=10)
    assert len(calls) == 1


@pytest.mark.parametrize("response", [
    httpx.Response(200, text="invalid envelope"),
    httpx.Response(200, json={"choices": []}),
    httpx.Response(200, json={"choices": [{"message": {"content": ""}, "finish_reason": "stop"}]}),
    httpx.Response(200, json={"choices": [{"message": {"content": "not-json"}, "finish_reason": "stop"}]}),
    httpx.Response(200, json={"choices": [{"message": {"content": "{\"bad\": NaN}"}, "finish_reason": "stop"}]}),
    reply(["not an object"]),
    reply({"apparently_valid": True}, finish="length"),
])
def test_malformed_empty_and_truncated_output_uses_existing_repair_path(response):
    p, _ = provider(lambda request: response)
    with pytest.raises(MalformedOutput):
        call_json(p, "s", "u", {}, Deadline(10), "synthetic extraction")


def test_ocr_uses_image_content_and_preserves_text_and_provider_provenance():
    calls = []
    p, _ = provider(lambda r: calls.append(r) or reply({"text": "Tổng tài sản 0\nNguồn tổng hợp"}))
    ocr = ProviderOcr(p)
    assert ocr.page_text(b"synthetic-png", 1, Deadline(10)) == "Tổng tài sản 0\nNguồn tổng hợp"
    body = json.loads(calls[0].content)
    image = body["messages"][1]["content"][1]
    assert image["image_url"]["url"] == "data:image/png;base64," + base64.b64encode(b"synthetic-png").decode()
    assert ocr.version.startswith("deepseek-ocr-")
    text_only = DeepSeekProvider(DeepSeekConfig("synthetic-key", model_id="deepseek-v4-pro"))
    with pytest.raises(ProviderUnavailable, match="image OCR"):
        text_only.generate_json("s", "u", {}, media=[("image/png", b"synthetic")])
    text_only._client.close()


def test_health_and_runner_semantic_factory_select_deepseek_without_gemini(monkeypatch, contracts):
    from runner.app import build_backend
    from .conftest import make_settings
    env = {"AI_PROVIDER": "deepseek", "DEEPSEEK_API_KEY": "synthetic-key", "AI_MODE": "live",
           "INTERNAL_API_KEY": "synthetic-internal", "PROMPT_VERSION": "payment-condition-v1"}
    settings = Settings.from_env(env)
    report = health(settings)
    assert report["checks"]["deepseek_api_key"] == {"ok": True}
    assert "gemini_api_key" not in report["checks"] and report["ok"]
    p, _ = provider(lambda r: reply({}))
    calls = []
    monkeypatch.setattr("providers.factory.create_provider", lambda **kw: calls.append(kw) or p)
    build_backend(settings, contracts)
    assert calls == [{"name": "deepseek", "model": "deepseek-flash"}]
    assert not replace(make_settings("live"), provider_name="deepseek").provider_key_configured


def test_default_extractor_factory_uses_selected_provider_for_fields_and_ocr(monkeypatch, contracts, tmp_path):
    from extraction import Config, Service
    p, _ = provider(lambda r: reply({}))
    monkeypatch.setattr("providers.factory.create_provider", lambda: p)
    extractor = Service(Config(tmp_path)).extractor()
    assert extractor.provider is p and extractor.ocr.provider is p
    assert extractor.ocr.version.startswith("deepseek-ocr-")


def test_deepseek_financial_pipelines_still_enforce_source_evidence_and_unverified_facts():
    from financial_import.intake import discover
    from financial_import.service import execute
    from .test_financial_intake import pdf, request as intake_request, answer as periods
    from .test_financial_import import sample, request as import_request, answer as facts
    p, _ = provider(lambda r: reply(periods()))
    result = discover(intake_request(pdf()), p)
    assert len(result["periods"]) == 2 and result["provenance"]["model_id"] == "deepseek-flash"
    raw = facts()
    p, _ = provider(lambda r: reply(raw))
    result = execute(import_request(sample()), p)
    assert result["facts"][0]["value"] == "77099" and result["facts"][0]["verification"] == "unverified"
    raw["facts"][0]["value"] = "77099000"
    assert execute(import_request(sample()), p)["facts"] == []


def test_deepseek_semantic_suggestions_keep_existing_quote_guards(contracts):
    from providers.semantic import interpret_payment_condition
    from .test_providers import GOOD, CLAUSE
    raw = {"condition": GOOD, "quote": CLAUSE}
    p, _ = provider(lambda r: reply(raw))
    interpretation, _ = interpret_payment_condition(p, CLAUSE, contracts)
    assert interpretation.condition == GOOD and not interpretation.violations
    raw["quote"] = "Invented payment clause"
    interpretation, _ = interpret_payment_condition(p, CLAUSE, contracts)
    assert interpretation.condition is None and interpretation.violations
