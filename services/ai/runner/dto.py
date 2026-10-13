# GENERATED from packages/contracts/schemas.json (1.0.2) by scripts/gen_dto.sh. Do not edit.
# Typing aid only: jsonschema (runner/contracts.py) is the authority at the API boundary,
# e.g. required-but-nullable fields must be present even though these models default them to None.

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, RootModel


class Model(RootModel[Any]):
    root: Any


class Detail(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    path: str
    message: str


class Error1(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    code: str
    message: str
    request_id: UUID
    details: list[Detail]


class Error(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    error: Error1


class Role(Enum):
    reviewer = 'reviewer'
    contributor = 'contributor'


class User(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID
    display_name: str
    role: Role


class LoginInput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    username: str
    password: str


class SessionOutput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    user: User
    csrf_token: str
    expires_at: datetime


class CaseCreate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    borrower_name: str
    borrower_tax_id: str = Field(..., pattern='^\\d{10}(-\\d{3})?$')
    financial_period_end: date


class Case(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID
    borrower_name: str
    borrower_tax_id: str = Field(..., pattern='^\\d{10}(-\\d{3})?$')
    financial_period_end: date
    revision: int = Field(..., ge=1)
    checklist_version: Literal['CL01-P0-v1']
    source_class: Literal['synthetic']
    created_at: datetime
    created_by: UUID
    latest_run_id: UUID | None = None


class EventType(Enum):
    acceptance = 'acceptance'
    other = 'other'
    unknown = 'unknown'


class OffsetDays(RootModel[int]):
    root: int = Field(..., ge=0)


class CalendarBasis(Enum):
    calendar_days = 'calendar_days'
    business_days = 'business_days'
    unknown = 'unknown'


class CountingConvention(Enum):
    exclude_event_day = 'exclude_event_day'
    include_event_day = 'include_event_day'
    unknown = 'unknown'


class OtherConditionsState(Enum):
    none = 'none'
    present = 'present'
    unknown = 'unknown'


class PaymentCondition(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    event_type: EventType
    offset_days: OffsetDays | None = None
    calendar_basis: CalendarBasis
    scope_ref: str | None = None
    other_conditions: list[str]
    counting_convention: CountingConvention
    other_conditions_state: OtherConditionsState = Field(
        ...,
        description='none requires evidence of an explicit sole/complete condition; empty array alone is not proof.',
    )


class BboxItem(RootModel[float]):
    root: float = Field(..., ge=0.0, le=1.0)


class Bbox(RootModel[list[BboxItem]]):
    root: list[BboxItem] = Field(..., max_length=4, min_length=4)


class Precision(Enum):
    page = 'page'
    bbox = 'bbox'


class Evidence(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID
    document_id: UUID
    page: int = Field(..., ge=1)
    quote: str = Field(..., min_length=1)
    bbox: Bbox | None = None
    precision: Precision


class Quality(Enum):
    readable = 'readable'
    uncertain = 'uncertain'
    unreadable = 'unreadable'


class MissingReason(Enum):
    not_present = 'not_present'
    unreadable = 'unreadable'
    ambiguous = 'ambiguous'
    out_of_scope = 'out_of_scope'


class ExtractedField(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID
    document_id: UUID
    field_key: str
    raw_value: str | None = None
    value: str | PaymentCondition | None = None
    quality: Quality
    evidence_ids: list[UUID]
    missing_reason: MissingReason | None = None


class Method(Enum):
    text = 'text'
    ocr = 'ocr'


class DocumentPage(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    page: int = Field(..., ge=1)
    text: str
    method: Method
    width: float = Field(..., gt=0.0)
    height: float = Field(..., gt=0.0)


class Diagnostic(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    code: str
    message: str
    document_id: UUID | None = None
    field_key: str | None = None


class Provenance(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    model_id: str
    prompt_version: str
    ocr_version: str
    schema_version: Literal['1.0.2']


class DeclaredType(Enum):
    registration = 'registration'
    loan_request = 'loan_request'
    financial_statement = 'financial_statement'
    contract = 'contract'
    acceptance_record = 'acceptance_record'
    payment_record = 'payment_record'
    invoice = 'invoice'
    other = 'other'


class Type(Enum):
    registration = 'registration'
    loan_request = 'loan_request'
    financial_statement = 'financial_statement'
    contract = 'contract'
    acceptance_record = 'acceptance_record'
    payment_record = 'payment_record'
    invoice = 'invoice'
    other = 'other'


class ProcessingStatus(Enum):
    uploaded = 'uploaded'
    processing = 'processing'
    ready = 'ready'
    review_required = 'review_required'
    failed = 'failed'


class Document(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID
    case_id: UUID
    logical_document_id: UUID
    version_no: int = Field(..., ge=1)
    replaces_document_id: UUID | None = None
    response_request_id: UUID | None = None
    declared_type: DeclaredType
    type: Type
    classification_confirmed: bool
    filename: str
    sha256: str = Field(..., pattern='^[a-f0-9]{64}$')
    byte_size: int = Field(..., ge=0)
    page_count: int = Field(..., ge=1, le=10)
    source_class: Literal['synthetic']
    processing_status: ProcessingStatus
    error_code: str | None = None
    superseded_by: UUID | None = None
    created_at: datetime


class InspectionInput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal['1.0.2']
    storage_key: str
    sha256: str = Field(..., pattern='^[a-f0-9]{64}$')


class InspectionOutput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal['1.0.2']
    sha256: str = Field(..., pattern='^[a-f0-9]{64}$')
    page_count: int = Field(..., ge=1)
    byte_size: int = Field(..., ge=0)
    encrypted: bool
    has_embedded_files: bool


class ExtractionInput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal['1.0.2']
    document_id: UUID
    case_id: UUID
    type: Type
    storage_key: str
    sha256: str = Field(..., pattern='^[a-f0-9]{64}$')


class DetectedType(Enum):
    registration = 'registration'
    loan_request = 'loan_request'
    financial_statement = 'financial_statement'
    contract = 'contract'
    acceptance_record = 'acceptance_record'
    payment_record = 'payment_record'
    invoice = 'invoice'
    other = 'other'


class ExtractionOutput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal['1.0.2']
    document_id: UUID
    case_id: UUID
    sha256: str = Field(..., pattern='^[a-f0-9]{64}$')
    detected_type: DetectedType
    classification_confident: bool
    pages: list[DocumentPage]
    fields: list[ExtractedField]
    evidence: list[Evidence]
    diagnostics: list[Diagnostic]
    provenance: Provenance


class RequiredType(Enum):
    registration = 'registration'
    loan_request = 'loan_request'
    financial_statement = 'financial_statement'
    contract = 'contract'
    acceptance_record = 'acceptance_record'
    payment_record = 'payment_record'
    invoice = 'invoice'
    other = 'other'


class AbsenceBasis(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    checklist_version: str
    searched_document_ids: list[UUID]
    required_type: RequiredType
    reason: str


class RuleId(Enum):
    R01 = 'R01'
    R02 = 'R02'
    R08 = 'R08'
    R09 = 'R09'
    R10 = 'R10'


class Status(Enum):
    pass_ = 'pass'
    issue = 'issue'
    unknown = 'unknown'
    not_applicable = 'not_applicable'


class RuleResult(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    rule_id: RuleId
    status: Status
    reason_codes: list[str]
    evidence_ids: list[UUID]
    issue_keys: list[str]


class Category(Enum):
    missing_document = 'missing_document'
    mismatched_document = 'mismatched_document'
    insufficient_evidence = 'insufficient_evidence'
    identity_mismatch = 'identity_mismatch'
    supported = 'supported'


class Severity(Enum):
    medium = 'medium'
    high = 'high'


class Proposal(Enum):
    still_open = 'still_open'
    candidate_resolved = 'candidate_resolved'
    unknown = 'unknown'


class SupportedAmount(RootModel[str]):
    root: str = Field(..., pattern='^\\d+(\\.\\d{1,2})?$')


class UnsupportedAmount(RootModel[str]):
    root: str = Field(..., pattern='^\\d+(\\.\\d{1,2})?$')


class IssueAssessment(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID
    issue_id: UUID
    issue_key: str
    run_id: UUID
    rule_ids: list[RuleId]
    category: Category
    severity: Severity
    proposal: Proposal
    summary: str
    reason_codes: list[str]
    evidence_ids: list[UUID]
    absence_basis: AbsenceBasis | None = None
    supported_amount: SupportedAmount | None = None
    unsupported_amount: UnsupportedAmount | None = None
    computed_date: date | None = None


class HumanStatus(Enum):
    open = 'open'
    confirmed = 'confirmed'
    resolved = 'resolved'
    dismissed = 'dismissed'


class DecisionRevision(RootModel[int]):
    root: int = Field(..., ge=1)


class ReviewIssue(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID
    case_id: UUID
    issue_key: str
    human_status: HumanStatus
    latest_assessment_id: UUID | None = None
    decision_revision: DecisionRevision | None = None
    created_at: datetime


class RequestSuggestion(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    issue_id: UUID
    required_type: RequiredType
    contract_ref: str | None = None
    required_scope: str | None = None
    purpose: str
    content: str
    evidence_ids: list[UUID]


class ApprovedPayload(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    borrower_name: str
    contract_ref: str | None = None
    required_type: RequiredType
    required_scope: str | None = None
    purpose: str
    content: str
    approved_at: datetime
    request_id: UUID
    export_text: str


class Status1(Enum):
    draft = 'draft'
    approved = 'approved'
    closed = 'closed'
    cancelled = 'cancelled'


class ApprovedHash(RootModel[str]):
    root: str = Field(..., pattern='^[a-f0-9]{64}$')


class DocumentRequest(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID
    case_id: UUID
    issue_id: UUID
    run_id: UUID
    required_type: RequiredType
    contract_ref: str | None = None
    required_scope: str | None = None
    purpose: str
    content: str
    revision: int = Field(..., ge=1)
    status: Status1
    approved_by: UUID | None = None
    approved_at: datetime | None = None
    approved_hash: ApprovedHash | None = None
    approved_payload: ApprovedPayload | None = None
    cancelled_reason: str | None = None
    created_at: datetime


class CorrectionPayload(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    field_id: UUID
    old_value: str | PaymentCondition | None = None
    new_value: str | PaymentCondition | None = None
    evidence_ids: list[UUID]
    source_case_revision: int = Field(..., ge=1)


class OldType(Enum):
    registration = 'registration'
    loan_request = 'loan_request'
    financial_statement = 'financial_statement'
    contract = 'contract'
    acceptance_record = 'acceptance_record'
    payment_record = 'payment_record'
    invoice = 'invoice'
    other = 'other'


class NewType(Enum):
    registration = 'registration'
    loan_request = 'loan_request'
    financial_statement = 'financial_statement'
    contract = 'contract'
    acceptance_record = 'acceptance_record'
    payment_record = 'payment_record'
    invoice = 'invoice'
    other = 'other'


class Classification(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    old_type: OldType
    new_type: NewType


class RequestRevision(RootModel[int]):
    root: int = Field(..., ge=1)


class DecisionPayload(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    source_case_revision: int = Field(..., ge=1)
    correction: CorrectionPayload | None = None
    classification: Classification | None = None
    request_revision: RequestRevision | None = None
    approved_hash: ApprovedHash | None = None


class Action(Enum):
    correct_field = 'correct_field'
    confirm_classification = 'confirm_classification'
    approve_request = 'approve_request'
    cancel_request = 'cancel_request'
    confirm = 'confirm'
    resolve = 'resolve'
    dismiss = 'dismiss'
    reopen = 'reopen'


class ReviewDecision(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID
    case_id: UUID
    actor_id: UUID
    action: Action
    target_id: UUID
    run_id: UUID | None = None
    case_revision: int = Field(..., ge=1)
    reason: str
    payload: DecisionPayload
    created_at: datetime


class ExtractionHash(RootModel[str]):
    root: str = Field(..., pattern='^[a-f0-9]{64}$')


class SnapshotDocument(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    document: Document
    extraction: ExtractionOutput | None = None
    extraction_hash: ExtractionHash | None = None


class Snapshot(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal['1.0.2']
    case: Case
    documents: list[SnapshotDocument]
    corrections: list[ReviewDecision]
    classification_decision_ids: list[UUID]
    requests: list[DocumentRequest]
    existing_issues: list[ReviewIssue]
    rule_set_version: Literal['P0-1.0.2']


class EvaluationInput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal['1.0.2']
    run_id: UUID
    case_id: UUID
    case_revision: int = Field(..., ge=1)
    snapshot_hash: str = Field(..., pattern='^[a-f0-9]{64}$')
    snapshot: Snapshot


class Status2(Enum):
    completed = 'completed'
    partial = 'partial'


class EvaluationOutput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal['1.0.2']
    run_id: UUID
    case_id: UUID
    case_revision: int = Field(..., ge=1)
    snapshot_hash: str = Field(..., pattern='^[a-f0-9]{64}$')
    status: Status2
    rule_results: list[RuleResult] = Field(..., max_length=5, min_length=5)
    assessments: list[IssueAssessment]
    request_suggestions: list[RequestSuggestion]
    diagnostics: list[Diagnostic]
    provenance: Provenance


class Status3(Enum):
    queued = 'queued'
    running = 'running'
    completed = 'completed'
    partial = 'partial'
    failed = 'failed'


class ReviewRun(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID
    case_id: UUID
    case_revision: int = Field(..., ge=1)
    schema_version: Literal['1.0.2']
    rule_set_version: str
    snapshot_hash: str = Field(..., pattern='^[a-f0-9]{64}$')
    status: Status3
    is_stale: bool
    created_at: datetime
    completed_at: datetime | None = None
    result: EvaluationOutput | None = None
    snapshot: Snapshot = Field(
        ...,
        description='Exact immutable input snapshot; ACL same as run. Never reconstruct from current documents.',
    )


class Kind(Enum):
    extract = 'extract'
    evaluate = 'evaluate'


class Status4(Enum):
    queued = 'queued'
    running = 'running'
    completed = 'completed'
    failed = 'failed'


class Job(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID
    case_id: UUID
    kind: Kind
    resource_id: UUID
    status: Status4
    attempt: int = Field(..., ge=0, le=3)
    error_code: str | None = None
    created_at: datetime


class RevisionInput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    expected_case_revision: int = Field(..., ge=1)


class RunCreate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    expected_case_revision: int = Field(..., ge=1)


class ClassificationInput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    expected_case_revision: int = Field(..., ge=1)
    type: Type
    reason: str = Field(..., min_length=1)


class CorrectionInput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    expected_case_revision: int = Field(..., ge=1)
    field_id: UUID
    new_value: str | PaymentCondition | None = None
    evidence_ids: list[UUID]
    reason: str = Field(..., min_length=1)


class RequestCreate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    expected_case_revision: int = Field(..., ge=1)
    run_id: UUID
    issue_id: UUID
    required_type: RequiredType
    contract_ref: str | None = None
    required_scope: str | None = None
    purpose: str
    content: str
    evidence_ids: list[UUID]


class RequestEdit(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    expected_request_revision: int = Field(..., ge=1)
    purpose: str
    content: str


class RequestApprove(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    expected_case_revision: int = Field(..., ge=1)
    expected_request_revision: int = Field(..., ge=1)
    reason: str = Field(..., min_length=1)


class RequestCancel(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    expected_case_revision: int = Field(..., ge=1)
    expected_request_revision: int = Field(..., ge=1)
    reason: str = Field(..., min_length=1)


class Action1(Enum):
    confirm = 'confirm'
    resolve = 'resolve'
    dismiss = 'dismiss'
    reopen = 'reopen'


class IssueDecisionInput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    expected_case_revision: int = Field(..., ge=1)
    run_id: UUID
    action: Action1
    reason: str = Field(..., min_length=1)


class UploadInput(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    file: bytes
    expected_case_revision: int = Field(..., ge=1)
    type: Type
    replaces_document_id: UUID | None = None
    response_request_id: UUID | None = None
    source_class: Literal['synthetic']


class UploadAccepted(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    document: Document
    job: Job
    case_revision: int = Field(..., ge=1)


class RunAccepted(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    run: ReviewRun
    job: Job
    case_revision: int = Field(..., ge=1)


class RequestMutation(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    request: DocumentRequest
    case_revision: int = Field(..., ge=1)


class DecisionMutation(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    decision: ReviewDecision
    issue: ReviewIssue | None = None
    closed_request_ids: list[UUID]
    case_revision: int = Field(..., ge=1)


class ClassificationMutation(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    document: Document
    decision: ReviewDecision
    case_revision: int = Field(..., ge=1)


class CaseList(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[Case]
    next_cursor: str | None = None


class CaseDetail(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    case: Case
    documents: list[Document]
    issues: list[ReviewIssue]
    requests: list[DocumentRequest]
    active_jobs: list[Job]
    latest_run: ReviewRun | None = None
    corrections: list[ReviewDecision]
    classification_decisions: list[ReviewDecision]


class EntityType(Enum):
    document = 'document'
    run = 'run'
    issue = 'issue'
    request = 'request'
    decision = 'decision'
    case = 'case'


class HistoryEvent(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: UUID
    case_id: UUID
    actor_id: UUID | None = None
    action: str
    entity_type: EntityType
    entity_id: UUID
    run_id: UUID | None = None
    created_at: datetime


class HistoryPage(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    items: list[HistoryEvent]
    decisions: list[ReviewDecision]
    next_cursor: str | None = None
