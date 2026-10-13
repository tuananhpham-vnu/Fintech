"""Lớp đọc dữ liệu cho rule: rule không duyệt list thô mà hỏi qua CaseView/DocView."""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any, Dict, Iterable, List, Optional, Set

from ..contracts.inputs import (
    CaseInfo,
    CaseSnapshot,
    Classification,
    DocType,
    DocumentVersion,
    Fact,
    LinkRelation,
    ProcessingStatus,
    Quality,
)
from .normalize import normalize_ref, parse_date

_PENDING = {ProcessingStatus.UPLOADED, ProcessingStatus.PROCESSING}


class DocView:
    def __init__(self, version: DocumentVersion, facts: Dict[str, Fact]):
        self.version = version
        self._facts = facts

    @property
    def id(self) -> str:
        return self.version.id

    @property
    def document_id(self) -> str:
        return self.version.document_id

    @property
    def doc_type(self) -> Optional[DocType]:
        return self.version.doc_type

    @property
    def is_ready(self) -> bool:
        return self.version.processing_status == ProcessingStatus.READY

    @property
    def is_pending(self) -> bool:
        return self.version.processing_status in _PENDING

    @property
    def is_failed(self) -> bool:
        return self.version.processing_status == ProcessingStatus.FAILED

    @property
    def is_classified(self) -> bool:
        return self.doc_type is not None and self.version.classification == Classification.CONFIRMED

    def fact(self, name: str) -> Optional[Fact]:
        return self._facts.get(name)

    def value(self, name: str, default: Any = None) -> Any:
        """Giá trị chỉ khi đọc chắc chắn; trường mơ hồ được coi như chưa có."""
        fact = self._facts.get(name)
        if fact is None or fact.quality != Quality.READABLE or fact.value is None:
            return default
        return fact.value

    def is_uncertain(self, name: str) -> bool:
        fact = self._facts.get(name)
        return fact is not None and fact.quality != Quality.READABLE

    def date(self, name: str) -> Optional[date]:
        return parse_date(self.value(name))

    def ref(self, name: str) -> Optional[str]:
        return normalize_ref(self.value(name))

    def evidence_ids(self, *names: str) -> List[str]:
        ids: List[str] = []
        for name in names:
            fact = self._facts.get(name)
            if fact is not None:
                ids.extend(fact.evidence_ids)
        return ids

    def __repr__(self) -> str:
        return f"DocView({self.id}, {self.doc_type})"


class CaseView:
    def __init__(self, snapshot: CaseSnapshot, facts: Iterable[Fact]):
        self.snapshot = snapshot
        by_version: Dict[str, Dict[str, Fact]] = defaultdict(dict)
        for fact in facts:
            if fact.document_version_id is not None:
                by_version[fact.document_version_id][fact.name] = fact
        self.documents = [DocView(v, by_version.get(v.id, {})) for v in snapshot.documents]
        self._by_id = {doc.id: doc for doc in self.documents}
        self._links: Dict[tuple, Set[str]] = defaultdict(set)
        for link in snapshot.links:
            self._links[(link.source_id, link.relation)].add(link.target_id)

    @property
    def info(self) -> CaseInfo:
        return self.snapshot.case

    def get(self, version_id: str) -> Optional[DocView]:
        return self._by_id.get(version_id)

    def ready(self, doc_type: Optional[DocType] = None) -> List[DocView]:
        return [d for d in self.documents
                if d.is_ready and d.is_classified and (doc_type is None or d.doc_type == doc_type)]

    def pending(self, doc_type: Optional[DocType] = None) -> List[DocView]:
        """File đang xử lý; loại chưa rõ (None) được tính cho mọi doc_type."""
        return [d for d in self.documents
                if d.is_pending and (doc_type is None or d.doc_type in (doc_type, None))]

    def failed(self, doc_type: Optional[DocType] = None) -> List[DocView]:
        return [d for d in self.documents
                if d.is_failed and (doc_type is None or d.doc_type == doc_type)]

    def needs_classification(self) -> List[DocView]:
        return [d for d in self.documents if d.is_ready and not d.is_classified]

    def responses_to(self, request_item_id: str) -> List[DocView]:
        return [d for d in self.documents if d.version.request_item_id == request_item_id]

    def linked_target_ids(self, source_id: str, relation: LinkRelation) -> Set[str]:
        return self._links.get((source_id, relation), set())
