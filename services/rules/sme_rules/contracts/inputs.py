"""Hợp đồng đầu vào: Facts + Evidence do module đọc tài liệu (P2) cung cấp.

Chỉ chứa cấu trúc dữ liệu, không chứa logic nghiệp vụ. Đổi trường ở đây là đổi
contract giữa các module: phải cập nhật tài liệu, JSON mẫu và test.
"""
from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Any, List, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ContractModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class DocType(str, Enum):
    REGISTRATION = "registration"
    LOAN_REQUEST = "loan_request"
    FINANCIAL_STATEMENT = "financial_statement"
    CONTRACT = "contract"
    INVOICE = "invoice"
    ACCEPTANCE_RECORD = "acceptance_record"
    PAYMENT_RECORD = "payment_record"
    OTHER = "other"


class ProcessingStatus(str, Enum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class Classification(str, Enum):
    CONFIRMED = "confirmed"
    NEEDS_REVIEW = "needs_review"


class Relation(str, Enum):
    NEW = "new"
    REPLACES = "replaces"
    SUPPLEMENTS = "supplements"


class Quality(str, Enum):
    READABLE = "readable"
    REVIEW_REQUIRED = "review_required"
    UNREADABLE = "unreadable"


class SourceType(str, Enum):
    DOCUMENT = "document"
    USER_ENTRY = "user_entry"
    DERIVED = "derived"


class EvidencePrecision(str, Enum):
    REGION = "region"
    PAGE = "page"


class LinkRelation(str, Enum):
    CONTRACT_INVOICE = "contract_invoice"
    ACCEPTANCE = "acceptance"
    PAYMENT = "payment"


class Evidence(ContractModel):
    id: str
    document_version_id: str
    page: int = Field(ge=1)
    bbox: Optional[Tuple[float, float, float, float]] = None
    quote: str = ""
    precision: EvidencePrecision = EvidencePrecision.REGION

    @model_validator(mode="after")
    def _check_bbox(self) -> "Evidence":
        if self.bbox is None:
            if self.precision != EvidencePrecision.PAGE:
                raise ValueError("evidence without bbox must use precision=page")
            return self
        x0, y0, x1, y1 = self.bbox
        if not all(0.0 <= v <= 1.0 for v in self.bbox) or x0 > x1 or y0 > y1:
            raise ValueError("bbox must be normalized 0-1 as [x0, y0, x1, y1]")
        return self


class Fact(ContractModel):
    """Một thông tin đọc từ nguồn. `field` có dạng `<doc_type>.<name>`."""

    id: str
    document_version_id: Optional[str] = None
    field: str
    raw_value: Optional[str] = None
    value: Any = None
    currency: Optional[str] = None
    multiplier: Optional[str] = None
    period: Optional[str] = None
    quality: Quality = Quality.READABLE
    source_type: SourceType = SourceType.DOCUMENT
    evidence_ids: List[str] = Field(default_factory=list)
    operand_fact_ids: List[str] = Field(default_factory=list)

    @property
    def doc_type_prefix(self) -> str:
        return self.field.split(".", 1)[0] if "." in self.field else ""

    @property
    def name(self) -> str:
        return self.field.split(".", 1)[1] if "." in self.field else self.field


class DocumentVersion(ContractModel):
    id: str
    document_id: str
    version_no: int = Field(default=1, ge=1)
    file_hash: str
    doc_type: Optional[DocType] = None
    classification: Classification = Classification.CONFIRMED
    processing_status: ProcessingStatus = ProcessingStatus.READY
    relation: Relation = Relation.NEW
    replaces_version_id: Optional[str] = None
    request_item_id: Optional[str] = None
    error_code: Optional[str] = None


class ConfirmedLink(ContractModel):
    """Liên kết chứng từ do reviewer xác nhận (source = hợp đồng)."""

    source_id: str
    target_id: str
    relation: LinkRelation


class ApprovedRequestItem(ContractModel):
    id: str
    request_id: str
    document_type: DocType
    contract_ref: Optional[str] = None
    finding_issue_keys: List[str] = Field(default_factory=list)
    purpose: str = ""


class Period(ContractModel):
    start: date
    end: date


class CaseInfo(ContractModel):
    case_id: str
    revision: int = Field(ge=0)
    reporting_period: Period
    checklist_version: str


class CaseSnapshot(ContractModel):
    """Snapshot bất biến của một run: manifest tài liệu, evidence, liên kết và request đã duyệt."""

    run_id: str
    snapshot_hash: str
    case: CaseInfo
    documents: List[DocumentVersion] = Field(default_factory=list)
    evidence: List[Evidence] = Field(default_factory=list)
    links: List[ConfirmedLink] = Field(default_factory=list)
    request_items: List[ApprovedRequestItem] = Field(default_factory=list)
