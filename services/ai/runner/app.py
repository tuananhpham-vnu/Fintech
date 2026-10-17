"""FastAPI app nội bộ: POST /internal/v1/{inspect,extract,evaluate} theo internal-openapi.json 1.0.2.

Mỗi route đi cùng một pipeline:
  X-Internal-Key -> JSON -> validate input schema -> backend -> validate output schema -> semantic guards -> 200
Service không có DB/ORM và không gọi ngược backend: chỉ trả JSON để backend (Đức) tự commit.
"""
from __future__ import annotations

import hmac
import json
import logging
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse

from .backends import Backend, GoldFixtures, LiveBackend, MockBackend
from .config import MODE_MOCK, Settings
from .contracts import SCHEMA_VERSION, Contracts, Violation
from .errors import (FORBIDDEN, INVALID_MODEL_OUTPUT, INVALID_REQUEST, PAYLOAD_TOO_LARGE, ServiceError, error_body,
                     error_response)
from .guards import evaluation_output_violations, extraction_output_violations, inspection_output_violations
from .provider_diagnostics import emit_failure

logger = logging.getLogger("runner")

CONSOLE_DIR = Path(__file__).resolve().parent / "console"

Guard = Callable[[dict, dict], list[Violation]]

# operation -> (input schema, output schema, semantic guard)
OPERATIONS: dict[str, tuple[str, str, Guard]] = {
    "inspect": ("InspectionInput", "InspectionOutput", inspection_output_violations),
    "extract": ("ExtractionInput", "ExtractionOutput", extraction_output_violations),
    "evaluate": ("EvaluationInput", "EvaluationOutput", evaluation_output_violations),
}


def build_backend(settings: Settings, contracts: Contracts | None = None) -> Backend:
    if settings.mode == MODE_MOCK:
        return MockBackend(GoldFixtures(settings.fixtures_dir))
    import functools

    import rules  # rule deterministic chạy được cả khi chưa có Gemini key; ca khó khi đó chuyển HITL
    semantic = None
    if settings.gemini_key_configured and contracts is not None:
        from providers.gemini import GeminiConfig, GeminiProvider
        from providers.semantic import PaymentConditionResolver
        config = GeminiConfig.from_env()
        semantic = PaymentConditionResolver(GeminiProvider(GeminiConfig(config.api_key, settings.model_id or config.model_id)),
                                            contracts)
    return LiveBackend(evaluator=functools.partial(rules.evaluate, semantic=semantic))


def create_app(settings: Settings | None = None, backend: Backend | None = None,
               contracts: Contracts | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    contracts = contracts or Contracts(settings.contracts_dir)
    backend = backend or build_backend(settings, contracts)

    # Internal service: spec chuẩn là packages/contracts/internal-openapi.json, không tự sinh docs.
    app = FastAPI(title="Fintech AI internal", version=SCHEMA_VERSION, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings, app.state.contracts, app.state.backend = settings, contracts, backend
    # Kiểm toàn vẹn input sau schema, trước backend (chỉ evaluate nhận snapshot nhiều tham chiếu chéo).
    from extraction.grounding import Registry
    registry = Registry.from_json(contracts.load("field-registry.json"))
    app.state.input_guards = {"evaluate": lambda payload: evaluation_input_violations(payload, registry)}

    @app.exception_handler(ServiceError)
    async def _service_error(request: Request, exc: ServiceError) -> JSONResponse:
        response = error_response(exc)
        # Internal diagnostics are opt-in and content-free. Keep the exact
        # public envelope; correlate its existing request UUID with the job's
        # validated document UUID, never with a prompt/header/source body.
        emit_failure(exc, getattr(request.state, "ai_operation", None),
                     getattr(request.state, "ai_document_id", None),
                     json.loads(response.body)["error"]["request_id"])
        return response

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        logger.error("unexpected %s", type(exc).__name__)  # không log payload hồ sơ
        return JSONResponse(status_code=500, content=error_body("INTERNAL_ERROR", "Unexpected internal error."))

    @app.get("/healthz")
    def healthz() -> dict:
        return {"status": "ok", "schema_version": SCHEMA_VERSION, "mode": backend.name}

    for operation, spec in OPERATIONS.items():
        app.add_api_route(f"/internal/v1/{operation}", _make_handler(operation, *spec), methods=["POST"],
                          name=f"post_{operation}")
    if settings.test_console:
        _mount_console(app)
    return app


def _mount_console(app: FastAPI) -> None:
    """Trang test thủ công (ENABLE_TEST_CONSOLE=1). Chỉ là file tĩnh + ca mẫu giả lập; API vẫn đòi X-Internal-Key."""
    headers = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer"}

    @app.get("/console", include_in_schema=False)
    def console() -> FileResponse:
        return FileResponse(CONSOLE_DIR / "index.html", media_type="text/html", headers=headers)

    @app.get("/console/presets.json", include_in_schema=False)
    def console_presets() -> FileResponse:
        return FileResponse(CONSOLE_DIR / "presets.json", media_type="application/json", headers=headers)


def _authorize(settings: Settings, provided: str | None) -> None:
    expected = settings.internal_api_key
    if not expected or not provided or not hmac.compare_digest(provided.encode(), expected.encode()):
        raise ServiceError(403, FORBIDDEN, "Missing or invalid X-Internal-Key.")


async def _read_json(request: Request, limit: int) -> object:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:   # từ chối trước khi đọc body vào bộ nhớ
        raise ServiceError(413, PAYLOAD_TOO_LARGE, f"Body exceeds {limit} bytes.")
    body = bytearray()
    async for chunk in request.stream():   # không tin Content-Length (có thể thiếu hoặc khai sai)
        body += chunk
        if len(body) > limit:
            raise ServiceError(413, PAYLOAD_TOO_LARGE, f"Body exceeds {limit} bytes.")
    try:
        return json.loads(bytes(body))
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ServiceError(422, INVALID_REQUEST, "Body must be JSON.")


def _make_handler(operation: str, input_schema: str, output_schema: str, guard: Guard):
    async def handler(request: Request) -> JSONResponse:
        app = request.app
        _authorize(app.state.settings, request.headers.get("X-Internal-Key"))
        payload = await _read_json(request, app.state.settings.max_request_bytes)
        violations = app.state.contracts.violations(input_schema, payload)
        if violations:
            raise ServiceError(422, INVALID_REQUEST, f"Request does not match {input_schema} 1.0.2.", violations)
        violations = app.state.input_guards.get(operation, lambda _: [])(payload)
        if violations:
            raise ServiceError(422, INVALID_REQUEST, f"{input_schema} is not internally consistent.", violations)

        request.state.ai_operation = operation
        request.state.ai_document_id = payload.get("document_id")

        output = await run_in_threadpool(getattr(app.state.backend, operation), payload)

        violations = app.state.contracts.violations(output_schema, output)
        if not violations:
            violations = guard(payload, output)
        if violations:
            logger.error("%s output rejected: %d violations", operation, len(violations))
            raise ServiceError(422, INVALID_MODEL_OUTPUT, f"{output_schema} failed validation; not returned.", violations)
        return JSONResponse(output, headers={"X-AI-Mode": app.state.backend.name})

    handler.__name__ = f"post_{operation}"
    return handler
