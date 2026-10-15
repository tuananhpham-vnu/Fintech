"""Error envelope đúng schema Error: {"error": {code, message, request_id(uuid), details[{path, message}]}}."""
from __future__ import annotations

import uuid
from typing import Sequence

from fastapi.responses import JSONResponse

from .contracts import Violation

# Mã dùng ở service nội bộ (catalogue trong docs/contracts.md §9.6)
INVALID_REQUEST = "INVALID_REQUEST"
INVALID_MODEL_OUTPUT = "INVALID_MODEL_OUTPUT"
PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
FORBIDDEN = "FORBIDDEN"
PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"   # đề xuất, cần nhóm xác nhận như các mã 4xx mới khác


class ServiceError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Sequence[Violation] = ()):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = list(details)


def error_body(code: str, message: str, details: Sequence[Violation] = ()) -> dict:
    return {"error": {
        "code": code,
        "message": message,
        "request_id": str(uuid.uuid4()),
        "details": [d.as_detail() for d in details],
    }}


def error_response(exc: ServiceError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content=error_body(exc.code, exc.message, exc.details))
