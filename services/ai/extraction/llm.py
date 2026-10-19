"""Gọi provider cho M2 với budget tổng của một request và ánh xạ lỗi sang envelope.

- ProviderUnavailable / lỗi HTTP -> 503 PROVIDER_UNAVAILABLE (không bao giờ rơi về mock/gold).
- Output không parse được JSON -> MalformedOutput để caller quyết định có repair (tối đa 1 lần) hay trả 422.
- Budget: mỗi lần gọi nhận phần thời gian CÒN LẠI (timeout HTTP, retry, backoff); kết quả về sau hạn bị bỏ (503).
- Đồng thời: CallGate giới hạn số lời gọi model/OCR chạy cùng lúc trong process và số lời gọi được chờ;
  chờ quá phần budget còn lại hoặc hàng chờ đầy -> 503 ngay, không xếp hàng vô hạn.
"""
from __future__ import annotations

import json
import os
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

from providers.base import ModelOutputError, ProviderError, ProviderUnavailable
from runner.errors import PROVIDER_UNAVAILABLE, ServiceError

EXTRACTION_MAX_OUTPUT_TOKENS = 16384
OCR_MAX_OUTPUT_TOKENS = 16384


class MalformedOutput(Exception):
    """Provider trả lời nhưng không phải JSON đọc được."""


def _unavailable(message: str) -> ServiceError:
    return ServiceError(503, PROVIDER_UNAVAILABLE, message)


class Deadline:
    def __init__(self, seconds: float, clock=time.monotonic):
        self._clock = clock
        self.end = clock() + seconds

    def remaining(self) -> float:
        return max(0.0, self.end - self._clock())

    def check(self, what: str) -> None:
        if self._clock() >= self.end:
            raise _unavailable(f"Extraction time budget exhausted before {what}.")


class CallGate:
    """Tối đa `limit` lời gọi chạy cùng lúc, tối đa `max_waiting` lời gọi chờ; chờ không quá hạn của request."""

    def __init__(self, limit: int, max_waiting: int):
        self.limit, self.max_waiting = limit, max_waiting
        self._slots = threading.BoundedSemaphore(limit)
        self._lock = threading.Lock()
        self.waiting = 0
        self.active = 0

    @contextmanager
    def slot(self, deadline: Deadline, what: str) -> Iterator[None]:
        with self._lock:
            if self.waiting >= self.max_waiting:
                raise _unavailable(f"Too many model calls queued; {what} rejected.")
            self.waiting += 1
        try:
            acquired = self._slots.acquire(timeout=deadline.remaining())
        finally:
            with self._lock:
                self.waiting -= 1
        if not acquired:
            raise _unavailable(f"Extraction time budget exhausted waiting for a model slot ({what}).")
        with self._lock:
            self.active += 1
        try:
            yield
        finally:
            with self._lock:
                self.active -= 1
            self._slots.release()

    @classmethod
    def from_env(cls) -> "CallGate":
        return cls(int(os.environ.get("AI_MAX_MODEL_CALLS", 4)), int(os.environ.get("AI_MAX_MODEL_QUEUE", 16)))


GATE = CallGate.from_env()


def call_json(provider: Any, system: str, user: str, schema: dict, deadline: Deadline, what: str,
              media: Sequence[tuple[str, bytes]] = (), max_output_tokens: int = EXTRACTION_MAX_OUTPUT_TOKENS,
              gate: CallGate | None = None) -> Any:
    if provider is None:
        raise _unavailable(f"No model provider configured for {what}.")
    deadline.check(what)
    with (gate or GATE).slot(deadline, what):
        deadline.check(what)
        try:
            result = provider.generate_json(system, user, schema, media=media, deadline=deadline.end,
                                            max_output_tokens=max_output_tokens)
        except ProviderUnavailable as exc:
            if getattr(exc,'code',None)=='AI_SPEND_BUDGET_EXHAUSTED':
                raise ServiceError(429,exc.code,'AI spending ceiling reached; review existing results before further processing.') from exc
            raise _unavailable(f"Model provider unavailable during {what}.") from exc
        except ModelOutputError as exc:
            raise ServiceError(422, exc.code, "Model returned no usable output.") from exc
        except ProviderError as exc:
            if isinstance(exc.__cause__, (json.JSONDecodeError, KeyError, IndexError, TypeError)):
                raise MalformedOutput(what) from exc
            raise _unavailable(f"Model provider error during {what}.") from exc
    deadline.check(f"accepting the result of {what}")     # HTTP không hủy được giữa chừng: kết quả trễ bị bỏ
    return result.data
