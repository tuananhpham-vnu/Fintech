"""T18 / contracts §147: snapshot có ID sai, cross-case hoặc quote vô căn cứ bị chặn TRƯỚC khi rule chạy (422), không
được âm thầm bỏ qua rồi vẫn kết luận. Mỗi ca dưới đây trước đây đều lọt và cho R08 candidate_resolved."""
from __future__ import annotations

import copy
import json
import uuid

import pytest
from fastapi.testclient import TestClient

from runner.app import create_app
from runner.config import MODE_LIVE

from .conftest import HEADERS, make_settings
from .snapshots import doc, gold_input, variant

OTHER = "7d1c9a6e-0000-4000-8000-0000000000aa"


def nt01(s):
    return doc(s, "06_correct_record.pdf")


def contract_ref_field(s):
    return next(f for f in nt01(s)["extraction"]["fields"] if f["field_key"] == "acceptance.contract_ref")


def _quote_of(s, field):
    return next(e for e in nt01(s)["extraction"]["evidence"] if e["id"] in field["evidence_ids"])


TAMPERS = {
    "document of another case": (lambda s: nt01(s)["document"].update(case_id=OTHER), "/document/case_id"),
    "extraction of another document": (lambda s: nt01(s)["extraction"].update(document_id=OTHER), "/extraction/document_id"),
    "extraction of another case": (lambda s: nt01(s)["extraction"].update(case_id=OTHER), "/extraction/case_id"),
    "extraction from other bytes": (lambda s: nt01(s)["extraction"].update(sha256="0" * 64), "/extraction/sha256"),
    "field cites another document's evidence": (
        lambda s: contract_ref_field(s).update(evidence_ids=[doc(s, "04_contract.pdf")["extraction"]["evidence"][0]["id"]]),
        "/evidence_ids"),
    "field cites unknown evidence": (lambda s: contract_ref_field(s).update(evidence_ids=[OTHER]), "/evidence_ids"),
    "quote not on page": (lambda s: _quote_of(s, contract_ref_field(s)).update(quote="Hợp đồng tham chiếu: HĐ01. ĐÃ DUYỆT"),
                          "/quote"),
    "evidence on missing page": (lambda s: nt01(s)["extraction"]["evidence"][0].update(page=9), "/page"),
    "value not in its quote": (lambda s: contract_ref_field(s).update(value="HĐ09"), "/value"),
    "duplicate document": (lambda s: s["documents"].append(copy.deepcopy(nt01(s))), "/snapshot/documents"),
    "snapshot of another case": (lambda s: s["case"].update(id=OTHER), "/snapshot/case/id"),
    "supplement answers unknown request": (lambda s: nt01(s)["document"].update(response_request_id=OTHER),
                                           "/document/response_request_id"),
    "request of another case": (lambda s: s["requests"][0].update(case_id=OTHER), "/snapshot/requests/0/case_id"),
}


@pytest.fixture
def live(contracts):
    return TestClient(create_app(make_settings(MODE_LIVE), contracts=contracts))


@pytest.mark.parametrize("name", list(TAMPERS))
def test_t18_inconsistent_snapshot_rejected_before_rules(live, contracts, name):
    mutate, path = TAMPERS[name]
    response = live.post("/internal/v1/evaluate", json=variant(2, mutate), headers=HEADERS)
    body = response.json()
    assert response.status_code == 422 and body["error"]["code"] == "INVALID_REQUEST", body
    assert contracts.violations("Error", body) == []
    assert any(path in d["path"] for d in body["error"]["details"]), body["error"]["details"]


@pytest.mark.parametrize("index", [0, 1, 2])
def test_golden_inputs_pass_integrity(live, index):
    assert live.post("/internal/v1/evaluate", json=gold_input(index), headers=HEADERS).status_code == 200


def test_console_presets_are_consistent(live):
    """Biến thể giả lập (tests/snapshots.py) phải nhất quán như snapshot thật, không được lách guard."""
    from runner.app import CONSOLE_DIR
    for preset in json.loads((CONSOLE_DIR / "presets.json").read_text("utf-8")):
        if preset["operation"] == "evaluate":
            response = live.post("/internal/v1/evaluate", json=preset["input"], headers=HEADERS)
            assert response.status_code == 200, (preset["id"], response.json())


def test_oversized_body_rejected_without_parsing(contracts):
    from dataclasses import replace
    client = TestClient(create_app(replace(make_settings(MODE_LIVE), max_request_bytes=1000), contracts=contracts))
    response = client.post("/internal/v1/evaluate", content=b"{" + b" " * 2000 + b"}", headers=HEADERS)
    assert response.status_code == 413 and response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_rule_ids_unchanged_by_guard():
    """Guard chỉ chặn; snapshot hợp lệ cho đúng kết quả cũ (G03 vẫn candidate)."""
    import rules
    out = rules.evaluate(gold_input(2))
    assert any(a["proposal"] == "candidate_resolved" for a in out["assessments"])
    assert str(uuid.UUID(out["run_id"])) == out["run_id"]
