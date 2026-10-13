"""G0-T — consumer contract acceptance (Python side) cho Fintech Blueprint 1.0.2.

Chạy:  cd services/ai && ../../.venv/bin/python scripts/g0_consumer_check.py
Ghi:   evidence/g0-t-report.json (command, commit SHA, bundle/fixture hashes, versions, actual results).
Exit 0 chỉ khi mọi check owner-side PASS. Phần cần đối tác xác nhận được ghi NOT RUN, không tự đánh PASS.
"""
from __future__ import annotations

import hashlib
import json
import platform
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from openapi_spec_validator import validate as validate_openapi  # noqa: E402

from runner import dto  # noqa: E402
from runner.app import create_app  # noqa: E402
from runner.config import MODE_MOCK, Settings  # noqa: E402
from runner.contracts import Contracts  # noqa: E402

REPO = ROOT.parents[1]
BUNDLE = REPO / "docs" / "Fintech_Blueprint_1.0.2"
EXPECTED_ZIP_SHA256 = "11d7ae1fd2c30ee3287653859f122393fe22a4ce2538b8d3c76ffde6681217e3"
KEY = "g0-check-local-key"
results: list[dict] = []


def check(name: str, count: int | None = None):
    def wrap(fn):
        try:
            detail = fn()
            results.append({"check": name, "result": "PASS", "count": count, "detail": detail})
        except Exception as exc:  # ghi actual, không nuốt lỗi
            results.append({"check": name, "result": "FAIL", "count": count, "detail": f"{type(exc).__name__}: {exc}"})
        return fn
    return wrap


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


contracts = Contracts(REPO / "packages" / "contracts")
examples = contracts.load("examples.json")
vectors = contracts.load("validation-vectors.json")


FIXTURES = contracts.directory / "fixtures"


def _bundle_compare(prefix: str, sums: dict[str, str]) -> str:
    manifest = BUNDLE / "artifact-sha256.json"
    if not manifest.is_file():
        return "bundle folder not present locally; integrity checked against committed SHA256SUMS only"
    reference = json.loads(manifest.read_text("utf-8"))
    mismatched = [n for n, d in sums.items() if reference.get(f"{prefix}/{n}") != d]
    assert not mismatched, mismatched
    return "byte-identical to bundle artifact-sha256.json"


@check("packages/contracts == bundle 1.0.2", 6)
def _():
    return _bundle_compare("contracts", contracts.sha256sums)


@check("packages/contracts/fixtures (gold + 6 text PDFs) == bundle 1.0.2", 9)
def _():
    lines = (FIXTURES / "SHA256SUMS").read_text("utf-8").splitlines()
    sums = {name: digest for digest, name in (line.split(maxsplit=1) for line in lines)}
    drift = [n for n, d in sums.items() if sha256(FIXTURES / n) != d]
    assert len(sums) == 9 and not drift, drift
    return _bundle_compare("fixtures", sums)


@check("JSON Schema 2020-12 metaschema; named schemas", 52)
def _():
    assert len(contracts.defs) == 52
    return "Draft202012Validator.check_schema OK"


@check("internal-openapi 3.1 valid; components == canonical; 3 operations", 3)
def _():
    spec = contracts.load("internal-openapi.json")
    validate_openapi(spec)
    components = json.loads(json.dumps(spec["components"]["schemas"]).replace("#/components/schemas/", "#/$defs/"))
    assert components == contracts.defs
    ops = sorted(f"{m.upper()} {p}" for p, o in spec["paths"].items() for m in o)
    assert ops == ["POST /evaluate", "POST /extract", "POST /inspect"], ops
    return ops


@check("26 named examples valid (strict, format checks on)", 26)
def _():
    bad = {e["name"]: [v.as_detail() for v in contracts.violations(e["schema"], e["value"])] for e in examples}
    bad = {k: v for k, v in bad.items() if v}
    assert len(examples) == 26 and not bad, bad
    return "0 violations"


@check("unknown-field rejection on every example root", 26)
def _():
    accepted = [e["name"] for e in examples if not contracts.violations(e["schema"], dict(e["value"], unexpected=1))]
    assert not accepted, accepted
    return "26/26 rejected"


@check("validation vectors S01–S04 match expected", 4)
def _():
    actual = {v["id"]: ("REJECT" if contracts.violations(v["schema"], v["value"]) else "ACCEPT") for v in vectors}
    expected = {v["id"]: v["expected"] for v in vectors}
    assert actual == expected, actual
    return actual


@check("26 examples parse into generated Pydantic DTOs; unknown field rejected", 26)
def _():
    for e in examples:
        model = getattr(dto, e["schema"])
        model.model_validate(e["value"])
        try:
            model.model_validate(dict(e["value"], unexpected=1))
        except Exception:
            continue
        raise AssertionError(f"DTO accepted unknown field: {e['name']}")
    return "runner/dto.py generated from schemas.json"


settings = Settings(internal_api_key=KEY, mode=MODE_MOCK, model_id="", prompt_version="",
                    contracts_dir=contracts.directory, fixtures_dir=FIXTURES, gemini_key_configured=False)
client = TestClient(create_app(settings, contracts=contracts))
headers = {"X-Internal-Key": KEY}
by_name = {e["name"]: e["value"] for e in examples}
golden = json.loads((FIXTURES / "golden-cases.json").read_text("utf-8"))


@check("internal mock roundtrip POST /internal/v1/inspect", 1)
def _():
    r = client.post("/internal/v1/inspect", json=by_name["inspect request"], headers=headers)
    assert r.status_code == 200 and r.json() == by_name["inspect response"], (r.status_code, r.text[:300])
    return {"status": 200, "X-AI-Mode": r.headers["X-AI-Mode"]}


@check("internal mock roundtrip POST /internal/v1/extract", 1)
def _():
    r = client.post("/internal/v1/extract", json=by_name["extract request"], headers=headers)
    assert r.status_code == 200, r.text[:300]
    assert not contracts.violations("ExtractionOutput", r.json())
    return {"status": 200, "provenance.model_id": r.json()["provenance"]["model_id"]}


@check("internal mock roundtrip POST /internal/v1/evaluate G01–G03 == gold expected", 3)
def _():
    out = {}
    for name, case in zip(("G01", "G02", "G03"), golden):
        r = client.post("/internal/v1/evaluate", json=case["input"], headers=headers)
        assert r.status_code == 200 and r.json() == case["expected"], (name, r.status_code, r.text[:300])
        out[name] = [a["proposal"] for a in r.json()["assessments"]]
    return out


@check("error envelope + auth: missing key 403, invalid body 422, both schema-valid Error", 2)
def _():
    r1 = client.post("/internal/v1/inspect", json=by_name["inspect request"])
    r2 = client.post("/internal/v1/inspect", json={"schema_version": "1.0.2"}, headers=headers)
    assert (r1.status_code, r2.status_code) == (403, 422)
    assert not contracts.violations("Error", r1.json()) and not contracts.violations("Error", r2.json())
    return [r1.json()["error"]["code"], r2.json()["error"]["code"]]


def versions() -> dict:
    names = ["fastapi", "pydantic", "jsonschema", "openapi-spec-validator", "uvicorn"]
    return {"python": platform.python_version(), **{n: metadata.version(n) for n in names}}


def main() -> int:
    tz = timezone(timedelta(hours=7))
    zips = sorted(REPO.glob("**/Fintech_Blueprint_Handoff_1.0.2*.zip"))
    owner_pass = all(r["result"] == "PASS" for r in results)
    report = {
        "gate": "G0-T",
        "contract_version": "1.0.2",
        "ran_at": datetime.now(tz).isoformat(timespec="seconds"),
        "command": "cd services/ai && python scripts/g0_consumer_check.py",
        "commit_sha": git("rev-parse", "HEAD"),
        "working_tree_dirty": bool(git("status", "--porcelain")),
        "bundle": {
            "expected_zip_sha256": EXPECTED_ZIP_SHA256,
            "zip_sha256": sha256(zips[0]) if zips else None,
            "zip_note": None if zips else "ZIP not in repo; extracted folder verified file-by-file via artifact-sha256.json",
            "artifact_manifest_sha256": sha256(BUNDLE / "artifact-sha256.json") if BUNDLE.is_dir() else None,
            "contracts_sha256": contracts.sha256sums,
        },
        "fixture_hashes": {n: sha256(FIXTURES / n) for n in ("golden-cases.json", "extraction-gold.json", "manifest.json")},
        "environment": versions(),
        "checks": results,
        "partner_confirmation": {
            "Nguyên (reviewer; extraction import convention + payload)": "NOT RUN",
            "Đức (TypeScript import + backend consumer of EvaluationOutput)": "NOT RUN",
        },
        "result": ("PASS_OWNER_SIDE" if owner_pass else "FAIL"),
        "g0_status": "PENDING — needs partner confirmation and a commit SHA on a clean tree" if owner_pass else "FAIL",
        "limitations": [
            "Mock answers are bundle gold labelled MOCK-GOLD-NOT-MODEL-OUTPUT, not model output.",
            "No live provider, OCR or rule evaluator exercised (T13b/T14a).",
        ],
    }
    out = ROOT / "evidence" / "g0-t-report.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    for r in results:
        print(f"{r['result']:4}  {r['check']}")
    print(f"\n{report['result']} — {report['g0_status']}\nreport: {out.relative_to(REPO)}")
    return 0 if owner_pass else 1


if __name__ == "__main__":
    sys.exit(main())
