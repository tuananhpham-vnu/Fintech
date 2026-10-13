"""Builder dựng snapshot + facts cho test, mock API và JSON mẫu.

Mọi tên/mã/số liệu ở đây là GIẢ LẬP (bộ golden case phần 35 của tài liệu triển khai).
"""
from __future__ import annotations

import hashlib
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from .contracts.inputs import (
    ApprovedRequestItem,
    CaseInfo,
    CaseSnapshot,
    Classification,
    ConfirmedLink,
    DocType,
    DocumentVersion,
    Evidence,
    Fact,
    LinkRelation,
    Period,
    ProcessingStatus,
    Quality,
    Relation,
)


class DocBuilder:
    def __init__(self, parent: "SnapshotBuilder", version: DocumentVersion):
        self._parent = parent
        self.version = version

    @property
    def id(self) -> str:
        return self.version.id

    def fact(self, name: str, value: Any, *, raw: Optional[str] = None, quality: Quality = Quality.READABLE,
             multiplier: Optional[str] = None, currency: Optional[str] = None, page: int = 1) -> "DocBuilder":
        doc_type = self.version.doc_type.value if self.version.doc_type else "other"
        fact_id = f"fact_{self.id}_{name}"
        evidence_id = f"ev_{self.id}_{name}"
        quote = raw if raw is not None else str(value)
        self._parent.evidence.append(Evidence(id=evidence_id, document_version_id=self.id, page=page,
                                              bbox=(0.1, 0.1, 0.9, 0.2), quote=quote))
        self._parent.facts.append(Fact(id=fact_id, document_version_id=self.id, field=f"{doc_type}.{name}",
                                       raw_value=raw, value=value, quality=quality, multiplier=multiplier,
                                       currency=currency, evidence_ids=[evidence_id]))
        return self

    def facts(self, **values: Any) -> "DocBuilder":
        for name, value in values.items():
            self.fact(name, value)
        return self


class SnapshotBuilder:
    def __init__(self, case_id: str = "case_sao_mai_demo", run_id: str = "run_01", revision: int = 1,
                 period: Tuple[date, date] = (date(2025, 1, 1), date(2025, 12, 31))):
        self.case = CaseInfo(case_id=case_id, revision=revision,
                             reporting_period=Period(start=period[0], end=period[1]), checklist_version="CL01-v1")
        self.run_id = run_id
        self.documents: List[DocumentVersion] = []
        self.evidence: List[Evidence] = []
        self.facts: List[Fact] = []
        self.links: List[ConfirmedLink] = []
        self.request_items: List[ApprovedRequestItem] = []

    def document(self, document_id: str, doc_type: Optional[DocType], *,
                 status: ProcessingStatus = ProcessingStatus.READY,
                 classification: Classification = Classification.CONFIRMED,
                 file_hash: Optional[str] = None, request_item_id: Optional[str] = None,
                 relation: Relation = Relation.NEW, version_no: int = 1) -> DocBuilder:
        version = DocumentVersion(
            id=f"dv_{document_id}_v{version_no}",
            document_id=document_id,
            version_no=version_no,
            file_hash=file_hash or hashlib.sha256(document_id.encode()).hexdigest(),
            doc_type=doc_type,
            classification=classification,
            processing_status=status,
            relation=relation,
            request_item_id=request_item_id,
        )
        self.documents.append(version)
        return DocBuilder(self, version)

    def remove_documents(self, doc_type: DocType) -> "SnapshotBuilder":
        """Bỏ tài liệu cùng toàn bộ fact/evidence của nó (dựng ca thiếu hồ sơ)."""
        removed = {d.id for d in self.documents if d.doc_type == doc_type}
        self.documents = [d for d in self.documents if d.id not in removed]
        self.facts = [f for f in self.facts if f.document_version_id not in removed]
        self.evidence = [e for e in self.evidence if e.document_version_id not in removed]
        return self

    def link(self, source: DocBuilder, target: DocBuilder, relation: LinkRelation) -> "SnapshotBuilder":
        self.links.append(ConfirmedLink(source_id=source.id, target_id=target.id, relation=relation))
        return self

    def request_item(self, item_id: str, document_type: DocType, *, contract_ref: Optional[str] = None,
                     finding_issue_keys: Optional[List[str]] = None, purpose: str = "") -> "SnapshotBuilder":
        self.request_items.append(ApprovedRequestItem(
            id=item_id, request_id=f"req_{item_id}", document_type=document_type, contract_ref=contract_ref,
            finding_issue_keys=finding_issue_keys or [], purpose=purpose))
        return self

    def build(self) -> Tuple[CaseSnapshot, List[Fact]]:
        manifest = "|".join(sorted(f"{d.id}:{d.file_hash}" for d in self.documents))
        snapshot = CaseSnapshot(
            run_id=self.run_id,
            snapshot_hash="snap_" + hashlib.sha256(manifest.encode()).hexdigest()[:16],
            case=self.case,
            documents=list(self.documents),
            evidence=list(self.evidence),
            links=list(self.links),
            request_items=list(self.request_items),
        )
        return snapshot, list(self.facts)


BORROWER_NAME = "Công ty TNHH Sao Mai Demo"
BORROWER_TAX_ID = "0000000001"
BUYER = {"name": "Công ty CP Khách Hàng Demo", "tax_id": "0000000002", "role": "buyer"}
SELLER = {"name": BORROWER_NAME, "tax_id": BORROWER_TAX_ID, "role": "seller"}
ACCEPTANCE_TERM: Dict[str, Any] = {"event_type": "acceptance", "event_ref": "HĐ01", "offset_days": 30,
                                   "calendar_basis": "calendar_days", "percentage": "100"}


def sao_mai_base(run_id: str = "run_01", claim_type: str = "expected") -> SnapshotBuilder:
    """Bộ 01-04: đăng ký, BCTC 2025, đề nghị vay 300 triệu, HĐ01 500 triệu trả sau nghiệm thu 30 ngày lịch."""
    b = SnapshotBuilder(run_id=run_id)
    b.document("doc_registration", DocType.REGISTRATION).facts(
        borrower_name=BORROWER_NAME, tax_id=BORROWER_TAX_ID, registered_address="Số 1 Đường Demo")
    fs = b.document("doc_financials", DocType.FINANCIAL_STATEMENT).facts(
        entity_name=BORROWER_NAME, tax_id=BORROWER_TAX_ID, period_start="2025-01-01", period_end="2025-12-31",
        statement_scope="standalone", currency="VND", unit_multiplier="1000000")
    fs.fact("total_assets", "1000", raw="1.000").fact("total_liabilities", "600", raw="600").fact("equity", "400", raw="400")
    b.document("doc_loan_request", DocType.LOAN_REQUEST).facts(
        borrower_name=BORROWER_NAME, tax_id=BORROWER_TAX_ID, currency="VND", purpose="Bổ sung vốn lưu động",
        request_date="2026-10-01",
        expected_receipts=[{"amount": "500000000", "currency": "VND", "expected_date": "2026-11-30",
                            "contract_ref": "HĐ01", "claim_type": claim_type}],
    ).fact("requested_amount", "300", multiplier="1000000", currency="VND")
    b.document("doc_contract_01", DocType.CONTRACT).facts(
        contract_no="HĐ01", signed_date="2026-08-01", parties=[SELLER, BUYER], total_amount="500000000",
        vat_basis="inclusive", currency="VND", amendments=[], payment_terms=[dict(ACCEPTANCE_TERM)])
    return b


def add_acceptance_record(b: SnapshotBuilder, document_id: str, contract_ref: str,
                          request_item_id: Optional[str] = None, acceptance_date: str = "2026-10-15") -> DocBuilder:
    return b.document(document_id, DocType.ACCEPTANCE_RECORD, request_item_id=request_item_id).facts(
        record_no=f"BB-{contract_ref}", contract_ref=contract_ref, parties=[SELLER, BUYER],
        acceptance_date=acceptance_date, accepted_scope="Toàn bộ hạng mục", signatory_text="Đại diện hai bên")


def sao_mai_golden(stage: int = 3) -> Tuple[CaseSnapshot, List[Fact]]:
    """stage 1: hồ sơ đầu; 2: nộp nhầm biên bản HĐ02; 3: nộp thêm biên bản đúng HĐ01."""
    b = sao_mai_base(run_id=f"run_0{stage}")
    if stage >= 2:
        b.request_item("ri_acceptance_01", DocType.ACCEPTANCE_RECORD, contract_ref="HĐ01",
                       finding_issue_keys=["R08:doc_contract_01:acceptance"],
                       purpose="Xác minh điều kiện thanh toán của HĐ01")
        add_acceptance_record(b, "doc_wrong_record", "HĐ02", request_item_id="ri_acceptance_01")
    if stage >= 3:
        add_acceptance_record(b, "doc_correct_record", "HĐ01", request_item_id="ri_acceptance_01")
    return b.build()
