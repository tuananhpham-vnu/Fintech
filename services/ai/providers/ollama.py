"""Adapter Ollama (model chạy local, mặc định gemma3:4b): cùng interface với GeminiProvider để llm.call_json,
extractor, semantic resolver và chat dùng chung. Dữ liệu chỉ đi tới OLLAMA_URL (loopback / mạng nội bộ).

- Structured output: JSON schema truyền vào `format` (Ollama >= 0.5); temperature 0 để ổn định.
- Lỗi mạng/5xx/timeout: retry hữu hạn trong deadline; model chưa pull (404) -> ProviderUnavailable, không đoán.
- Output không phải JSON -> ProviderError có __cause__ JSONDecodeError (call_json chuyển thành MalformedOutput).
- Không log prompt/nội dung hồ sơ.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Callable, Sequence
from urllib.parse import urlsplit

import httpx

from .gemini import GenerateResult, ProviderError, ProviderUnavailable

logger = logging.getLogger("providers.ollama")

DEFAULT_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = "gemma3:4b"
RETRYABLE = {500, 502, 503, 504}


@dataclass(frozen=True)
class OllamaConfig:
    base_url: str = DEFAULT_URL
    model_id: str = DEFAULT_MODEL
    timeout_s: float = 600.0          # chất lượng hơn tốc độ: model local trên CPU có thể cần vài phút
    max_retries: int = 1
    num_ctx: int = 32768              # đủ cho 10 trang hồ sơ + prompt
    keep_alive: str = "30m"

    @classmethod
    def from_env(cls) -> "OllamaConfig":
        from runner.config import load_dotenv
        load_dotenv()
        env = os.environ
        return cls(base_url=env.get("OLLAMA_URL", DEFAULT_URL).rstrip("/"),
                   model_id=env.get("LLM_MODEL", DEFAULT_MODEL),
                   timeout_s=float(env.get("OLLAMA_TIMEOUT_S", 600)),
                   num_ctx=int(env.get("OLLAMA_NUM_CTX", 32768)))


class OllamaProvider:
    # Decoder theo grammar tuân thủ JSON schema chặt: extractor gửi mảng cố định từng vị trí (prefixItems).
    positional_schema = True

    def __init__(self, config: OllamaConfig, client: httpx.Client | None = None,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic):
        url = urlsplit(config.base_url)
        if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
            raise ProviderUnavailable("OLLAMA_URL is not a valid http(s) URL")
        if not config.model_id:
            raise ProviderUnavailable("LLM_MODEL is not configured")
        self.config = config
        self._client = client or httpx.Client(timeout=config.timeout_s)
        self._sleep = sleep
        self._clock = clock

    @property
    def model_id(self) -> str:
        return self.config.model_id

    def _post(self, path: str, body: dict, deadline: float | None) -> tuple[dict, int]:
        last = "unknown"
        for attempt in range(1, self.config.max_retries + 2):
            timeout = self.config.timeout_s
            if deadline is not None:
                remaining = deadline - self._clock()
                if remaining <= 0:
                    last = "deadline"
                    break
                timeout = min(timeout, remaining)
            try:
                response = self._client.post(f"{self.config.base_url}{path}", json=body, timeout=timeout)
            except httpx.TimeoutException:
                last = "timeout"
            except httpx.TransportError as exc:
                last = type(exc).__name__
            else:
                if response.status_code == 404:
                    raise ProviderUnavailable(f"Model {self.config.model_id} is not available in Ollama (pull it)")
                if response.status_code < 400:
                    return response.json(), attempt
                if response.status_code not in RETRYABLE:
                    raise ProviderError(f"Ollama HTTP {response.status_code}")
                last = f"HTTP {response.status_code}"
            if attempt <= self.config.max_retries:
                if deadline is not None and self._clock() + 1 >= deadline:
                    break
                self._sleep(1)
        logger.warning("ollama unavailable: %s", last)
        raise ProviderUnavailable(f"Ollama unavailable ({last})")

    def list_models(self) -> list[str]:
        try:
            response = self._client.get(f"{self.config.base_url}/api/tags", timeout=10)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProviderUnavailable("Ollama is not reachable") from exc
        return [m.get("name", "") for m in response.json().get("models", [])]

    def generate_json(self, system: str, user: str, response_schema: dict, temperature: float = 0.0,
                      media: Sequence[tuple[str, bytes]] = (), deadline: float | None = None,
                      max_output_tokens: int | None = None) -> GenerateResult:
        message: dict = {"role": "user", "content": user}
        images = [base64.b64encode(data).decode("ascii") for mime, data in media if mime.startswith("image/")]
        if images:
            message["images"] = images
        options: dict = {"temperature": temperature, "num_ctx": self.config.num_ctx}
        if max_output_tokens is not None:
            options["num_predict"] = max_output_tokens
        body = {"model": self.config.model_id, "stream": False, "format": response_schema,
                "keep_alive": self.config.keep_alive, "options": options,
                "messages": [{"role": "system", "content": system}, message]}
        started = time.monotonic()
        data, attempts = self._post("/api/chat", body, deadline)
        latency = int((time.monotonic() - started) * 1000)
        try:
            parsed = json.loads(data["message"]["content"])
        except (KeyError, TypeError, json.JSONDecodeError) as exc:
            raise ProviderError("Ollama returned no parseable JSON") from exc
        usage = {k: data[k] for k in ("prompt_eval_count", "eval_count", "total_duration") if k in data}
        return GenerateResult(parsed, data.get("model"), latency, attempts, usage)
