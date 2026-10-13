from fastapi.testclient import TestClient

from main import app
from scenarios import SCENARIOS

client = TestClient(app)


def test_health_and_index():
    assert client.get("/healthz").json() == {"status": "ok"}
    assert "Bàn rà soát" in client.get("/").text
    assert client.get("/static/app.js").status_code == 200


def test_rules_listed_before_any_run():
    rules = client.get("/api/v1/rules").json()
    assert [r["rule_id"] for r in rules] == [f"R{i:02d}" for i in range(1, 11)]


def test_every_scenario_runs_all_rules():
    for scenario in SCENARIOS:
        body = client.post(f"/api/v1/demo/scenarios/{scenario.id}/run").json()
        assert len(body["output"]["coverage"]) == 10, scenario.id
        assert body["output"]["status"] == "completed"


def test_scenarios_show_intended_rule():
    expected = {"missing-fs": "R01", "tax-mismatch": "R02", "fs-imbalance": "R05", "received-unsupported": "R09",
                "duplicate-invoice": "R06", "invoice-exceeds": "R07", "sao-mai-1": "R08", "sao-mai-2": "R10"}
    for scenario_id, rule_id in expected.items():
        output = client.post(f"/api/v1/demo/scenarios/{scenario_id}/run").json()["output"]
        assert any(f["issue_key"].startswith(rule_id) for f in output["findings"]), scenario_id


def test_analyze_roundtrip_and_errors():
    demo = client.post("/api/v1/demo/scenarios/sao-mai-3/run").json()
    assert client.post("/api/v1/analyze", json=demo["input"]).json() == demo["output"]

    bad = client.post("/api/v1/analyze", json={"snapshot": {}})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_INPUT"
    assert client.post("/api/v1/demo/scenarios/khong-co/run").status_code == 404
    too_big = client.post("/api/v1/analyze", content=b"x" * 1_000_001, headers={"content-type": "application/json"})
    assert too_big.status_code == 413
