"""DeepSeek Chat Completions adapter. No SDK, provider fallback or content logging."""
from __future__ import annotations

import base64
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Sequence
from urllib.parse import urlsplit

import httpx

from .base import GenerateResult, ProviderError, ProviderUnavailable

BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-flash"
RETRYABLE = {429, 500, 502, 503, 504}
VISION_MODELS = {"deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"}
logger = logging.getLogger("providers.deepseek")


def _reject_constant(value: str):
    raise ValueError("Non-JSON numeric constant")


@dataclass(frozen=True)
class DeepSeekConfig:
    api_key: str | None = field(repr=False)
    model_id: str = DEFAULT_MODEL
    timeout_s: float = 90.0
    max_retries: int = 2
    base_url: str = BASE_URL


class DeepSeekProvider:
    name = "deepseek"
    label = "DeepSeek"
    key_setting = "DEEPSEEK_API_KEY"
    model_setting = "DEEPSEEK_MODEL_ID"
    base_setting = "DEEPSEEK_BASE_URL"
    allowed_base_paths = ('', '/v1')

    def __init__(self, config: DeepSeekConfig, client: httpx.Client | None = None,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic):
        if not config.api_key:
            raise ProviderUnavailable(f"{self.key_setting} is not configured")
        if not config.model_id or not config.model_id.strip():
            raise ProviderUnavailable(f"{self.model_setting} is not configured")
        try:
            url = urlsplit(config.base_url)
            _ = url.port
            valid = (url.scheme == "https" and url.hostname and not url.username and not url.password
                     and not url.query and not url.fragment and url.path.rstrip("/") in self.allowed_base_paths)
        except ValueError:
            valid = False
        if not valid:
            raise ProviderUnavailable(f"Invalid {self.base_setting}")
        if config.timeout_s <= 0 or config.max_retries not in range(3):
            raise ProviderUnavailable(f"Invalid {self.label} retry configuration")
        self.config = config
        self._client = client or httpx.Client(timeout=config.timeout_s, follow_redirects=False)
        self._sleep, self._clock = sleep, clock

    @property
    def model_id(self) -> str:
        return self.config.model_id

    @property
    def supports_images(self) -> bool:
        return self.model_id in VISION_MODELS

    def close(self) -> None:
        self._client.close()

    def _headers(self) -> dict[str, str]:
        return {"Authorization": "Bearer " + self.config.api_key, "Content-Type": "application/json"}

    def _request(self, body: dict, deadline: float | None) -> tuple[dict, int]:
        last = "unknown"
        for attempt in range(1, self.config.max_retries + 2):
            remaining = self.config.timeout_s if deadline is None else min(self.config.timeout_s, deadline - self._clock())
            if remaining <= 0:
                last = "deadline"
                break
            wait = 2 ** (attempt - 1)
            from .spend_budget import reserve, settle
            reservation = reserve(self, body)
            try:
                response = self._client.post(self.config.base_url.rstrip("/") + "/chat/completions",
                    headers=self._headers(),
                    json=body, timeout=remaining, follow_redirects=False)
            except httpx.TimeoutException:
                last = "timeout"
            except httpx.TransportError as exc:
                last = type(exc).__name__
            else:
                if 200 <= response.status_code < 300:
                    try:
                        data = response.json()
                        if not isinstance(data, dict):
                            raise TypeError("Invalid provider envelope")
                        settle(reservation, data)
                        return data, attempt
                    except (ValueError, TypeError) as exc:
                        raise ProviderError(f"{self.label} returned no parseable JSON") from exc
                if response.status_code not in RETRYABLE:
                    raise ProviderError(f"{self.label} HTTP {response.status_code}")
                last = f"HTTP {response.status_code}"
                retry_after = response.headers.get("Retry-After", "")
                if retry_after.isdigit():
                    wait = min(float(retry_after), 30.0)
            if attempt <= self.config.max_retries:
                if deadline is not None and self._clock() + wait >= deadline:
                    break
                self._sleep(wait)
        logging.getLogger('providers.' + self.name).warning("%s unavailable after retries: %s", self.name, last)
        raise ProviderUnavailable(f"{self.label} unavailable after {self.config.max_retries + 1} attempts ({last})")

    def generate_json(self, system: str, user: str, response_schema: dict, temperature: float = 0.0,
                      media: Sequence[tuple[str, bytes]] = (), deadline: float | None = None,
                      max_output_tokens: int | None = None) -> GenerateResult:
        if media and not self.supports_images:
            raise ProviderUnavailable(f"Selected {self.label} model does not support image OCR")
        content: str | list[dict] = user
        if media:
            content = [{"type": "text", "text": user}]
            for mime, data in media:
                if mime not in {"image/png", "image/jpeg", "image/webp", "image/gif"}:
                    raise ProviderUnavailable(f"Unsupported {self.label} image type")
                if len(data) > 32 * 1024 * 1024:
                    raise ProviderUnavailable(f"{self.label} image exceeds the input limit")
                encoded = base64.b64encode(data).decode("ascii")
                content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}})
        body = {
            "model": self.model_id,
            "messages": [
                {"role": "system", "content": system + "\nReturn only valid JSON matching this JSON Schema. "
                 "The application independently validates every value and citation.\n" + json.dumps(response_schema, ensure_ascii=False)},
                {"role": "user", "content": content},
            ],
            "response_format": {"type": "json_object"},
            "thinking": {"type": "disabled"},
            "temperature": temperature,
            "max_tokens": max_output_tokens if max_output_tokens is not None else 8192,
            "stream": False,
        }
        if len(json.dumps(body, ensure_ascii=False).encode("utf8")) > 48 * 1024 * 1024:
            raise ProviderUnavailable(f"{self.label} request exceeds the input limit")
        started = self._clock()
        data, attempts = self._request(body, deadline)
        if deadline is not None and self._clock() >= deadline:
            raise ProviderUnavailable(f"{self.label} unavailable after 1 attempts (deadline)")
        try:
            choice = data["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise ValueError("Incomplete provider output")
            text = choice["message"]["content"]
            if not isinstance(text, str) or not text.strip():
                raise ValueError("Empty provider output")
            parsed = json.loads(text, parse_constant=_reject_constant)
            if not isinstance(parsed, dict):
                raise ValueError("Expected a JSON object")
        except (KeyError, IndexError, ValueError, TypeError, AttributeError):
            # Normalize malformed/truncated/empty responses for the existing one-repair path.
            raise ProviderError(f"{self.label} returned no parseable JSON") from json.JSONDecodeError("Invalid provider output", "", 0)
        usage = data.get("usage")
        return GenerateResult(parsed, data.get("model") if isinstance(data.get("model"), str) else None,
                              int((self._clock() - started) * 1000), attempts, usage if isinstance(usage, dict) else {})
