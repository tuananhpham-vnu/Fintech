"""Kịch bản demo dựng từ fixtures giả lập của sme_rules (mỗi kịch bản minh họa một rule)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, List, Tuple

from sme_rules.contracts import CaseSnapshot, DocType, Fact
from sme_rules.fixtures import (
    BORROWER_NAME,
    BORROWER_TAX_ID,
    BUYER,
    SnapshotBuilder,
    add_acceptance_record,
    sao_mai_base,
    sao_mai_golden,
)

Built = Tuple[CaseSnapshot, List[Fact]]


@dataclass(frozen=True)
class Scenario:
    id: str
    title: str
    description: str
    highlights: Tuple[str, ...]
    build: Callable[[], Built]


def _invoice(b: SnapshotBuilder, document_id: str, invoice_no: str, gross: str,
             seller_tax: str = BORROWER_TAX_ID) -> None:
    b.document(document_id, DocType.INVOICE).facts(
        seller_name=BORROWER_NAME, seller_tax_id=seller_tax, buyer_name=BUYER["name"], buyer_tax_id=BUYER["tax_id"],
        template_no="1", series="C26TSM", invoice_no=invoice_no, invoice_date="2026-10-20",
        contract_ref="HĐ01", gross_amount=gross)


def _payment(b: SnapshotBuilder, amount: str) -> None:
    b.document("doc_payment", DocType.PAYMENT_RECORD).facts(
        transaction_ref="FT-DEMO-001", payer_name=BUYER["name"], payee_name=BORROWER_NAME, date="2026-09-20",
        contract_ref="HĐ01", description="Thanh toán HĐ01").fact("amount", amount, currency="VND")


def _missing_fs() -> Built:
    return sao_mai_base().remove_documents(DocType.FINANCIAL_STATEMENT).build()


def _tax_mismatch() -> Built:
    b = sao_mai_base()
    _invoice(b, "doc_invoice", "0000123", "220000000", seller_tax="0000000007")
    return b.build()


def _fs_imbalance() -> Built:
    b = sao_mai_base().remove_documents(DocType.FINANCIAL_STATEMENT)
    b.document("doc_financials", DocType.FINANCIAL_STATEMENT).facts(
        entity_name=BORROWER_NAME, tax_id=BORROWER_TAX_ID, period_start="2025-01-01", period_end="2025-12-31",
        statement_scope="standalone", currency="VND", unit_multiplier="1000000",
        total_assets="1000", total_liabilities="600", equity="390")
    return b.build()


def _received_unsupported() -> Built:
    b = sao_mai_base(claim_type="received")
    add_acceptance_record(b, "doc_record", "HĐ01")
    return b.build()


def _received_partial() -> Built:
    b = sao_mai_base(claim_type="received")
    add_acceptance_record(b, "doc_record", "HĐ01")
    _payment(b, "200000000")
    return b.build()


def _duplicate_invoice() -> Built:
    b = sao_mai_base()
    _invoice(b, "doc_invoice_scan_a", "0000123", "220000000")
    _invoice(b, "doc_invoice_scan_b", "0000123", "220000000")
    return b.build()


def _invoice_exceeds() -> Built:
    b = sao_mai_base()
    _invoice(b, "doc_invoice_1", "0000123", "330000000")
    _invoice(b, "doc_invoice_2", "0000124", "270000000")
    return b.build()


SCENARIOS: List[Scenario] = [
    Scenario("sao-mai-1", "Sao Mai · Hồ sơ ban đầu",
             "Khoản dự kiến thu 500 triệu từ HĐ01, trả sau nghiệm thu 30 ngày; chưa có biên bản.",
             ("R08 đề nghị bổ sung biên bản nghiệm thu",), lambda: sao_mai_golden(1)),
    Scenario("sao-mai-2", "Sao Mai · Nộp nhầm biên bản HĐ02",
             "Doanh nghiệp gửi biên bản của HĐ02 cho yêu cầu HĐ01.",
             ("R10 giữ yêu cầu mở (still_open)", "R08 vẫn thiếu căn cứ"), lambda: sao_mai_golden(2)),
    Scenario("sao-mai-3", "Sao Mai · Nộp biên bản đúng HĐ01",
             "Bổ sung biên bản đúng hợp đồng, ngày 15/10/2026.",
             ("R10 chỉ đề xuất candidate_resolved", "R08 hạn minh họa 14/11/2026, không ghi đã thu"),
             lambda: sao_mai_golden(3)),
    Scenario("missing-fs", "Thiếu BCTC", "Hồ sơ không có báo cáo tài chính kỳ được chọn.",
             ("R01 báo đúng một mục thiếu, có căn cứ checklist",), _missing_fs),
    Scenario("tax-mismatch", "MST bên bán lệch một chữ số",
             "Hóa đơn ghi MST của doanh nghiệp vay sai một chữ số; MST bên mua khác là bình thường.",
             ("R02 mức cao, kèm nguồn hai bên",), _tax_mismatch),
    Scenario("fs-imbalance", "BCTC chênh 10 triệu", "Tài sản 1.000 = nợ 600 + vốn 390 (triệu VND).",
             ("R05 hiện công thức, số chuẩn hóa và ngưỡng làm tròn",), _fs_imbalance),
    Scenario("received-unsupported", "Khai đã thu, chỉ có nghiệm thu",
             "Đề nghị vay khai đã thu 500 triệu nhưng chỉ nộp biên bản nghiệm thu.",
             ("R09 mức cao: chưa có chứng từ phù hợp",), _received_unsupported),
    Scenario("received-partial", "Khai đã thu, chứng từ một phần",
             "Chứng từ thanh toán chỉ 200 triệu cho phát biểu đã thu 500 triệu.",
             ("R09 hiện phần được hỗ trợ và phần chưa rõ",), _received_partial),
    Scenario("duplicate-invoice", "Hai bản scan cùng hóa đơn", "Hai file khác nhau có cùng định danh hóa đơn.",
             ("R06 có khả năng trùng", "R07 chưa cộng khi còn ứng viên trùng"), _duplicate_invoice),
    Scenario("invoice-exceeds", "Tổng hóa đơn vượt hợp đồng", "Hai hóa đơn gồm VAT tổng 600 triệu, HĐ01 500 triệu.",
             ("R07 vượt giá trị trên cùng cơ sở thuế",), _invoice_exceeds),
]

_BY_ID: Dict[str, Scenario] = {s.id: s for s in SCENARIOS}


def get_scenario(scenario_id: str) -> Scenario:
    return _BY_ID[scenario_id]
