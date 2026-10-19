"""Shared provider port. Business/grounding validation stays in the callers."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, Sequence


class ProviderUnavailable(RuntimeError):
    """Missing configuration, exhausted time/retries or unsupported capability."""


class ProviderError(RuntimeError):
    """Non-retryable upstream failure or malformed model output."""


class ModelOutputError(ProviderError):
    """Content-free, explicit reason why a successful HTTP response has no usable output."""

    def __init__(self, code: str):
        if code not in {"MODEL_OUTPUT_BLOCKED", "MODEL_OUTPUT_TRUNCATED", "MODEL_OUTPUT_EMPTY"}:
            raise ValueError("Unknown model output classification")
        super().__init__(code)
        self.code = code


@dataclass
class GenerateResult:
    data: Any
    model_version: str | None
    latency_ms: int
    attempts: int
    usage: dict = field(default_factory=dict)


class ModelProvider(Protocol):
    name: str

    @property
    def model_id(self) -> str: ...

    def close(self) -> None: ...

    def generate_json(self, system: str, user: str, response_schema: dict, temperature: float = 0.0,
                      media: Sequence[tuple[str, bytes]] = (), deadline: float | None = None,
                      max_output_tokens: int | None = None) -> GenerateResult: ...
