"""Strict validator theo canonical contracts 1.0.2 (packages/contracts/schemas.json).

Nạp một lần, kiểm SHA256SUMS để phát hiện contract bị sửa tay, rồi validate bằng
JSON Schema 2020-12 + FormatChecker (uuid/date/date-time). Đây là nguồn sự thật ở ranh giới API.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

SCHEMA_VERSION = "1.0.2"


class ContractDriftError(RuntimeError):
    """File contract không khớp SHA256SUMS hoặc VERSION."""


@dataclass(frozen=True)
class Violation:
    path: str
    message: str

    def as_detail(self) -> dict[str, str]:
        return {"path": self.path, "message": self.message}


REQUIRED_FORMATS = ("uuid", "date", "date-time")


class Contracts:
    def __init__(self, directory: Path):
        self.directory = Path(directory)
        missing = [f for f in REQUIRED_FORMATS if f not in FormatChecker().checkers]
        if missing:  # không validate lỏng một cách âm thầm (vd. thiếu rfc3339-validator trên server)
            raise ContractDriftError(f"format checkers unavailable: {missing}")
        self._verify_integrity()
        self.schemas: dict[str, Any] = json.loads((self.directory / "schemas.json").read_text("utf-8"))
        self.defs: dict[str, Any] = self.schemas["$defs"]
        Draft202012Validator.check_schema(self.schemas)
        self._validators: dict[str, Draft202012Validator] = {}

    def _verify_integrity(self) -> None:
        version = (self.directory / "VERSION").read_text("utf-8").strip()
        if version != SCHEMA_VERSION:
            raise ContractDriftError(f"contracts VERSION {version!r} != {SCHEMA_VERSION!r}")
        for line in (self.directory / "SHA256SUMS").read_text("utf-8").splitlines():
            digest, name = line.split(maxsplit=1)
            actual = hashlib.sha256((self.directory / name).read_bytes()).hexdigest()
            if actual != digest:
                raise ContractDriftError(f"{name} does not match SHA256SUMS")

    @cached_property
    def sha256sums(self) -> dict[str, str]:
        pairs = (line.split(maxsplit=1) for line in (self.directory / "SHA256SUMS").read_text("utf-8").splitlines())
        return {name: digest for digest, name in pairs}

    def load(self, filename: str) -> Any:
        return json.loads((self.directory / filename).read_text("utf-8"))

    def validator(self, name: str) -> Draft202012Validator:
        if name not in self.defs:
            raise KeyError(f"unknown schema {name}")
        if name not in self._validators:
            self._validators[name] = Draft202012Validator(
                {"$ref": f"#/$defs/{name}", "$defs": self.defs}, format_checker=FormatChecker())
        return self._validators[name]

    def violations(self, name: str, payload: Any, limit: int = 20) -> list[Violation]:
        found = []
        for error in sorted(self.validator(name).iter_errors(payload), key=lambda e: list(e.absolute_path)):
            path = "/" + "/".join(str(p) for p in error.absolute_path)
            found.append(Violation(path=path, message=error.message[:300]))
            if len(found) >= limit:
                break
        return found
