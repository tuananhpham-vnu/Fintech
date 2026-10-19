"""Gemini adapter + semantic guard, không gọi mạng (httpx.MockTransport)."""
import json

import httpx
import pytest

from providers.gemini import GeminiConfig, GeminiProvider, ProviderError, ProviderUnavailable
from providers.base import ModelOutputError
from providers.semantic import guard, interpret_payment_condition

CLAUSE = ("Điều 4. Thanh toán toàn bộ trong 30 ngày lịch sau nghiệm thu S1.\n"
          "Không tính ngày nghiệm thu; không có điều kiện thanh toán bổ sung.")
GOOD = {"event_type": "acceptance", "offset_days": 30, "calendar_basis": "calendar_days", "scope_ref": "S1",
        "other_conditions": [], "counting_convention": "exclude_event_day", "other_conditions_state": "none"}


def provider(handler, retries=2):
    sleeps = []
    client = httpx.Client(transport=httpx.MockTransport(handler))
    p = GeminiProvider(GeminiConfig(api_key="k", model_id="gemini-3.1-flash-lite", max_retries=retries),
                       client=client, sleep=sleeps.append)
    return p, sleeps


def reply(payload: dict) -> httpx.Response:
    text = json.dumps(payload, ensure_ascii=False)
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": text}]}}],
                                     "modelVersion": "gemini-3.1-flash-lite", "usageMetadata": {"totalTokenCount": 42}})


def test_missing_key_is_unavailable_not_mock():
    with pytest.raises(ProviderUnavailable):
        GeminiProvider(GeminiConfig(api_key=None, model_id="gemini-3.1-flash-lite"))


def test_retries_transient_then_succeeds():
    calls = []

    def handler(request):
        calls.append(request)
        assert request.headers["x-goog-api-key"] == "k"
        return httpx.Response(503) if len(calls) < 3 else reply({"condition": GOOD, "quote": CLAUSE})
    p, sleeps = provider(handler)
    result = p.generate_json("s", "u", {"type": "object"})
    assert (result.attempts, sleeps, result.usage["totalTokenCount"]) == (3, [1, 2], 42)
    body = json.loads(calls[0].content)
    assert body["generationConfig"]["temperature"] == 0 and body["generationConfig"]["responseMimeType"] == "application/json"


def test_gives_up_after_budget_and_does_not_retry_4xx():
    p, _ = provider(lambda r: httpx.Response(429))
    with pytest.raises(ProviderUnavailable):
        p.generate_json("s", "u", {})
    calls = []
    p, _ = provider(lambda r: calls.append(r) or httpx.Response(400))
    with pytest.raises(ProviderError):
        p.generate_json("s", "u", {})
    assert len(calls) == 1


def test_unparseable_output_is_error():
    p, _ = provider(lambda r: httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}))
    with pytest.raises(ProviderError):
        p.generate_json("s", "u", {})


@pytest.mark.parametrize('payload,code', [
    ({'candidates': [{'finishReason': 'RECITATION'}]}, 'MODEL_OUTPUT_BLOCKED'),
    ({'promptFeedback': {'blockReason': 'SAFETY'}}, 'MODEL_OUTPUT_BLOCKED'),
    ({'candidates': []}, 'MODEL_OUTPUT_EMPTY'),
    ({'candidates': [{'finishReason': 'MAX_TOKENS', 'content': {'parts': [{'text': '{}'}]}}]},
     'MODEL_OUTPUT_TRUNCATED'),
])
def test_terminal_model_outputs_are_not_json_repairs_or_http_retries(payload, code):
    calls = []
    p, sleeps = provider(lambda r: calls.append(r) or httpx.Response(200, json=payload))
    with pytest.raises(ModelOutputError) as error:
        p.generate_json('s', 'u', {})
    assert error.value.code == code
    assert len(calls) == 1 and sleeps == []


def test_only_final_answer_is_parsed_when_thoughts_are_returned():
    p, _ = provider(lambda r: httpx.Response(200, json={'candidates': [{'finishReason': 'STOP',
        'content': {'parts': [{'thought': True, 'text': 'private reasoning'}, {'text': '{"ok":true}'}]}}]}))
    assert p.generate_json('s', 'u', {}).data == {'ok': True}


@pytest.mark.parametrize("quote", [
    CLAUSE,
    # spike V2: "không được tính" đứng sau "ngày nghiệm thu"
    "Bên mua thanh toán 100% giá trị phạm vi S1 trong vòng 30 ngày lịch kể từ ngày hoàn tất nghiệm thu, ngày nghiệm thu "
    "không được tính. Không áp dụng điều kiện thanh toán nào khác.",
])
def test_lexical_guard_accepts_both_word_orders(contracts, quote):
    assert guard({"condition": GOOD, "quote": quote}, quote, contracts).violations == []


def test_semantic_guard_accepts_grounded_answer(contracts):
    p, _ = provider(lambda r: reply({"condition": GOOD, "quote": CLAUSE}))
    interpretation, _ = interpret_payment_condition(p, CLAUSE, contracts)
    assert interpretation.condition == GOOD and interpretation.violations == []


@pytest.mark.parametrize("output, path", [
    ({"condition": GOOD, "quote": "thanh toán ngay khi ký"}, "/quote"),                       # quote bịa
    ({"condition": GOOD, "quote": "Thanh toán toàn bộ trong 30 ngày lịch sau nghiệm thu S1."},  # none không có căn cứ
     "/condition/other_conditions_state"),
    ({"condition": dict(GOOD, other_conditions_state="present"), "quote": CLAUSE}, "/condition/other_conditions"),
    ({"condition": dict(GOOD, scope_ref="nghiệm thu S1"), "quote": CLAUSE}, "/condition/scope_ref"),   # spike V7
    ({"condition": dict(GOOD, calendar_basis="business_days"), "quote": CLAUSE}, "/condition/calendar_basis"),
    ({"condition": dict(GOOD, offset_days=45), "quote": CLAUSE}, "/condition/offset_days"),
])
def test_semantic_guard_rejects_ungrounded_answers(contracts, output, path):
    result = guard(output, CLAUSE, contracts)
    assert result.condition is None
    assert any(v.path.startswith(path) for v in result.violations)
