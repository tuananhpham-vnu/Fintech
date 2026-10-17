"""Kiểm căn cứ cho output model (deterministic, không gọi mạng).

1. Quote phải là chuỗi con NGUYÊN VĂN của text trang được nêu (chỉ cho phép khác khoảng trắng), không chạm dòng bị
   nghi prompt injection. Trả về đúng đoạn text của trang để evidence luôn khớp nguồn.
2. Giá trị phải có căn cứ chữ trong quote: MST, số tiền, ngày, enum, tiền tệ, mã/tên. Không có căn cứ -> từ chối
   (field thành null + uncertain), không bao giờ "sửa" giá trị cho khớp.
Quy ước tài liệu Việt Nam: "." là phân cách nghìn, "," là thập phân; ngày ghi ngày trước tháng.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

import normalize
from rules.hard_cases import INJECTION as EVALUATOR_INJECTION

MIN_QUOTE_CHARS = 3
MAX_QUOTE_CHARS = 500
MAX_STRING_VALUE = 300

# Câu nhắm vào AI/model trong tài liệu. Gộp với mẫu của evaluator để hai phía gắn cờ nhất quán.
INJECTION = re.compile(
    EVALUATOR_INJECTION.pattern +
    r"|(bỏ qua|phớt lờ|không (cần )?tuân theo)[^.\n]{0,40}(yêu cầu|lệnh|prompt)"
    r"|disregard (all |any |the )?(previous |prior |above )?(instructions|rules)"
    r"|(gửi|dành cho|lưu ý|nói với)[^.\n]{0,10}\b((?-i:AI)|trợ lý( ảo)?|mô hình|model|llm|chatbot|hệ thống chấm)\b"
    r"|\b((?-i:AI)|trợ lý( ảo)?|mô hình|model|llm)\b[^.\n]{0,15}\b(hãy|phải|cần phải)\b"
    r"|(hãy|phải)\s+(trả về|xuất|ghi|đặt|điền)[^.\n]{0,40}(json|field|trường|giá trị)"
    r"|you are now|bạn là (một )?((?-i:AI)|trợ lý|mô hình)"
    r"|<\s*/?\s*(tai_lieu|trang)\b[^>]*>",
    re.IGNORECASE)

_DASHES = dict.fromkeys(map(ord, "‐‑‒–—−"), "-")
_CURRENCY_TOKEN = r"(?:VND|VNĐ|USD|EUR|GBP|JPY|đồng|\$|€)"
_UNIT = r"(?:nghìn|ngàn|triệu|tỷ|tỉ)"
# One monetary expression: optional sign/accounting brackets/currency around a number with an optional
# Vietnamese unit, followed by lower-unit terms ("1 tỷ 500 triệu"). Completeness is checked in Python.
_NUMBER = re.compile(
    r"(?<![\w.,+\-−/])(?P<open>\()?\s*(?P<sign>[+\-−]?)\s*"
    rf"(?:{_CURRENCY_TOKEN}\s*)?(?P<inner_open>\()?\s*(?P<inner_sign>[+\-−]?)\s*"
    r"(?P<number>\d+(?:[.,]\d+|[ \u00a0]\d+)*)"
    rf"(?:\s*(?P<unit>{_UNIT})\b(?P<tail>(?:\s+\d+(?:[.,]\d+)*\s*{_UNIT}\b)*))?"
    rf"\s*(?P<inner_close>\))?(?:\s*{_CURRENCY_TOKEN})?\s*(?P<close>\))?"
    r"(?![\w/]|[.,]\d)", re.I)
_TAIL_TERM = re.compile(rf"(\d+(?:[.,]\d+)*)\s*({_UNIT})", re.I)
# Text that continues an expression we did not consume: "1 tỷ 500", "1 tỷ rưỡi", "500 triệu" right after "1 tỷ".
_DANGLING_AFTER = re.compile(rf"\s*{_UNIT}|\s*(?:rưỡi|lẻ|linh|mốt)\b|\s+\d", re.I)
_UNIT_BEFORE = re.compile(rf"(?:{_UNIT}|rưỡi|lẻ|linh)\s*$", re.I)
_MULTIPLIERS = {"nghìn": 1000, "ngàn": 1000, "triệu": 10**6, "tỷ": 10**9, "tỉ": 10**9}
_DATE_PATTERNS = (
    (re.compile(r"(?<!\d)(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4})(?!\d)"), ("d", "m", "y")),
    (re.compile(r"ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})", re.IGNORECASE), ("d", "m", "y")),
    # U+2010 is the printed ISO separator in reviewed native PDFs. Match it only
    # here: never translate source text/evidence or monetary signs globally.
    (re.compile(r"(?<!\d)(\d{4})[-\u2010](\d{2})[-\u2010](\d{2})(?!\d)"), ("y", "m", "d")),
)
_NEGATION = re.compile(r"\b(chưa|không|chẳng|phủ nhận)\b[^.;]*$", re.IGNORECASE)
_FAILED = re.compile(r"thất bại|không thành công|bị (hủy|huỷ|hoàn trả)|đảo ngược", re.I)

# enum -> mẫu chữ khẳng định. Cụm bị phủ định ("chưa ... đã nhận") không tính.
ENUM_CUES: dict[str, dict[str, re.Pattern]] = {
    "receipt.claim_type": {
        "expected": re.compile(r"dự kiến|sẽ (thu|nhận)|kỳ vọng", re.IGNORECASE),
        "due": re.compile(r"đến hạn|tới hạn|phải thu", re.IGNORECASE),
        "received": re.compile(r"đã (nhận|thu|được thanh toán|về tài khoản)", re.IGNORECASE),
    },
    "financial.scope": {
        "standalone": re.compile(r"riêng lẻ|riêng|công ty mẹ", re.IGNORECASE),
        "consolidated": re.compile(r"hợp nhất", re.IGNORECASE),
    },
    "payment.status": {
        "completed": re.compile(r"đã (thanh toán|chuyển|chi)|thành công|hoàn tất", re.IGNORECASE),
        "pending": re.compile(r"chờ|đang xử lý|chưa (thanh toán|chuyển|chi)", re.IGNORECASE),
    },
}

_UNIT_CUES = {"1000": re.compile(r"nghìn|ngàn", re.I), "1000000": re.compile(r"triệu", re.I),
              "1000000000": re.compile(r"tỷ|tỉ", re.I)}
_VND = re.compile(r"\bVN[DĐ]\b|(?<!hợp )\bđồng\b", re.IGNORECASE)


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def comparison_text(text: str) -> str:
    """Reviewed PDF font separator only. Never rewrite evidence or numeric punctuation."""
    return nfc(text).replace("\x03", " ")


def _ws(text: str) -> str:
    return " ".join(comparison_text(text).split())


# ---------------------------------------------------------------- quote


@dataclass(frozen=True)
class Span:
    page: int
    start: int
    end: int
    text: str


def injection_spans(text: str) -> list[tuple[int, int]]:
    """Cả dòng chứa câu nghi injection (để ẩn khỏi prompt và cấm làm evidence)."""
    spans = []
    for match in INJECTION.finditer(text.replace("\x03", " ")):
        start = text.rfind("\n", 0, match.start()) + 1
        end = text.find("\n", match.end())
        spans.append((start, len(text) if end == -1 else end))
    return spans


def mask(text: str, spans: list[tuple[int, int]]) -> str:
    for start, end in sorted(spans, reverse=True):
        text = text[:start] + "[ĐÃ ẨN: dòng có dạng chỉ dẫn, không dùng làm căn cứ]" + text[end:]
    return text


def find_quote(page: int, page_text: str, quote: object, blocked: list[tuple[int, int]]) -> Span | None:
    if not isinstance(quote, str):
        return None
    tokens = comparison_text(quote).split()
    compact = "".join(tokens)
    if len(compact) < MIN_QUOTE_CHARS or len(quote) > MAX_QUOTE_CHARS:
        return None
    # Match a comparison view, but return offsets/text of the actual source.
    # A starter and its combining marks form one NFC cluster (Vietnamese PDF text).
    view, offsets = [], []
    start = 0
    while start < len(page_text):
        end = start + 1
        while end < len(page_text) and unicodedata.combining(page_text[end]):
            end += 1
        cluster = comparison_text(page_text[start:end])
        view.append(cluster)
        offsets.extend([(start, end)] * len(cluster))
        start = end
    match = re.search(r"\s+".join(map(re.escape, tokens)), "".join(view))
    if match is None:
        return None
    source_start, source_end = offsets[match.start()][0], offsets[match.end() - 1][1]
    if any(source_start < end and start < source_end for start, end in blocked):
        return None
    return Span(page, source_start, source_end, page_text[source_start:source_end])


# ---------------------------------------------------------------- values


@dataclass(frozen=True)
class Checked:
    value: str | None
    quality: str = "readable"
    problem: str | None = None        # mã lý do khi từ chối hoặc hạ chất lượng


def _reject(code: str) -> Checked:
    return Checked(None, "uncertain", code)


def _number_candidates(token: str) -> list[tuple[Decimal, bool]]:
    """(value, unambiguous). A currency code alone does not establish numeric locale."""
    if re.search(r"[ \u00a0]", token) and not re.fullmatch(r"\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d+)?", token):
        return []
    token = re.sub(r"[ \u00a0]", "", token)
    try:
        if token.isdigit():
            return [(Decimal(token), True)]
        if "." in token and "," in token:
            decimal_mark = "," if token.rfind(",") > token.rfind(".") else "."
            thousands = "." if decimal_mark == "," else ","
            integer, fraction = token.rsplit(decimal_mark, 1)
            if not re.fullmatch(rf"\d{{1,3}}(?:{re.escape(thousands)}\d{{3}})+", integer):
                return []
            return [(Decimal(integer.replace(thousands, "") + "." + fraction), True)]
        sep = "." if "." in token else ","
        head, *groups = token.split(sep)
        if len(groups) > 1:
            return [(Decimal(token.replace(sep, "")), True)] if len(head) <= 3 and all(len(g) == 3 for g in groups) else []
        as_decimal = Decimal(f"{head}.{groups[0]}")
        if len(groups[0]) != 3:
            return [(as_decimal, True)]
        as_thousands = Decimal(head + groups[0])
        return [(as_thousands, False), (as_decimal, False)]
    except InvalidOperation:
        return []


@dataclass(frozen=True)
class Money:
    start: int
    end: int
    text: str
    complete: bool                            # the whole written expression was interpreted
    candidates: tuple[tuple[Decimal, bool], ...]


def _expression_candidates(match: re.Match, allow_words: bool) -> list[tuple[Decimal, bool]] | None:
    """Value of the whole expression, or None when it cannot be fully interpreted."""
    unit, terms = match["unit"], _TAIL_TERM.findall(match["tail"] or "")
    if not terms:
        factor = _MULTIPLIERS[unit.lower()] if unit and allow_words else 1
        return [(c * factor, certain) for c, certain in _number_candidates(match["number"])]
    if not allow_words:
        return None                           # BCTC keeps printed numbers; a compound there is not a known layout
    total, previous = 0, None
    for number, word in [(match["number"], unit), *terms]:
        factor = _MULTIPLIERS[word.lower()]
        if not number.isdigit():
            return None                       # "1,5 tỷ 200 triệu"
        if previous is not None and (factor >= previous or int(number) * factor >= previous):
            return None                       # units must descend and each term must fit ("1 tỷ 1500 triệu")
        total, previous = total + int(number) * factor, factor
    return [(Decimal(total), True)]


def money_expressions(text: str, allow_words: bool = True) -> list[Money]:
    """Every monetary expression in `text`; only complete ones carry candidate values."""
    found = []
    for match in _NUMBER.finditer(text):
        opened = bool(match["open"]) + bool(match["inner_open"])
        closed = bool(match["close"]) + bool(match["inner_close"])
        candidates = _expression_candidates(match, allow_words)
        complete = (candidates is not None and opened == closed
                    and not _DANGLING_AFTER.match(text, match.end())
                    and not _UNIT_BEFORE.search(text[:match.start()]))
        negative = match["sign"] in ("-", "−") or match["inner_sign"] in ("-", "−") or bool(opened)
        values = tuple((-c if negative else c, certain) for c, certain in candidates or []) if complete else ()
        found.append(Money(match.start(), match.end(), match[0], complete, values))
    return found


def _amount(key: str, value: str, quote: str) -> Checked:
    value = value.strip()
    if not re.fullmatch(r"-?\d+(\.\d{1,2})?", value):
        return _reject("UNPARSEABLE_AMOUNT")
    try:
        wanted = Decimal(value)
        rendered = normalize.format_amount(wanted)
    except InvalidOperation:
        return _reject("UNPARSEABLE_AMOUNT")
    allow_words = not key.startswith("financial.")  # BCTC giữ số in trên báo cáo, hệ số đơn vị là field riêng
    best: bool | None = None
    expressions = money_expressions(quote, allow_words)
    for expression in expressions:          # a partial expression never supports a value
        for candidate, certain in expression.candidates:
            if wanted == candidate:
                best = certain if best is None else (best and certain)
    if best is None:
        return _reject("INCOMPLETE_AMOUNT" if any(not e.complete for e in expressions) else "VALUE_NOT_IN_QUOTE")
    if wanted < 0:
        # Current evaluator accepts nonnegative amounts. Preserve the sign for review.
        return Checked(rendered, "uncertain", "NEGATIVE_AMOUNT")
    return Checked(rendered) if best else Checked(rendered, "uncertain", "AMBIGUOUS_NUMBER")


def _unit_multiplier(value: str, quote: str) -> Checked:
    value = value.strip()
    quote = _ws(quote)
    if value == "1":
        ok = bool(_VND.search(quote)) and not any(p.search(quote) for p in _UNIT_CUES.values())
    elif value in _UNIT_CUES:
        ok = bool(_UNIT_CUES[value].search(quote))
    else:
        return _reject("UNPARSEABLE_AMOUNT")
    if ok:
        return Checked(value)
    numeric = _amount("financial.unit_multiplier", value, quote)  # "Đơn vị tính: 1.000 đồng"
    return numeric if numeric.value else _reject("VALUE_NOT_IN_QUOTE")


def _dates_in(quote: str) -> set[date]:
    found = set()
    for pattern, order in _DATE_PATTERNS:
        for match in pattern.finditer(quote):
            parts = dict(zip(order, map(int, match.groups())))
            try:
                found.add(date(parts["y"], parts["m"], parts["d"]))
            except ValueError:
                continue
    return found


def _date(value: str, quote: str) -> Checked:
    parsed = normalize.iso_date(value)
    if parsed is None:
        return _reject("UNPARSEABLE_DATE")
    dates = _dates_in(quote)
    if len(dates) > 1:
        return _reject("AMBIGUOUS_DATE")
    return Checked(parsed.isoformat()) if parsed in dates else _reject("VALUE_NOT_IN_QUOTE")


def _tax_id(value: str, quote: str) -> Checked:
    tax_id = normalize.tax_id(value)
    if tax_id is None:
        return _reject("INVALID_TAX_ID")
    compact = re.sub(r"[\s.]", "", nfc(quote)).translate(_DASHES)
    if re.search(rf"(?<!\d){re.escape(tax_id)}(?!-?\d)", compact):   # 0000000001 không khớp MST chi nhánh -001
        return Checked(tax_id)
    return _reject("VALUE_NOT_IN_QUOTE")


_CLAUSE_END = re.compile(r"[.;!?\n]")
# Qualifiers AFTER the cue that deny or question it: "đã thanh toán là không đúng", "... chưa được xác nhận".
_POSTPOSED_NEGATION = re.compile(
    r"\b(?:không|chưa|chẳng)\s+(?:còn\s+)?(?:đúng(?!\s+hạn)|chính xác|phải|có thật|hợp lệ|(?:được\s+)?xác nhận"
    r"|(?:được\s+)?ghi nhận|thực hiện|xảy ra|hoàn tất|thành công)"
    r"|\b(?:không|chưa)\s+được\s+(?:[^\s.;,]+\s+){1,3}(?:xác nhận|ghi nhận|duyệt|chấp nhận)"
    r"|\b(?:sai|nhầm(?: lẫn)?|không có cơ sở|vô hiệu|hay chưa|hay không|có phải)\b"
    r"|\b(?:bị|đã bị|được)\s+(?:hủy|huỷ|từ chối|hoàn trả|thu hồi|đảo ngược|bác bỏ)", re.I)
# Before a factual cue, these make it hypothetical or a request rather than a statement of fact.
_HYPOTHETICAL = re.compile(r"\b(?:nếu|giả sử|trong trường hợp|khi nào|liệu|có thể|sẽ|cần|đề nghị|yêu cầu)\b", re.I)
_FACTUAL_OPTIONS = {("payment.status", "completed"), ("receipt.claim_type", "received")}


def _affirmed(key: str, option: str, text: str, match: re.Match) -> bool:
    """The cue is asserted by its whole clause: no negation before or after it, not a question or hypothesis."""
    start = max((m.end() for m in _CLAUSE_END.finditer(text, 0, match.start())), default=0)
    end_match = _CLAUSE_END.search(text, match.end())
    end = end_match.start() if end_match else len(text)
    before, after = text[start:match.start()], text[match.end():end]
    if _NEGATION.search(before) or _POSTPOSED_NEGATION.search(after):
        return False
    if end_match and end_match.group() == "?":
        return False
    return not ((key, option) in _FACTUAL_OPTIONS and _HYPOTHETICAL.search(before))


def _positive_cues(cues: dict[str, re.Pattern], key: str, quote: str) -> set[str]:
    found = set()
    for option, pattern in cues.items():
        if any(_affirmed(key, option, quote, match) for match in pattern.finditer(quote)):
            found.add(option)
    return found


def _enum(key: str, value: str, allowed: list[str], quote: str) -> Checked:
    if value not in allowed:
        return _reject("VALUE_NOT_ALLOWED")
    if value == "unknown":
        return Checked("unknown", "uncertain", None)
    if key in ("payment.status", "receipt.claim_type") and _FAILED.search(quote):
        return _reject("CONTRADICTORY_STATUS")
    cues = _positive_cues(ENUM_CUES.get(key, {}), key, quote)
    if value not in cues:
        return _reject("VALUE_NOT_IN_QUOTE")
    if len(cues) > 1:
        return _reject("CONFLICTING_CUES")
    return Checked(value)


def _currency(value: str, quote: str) -> Checked:
    code = value.strip().upper()
    quote = _ws(quote)
    if not re.fullmatch(r"[A-Z]{3}", code):
        return _reject("VALUE_NOT_ALLOWED")
    if re.search(rf"\b{code}\b", quote, re.IGNORECASE) or (code == "VND" and _VND.search(quote)):
        return Checked(code)
    return _reject("VALUE_NOT_IN_QUOTE")


def _verbatim(value: str, quote: str) -> Checked:
    tokens = _ws(value).translate(_DASHES).split()
    if not tokens or len(value) > MAX_STRING_VALUE:
        return _reject("VALUE_NOT_IN_QUOTE")
    match = re.search(r"(?<![\w/\-])" + r"\s+".join(map(re.escape, tokens)) + r"(?![\w/\-]|\.(?=\w))",
                      nfc(quote).translate(_DASHES), re.IGNORECASE)
    return Checked(" ".join(match.group(0).split())) if match else _reject("VALUE_NOT_IN_QUOTE")


def check_value(key: str, value_type: str, value: object, quote: str, registry: "Registry") -> Checked:
    """Chuẩn hóa giá trị model đề xuất và kiểm nó có trong quote (đã xác thực là nguyên văn)."""
    if not isinstance(value, str) or not value.strip():
        return _reject("EMPTY_VALUE")
    value = nfc(value).strip()
    quote = comparison_text(quote)
    if key == "document.summary":       # tóm tắt do model viết: không phải nguyên văn nên chỉ là uncertain
        return Checked(value[:MAX_STRING_VALUE], "uncertain", None)
    if key == "financial.unit_multiplier":
        return _unit_multiplier(value, quote)
    if value_type == "decimal":
        return _amount(key, value, quote)
    if key in registry.date_fields:
        return _date(value, quote)
    if key.endswith("tax_id"):
        return _tax_id(value, quote)
    if key in registry.enum_values:
        return _enum(key, value, registry.enum_values[key], quote)
    if key == "money.currency":
        return _currency(value, quote)
    return _verbatim(value, quote)


# Labels restrict a value to its field, even when the model quotes several fields.
# Unsupported layouts stay uncertain rather than assigning a role by occurrence.
_LABELS = {
    "financial.total_assets": r"tổng tài sản|total assets",
    "financial.liabilities": r"nợ phải trả|total liabilities",
    "financial.equity": r"vốn chủ sở hữu|equity",
    "financial.unit_multiplier": r"đơn vị(?: tính)?|unit multiplier",
    "financial.period_end": r"kỳ kết thúc|ngày kết thúc kỳ|period end",
    "loan.amount": r"đề nghị vay|số tiền vay|loan amount",
    "receipt.amount": r"(?:dự kiến|đến hạn|đã|sẽ|phải)\s+(?:thu|nhận)|khoản thu",
    "contract.amount": r"giá trị(?:\s+(?:hợp đồng|toàn bộ\s+\w+))?|contract amount",
    "acceptance.amount": r"giá trị(?:\s+nghiệm thu)?|số tiền nghiệm thu",
    "payment.amount": r"số tiền(?:\s+(?:thanh toán|chuyển khoản))?|payment amount|amount",
    "receipt.expected_date": r"dự kiến thu[^;\n]*?\bngày\b|ngày dự kiến(?: thu)?|expected date",
    "acceptance.date": r"ngày nghiệm thu|acceptance date",
    "payment.date": r"ngày thanh toán|ngày chuyển(?: khoản)?|ngày giao dịch|payment date",
    "contract.ref": r"hợp đồng số|số hợp đồng|contract ref",
    "contract.scope_ref": r"phạm vi(?: khoản thu)?|scope",
    "acceptance.ref": r"số biên bản|acceptance ref",
    "acceptance.contract_ref": r"hợp đồng tham chiếu|hợp đồng số|số hợp đồng",
    "acceptance.scope_ref": r"phạm vi|nghiệm thu (?:toàn bộ|một phần)",
    "payment.ref": r"số UNC|mã giao dịch|số giao dịch|payment ref|(?:^|(?<=[.;\n]))[ \t]*số chứng từ",
    "payment.contract_ref": r"hợp đồng tham chiếu|hợp đồng số|số hợp đồng|hợp đồng",
    "receipt.contract_ref": r"từ|hợp đồng tham chiếu|hợp đồng số",
    "receipt.scope_ref": r"phạm vi khoản thu|phạm vi",
}
_SENTENCE_END = re.compile(r"\.(?=\s|$)")
# A generic document number does not establish a payment reference. Support only
# the explicit UNC token, alone after this label, in the reviewed source layout.
_UNC_DOCUMENT_REF = re.compile(r"\s*:\s*(UNC(?:\d|[-\u2010])[A-Z0-9\u2010-]*)\s*", re.I)
_ROLE_SUFFIX = r"(?:\s+(?:hàng(?: hóa| hoá)?|tiền|dịch vụ|tiền hàng))?"
# Party aliases. A heading names a role only if (a part of) it IS one of these, e.g. "Bên bán (Bên B)".
_PARTY_ALIASES = {
    "borrower": r"bên (?:cung cấp|cung ứng|bán|nhận thầu|vay|đề nghị vay)|nhà (?:cung cấp|thầu)"
                r"|đơn vị (?:cung cấp|cung ứng|bán)|người (?:bán|vay)|khách hàng vay",
    "counterparty": r"bên (?:mua|đặt hàng|giao thầu)|đơn vị (?:mua|đặt hàng)|người mua|chủ đầu tư",
    "payee": r"bên (?:nhận|thụ hưởng)|người (?:nhận|thụ hưởng)|đơn vị (?:nhận|thụ hưởng)",
    "payer": r"bên (?:chuyển|trả|thanh toán)|người (?:chuyển|trả|nộp)|đơn vị (?:chuyển|trả|thanh toán)",
}
_PARTY_HEADING = {role: re.compile(rf"(?:{alias}){_ROLE_SUFFIX}", re.I) for role, alias in _PARTY_ALIASES.items()}
_PARTY_HEADING["borrower_name"] = re.compile(r"(?:tên )?doanh nghiệp", re.I)   # registration / BCTC / đề nghị vay
_PARTY_MENTION = {role: re.compile(rf"\b(?:{alias})\b", re.I) for role, alias in _PARTY_ALIASES.items()}
# Labels that describe the current party rather than open a new section.
_ATTRIBUTE_LABEL = re.compile(
    r"(?:mã số thuế|mst|mã số doanh nghiệp|mã số|tax id|địa chỉ|trụ sở|điện thoại|đt|email|fax|website"
    r"|số tài khoản|tài khoản|stk|ngân hàng|mở tại|(?:người )?đại diện|chức vụ|tên giao dịch|tên viết tắt"
    r"|giấy chứng nhận|giấy phép|ngày cấp|nơi cấp)\b", re.I)
_HEADING = re.compile(r"(?:^|(?<=[.;]))[ \t]*(?P<label>[^\n:.;]{1,60}?)[ \t]*:", re.M)
_AMBIGUOUS, _ATTRIBUTE, _UNKNOWN = "ambiguous", "attribute", "unknown"
_ROLES = {
    "borrower.tax_id": {"borrower"},
    "parties.borrower.tax_id": {"borrower"},
    "parties.counterparty.tax_id": {"counterparty"},
    "parties.payee.tax_id": {"payee", "borrower"},
    "parties.payer.tax_id": {"payer", "counterparty"},
}


def source_context(text: str, span: Span) -> str:
    """Expand a quote to its complete source sentences, including wrapped PDF lines."""
    start, end = 0, len(text)
    for boundary in _SENTENCE_END.finditer(text):
        if boundary.end() <= span.start:
            start = boundary.end()
        elif boundary.end() >= span.end:
            end = boundary.end()
            break
    return text[start:end]


def labeled_parts(key: str, text: str) -> list[str]:
    pattern = _LABELS.get(key)
    if pattern is None:
        return [text]
    boundaries = sorted({m.start() for p in _LABELS.values() for m in re.finditer(p, text, re.I)})
    parts = []
    for match in re.finditer(pattern, text, re.I):
        end = next((b for b in boundaries if b >= match.end()), len(text))
        sentence_end = _SENTENCE_END.search(text, match.end())
        if sentence_end:
            end = min(end, sentence_end.start())
        part = text[match.end():end]
        if key == "payment.ref" and match.group().strip().lower() == "số chứng từ":
            reference = _UNC_DOCUMENT_REF.fullmatch(part)
            if reference is None:
                continue
            part = reference.group(1)
        parts.append(part)
    return parts


def heading_role(label: str) -> str:
    """Role named by a `Label:` heading: a role, or attribute / ambiguous / unknown."""
    label = " ".join(nfc(label).split()).strip()
    # The reviewed PDF font maps parentheses to U+FD3E/U+FD3F. Split the
    # comparison label only; preserve aliases and the existing ambiguity rule.
    parts = [p.strip() for p in re.split(r"[()\ufd3e\ufd3f]", label) if p.strip()]
    roles = {("borrower" if role == "borrower_name" else role)
             for part in parts for role, pattern in _PARTY_HEADING.items() if pattern.fullmatch(part)}
    if not roles and _ATTRIBUTE_LABEL.match(label):
        # "MST bên mua:" names a party; "Mã số doanh nghiệp:" is just an attribute
        roles = {role for role, pattern in _PARTY_MENTION.items() if pattern.search(label)}
        if not roles:
            return _ATTRIBUTE
    if len(roles) > 1:
        return _AMBIGUOUS
    return roles.pop() if roles else _UNKNOWN


def party_role(text: str, position: int, max_distance: int = 400) -> str | None:
    """Role of the party section containing `position`. Sections are bounded by headings: an unrecognised
    heading ends the previous party's section instead of inheriting its role."""
    for heading in reversed(list(_HEADING.finditer(text, 0, position))):
        role = heading_role(heading["label"])
        if role == _ATTRIBUTE:
            continue
        if role in (_AMBIGUOUS, _UNKNOWN) or position - heading.end() > max_distance:
            return None
        return role
    return None


def _role_supported(key: str, value: str, spans: list[Span], texts: list[str]) -> bool:
    tax_id = normalize.tax_id(value)
    if tax_id is None:
        return False
    pattern = re.compile(r"(?<!\d)" + r"[\s.]*".join(map(re.escape, tax_id)) + r"(?!\s*-?\s*\d)")
    for span in spans:
        # Preserve source offsets: composing an NFD page here would move the tax
        # ID relative to the raw Span. Heading labels normalize separately.
        text = texts[span.page - 1].replace("\x03", " ").translate(_DASHES)
        for tax in pattern.finditer(text):
            if tax.start() >= span.end or tax.end() <= span.start:
                continue
            if party_role(text, tax.start()) in _ROLES[key]:
                return True
    return False


def check_source(key: str, value_type: str, value: str, spans: list[Span], texts: list[str],
                 registry: "Registry") -> Checked:
    """Check full source context separately from quotation authenticity."""
    if key in _ROLES and not _role_supported(key, value, spans, texts):
        return _reject("UNVERIFIED_FIELD_ROLE")
    supporting = spans
    if value_type == "decimal":
        supporting = [s for s in spans if check_value(key, value_type, value, s.text, registry).value is not None]
    contexts = list(dict.fromkeys(comparison_text(source_context(texts[s.page - 1], s)) for s in supporting))
    scoped = [part for context in contexts for part in labeled_parts(key, context)]
    if not scoped:
        return _reject("UNVERIFIED_FIELD_LABEL")
    if value_type == "decimal" and key != "financial.unit_multiplier":
        # The amount immediately after its label is the field value. A later fee,
        # date or percentage cannot justify a different proposed amount.
        checked = []
        allow_words = not key.startswith("financial.")
        for part in scoped:
            expressions = money_expressions(part, allow_words)
            first = expressions[0] if expressions else None
            if first is None or part[:first.start].strip(" \n\t:：="):
                return _reject("UNVERIFIED_FIELD_LABEL")
            if not first.complete:
                return _reject("INCOMPLETE_AMOUNT")   # never accept a prefix of "1 tỷ 500 triệu"
            if re.search(r"\b(?:hoặc|đến|or)\b", part, re.I):
                return _reject("AMBIGUOUS_NUMBER")
            checked.append(_amount(key, value, first.text))
        if any(c.value is None for c in checked):
            return _reject("VALUE_NOT_IN_FIELD")
        return next((c for c in checked if c.quality != "readable"), checked[0])
    return check_value(key, value_type, value, "\n".join(scoped), registry)


@dataclass(frozen=True)
class Registry:
    document_types: dict[str, list[dict]]
    enum_values: dict[str, list[str]]
    date_fields: frozenset[str]

    @classmethod
    def from_json(cls, raw: dict) -> "Registry":
        return cls(raw["document_types"], raw["enum_values"], frozenset(raw["date_fields"]))

    def fields(self, doc_type: str) -> list[dict]:
        return self.document_types[doc_type]
