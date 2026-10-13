"""Ví dụ có sẵn cho người xem demo: mỗi ví dụ là một bộ giá trị điền sẵn cho form SimpleCase."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from simple_case import SimpleCase

STORY = "story"
QUICK = "quick"


@dataclass(frozen=True)
class Example:
    id: str
    title: str
    description: str
    expect: str
    form: SimpleCase
    group: str = QUICK
    next_id: Optional[str] = None
    highlights: Tuple[str, ...] = field(default_factory=tuple)


def _form(**changes) -> SimpleCase:
    return SimpleCase(**changes)


EXAMPLES: List[Example] = [
    Example("sao-mai-1", "Bước 1 · Hồ sơ ban đầu",
            "Công ty Sao Mai dự kiến thu 500 triệu từ HĐ01, tiền về sau nghiệm thu 30 ngày. Chưa nộp biên bản nghiệm thu.",
            "Hệ thống đề nghị bổ sung biên bản nghiệm thu HĐ01.",
            _form(acceptance="none"), group=STORY, next_id="sao-mai-2"),
    Example("sao-mai-2", "Bước 2 · Nộp nhầm biên bản",
            "Doanh nghiệp gửi biên bản nghiệm thu của HĐ02 cho yêu cầu HĐ01.",
            "Yêu cầu vẫn mở và hệ thống chỉ ra hợp đồng không khớp.",
            _form(acceptance="supplement_wrong"), group=STORY, next_id="sao-mai-3"),
    Example("sao-mai-3", "Bước 3 · Nộp đúng biên bản",
            "Doanh nghiệp gửi lại biên bản đúng HĐ01, nghiệm thu ngày 15/10/2026.",
            "Hệ thống đề xuất đã đủ căn cứ (hạn thanh toán minh họa 14/11/2026), chờ chuyên viên xác nhận. Không ghi là đã thu tiền.",
            _form(acceptance="supplement_correct"), group=STORY),
    Example("clean", "Hồ sơ đầy đủ, khớp",
            "Đủ giấy tờ, số liệu khớp, có biên bản nghiệm thu đúng hợp đồng.",
            "Không có vấn đề, và hệ thống không tạo cảnh báo thừa.",
            _form(acceptance="in_file")),
    Example("missing-fs", "Thiếu báo cáo tài chính", "Hồ sơ không có BCTC.",
            "Báo đúng một mục thiếu, kèm yêu cầu bổ sung BCTC.",
            _form(has_financials=False, acceptance="in_file")),
    Example("fs-wrong-year", "BCTC sai năm", "Nộp BCTC năm 2024 trong khi kỳ cần xem là 2025.",
            "Báo BCTC không đúng kỳ và không tự so số liệu.",
            _form(fs_year=2024, acceptance="in_file")),
    Example("fs-imbalance", "BCTC không cân", "Tài sản 1.000 triệu, nhưng nợ 600 + vốn 390 triệu.",
            "Báo chênh 10 triệu, kèm công thức và ngưỡng làm tròn.",
            _form(equity="390", acceptance="in_file")),
    Example("tax-mismatch", "MST trên hóa đơn sai một số",
            "Hóa đơn ghi mã số thuế của công ty là 0000000007 thay vì 0000000001.",
            "Báo mã số thuế chưa khớp ở mức ưu tiên cao, kèm nguồn của cả hai tài liệu.",
            _form(acceptance="in_file", invoice_amount="220", invoice_seller_tax_id="0000000007")),
    Example("received-no-proof", "Khai đã thu tiền, chỉ có biên bản",
            "Đề nghị vay ghi đã thu 500 triệu nhưng chỉ nộp biên bản nghiệm thu.",
            "Báo chưa có chứng từ thanh toán phù hợp, không khẳng định doanh nghiệp chưa được trả.",
            _form(claim_type="received", acceptance="in_file")),
    Example("received-partial", "Khai đã thu, chứng từ chỉ một phần",
            "Khai đã thu 500 triệu, chứng từ ngân hàng chỉ 200 triệu.",
            "Báo 200 triệu có chứng từ, còn 300 triệu chưa rõ.",
            _form(claim_type="received", acceptance="in_file", payment_amount="200")),
    Example("invoice-twice", "Hóa đơn nộp hai lần", "Hai bản scan khác nhau của cùng một hóa đơn.",
            "Báo có khả năng trùng và không cộng hai lần.",
            _form(acceptance="in_file", invoice_amount="220", invoice_two_scans=True)),
    Example("invoice-over", "Hóa đơn vượt hợp đồng", "Hóa đơn 600 triệu (gồm VAT) cho hợp đồng 500 triệu.",
            "Báo tổng hóa đơn vượt giá trị hợp đồng.",
            _form(acceptance="in_file", invoice_amount="600")),
]

_BY_ID: Dict[str, Example] = {e.id: e for e in EXAMPLES}


def get_example(example_id: str) -> Example:
    return _BY_ID[example_id]
