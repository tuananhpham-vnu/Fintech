from fastapi.testclient import TestClient

from main import app
from scenarios import EXAMPLES

client = TestClient(app)

EXPECTED_ISSUE = {
    "sao-mai-1": "R08", "sao-mai-2": "R10", "missing-fs": "R01", "fs-wrong-year": "R04", "fs-imbalance": "R05",
    "tax-mismatch": "R02", "received-no-proof": "R09", "received-partial": "R09", "invoice-twice": "R06",
    "invoice-over": "R07",
}


def _run(example_id: str) -> dict:
    return client.post(f"/api/v1/demo/examples/{example_id}/run").json()


def test_pages_and_health():
    assert client.get("/healthz").json() == {"status": "ok"}
    assert "Kiểm tra hồ sơ" in client.get("/").text
    assert "Bàn rà soát" in client.get("/advanced").text
    for asset in ("common.js", "simple.js", "advanced.js", "styles.css"):
        assert client.get(f"/static/{asset}").status_code == 200, asset


def test_rules_listed_before_any_run():
    rules = client.get("/api/v1/rules").json()
    assert [r["rule_id"] for r in rules] == [f"R{i:02d}" for i in range(1, 11)]


def test_examples_listed_with_form_and_story_chain():
    examples = {e["id"]: e for e in client.get("/api/v1/demo/examples").json()}
    assert len(examples) == len(EXAMPLES)
    assert examples["sao-mai-1"]["next_id"] == "sao-mai-2"
    assert examples["sao-mai-1"]["form"]["tax_id"] == "0000000001"


def test_every_example_runs_all_rules_and_shows_intended_issue():
    for example in EXAMPLES:
        output = _run(example.id)["output"]
        assert len(output["coverage"]) == 10 and output["status"] == "completed", example.id
        assert output["input_issues"] == [], example.id
        rule = EXPECTED_ISSUE.get(example.id)
        if rule:
            assert any(f["issue_key"].startswith(rule) for f in output["findings"]), example.id


def test_clean_and_story_end_have_no_findings():
    assert _run("clean")["output"]["findings"] == []
    final = _run("sao-mai-3")["output"]
    assert final["findings"] == []
    assert final["resolutions"][0]["proposal"] == "candidate_resolved"


def test_simple_form_check_and_field_error():
    form = client.get("/api/v1/demo/examples").json()[0]["form"]
    form.update(has_financials=False)
    output = client.post("/api/v1/demo/check", json=form).json()["output"]
    assert any(f["issue_key"].startswith("R01") for f in output["findings"])

    bad = client.post("/api/v1/demo/check", json=dict(form, total_assets="một nghìn"))
    assert bad.status_code == 422
    assert bad.json()["error"]["details"]["field"] == "total_assets"


def test_analyze_roundtrip_and_errors():
    demo = _run("sao-mai-3")
    assert client.post("/api/v1/analyze", json=demo["input"]).json() == demo["output"]
    assert client.post("/api/v1/analyze", json={"snapshot": {}}).json()["error"]["code"] == "INVALID_INPUT"
    assert client.post("/api/v1/demo/examples/khong-co/run").status_code == 404
    too_big = client.post("/api/v1/analyze", content=b"x" * 1_000_001, headers={"content-type": "application/json"})
    assert too_big.status_code == 413
