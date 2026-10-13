"""Cấu hình có phiên bản: checklist, từ viết tắt, ngưỡng và chính sách câu chữ.

Mọi thứ BA có thể chỉnh nằm ở đây, rule chỉ đọc qua `RuleConfig` (không hard-code).
"""
from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import Field

from .contracts.inputs import ContractModel, DocType


class ChecklistItem(ContractModel):
    id: str
    doc_type: DocType
    label: str
    min_count: int = Field(default=1, ge=1)


class Checklist(ContractModel):
    id: str
    version: str
    items: List[ChecklistItem]


CL01 = Checklist(
    id="CL01",
    version="CL01-v1",
    items=[
        ChecklistItem(id="CL01.registration", doc_type=DocType.REGISTRATION, label="giấy đăng ký doanh nghiệp"),
        ChecklistItem(id="CL01.loan_request", doc_type=DocType.LOAN_REQUEST, label="đề nghị vay"),
        ChecklistItem(id="CL01.financial_statement", doc_type=DocType.FINANCIAL_STATEMENT, label="bộ BCTC kỳ được chọn"),
        ChecklistItem(id="CL01.contract", doc_type=DocType.CONTRACT, label="hợp đồng liên quan khoản thu"),
    ],
)

DEFAULT_ABBREVIATIONS: Dict[str, str] = {
    "cty": "công ty",
    "tnhh": "trách nhiệm hữu hạn",
    "cp": "cổ phần",
    "mtv": "một thành viên",
    "tm": "thương mại",
    "dv": "dịch vụ",
    "sx": "sản xuất",
    "xd": "xây dựng",
}

# Câu chữ không được xuất hiện trong kết quả (phần 04, 07-09, 21 của tài liệu).
DEFAULT_FORBIDDEN_PHRASES: List[str] = [
    "không có khả năng trả nợ",
    "doanh nghiệp chưa thực hiện",
    "gian lận",
    "chưa thanh toán",
    "phê duyệt khoản vay",
    "từ chối cho vay",
]


class RuleConfig(ContractModel):
    rule_set_version: str = "1.0"
    checklist: Checklist = CL01
    abbreviations: Dict[str, str] = Field(default_factory=lambda: dict(DEFAULT_ABBREVIATIONS))
    name_candidate_threshold: float = Field(default=0.85, ge=0.0, le=1.0)
    base_currency: str = "VND"
    enabled_rules: Optional[List[str]] = None
    forbidden_phrases: List[str] = Field(default_factory=lambda: list(DEFAULT_FORBIDDEN_PHRASES))
