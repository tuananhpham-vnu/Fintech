"""Form hồ sơ đơn giản cho người xem demo -> CaseSnapshot + Fact[] (toàn bộ là dữ liệu giả lập).

Người dùng chỉ chọn giấy tờ đã nộp và điền vài con số (đơn vị triệu VND); phần dựng
fact/evidence chi tiết do code lo, để demo không cần biết JSON.
"""
from __future__ import annotations

from decimal import Decimal
from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field

from sme_rules.contracts import CaseSnapshot, DocType, Fact
from sme_rules.domain.money import fmt
from sme_rules.fixtures import BORROWER_NAME, BORROWER_TAX_ID, BUYER, SnapshotBuilder

MILLION = Decimal(1_000_000)
AMOUNT_PATTERN = r"^\d{1,9}(\.\d{1,3})?$"
CONTRACT_REF = "HĐ01"
WRONG_CONTRACT_REF = "HĐ02"
R08_ISSUE_KEY = "R08:doc_contract_01:acceptance"

Acceptance = Literal["none", "in_file", "supplement_wrong", "supplement_correct"]
ClaimType = Literal["expected", "due", "received"]


class SimpleCase(BaseModel):
    """Mọi số tiền tính bằng triệu VND, dạng chuỗi số (ví dụ "500" hoặc "398.5")."""

    model_config = ConfigDict(extra="forbid")

    company_name: str = Field(default=BORROWER_NAME, min_length=1, max_length=120)
    tax_id: str = Field(default=BORROWER_TAX_ID, pattern=r"^\d{10}(-\d{3})?$")

    has_registration: bool = True
    has_loan_request: bool = True
    has_financials: bool = True
    has_contract: bool = True

    fs_year: int = Field(default=2025, ge=2000, le=2100)
    total_assets: str = Field(default="1000", pattern=AMOUNT_PATTERN)
    total_liabilities: str = Field(default="600", pattern=AMOUNT_PATTERN)
    equity: str = Field(default="400", pattern=AMOUNT_PATTERN)

    claim_type: ClaimType = "expected"
    claim_amount: str = Field(default="500", pattern=AMOUNT_PATTERN)
    contract_amount: str = Field(default="500", pattern=AMOUNT_PATTERN)

    acceptance: Acceptance = "none"
    payment_amount: Optional[str] = Field(default=None, pattern=AMOUNT_PATTERN)

    invoice_amount: Optional[str] = Field(default=None, pattern=AMOUNT_PATTERN)
    invoice_seller_tax_id: Optional[str] = Field(default=None, pattern=r"^\d{10}(-\d{3})?$")
    invoice_two_scans: bool = False


def _vnd(million: str) -> str:
    return fmt(Decimal(million) * MILLION)


def _display(million: str) -> str:
    """"1000" -> "1.000"; "398.5" -> "398,5" (cách viết trên giấy tờ)."""
    whole, _, frac = million.partition(".")
    grouped = f"{int(whole):,}".replace(",", ".")
    return f"{grouped},{frac}" if frac else grouped


_CLAIM_SENTENCE = {
    "expected": "Doanh nghiệp dự kiến thu {amount} triệu đồng từ hợp đồng {ref} trong tháng 11/2026.",
    "due": "Khoản thu {amount} triệu đồng từ hợp đồng {ref} đã đến hạn thanh toán.",
    "received": "Doanh nghiệp đã thu {amount} triệu đồng từ hợp đồng {ref}.",
}


def build_case(form: SimpleCase, run_id: str = "run_demo") -> Tuple[CaseSnapshot, List[Fact]]:
    b = SnapshotBuilder(run_id=run_id)
    name, tax = form.company_name, form.tax_id
    borrower_party = {"name": name, "tax_id": tax, "role": "seller"}
    parties_text = f"Bên bán: {name}, MST {tax}. Bên mua: {BUYER['name']}, MST {BUYER['tax_id']}."

    if form.has_registration:
        b.document("doc_registration", DocType.REGISTRATION) \
            .fact("borrower_name", name, raw=f"Tên doanh nghiệp: {name}") \
            .fact("tax_id", tax, raw=f"Mã số doanh nghiệp: {tax}")

    if form.has_financials:
        year = form.fs_year
        fs = b.document("doc_financials", DocType.FINANCIAL_STATEMENT).facts(
            entity_name=name, tax_id=tax, period_start=f"{year}-01-01", statement_scope="standalone",
            currency="VND", unit_multiplier="1000000")
        fs.fact("period_end", f"{year}-12-31", raw=f"Báo cáo tài chính năm {year} (kết thúc 31/12/{year}), đơn vị: triệu đồng")
        fs.fact("total_assets", form.total_assets, raw=f"Tổng cộng tài sản: {_display(form.total_assets)}")
        fs.fact("total_liabilities", form.total_liabilities, raw=f"Nợ phải trả: {_display(form.total_liabilities)}")
        fs.fact("equity", form.equity, raw=f"Vốn chủ sở hữu: {_display(form.equity)}")

    if form.has_loan_request:
        claim_text = _CLAIM_SENTENCE[form.claim_type].format(amount=_display(form.claim_amount), ref=CONTRACT_REF)
        b.document("doc_loan_request", DocType.LOAN_REQUEST).facts(
            borrower_name=name, tax_id=tax, currency="VND", purpose="Bổ sung vốn lưu động", request_date="2026-10-01",
        ).fact("expected_receipts", [{"amount": _vnd(form.claim_amount), "currency": "VND",
                                      "expected_date": "2026-11-30", "contract_ref": CONTRACT_REF,
                                      "claim_type": form.claim_type}], raw=claim_text) \
         .fact("requested_amount", "300", multiplier="1000000", currency="VND", raw="Số tiền đề nghị vay: 300 triệu đồng")

    if form.has_contract:
        b.document("doc_contract_01", DocType.CONTRACT).facts(
            signed_date="2026-08-01", vat_basis="inclusive", currency="VND", amendments=[],
        ).fact("contract_no", CONTRACT_REF, raw=f"Hợp đồng số {CONTRACT_REF}") \
         .fact("parties", [borrower_party, BUYER], raw=parties_text) \
         .fact("total_amount", _vnd(form.contract_amount),
               raw=f"Tổng giá trị hợp đồng: {_display(form.contract_amount)} triệu đồng (đã bao gồm VAT)") \
         .fact("payment_terms", [{"event_type": "acceptance", "event_ref": CONTRACT_REF, "offset_days": 30,
                                  "calendar_basis": "calendar_days", "percentage": "100"}],
               raw="Bên mua thanh toán 100% giá trị hợp đồng trong vòng 30 ngày kể từ ngày nghiệm thu.", page=3)

    if form.acceptance != "none":
        request_item_id = None
        if form.acceptance.startswith("supplement"):
            request_item_id = "ri_acceptance_01"
            b.request_item(request_item_id, DocType.ACCEPTANCE_RECORD, contract_ref=CONTRACT_REF,
                           finding_issue_keys=[R08_ISSUE_KEY], purpose=f"Xác minh điều kiện thanh toán của {CONTRACT_REF}")
        ref = WRONG_CONTRACT_REF if form.acceptance == "supplement_wrong" else CONTRACT_REF
        b.document("doc_acceptance_record", DocType.ACCEPTANCE_RECORD, request_item_id=request_item_id).facts(
            record_no=f"BB-{ref}", accepted_scope="Toàn bộ hạng mục", signatory_text="Đại diện hai bên",
        ).fact("contract_ref", ref, raw=f"Căn cứ hợp đồng số {ref}") \
         .fact("parties", [borrower_party, BUYER], raw=parties_text) \
         .fact("acceptance_date", "2026-10-15", raw="Hôm nay, ngày 15 tháng 10 năm 2026, hai bên tiến hành nghiệm thu")

    if form.payment_amount:
        b.document("doc_payment", DocType.PAYMENT_RECORD).facts(
            transaction_ref="FT-DEMO-001", payer_name=BUYER["name"], contract_ref=CONTRACT_REF,
            description=f"Thanh toán {CONTRACT_REF}",
        ).fact("payee_name", name, raw=f"Đơn vị thụ hưởng: {name}") \
         .fact("date", "2026-09-20", raw="Ngày giao dịch: 20/09/2026") \
         .fact("amount", _vnd(form.payment_amount), currency="VND",
               raw=f"Số tiền: {_display(form.payment_amount)}.000.000 VND")

    if form.invoice_amount:
        seller_tax = form.invoice_seller_tax_id or tax
        scans = ("doc_invoice_scan_a", "doc_invoice_scan_b") if form.invoice_two_scans else ("doc_invoice",)
        for document_id in scans:
            b.document(document_id, DocType.INVOICE).facts(
                seller_name=name, buyer_name=BUYER["name"], buyer_tax_id=BUYER["tax_id"], template_no="1",
                series="C26TSM", invoice_date="2026-10-20", contract_ref=CONTRACT_REF,
            ).fact("seller_tax_id", seller_tax, raw=f"Mã số thuế người bán: {seller_tax}") \
             .fact("invoice_no", "0000123", raw="Ký hiệu: C26TSM  Số: 0000123") \
             .fact("gross_amount", _vnd(form.invoice_amount),
                   raw=f"Tổng tiền thanh toán: {_display(form.invoice_amount)}.000.000 đồng")

    return b.build()
