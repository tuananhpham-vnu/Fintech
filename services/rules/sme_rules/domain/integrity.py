"""Kiểm tra suy luận đầu vào: fact phải có nguồn hợp lệ trong đúng snapshot.

Fact vi phạm bị loại khỏi phân tích (rule sẽ thấy là thiếu -> unknown) và được báo
trong `RunOutput.input_issues`; không bao giờ dùng nguồn bịa hoặc xuyên case.
"""
from __future__ import annotations

from collections import Counter
from typing import Iterable, List, Tuple

from ..contracts.inputs import CaseSnapshot, Fact, SourceType
from ..contracts.outputs import InputIssue


def sanitize_facts(snapshot: CaseSnapshot, facts: Iterable[Fact]) -> Tuple[List[Fact], List[InputIssue]]:
    facts = list(facts)
    versions = {d.id: d for d in snapshot.documents}
    evidence = {e.id: e for e in snapshot.evidence}
    field_counts = Counter((f.document_version_id, f.field) for f in facts)

    valid: List[Fact] = []
    issues: List[InputIssue] = []
    for fact in facts:
        code = _violation(fact, versions, evidence, field_counts)
        if code:
            issues.append(InputIssue(object_type="fact", object_id=fact.id, code=code))
        else:
            valid.append(fact)
    return valid, issues


def _violation(fact: Fact, versions, evidence, field_counts) -> str:
    if fact.document_version_id is not None:
        version = versions.get(fact.document_version_id)
        if version is None:
            return "FACT_OUTSIDE_SNAPSHOT"
        if version.doc_type is not None and fact.doc_type_prefix != version.doc_type.value:
            return "FACT_FIELD_DOC_TYPE_MISMATCH"
        if field_counts[(fact.document_version_id, fact.field)] > 1:
            return "DUPLICATE_FACT_FIELD"
    if fact.source_type == SourceType.DOCUMENT:
        if fact.document_version_id is None or not fact.evidence_ids:
            return "FACT_WITHOUT_EVIDENCE"
        for evidence_id in fact.evidence_ids:
            item = evidence.get(evidence_id)
            if item is None:
                return "EVIDENCE_NOT_FOUND"
            if item.document_version_id != fact.document_version_id:
                return "EVIDENCE_VERSION_MISMATCH"
    if fact.source_type == SourceType.DERIVED and not fact.operand_fact_ids:
        return "DERIVED_WITHOUT_OPERANDS"
    return ""
