// Foundation contract owner: Lead. Does not rewrite legacy bundle files.
const fs = require('node:fs'),
  path = require('node:path'),
  { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '../packages/contracts/aic-foundation')
fs.mkdirSync(root, { recursive: true })
const str = { type: 'string' },
  nullable = { type: ['string', 'null'] },
  id = { type: 'string', format: 'uuid' },
  time = { type: 'string', format: 'date-time' }
const revision = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }
const obj = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const ref = (name) => ({ $ref: `#/definitions/${name}` })
const definitions = {
  Organization: obj({
    id,
    name: { type: 'string', minLength: 1 },
    tax_id: nullable,
    country: { type: 'string', minLength: 1 },
    created_at: time,
  }),
  User: obj({ id, organization_id: id, display_name: str, role: { const: 'specialist' } }),
  LoginInput: obj({
    username: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      pattern: '\\S',
      description: 'Also bounded to256 UTF-8 bytes at runtime',
    },
    password: {
      type: 'string',
      minLength: 1,
      maxLength: 1024,
      pattern: '\\S',
      description: 'Also bounded to1024 UTF-8 bytes at runtime; exact value is not trimmed',
    },
  }),
  SessionOutput: obj({
    user: ref('User'),
    csrf_token: { type: 'string', minLength: 1 },
    expires_at: time,
  }),
  Error: obj({ code: str, message: str, request_id: id, details: { type: ['object', 'null'] } }),
  Counterparty: obj({
    id,
    organization_id: id,
    name: str,
    country: str,
    tax_id: nullable,
    industry_code: nullable,
    source_refs: { type: 'array', items: str },
    identity_status: { enum: ['unresolved', 'confirmed', 'conflicting'] },
    revision,
    created_at: time,
    updated_at: time,
  }),
  ExposureRead: obj(
    {
      amount_vnd: { type: 'string', pattern: '^[1-9][0-9]{0,23}$' },
      term_days: { type: ['integer', 'null'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      organization_role: str,
      counterparty_role: str,
      contract_ref: nullable,
      conditions: { type: 'array', items: true },
      source_origin: str,
      due_date: { type: ['string', 'null'], format: 'date' },
    },
    [
      'amount_vnd',
      'term_days',
      'organization_role',
      'counterparty_role',
      'contract_ref',
      'conditions',
      'source_origin',
    ],
  ),
  Case: obj({
    id,
    organization_id: id,
    counterparty_id: id,
    exposure_kind: { enum: ['RECEIVABLE', 'PREPAYMENT', 'LOAN', 'DEBT_INVESTMENT'] },
    lifecycle_stage: { enum: ['proposed', 'active'] },
    exposure: ref('ExposureRead'),
    revision,
    policy_version: str,
    method_version: nullable,
    created_at: time,
    updated_at: time,
  }),
  HistoryEvent: obj({
    id,
    actor: str,
    action: str,
    time,
    reason: nullable,
    revision_before: { ...revision, type: ['integer', 'null'] },
    revision_after: { ...revision, type: ['integer', 'null'] },
    subject_refs: { type: 'array', items: id },
  }),
}
for (const name of ['Case', 'Counterparty', 'HistoryEvent'])
  definitions[name + 'Page'] = obj({
    items: { type: 'array', items: ref(name) },
    next_cursor: nullable,
  })
definitions.Document = obj({
  id,
  lineage: id,
  version: revision,
  hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  pages: { type: 'integer', minimum: 1, maximum: 10 },
  type: {
    enum: [
      'registration',
      'loan_request',
      'financial_statement',
      'contract',
      'acceptance_record',
      'payment_record',
      'invoice',
      'other',
    ],
  },
  name: str,
  status: { enum: ['queued', 'running', 'completed', 'partial', 'failed'] },
  owner_party_ref: { const: 'unresolved' },
  source: obj({
    source_class: str,
    document_id: id,
    version: revision,
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    ai_mode: { enum: ['live', 'mock'] },
    subject_verification: { const: 'unverified' },
  }),
  classification: obj({ declared_type: str, verified: { const: false } }),
})
definitions.Case.properties.documents = { type: 'array', items: ref('Document') }
definitions.Case.properties.jobs = { type: 'array', items: ref('Job') }
definitions.ExtractedField = obj({
  field_key: str,
  value: true,
  raw_value: nullable,
  quality: { enum: ['readable', 'uncertain', 'unreadable', 'human_reviewed'] },
  missing_reason: nullable,
  evidence_refs: { type: 'array', items: id },
})
definitions.ExtractionRead = { type: 'array', items: ref('ExtractedField') }
definitions.Document.properties.extraction = ref('ExtractionRead')
definitions.Document.properties.source_review = obj({
  reason: str,
  declared_type: definitions.Document.properties.type,
  subject_match: { enum: ['match', 'mismatch', 'unresolved'] },
  reviewed_pages: {
    type: 'array',
    minItems: 1,
    maxItems: 10,
    items: { type: 'integer', minimum: 1, maximum: 10 },
  },
  evidence_refs: { type: 'array', items: id },
  verification: { const: 'source_reviewed' },
  entered_by: id,
  document_id: id,
  document_version: revision,
  source_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  actor_id: id,
  created_at: time,
})
definitions.Document.properties.source_review.properties.counterparty_revision = revision
definitions.Evidence = obj({
  id,
  document_id: id,
  document_version: revision,
  page: { type: 'integer', minimum: 1, maximum: 10 },
  quote: str,
  source_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  bbox: { type: ['array', 'null'], items: { type: 'number' }, minItems: 4, maxItems: 4 },
})
// Write projection is deliberately separate from the persisted, server-owned aggregate.
definitions.SourceInput = obj(
  {
    kind: { enum: ['declaration', 'document', 'questionnaire'] },
    reported_by: { enum: ['organization', 'counterparty'] },
    document_id: id,
    document_version: revision,
    document_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    evidence_ref: id,
    questionnaire_id: id,
    question_id: id,
    response_id: id,
    response_revision: revision,
  },
  ['kind', 'reported_by'],
)
definitions.SourceInput.allOf = [
  {
    if: { properties: { kind: { const: 'document' } } },
    then: { required: ['document_id', 'document_version', 'document_sha256', 'evidence_ref'] },
    else: {
      not: {
        anyOf: ['document_id', 'document_version', 'document_sha256', 'evidence_ref'].map((k) => ({
          required: [k],
        })),
      },
    },
  },
  {
    if: { properties: { kind: { const: 'questionnaire' } } },
    then: { required: ['questionnaire_id', 'question_id', 'response_id', 'response_revision'] },
    else: {
      not: {
        anyOf: ['questionnaire_id', 'question_id', 'response_id', 'response_revision'].map((k) => ({
          required: [k],
        })),
      },
    },
  },
]
definitions.ConditionInput = obj({
  kind: { enum: ['payment', 'delivery', 'acceptance', 'refund', 'guarantee', 'other'] },
  scope: { type: 'string', minLength: 1, maxLength: 1000 },
  trigger_text: { type: ['string', 'null'], maxLength: 4000 },
  reported_state: { enum: ['proposed', 'reported_satisfied', 'unknown'] },
  due_on: { type: ['string', 'null'], format: 'date' },
  missing_reason: { type: ['string', 'null'], maxLength: 1000 },
  source_refs: { type: 'array', minItems: 1, maxItems: 20, items: ref('SourceInput') },
})
definitions.ClaimInput = obj({
  kind: { enum: ['paid', 'received'] },
  event_state: { enum: ['proposed', 'actual'] },
  claimant_party: { enum: ['organization', 'counterparty'] },
  payer_party: { enum: ['organization', 'counterparty'] },
  payee_party: { enum: ['organization', 'counterparty'] },
  currency: { const: 'VND' },
  amount_vnd: { type: ['string', 'null'], pattern: '^(0|[1-9][0-9]{0,23})$' },
  amount_missing_reason: { type: ['string', 'null'], maxLength: 1000 },
  occurred_on: { type: ['string', 'null'], format: 'date' },
  planned_on: { type: ['string', 'null'], format: 'date' },
  date_missing_reason: { type: ['string', 'null'], maxLength: 1000 },
  obligation_ref: nullable,
  source_refs: { type: 'array', minItems: 1, maxItems: 20, items: ref('SourceInput') },
})
definitions.ExposureWriteInput = obj(
  {
    amount_vnd: { type: ['string', 'null'], pattern: '^[1-9][0-9]{0,23}$' },
    amount_missing_reason: { type: ['string', 'null'], minLength: 1, maxLength: 1000 },
    term_days: { type: ['integer', 'null'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    term_null_reason: { enum: [null, 'not_agreed', 'source_missing', 'ambiguous'] },
    organization_role: { enum: ['seller', 'buyer'] },
    counterparty_role: { enum: ['buyer', 'seller'] },
    contract_ref: nullable,
    due_date: { type: ['string', 'null'], format: 'date' },
    source_origin: { const: 'staff_entered' },
    conditions: { type: 'array', maxItems: 50, items: ref('ConditionInput') },
    claims: { type: 'array', maxItems: 50, items: ref('ClaimInput') },
  },
  [
    'amount_vnd',
    'term_days',
    'organization_role',
    'counterparty_role',
    'contract_ref',
    'conditions',
    'source_origin',
  ],
)
definitions.ExposureWriteInput.allOf = [
  {
    if: { properties: { amount_vnd: { type: 'null' } } },
    then: { required: ['amount_missing_reason'] },
  },
  {
    if: { properties: { term_days: { type: 'null' } } },
    then: { required: ['term_null_reason'], properties: { term_null_reason: { type: 'string' } } },
    else: { properties: { term_null_reason: { type: 'null' } } },
  },
]
definitions.CaseCreateInput = obj({
  counterparty_id: id,
  exposure_kind: { enum: ['RECEIVABLE', 'PREPAYMENT'] },
  lifecycle_stage: { enum: ['proposed', 'active'] },
  exposure: ref('ExposureWriteInput'),
})
definitions.ExposureUpdateInput = obj({
  expected_revision: revision,
  exposure: ref('ExposureWriteInput'),
})
definitions.RevisionInput = obj({ expected_revision: revision })
definitions.ReasonInput = obj({
  expected_revision: revision,
  reason: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' },
})
definitions.DocumentClassificationInput = obj({
  expected_revision: revision,
  reason: definitions.ReasonInput.properties.reason,
  declared_type: definitions.Document.properties.type,
  subject_match: { enum: ['match', 'mismatch', 'unresolved'] },
  reviewed_pages: {
    type: 'array',
    minItems: 1,
    maxItems: 10,
    uniqueItems: true,
    items: { type: 'integer', minimum: 1, maximum: 10 },
  },
  evidence_refs: { type: 'array', maxItems: 100, uniqueItems: true, items: id },
})
definitions.DocumentCorrectionInput = obj({
  expected_revision: revision,
  reason: definitions.ReasonInput.properties.reason,
  field_key: { type: 'string', minLength: 1, maxLength: 300 },
  value: true,
  evidence_refs: { type: 'array', maxItems: 100, uniqueItems: true, items: id },
})
definitions.DocumentDecisionOutput = obj({
  document_id: id,
  revision,
  decision: { type: 'object' },
  created_at: time,
})
definitions.DocumentFieldVerificationInput = obj({
  expected_revision: revision,
  reason: definitions.ReasonInput.properties.reason,
  field_key: { type: 'string', minLength: 1, maxLength: 300 },
  evidence_refs: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: id },
})
definitions.RequestDraftInput = obj({
  expected_revision: revision,
  run_id: id,
  issue_id: id,
  purpose: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' },
  content: { type: 'string', minLength: 1, maxLength: 10000, pattern: '\\S' },
  document_types: {
    type: 'array',
    minItems: 1,
    maxItems: 8,
    uniqueItems: true,
    items: definitions.Document.properties.type,
  },
})
definitions.WaiverInput = obj({
  expected_revision: revision,
  requirement_key: { type: 'string', minLength: 1, maxLength: 200 },
  issue_id: id,
  reason: definitions.ReasonInput.properties.reason,
})
definitions.Finding = obj(
  {
    id,
    issue_key: str,
    rule_id: str,
    category: str,
    severity: str,
    summary: str,
    evidence_refs: { type: 'array', items: id },
    finding_state: { enum: ['open', 'verified_resolved', 'dismissed'] },
    handling_state: { enum: ['none', 'requested', 'waived'] },
    limitations: { type: 'array', items: str },
    absence_basis: str,
  },
  [
    'id',
    'issue_key',
    'rule_id',
    'category',
    'severity',
    'summary',
    'evidence_refs',
    'finding_state',
    'handling_state',
    'limitations',
  ],
)
definitions.TransactionReview = obj({
  exposure_kind: { enum: ['RECEIVABLE', 'PREPAYMENT'] },
  status: { enum: ['BLOCKED', 'FOLLOW_UP', 'CLEAR_FOR_REVIEW', 'UNKNOWN'] },
  findings: { type: 'array', items: ref('Finding') },
  limitations: { type: 'array', items: str },
  verified_settlement_vnd: { type: 'null' },
  verified_outstanding_vnd: { type: 'null' },
})
definitions.IssueDecisionInput = obj({
  expected_revision: revision,
  action: { enum: ['resolve', 'dismiss', 'reopen'] },
  reason: definitions.ReasonInput.properties.reason,
  evidence_refs: { type: 'array', maxItems: 100, uniqueItems: true, items: id },
})
definitions.IssueDecisionOutput = obj({
  issue: ref('Finding'),
  revision,
  decision_id: id,
  created_at: time,
})
definitions.QuestionnaireCreateInput = obj({
  expected_revision: revision,
  reason: definitions.ReasonInput.properties.reason,
  questions: {
    type: 'array',
    minItems: 1,
    maxItems: 20,
    items: obj({ label: { type: 'string', minLength: 1, maxLength: 3000, pattern: '\\S' } }),
  },
})
definitions.Question = obj({
  id,
  version: { const: 1 },
  answer_type: { const: 'text' },
  label: str,
  requiredness: { const: 'optional' },
  allowed_to_skip: { const: true },
  source_requirements: obj({
    declaration_allowed: { const: true },
    documents_required: { const: false },
    skip_reason_required: { const: true },
  }),
  verification_policy: { const: 'human_source_review_only_not_fact_or_settlement_certification' },
})
definitions.StaffResponseInput = obj({
  expected_revision: revision,
  reason: definitions.ReasonInput.properties.reason,
  question_id: id,
  question_version: { const: 1 },
  answer_state: { enum: ['submitted', 'self_assessed', 'skipped'] },
  answer_json: { type: ['string', 'null'], maxLength: 5000 },
  reported_by: { enum: ['organization', 'counterparty'] },
  reported_reference: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' },
  source_refs: { type: 'array', maxItems: 100, uniqueItems: true, items: id },
})
definitions.ResponseVerificationInput = obj({
  expected_revision: revision,
  response_revision: revision,
  reason: definitions.ReasonInput.properties.reason,
  status: { enum: ['unverified', 'verified', 'conflicting'] },
  evidence_refs: { type: 'array', maxItems: 100, uniqueItems: true, items: id },
})
definitions.StaffResponse = obj({
  id,
  question_id: id,
  question_version: { const: 1 },
  answer_state: { enum: ['submitted', 'self_assessed', 'skipped'] },
  answer_json: { type: ['string', 'null'] },
  origin: { const: 'staff_transcribed' },
  source_refs: { type: 'array', items: id },
  revision,
  reported_by: { enum: ['organization', 'counterparty'] },
  reported_reference: str,
  entered_by: id,
  created_at: time,
  reason: str,
  verification_status: { enum: ['unverified', 'verified', 'conflicting'] },
  verification_stale: { type: 'boolean' },
})
definitions.Questionnaire = obj({
  id,
  policy_version: { const: 'MVP-OPTIONAL-TEXT-1' },
  questions: { type: 'array', items: ref('Question') },
  responses: { type: 'array', items: ref('StaffResponse') },
})
definitions.ResponseVerificationOutput = obj({
  id,
  response_id: id,
  response_revision: revision,
  revision,
  status: definitions.ResponseVerificationInput.properties.status,
  reason: str,
  evidence_refs: { type: 'array', items: id },
  actor_id: id,
  created_at: time,
})
definitions.Case.properties.questionnaires = { type: 'array', items: ref('Questionnaire') }
definitions.Case.properties.issue_history = { type: 'array', items: ref('Finding') }
definitions.Case.properties.review_stale = { type: 'boolean' }
definitions.Case.properties.counterparty_revision = revision
definitions.CounterpartyCreateInput = obj({
  name: { type: 'string', minLength: 1, maxLength: 250, pattern: '\\S' },
  country: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
  tax_id: { type: ['string', 'null'], maxLength: 100 },
  industry_code: { type: ['string', 'null'], maxLength: 50 },
  source: obj({
    kind: { const: 'declaration' },
    reported_by: { enum: ['organization', 'counterparty'] },
    reported_reference: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' },
    statement: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' },
  }),
  reason: definitions.ReasonInput.properties.reason,
})
definitions.CounterpartyUpdateInput = obj({
  ...definitions.CounterpartyCreateInput.properties,
  expected_revision: revision,
})
definitions.DocumentRetryOutput = obj({ job: ref('Job'), revision })
definitions.InvitationCreateInput = obj({
  expected_revision: revision,
  reason: definitions.ReasonInput.properties.reason,
  question_ids: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: id },
  reported_by: { enum: ['organization', 'counterparty'] },
  recipient_reference: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' },
})
definitions.Invitation = obj({
  id,
  questionnaire_id: id,
  questionnaire_version: { const: 1 },
  question_ids: { type: 'array', items: id },
  reported_by: { enum: ['organization', 'counterparty'] },
  recipient_reference: str,
  expires_at: time,
  created_at: time,
  status: { enum: ['active', 'revoked', 'expired', 'submitted', 'closed'] },
  token_delivery: { const: 'one_time_response_header' },
})
definitions.InvitationCreated = obj({ invitation: ref('Invitation'), revision })
definitions.QuestionnaireState = obj({
  id,
  version: { const: 1 },
  state: { enum: ['draft', 'published', 'closed'] },
  revision,
})
definitions.RespondentForm = obj({
  questions: { type: 'array', items: ref('Question') },
  expires_at: time,
  questionnaire_version: { const: 1 },
})
definitions.RespondentSubmitInput = obj({
  reported_reference: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' },
  answers: {
    type: 'array',
    minItems: 1,
    maxItems: 20,
    items: obj({
      question_id: id,
      question_version: { const: 1 },
      answer_state: { enum: ['submitted', 'self_assessed', 'skipped'] },
      answer_json: { type: ['string', 'null'], maxLength: 5000 },
      skip_reason: { type: ['string', 'null'], maxLength: 4000 },
    }),
  },
})
definitions.RespondentReceipt = obj({
  receipt_id: id,
  submitted_at: time,
  answer_count: { type: 'integer', minimum: 1, maximum: 20 },
  identity_assurance: { const: 'self_reported_capability_only' },
})
definitions.RespondentForm.properties.receipt = ref('RespondentReceipt')
definitions.StaffResponse.properties.origin = { enum: ['staff_transcribed', 'SME_direct'] }
definitions.StaffResponse.properties.entered_by = { ...id, type: ['string', 'null'] }
definitions.StaffResponse.properties.invitation_id = { ...id, type: ['string', 'null'] }
definitions.Questionnaire.properties.version = { const: 1 }
definitions.Questionnaire.properties.state = { enum: ['draft', 'published', 'closed'] }
definitions.Questionnaire.properties.invitations = { type: 'array', items: ref('Invitation') }
definitions.ReviewRun = obj({
  id,
  case_id: id,
  case_revision: revision,
  rules_version: str,
  policy_version: str,
  snapshot_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  source_snapshot_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  state: { const: 'completed' },
  stale: { type: 'boolean' },
  findings: { type: 'array', items: ref('Finding') },
  issue_history: { type: 'array', items: ref('Finding') },
  transaction_review: ref('TransactionReview'),
  financial_health: obj({
    status: { const: 'unconfigured' },
    score: { type: 'null' },
    band: { type: 'null' },
    grade: { type: 'null' },
    pd: { type: 'null' },
    blockers: { type: 'array', items: str },
  }),
  created_at: time,
})
// Existing immutable review payloads remain readable. New decisions require a
// newly run review containing source_snapshot_hash at the service boundary.
definitions.ReviewRun.required = definitions.ReviewRun.required.filter(
  (name) => !['source_snapshot_hash', 'issue_history'].includes(name),
)
definitions.ReviewRun.properties.counterparty_revision = revision
definitions.DocumentRequest = obj(
  {
    id,
    status: { enum: ['draft', 'approved', 'closed', 'cancelled'] },
    revision,
    run_id: id,
    issue_id: id,
    purpose: str,
    content: str,
    document_types: { type: 'array', items: definitions.Document.properties.type },
    approved_payload: { type: ['object', 'null'] },
    approved_hash: nullable,
    created_at: time,
    updated_at: time,
  },
  [
    'id',
    'status',
    'revision',
    'run_id',
    'issue_id',
    'purpose',
    'content',
    'document_types',
    'created_at',
    'updated_at',
  ],
)
definitions.Waiver = obj(
  {
    id,
    actor_id: id,
    policy_version: str,
    created_at: time,
    active: { type: 'boolean' },
    requirement_key: str,
    reason: str,
    issue_id: id,
    revoked_at: { type: ['string', 'null'], format: 'date-time' },
  },
  [
    'id',
    'actor_id',
    'policy_version',
    'created_at',
    'active',
    'requirement_key',
    'reason',
    'issue_id',
  ],
)
definitions.Readiness = obj({
  case_revision: revision,
  document_review_allowed: { type: 'boolean' },
  numeric_assessment_allowed: { const: false },
  method_status: { const: 'unconfigured' },
  blockers: { type: 'array', items: obj({ code: str, message: str }) },
  limitations: { type: 'array', items: str },
  waivable_requirements: {
    type: 'array',
    items: obj({ requirement_key: str, label: str, issue_id: id }, ['requirement_key']),
  },
})
Object.assign(definitions.Case.properties, {
  latest_review_run_id: { type: ['string', 'null'], format: 'uuid' },
  findings: { type: 'array', items: ref('Finding') },
  readiness: ref('Readiness'),
  requests: { type: 'array', items: ref('DocumentRequest') },
  waivers: { type: 'array', items: ref('Waiver') },
  transaction_review: { anyOf: [ref('TransactionReview'), { type: 'null' }] },
})
// Read projection can include versioned unverified declarations; no verified settlement is synthesized.
Object.assign(definitions.ExposureRead.properties, {
  amount_vnd: definitions.ExposureWriteInput.properties.amount_vnd,
  amount_missing_reason: definitions.ExposureWriteInput.properties.amount_missing_reason,
  term_null_reason: definitions.ExposureWriteInput.properties.term_null_reason,
  claims: { type: 'array', items: { type: 'object' } },
  source_refs: { type: 'array', items: { type: 'object' } },
  schema_version: str,
  verification: { const: 'unverified' },
})
definitions.Case.properties.policy_artifact_hash = {
  type: ['string', 'null'],
  pattern: '^[a-f0-9]{64}$',
}
definitions.Job = obj(
  {
    id,
    case_id: id,
    document_id: id,
    state: { enum: ['queued', 'running', 'completed', 'partial', 'failed'] },
    attempts: { type: 'integer', minimum: 0 },
    retryable: { type: 'boolean' },
    errors: { type: 'array', items: obj({ code: str, retryable: { type: 'boolean' } }) },
    mode: { enum: ['live', 'mock'] },
    created_at: time,
  },
  ['id', 'state'],
)
definitions.DocumentAccepted = obj({ document: ref('Document'), job: ref('Job'), revision })
const financialKeys = [
  'current_assets',
  'current_liabilities',
  'cash',
  'unrestricted_short_term_equivalents',
  'trade_receivables',
  'total_equity',
  'total_assets',
  'total_liabilities',
  'interest_bearing_debt',
  'operating_profit',
  'depreciation_amortization',
  'interest_expense',
  'net_revenue',
  'cash_from_operations',
]
definitions.FinancialSourceInput = {
  oneOf: [
    obj({
      kind: { const: 'document' },
      document_id: id,
      document_version: revision,
      source_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      page: { type: 'integer', minimum: 1, maximum: 10 },
      quote: { type: 'string', minLength: 1, maxLength: 4000 },
      evidence_ref: id,
    }),
    obj({
      kind: { const: 'manual_entry' },
      statement: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' },
    }),
  ],
}
definitions.FinancialSetInput = obj({
  expected_revision: revision,
  reason: definitions.ReasonInput.properties.reason,
  period: obj({
    kind: { enum: ['FY', 'TTM', 'INTERIM'] },
    start_date: { type: 'string', format: 'date' },
    end_date: { type: 'string', format: 'date' },
  }),
  basis: { enum: ['standalone', 'consolidated'] },
  accounting_regime: { enum: ['VN_TT133', 'VN_TT99', 'VN_TT58', 'IFRS', 'OTHER', 'UNKNOWN'] },
  currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  unit_multiplier: { type: 'string', pattern: '^[1-9][0-9]{0,11}$' },
  industry_scope: {
    enum: [
      'DISTRIBUTION_WHOLESALE_PILOT',
      'MANUFACTURING',
      'RETAIL',
      'BUSINESS_SERVICES',
      'CONSUMER_DURABLES',
      'OTHER',
      'UNKNOWN',
    ],
  },
  observation_kind: { enum: ['actual', 'forecast'] },
  audit_status: { enum: ['audited', 'unaudited', 'unknown'] },
  statement_version: { type: 'string', minLength: 1, maxLength: 100 },
  facts: {
    type: 'array',
    maxItems: 14,
    items: obj({
      key: { enum: financialKeys },
      raw_value: { type: ['string', 'null'], pattern: '^-?[0-9]{1,30}(\\.[0-9]{1,12})?$' },
      raw_label: { type: 'string', minLength: 1, maxLength: 500 },
      missing_reason: { type: ['string', 'null'], maxLength: 1000 },
      source: ref('FinancialSourceInput'),
    }),
  },
})
definitions.FinancialVerifyInput = obj({
  expected_revision: revision,
  set_revision: revision,
  reason: definitions.ReasonInput.properties.reason,
  status: { enum: ['verified', 'unverified', 'rejected'] },
  fact_ids: { type: 'array', minItems: 1, maxItems: 14, uniqueItems: true, items: id },
  bridge_assertions: obj({
    quick_assets_non_overlapping: { type: 'boolean' },
    quick_assets_eligible: { type: 'boolean' },
    da_addback_to_operating_profit: { type: 'boolean' },
  }),
})
definitions.FinancialScope = obj({
  entity_id: id,
  country: str,
  industry: str,
  pilot_scope: str,
  period: definitions.FinancialSetInput.properties.period,
  basis: definitions.FinancialSetInput.properties.basis,
  accounting_regime: str,
  currency: definitions.FinancialSetInput.properties.currency,
  unit_multiplier: definitions.FinancialSetInput.properties.unit_multiplier,
})
definitions.FinancialFactRead = obj(
  {
    ...definitions.FinancialSetInput.properties.facts.items.properties,
    id,
    revision,
    normalized_decimal: { type: ['string', 'null'] },
    currency: str,
    unit_multiplier: str,
    period: definitions.FinancialSetInput.properties.period,
    basis: str,
    adjustments: {
      type: 'array',
      items: obj({ kind: { const: 'unit_normalization' }, multiplier: str, result: str }),
    },
    source_origin: { enum: ['staff_entered', 'document'] },
    entered_by: id,
    recorded_case_revision: revision,
    current_source: { type: 'boolean' },
    verification: obj({
      status: { enum: ['unverified', 'verified', 'stale', 'rejected'] },
      verified_revision: { type: ['integer', 'null'], minimum: 1 },
      verified_by: { type: ['string', 'null'], format: 'uuid' },
      verified_at: { type: ['string', 'null'], format: 'date-time' },
    }),
    verification_reason: str,
  },
  [
    'key',
    'raw_value',
    'raw_label',
    'missing_reason',
    'source',
    'id',
    'revision',
    'normalized_decimal',
    'currency',
    'unit_multiplier',
    'period',
    'basis',
    'adjustments',
    'source_origin',
    'entered_by',
    'recorded_case_revision',
    'current_source',
    'verification',
  ],
)
definitions.FinancialSetRead = obj({
  id,
  revision,
  scope: ref('FinancialScope'),
  metadata: obj({
    observation_kind: definitions.FinancialSetInput.properties.observation_kind,
    audit_status: definitions.FinancialSetInput.properties.audit_status,
    statement_version: definitions.FinancialSetInput.properties.statement_version,
  }),
  facts: { type: 'array', maxItems: 14, items: ref('FinancialFactRead') },
  created_at: time,
  verification_stale: { type: 'boolean' },
})
definitions.FinancialRegistry = obj({
  sets: { type: 'array', items: ref('FinancialSetRead') },
  selected_set_id: { type: ['string', 'null'], format: 'uuid' },
  method_status: { const: 'unconfigured' },
  score: { type: 'null' },
  band: { type: 'null' },
  grade: { type: 'null' },
  pd: { type: 'null' },
  metrics: {
    type: 'array',
    maxItems: 7,
    items: {
      type: 'object',
      required: [
        'metric_id',
        'group',
        'formula_id',
        'formula',
        'status',
        'raw_ratio',
        'source_facts',
        'max_points',
        'anchors',
        'points',
        'flags',
        'blockers',
      ],
      properties: { points: { type: 'null' }, status: { enum: ['available', 'unavailable'] } },
    },
  },
  blockers: { type: 'array', items: str },
  strengths: { type: 'array', items: str },
  weaknesses: { type: 'array', items: str },
  limitations: { type: 'array', items: str },
})
definitions.FinancialMutationOutput = obj({ set: ref('FinancialSetRead'), revision })
const schemas = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'urn:aic:foundation:1',
  title: 'AIC foundation and explicitly enabled MVP sandbox operations',
  definitions,
}
const paths = {}
const op = (p, method, operationId, response, status = 200, request) => {
  const content = {
    'application/json': { schema: { $ref: `./schemas.json#/definitions/${response}` } },
  }
  paths[p] ??= {}
  paths[p][method] = {
    operationId,
    security: p === '/auth/login' ? [] : [{ sessionCookie: [] }],
    responses: {
      [status]:
        status === 204 ? { description: 'No Content' } : { description: 'Success', content },
      default: {
        description: 'Error',
        content: { 'application/json': { schema: { $ref: './schemas.json#/definitions/Error' } } },
      },
    },
  }
  if (request)
    paths[p][method].requestBody = {
      required: true,
      content: {
        'application/json': { schema: { $ref: `./schemas.json#/definitions/${request}` } },
      },
    }
  if (p.includes('{id}'))
    paths[p][method].parameters = [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ]
  if (method === 'get' && /counterparties$|cases$|history$/.test(p))
    paths[p][method].parameters = [
      ...(paths[p][method].parameters ?? []),
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      { name: 'cursor', in: 'query', schema: { type: 'string' } },
    ]
  if (method === 'post')
    paths[p][method].parameters = [
      { name: 'Origin', in: 'header', required: true, schema: { type: 'string' } },
      ...(p === '/auth/logout'
        ? [
            {
              name: 'X-CSRF-Token',
              in: 'header',
              description:
                'Required for an active session; expired/revoked session still204 with valid Origin',
              schema: { type: 'string' },
            },
          ]
        : []),
    ]
}
op('/auth/login', 'post', 'login', 'SessionOutput', 200, 'LoginInput')
op('/auth/me', 'get', 'me', 'SessionOutput')
op('/auth/logout', 'post', 'logout', null, 204)
op('/counterparties', 'get', 'listCounterparties', 'CounterpartyPage')
op('/counterparties/{id}', 'get', 'getCounterparty', 'Counterparty')
op(
  '/counterparties',
  'post',
  'createUnresolvedCounterparty',
  'Counterparty',
  201,
  'CounterpartyCreateInput',
)
op(
  '/counterparties/{id}',
  'patch',
  'editUnresolvedCounterparty',
  'Counterparty',
  200,
  'CounterpartyUpdateInput',
)
op('/cases', 'get', 'listCases', 'CasePage')
op('/cases', 'post', 'createSandboxCase', 'Case', 201, 'CaseCreateInput')
op('/cases/{id}/exposure', 'patch', 'updateSandboxExposure', 'Case', 200, 'ExposureUpdateInput')
op('/cases/{id}', 'get', 'getCase', 'Case')
op('/cases/{id}/history', 'get', 'getCaseHistory', 'HistoryEventPage')
op('/cases/{id}/documents', 'post', 'uploadDocument', 'DocumentAccepted', 202)
paths['/cases/{id}/documents'].post.parameters.push(
  { name: 'id', in: 'path', required: true, schema: id },
  { name: 'X-CSRF-Token', in: 'header', required: true, schema: str },
  {
    name: 'Idempotency-Key',
    in: 'header',
    required: true,
    schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' },
  },
)
paths['/cases/{id}/documents'].post.requestBody = {
  required: true,
  content: {
    'multipart/form-data': {
      schema: obj(
        {
          file: { type: 'string', format: 'binary' },
          type: definitions.Document.properties.type,
          source_class: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,64}$' },
          mode: { enum: ['new', 'replace', 'response'] },
          expected_revision: { type: 'string', pattern: '^[1-9][0-9]*$' },
          replaces_document_id: id,
          response_request_id: id,
        },
        ['file', 'type', 'source_class', 'mode', 'expected_revision'],
      ),
    },
  },
}
op('/jobs/{id}', 'get', 'getDocumentJob', 'Job')
op(
  '/jobs/{id}/retry',
  'post',
  'retryDocumentJobWithinBudget',
  'DocumentRetryOutput',
  200,
  'ReasonInput',
)
op('/documents/{id}/source', 'get', 'getDocumentSource', 'Document')
paths['/documents/{id}/source'].get.responses[200] = {
  description: 'Exact immutable authorized PDF bytes',
  content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
}
definitions.LegacyExtractionRead = obj({
  document_id: id,
  document_version: revision,
  source_hash: str,
  ai_mode: { enum: ['live', 'mock'] },
  schema_version: { const: '1.0.2' },
  verification: { const: 'unverified' },
  raw: { type: 'object' },
})
op('/documents/{id}/extraction', 'get', 'readExtraction', 'ExtractionRead')
op(
  '/documents/{id}/verification',
  'post',
  'verifyDocumentFieldWithoutCorrection',
  'DocumentDecisionOutput',
  200,
  'DocumentFieldVerificationInput',
)
op('/documents/{id}/legacy-extraction', 'get', 'readLegacyExtraction', 'LegacyExtractionRead')
op('/evidence/{id}', 'get', 'getDocumentEvidence', 'Evidence')
op(
  '/documents/{id}/classification',
  'post',
  'reviewDocumentClassification',
  'DocumentDecisionOutput',
  200,
  'DocumentClassificationInput',
)
op(
  '/documents/{id}/corrections',
  'post',
  'correctDocumentField',
  'DocumentDecisionOutput',
  200,
  'DocumentCorrectionInput',
)
op('/cases/{id}/review-runs', 'post', 'runSandboxReview', 'ReviewRun', 201, 'RevisionInput')
op('/cases/{id}/readiness', 'get', 'sandboxReadiness', 'Readiness')
op('/cases/{id}/financial-sets', 'get', 'readFinancialRegistry', 'FinancialRegistry')
paths['/cases/{id}/financial-sets'].get.parameters.push({
  name: 'set_id',
  in: 'query',
  schema: id,
  description:
    'Explicit statement set within this case. Required to calculate ratios when multiple sets exist; never mixes periods or bases.',
})
op(
  '/cases/{id}/financial-sets',
  'post',
  'createFinancialSet',
  'FinancialMutationOutput',
  201,
  'FinancialSetInput',
)
op(
  '/financial-sets/{id}',
  'patch',
  'reviseFinancialSet',
  'FinancialMutationOutput',
  200,
  'FinancialSetInput',
)
op(
  '/financial-sets/{id}/verification',
  'post',
  'verifyFinancialFacts',
  'FinancialMutationOutput',
  200,
  'FinancialVerifyInput',
)
op(
  '/questionnaires/{id}/invitations',
  'post',
  'createNativeInvitation',
  'InvitationCreated',
  201,
  'InvitationCreateInput',
)
op(
  '/invitations/{id}/revoke',
  'post',
  'revokeNativeInvitation',
  'InvitationCreated',
  200,
  'ReasonInput',
)
op(
  '/questionnaires/{id}/close',
  'post',
  'closeNativeQuestionnaire',
  'QuestionnaireState',
  200,
  'ReasonInput',
)
op('/respondent/form', 'get', 'readCapabilityForm', 'RespondentForm')
op(
  '/respondent/responses',
  'post',
  'submitCapabilityAnswers',
  'RespondentReceipt',
  201,
  'RespondentSubmitInput',
)
for (const route of ['/respondent/form', '/respondent/responses'])
  for (const operation of Object.values(paths[route]))
    operation.security = [{ respondentCapability: [] }]
paths['/questionnaires/{id}/invitations'].post.responses[201].headers = {
  'X-Invitation-Token': {
    description:
      'Raw capability secret, delivered on the first committed response only, never on replay. The frozen JSON body contains metadata only. A lost secret requires explicit reissue/revocation; do not retry with a new key automatically.',
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
  },
}
op('/review-runs/{id}', 'get', 'getSandboxReview', 'ReviewRun')
op(
  '/issues/{id}/decisions',
  'post',
  'decideSandboxIssue',
  'IssueDecisionOutput',
  200,
  'IssueDecisionInput',
)
op(
  '/cases/{id}/questionnaires',
  'post',
  'createOptionalQuestionnaire',
  'Questionnaire',
  201,
  'QuestionnaireCreateInput',
)
op('/questionnaires/{id}', 'get', 'getStaffQuestionnaire', 'Questionnaire')
op(
  '/questionnaires/{id}/staff-responses',
  'post',
  'recordStaffResponse',
  'StaffResponse',
  201,
  'StaffResponseInput',
)
op(
  '/responses/{id}/verification',
  'post',
  'verifyStaffResponseSource',
  'ResponseVerificationOutput',
  201,
  'ResponseVerificationInput',
)
op(
  '/cases/{id}/requests',
  'post',
  'draftDocumentRequest',
  'DocumentRequest',
  201,
  'RequestDraftInput',
)
op('/requests/{id}', 'patch', 'editDocumentRequest', 'DocumentRequest', 200, 'RequestDraftInput')
for (const action of ['approve', 'cancel', 'ack'])
  op(
    '/requests/{id}/' + action,
    'post',
    action + 'DocumentRequest',
    'DocumentRequest',
    200,
    'ReasonInput',
  )
op('/requests/{id}/export', 'get', 'exportDocumentRequest', 'DocumentRequest')
paths['/requests/{id}/export'].get.responses[200] = {
  description: 'Immutable approved UTF-8 export bytes',
  content: { 'text/plain': { schema: { type: 'string' } } },
}
op('/cases/{id}/waivers', 'post', 'waiveDocumentRequirement', 'Waiver', 201, 'WaiverInput')
op('/waivers/{id}/revoke', 'post', 'revokeDocumentWaiver', 'Waiver', 200, 'ReasonInput')
for (const [route, methods] of Object.entries(paths))
  for (const [method, operation] of Object.entries(methods)) {
    if (!['post', 'patch'].includes(method) || route.startsWith('/auth/')) continue
    operation.parameters ??= []
    for (const parameter of [
      { name: 'Origin', in: 'header', required: true, schema: str },
      ...(!route.startsWith('/respondent/')
        ? [{ name: 'X-CSRF-Token', in: 'header', required: true, schema: str }]
        : []),
      {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', minLength: 1, maxLength: 200 },
      },
    ])
      if (!operation.parameters.some((p) => p.in === parameter.in && p.name === parameter.name))
        operation.parameters.push(parameter)
    if (route.includes('{id}') && !operation.parameters.some((p) => p.in === 'path'))
      operation.parameters.push({ name: 'id', in: 'path', required: true, schema: id })
  }
const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'AIC Foundation and Local MVP Sandbox',
    version: '0.4.0-mvp-sandbox',
    description:
      'Local sandbox freeze: unresolved counterparty CRUD, case/Exposure including exact questionnaire sources, immutable documents and field verification, bounded manual retry, native capability invitations/forms, Transaction Review, financial fact registry and gated ratios. Explicit local opt-in only. Numeric FHI activation, legal identity confirmation, public ingress and production deployment are not released.',
  },
  servers: [{ url: '/api/v2' }],
  paths,
  components: {
    securitySchemes: {
      respondentCapability: {
        type: 'http',
        scheme: 'bearer',
        description:
          'High-entropy invitation capability; no specialist session cookie. Token conveys scoped access only, not legal identity assurance.',
      },
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'aic_fe_qa',
        description: 'Default transport name; server configuration may override consistently.',
      },
    },
  },
}
for (const [name, data] of Object.entries({ 'schemas.json': schemas, 'openapi.json': openapi }))
  fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2) + '\n')
console.log('Generated scoped foundation schemas/OpenAPI; legacy1.0.2 unchanged')
fs.writeFileSync(path.join(root, 'VERSION'), '0.4.0-mvp-sandbox\n')
fs.writeFileSync(
  path.join(root, 'SHA256SUMS'),
  ['schemas.json', 'openapi.json', 'VERSION', 'examples.json']
    .map(
      (name) =>
        createHash('sha256')
          .update(fs.readFileSync(path.join(root, name)))
          .digest('hex') +
        '  ' +
        name,
    )
    .join('\n') + '\n',
)
