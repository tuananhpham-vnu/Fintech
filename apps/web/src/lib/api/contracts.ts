/** Frontend consumer types transcribed from Notion AIC 2.0 pages 01/09/10.
 * AIC-2.0-DRAFT is NOT a released backend schema. See docs/backend-integration.md.
 * Server identifiers, revisions, actors, policies and numeric results are never generated here.
 */
export type Locale = 'en' | 'vi' | 'zh-CN'
export type ExposureKind = 'RECEIVABLE' | 'PREPAYMENT' | 'LOAN' | 'DEBT_INVESTMENT'
export type Session = {
  user: { id: string; organization_id: string; display_name: string; role: 'specialist' }
  csrf_token: string
  expires_at: string
}
export type Page<T> = { items: T[]; next_cursor?: string | null }
export type CounterpartyInput = {
  name: string
  country: string
  tax_id: string | null
  industry_code: string | null
  source_refs: string[]
}
export type Counterparty = CounterpartyInput & {
  id: string
  organization_id: string
  revision: number
  identity_status: 'unresolved' | 'confirmed' | 'conflicting'
  created_at: string
  updated_at: string
}
export type Exposure = {
  amount_vnd: string | null
  amount_missing_reason?: string | null
  term_days: number | null
  organization_role: string
  counterparty_role: string
  contract_ref: string | null
  conditions: unknown[]
  source_origin: string
  term_null_reason?: 'not_agreed' | 'source_missing' | 'ambiguous' | null
  claims?: unknown[]
  due_date?: string | null
}
export type CaseCreate = {
  counterparty_id: string
  exposure_kind: ExposureKind
  lifecycle_stage: 'proposed' | 'active'
  exposure: Exposure
}
type CaseRecord = {
  id: string
  organization_id: string
  revision: number
  method_version?: string | null
  latest_review_run_id?: string | null
  latest_assessment_id?: string | null
  created_at: string
  updated_at: string
}
export type Case = CaseRecord &
  (
    | (CaseCreate & { purpose?: 'transaction'; policy_version: string })
    | {
        purpose: 'company_health'
        counterparty_id: string
        exposure_kind: null
        lifecycle_stage: null
        exposure: null
        policy_version: null
      }
  )
export type DocumentType =
  | 'registration'
  | 'financial_statement'
  | 'tax_report'
  | 'contract'
  | 'invoice'
  | 'acceptance_record'
  | 'delivery_record'
  | 'payment_record'
  | 'collateral_document'
  | 'loan_request'
  | 'debt_instrument'
  | 'other'
export const documentTypes: DocumentType[] = [
  'registration',
  'financial_statement',
  'tax_report',
  'contract',
  'invoice',
  'acceptance_record',
  'delivery_record',
  'payment_record',
  'collateral_document',
  'loan_request',
  'debt_instrument',
  'other',
]
/** Types accepted by the current document upload and classification API. */
export const supportedDocumentTypes = [
  'registration',
  'loan_request',
  'financial_statement',
  'contract',
  'acceptance_record',
  'payment_record',
  'invoice',
  'other',
] as const satisfies readonly DocumentType[]
export type ExtractedField = {
  field_key: string
  value: unknown
  raw_value?: unknown
  quality: string
  missing_reason?: string | null
  evidence_refs: string[]
  party_role?: string
  period?: string
  currency?: string
  unit_multiplier?: string
}
export type Document = {
  id: string
  lineage: string
  version: number
  hash: string
  pages: number
  source: unknown
  owner_party_ref: string
  type: DocumentType
  classification: unknown
  status: string
  extraction?: ExtractedField[] | null
  name?: string
  source_review?: {
    declared_type: DocumentType
    subject_match: 'match' | 'mismatch' | 'unresolved'
    reviewed_pages: number[]
    reason: string
    actor_id: string
    created_at: string
  }
}
export type Job = {
  id: string
  state: 'queued' | 'running' | 'completed' | 'partial' | 'failed'
  retryable?: boolean
  errors?: { code: string; message?: string; retryable?: boolean }[]
}
export type Evidence = {
  id: string
  document_id: string
  document_version: number
  page: number
  quote: string
  source_hash: string
  bbox?: number[] | null
}
export type Finding = {
  id: string
  issue_key: string
  rule_id: string
  category: string
  severity: string
  summary: string
  evidence_refs: string[]
  finding_state: 'open' | 'verified_resolved' | 'dismissed'
  handling_state: 'none' | 'requested' | 'waived'
  limitations: string[]
  absence_basis?: string
}
export type ReviewRun = {
  checked_case_revision?: number
  id: string
  case_id: string
  case_revision: number
  rules_version: string
  policy_version: string
  snapshot_hash: string
  state: Job['state']
  stale: boolean
  findings: Finding[]
  issue_history?: Finding[]
  results?: unknown[]
  diagnostics?: unknown[]
}
export type Waiver = {
  id: string
  actor_id: string
  policy_version: string
  created_at: string
  active: boolean
  requirement_key?: string
  reason?: string
  revoked_at?: string | null
}
export type Readiness = {
  assessment_allowed?: boolean
  case_revision: number
  document_review_allowed: boolean
  numeric_assessment_allowed: boolean
  method_status:
    | 'unconfigured'
    | 'configured_pilot'
    | 'validation_pending'
    | 'validated_for_limited_use'
    | 'retired'
  blockers: { code: string; message: string }[]
  limitations: string[]
  waivable_requirements: { requirement_key: string; label?: string; issue_id?: string }[]
}
export type Factor = {
  factor_id: string
  label: string
  status: 'available' | 'missing' | 'waived' | 'conflicting' | 'not_applicable'
  score: string | number | null
  value: unknown
  rationale: string
  evidence_refs: string[]
  verification_state: string
  limitations: string[]
}
export type Assessment = {
  purpose?: 'company_health'
  checked_case_revision?: number
  financial_set_id?: string | null
  method_status?: Readiness['method_status']
  acknowledged_by?: string | null
  acknowledged_at?: string | null
  acknowledgement_reason?: string | null
  id: string
  case_id: string
  case_revision: number
  method_version: string
  policy_version: string | null
  snapshot_hash: string
  state: string
  stale: boolean
  factors: Factor[]
  strengths: string[]
  weaknesses: string[]
  red_flags: string[]
  limitations: string[]
  created_at: string
  overall_score?: string | number | null
  grade?: string | null
  pd?: null
  /** METHOD-SYNC-01 draft expansions, not released wire schemas. */
  financial_health?: {
    status: string
    score: string | null
    band: string | null
    score_quality: string
    pd: null
    components: FhiComponent[]
    blockers?: unknown[]
    missing_facts?: unknown[]
  }
  transaction_review?: {
    exposure_kind: ExposureKind
    status: 'BLOCKED' | 'FOLLOW_UP' | 'CLEAR_FOR_REVIEW' | 'UNKNOWN'
    findings: {
      code: string
      severity: string
      evidence_refs: string[]
      verification_state: string
    }[]
    evidence_refs?: string[]
    limitations?: string[]
  } | null
}
export type FhiComponent = {
  flags?: string[]
  metric_id: string
  formula_id?: string
  raw_value: string | null
  points: string | null
  max_points: string
  source_facts: string[]
  verification_state?: string
  blockers?: unknown[]
}
export type FinancialMetric = {
  metric_id: string
  formula_id: string
  period: string
  value: string | null
  status: 'available' | 'unavailable'
  input_refs: string[]
  adjustments: unknown[]
  reason?: string
}
export type DocumentRequest = {
  id: string
  status: 'draft' | 'approved' | 'closed' | 'cancelled'
  revision: number
  approved_payload?: unknown
  purpose?: string
  content?: string
  run_id?: string
  issue_id?: string
  evidence_refs?: string[]
  document_types?: DocumentType[]
}
export type Question = {
  id: string
  version: number
  answer_type: string
  requiredness: string
  allowed_to_skip: boolean
  source_requirements: unknown
  verification_policy: unknown
  label?: string
}
export type ResponseRecord = {
  id: string
  question_id: string
  answer_state: string
  answer_json?: unknown
  reason?: string
  origin: 'SME_direct' | 'staff_transcribed'
  source_refs: string[]
  revision: number
  verification_status?: string
  verification_stale?: boolean
  reported_by?: 'organization' | 'counterparty'
  reported_reference?: string
  entered_by?: string | null
  invitation_id?: string | null
  created_at?: string
}
export type Invitation = {
  id: string
  questionnaire_id: string
  questionnaire_version: 1
  question_ids: string[]
  reported_by: 'organization' | 'counterparty'
  recipient_reference: string
  expires_at: string
  created_at: string
  status: 'active' | 'revoked' | 'expired' | 'submitted' | 'closed'
  token_delivery: 'one_time_response_header'
}
export type Questionnaire = {
  id: string
  questions: Question[]
  responses?: ResponseRecord[]
  version?: 1
  state?: 'draft' | 'published' | 'closed'
  invitations?: Invitation[]
}
export type HistoryEvent = {
  id: string
  actor: string
  action: string
  time: string
  reason?: string
  revision_before: number | null
  revision_after: number | null
  subject_refs: string[]
}
/** Detail expansions are named in page 09 but not yet given a complete wire schema. */
export type CaseDetail = Case & {
  review_stale?: boolean
  documents?: Document[]
  jobs?: Job[]
  findings?: Finding[]
  issue_history?: Finding[]
  waivers?: Waiver[]
  readiness?: Readiness
  assessment?: Assessment | null
  requests?: DocumentRequest[]
  questionnaires?: Questionnaire[]
  financial_metrics?: FinancialMetric[]
  transaction_review?: {
    exposure_kind: 'RECEIVABLE' | 'PREPAYMENT'
    status: 'BLOCKED' | 'FOLLOW_UP' | 'CLEAR_FOR_REVIEW' | 'UNKNOWN'
    findings: Finding[]
    limitations: string[]
    verified_settlement_vnd: null
    verified_outstanding_vnd: null
  } | null
}
export type RevisionInput = { expected_revision: number }
export type TransactionCaseDetail = Extract<CaseDetail, { exposure: Exposure }>
export type WaiverInput = RevisionInput & {
  requirement_key: string
  issue_id?: string
  reason: string
}
export type IssueDecisionInput = RevisionInput & {
  action: 'resolve' | 'dismiss' | 'reopen'
  reason: string
  evidence_refs: string[]
}

export type DossierAccepted = {
  archive_id: string
  case_id: string
  archive_sha256: string
  revision: number
  intake_state: 'queued'
  manifest_url: string
}

export type DossierCounters = {
  discovered: number
  registered: number
  rejected: number
  awaiting_inspection: number
  queued: number
  running: number
  completed_with_usable_data: number
  completed_zero_usable: number
  failed: number
  needs_review: number
}

export type DossierIntakeState =
  'queued' | 'validating' | 'registering' | 'accepted' | 'partially_accepted' | 'rejected'

export type DossierProcessingState = 'waiting' | 'processing' | 'finished' | 'finished_with_errors'

export type DossierArchiveSummary = {
  id: string
  case_id: string
  archive_sha256: string
  intake_state: DossierIntakeState
  processing_state: DossierProcessingState
  created_at: string
  counters: DossierCounters
  error_code: string | null
}

export type DossierMemberIntakeState =
  'awaiting_inspection' | 'inspecting' | 'registered' | 'rejected' | 'needs_review'

export type DossierMemberProcessingState =
  | 'waiting'
  | 'queued'
  | 'running'
  | 'completed_with_usable_data'
  | 'completed_zero_usable'
  | 'failed'
  | 'needs_review'
  | 'not_applicable'

export type DossierMember = {
  id: string
  archive_id: string
  entry_index: number
  entry_path: string
  byte_size: number
  sha256: string | null
  detected_mime: string | null
  group: 'financial_statements' | 'contracts' | 'tax' | 'payments' | 'other'
  suggested_type: DocumentType
  classification_verification: 'unverified'
  period_suggestion: {
    year: number | null
    kind: 'unresolved'
    basis: 'unresolved'
    verification: 'unverified'
  }
  subject_verification: 'unresolved'
  intake_state: DossierMemberIntakeState
  processing_state: DossierMemberProcessingState
  page_count: number | null
  document_id: string | null
  job_id: string | null
  error_code: string | null
  retryable: boolean
  source_url: string | null
}

export type DossierArchive = DossierArchiveSummary & {
  members: DossierMember[]
}

export type DossierArchiveList = DossierArchiveSummary[]

export type ExtractionSummaryField = {
  field_key: string
  has_value: boolean
  quality: 'readable' | 'uncertain' | 'unreadable'
  missing_reason: string | null
  evidence_count: number
}

export type ExtractionSummaryDiagnostic = {
  code: string
  field_key: string | null
}

export type ExtractionSummary = {
  document_id: string
  document_version: number
  source_hash: string
  job_state: 'queued' | 'running' | 'completed' | 'partial' | 'failed'
  ai_mode: 'live' | 'mock'
  verification: 'unverified'
  group: 'financial_statements' | 'contracts' | 'tax' | 'payments' | 'other'
  suggested_type: DocumentType
  classification_verification: 'unverified'
  outcome: 'processing' | 'ready_for_review' | 'zero_usable_fields' | 'failed'
  total_fields: number
  non_null_fields: number
  usable_fields: number
  diagnostics: ExtractionSummaryDiagnostic[]
  fields: ExtractionSummaryField[]
}

export type DossierMemberSummary = {
  member_id: string
  archive_id: string
  document_id: string | null
  job_id: string | null
  intake_state: DossierMemberIntakeState
  processing_state: DossierMemberProcessingState
  error_code: string | null
  extraction: ExtractionSummary | null
}
