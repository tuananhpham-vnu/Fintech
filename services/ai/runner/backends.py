"""Backends cho 3 route. Chọn theo AI_MODE, không tự chuyển mock khi live lỗi (T17a).

- mock: trả gold có nhãn (provenance.model_id = MOCK-GOLD-NOT-MODEL-OUTPUT, header X-AI-Mode: mock).
- live: inspect/extract gọi package `extraction` của Nguyên (import, không copy), chưa có -> 503;
        evaluate chạy evaluator deterministic `rules` (không cần Gemini key).
"""
from __future__ import annotations

import copy
import importlib
import json
from functools import cached_property
from pathlib import Path
from typing import Protocol

from .errors import PROVIDER_UNAVAILABLE, ServiceError


class Backend(Protocol):
    name: str

    def inspect(self, payload: dict) -> dict: ...
    def extract(self, payload: dict) -> dict: ...
    def evaluate(self, payload: dict) -> dict: ...


def _unavailable(message: str) -> ServiceError:
    return ServiceError(503, PROVIDER_UNAVAILABLE, message)


class GoldFixtures:
    """Gold/manifest trong bundle 1.0.2. Chỉ đọc; không phải output của model."""

    def __init__(self, directory: Path):
        self.directory = Path(directory)

    def _load(self, name: str):
        path = self.directory / name
        if not path.is_file():
            raise _unavailable(f"Mock fixture {name} not found in AI_FIXTURES_DIR.")
        return json.loads(path.read_text("utf-8"))

    @cached_property
    def manifest(self) -> list[dict]:
        return self._load("manifest.json")["files"]

    @cached_property
    def extractions(self) -> list[dict]:
        return self._load("extraction-gold.json")

    @cached_property
    def golden_cases(self) -> list[dict]:
        return self._load("golden-cases.json")


class MockBackend:
    name = "mock"

    def __init__(self, fixtures: GoldFixtures):
        self.fixtures = fixtures

    def inspect(self, payload: dict) -> dict:
        entry = next((f for f in self.fixtures.manifest if f["sha256"] == payload["sha256"]), None)
        path = self.fixtures.directory / entry["filename"] if entry else None
        if entry is None or not path.is_file():
            raise _unavailable("Mock inspect only knows the 8 bundle PDFs (matched by sha256).")
        return {
            "schema_version": payload["schema_version"],
            "sha256": payload["sha256"],
            "page_count": entry["page_count"],
            "byte_size": path.stat().st_size,
            "encrypted": False,
            "has_embedded_files": False,
        }

    def extract(self, payload: dict) -> dict:
        gold = next((g for g in self.fixtures.extractions
                     if g["document_id"] == payload["document_id"] and g["sha256"] == payload["sha256"]
                     and g["case_id"] == payload["case_id"]), None)
        if gold is None:
            raise _unavailable("Mock extract only returns gold for the bundle documents (document_id+case_id+sha256).")
        return copy.deepcopy(gold)

    def evaluate(self, payload: dict) -> dict:
        case = next((c for c in self.fixtures.golden_cases
                     if c["input"]["snapshot_hash"] == payload["snapshot_hash"]
                     and c["input"]["run_id"] == payload["run_id"]), None)
        if case is None:
            raise _unavailable("Mock evaluate only answers G01–G03 inputs (run_id+snapshot_hash).")
        return copy.deepcopy(case["expected"])


class LiveBackend:
    """Nối package thật. Package extraction do Nguyên sở hữu: services/ai/extraction."""

    name = "live"

    def __init__(self, extraction_module: str = "extraction", evaluator=None):
        self._extraction_module = extraction_module
        self._evaluator = evaluator

    def _extraction(self):
        try:
            return importlib.import_module(self._extraction_module)
        except ImportError as exc:
            raise _unavailable("Extraction package is not installed.") from exc

    def _call_extraction(self, func: str, payload: dict) -> dict:
        try:
            return getattr(self._extraction(), func)(payload)
        except NotImplementedError as exc:
            raise _unavailable(f"Extraction {func} is not implemented yet (owner: Nguyên).") from exc

    def inspect(self, payload: dict) -> dict:
        return self._call_extraction("inspect", payload)

    def extract(self, payload: dict) -> dict:
        return self._call_extraction("extract", payload)

    def evaluate(self, payload: dict) -> dict:
        if self._evaluator is None:
            raise _unavailable("Live evaluator is not available yet (T14a).")
        return self._evaluator(payload)
