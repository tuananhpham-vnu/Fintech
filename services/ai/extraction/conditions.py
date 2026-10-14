"""Additional M2 grounding; leave the shared M3 semantic adapter unchanged."""
import re

from . import grounding


_PAYMENT = re.compile(r"thanh toán|trả tiền|payment", re.I)
_TERM = re.compile(r"(?<![\w\d])(?P<days>\d+)\s+ngày(?:\s+(?P<basis>lịch|làm việc))?\b", re.I)
_TRIGGER = re.compile(r"(?:sau(?:\s+khi)?|kể từ(?:\s+khi)?)\s+(?:ngày\s+)?"
                      r"(?P<event>nghiệm thu|xuất hóa đơn|nhận hóa đơn|giao hàng|ký hợp đồng)", re.I)
# "không quá / không muộn hơn 30 ngày" bounds the term; it does not negate it.
_NEGATED_TRIGGER = re.compile(r"\b(?:không(?!\s+(?:quá|vượt quá|muộn hơn|chậm hơn|trễ hơn))|chưa|chẳng)\b[^.;]*$",
                              re.I)
# The clause exists on paper but is not in force: "... sau nghiệm thu S1 không áp dụng", "bị hủy bỏ".
_INAPPLICABLE = re.compile(
    r"\b(?:không|chưa|ngừng|thôi|không còn)\s+(?:được\s+)?(?:áp dụng|có hiệu lực|hiệu lực|thực hiện)(?:\s+nữa)?\s*(?:[,;!?]|$)"
    r"|\b(?:bị|đã bị|được|đã được)\s+(?:hủy|huỷ|bãi bỏ|thay thế|loại bỏ|sửa đổi|tạm dừng|đình chỉ)\b"
    r"|\b(?:vô hiệu|hết hiệu lực|không còn hiệu lực)\b", re.I)
# Hypothetical or draft wording: the term is not an unconditional obligation.
_QUALIFIED = re.compile(r"\b(?:nếu|trừ khi|trừ trường hợp|trong trường hợp|giả sử|tùy theo|tuỳ theo"
                        r"|có thể được|dự thảo|đề xuất)\b", re.I)
# A later sentence revoking "the clause above" / "Điều 4".
_BACK_REFERENCE = re.compile(r"\b(?:điều khoản|quy định|nội dung|thời hạn)(?:\s+thanh toán)?\s+(?:trên|này|nêu trên)\b"
                             r"|\bđiều\s+\d+\b", re.I)


def in_force(contexts: list[str]) -> bool:
    """Every clause stating the payment term/trigger must be unconditional and not revoked."""
    sentences = [s for context in contexts for s in grounding._SENTENCE_END.split(context)]
    stated = [s for s in sentences if _PAYMENT.search(s) and (_TERM.search(s) or _TRIGGER.search(s))]
    if any(_INAPPLICABLE.search(s) or _QUALIFIED.search(s) for s in stated):
        return False
    revoked = [s for s in sentences if _INAPPLICABLE.search(s) and _BACK_REFERENCE.search(s)]
    return not revoked
_EXCLUDE_DAY = re.compile(r"không (?:được )?(?:tính|kể)(?: cả)?[^.;]{0,30}ngày"
                          r"|ngày[^.;]{0,40}không (?:được )?(?:tính|kể)", re.I)
_INCLUDE_DAY = re.compile(r"(?:tính|kể) cả ngày|bao gồm (?:cả )?ngày"
                          r"|ngày[^.;]{0,40}(?:cũng )?được (?:tính|kể)", re.I)
_ADDITIONAL = re.compile(r"ngoài ra|với điều kiện|điều kiện(?: thanh toán)? (?:khác|bổ sung)"
                         r"|phải (?:nộp|cung cấp)", re.I)


def supported(condition: dict, contexts: list[str], quote: str) -> bool:
    """Every specified interpretation must describe the actual payment clause.

    Calendar/counting/other-state checks also remain in the shared schema guard.
    Unknown interpretations stay uncertain in the caller.
    """
    clauses = []
    for context in contexts:
        for clause in grounding._SENTENCE_END.split(context):
            if _PAYMENT.search(clause):
                clauses.append(clause)
    if not clauses or not in_force(contexts):
        return False
    event = condition["event_type"]
    offset = condition["offset_days"]
    scope = condition["scope_ref"]
    # A model cannot hide a contradictory term by selecting a shorter quote.
    events, offsets, bases = set(), set(), set()
    for clause in clauses:
        for trigger in _TRIGGER.finditer(clause):
            if not _NEGATED_TRIGGER.search(clause[:trigger.start()]):
                events.add("acceptance" if trigger['event'].lower() == "nghiệm thu" else "other")
        for term in _TERM.finditer(clause):
            offsets.add(int(term['days']))
            bases.add({"lịch": "calendar_days", "làm việc": "business_days"}.get(
                (term['basis'] or "").lower(), "unknown"))
    if event != "unknown" and events != {event}:
        return False
    if offset is not None and offsets != {offset}:
        return False
    if condition["calendar_basis"] != "unknown" and bases != {condition["calendar_basis"]}:
        return False
    # Require the claimed trigger/term in the selected evidence as well.
    quote_events = {"acceptance" if m['event'].lower() == "nghiệm thu" else "other"
                    for m in _TRIGGER.finditer(quote) if not _NEGATED_TRIGGER.search(quote[:m.start()])}
    if event != "unknown" and quote_events != {event}:
        return False
    if offset is not None and {int(m['days']) for m in _TERM.finditer(quote)} != {offset}:
        return False
    if scope is not None and grounding._verbatim(scope, " ".join(clauses)).value is None:
        return False
    source = " ".join(contexts)
    conventions = set()
    if _EXCLUDE_DAY.search(source):
        conventions.add("exclude_event_day")
    for match in _INCLUDE_DAY.finditer(source):
        if not _NEGATED_TRIGGER.search(source[:match.start()]) and not re.search(r"\bkhông\b", match[0], re.I):
            conventions.add("include_event_day")
    counting = condition["counting_convention"]
    if counting != "unknown" and conventions != {counting}:
        return False
    if condition["other_conditions_state"] == "none":
        if any(not _NEGATED_TRIGGER.search(source[:m.start()]) for m in _ADDITIONAL.finditer(source)):
            return False
    for other in condition["other_conditions"]:
        if grounding._verbatim(other, quote).value is None:
            return False
    return True
