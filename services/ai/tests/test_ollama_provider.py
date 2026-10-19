"""Provider Ollama (local): đúng body gửi đi, ánh xạ lỗi giống Gemini, và chọn provider theo env. Không gọi mạng."""
from __future__ import annotations

import json

import httpx
import pytest

import providers
from providers.gemini import ProviderError, ProviderUnavailable
from providers.ollama import OllamaConfig, OllamaProvider

SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"]}


def provider(handler, **config):
    return OllamaProvider(OllamaConfig(**{"base_url": "http://127.0.0.1:11434", **config}),
                          client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda _: None)


def chat_reply(content: str, status: int = 200):
    return httpx.Response(status, json={"model": "gemma3:4b", "message": {"role": "assistant", "content": content},
                                        "prompt_eval_count": 12, "eval_count": 5})


def test_request_body_uses_schema_format_and_deterministic_options():
    seen = {}

    def handler(request):
        seen.update(json.loads(request.content), path=request.url.path)
        return chat_reply('{"answer": "ok"}')

    result = provider(handler).generate_json("SYS", "USER", SCHEMA, media=[("image/png", b"\x89PNG")],
                                            max_output_tokens=256)
    assert result.data == {"answer": "ok"} and result.usage == {"prompt_eval_count": 12, "eval_count": 5}
    assert seen["path"] == "/api/chat" and seen["model"] == "gemma3:4b" and seen["stream"] is False
    assert seen["format"] == SCHEMA
    assert seen["options"] == {"temperature": 0.0, "num_ctx": 32768, "num_predict": 256}
    assert seen["messages"][0] == {"role": "system", "content": "SYS"}
    assert seen["messages"][1]["content"] == "USER" and seen["messages"][1]["images"] == ["iVBORw=="]


def test_non_json_output_is_malformed_for_call_json():
    from extraction.llm import Deadline, MalformedOutput, call_json
    with pytest.raises(MalformedOutput):
        call_json(provider(lambda r: chat_reply("not json")), "s", "u", SCHEMA, Deadline(30), "test")


def test_missing_model_and_unreachable_server_are_unavailable():
    with pytest.raises(ProviderUnavailable, match="pull"):
        provider(lambda r: httpx.Response(404, json={"error": "model not found"})).generate_json("s", "u", SCHEMA)

    def down(request):
        raise httpx.ConnectError("refused")
    with pytest.raises(ProviderUnavailable):
        provider(down).generate_json("s", "u", SCHEMA)


def test_server_error_is_retried_then_succeeds_and_client_error_is_not():
    calls = []

    def flaky(request):
        calls.append(1)
        return chat_reply('{"answer": "ok"}') if len(calls) > 1 else httpx.Response(503)
    assert provider(flaky).generate_json("s", "u", SCHEMA).attempts == 2
    with pytest.raises(ProviderError):
        provider(lambda r: httpx.Response(400, json={"error": "bad"})).generate_json("s", "u", SCHEMA)


def test_expired_deadline_does_not_call():
    calls = []
    p = provider(lambda r: calls.append(1) or chat_reply("{}"))
    with pytest.raises(ProviderUnavailable):
        p.generate_json("s", "u", SCHEMA, deadline=p._clock() - 1)
    assert calls == []


@pytest.mark.parametrize("url", ["ftp://host", "http://user:pw@127.0.0.1:11434", "not a url"])
def test_invalid_url_is_rejected(url):
    with pytest.raises(ProviderUnavailable):
        OllamaProvider(OllamaConfig(base_url=url))


def test_factory_defaults_to_local_and_blocks_cloud_without_opt_in(monkeypatch):
    monkeypatch.setattr("runner.config.load_dotenv", lambda *a, **k: [])
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    built = providers.build_provider()
    assert isinstance(built, OllamaProvider) and built.model_id == "gemma3:4b"
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    monkeypatch.delenv("ALLOW_CLOUD_LLM", raising=False)
    with pytest.raises(ProviderUnavailable, match="ALLOW_CLOUD_LLM"):
        providers.build_provider()
    monkeypatch.setenv("LLM_PROVIDER", "none")
    with pytest.raises(ProviderUnavailable):
        providers.build_provider()


def test_gemini_ocr_is_refused_without_cloud_opt_in(monkeypatch, tmp_path):
    from extraction import Config, Service
    from runner.errors import ServiceError
    monkeypatch.setattr("runner.config.load_dotenv", lambda *a, **k: [])
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    monkeypatch.delenv("ALLOW_CLOUD_LLM", raising=False)
    with pytest.raises(ServiceError) as info:
        Service(Config(storage_dir=tmp_path, ocr_engine="gemini")).extractor()
    assert info.value.code == "PROVIDER_UNAVAILABLE" and "ALLOW_CLOUD_LLM" in info.value.message


def test_explicit_ai_provider_keeps_legacy_local_setting_from_overriding_it(monkeypatch):
    monkeypatch.setenv('AI_LOAD_DOTENV','0')
    monkeypatch.setenv('AI_PROVIDER','deepseek')
    monkeypatch.setenv('DEEPSEEK_API_KEY','synthetic-deepseek')
    monkeypatch.setenv('DEEPSEEK_MODEL_ID','deepseek-flash')
    monkeypatch.setenv('LLM_PROVIDER','none')
    built=providers.build_provider()
    try:
        assert built.name=='deepseek' and built.model_id=='deepseek-flash'
        assert built.config.api_key=='synthetic-deepseek'
    finally:
        built.close()
