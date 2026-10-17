"""REC-AI: offline source-byte regressions, bounded typography, and fail-closed negatives.

External cases read the original six PDFs, never regenerate/copy them or change an oracle.
Set AIC_RECOVERY_PDF_DIR to their documents directory on another machine. An absent
default bundle is an explicit skip; an explicitly configured missing bundle is a failure.
Fake proposals exercise grounding only; these tests make no live-accuracy claim.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
import uuid

import pymupdf
import pytest

from extraction import Config, Service, grounding
from extraction.extractor import Extractor
from runner.guards import extraction_output_violations


SOURCES = {
    "DOC_REC_02_Acceptance_Matching.pdf": (1003216, "dc06ab8c243b915c47b9082c3dd722d0b7b420584923c25d542edfe4f2aa0419"),
    "DOC_REC_03_Acceptance_Mismatch.pdf": (1003149, "f0ce014e7a5f067da1986e8320ce1bd0ed4fe269a11d530454103a0e98cbdd10"),
    "DOC_REC_04_Contract_Role_Inversion.pdf": (1002656, "a760d1272e0eb1d7890190d756f1ac05bb9f8e1471a612f4fddbefdfba008a17"),
    "DOC_PRE_01_Contract_Prepayment.pdf": (1003359, "6fb67ef4d583becf4a0ab403a59217dfcbac511fecb26add52f0050b5d831f42"),
    "DOC_PRE_02_Payment_Record_Valid.pdf": (1003177, "1000cc4ff14fe7dbcd735e2fce36a8045ab979021d03ee885d6ca15c89d80301"),
    "DOC_PRE_03_Payment_Record_Ambiguous.pdf": (1003079, "7a8f71e81a886834c028e9d5a57f7cbedb9892307c09fddb92a17f5d16014d8d"),
}
DATES = [
    ("DOC_REC_02_Acceptance_Matching.pdf", "acceptance.date", "2026-10-15"),
    ("DOC_REC_03_Acceptance_Mismatch.pdf", "acceptance.date", "2026-10-18"),
    ("DOC_PRE_02_Payment_Record_Valid.pdf", "payment.date", "2026-10-16"),
    ("DOC_PRE_03_Payment_Record_Ambiguous.pdf", "payment.date", "2026-10-17"),
]
ROLES = [
    ("DOC_PRE_01_Contract_Prepayment.pdf", "parties.borrower.tax_id", "0309988776"),
    ("DOC_PRE_01_Contract_Prepayment.pdf", "parties.counterparty.tax_id", "0301122334"),
    ("DOC_PRE_02_Payment_Record_Valid.pdf", "parties.payer.tax_id", "0301122334"),
    ("DOC_PRE_02_Payment_Record_Valid.pdf", "parties.payee.tax_id", "0309988776"),
]
DUAL_ROLES = [
    ("parties.borrower.tax_id", "0109876543"),
    ("parties.counterparty.tax_id", "0102030405"),
]
REFS = [
    ("DOC_PRE_02_Payment_Record_Valid.pdf", "UNC20261016-01"),
    ("DOC_PRE_03_Payment_Record_Ambiguous.pdf", "UNC-AMB-01"),
]


@pytest.fixture(scope="module")
def originals():
    configured = os.environ.get("AIC_RECOVERY_PDF_DIR")
    root = Path(configured) if configured else (
        Path.home() / "Desktop/AIC-MVP-Audit-v0.4.0-20261017/agent-03/ai-acceptance-preparation/documents")
    if not root.is_dir() and not configured:
        pytest.skip("REC-AI original external PDF bundle unavailable; portable negatives still run")
    assert root.is_dir(), "Explicit AIC_RECOVERY_PDF_DIR must exist"
    manifest = json.loads((root.parent / "ground-truth/manifest.json").read_text("utf-8"))
    entries = {d["filename"]: d for d in manifest["documents"]}
    texts = {}
    for name, (size, sha) in SOURCES.items():
        data = (root / name).read_bytes()
        assert len(data) == size == entries[name]["bytes"]
        assert hashlib.sha256(data).hexdigest() == sha == entries[name]["sha256"]
        with pymupdf.open(stream=data, filetype="pdf") as pdf:
            assert len(pdf) == 1
            texts[name] = pdf[0].get_text()
    return root, texts


@pytest.fixture
def registry(contracts):
    return grounding.Registry.from_json(contracts.load("field-registry.json"))


def span_for(text, quote):
    span = grounding.find_quote(1, text, quote, grounding.injection_spans(text))
    assert span is not None
    assert text[span.start:span.end] == quote == span.text
    return span


def checked_source(key, value, text, quote, registry, value_type="string"):
    span = span_for(text, quote)
    checked = grounding.check_value(key, value_type, value, span.text, registry)
    if checked.value is None:
        return checked
    return grounding.check_source(key, value_type, checked.value, [span], [text], registry)


@pytest.mark.parametrize("name,key,value", DATES)
def test_original_iso_date(originals, registry, name, key, value):
    text = originals[1][name]
    quote = next(line for line in text.splitlines() if line.startswith("Ngày"))
    assert "\u2010" in quote
    assert checked_source(key, value, text, quote, registry) == grounding.Checked(value)


@pytest.mark.parametrize("name,key,value", ROLES)
def test_original_unicode_role_heading(originals, registry, name, key, value):
    text = originals[1][name]
    quote = next(line for line in text.splitlines() if value in line)
    assert "\ufd3e" in quote and "\ufd3f" in quote
    ascii_text = text.replace("\ufd3e", "(").replace("\ufd3f", ")")
    ascii_quote = quote.replace("\ufd3e", "(").replace("\ufd3f", ")")
    assert checked_source(key, value, ascii_text, ascii_quote, registry) == grounding.Checked(value)
    assert checked_source(key, value, text, quote, registry) == grounding.Checked(value)
    opposite = key.replace("borrower", "counterparty") if "borrower" in key else (
        key.replace("counterparty", "borrower") if "counterparty" in key else (
            key.replace("payer", "payee") if "payer" in key else key.replace("payee", "payer")))
    assert checked_source(opposite, value, text, quote, registry).problem == "UNVERIFIED_FIELD_ROLE"


@pytest.mark.parametrize("key,value", DUAL_ROLES)
def test_original_rec04_dual_roles_remain_blocked(originals, registry, key, value):
    """ASCII equivalent already fails: resolving this requires a separate role-policy decision."""
    text = originals[1]["DOC_REC_04_Contract_Role_Inversion.pdf"]
    quote = next(line for line in text.splitlines() if value in line)
    for source, q in [(text, quote), (text.replace("\ufd3e", "(").replace("\ufd3f", ")"),
                                     quote.replace("\ufd3e", "(").replace("\ufd3f", ")"))]:
        assert checked_source(key, value, source, q, registry).problem == "UNVERIFIED_FIELD_ROLE"


@pytest.mark.parametrize("name,value", REFS)
def test_original_unc_document_number(originals, registry, name, value):
    text = originals[1][name]
    quote = next(line for line in text.splitlines() if line.startswith("Số chứng từ:"))
    assert checked_source("payment.ref", value, text, quote, registry) == grounding.Checked(value)
    assert checked_source("payment.status", "completed", text, quote, registry).value is None


def extract_proposals(contracts, root, name, doc_type, proposals):
    """Unproposed slots are test placeholders, not a whole-document absence oracle."""
    fields = [{"field_key": spec["field_key"], "status": "not_present", "value": None,
               "payment_condition": None, "evidence": []}
              for spec in grounding.Registry.from_json(contracts.load("field-registry.json")).fields(doc_type)]
    for field in fields:
        if field["field_key"] in proposals:
            value, quote = proposals[field["field_key"]]
            field.update(status="found", value=value, evidence=[{"page": 1, "quote": quote}])
    answer = {"detected_type": doc_type, "classification_confident": True, "fields": fields}

    class OfflineProposals:
        model_id = "REC-AI-OFFLINE-PROPOSALS-NOT-LIVE"

        def generate_json(self, *args, **kwargs):
            return SimpleNamespace(data=answer)

    request = {"schema_version": "1.0.2", "case_id": str(uuid.uuid5(uuid.NAMESPACE_URL, "rec-ai-offline")),
               "document_id": str(uuid.uuid5(uuid.NAMESPACE_URL, name)), "type": doc_type,
               "storage_key": name, "sha256": SOURCES[name][1]}
    service = Service(Config(storage_dir=root, ocr_engine="none"),
                      lambda: Extractor(contracts, OfflineProposals(), None))
    output = service.extract(request)
    assert not contracts.violations("ExtractionOutput", output)
    assert not extraction_output_violations(request, output)
    assert output["schema_version"] == output["provenance"]["schema_version"] == "1.0.2"
    assert output["provenance"]["prompt_version"] == "extraction-v2"
    assert output["sha256"] == SOURCES[name][1]
    assert output["fields"] == service.extract(request)["fields"]
    assert output["evidence"] == service.extract(request)["evidence"]
    return output


@pytest.mark.parametrize("name", list(SOURCES))
def test_originals_through_extraction_preserve_source(contracts, originals, name):
    root, texts = originals
    text = texts[name]
    doc_type = "contract" if name.startswith(("DOC_REC_04", "DOC_PRE_01")) else (
        "acceptance_record" if name.startswith("DOC_REC") else "payment_record")
    proposals = {}
    for n, key, value in DATES + ROLES:
        if n == name:
            quote = next(line for line in text.splitlines() if (
                line.startswith("Ngày") if key.endswith(".date") else value in line))
            proposals[key] = value, quote
    for n, value in REFS:
        if n == name:
            proposals["payment.ref"] = value, next(line for line in text.splitlines() if line.startswith("Số chứng từ:"))
    if name.startswith("DOC_REC_04"):
        proposals.update({key: (value, next(line for line in text.splitlines() if value in line))
                          for key, value in DUAL_ROLES})
    if name.startswith("DOC_PRE_03"):
        proposals["payment.status"] = "completed", next(line for line in text.splitlines() if line.startswith("Trạng thái"))
        # The payer's ID cannot establish the unnamed corporate payee.
        proposals["parties.payee.tax_id"] = "0301122334", next(line for line in text.splitlines() if "0301122334" in line)
    output = extract_proposals(contracts, root, name, doc_type, proposals)
    assert output["pages"][0]["text"] == text
    evidence = {e["id"]: e for e in output["evidence"]}
    fields = {f["field_key"]: f for f in output["fields"]}
    for key, (value, quote) in proposals.items():
        field = fields[key]
        rejected = name.startswith("DOC_REC_04") or (
            name.startswith("DOC_PRE_03") and key in ("payment.status", "parties.payee.tax_id"))
        assert (field["value"], field["quality"], field["missing_reason"]) == (
            (None, "uncertain", "ambiguous") if rejected else (value, "readable", None))
        assert field["raw_value"] == quote
        assert field["evidence_ids"]
        for ev_id in field["evidence_ids"]:
            ev = evidence[ev_id]
            assert ev["quote"] == quote and ev["page"] == 1
            assert ev["document_id"] == output["document_id"]
            assert ev["quote"] in text
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == SOURCES[name][1]


@pytest.mark.parametrize("quote,value,problem", [
    ("Ngày giao dịch: 2026‐10‐16", "2026-10-17", "VALUE_NOT_IN_QUOTE"),
    ("Ngày giao dịch: 2026‐05‐10", "2026-10-05", "VALUE_NOT_IN_QUOTE"),
    ("Ngày giao dịch: 2026‐02‐30", "2026-02-28", "VALUE_NOT_IN_QUOTE"),
    ("Ngày giao dịch: 2026‐02‐30", "2026-02-30", "UNPARSEABLE_DATE"),
    ("Ngày giao dịch: 2026‐10‐16 hoặc 2026-10-17", "2026-10-16", "AMBIGUOUS_DATE"),
    ("Ngày giao dịch: 2026‐10‐16 hoặc 2026-10-17", "2026-10-17", "AMBIGUOUS_DATE"),
    ("Ngày giao dịch: 2026‐10", "2026-10-16", "VALUE_NOT_IN_QUOTE"),
    ("Ngày giao dịch: 2026−10−16", "2026-10-16", "VALUE_NOT_IN_QUOTE"),
    ("Ngày giao dịch: 16‐10‐2026", "2026-10-16", "VALUE_NOT_IN_QUOTE"),
])
def test_iso_date_negatives(registry, quote, value, problem):
    checked = checked_source("payment.date", value, quote, quote, registry)
    assert checked.value is None and checked.problem == problem


@pytest.mark.parametrize("quote", ["Ngày giao dịch: 2026-10-16", "Ngày giao dịch: 2026‐10‐16",
                                  "Ngày giao dịch: 2026‐10-16", "Ngày giao dịch: 16/10/2026"])
def test_date_comparison_preserves_quote(registry, quote):
    span = span_for(quote, quote)
    assert checked_source("payment.date", "2026-10-16", quote, quote, registry).value == "2026-10-16"
    assert span.text == quote


@pytest.mark.parametrize("label", [
    "Bên A ﴾Bên B﴿", "Đơn vị tư vấn ﴾Bên A﴿", "Bên bán ﴾Bên mua﴿",
    "Bên nhận ﴾Bên chuyển﴿", "Bên mua ﴾bên trả tiền﴿", "Bên bán ﴾bên nhận tiền﴿",
    "Ghi chú bên bán ﴾Bên A﴿",
])
def test_unicode_heading_does_not_infer_a_role(registry, label):
    text = f"{label}: Công ty kiểm thử. Mã số thuế: 0000000001"
    for key in ("parties.borrower.tax_id", "parties.counterparty.tax_id", "parties.payer.tax_id", "parties.payee.tax_id"):
        assert checked_source(key, "0000000001", text, text, registry).problem == "UNVERIFIED_FIELD_ROLE"


@pytest.mark.parametrize("tail", [
    "Đơn vị tư vấn: Công ty kiểm thử. Mã số thuế: 0000000001",
    "Bên A ﴾Bên B﴿: Công ty kiểm thử. Mã số thuế: 0000000001",
])
def test_unicode_heading_does_not_inherit_previous_role(registry, tail):
    text = "Bên bán ﴾Bên B﴿: Công ty khác.\n" + tail
    assert checked_source("parties.borrower.tax_id", "0000000001", text, tail, registry).problem == "UNVERIFIED_FIELD_ROLE"


@pytest.mark.parametrize("quote,value", [
    ("Số chứng từ: HD-01", "HD-01"),
    ("Số chứng từ: 2026101601", "2026101601"),
    ("Số chứng từ: INV-01. Ghi chú UNC-01", "UNC-01"),
    ("Số chứng từ: UNC-01. Hợp đồng tham chiếu: HD-01", "HD-01"),
    ("Số chứng từ: UNC-01", "UNC-02"),
    ("Số chứng từ: UNC-010", "UNC-01"),
    ("Số chứng từ: UNC-01, HD-01", "HD-01"),
    ("Số chứng từ: UNC-01 hoặc UNC-02", "UNC-02"),
    ("Số chứng từ: UNCERTAIN", "UNCERTAIN"),
    ("Không có số chứng từ: UNC-01", "UNC-01"),
])
def test_document_number_not_an_arbitrary_payment_reference(registry, quote, value):
    assert checked_source("payment.ref", value, quote, quote, registry).value is None


@pytest.mark.parametrize("status", ["chưa thanh toán", "đang chờ đối soát ngân hàng", "thất bại",
                                    "đã thanh toán là không đúng", "nếu đã thanh toán thì gửi chứng từ"])
def test_unc_reference_does_not_verify_payment(registry, status):
    quote = f"Số chứng từ: UNC-01. Trạng thái giao dịch: {status}."
    assert checked_source("payment.status", "completed", quote, quote, registry).value is None


@pytest.mark.parametrize("source,altered", [
    ("Ngày giao dịch: 2026‐10‐16", "Ngày giao dịch: 2026-10-16"),
    ("Bên bán ﴾Bên B﴿: Demo", "Bên bán (Bên B): Demo"),
    ("Số chứng từ: UNC20261016‐01", "Số chứng từ: UNC20261016-01"),
])
def test_comparison_normalization_cannot_fabricate_evidence(source, altered):
    assert grounding.find_quote(1, source, altered, []) is None
    span = span_for(source, source)
    assert (span.page, span.start, span.end, span.text) == (1, 0, len(source), source)
    assert grounding.find_quote(1, source, source, [(0, len(source))]) is None
    assert grounding.find_quote(2, "Trang khác", source, []) is None


def test_typography_change_does_not_change_financial_sign_or_scale(registry):
    quote = "Giá trị hợp đồng: (1 tỷ 500 triệu) VND. Ngày 2026‐10‐16."
    checked = grounding.check_value("contract.amount", "decimal", "-1500000000", quote, registry)
    assert (checked.value, checked.quality, checked.problem) == ("-1500000000", "uncertain", "NEGATIVE_AMOUNT")
    assert grounding.check_value("contract.amount", "decimal", "1500000000", quote, registry).value is None
    assert grounding.check_value("contract.amount", "decimal", "1000000000", quote, registry).value is None
