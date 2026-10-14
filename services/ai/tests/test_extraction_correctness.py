"""Financial guard regressions: synthetic PDFs and fake providers, never network calls."""
import pytest

from extraction import grounding
from . import test_extraction as t
from .test_extraction import storage  # shared synthetic-storage fixture


def extract_fields(contracts, storage, kind, text, *entries):
    t.text_pdf(storage / "adversarial.pdf", text)
    overrides = {entry["field_key"]: entry for entry in entries}
    fields = [overrides.get(spec["field_key"], t.field(spec["field_key"], status="not_present"))
              for spec in contracts.load("field-registry.json")["document_types"][kind]]
    request = t.extract_request(storage, "adversarial.pdf", kind)
    out = t.make_service(contracts, storage, model=t.FakeModel(t.answer(fields, kind))).extract(request)
    t.assert_valid(contracts, request, out)
    return out


@pytest.mark.parametrize("value,quote,expected,quality", [
    ("500", "Giá trị: 500 triệu VND", None, "uncertain"),
    ("500000", "Giá trị: 500 nghìn VND", "500000", "readable"),
    ("500000000", "Giá trị: 500 triệu VND", "500000000", "readable"),
    ("500000000000", "Giá trị: 500 tỷ VND", "500000000000", "readable"),
    ("500", "Giá trị: -500 VND", None, "uncertain"),
    ("500", "Giá trị: (500 VND)", None, "uncertain"),
    ("-500", "Giá trị: -500 VND", "-500", "uncertain"),
    ("-500", "Giá trị: (500) VND", "-500", "uncertain"),
    ("-500000000", "Giá trị: −500 triệu VND", "-500000000", "uncertain"),
    ("500", "Amount: (USD 500)", None, "uncertain"),
    ("-500", "Amount: (USD 500)", "-500", "uncertain"),
    ("-500", "Amount: USD (500)", "-500", "uncertain"),
    ("500", "Amount: ($500)", None, "uncertain"),
    ("-500", "Amount: ($500)", "-500", "uncertain"),
    ("1", "Amount: 1,000 USD", "1", "uncertain"),
    ("1000", "Amount: 1,000 USD", "1000", "uncertain"),
    ("1500000.5", "Amount: 1,500,000.50 USD", "1500000.5", "readable"),
    ("1500000.5", "Giá trị: 1.500.000,50 VND", "1500000.5", "readable"),
    ("1500000.5", "Giá trị: 1 500 000,50 VND", "1500000.5", "readable"),
    ("123456", "Giá trị: 1,23,456 VND", None, "uncertain"),
])
def test_complete_monetary_expression(contracts, value, quote, expected, quality):
    registry = grounding.Registry.from_json(contracts.load("field-registry.json"))
    checked = grounding.check_value("contract.amount", "decimal", value, quote, registry)
    assert (checked.value, checked.quality) == (expected, quality)


@pytest.mark.parametrize("source,quote", [
    ("Giá trị hợp đồng: 500 triệu VND.", "500"),
    ("Giá trị hợp đồng: -500 VND.", "500 VND"),
    ("Giá trị hợp đồng: (500) VND.", "500"),
])
def test_cropped_amount_cannot_lose_unit_or_sign(contracts, storage, source, quote):
    out = extract_fields(contracts, storage, "contract", source, t.field("contract.amount", "500", quote))
    assert t.by_key(out)["contract.amount"]["value"] is None


@pytest.mark.parametrize("kind,key,source,quote,value,expected", [
    ("payment_record", "payment.status", "Giao dịch không thành công.", "thành công", "completed", None),
    ("payment_record", "payment.status", "Chưa xác nhận khách hàng đã thanh toán.", "đã thanh toán", "completed", None),
    ("payment_record", "payment.status", "Giao dịch thất bại, không thành công.", "thành công", "completed", None),
    ("payment_record", "payment.status", "Giao dịch thành công nhưng sau đó bị hoàn trả.", "thành công", "completed", None),
    ("payment_record", "payment.status", "Dự kiến thanh toán ngày 05/10/2026.", "thanh toán", "completed", None),
    ("payment_record", "payment.status", "Trạng thái: chưa thanh toán.", "chưa thanh toán", "pending", "pending"),
    ("payment_record", "payment.status", "Trạng thái: đang xử lý.", "đang xử lý", "pending", "pending"),
    ("payment_record", "payment.status", "Trạng thái: đã thanh toán thành công.", "thành công", "completed", "completed"),
    ("loan_request", "receipt.claim_type", "Dự kiến thu 500000000 VND.", "Dự kiến thu", "expected", "expected"),
    ("loan_request", "receipt.claim_type", "Chưa xác nhận khách hàng đã nhận tiền.", "đã nhận tiền", "received", None),
    ("loan_request", "receipt.claim_type", "Đã nhận tiền 500000000 VND.", "Đã nhận tiền", "received", "received"),
])
def test_status_uses_surrounding_source(contracts, storage, kind, key, source, quote, value, expected):
    out = extract_fields(contracts, storage, kind, source, t.field(key, value, quote))
    assert t.by_key(out)[key]["value"] == expected


def test_party_roles_cannot_be_swapped(contracts, storage):
    fields = t.contract_fields()
    borrower, counterparty = fields[1:3]
    borrower["value"], counterparty["value"] = counterparty["value"], borrower["value"]
    borrower["evidence"], counterparty["evidence"] = counterparty["evidence"], borrower["evidence"]
    out = t.make_service(contracts, storage, model=t.FakeModel(t.answer(fields))).extract(t.extract_request(storage))
    assert t.by_key(out)["parties.borrower.tax_id"]["value"] is None
    assert t.by_key(out)["parties.counterparty.tax_id"]["value"] is None
    assert t.by_key(out)["contract.amount"]["value"] == "500000000"


@pytest.mark.parametrize("key,value,source,quote,expected", [
    ("contract.ref", "HĐ0", "Hợp đồng số: HĐ01.", "HĐ01", None),
    ("contract.ref", "HĐ01", "Hợp đồng số: HĐ01-A.", "HĐ01", None),
    ("contract.ref", "HĐ01-A", "Hợp đồng số: HĐ01-A.", "HĐ01-A", "HĐ01-A"),
    ("contract.ref", "HĐ01-A", "Hợp đồng số: HĐ01–A.", "HĐ01–A", "HĐ01-A"),
    ("contract.scope_ref", "S1", "Phạm vi: S10.", "S10", None),
    ("parties.borrower.tax_id", "0000000002", "Bên mua: Demo. Mã số thuế: 0000000002", "0000000002", None),
    ("parties.borrower.tax_id", "0000000001", "Bên cung cấp: Demo. Mã số thuế: 0000000001", "0000000001", "0000000001"),
    ("parties.borrower.tax_id", "0000000001-001", "Bên cung cấp: Demo. MST: 0000000001 – 001", "0000000001 – 001", "0000000001-001"),
    ("parties.borrower.tax_id", "0000000001", "Mã số thuế: 0000000001", "0000000001", None),
])
def test_roles_and_whole_identifiers(contracts, storage, key, value, source, quote, expected):
    out = extract_fields(contracts, storage, "contract", source, t.field(key, value, quote))
    assert t.by_key(out)[key]["value"] == expected


@pytest.mark.parametrize("value,expected", [("1000", None), ("600", "600")])
def test_financial_amount_bound_to_label(contracts, storage, value, expected):
    text = "Tổng tài sản: 1000. Nợ phải trả: 600. Vốn chủ sở hữu: 400."
    out = extract_fields(contracts, storage, "financial_statement", text,
                         t.field("financial.liabilities", value, text))
    assert t.by_key(out)["financial.liabilities"]["value"] == expected


@pytest.mark.parametrize("value,expected", [("500", None), ("500000000", "500000000")])
def test_fee_does_not_replace_contract_amount(contracts, storage, value, expected):
    text = "Giá trị hợp đồng: 500 triệu VND, phí 500 VND."
    out = extract_fields(contracts, storage, "contract", text, t.field("contract.amount", value, text))
    assert t.by_key(out)["contract.amount"]["value"] == expected


@pytest.mark.parametrize("value,quote,expected", [
    ("2026-10-05", "05/10/2026", None),
    ("2026-10-05", "Ngày lập: 05/10/2026. Ngày thanh toán: 06/10/2026.", None),
    ("2026-10-06", "06/10/2026", "2026-10-06"),
])
def test_date_bound_to_payment_label(contracts, storage, value, quote, expected):
    text = "Ngày lập: 05/10/2026. Ngày thanh toán: 06/10/2026."
    out = extract_fields(contracts, storage, "payment_record", text, t.field("payment.date", value, quote))
    assert t.by_key(out)["payment.date"]["value"] == expected


def test_ambiguous_payment_date_is_not_readable(contracts, storage):
    text = "Ngày thanh toán: 05/10/2026 hoặc 06/10/2026."
    out = extract_fields(contracts, storage, "payment_record", text,
                         t.field("payment.date", "2026-10-05", "05/10/2026"))
    assert t.by_key(out)["payment.date"]["value"] is None


@pytest.mark.parametrize("clause,changes,expected", [
    ("Thanh toán trong 30 ngày lịch sau xuất hóa đơn S1.", {}, False),
    ("Hợp đồng HĐ30. Thanh toán trong 45 ngày lịch sau nghiệm thu S1.", {}, False),
    ("Hợp đồng HĐ30. Thanh toán trong 45 ngày lịch sau nghiệm thu S1.", {"offset_days": 45}, True),
    ("Thanh toán trong 30 ngày lịch sau nghiệm thu S10.", {}, False),
    ("Thanh toán trong 30 ngày lịch sau xuất hóa đơn S1.", {"event_type": "other"}, True),
    ("Thanh toán trong 30 ngày lịch sau nghiệm thu S1.", {}, True),
])
def test_payment_event_offset_and_scope(contracts, storage, clause, changes, expected):
    text = clause + " Không tính ngày sự kiện; không có điều kiện thanh toán bổ sung."
    out = extract_fields(contracts, storage, "contract", text,
                         t.field("contract.payment_condition", None, text, condition=dict(t.CONDITION, **changes)))
    f = t.by_key(out)["contract.payment_condition"]
    assert (f["value"] is not None) == expected
    if not expected:
        assert f["quality"] == "uncertain" and f["raw_value"] and f["evidence_ids"]


def test_payment_other_conditions_cannot_be_invented(contracts, storage):
    text = "Thanh toán trong 30 ngày lịch sau nghiệm thu S1. Không tính ngày nghiệm thu."
    condition = dict(t.CONDITION, other_conditions_state="present", other_conditions=["Nộp bảo lãnh ngân hàng"])
    out = extract_fields(contracts, storage, "contract", text,
                         t.field("contract.payment_condition", None, text, condition=condition))
    assert t.by_key(out)["contract.payment_condition"]["value"] is None


@pytest.mark.parametrize("text,quote,changes", [
    ("Thanh toán trong 30 ngày làm việc sau nghiệm thu S1. Ngày lịch chỉ dùng cho bảo hành. "
     "Không tính ngày sự kiện; không có điều kiện thanh toán bổ sung.", None, {}),
    ("Thanh toán trong 30 ngày lịch sau nghiệm thu S1. Không tính cả ngày sự kiện; "
     "không có điều kiện thanh toán bổ sung.", None, {"counting_convention": "include_event_day"}),
    ("Thanh toán trong 30 ngày lịch sau nghiệm thu S1. Không tính ngày nghiệm thu; "
     "không có điều kiện thanh toán bổ sung. Ngoài ra phải nộp bảo lãnh ngân hàng.",
     "Thanh toán trong 30 ngày lịch sau nghiệm thu S1. Không tính ngày nghiệm thu; "
     "không có điều kiện thanh toán bổ sung.", {}),
])
def test_entire_payment_interpretation_is_grounded(contracts, storage, text, quote, changes):
    out = extract_fields(contracts, storage, "contract", text,
                         t.field("contract.payment_condition", None, quote or text,
                                 condition=dict(t.CONDITION, **changes)))
    assert t.by_key(out)["contract.payment_condition"]["value"] is None


def test_ocr_false_amount_remains_visible_but_uncertain(contracts, storage):
    t.scan_pdf(storage / "scan.pdf", storage / "04_contract.pdf")
    text = "Giá trị hợp đồng: 900000000 VND."
    fields = [t.field(spec["field_key"], status="not_present") for spec in
              contracts.load("field-registry.json")["document_types"]["contract"]]
    fields[3] = t.field("contract.amount", "900000000", text)
    request = t.extract_request(storage, "scan.pdf")
    out = t.make_service(contracts, storage, model=t.FakeModel(t.answer(fields)), ocr=t.FakeOcr(text)).extract(request)
    t.assert_valid(contracts, request, out)
    f = t.by_key(out)["contract.amount"]
    assert (f["value"], f["quality"], f["missing_reason"]) == ("900000000", "uncertain", "ambiguous")
    assert out["pages"][0]["method"] == "ocr" and out["provenance"]["ocr_version"] == "fake-ocr-1"
    assert out["evidence"][0]["quote"] == text and out["evidence"][0]["bbox"] is None
    assert any(d["code"] == "OCR_UNVERIFIED" and d["field_key"] == "contract.amount" for d in out["diagnostics"])


def test_ocr_fact_cannot_be_verified_by_unrelated_text_evidence(contracts, storage):
    import pymupdf
    t.scan_pdf(storage / "scan.pdf", storage / "04_contract.pdf")
    doc = pymupdf.open(storage / "04_contract.pdf")
    scan = pymupdf.open(storage / "scan.pdf")
    doc.insert_pdf(scan)
    (storage / "mixed.pdf").write_bytes(doc.tobytes())
    doc.close()
    scan.close()
    invented = "Giá trị hợp đồng: 900000000 VND."
    fields = t.contract_fields(**{"contract.amount": t.field("contract.amount", "900000000", invented, page=2)})
    # An unrelated genuine quote must not turn an OCR-only amount into a verified fact.
    fields[3]["evidence"].append({"page": 1, "quote": "Hợp đồng số: HĐ01. Phạm vi: S1."})
    request = t.extract_request(storage, "mixed.pdf")
    out = t.make_service(contracts, storage, model=t.FakeModel(t.answer(fields)), ocr=t.FakeOcr(invented)).extract(request)
    t.assert_valid(contracts, request, out)
    f = t.by_key(out)
    assert (f["contract.amount"]["value"], f["contract.amount"]["quality"]) == ("900000000", "uncertain")
    assert (f["contract.ref"]["value"], f["contract.ref"]["quality"]) == ("HĐ01", "readable")


@pytest.mark.parametrize("kind,key,value,text,quote", [
    ("contract", "contract.amount", "500", "Giá trị hợp đồng: 500 triệu VND.", "500"),
    ("payment_record", "payment.status", "completed", "Giao dịch không thành công.", "thành công"),
])
def test_financial_guards_through_live_api(contracts, storage, kind, key, value, text, quote):
    import extraction
    from fastapi.testclient import TestClient
    from runner.app import create_app
    from runner.config import MODE_LIVE
    from .conftest import make_settings, HEADERS

    t.text_pdf(storage / "api.pdf", text)
    fields = [t.field(spec["field_key"], status="not_present") for spec in
              contracts.load("field-registry.json")["document_types"][kind]]
    fields = [t.field(key, value, quote) if f["field_key"] == key else f for f in fields]
    extraction.configure(t.make_service(contracts, storage, model=t.FakeModel(t.answer(fields, kind))))
    try:
        with TestClient(create_app(make_settings(MODE_LIVE), contracts=contracts)) as client:
            request = t.extract_request(storage, "api.pdf", kind)
            response = client.post("/internal/v1/extract", json=request, headers=HEADERS)
        assert response.status_code == 200 and response.headers["X-AI-Mode"] == "live"
        t.assert_valid(contracts, request, response.json())
        f = t.by_key(response.json())[key]
        assert (f["value"], f["quality"]) == (None, "uncertain")
    finally:
        extraction.configure(None)
