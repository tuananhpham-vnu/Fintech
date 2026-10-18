"""Kiểm câu trả lời của model trước khi trả: trích dẫn phải khớp nguyên văn trang nguồn trong case, số liệu phải có nguồn.

- Trích dẫn tới tài liệu/trang không có trong case: bị bỏ (CITATION_OUT_OF_SCOPE).
- Quote không khớp nguyên văn hoặc rơi vào dòng bị che vì nghi chỉ dẫn: giữ lại nhưng verified=false (UNVERIFIED_CITATION).
- Số trong câu trả lời không thấy trong hồ sơ/chỉ số/câu hỏi: UNSOURCED_NUMBER (cảnh báo, người đọc tự đối chiếu).
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

from extraction import grounding

from .context import Context

_MARKER = re.compile(r"\[(\d{1,2})\]")
# Mã nội bộ của prompt (D1, M2, R10) không có nghĩa với người đọc: bỏ khỏi câu trả lời, giữ dấu số [n].
_ALIAS_GROUP = re.compile(r"(\s*)\[((?:\s*(?:[DM]\d{1,3}|R\d{2,3}|\d{1,2})\s*,?)+)\]")
_ALIAS = re.compile(r"\b(?:[DM]\d{1,3}|R\d{2,3})\b")
_ALIAS_PAREN = re.compile(r"\s*\((?:\s*(?:[DM]\d{1,3}|R\d{2,3})\s*,?)+\)")
# Số kèm đơn vị (vi/en/zh): "30 triệu", "1.000 triệu", "500 million", "1000万", "10亿" -> giá trị tuyệt đối.
_SCALES = {"nghìn": 10**3, "ngàn": 10**3, "triệu": 10**6, "tỷ": 10**9, "tỉ": 10**9, "thousand": 10**3,
           "million": 10**6, "billion": 10**9, "千": 10**3, "万": 10**4, "亿": 10**8}
_SCALED = re.compile(r"(?<![\w.,])(\d+(?:[.,]\d+)*)\s*(nghìn|ngàn|triệu|tỷ|tỉ|thousand|million|billion|千|万|亿)",
                     re.IGNORECASE)


def _clean_aliases(answer: str) -> str:
    def repl(match: re.Match) -> str:
        numbers = re.findall(r"\d{1,2}", _ALIAS.sub("", match.group(2)))
        return match.group(1) + "".join(f"[{n}]" for n in numbers) if numbers else ""
    return _ALIAS_PAREN.sub("", _ALIAS_GROUP.sub(repl, answer))


def _parse_number(token: str) -> Decimal | None:
    """'1.000' / '1,000' (phân cách nghìn) -> 1000; '1,5' / '0.6' (thập phân) -> 1.5 / 0.6."""
    if re.fullmatch(r"\d{1,3}(?:[.,]\d{3})+", token):
        token = re.sub(r"[.,]", "", token)
    else:
        token = token.replace(",", ".")
    try:
        return Decimal(token)
    except InvalidOperation:
        return None


def _scaled_amounts(text: str) -> list[tuple[str, Decimal]]:
    found = []
    for match in _SCALED.finditer(text):
        number = _parse_number(match.group(1))
        if number is not None:
            found.append((match.group(0), number * _SCALES[match.group(2).lower()]))
    return found


def _known_amounts(payload: dict, context: Context) -> set[Decimal]:
    """Giá trị tuyệt đối có trong nguồn: số trơn, số trơn x đơn vị được nhắc trên cùng trang, số kèm đơn vị."""
    known: set[Decimal] = set()
    texts = [payload["question"]] + [t["content"] for t in payload["history"]]
    texts += [f["value"] for view in context.docs for f in view.doc["fields"] if f["value"]]
    texts += [m.as_output()["value"] for _, m in context.metrics if m.value is not None]
    for text in texts:
        known |= {_parse_number(t) for t in _NUMBER.findall(text)} - {None}
        known |= {value for _, value in _scaled_amounts(text)}
    for view in context.docs:
        for page in view.pages.values():
            plain = {_parse_number(t) for t in _NUMBER.findall(page)} - {None}
            scales = {_SCALES[w.lower()] for w in re.findall("|".join(_SCALES), page, re.IGNORECASE)}
            known |= plain | {p * s for p in plain for s in scales}
            known |= {value for _, value in _scaled_amounts(page)}
    return {k.normalize() for k in known}
_NUMBER = re.compile(r"(?<![\w.,])\d(?:[\d.,]*\d)?(?![\w])")


def _number_key(token: str) -> str | None:
    digits = re.sub(r"\D", "", token)
    if len(digits) < 3:                    # 1-2 chữ số (số thứ tự, ngày, tháng) quá dễ trùng: không kiểm
        return None
    return digits.lstrip("0").rstrip("0") or "0"


def _metric_variants(value: str) -> set[str]:
    """Chỉ số 0.6000 có thể được viết 0,6 / 0.60 / 60%; tất cả về cùng khóa chữ số."""
    variants = {value}
    if "." in value:
        whole, frac = value.split(".", 1)
        for places in (1, 2, 3, 4):
            variants.add(f"{whole}.{frac[:places]}")
    try:
        percent = float(value) * 100
        variants |= {f"{percent:.0f}", f"{percent:.1f}", f"{percent:.2f}"}
    except ValueError:
        pass
    return variants


def _known_numbers(payload: dict, context: Context) -> set[str]:
    texts = [payload["question"]] + [t["content"] for t in payload["history"]]
    for view in context.docs:
        texts += list(view.pages.values())
        texts += [f["value"] for f in view.doc["fields"] if f["value"]]
    for _, metric in context.metrics:
        value = metric.as_output()["value"]
        if value is not None:
            texts += sorted(_metric_variants(value))
    keys = set()
    for text in texts:
        for match in _NUMBER.finditer(text):
            key = _number_key(match.group())
            if key:
                keys.add(key)
    return keys


def check(raw: dict, payload: dict, context: Context) -> tuple[str, list[dict], list[dict], list[str]]:
    """-> (answer, citations, diagnostics, metric refs đã dùng)."""
    diagnostics: list[dict] = []
    citations, seen = [], set()
    for item in raw.get("citations") or []:
        if not isinstance(item, dict):
            continue
        cid, alias, page, quote = item.get("id"), item.get("doc"), item.get("page"), item.get("quote")
        view = context.by_alias(alias) if isinstance(alias, str) else None
        if not isinstance(cid, int) or not 1 <= cid <= 99 or cid in seen or view is None \
                or not isinstance(page, int) or page not in view.pages or not isinstance(quote, str):
            diagnostics.append({"code": "CITATION_OUT_OF_SCOPE",
                                "message": "Đã bỏ một trích dẫn không trỏ tới trang nào trong case."})
            continue
        seen.add(cid)
        span = grounding.find_quote(page, view.pages[page], quote, view.blocked[page])
        if span is None:
            diagnostics.append({"code": "UNVERIFIED_CITATION",
                                "message": f"Trích dẫn [{cid}] không khớp nguyên văn trang {page} của "
                                           f"{view.doc['name'][:120]}; cần đối chiếu nguồn."})
        citations.append({"id": cid, "document_id": view.doc["document_id"], "page": page,
                          "quote": (span.text if span else quote)[:1000], "verified": span is not None})
    citations = citations[:30]

    answer = _clean_aliases(str(raw.get("answer") or "").strip())[:8000]
    cited = {c["id"] for c in citations}
    dangling = sorted({int(m) for m in _MARKER.findall(answer)} - cited)
    if dangling:
        diagnostics.append({"code": "MISSING_CITATION",
                            "message": "Câu trả lời nhắc tới trích dẫn không hợp lệ: "
                                       + ", ".join(f"[{n}]" for n in dangling[:10])})
    if not citations and context.docs and not raw.get("insufficient_information"):
        diagnostics.append({"code": "NO_CITATIONS", "message": "Câu trả lời không có trích dẫn nguồn nào."})
    if raw.get("insufficient_information"):
        diagnostics.append({"code": "INSUFFICIENT_INFORMATION",
                            "message": "Hồ sơ trong case không đủ thông tin để trả lời đầy đủ."})

    known = _known_numbers(payload, context)
    cleaned = _MARKER.sub(" ", answer)
    amounts = _known_amounts(payload, context)
    scaled = _scaled_amounts(cleaned)
    unsourced = {text for text, value in scaled if value.normalize() not in amounts}
    plain_text = _SCALED.sub(" ", cleaned)        # số đã kiểm theo đơn vị không kiểm lại theo chữ số
    unsourced |= {m.group().strip() for m in _NUMBER.finditer(plain_text)
                  if (key := _number_key(m.group())) and key not in known}
    unsourced = sorted(unsourced)
    if unsourced:
        diagnostics.append({"code": "UNSOURCED_NUMBER",
                            "message": "Số không tìm thấy trong hồ sơ hoặc chỉ số: " + ", ".join(unsourced[:10])})

    refs = [r for r in (raw.get("metric_ids") or []) if isinstance(r, str)]
    return answer, citations, diagnostics, refs
