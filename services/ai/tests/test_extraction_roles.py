"""Party-role definitions in the extraction prompt (live defect: borrower/counterparty reversed). Fake models only."""
import pytest

import rules
from extraction import grounding
from extraction.extractor import PARTY_ROLE_WORDS, SYSTEM_PROMPT, Extractor
from runner.guards import evaluation_output_violations

from . import test_extraction as t
from .test_extraction import storage  # noqa: F401  (fixture)
from .test_extraction_correctness import extract_fields

BORROWER, COUNTERPARTY = "parties.borrower.tax_id", "parties.counterparty.tax_id"
SUPPLIER = "Bên cung cấp: Sao Mai Demo. Mã số thuế: 0000000001"
BUYER = "Bên mua: Bình Minh Demo. Mã số thuế: 0000000002"


def instructions(contracts, doc_type: str) -> str:
    """System prompt + field list: everything the model gets except the document itself."""
    extractor = Extractor(contracts, None, None)
    return SYSTEM_PROMPT + "\n" + extractor.user_prompt(doc_type, []).split("<tai_lieu>")[0]


@pytest.mark.parametrize("doc_type,keys", [
    ("contract", (BORROWER, COUNTERPARTY)),
    ("acceptance_record", (BORROWER, COUNTERPARTY)),
    ("payment_record", ("parties.payee.tax_id", "parties.payer.tax_id")),
    ("loan_request", ("borrower.tax_id",)),
])
def test_prompt_defines_each_party_field_by_document_role(contracts, doc_type, keys):
    text = instructions(contracts, doc_type)
    for key in keys:
        line = next(line for line in text.splitlines() if line.startswith(f"- {key} "))
        meaning, words = PARTY_ROLE_WORDS[key]
        assert meaning in line and all(word in line for word in words) and "ambiguous" in line
    assert "KHÔNG có nghĩa là bên nợ tiền" in text


@pytest.mark.parametrize("doc_type", ["contract", "acceptance_record", "payment_record", "loan_request",
                                      "registration", "financial_statement"])
def test_prompt_has_no_fixture_specific_values(contracts, doc_type):
    text = instructions(contracts, doc_type)
    for forbidden in ("Sao Mai", "Bình Minh", "0000000001", "0000000002", "HĐ01", "S1", "500000000"):
        assert forbidden not in text


@pytest.mark.parametrize("key", list(PARTY_ROLE_WORDS))
def test_prompt_role_words_agree_with_deterministic_validation(key):
    """Every role label the prompt names must be accepted by the validator for that same field (no drift)."""
    for word in PARTY_ROLE_WORDS[key][1]:
        assert grounding.heading_role(word) in grounding._ROLES[key], word


def test_live_reversed_proposal_is_rejected(contracts, storage):
    """Exact proposals captured by the live trace: valid IDs, verbatim quotes, roles swapped."""
    fields = t.contract_fields(**{BORROWER: t.field(BORROWER, "0000000002", BUYER),
                                  COUNTERPARTY: t.field(COUNTERPARTY, "0000000001", SUPPLIER)})
    out = t.make_service(contracts, storage, model=t.FakeModel(t.answer(fields))).extract(t.extract_request(storage))
    f = t.by_key(out)
    for key in (BORROWER, COUNTERPARTY):
        assert (f[key]["value"], f[key]["quality"], f[key]["missing_reason"]) == (None, "uncertain", "ambiguous")
        assert f[key]["evidence_ids"]                                   # quote kept for the reviewer
        assert any(d["field_key"] == key and "UNVERIFIED_FIELD_ROLE" in d["message"] for d in out["diagnostics"])
    assert sum(1 for x in out["fields"] if x["quality"] == "readable") == 5


def test_roles_assigned_by_label_are_accepted(contracts, storage):
    out = t.make_service(contracts, storage, model=t.FakeModel(t.answer(t.contract_fields()))).extract(
        t.extract_request(storage))
    f = t.by_key(out)
    assert (f[BORROWER]["value"], f[COUNTERPARTY]["value"]) == ("0000000001", "0000000002")
    assert f[BORROWER]["quality"] == f[COUNTERPARTY]["quality"] == "readable"


def test_labels_with_neutral_aliases_resolve_by_role_word(contracts, storage):
    text = ("Bên mua (Bên A): Bình Minh Demo. Mã số thuế: 0000000002\n"
            "Bên bán (Bên B): Sao Mai Demo. Mã số thuế: 0000000001")
    out = extract_fields(contracts, storage, "acceptance_record", text,
                         t.field(BORROWER, "0000000001", text.splitlines()[1]),
                         t.field(COUNTERPARTY, "0000000002", text.splitlines()[0]))
    f = t.by_key(out)
    assert (f[BORROWER]["value"], f[COUNTERPARTY]["value"]) == ("0000000001", "0000000002")


AMBIGUOUS = ("Bên A: Sao Mai Demo. Mã số thuế: 0000000001\n"
             "Bên B: Bình Minh Demo. Mã số thuế: 0000000002")


def test_genuinely_ambiguous_document_model_says_ambiguous(contracts, storage):
    lines = AMBIGUOUS.splitlines()
    out = extract_fields(contracts, storage, "contract", AMBIGUOUS,
                         t.field(BORROWER, None, lines[0], status="ambiguous"),
                         t.field(COUNTERPARTY, None, lines[1], status="ambiguous"))
    for key in (BORROWER, COUNTERPARTY):
        f = t.by_key(out)[key]
        assert (f["value"], f["quality"], f["missing_reason"]) == (None, "uncertain", "ambiguous")
        assert f["raw_value"] and f["evidence_ids"]


@pytest.mark.parametrize("borrower,counterparty", [("0000000001", "0000000002"), ("0000000002", "0000000001")])
def test_genuinely_ambiguous_document_model_guesses(contracts, storage, borrower, counterparty):
    """Whichever way the model guesses on 'Bên A/Bên B', neither assignment is accepted."""
    line = {value: next(x for x in AMBIGUOUS.splitlines() if value in x) for value in ("0000000001", "0000000002")}
    out = extract_fields(contracts, storage, "contract", AMBIGUOUS,
                         t.field(BORROWER, borrower, line[borrower]),
                         t.field(COUNTERPARTY, counterparty, line[counterparty]))
    for key in (BORROWER, COUNTERPARTY):
        assert t.by_key(out)[key]["value"] is None
        assert any(d["field_key"] == key and "UNVERIFIED_FIELD_ROLE" in d["message"] for d in out["diagnostics"])


def test_applicant_who_is_the_buyer_is_caught_by_m3_not_assumed(contracts, storage):
    """Extraction reports contract roles only. If the case borrower is the BUYER, M3's identity check must
    flag it instead of resolving: the supplier=borrower mapping is not treated as a fact about the applicant."""
    from .snapshots import doc, gold_input
    from .test_m2_m3_trust_boundary import TAIL, evaluation_input

    snapshot = gold_input(2)["snapshot"]
    contract_doc = doc(snapshot, "04_contract.pdf")["document"]
    reversed_parties = ["HỢP ĐỒNG MÔ PHỎNG HĐ01", "Hợp đồng số: HĐ01. Phạm vi: S1.",
                        "Bên cung cấp: Bình Minh Demo. Mã số thuế: 0000000002",       # case borrower 0000000001
                        "Bên mua: Sao Mai Demo. Mã số thuế: 0000000001",              # is the buyer here
                        "Giá trị toàn bộ S1: 500000000 VND, đã gồm VAT.",
                        "Thanh toán toàn bộ trong 30 ngày lịch sau nghiệm thu S1.", TAIL]
    t.text_pdf(storage / "buyer.pdf", "\n".join(reversed_parties))
    fields = t.contract_fields(**{
        BORROWER: t.field(BORROWER, "0000000002", reversed_parties[2]),
        COUNTERPARTY: t.field(COUNTERPARTY, "0000000001", reversed_parties[3]),
        "contract.payment_condition": t.field("contract.payment_condition", None, reversed_parties[5], TAIL,
                                              condition=t.CONDITION)})
    request = {"schema_version": "1.0.2", "document_id": contract_doc["id"], "case_id": snapshot["case"]["id"],
               "type": "contract", "storage_key": "buyer.pdf", "sha256": t.sha(storage / "buyer.pdf")}
    extraction = t.make_service(contracts, storage, model=t.FakeModel(t.answer(fields))).extract(request)
    t.assert_valid(contracts, request, extraction)
    assert t.by_key(extraction)[BORROWER]["value"] == "0000000002"     # readable: it IS the supplier's ID

    data = evaluation_input(extraction)
    out = rules.evaluate(data)
    assert evaluation_output_violations(data, out) == []
    r08 = next(a for a in out["assessments"] if a["issue_key"].startswith("R08:"))
    assert r08["proposal"] == "unknown" and r08["computed_date"] is None
    assert "CONTRACT_BORROWER_NOT_VERIFIED" in r08["reason_codes"]
    r02 = next(a for a in out["assessments"] if a["issue_key"].startswith("R02:"))
    assert "BORROWER_TAX_ID_MISMATCH" in r02["reason_codes"]               # identity mismatch surfaced by M3
