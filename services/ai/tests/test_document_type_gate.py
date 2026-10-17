"""Tài liệu tải nhầm loại không được thành căn cứ: chặn ở extraction (tiêu đề, không tin model) và ở evaluator."""
from __future__ import annotations

import pytest

import rules
from extraction import doctype

from .snapshots import doc, variant
from .test_extraction import (FakeModel, answer, assert_valid, by_key, contract_fields, extract_request, field,
                              make_service, storage)  # noqa: F401  (storage là fixture)

CONTRACT_HEADER = "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập - Tự do - Hạnh phúc\nHỢP ĐỒNG MUA BÁN HÀNG HÓA\nSố: 12/HĐ"


@pytest.mark.parametrize("text, expected", [
    ("HỢP ĐỒNG MÔ PHỎNG HĐ01\nHợp đồng số: HĐ01.", {"contract"}),
    (CONTRACT_HEADER, {"contract"}),
    ("BIÊN BẢN NGHIỆM THU MÔ PHỎNG\nHợp đồng tham chiếu: HĐ01.", {"acceptance_record"}),
    ("BIEN BAN NGHIEM THU\n", {"acceptance_record"}),                   # OCR mất dấu
    ("ỦY NHIỆM CHI\nSố: UNC-01", {"payment_record"}),
    ("THỰC ĐƠN QUÁN PHỞ\nPhở bò: 50.000đ", set()),
    ("Hợp đồng số: HĐ01. Phạm vi: S1.", set()),                         # nhãn có ":" không phải tiêu đề
])
def test_title_types(text, expected):
    assert doctype.title_types(text) == expected


def test_decide_is_fail_safe():
    # tiêu đề nói loại khác: model nói gì cũng không giữ field
    d = doctype.decide("acceptance_record", "acceptance_record", True, "HỢP ĐỒNG MÔ PHỎNG HĐ01")
    assert (d.detected_type, d.confident, d.keep_fields, d.code) == ("contract", False, False, doctype.MISMATCH)
    # model nói loại khác
    d = doctype.decide("contract", "other", False, "THỰC ĐƠN QUÁN PHỞ")
    assert (d.detected_type, d.confident, d.keep_fields) == ("other", False, False)
    # không có tiêu đề: giữ field nhưng bắt người xác nhận
    d = doctype.decide("contract", "contract", True, "Bên cung cấp: Sao Mai Demo.")
    assert (d.detected_type, d.confident, d.keep_fields, d.code) == ("contract", False, True, doctype.UNVERIFIED)
    # khớp tiêu đề
    assert doctype.decide("contract", "contract", True, CONTRACT_HEADER) == doctype.Decision("contract", True, True)


def acceptance_answer_from_contract(contracts) -> dict:
    """Model bị loại khai báo dẫn dắt: đọc hợp đồng như biên bản và trả field có căn cứ nguyên văn trên hợp đồng."""
    found = {
        "acceptance.contract_ref": field("acceptance.contract_ref", "HĐ01", "Hợp đồng số: HĐ01. Phạm vi: S1."),
        "acceptance.scope_ref": field("acceptance.scope_ref", "S1", "Hợp đồng số: HĐ01. Phạm vi: S1."),
        "money.currency": field("money.currency", "VND", "Giá trị toàn bộ S1: 500000000 VND, đã gồm VAT."),
    }
    keys = [f["field_key"] for f in contracts.load("field-registry.json")["document_types"]["acceptance_record"]]
    return answer([found.get(k) or field(k, status="not_present") for k in keys], "acceptance_record", True)


def test_t27_contract_uploaded_as_acceptance_record_yields_no_values(contracts, storage):
    request = extract_request(storage, "04_contract.pdf", "acceptance_record")
    out = make_service(contracts, storage, model=FakeModel(acceptance_answer_from_contract(contracts))).extract(request)
    assert_valid(contracts, request, out)
    assert out["detected_type"] == "contract" and out["classification_confident"] is False
    assert all(f["value"] is None and f["quality"] != "readable" for f in by_key(out).values())
    assert any(d["code"] == doctype.MISMATCH for d in out["diagnostics"])


def test_t27_non_loan_document_yields_no_values(contracts, storage):
    request = extract_request(storage)
    out = make_service(contracts, storage, model=FakeModel(answer(contract_fields(), "other", False))).extract(request)
    assert out["detected_type"] == "other" and out["classification_confident"] is False
    assert all(f["value"] is None for f in out["fields"])


def test_evaluator_ignores_document_whose_extraction_is_another_type():
    """Kể cả backend lỡ confirm: biên bản NT01 mà extraction báo là hợp đồng thì không được làm căn cứ resolve."""
    def mislabel(snapshot):
        doc(snapshot, "06_correct_record.pdf")["extraction"]["detected_type"] = "contract"
    out = rules.evaluate(variant(2, mislabel))
    r08 = next(a for a in out["assessments"] if a["issue_key"].startswith("R08:"))
    assert r08["proposal"] != "candidate_resolved"
