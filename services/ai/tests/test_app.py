"""T13a acceptance: 3 route đúng input/output, guard output, không DB, live không tự rơi về mock."""
import sys
import uuid

import pytest
from fastapi.testclient import TestClient

from runner.app import create_app

from .conftest import HEADERS, TamperingBackend, example, make_settings


def _error_ok(contracts, response, status: int, code: str) -> dict:
    body = response.json()
    assert response.status_code == status, body
    assert body["error"]["code"] == code
    assert contracts.violations("Error", body) == []
    return body


def test_health_endpoint(client):
    assert client.get("/healthz").json() == {"status": "ok", "schema_version": "1.0.2", "mode": "mock"}


@pytest.mark.parametrize("headers", [{}, {"X-Internal-Key": "wrong"}])
def test_internal_key_required(client, contracts, examples, headers):
    response = client.post("/internal/v1/inspect", json=example(examples, "inspect request"), headers=headers)
    _error_ok(contracts, response, 403, "FORBIDDEN")


def test_key_not_configured_fails_closed(contracts, examples):
    app = create_app(make_settings(key=None), contracts=contracts)
    response = TestClient(app).post("/internal/v1/inspect", json=example(examples, "inspect request"), headers=HEADERS)
    _error_ok(contracts, response, 403, "FORBIDDEN")


def test_inspect_mock_roundtrip(client, contracts, examples):
    response = client.post("/internal/v1/inspect", json=example(examples, "inspect request"), headers=HEADERS)
    assert response.status_code == 200 and response.headers["X-AI-Mode"] == "mock"
    assert response.json() == example(examples, "inspect response")
    assert contracts.violations("InspectionOutput", response.json()) == []


def test_extract_mock_roundtrip(client, contracts, examples, gold):
    request = example(examples, "extract request")
    response = client.post("/internal/v1/extract", json=request, headers=HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert (body["document_id"], body["case_id"], body["sha256"]) == (request["document_id"], request["case_id"], request["sha256"])
    assert body["provenance"]["model_id"].startswith("MOCK")
    assert contracts.violations("ExtractionOutput", body) == []


@pytest.mark.parametrize("index", [0, 1, 2])
def test_evaluate_mock_roundtrip_golden(client, contracts, gold, index):
    case = gold.golden_cases[index]
    response = client.post("/internal/v1/evaluate", json=case["input"], headers=HEADERS)
    assert response.status_code == 200
    assert response.json() == case["expected"]
    assert response.json()["provenance"]["model_id"] == "MOCK-GOLD-NOT-MODEL-OUTPUT"


def test_invalid_input_rejected_with_paths(client, contracts, examples):
    request = dict(example(examples, "inspect request"), sha256="not-a-hash", extra=1)
    body = _error_ok(contracts, client.post("/internal/v1/inspect", json=request, headers=HEADERS), 422, "INVALID_REQUEST")
    paths = {d["path"] for d in body["error"]["details"]}
    assert "/" in paths and "/sha256" in paths


def test_non_json_body_rejected(client, contracts):
    response = client.post("/internal/v1/evaluate", content=b"{not json", headers=HEADERS)
    _error_ok(contracts, response, 422, "INVALID_REQUEST")


def test_mock_does_not_invent_answers(client, contracts, gold):
    request = dict(gold.golden_cases[0]["input"], run_id=str(uuid.uuid4()))
    _error_ok(contracts, client.post("/internal/v1/evaluate", json=request, headers=HEADERS), 503, "PROVIDER_UNAVAILABLE")


def test_live_mode_never_falls_back_to_mock(live_client, contracts, examples, gold):
    for route, payload in (("inspect", example(examples, "inspect request")),
                           ("extract", example(examples, "extract request"))):
        response = live_client.post(f"/internal/v1/{route}", json=payload, headers=HEADERS)
        _error_ok(contracts, response, 503, "PROVIDER_UNAVAILABLE")


@pytest.mark.parametrize("index", [0, 1, 2])
def test_live_evaluate_runs_deterministic_rules(live_client, gold, index):
    from evaluation.compare import compare
    response = live_client.post("/internal/v1/evaluate", json=gold.golden_cases[index]["input"], headers=HEADERS)
    assert response.status_code == 200 and response.headers["X-AI-Mode"] == "live"
    assert response.json()["provenance"]["model_id"] == "deterministic-rules"
    assert compare(gold.golden_cases[index]["expected"], response.json()) == []


def _foreign_evidence(out):
    out["assessments"][0]["evidence_ids"].append(str(uuid.uuid4()))


def _human_status(out):
    out["assessments"][0]["human_status"] = "resolved"


TAMPERS = {
    "wrong echo": lambda out: out.update(case_revision=out["case_revision"] + 1),
    "foreign evidence (cross-case)": _foreign_evidence,
    "wrong issue uuid": lambda out: out["assessments"][0].update(issue_id=str(uuid.uuid4())),
    "assessment for other run": lambda out: out["assessments"][0].update(run_id=str(uuid.uuid4())),
    "existing issue not assessed": lambda out: out.update(assessments=[], request_suggestions=[]) or [r.update(issue_keys=[]) for r in out["rule_results"]],
    "duplicate rule": lambda out: out["rule_results"].__setitem__(4, dict(out["rule_results"][0])),
    "human_status leaked": _human_status,
}


@pytest.mark.parametrize("name", list(TAMPERS))
def test_semantic_guards_block_bad_model_output(contracts, gold, name):
    backend = TamperingBackend(gold, TAMPERS[name])
    app = create_app(make_settings(), backend=backend, contracts=contracts)
    response = TestClient(app).post("/internal/v1/evaluate", json=gold.golden_cases[1]["input"], headers=HEADERS)
    _error_ok(contracts, response, 422, "INVALID_MODEL_OUTPUT")


def test_service_has_no_database_or_callback_client(client):
    forbidden = {"sqlalchemy", "psycopg", "psycopg2", "asyncpg", "sqlite3", "requests"}
    assert forbidden.isdisjoint(m.split(".")[0] for m in sys.modules if m.startswith(("runner", *forbidden)))
