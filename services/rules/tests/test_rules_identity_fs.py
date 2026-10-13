"""T01-T05: checklist, danh tính, cơ sở và phương trình BCTC."""
from sme_rules.contracts import DocType, Priority, ProcessingStatus, Quality, RuleStatus
from sme_rules.fixtures import BORROWER_NAME, BUYER, DocBuilder, SnapshotBuilder, sao_mai_base

from .conftest import issues, results, statuses


def _without_financials(b: SnapshotBuilder) -> SnapshotBuilder:
    return b.remove_documents(DocType.FINANCIAL_STATEMENT)


# T01
def test_t01_missing_financial_statement_yields_exactly_one_issue(run):
    out = run(_without_financials(sao_mai_base()))
    found = issues(out, "R01")
    assert len(found) == 1
    finding = found[0].finding
    assert finding.issue_key == "R01:CL01.financial_statement:missing"
    assert finding.absence_basis is not None and finding.evidence_ids == []
    assert "chưa tìm thấy" in finding.description.lower()


def test_t01_processing_financial_statement_is_pending_not_missing(run):
    b = _without_financials(sao_mai_base())
    b.document("doc_fs_new", DocType.FINANCIAL_STATEMENT, status=ProcessingStatus.PROCESSING)
    out = run(b)
    assert issues(out, "R01") == []
    fs = [r for r in results(out, "R01") if r.subject == "CL01.financial_statement"][0]
    assert fs.status == RuleStatus.UNKNOWN and fs.reason_code == "DOCUMENT_PROCESSING"


def test_t01_failed_or_unclassified_file_not_counted_as_provided(run):
    b = _without_financials(sao_mai_base())
    b.document("doc_fs_broken", DocType.FINANCIAL_STATEMENT, status=ProcessingStatus.FAILED)
    assert len(issues(run(b), "R01")) == 1
    b.document("doc_unknown", None)
    fs = [r for r in results(run(b), "R01") if r.subject == "CL01.financial_statement"][0]
    assert fs.reason_code == "UNCLASSIFIED_DOCUMENTS"


# T02
def _with_invoice(seller_tax: str, buyer_tax: str = BUYER["tax_id"]) -> SnapshotBuilder:
    b = sao_mai_base()
    b.document("doc_invoice_1", DocType.INVOICE).facts(
        seller_name=BORROWER_NAME, seller_tax_id=seller_tax, buyer_name=BUYER["name"], buyer_tax_id=buyer_tax,
        template_no="1", series="C26TSM", invoice_no="0000123", invoice_date="2026-10-20",
        net_amount="100000000", vat_amount="10000000", gross_amount="110000000", contract_ref="HĐ01")
    return b


def test_t02_different_buyer_tax_id_is_normal(run):
    out = run(_with_invoice("0000000001", buyer_tax="0999999999"))
    assert statuses(out, "R02") == [RuleStatus.PASS]


def test_t02_borrower_seller_tax_id_one_digit_off_is_high_issue(run):
    out = run(_with_invoice("0000000007"))
    found = issues(out, "R02")
    assert len(found) == 1
    assert found[0].finding.priority == Priority.HIGH
    assert found[0].operands["party_role"] == "seller"
    assert len(found[0].finding.evidence_ids) >= 2  # cả nguồn giấy đăng ký và nguồn hóa đơn


def test_t02_uncertain_ocr_and_branch_are_unknown(run):
    b = sao_mai_base()
    b.document("doc_lr2", DocType.LOAN_REQUEST).fact("borrower_name", BORROWER_NAME).fact(
        "tax_id", "0000000007", quality=Quality.REVIEW_REQUIRED)
    b.document("doc_invoice_branch", DocType.INVOICE).facts(seller_name=BORROWER_NAME, seller_tax_id="0000000001-001")
    codes = {r.reason_code for r in results(run(b), "R02")}
    assert codes == {"TAX_ID_UNCERTAIN", "BRANCH_TAX_ID_REQUIRES_VERIFICATION"}
    assert issues(run(b), "R02") == []


# T03
def test_t03_abbreviated_name_same_tax_id_passes(run):
    b = sao_mai_base()
    b.document("doc_lr_short", DocType.LOAN_REQUEST).facts(borrower_name="Cty TNHH Sao Mai Demo", tax_id="0000000001")
    assert statuses(run(b), "R03") == [RuleStatus.PASS]


def test_t03_different_name_same_tax_id_needs_verification(run):
    b = sao_mai_base()
    b.document("doc_lr_other", DocType.LOAN_REQUEST).facts(borrower_name="Công ty TNHH Bình Minh", tax_id="0000000001")
    found = issues(run(b), "R03")
    assert len(found) == 1 and found[0].finding.priority == Priority.LOW


def test_t03_similar_name_without_tax_id_is_unknown(run):
    b = sao_mai_base()
    b.document("doc_lr_notax", DocType.LOAN_REQUEST).facts(borrower_name="Công ty TNHH Sao Mai Demoo")
    r03 = results(run(b), "R03")
    assert [r.reason_code for r in r03] == ["NAME_WITHOUT_TAX_ID"]


# T04
def test_t04_period_mismatch_is_issue_and_blocks_r05(run):
    b = SnapshotBuilder()
    b.document("doc_fs_2024", DocType.FINANCIAL_STATEMENT).facts(
        period_start="2024-01-01", period_end="2024-12-31", statement_scope="standalone", currency="VND",
        unit_multiplier="1000000", total_assets="1000", total_liabilities="600", equity="390")
    out = run(b)
    assert issues(out, "R04")[0].reason_code == "PERIOD_MISMATCH"
    assert statuses(out, "R05") == [RuleStatus.NOT_APPLICABLE]  # không sinh sai lệch số học giả


def test_t04_missing_basis_label_is_unknown(run):
    b = SnapshotBuilder()
    b.document("doc_fs", DocType.FINANCIAL_STATEMENT).facts(
        period_end="2025-12-31", statement_scope="unknown", currency="VND",
        total_assets="1000", total_liabilities="600", equity="400")
    out = run(b)
    assert results(out, "R04")[0].operands["missing"] == ["statement_scope", "unit_multiplier"]
    assert statuses(out, "R05") == [RuleStatus.UNKNOWN]


# T05
def _fs(assets: str, liabilities: str, equity: str) -> SnapshotBuilder:
    b = SnapshotBuilder()
    b.document("doc_fs", DocType.FINANCIAL_STATEMENT).facts(
        period_start="2025-01-01", period_end="2025-12-31", statement_scope="standalone", currency="VND",
        unit_multiplier="1000000", total_assets=assets, total_liabilities=liabilities, equity=equity)
    return b


def test_t05_balanced_then_10_million_difference(run):
    assert statuses(run(_fs("1000", "600", "400")), "R05") == [RuleStatus.PASS]
    found = issues(run(_fs("1000", "600", "390")), "R05")[0]
    assert found.operands["delta_vnd"] == "10000000"
    assert found.operands["tolerance_vnd"] == "1500000"
    assert found.operands["formula"].startswith("delta")


def test_t05_tolerance_boundary(run):
    # làm tròn 0,1 triệu -> tolerance 0,15 triệu
    assert statuses(run(_fs("1000.0", "600.0", "399.9")), "R05") == [RuleStatus.PASS]
    assert statuses(run(_fs("1000.0", "600.0", "399.8")), "R05") == [RuleStatus.ISSUE]


def test_t05_uncertain_term_is_unknown(run):
    b = _fs("1000", "600", "400")
    b.facts = [f for f in b.facts if f.field != "financial_statement.equity"]
    DocBuilder(b, b.documents[0]).fact("equity", "400", quality=Quality.UNREADABLE)
    assert results(run(b), "R05")[0].reason_code == "TERM_UNAVAILABLE"
