"""Opt-in diagnostic trace (extraction/trace.py): fake models only, trace file redirected to tmp_path."""
import json

import pymupdf
import pytest

from extraction import trace

from . import test_extraction as t
from .test_extraction import storage  # noqa: F401  (fixture)


@pytest.fixture
def trace_file(tmp_path, monkeypatch):
    path = tmp_path / "logs" / "trace.json"
    monkeypatch.setattr(trace, "PATH", path)
    monkeypatch.delenv(trace.ENV, raising=False)
    return path


def run(contracts, storage, *answers, key="04_contract.pdf"):
    model = t.FakeModel(*answers)
    return t.make_service(contracts, storage, model=model).extract(t.extract_request(storage, key)), model


def test_disabled_by_default(contracts, storage, trace_file):
    run(contracts, storage, t.answer(t.contract_fields()))
    assert not trace_file.exists()


@pytest.mark.parametrize("flag", ["0", "true", "yes", ""])
def test_only_exact_opt_in_value_enables(contracts, storage, trace_file, monkeypatch, flag):
    monkeypatch.setenv(trace.ENV, flag)
    run(contracts, storage, t.answer(t.contract_fields()))
    assert not trace_file.exists()


def test_restricted_to_canonical_fixture_hash(contracts, storage, trace_file, monkeypatch):
    monkeypatch.setenv(trace.ENV, "1")
    run(contracts, storage, t.answer(t.contract_fields(), "loan_request"), key="03_loan_request.pdf")
    assert not trace_file.exists()
    doc = pymupdf.open(storage / "04_contract.pdf")      # same text, different bytes -> different hash
    doc.set_metadata({"title": "copy"})
    (storage / "copy.pdf").write_bytes(doc.tobytes())
    run(contracts, storage, t.answer(t.contract_fields()), key="copy.pdf")
    assert not trace_file.exists()


def test_records_only_the_two_fields_and_no_document_text(contracts, storage, trace_file, monkeypatch, gold):
    monkeypatch.setenv(trace.ENV, "1")
    traced, model = run(contracts, storage, t.answer(t.contract_fields()))
    report = json.loads(trace_file.read_text("utf-8"))
    assert report["sha256"] == trace.FIXTURE_SHA256 and report["model_id"] == "fake-model-1"
    assert [a["attempt"] for a in report["attempts"]] == [1]
    assert set(report["attempts"][0]["proposals"]) == set(trace.FIELDS) == set(report["grounding"])
    borrower = report["grounding"]["parties.borrower.tax_id"]
    assert report["attempts"][0]["proposals"]["parties.borrower.tax_id"] == {
        "status": "found", "value": "0000000001",
        "evidence": [{"page": 1, "quote": "Bên cung cấp: Sao Mai Demo. Mã số thuế: 0000000001"}]}
    assert borrower["quotes_found_verbatim"] == [True]
    assert borrower["check_value"] == {"value": "0000000001", "quality": "readable", "problem": None}
    assert borrower["role_at_value"] == [{"page": 1, "role": "borrower"}]
    assert borrower["final"] == {"value": "0000000001", "quality": "readable", "missing_reason": None}

    raw = trace_file.read_text("utf-8")
    page_text = next(g for g in gold.extractions if g["document_id"] == t.DOC_ID)["pages"][0]["text"]
    for forbidden in (page_text, "500000000", "contract.amount", "payment_condition", "x-goog-api-key",
                      model.calls[0]["system"][:40], "<tai_lieu>"):
        assert forbidden not in raw

    trace_file.unlink()
    monkeypatch.delenv(trace.ENV)
    untraced, _ = run(contracts, storage, t.answer(t.contract_fields()))
    assert traced == untraced and not trace_file.exists()       # API output unchanged by tracing


def test_records_repair_attempt_and_rejection_reason(contracts, storage, trace_file, monkeypatch):
    monkeypatch.setenv(trace.ENV, "1")
    fields = t.contract_fields()
    borrower, counterparty = fields[1:3]                         # swap roles: both must be rejected by role check
    borrower["value"], counterparty["value"] = counterparty["value"], borrower["value"]
    borrower["evidence"], counterparty["evidence"] = counterparty["evidence"], borrower["evidence"]
    invalid = t.answer([f for f in fields if f["field_key"] != "contract.amount"])
    out, _ = run(contracts, storage, invalid, t.answer(fields))
    report = json.loads(trace_file.read_text("utf-8"))
    assert [a["attempt"] for a in report["attempts"]] == [1, 2]
    assert report["attempts"][0]["structural_violation_paths"] == ["/fields"]
    g = report["grounding"]["parties.borrower.tax_id"]
    assert g["check_value"]["value"] == "0000000002"             # the quote does contain the number ...
    assert g["check_source"] == {"value": None, "quality": "uncertain", "problem": "UNVERIFIED_FIELD_ROLE"}
    assert g["role_at_value"] == [{"page": 1, "role": "counterparty"}]   # ... but under the buyer heading
    assert g["final"] == {"value": None, "quality": "uncertain", "missing_reason": "ambiguous"}
    assert g["diagnostics"][0]["code"] == "UNGROUNDED_VALUE" and "UNVERIFIED_FIELD_ROLE" in g["diagnostics"][0]["message"]
    assert t.by_key(out)["parties.borrower.tax_id"]["value"] is None


def test_failed_extraction_still_writes_attempts(contracts, storage, trace_file, monkeypatch):
    monkeypatch.setenv(trace.ENV, "1")
    invalid = t.answer(t.contract_fields()[:-1])
    with pytest.raises(Exception):
        run(contracts, storage, invalid)
    report = json.loads(trace_file.read_text("utf-8"))
    assert report["error"] == "INVALID_MODEL_OUTPUT" and [a["attempt"] for a in report["attempts"]] == [1, 2]


def test_trace_location_is_gitignored():
    import subprocess
    relative = trace.PATH.relative_to(trace.PATH.parents[3])
    result = subprocess.run(["git", "check-ignore", "-q", str(relative)], cwd=trace.PATH.parents[3])
    if result.returncode not in (0, 1):
        pytest.skip("git not available")
    assert result.returncode == 0
