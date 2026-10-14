"""Codex round 2 regressions (A-D): synthetic PDFs and fake providers, never network calls."""
import pytest

from extraction import grounding
from . import test_extraction as t
from .test_extraction import storage  # noqa: F401  (fixture)
from .test_extraction_correctness import extract_fields


# ---------------------------------------------------------------- A: compound monetary expressions


@pytest.mark.parametrize("value,quote,expected,quality", [
    ("1500000000", "Giá trị hợp đồng: 1 tỷ 500 triệu VND.", "1500000000", "readable"),
    ("1000000000", "Giá trị hợp đồng: 1 tỷ 500 triệu VND.", None, "uncertain"),     # Codex A: partial amount
    ("500000000", "Giá trị hợp đồng: 1 tỷ 500 triệu VND.", None, "uncertain"),
    ("2350000000", "Giá trị: 2 tỷ 350 triệu đồng", "2350000000", "readable"),
    ("1500250000", "Giá trị: 1 tỷ 500 triệu 250 nghìn đồng", "1500250000", "readable"),
    ("500000000", "Giá trị: 500 triệu VND", "500000000", "readable"),
    ("1500000000", "Giá trị: 1,5 tỷ VND", "1500000000", "readable"),
    ("-1500000000", "Giá trị: (1 tỷ 500 triệu) VND", "-1500000000", "uncertain"),
    ("1500000000", "Giá trị: (1 tỷ 500 triệu) VND", None, "uncertain"),
    ("-2350000000", "Giá trị: -2 tỷ 350 triệu VND", "-2350000000", "uncertain"),
    ("1000000000", "Giá trị: 1 tỷ 500 VND", None, "uncertain"),                    # trailing bare number
    ("500", "Giá trị: 1 tỷ 500 VND", None, "uncertain"),
    ("1000000000", "Giá trị: 1 tỷ rưỡi", None, "uncertain"),
    ("1000000000", "Giá trị: 1 tỷ 1500 triệu", None, "uncertain"),                 # term does not fit its unit
    ("2500000000", "Giá trị: 1 tỷ 1500 triệu", None, "uncertain"),
    ("1500000000", "Giá trị: 500 triệu 1 tỷ", None, "uncertain"),                  # units not descending
    ("1", "Giá trị: 1 tỷ500 triệu", None, "uncertain"),
])
def test_compound_amount_fully_consumed(contracts, value, quote, expected, quality):
    registry = grounding.Registry.from_json(contracts.load("field-registry.json"))
    checked = grounding.check_value("contract.amount", "decimal", value, quote, registry)
    assert (checked.value, checked.quality) == (expected, quality)


@pytest.mark.parametrize("value,quote,expected", [
    ("1000000000", "Giá trị hợp đồng: 1 tỷ", None),                 # model crops the quote to the partial amount
    ("1000000000", "Giá trị hợp đồng: 1 tỷ 500 triệu VND.", None),
    ("1500000000", "Giá trị hợp đồng: 1 tỷ 500 triệu VND.", "1500000000"),
])
def test_compound_amount_through_extraction(contracts, storage, value, quote, expected):
    out = extract_fields(contracts, storage, "contract", "Giá trị hợp đồng: 1 tỷ 500 triệu VND.",
                         t.field("contract.amount", value, quote))
    f = t.by_key(out)["contract.amount"]
    assert f["value"] == expected
    if expected is None:
        assert f["quality"] == "uncertain" and f["evidence_ids"]


@pytest.mark.parametrize("value", ["1", "1000000000", "1500000000"])
def test_financial_compound_is_not_a_printed_number(contracts, storage, value):
    text = "Tổng tài sản: 1 tỷ 500 triệu. Nợ phải trả: 600. Vốn chủ sở hữu: 400."
    out = extract_fields(contracts, storage, "financial_statement", text,
                         t.field("financial.total_assets", value, text))
    assert t.by_key(out)["financial.total_assets"]["value"] is None


# ---------------------------------------------------------------- B: negation after the status cue


@pytest.mark.parametrize("kind,key,value,source,expected", [
    ("payment_record", "payment.status", "completed", "Ghi chú: trạng thái đã thanh toán là không đúng.", None),
    ("payment_record", "payment.status", "completed", "Khoản đã thanh toán chưa được ngân hàng xác nhận.", None),
    ("payment_record", "payment.status", "completed", "Bên mua đã thanh toán chưa?", None),
    ("payment_record", "payment.status", "completed", "Nếu đã thanh toán thì gửi chứng từ.", None),
    ("payment_record", "payment.status", "completed", "Giao dịch đã chuyển nhưng đã bị hủy.", None),
    ("payment_record", "payment.status", "pending", "Trạng thái chưa thanh toán là sai.", None),
    ("loan_request", "receipt.claim_type", "received", "Cần xác nhận đã nhận tiền.", None),
    ("loan_request", "receipt.claim_type", "received", "Khoản đã nhận là không chính xác.", None),
    # positive controls: legitimate statements stay readable
    ("payment_record", "payment.status", "completed", "Trạng thái: đã thanh toán.", "completed"),
    ("payment_record", "payment.status", "completed", "Đã thanh toán, không đúng hạn.", "completed"),
    ("payment_record", "payment.status", "completed", "Đã thanh toán đủ, không còn công nợ.", "completed"),
    ("payment_record", "payment.status", "completed", "Đã thanh toán, được ngân hàng xác nhận.", "completed"),
    ("payment_record", "payment.status", "pending", "Trạng thái: chưa thanh toán.", "pending"),
    ("loan_request", "receipt.claim_type", "received", "Đã nhận tiền 500000000 VND.", "received"),
    ("loan_request", "receipt.claim_type", "expected", "Đây là dự kiến thu, chưa khai đã nhận tiền.", "expected"),
])
def test_status_clause_including_postposed_qualifiers(contracts, storage, kind, key, value, source, expected):
    out = extract_fields(contracts, storage, kind, source, t.field(key, value, source))
    f = t.by_key(out)[key]
    assert f["value"] == expected
    assert f["quality"] == ("readable" if expected else "uncertain")


def test_status_cropped_quote_still_checked_against_whole_clause(contracts, storage):
    source = "Ghi chú: trạng thái đã thanh toán là không đúng."
    out = extract_fields(contracts, storage, "payment_record", source,
                         t.field("payment.status", "completed", "trạng thái đã thanh toán"))
    assert t.by_key(out)["payment.status"]["value"] is None


# ---------------------------------------------------------------- C: bounded party sections

PARTIES = ("Bên cung cấp: Sao Mai Demo. Mã số thuế: 0000000001\n"
           "Đơn vị mua hàng: Bình Minh Demo. Mã số thuế: 0000000002")


@pytest.mark.parametrize("source,key,value,expected", [
    (PARTIES, "parties.borrower.tax_id", "0000000002", None),          # Codex C: role not inherited
    (PARTIES, "parties.counterparty.tax_id", "0000000002", "0000000002"),
    (PARTIES, "parties.borrower.tax_id", "0000000001", "0000000001"),
    ("Bên bán (Bên B): Sao Mai Demo. Mã số thuế: 0000000001", "parties.borrower.tax_id", "0000000001", "0000000001"),
    ("Bên B (Bên mua): Bình Minh Demo. Mã số thuế: 0000000002", "parties.counterparty.tax_id", "0000000002",
     "0000000002"),
    ("Bên B: Sao Mai Demo. Mã số thuế: 0000000001", "parties.borrower.tax_id", "0000000001", None),   # no role
    ("Bên bán/Bên mua: Sao Mai Demo. Mã số thuế: 0000000001", "parties.borrower.tax_id", "0000000001", None),
    ("Bên cung cấp: Sao Mai Demo.\nĐơn vị tư vấn: Công ty X. Mã số thuế: 0000000003",
     "parties.borrower.tax_id", "0000000003", None),                    # unknown section breaks inheritance
    ("Bên cung cấp: Sao Mai Demo. Địa chỉ: Hà Nội. Đại diện: Ông A. Mã số thuế: 0000000001",
     "parties.borrower.tax_id", "0000000001", "0000000001"),            # attributes stay in the section
    ("Bên mua: Bình Minh Demo. Mã số doanh nghiệp: 0000000002", "parties.borrower.tax_id", "0000000002", None),
    ("Bên mua: Bình Minh Demo. Mã số doanh nghiệp: 0000000002", "parties.counterparty.tax_id", "0000000002",
     "0000000002"),
    ("MST bên mua: 0000000002", "parties.counterparty.tax_id", "0000000002", "0000000002"),
])
def test_party_sections_are_bounded(contracts, storage, source, key, value, expected):
    quote = next(line for line in source.splitlines() if value in line)
    out = extract_fields(contracts, storage, "contract", source, t.field(key, value, quote))
    assert t.by_key(out)[key]["value"] == expected


@pytest.mark.parametrize("label,key,expected", [
    ("Đơn vị thụ hưởng", "parties.payee.tax_id", "0000000001"),
    ("Người chuyển tiền", "parties.payer.tax_id", "0000000001"),
    ("Đơn vị thụ hưởng", "parties.payer.tax_id", None),
])
def test_payment_party_aliases(contracts, storage, label, key, expected):
    source = f"{label}: Sao Mai Demo. Mã số thuế: 0000000001"
    out = extract_fields(contracts, storage, "payment_record", source, t.field(key, "0000000001", source))
    assert t.by_key(out)[key]["value"] == expected


# ---------------------------------------------------------------- D: clause applicability

TAIL = " Không tính ngày nghiệm thu; không có điều kiện thanh toán bổ sung."


@pytest.mark.parametrize("clause,expected", [
    ("Điều khoản thanh toán trong 30 ngày lịch sau nghiệm thu S1 không áp dụng.", False),   # Codex D
    ("Thanh toán trong 30 ngày lịch sau nghiệm thu S1. Điều khoản trên không còn hiệu lực.", False),
    ("Thanh toán trong 30 ngày lịch sau nghiệm thu S1 đã bị hủy bỏ.", False),
    ("Nếu được chấp thuận, thanh toán trong 30 ngày lịch sau nghiệm thu S1.", False),
    ("Thanh toán trong 30 ngày lịch sau nghiệm thu S1, trừ khi có tranh chấp.", False),
    ("Thanh toán trong 30 ngày lịch sau nghiệm thu S1.", True),
    ("Điều 4. Thanh toán toàn bộ trong 30 ngày lịch sau nghiệm thu S1.", True),
    ("Thanh toán trong không quá 30 ngày lịch sau nghiệm thu S1.", True),
])
def test_payment_condition_must_be_in_force(contracts, storage, clause, expected):
    text = clause + TAIL
    out = extract_fields(contracts, storage, "contract", text,
                         t.field("contract.payment_condition", None, text, condition=t.CONDITION))
    f = t.by_key(out)["contract.payment_condition"]
    assert (f["value"] is not None) == expected
    if not expected:
        assert (f["quality"], f["missing_reason"]) == ("uncertain", "ambiguous")
        assert f["raw_value"] and f["evidence_ids"]          # source kept for the reviewer
        assert any(d["code"] == "PAYMENT_CONDITION_UNVERIFIED" for d in out["diagnostics"])


def test_negated_clause_cannot_hide_behind_short_quote(contracts, storage):
    text = "Thanh toán trong 30 ngày lịch sau nghiệm thu S1 không áp dụng." + TAIL
    quote = "Thanh toán trong 30 ngày lịch sau nghiệm thu S1"
    out = extract_fields(contracts, storage, "contract", text,
                         t.field("contract.payment_condition", None, quote, condition=t.CONDITION))
    assert t.by_key(out)["contract.payment_condition"]["value"] is None
