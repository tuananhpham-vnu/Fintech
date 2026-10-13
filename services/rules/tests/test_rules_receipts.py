"""T08-T10 và kịch bản demo Sao Mai: khoản thu, phát biểu đã thu, hồ sơ bổ sung."""
from sme_rules import run_analysis
from sme_rules.contracts import DocType, Priority, ProposalStatus, RuleStatus
from sme_rules.fixtures import ACCEPTANCE_TERM, BORROWER_NAME, add_acceptance_record, sao_mai_base, sao_mai_golden

from .conftest import issues, results, statuses


# T08
def test_t08_acceptance_dependent_receipt_without_record_requests_it(run):
    out = run(sao_mai_base())
    found = issues(out, "R08")
    assert len(found) == 1
    finding = found[0].finding
    assert finding.issue_key == "R08:doc_contract_01:acceptance"
    assert finding.priority == Priority.MEDIUM
    assert finding.suggested_request.type == DocType.ACCEPTANCE_RECORD
    assert out.suggested_requests[0].finding_issue_keys == [finding.issue_key]


def test_t08_due_claim_without_acceptance_is_high(run):
    found = issues(run(sao_mai_base(claim_type="due")), "R08")
    assert found[0].finding.priority == Priority.HIGH


def test_t08_correct_record_gives_illustrative_due_date_but_not_received(run):
    b = sao_mai_base()
    add_acceptance_record(b, "doc_record", "HĐ01")
    out = run(b)
    r08 = results(out, "R08")[0]
    assert r08.status == RuleStatus.PASS
    assert r08.operands["illustrative_due_dates"] == ["2026-11-14"]
    assert "không phải ghi nhận đã thu" in r08.message
    assert statuses(out, "R09") == [RuleStatus.NOT_APPLICABLE]  # không gắn R09 cho case chỉ khai dự kiến


def test_t08_business_days_and_extra_conditions_are_unknown(run):
    for term_patch, code in (({"calendar_basis": "business_days"}, "BUSINESS_DAY_CALENDAR_UNAVAILABLE"),
                             ({"concurrent_conditions": ["bảo lãnh"]}, "OTHER_CONDITIONS_REQUIRE_REVIEW")):
        b = sao_mai_base()
        contract_fact = next(f for f in b.facts if f.field == "contract.payment_terms")
        b.facts[b.facts.index(contract_fact)] = contract_fact.model_copy(
            update={"value": [dict(ACCEPTANCE_TERM, **term_patch)]})
        add_acceptance_record(b, "doc_record", "HĐ01")
        assert results(run(b), "R08")[0].reason_code == code


# T09
def _received_case():
    return sao_mai_base(claim_type="received")


def _payment(b, document_id, amount, payee=BORROWER_NAME, contract_ref="HĐ01", date="2026-09-20"):
    return b.document(document_id, DocType.PAYMENT_RECORD).facts(
        transaction_ref=f"FT-{document_id}", payer_name="Công ty CP Khách Hàng Demo", payee_name=payee,
        date=date, contract_ref=contract_ref, description="Thanh toán HĐ01").fact("amount", amount, currency="VND")


def test_t09_acceptance_does_not_support_received_claim(run):
    b = _received_case()
    add_acceptance_record(b, "doc_record", "HĐ01")
    found = issues(run(b), "R09")
    assert len(found) == 1
    assert found[0].finding.priority == Priority.HIGH
    assert found[0].reason_code == "RECEIVED_CLAIM_UNSUPPORTED"
    assert "chưa có chứng từ thanh toán phù hợp trong hồ sơ" in found[0].message
    assert found[0].finding.suggested_request.type == DocType.PAYMENT_RECORD


def test_t09_payment_to_other_payee_is_not_matched(run):
    b = _received_case()
    _payment(b, "doc_pay", "500000000", payee="Công ty TNHH Khác Demo")
    found = issues(run(b), "R09")[0]
    assert found.operands["rejected_candidates"][0]["reason"] == "PAYEE_NOT_BORROWER"


def test_t09_partial_payment_shows_supported_and_unclear_amounts(run):
    b = _received_case()
    _payment(b, "doc_pay", "200000000")
    found = issues(run(b), "R09")[0]
    assert found.reason_code == "RECEIVED_CLAIM_PARTIALLY_SUPPORTED"
    assert (found.operands["supported_vnd"], found.operands["unclear_vnd"]) == ("200000000", "300000000")


def test_t09_full_payment_document_found(run):
    b = _received_case()
    _payment(b, "doc_pay", "500000000")
    assert statuses(run(b), "R09") == [RuleStatus.PASS]


def test_t09_payment_after_statement_date_not_used(run):
    b = _received_case()
    _payment(b, "doc_pay", "500000000", date="2026-10-05")
    assert statuses(run(b), "R09") == [RuleStatus.ISSUE]


# T10 + kịch bản demo
def test_t10_wrong_contract_record_keeps_request_open():
    out = run_analysis(*sao_mai_golden(stage=2))
    r10 = results(out, "R10")[0]
    assert r10.status == RuleStatus.ISSUE
    assert r10.resolution.proposal == ProposalStatus.STILL_OPEN
    assert "CONTRACT_REF_MISMATCH" in r10.message
    assert r10.finding.possible_related == ["R08:doc_contract_01:acceptance"]
    assert any(e.startswith("ev_dv_doc_contract_01") for e in r10.evidence_ids)  # mở được nguồn cả hai hợp đồng
    assert statuses(out, "R08") == [RuleStatus.ISSUE]


def test_t10_correct_record_is_only_candidate_resolved():
    out = run_analysis(*sao_mai_golden(stage=3))
    r10 = results(out, "R10")[0]
    assert r10.status == RuleStatus.PASS
    assert r10.resolution.proposal == ProposalStatus.CANDIDATE_RESOLVED
    assert out.resolutions[0].related_issue_keys == ["R08:doc_contract_01:acceptance"]
    assert statuses(out, "R08") == [RuleStatus.PASS]
    assert out.findings == []


def test_t10_wrong_document_type_stays_open(run):
    b = sao_mai_base()
    b.request_item("ri_1", DocType.ACCEPTANCE_RECORD, contract_ref="HĐ01")
    b.document("doc_resp", DocType.INVOICE, request_item_id="ri_1").facts(
        contract_ref="HĐ01", seller_name=BORROWER_NAME, seller_tax_id="0000000001")
    assert results(run(b), "R10")[0].resolution.proposal == ProposalStatus.STILL_OPEN


def test_t10_no_response_and_unreadable_ref(run):
    b = sao_mai_base()
    b.request_item("ri_1", DocType.ACCEPTANCE_RECORD, contract_ref="HĐ01")
    assert results(run(b), "R10")[0].reason_code == "AWAITING_RESPONSE"
    b.document("doc_resp", DocType.ACCEPTANCE_RECORD, request_item_id="ri_1").facts(acceptance_date="2026-10-15")
    assert results(run(b), "R10")[0].status == RuleStatus.UNKNOWN
