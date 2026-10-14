"""Adapter Gemini (Generative Language API, REST) — chỉ dùng ở server, key lấy từ env, không log nội dung.

Budget theo Contracts: timeout 90s/lượt, retry tối đa 2 cho lỗi tạm thời (429/5xx/timeout) có backoff.
Thiếu key/model -> ProviderUnavailable (route trả 503), không tự rơi về mock.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

import httpx

logger = logging.getLogger("providers.gemini")

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
RETRYABLE = {429, 500, 502, 503, 504}


class ProviderUnavailable(RuntimeError):
    """Không gọi được provider (thiếu key, hết retry, lỗi mạng)."""


class ProviderError(RuntimeError):
    """Provider trả lỗi không retry được hoặc output không parse được."""


@dataclass(frozen=True)
class GeminiConfig:
    api_key: str | None
    model_id: str
    timeout_s: float = 90.0
    max_retries: int = 2
    base_url: str = BASE_URL

    @classmethod
    def from_env(cls) -> "GeminiConfig":
        from runner.config import load_dotenv
        load_dotenv()
        return cls(api_key=os.environ.get("GEMINI_API_KEY") or None,
                   model_id=os.environ.get("MODEL_ID", "gemini-3.1-flash-lite"))


@dataclass
class GenerateResult:
    data: Any
    model_version: str | None
    latency_ms: int
    attempts: int
    usage: dict = field(default_factory=dict)


class GeminiProvider:
    def __init__(self, config: GeminiConfig, client: httpx.Client | None = None,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic):
        if not config.api_key:
            raise ProviderUnavailable("GEMINI_API_KEY is not configured")
        if not config.model_id:
            raise ProviderUnavailable("MODEL_ID is not configured")
        self.config = config
        self._client = client or httpx.Client(timeout=config.timeout_s)
        self._sleep = sleep
        self._clock = clock

    @property
    def model_id(self) -> str:
        return self.config.model_id

    def _request(self, method: str, path: str, body: dict | None = None,
                 deadline: float | None = None) -> tuple[dict, int]:
        """`deadline`: mốc `clock()` tuyệt đối (M2). Mỗi lượt chỉ được dùng phần thời gian còn lại; không retry/backoff
        nếu không kịp. None = hành vi cũ (timeout cố định mỗi lượt)."""
        url = f"{self.config.base_url}/{path}"
        headers = {"x-goog-api-key": self.config.api_key, "Content-Type": "application/json"}
        last = "unknown"
        for attempt in range(1, self.config.max_retries + 2):
            options = {}
            if deadline is not None:
                remaining = deadline - self._clock()
                if remaining <= 0:
                    last = "deadline"
                    break
                options["timeout"] = min(self.config.timeout_s, remaining)
            try:
                response = self._client.request(method, url, headers=headers, json=body, **options)
            except httpx.TimeoutException:
                last = "timeout"
            except httpx.TransportError as exc:
                last = type(exc).__name__
            else:
                if response.status_code < 400:
                    return response.json(), attempt
                if response.status_code not in RETRYABLE:
                    # Không đưa body lỗi vào log (có thể chứa nội dung prompt)
                    raise ProviderError(f"Gemini HTTP {response.status_code}")
                last = f"HTTP {response.status_code}"
                retry_after = response.headers.get("Retry-After")
                if retry_after and retry_after.isdigit() and attempt <= self.config.max_retries:
                    wait = min(float(retry_after), 30.0)
                    if deadline is not None and self._clock() + wait >= deadline:
                        break
                    self._sleep(wait)
                    continue
            if attempt <= self.config.max_retries:
                wait = 2 ** (attempt - 1)
                if deadline is not None and self._clock() + wait >= deadline:
                    break       # backoff would outlive the budget: give up now instead of sleeping past it
                self._sleep(wait)
        logger.warning("gemini unavailable after retries: %s", last)
        raise ProviderUnavailable(f"Gemini unavailable after {self.config.max_retries + 1} attempts ({last})")

    def list_models(self) -> list[str]:
        data, _ = self._request("GET", "models?pageSize=200")
        return [m["name"].removeprefix("models/") for m in data.get("models", [])]

    def generate_json(self, system: str, user: str, response_schema: dict, temperature: float = 0.0,
                      media: Sequence[tuple[str, bytes]] = (), deadline: float | None = None,
                      max_output_tokens: int | None = None) -> GenerateResult:
        """`media`: (mime_type, bytes) đính kèm sau text, vd. ảnh trang scan cho OCR (M2). `deadline`/`max_output_tokens`
        do M2 truyền để giới hạn thời gian và độ dài output. Không truyền gì thì body và retry như cũ."""
        parts: list[dict] = [{"text": user}]
        parts += [{"inlineData": {"mimeType": mime, "data": base64.b64encode(data).decode("ascii")}}
                  for mime, data in media]
        generation = {"temperature": temperature, "responseMimeType": "application/json",
                      "responseJsonSchema": response_schema}
        if max_output_tokens is not None:
            generation["maxOutputTokens"] = max_output_tokens
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": generation,
        }
        started = time.monotonic()
        data, attempts = self._request("POST", f"models/{self.config.model_id}:generateContent", body, deadline)
        latency = int((time.monotonic() - started) * 1000)
        try:
            parts = data["candidates"][0]["content"]["parts"]
            parsed = json.loads("".join(p.get("text", "") for p in parts))
        except (KeyError, IndexError, json.JSONDecodeError) as exc:
            raise ProviderError("Gemini returned no parseable JSON") from exc
        return GenerateResult(parsed, data.get("modelVersion"), latency, attempts, data.get("usageMetadata", {}))
