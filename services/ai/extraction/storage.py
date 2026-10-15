"""Đọc PDF theo storage_key trong AI_STORAGE_DIR: chặn path traversal, giới hạn kích thước, kiểm SHA-256.

storage_key là khóa tương đối do backend cấp (vd. "staging/<uuid>.pdf"). Service chỉ đọc, không ghi.
File được đọc một lần vào bộ nhớ: hash và parse cùng trên một bản byte, không có khe TOCTOU.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from runner.contracts import Violation
from runner.errors import INVALID_REQUEST, PROVIDER_UNAVAILABLE, ServiceError

PDF_NOT_FOUND = "PDF_NOT_FOUND"
PDF_TOO_LARGE = "PDF_TOO_LARGE"
SHA256_MISMATCH = "SHA256_MISMATCH"

# Từng đoạn: chữ/số/._- , không bắt đầu bằng '.', phân tách bằng '/', đuôi .pdf
_SEGMENT = r"[A-Za-z0-9_][A-Za-z0-9._-]{0,127}"
STORAGE_KEY = re.compile(rf"^{_SEGMENT}(/{_SEGMENT}){{0,7}}$")


@dataclass(frozen=True)
class StoredFile:
    data: bytes
    sha256: str

    @property
    def byte_size(self) -> int:
        return len(self.data)


def _invalid_key(message: str) -> ServiceError:
    return ServiceError(422, INVALID_REQUEST, message, [Violation("/storage_key", message)])


def resolve(storage_dir: Path | None, storage_key: str) -> Path:
    if storage_dir is None:
        raise ServiceError(503, PROVIDER_UNAVAILABLE, "AI_STORAGE_DIR is not configured.")
    if not STORAGE_KEY.match(storage_key) or ".." in storage_key or not storage_key.lower().endswith(".pdf"):
        raise _invalid_key("storage_key must be a relative key of [A-Za-z0-9._-] segments ending in .pdf.")
    root = Path(storage_dir).resolve()
    path = (root / storage_key).resolve()
    if not path.is_relative_to(root):  # symlink trỏ ra ngoài root
        raise _invalid_key("storage_key resolves outside the storage directory.")
    return path


def read_verified(storage_dir: Path | None, storage_key: str, expected_sha256: str, max_bytes: int) -> StoredFile:
    path = resolve(storage_dir, storage_key)
    if not path.is_file():
        raise ServiceError(404, PDF_NOT_FOUND, "No file at storage_key.")
    if path.stat().st_size > max_bytes:
        raise ServiceError(413, PDF_TOO_LARGE, f"File exceeds {max_bytes} bytes.")
    data = path.read_bytes()
    if len(data) > max_bytes:
        raise ServiceError(413, PDF_TOO_LARGE, f"File exceeds {max_bytes} bytes.")
    digest = hashlib.sha256(data).hexdigest()
    if digest != expected_sha256:
        raise ServiceError(422, SHA256_MISMATCH, "File content does not match the provided sha256.",
                           [Violation("/sha256", "does not match file content")])
    return StoredFile(data, digest)
