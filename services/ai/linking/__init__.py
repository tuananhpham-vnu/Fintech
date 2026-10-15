"""Đọc snapshot thành view có kiểu: tài liệu, field đã áp correction, evidence. Không suy diễn, không fuzzy theo tên."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

import normalize

READY = "ready"


@dataclass
class Field:
    key: str
    value: Any
    raw_value: str | None
    quality: str
    evidence_ids: list[str]
    missing_reason: str | None
    corrected: bool = False

    @property
    def readable(self) -> bool:
        return self.quality == "readable" and self.value is not None


@dataclass
class Doc:
    document: dict
    extraction: dict | None
    fields: dict[str, Field] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return self.document["id"]

    @property
    def type(self) -> str:
        return self.document["type"]

    @property
    def filename(self) -> str:
        return self.document["filename"]

    @property
    def response_request_id(self) -> str | None:
        return self.document["response_request_id"]

    @property
    def usable(self) -> bool:
        """Đã đọc xong, đã xác nhận loại, có extraction schema-valid và extraction cùng loại với tài liệu.

        Loại lệch (vd. hợp đồng tải nhầm vào ô biên bản) không bao giờ làm căn cứ, kể cả khi backend lỡ confirm.
        """
        return (self.document["processing_status"] == READY and self.document["classification_confirmed"]
                and self.extraction is not None and self.extraction.get("detected_type") == self.document["type"])

    def get(self, key: str) -> Field | None:
        return self.fields.get(key)

    def value(self, key: str) -> Any:
        f = self.fields.get(key)
        return f.value if f is not None and f.readable else None

    def state(self, key: str) -> str:
        """readable | absent (không có trên giấy) | unclear (có nhưng không đọc chắc)."""
        f = self.fields.get(key)
        if f is None:
            return "absent"
        if f.readable:
            return "readable"
        return "absent" if f.missing_reason == "not_present" else "unclear"

    def evidence(self, keys: Iterable[str] | None = None) -> list[str]:
        selected = self.fields.values() if keys is None else (self.fields[k] for k in keys if k in self.fields)
        return unique(e for f in selected for e in f.evidence_ids)


def unique(items: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(items))


class SnapshotView:
    def __init__(self, evaluation_input: dict, semantic=None):
        self.input = evaluation_input
        self.semantic = semantic          # resolver LLM cho ca khó (None = chỉ deterministic)
        self.diagnostics: list[dict] = []
        self.llm_used = False
        self.cache: dict = {}
        self.snapshot = evaluation_input["snapshot"]
        self.case = self.snapshot["case"]
        self.borrower_tax_id = normalize.tax_id(self.case["borrower_tax_id"])
        corrections = self._latest_corrections()
        self.docs: list[Doc] = []
        for item in self.snapshot["documents"]:
            if item["document"]["superseded_by"] is not None:
                continue
            doc = Doc(item["document"], item["extraction"])
            for f in (item["extraction"] or {}).get("fields", []):
                doc.fields[f["field_key"]] = _field(f, corrections.get(f["id"]))
            self.docs.append(doc)
        # Thứ tự ổn định theo tên file rồi id (giống inventory hiển thị), không phụ thuộc thứ tự producer.
        self.docs.sort(key=lambda d: (d.filename, d.id))
        self.evidence_ids = {e["id"] for d in self.docs if d.extraction for e in d.extraction["evidence"]}
        self.approved_requests = [r for r in self.snapshot["requests"] if r["status"] == "approved"]
        self.existing_issues = {i["issue_key"]: i for i in self.snapshot["existing_issues"]}

    def _latest_corrections(self) -> dict[str, dict]:
        latest: dict[str, dict] = {}
        for decision in sorted(self.snapshot["corrections"], key=lambda d: (d["created_at"], d["id"])):
            correction = decision["payload"].get("correction") if decision["action"] == "correct_field" else None
            if correction:
                latest[correction["field_id"]] = correction
        return latest

    def of_type(self, doc_type: str, usable_only: bool = True) -> list[Doc]:
        return [d for d in self.docs if d.type == doc_type and (d.usable or not usable_only)]

    @property
    def document_ids(self) -> list[str]:
        return [d.id for d in self.docs]


def _field(raw: dict, correction: dict | None) -> Field:
    f = Field(raw["field_key"], raw["value"], raw["raw_value"], raw["quality"], list(raw["evidence_ids"]),
              raw["missing_reason"])
    if correction is not None:
        # Người duyệt là nguồn của giá trị hiệu chỉnh; giữ evidence họ dẫn chiếu, không giả AI đọc được.
        f.value = correction["new_value"]
        f.quality = "readable" if correction["new_value"] is not None else "unreadable"
        f.missing_reason = None if correction["new_value"] is not None else "ambiguous"
        f.evidence_ids = list(correction["evidence_ids"])
        f.corrected = True
    return f
