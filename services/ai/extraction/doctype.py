"""Kiểm loại tài liệu bằng code, độc lập với model: model bị loại khai báo dẫn dắt (tải nhầm hợp đồng vào ô biên bản
nghiệm thu thì model vẫn trả detected_type=acceptance_record, confident=true), nên không được là chốt chặn duy nhất.

Căn cứ là dòng tiêu đề ở đầu trang 1 ("HỢP ĐỒNG ...", "BIÊN BẢN NGHIỆM THU ..."), so không dấu để chịu được OCR.
Kết luận theo hướng an toàn:
  - tiêu đề là loại khác loại khai báo, hoặc model nói loại khác -> MISMATCH: mọi field về null, detected_type báo loại
    thật; backend không confirm được (ClassificationInput đòi type khớp) nên phải tải lại đúng ô;
  - không thấy tiêu đề nào -> giữ field nhưng confident=false: backend để review_required, người xác nhận loại;
  - tiêu đề khớp loại khai báo -> confident theo model.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

HEADER_LINES = 15          # tiêu đề nằm sau quốc hiệu/tiêu ngữ, trong vài dòng đầu trang 1
MAX_TITLE_CHARS = 90

# Mẫu không dấu, khớp từ đầu dòng tiêu đề. Dòng có ":" là nhãn ("Hợp đồng số: HĐ01"), không phải tiêu đề.
_TITLES = {
    "contract": r"hop dong\b",
    "acceptance_record": r"bien ban (?:ban giao (?:va )?)?nghiem thu\b|bien ban nghiem thu",
    "payment_record": r"uy nhiem chi\b|lenh chuyen (?:tien|khoan)\b|giay bao (?:co|no)\b"
                      r"|chung tu (?:thanh toan|giao dich|chuyen khoan)\b|phieu (?:thu|chi)\b|sao ke\b",
    "loan_request": r"(?:giay |don )?de nghi (?:vay|cap tin dung|giai ngan)\b|phuong an (?:vay|su dung von)\b"
                    r"|don (?:xin )?vay\b",
    "financial_statement": r"bao cao tai chinh\b|bang can doi ke toan\b|bao cao ket qua (?:hoat dong )?kinh doanh\b"
                           r"|bao cao luu chuyen tien te\b",
    "registration": r"giay chung nhan dang ky (?:doanh nghiep|kinh doanh)\b|ho so phap ly\b"
                    r"|giay phep (?:dang ky )?kinh doanh\b|dang ky (?:doanh nghiep|kinh doanh)\b",
    "invoice": r"hoa don\b",
}
_TITLE_RE = {doc_type: re.compile(rf"^(?:{pattern})") for doc_type, pattern in _TITLES.items()}

MISMATCH = "DOCUMENT_TYPE_MISMATCH"
UNVERIFIED = "DOCUMENT_TYPE_UNVERIFIED"
AMBIGUOUS = "DOCUMENT_TYPE_AMBIGUOUS"
MODEL_DISAGREES = "CLASSIFICATION_MISMATCH"


def fold(text: str) -> str:
    """Chữ thường, bỏ dấu tiếng Việt (đ -> d), gộp khoảng trắng."""
    decomposed = unicodedata.normalize("NFD", text.lower().replace("đ", "d"))
    return " ".join("".join(c for c in decomposed if unicodedata.category(c) != "Mn").split())


def title_types(first_page_text: str) -> set[str]:
    found = set()
    lines = [line for line in (fold(raw) for raw in first_page_text.splitlines()) if line][:HEADER_LINES]
    for line in lines:
        if ":" in line or len(line) > MAX_TITLE_CHARS:
            continue
        found |= {doc_type for doc_type, pattern in _TITLE_RE.items() if pattern.match(line)}
    return found


@dataclass(frozen=True)
class Decision:
    detected_type: str
    confident: bool
    keep_fields: bool
    code: str | None = None
    message: str | None = None


def decide(declared: str, model_type: str, model_confident: bool, first_page_text: str) -> Decision:
    titles = title_types(first_page_text)
    others = sorted(titles - {declared})
    if declared not in titles and others:
        actual = others[0] if len(others) == 1 else (model_type if model_type in others else others[0])
        return Decision(actual, False, False, MISMATCH,
                        f"Tiêu đề tài liệu là loại {', '.join(others)}, không phải {declared} như đã khai báo; "
                        f"không dùng field nào. Cần tải lại đúng loại tài liệu.")
    if model_type != declared:
        return Decision(model_type, False, False, MODEL_DISAGREES,
                        f"Nội dung giống loại {model_type}, khác loại khai báo {declared}; không dùng field nào.")
    if not titles:
        return Decision(declared, False, True, UNVERIFIED,
                        f"Không thấy tiêu đề xác nhận đây là {declared}; cần người duyệt xác nhận loại tài liệu.")
    if others:
        return Decision(declared, False, True, AMBIGUOUS,
                        f"Tiêu đề khớp nhiều loại ({', '.join(sorted(titles))}); cần người duyệt xác nhận loại.")
    return Decision(declared, model_confident, True)
