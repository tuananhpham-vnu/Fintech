"""Ca khó: rule deterministic không đọc được -> nhờ LLM (qua guard); bị chặn -> HITL (người duyệt quyết định).

Thứ tự ưu tiên cho điều khoản thanh toán của hợp đồng:
  1. Người duyệt đã hiệu chỉnh field (correct_field)  -> dùng giá trị người, KHÔNG gọi LLM (đóng vòng HITL).
  2. Extraction đã cấu trúc đủ (không còn "unknown")    -> dùng luôn, không gọi LLM.
  3. Còn trống/unknown nhưng có văn bản nguồn            -> LLM đọc ngữ nghĩa, output qua guard. Kết quả CHỈ là
     gợi ý (LLM_SUGGESTION + REVIEW_REQUIRED + lý do nguồn chưa xác thực), không bao giờ thành điều kiện đã xác
     thực: model thứ hai đọc lại cùng văn bản không phải căn cứ độc lập. Giá trị đã biết mà LLM nói khác -> HITL.
  4. Văn bản nghi prompt injection / không có provider / guard từ chối -> giữ giá trị deterministic (thường là
     unknown) + REVIEW_REQUIRED + diagnostic để đưa vào hàng chờ người duyệt.
AI không bao giờ tự ghi human_status: HITL ở đây là đề xuất "cần người xem", backend/UI xử lý quyết định.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from linking import Doc, Field, SnapshotView

UNKNOWN_SENSITIVE = ("event_type", "calendar_basis", "counting_convention", "other_conditions_state")

# Câu giả làm chỉ dẫn trong tài liệu (T19/A07). Chỉ để gắn cờ cho người xem, không tự kết luận gian lận.
INJECTION = re.compile(
    r"(bỏ qua|phớt lờ|bỏ hết)[^.\n]{0,40}(hướng dẫn|chỉ dẫn|quy tắc)"
    r"|ignore (all |any |the )?(previous |prior |above )?instructions"
    r"|(phê duyệt|duyệt|chấp thuận) (khoản )?vay"
    r"|system prompt|<\s*/?\s*(system|instruction)s?\s*>",
    re.IGNORECASE)

REVIEW_REQUIRED = "REVIEW_REQUIRED"


class SemanticResolver(Protocol):
    model_id: str
    prompt_version: str

    def __call__(self, source_text: str) -> Any: ...


@dataclass
class ConditionResolution:
    condition: dict | None
    reason_codes: list[str] = field(default_factory=list)
    llm_used: bool = False


def diagnostic(view: SnapshotView, code: str, message: str, doc: Doc | None = None, field_key: str | None = None) -> None:
    entry = {"code": code, "message": message, "document_id": doc.id if doc else None, "field_key": field_key}
    if entry not in view.diagnostics:
        view.diagnostics.append(entry)


def flag_suspicious_documents(view: SnapshotView) -> None:
    """Gắn cờ HITL cho mọi trang có câu dạng chỉ dẫn; nội dung tài liệu luôn chỉ là dữ liệu."""
    for doc in view.docs:
        for page in (doc.extraction or {}).get("pages", []):
            if INJECTION.search(page["text"]):
                diagnostic(view, "SUSPECTED_PROMPT_INJECTION",
                           f"Trang {page['page']} có câu dạng chỉ dẫn; đã bỏ qua, cần người duyệt xem nguồn.", doc)
                break


def source_text(doc: Doc, f: Field) -> str | None:
    """Văn bản nguồn của field: raw_value, nếu không có thì các trang chứa evidence của field."""
    if f.raw_value and f.raw_value.strip():
        return f.raw_value
    extraction = doc.extraction or {}
    pages = {e["page"] for e in extraction.get("evidence", []) if e["id"] in set(f.evidence_ids)}
    texts = [p["text"] for p in extraction.get("pages", []) if not pages or p["page"] in pages]
    joined = "\n".join(t for t in texts if t.strip())
    return joined or None


def source_state(doc: Doc, f: Field) -> str:
    """Vì sao extraction không xác thực field: nguồn OCR, bị guard M2 từ chối, hay chỉ uncertain."""
    extraction = doc.extraction or {}
    pages = {e["page"] for e in extraction.get("evidence", []) if e["id"] in set(f.evidence_ids)}
    if any(p["method"] == "ocr" for p in extraction.get("pages", []) if p["page"] in pages):
        return "SOURCE_OCR_UNVERIFIED"
    if any(d["code"] == "PAYMENT_CONDITION_UNVERIFIED" and d["field_key"] == f.key
           for d in extraction.get("diagnostics", [])):
        return "SOURCE_REJECTED_BY_EXTRACTION"
    return "SOURCE_UNCERTAIN"


def needs_semantic(f: Field | None) -> bool:
    if f is None or f.corrected:
        return False
    if f.value is None:
        return f.missing_reason in (None, "unreadable", "ambiguous") and bool(f.raw_value or f.evidence_ids)
    return isinstance(f.value, dict) and any(f.value.get(k) == "unknown" for k in UNKNOWN_SENSITIVE)


def resolve_payment_condition(view: SnapshotView, contract: Doc, semantic: SemanticResolver | None) -> ConditionResolution:
    key = "contract.payment_condition"
    f = contract.get(key)
    current = contract.value(key)
    if not needs_semantic(f):
        return ConditionResolution(current)

    text = source_text(contract, f)
    if not text:
        return ConditionResolution(current, [REVIEW_REQUIRED, "CONDITION_SOURCE_MISSING"])
    if INJECTION.search(text):
        diagnostic(view, "SUSPECTED_PROMPT_INJECTION",
                   "Điều khoản thanh toán chứa câu dạng chỉ dẫn; không gửi LLM, cần người duyệt đọc nguồn.", contract, key)
        return ConditionResolution(current, [REVIEW_REQUIRED, "SUSPECTED_PROMPT_INJECTION"])
    if semantic is None:
        diagnostic(view, "SEMANTIC_PROVIDER_UNAVAILABLE",
                   "Điều khoản cần đọc ngữ nghĩa nhưng chưa cấu hình LLM; giữ kết quả deterministic.", contract, key)
        return ConditionResolution(current, [REVIEW_REQUIRED, "SEMANTIC_PROVIDER_UNAVAILABLE"])

    result = semantic(text)
    if result.status == "unavailable":
        diagnostic(view, "PROVIDER_UNAVAILABLE", "LLM không phản hồi trong budget; giữ kết quả deterministic.", contract, key)
        return ConditionResolution(current, [REVIEW_REQUIRED, "PROVIDER_UNAVAILABLE"])
    if result.status == "rejected":
        paths = ", ".join(sorted({v.path for v in result.violations}))
        diagnostic(view, "LLM_OUTPUT_REJECTED", f"Guard từ chối đề xuất LLM ({paths}); cần người duyệt.", contract, key)
        return ConditionResolution(current, [REVIEW_REQUIRED, "LLM_OUTPUT_REJECTED"])

    proposed = result.condition
    if isinstance(current, dict):
        conflicts = [k for k, v in current.items() if v not in ("unknown", None, []) and proposed.get(k) != v]
        if conflicts:
            diagnostic(view, "LLM_CONFLICT", f"LLM mâu thuẫn với giá trị đã trích ({', '.join(sorted(conflicts))}).",
                       contract, key)
            return ConditionResolution(current, [REVIEW_REQUIRED, "LLM_CONFLICT"])
    # Trust boundary: tới đây extraction KHÔNG xác thực được điều khoản (bị guard M2 từ chối, uncertain hoặc chỉ có
    # từ OCR). Một model khác đọc lại cùng văn bản không phải căn cứ độc lập: kết quả chỉ là gợi ý cho người duyệt,
    # giữ giá trị deterministic. Người duyệt chấp nhận bằng correct_field (vòng HITL ở mục 1).
    view.llm_used = True
    state = source_state(contract, f)
    summary = ", ".join(f"{k}={proposed.get(k)}" for k in
                        ("event_type", "offset_days", "calendar_basis", "counting_convention", "other_conditions_state"))
    diagnostic(view, "LLM_SUGGESTION", f"{result.model_id} đề xuất điều kiện thanh toán qua guard ({summary}); "
                                       f"nguồn chưa được extraction xác thực ({state}) nên chỉ là gợi ý, người duyệt "
                                       f"xác nhận bằng correct_field.", contract, key)
    return ConditionResolution(current, [REVIEW_REQUIRED, "LLM_SUGGESTION_UNVERIFIED", state], llm_used=True)
