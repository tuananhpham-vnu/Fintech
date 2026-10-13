"""T06-T07: hóa đơn trùng và giá trị hóa đơn so với hợp đồng."""
from sme_rules.contracts import DocType, LinkRelation, RuleStatus
from sme_rules.fixtures import BORROWER_NAME, BORROWER_TAX_ID, BUYER, SnapshotBuilder, sao_mai_base

from .conftest import issues, results, statuses


def _invoice(b: SnapshotBuilder, document_id: str, invoice_no: str = "0000123", *, file_hash=None,
             net=None, gross=None, contract_ref="HĐ01", adjustment_ref=None):
    doc = b.document(document_id, DocType.INVOICE, file_hash=file_hash).facts(
        seller_name=BORROWER_NAME, seller_tax_id=BORROWER_TAX_ID, buyer_name=BUYER["name"],
        buyer_tax_id=BUYER["tax_id"], template_no="1", series="C26TSM", invoice_no=invoice_no,
        invoice_date="2026-10-20")
    if contract_ref:
        doc.fact("contract_ref", contract_ref)
    if net:
        doc.fact("net_amount", net)
    if gross:
        doc.fact("gross_amount", gross)
    if adjustment_ref:
        doc.fact("adjustment_ref", adjustment_ref)
    return doc


# T06
def test_t06_two_scans_of_same_invoice_one_finding_linking_both(run):
    b = sao_mai_base()
    _invoice(b, "doc_inv_scan_a", gross="110000000")
    _invoice(b, "doc_inv_scan_b", gross="110000000")
    found = issues(run(b), "R06")
    assert len(found) == 1
    assert found[0].reason_code == "POSSIBLE_DUPLICATE_INVOICE"
    assert set(found[0].operands["document_version_ids"]) == {"dv_doc_inv_scan_a_v1", "dv_doc_inv_scan_b_v1"}
    assert "có khả năng trùng" in found[0].message


def test_t06_same_file_hash_is_only_upload_duplicate(run):
    b = sao_mai_base()
    _invoice(b, "doc_inv_a", file_hash="h" * 64, gross="110000000")
    _invoice(b, "doc_inv_b", file_hash="h" * 64, gross="110000000")
    assert [r.reason_code for r in issues(run(b), "R06")] == ["DUPLICATE_UPLOAD"]


def test_t06_adjustment_invoice_is_not_counted_twice(run):
    b = sao_mai_base()
    _invoice(b, "doc_inv", gross="110000000")
    _invoice(b, "doc_inv_adj", invoice_no="0000124", gross="-10000000", adjustment_ref="0000123")
    out = run(b)
    assert issues(out, "R06") == []
    assert results(out, "R07")[0].reason_code == "ADJUSTMENT_RELATION_UNRESOLVED"


def test_t06_amount_alone_never_flags_duplicate(run):
    b = sao_mai_base()
    _invoice(b, "doc_inv_1", invoice_no="0000001", gross="110000000")
    _invoice(b, "doc_inv_2", invoice_no="0000002", gross="110000000")
    assert statuses(run(b), "R06") == [RuleStatus.PASS]


# T07
def _contract_550_incl_vat() -> SnapshotBuilder:
    b = sao_mai_base()
    b.remove_documents(DocType.CONTRACT)
    b.document("doc_contract_01", DocType.CONTRACT).facts(
        contract_no="HĐ01", total_amount="550000000", vat_basis="inclusive", currency="VND", amendments=[],
        payment_terms=[])
    return b


def test_t07_net_invoice_vs_vat_inclusive_contract_not_concluded(run):
    b = _contract_550_incl_vat()
    _invoice(b, "doc_inv", net="500000000")
    out = run(b)
    assert issues(out, "R07") == []
    assert results(out, "R07")[0].reason_code == "INVOICE_AMOUNT_BASIS_MISSING"


def test_t07_invoices_exceeding_contract_on_same_basis_is_issue(run):
    b = _contract_550_incl_vat()
    _invoice(b, "doc_inv_1", invoice_no="0000001", gross="330000000")
    _invoice(b, "doc_inv_2", invoice_no="0000002", gross="270000000")
    found = issues(run(b), "R07")
    assert len(found) == 1
    assert found[0].operands["invoiced_total_vnd"] == "600000000"


def test_t07_lower_invoice_total_is_not_issue(run):
    b = _contract_550_incl_vat()
    _invoice(b, "doc_inv", gross="220000000")
    assert statuses(run(b), "R07") == [RuleStatus.PASS]


def test_t07_unreferenced_invoice_needs_reviewer_link(run):
    b = _contract_550_incl_vat()
    inv = _invoice(b, "doc_inv", gross="660000000", contract_ref=None)
    assert results(run(b), "R07")[0].reason_code == "NO_LINKED_INVOICE"
    contract = next(d for d in b.documents if d.doc_type == DocType.CONTRACT)
    from sme_rules.fixtures import DocBuilder
    b.link(DocBuilder(b, contract), inv, LinkRelation.CONTRACT_INVOICE)
    assert issues(run(b), "R07")[0].reason_code == "INVOICE_TOTAL_EXCEEDS_CONTRACT"
