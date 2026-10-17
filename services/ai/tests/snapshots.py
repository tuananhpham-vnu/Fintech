"""Dựng biến thể snapshot từ gold G01–G03 cho test rule (mọi biến thể vẫn phải hợp lệ schema 1.0.2)."""
from __future__ import annotations

import copy
import hashlib
import json
import uuid
from typing import Any, Callable

from runner.config import DEFAULT_CONTRACTS_DIR

GOLD = json.loads((DEFAULT_CONTRACTS_DIR / "fixtures" / "golden-cases.json").read_text("utf-8"))
TEST_NS = uuid.UUID("6f1c2d3e-0000-4000-8000-000000000001")


def snapshot_hash(snapshot: dict) -> str:
    """Quy ước backend (README bundle): sort keys, UTF-8, compact JSON."""
    return hashlib.sha256(json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def gold_input(index: int) -> dict:
    return copy.deepcopy(GOLD[index]["input"])


def variant(index: int, mutate: Callable[[dict], Any]) -> dict:
    data = gold_input(index)
    mutate(data["snapshot"])
    data["snapshot_hash"] = snapshot_hash(data["snapshot"])
    return data


def doc(snapshot: dict, filename: str) -> dict:
    return next(d for d in snapshot["documents"] if d["document"]["filename"] == filename)


# Câu nguồn giả lập cho giá trị đã sửa: biến thể phải nhất quán như snapshot thật (giá trị nằm trong quote, quote nằm
# nguyên văn trên trang), nếu không input guard của evaluate chặn đúng như với dữ liệu bị sửa trái phép.
QUOTES: dict[str, Any] = {
    "payment.ref": "Số UNC: {v}", "payment.contract_ref": "Hợp đồng số: {v}",
    "parties.payee.tax_id": "Bên nhận: Mã số thuế: {v}", "parties.payer.tax_id": "Bên chuyển: Mã số thuế: {v}",
    "money.currency": "Loại tiền: {v}", "acceptance.ref": "Số biên bản: {v}",
    "payment.status": {"completed": "Trạng thái: Thành công", "pending": "Trạng thái: Đang xử lý"},
    "receipt.claim_type": {"received": "Khoản thu đã nhận đủ.", "expected": "Khoản thu dự kiến.", "due": "Khoản thu đến hạn."},
}


def source_quote(key: str, value: Any) -> str:
    template = QUOTES.get(key)
    if isinstance(template, dict):
        return template[value]
    if key.endswith(".amount"):
        return f"Số tiền: {value} VND"
    if key.endswith(".date") and isinstance(value, str) and len(value) == 10:
        y, m, d = value.split("-")
        return f"Ngày: {d}/{m}/{y}"
    return (template or "{v}").format(v=value)


def ground(snapshot_document: dict, field: dict, quote: str) -> None:
    """Gắn field với một evidence mới có quote nằm nguyên văn trên trang 1 (thêm dòng vào trang nếu chưa có)."""
    ex, doc_id = snapshot_document["extraction"], snapshot_document["document"]["id"]
    page = ex["pages"][0]
    if quote not in page["text"]:
        page["text"] = page["text"].rstrip("\n") + "\n" + quote
    ev_id = str(uuid.uuid5(TEST_NS, f"{doc_id}:ev:{field['field_key']}:{quote}"))
    if not any(e["id"] == ev_id for e in ex["evidence"]):
        ex["evidence"].append({"id": ev_id, "document_id": doc_id, "page": 1, "quote": quote, "bbox": None,
                               "precision": "page"})
    field.update(raw_value=quote, evidence_ids=[ev_id])


def set_field(snapshot_document: dict, key: str, value: Any, raw: str | None = None) -> None:
    field = next(f for f in snapshot_document["extraction"]["fields"] if f["field_key"] == key)
    field["value"] = value
    if isinstance(value, str):
        ground(snapshot_document, field, raw if raw is not None else source_quote(key, value))
    elif raw is not None:
        field["raw_value"] = raw


def blank_field(snapshot_document: dict, key: str, reason: str = "unreadable") -> None:
    field = next(f for f in snapshot_document["extraction"]["fields"] if f["field_key"] == key)
    field.update(value=None, raw_value=None, quality="unreadable", evidence_ids=[], missing_reason=reason)


def remove(snapshot: dict, filename: str) -> None:
    snapshot["documents"] = [d for d in snapshot["documents"] if d["document"]["filename"] != filename]


def clone(snapshot: dict, filename: str, new_filename: str, doc_type: str | None = None,
          fields: dict[str, str] | None = None, response_request_id: Any = "keep") -> dict:
    """Bản sao tài liệu với ID mới (document/evidence/field); có thể đổi loại và bộ field theo registry."""
    source = copy.deepcopy(doc(snapshot, filename))
    seed = new_filename
    new_id = str(uuid.uuid5(TEST_NS, seed))
    d = source["document"]
    d.update(id=new_id, logical_document_id=new_id, filename=new_filename)
    if response_request_id != "keep":
        d["response_request_id"] = response_request_id
    ex = source["extraction"]
    ex["document_id"] = new_id
    evidence_map = {}
    for e in ex["evidence"]:
        evidence_map[e["id"]] = str(uuid.uuid5(TEST_NS, f"{seed}:ev:{e['id']}"))
        e.update(id=evidence_map[e["id"]], document_id=new_id)
    for f in ex["fields"]:
        f.update(id=str(uuid.uuid5(TEST_NS, f"{seed}:f:{f['field_key']}")), document_id=new_id,
                 evidence_ids=[evidence_map[x] for x in f["evidence_ids"]])
    if doc_type:
        d["type"] = d["declared_type"] = ex["detected_type"] = doc_type
    if fields is not None:
        ex["fields"] = []
        for k, v in fields.items():
            f = {"id": str(uuid.uuid5(TEST_NS, f"{seed}:f:{k}")), "document_id": new_id, "field_key": k,
                 "raw_value": v, "value": v, "quality": "readable", "evidence_ids": [], "missing_reason": None}
            ex["fields"].append(f)
            ground(source, f, source_quote(k, v))
    snapshot["documents"].append(source)
    return source


def payment_record(snapshot: dict, filename: str, amount: str, status: str = "completed",
                   contract_ref: str = "HĐ01", payee: str = "0000000001", payer: str = "0000000002") -> dict:
    template = "06_correct_record.pdf" if any(x["document"]["filename"] == "06_correct_record.pdf"
                                              for x in snapshot["documents"]) else "04_contract.pdf"
    return clone(snapshot, template, filename, doc_type="payment_record", response_request_id=None, fields={
        "payment.ref": "UNC-" + filename, "payment.contract_ref": contract_ref, "parties.payee.tax_id": payee,
        "parties.payer.tax_id": payer, "payment.date": "2026-10-20", "payment.amount": amount,
        "money.currency": "VND", "payment.status": status})


def acceptance_record(snapshot: dict, filename: str, response: bool = True, **fields: str) -> dict:
    """Biên bản dựa trên NT01 đúng (G03); `fields` ghi đè theo field_key với '.' thay bằng '__'."""
    base = GOLD[2]["input"]["snapshot"]
    if not any(x["document"]["filename"] == "06_correct_record.pdf" for x in snapshot["documents"]):
        snapshot["documents"].append(copy.deepcopy(doc(base, "06_correct_record.pdf")))
        snapshot["documents"][-1]["document"]["filename"] = "__template__"
        template = "__template__"
    else:
        template = "06_correct_record.pdf"
    request_id = snapshot["requests"][0]["id"] if (response and snapshot["requests"]) else None
    record = clone(snapshot, template, filename, response_request_id=request_id)
    if template == "__template__":
        remove(snapshot, "__template__")
    for key, value in fields.items():
        set_field(record, key.replace("__", "."), value)
    return record
