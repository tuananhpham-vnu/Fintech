"""Demo API + UI cho module đối chiếu (P3). Chỉ dùng dữ liệu giả lập, không nhận hồ sơ thật."""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from scenarios import SCENARIOS, get_scenario
from sme_rules import RuleConfig, run_analysis
from sme_rules.contracts import CaseSnapshot, Fact, RunOutput
from sme_rules.engine import load_default_registry

MAX_BODY_BYTES = 1_000_000
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="SME Review – Rules demo", version="1.0.0",
              docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)


class AnalyzeRequest(BaseModel):
    snapshot: CaseSnapshot
    facts: List[Fact] = Field(default_factory=list)
    enabled_rules: Optional[List[str]] = None


class ScenarioSummary(BaseModel):
    id: str
    title: str
    description: str
    highlights: List[str]


class RuleInfo(BaseModel):
    rule_id: str
    title: str
    rule_version: str


class DemoRun(BaseModel):
    scenario: ScenarioSummary
    input: AnalyzeRequest
    output: RunOutput


def _error(status: int, code: str, message: str) -> JSONResponse:
    """Hình dạng lỗi thống nhất theo phần 16 của tài liệu triển khai."""
    return JSONResponse(status_code=status, content={
        "error": {"code": code, "message": message, "request_id": f"req_{uuid.uuid4().hex[:12]}"}})


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        return _error(413, "PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên vượt 1 MB.")
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", []))
    return _error(422, "INVALID_INPUT", f"Dữ liệu không đúng contract tại {where}: {first.get('msg', '')}")


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
    return _error(exc.status_code, "HTTP_ERROR", str(exc.detail))


def _summary(scenario) -> ScenarioSummary:
    return ScenarioSummary(id=scenario.id, title=scenario.title, description=scenario.description,
                           highlights=list(scenario.highlights))


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/api/v1/rules", response_model=List[RuleInfo])
def list_rules() -> List[RuleInfo]:
    return [RuleInfo(rule_id=r.rule_id, title=r.title, rule_version=r.rule_version) for r in load_default_registry().create()]


@app.get("/api/v1/demo/scenarios", response_model=List[ScenarioSummary])
def list_scenarios() -> List[ScenarioSummary]:
    return [_summary(s) for s in SCENARIOS]


@app.post("/api/v1/demo/scenarios/{scenario_id}/run", response_model=DemoRun)
def run_scenario(scenario_id: str) -> DemoRun:
    try:
        scenario = get_scenario(scenario_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Không có kịch bản này.")
    snapshot, facts = scenario.build()
    return DemoRun(scenario=_summary(scenario), input=AnalyzeRequest(snapshot=snapshot, facts=facts),
                   output=run_analysis(snapshot, facts))


@app.post("/api/v1/analyze", response_model=RunOutput)
def analyze(body: AnalyzeRequest):
    try:
        config = RuleConfig(enabled_rules=body.enabled_rules)
        return run_analysis(body.snapshot, body.facts, config)
    except ValueError as exc:
        return _error(422, "INVALID_RULE_SELECTION", str(exc))


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")
