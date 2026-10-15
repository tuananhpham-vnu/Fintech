"""Kiểm toàn vẹn EvaluationInput SAU JSON Schema, TRƯỚC khi rule chạy (contracts §147: ID sai/cross-case/quote vô căn cứ
bị chặn, không âm thầm bỏ evidence rồi vẫn kết luận).

Schema chỉ kiểm hình dạng. Ở đây kiểm các tham chiếu trong snapshot có thật sự cùng một case, cùng một tài liệu:
  - case/revision của snapshot khớp input; document/request/issue/decision đều thuộc case_id;
  - extraction thuộc đúng tài liệu (document_id, case_id, sha256 của file);
  - ID không trùng; evidence thuộc đúng tài liệu, trang tồn tại, quote nguyên văn có trên trang;
  - field chỉ dẫn evidence của chính tài liệu; field readable phải có giá trị nằm trong chính quote của nó (cùng bộ
    so khớp extraction dùng: MST, tiền, ngày, enum, mã); correction trỏ field có thật trong snapshot;
  - tài liệu bổ sung chỉ trả lời request có trong snapshot.
Không tính lại snapshot_hash/extraction_hash: backend là bên duy nhất tạo hash (contracts §316).
Vi phạm -> 422 INVALID_REQUEST kèm JSON pointer; rule không chạy trên dữ liệu không nhất quán.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

from .contracts import Violation

MAX_VIOLATIONS = 50


def evaluation_input_violations(inp: dict, registry: Any = None) -> list[Violation]:
    """`registry` (extraction.grounding.Registry) bật kiểm giá trị field so với quote; None thì bỏ qua bước này."""
    found: list[Violation] = []
    case_id, snapshot = inp["case_id"], inp["snapshot"]

    def check(ok: bool, path: str, message: str) -> None:
        if not ok:
            found.append(Violation(path, message))

    check(snapshot["case"]["id"] == case_id, "/snapshot/case/id", "must equal case_id")
    check(snapshot["case"]["revision"] == inp["case_revision"], "/snapshot/case/revision", "must equal case_revision")

    for name in ("requests", "existing_issues", "corrections"):
        for i, item in enumerate(snapshot[name]):
            check(item["case_id"] == case_id, f"/snapshot/{name}/{i}/case_id", "belongs to another case")

    documents = snapshot["documents"]
    doc_ids = [d["document"]["id"] for d in documents]
    for doc_id, count in Counter(doc_ids).items():
        check(count == 1, "/snapshot/documents", f"document {doc_id} appears {count} times")

    request_ids = {r["id"] for r in snapshot["requests"]}
    field_ids: set[str] = set()
    evidence_owner: dict[str, str] = {}
    for i, entry in enumerate(documents):
        where, document, extraction = f"/snapshot/documents/{i}", entry["document"], entry["extraction"]
        check(document["case_id"] == case_id, f"{where}/document/case_id", "belongs to another case")
        response_to = document["response_request_id"]
        check(response_to is None or response_to in request_ids, f"{where}/document/response_request_id",
              "answers a request that is not in this snapshot")
        if extraction is None:
            continue
        check(extraction["document_id"] == document["id"], f"{where}/extraction/document_id",
              "extraction belongs to another document")
        check(extraction["case_id"] == case_id, f"{where}/extraction/case_id", "extraction belongs to another case")
        check(extraction["sha256"] == document["sha256"], f"{where}/extraction/sha256",
              "extraction was made from different file bytes")

        pages = {p["page"]: p["text"] for p in extraction["pages"]}
        own_evidence = set()
        for j, ev in enumerate(extraction["evidence"]):
            path = f"{where}/extraction/evidence/{j}"
            check(ev["id"] not in evidence_owner, f"{path}/id", "evidence id is reused")
            evidence_owner[ev["id"]] = document["id"]
            own_evidence.add(ev["id"])
            check(ev["document_id"] == document["id"], f"{path}/document_id", "evidence belongs to another document")
            if ev["page"] not in pages:
                check(False, f"{path}/page", f"document has no page {ev['page']}")
            else:
                check(ev["quote"] in pages[ev["page"]], f"{path}/quote", "quote is not verbatim on that page")

        for j, f in enumerate(extraction["fields"]):
            path = f"{where}/extraction/fields/{j}"
            check(f["id"] not in field_ids, f"{path}/id", "field id is reused")
            field_ids.add(f["id"])
            check(f["document_id"] == document["id"], f"{path}/document_id", "field belongs to another document")
            stray = [e for e in f["evidence_ids"] if e not in own_evidence]
            check(not stray, f"{path}/evidence_ids", "cites evidence that is not in this document")
            check(f["value"] is None or bool(f["evidence_ids"]), f"{path}/evidence_ids",
                  "a value without evidence cannot be used")
            if registry is not None and not stray:
                quotes = " ".join(e["quote"] for e in extraction["evidence"] if e["id"] in f["evidence_ids"])
                check(_value_supported(registry, document["type"], f, quotes), f"{path}/value",
                      "value is not supported by its own quotes")

    for i, decision in enumerate(snapshot["corrections"]):
        correction = (decision.get("payload") or {}).get("correction")
        if correction:
            check(correction["field_id"] in field_ids, f"/snapshot/corrections/{i}/payload/correction/field_id",
                  "corrects a field that is not in this snapshot")
            stray = [e for e in correction.get("evidence_ids", []) if e not in evidence_owner]
            check(not stray, f"/snapshot/corrections/{i}/payload/correction/evidence_ids",
                  "cites evidence that is not in this snapshot")

    return found[:MAX_VIOLATIONS]


def _value_supported(registry: Any, doc_type: str, f: dict, quotes: str) -> bool:
    """Chỉ field readable dạng chuỗi; điều kiện thanh toán (object) và document.summary có guard riêng."""
    from extraction import grounding   # cùng bộ so khớp đã dùng khi trích xuất

    if f["quality"] != "readable" or not isinstance(f["value"], str) or f["field_key"] == "document.summary":
        return True
    spec = next((s for s in registry.document_types.get(doc_type, []) if s["field_key"] == f["field_key"]), None)
    if spec is None:
        return False   # field ngoài registry của loại tài liệu này
    checked = grounding.check_value(f["field_key"], spec["value_type"], f["value"], quotes, registry)
    return checked.value is not None and str(checked.value) == f["value"]
