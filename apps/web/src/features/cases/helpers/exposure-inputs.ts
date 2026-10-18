import { ApiError } from '@/lib/api/client'
import type {
  CaseDetail,
  TransactionCaseDetail,
  Document,
  Exposure,
  ExposureKind,
} from '@/lib/api/contracts'
import type { Locale } from '@/lib/api/contracts'
import { translate, type MessageKey } from '@/lib/i18n/messages'

export type TransactionDraft = {
  kind: ExposureKind
  party: string
  amount: string | null
  amountMissingReason?: string | null
  term: string | null
  termNullReason?: Exposure['term_null_reason']
  dueDate?: string | null
  reference: string
  stage: 'proposed' | 'active'
  claims?: EditorRecord<ClaimInput>[]
  conditions?: EditorRecord<ConditionInput>[]
}

export type Party = 'organization' | 'counterparty'
export type SourceInput =
  | { kind: 'declaration'; reported_by: Party }
  | {
      kind: 'document'
      reported_by: Party
      document_id: string
      document_version: number
      document_sha256: string
      evidence_ref: string
    }
  | {
      kind: 'questionnaire'
      reported_by: Party
      questionnaire_id: string
      question_id: string
      response_id: string
      response_revision: number
    }
export type ClaimInput = {
  kind: 'paid' | 'received'
  event_state: 'proposed' | 'actual'
  claimant_party: Party
  payer_party: Party
  payee_party: Party
  currency: 'VND'
  amount_vnd: string | null
  amount_missing_reason: string | null
  occurred_on: string | null
  planned_on: string | null
  date_missing_reason: string | null
  obligation_ref: string | null
  source_refs: SourceInput[]
}
export type ConditionInput = {
  kind: 'payment' | 'delivery' | 'acceptance' | 'refund' | 'guarantee' | 'other'
  scope: string
  trigger_text: string | null
  reported_state: 'proposed' | 'reported_satisfied' | 'unknown'
  due_on: string | null
  missing_reason: string | null
  source_refs: SourceInput[]
}
export type EditorRecord<T> =
  { input: T; historical: boolean } | { input: null; historical: true; original: unknown }

const conditionKeys = [
  'kind',
  'scope',
  'trigger_text',
  'reported_state',
  'due_on',
  'missing_reason',
  'source_refs',
]
const claimKeys = [
  'kind',
  'event_state',
  'claimant_party',
  'payer_party',
  'payee_party',
  'currency',
  'amount_vnd',
  'amount_missing_reason',
  'occurred_on',
  'planned_on',
  'date_missing_reason',
  'obligation_ref',
  'source_refs',
]
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const uuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
function invalid(): never {
  throw new ApiError(422, 'INVALID_INPUT', '')
}
function pick(value: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(
    keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]),
  )
}
export function projectSource(value: unknown): SourceInput {
  if (!object(value)) invalid()
  return pick(
    value,
    value.kind === 'declaration'
      ? ['kind', 'reported_by']
      : value.kind === 'questionnaire'
        ? [
            'kind',
            'reported_by',
            'questionnaire_id',
            'question_id',
            'response_id',
            'response_revision',
          ]
        : [
            'kind',
            'reported_by',
            'document_id',
            'document_version',
            'document_sha256',
            'evidence_ref',
          ],
  ) as SourceInput
}
function projectRecord(value: unknown, type: 'claim' | 'condition') {
  if (!object(value)) invalid()
  const input = pick(value, type === 'claim' ? claimKeys : conditionKeys)
  if ('source_refs' in input) {
    if (!Array.isArray(input.source_refs)) invalid()
    input.source_refs = input.source_refs.map(projectSource)
  }
  return input
}
/** Legacy opaque fixtures remain readable by the pure builder. The editor never
 * submits opaque records: unsupported historical rows must be explicitly removed. */
export function projectHistoricalRecords(
  records: unknown[],
  type: 'claim' | 'condition',
): unknown[] {
  const keys = type === 'claim' ? claimKeys : conditionKeys
  const opaque = (value: unknown) =>
    object(value) &&
    ![
      ...keys,
      'id',
      'verification',
      'actor',
      'revision',
      'binding_id',
      'source_id',
      'source_revision',
    ].some((key) => key in value)
  if (records.every(opaque)) return records
  return records.map((value) => (opaque(value) ? value : projectRecord(value, type)))
}
export function validDate(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value)
  )
}
function text(value: unknown, max: number, required = false) {
  return (
    (value === null && !required) ||
    (typeof value === 'string' && value.length <= max && (!required || !!value.trim()))
  )
}
function sources(values: SourceInput[]) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 20) invalid()
  return values.map((value) => {
    const source = projectSource(value)
    if (!['organization', 'counterparty'].includes(source.reported_by)) invalid()
    if (source.kind === 'document') {
      if (
        !uuid(source.document_id) ||
        !uuid(source.evidence_ref) ||
        !Number.isSafeInteger(source.document_version) ||
        source.document_version < 1 ||
        !/^[a-f0-9]{64}$/.test(source.document_sha256)
      )
        invalid()
    } else if (source.kind === 'questionnaire') {
      if (
        !uuid(source.questionnaire_id) ||
        !uuid(source.question_id) ||
        !uuid(source.response_id) ||
        !Number.isSafeInteger(source.response_revision) ||
        source.response_revision < 1
      )
        invalid()
    } else if (source.kind !== 'declaration') invalid()
    return source
  })
}
export function claimRoles(kind: ExposureKind, observation: ClaimInput['kind']) {
  const payer_party: Party = kind === 'RECEIVABLE' ? 'counterparty' : 'organization'
  const payee_party: Party = payer_party === 'organization' ? 'counterparty' : 'organization'
  return {
    payer_party,
    payee_party,
    claimant_party: observation === 'paid' ? payer_party : payee_party,
  }
}
export function validateClaim(value: ClaimInput, kind: ExposureKind): ClaimInput {
  const input = projectRecord(value, 'claim') as ClaimInput
  const roles = claimRoles(kind, input.kind)
  if (
    !['paid', 'received'].includes(input.kind) ||
    !['proposed', 'actual'].includes(input.event_state) ||
    input.currency !== 'VND' ||
    (input.amount_vnd === null
      ? !text(input.amount_missing_reason, 1000, true)
      : typeof input.amount_vnd !== 'string' ||
        !/^(0|[1-9][0-9]{0,23})$/.test(input.amount_vnd) ||
        input.amount_missing_reason !== null) ||
    !validDate(input.occurred_on) ||
    !validDate(input.planned_on) ||
    !text(input.date_missing_reason, 1000) ||
    !text(input.obligation_ref, Infinity) ||
    (input.event_state === 'proposed' && input.occurred_on !== null) ||
    (input.event_state === 'actual' &&
      input.occurred_on === null &&
      !text(input.date_missing_reason, 1000, true)) ||
    (input.occurred_on !== null && input.date_missing_reason !== null)
  )
    invalid()
  const source_refs = sources(input.source_refs)
  if (source_refs.some((source) => source.reported_by !== roles.claimant_party)) invalid()
  return { ...input, ...roles, source_refs }
}
export function validateCondition(value: ConditionInput): ConditionInput {
  const input = projectRecord(value, 'condition') as ConditionInput
  if (
    !['payment', 'delivery', 'acceptance', 'refund', 'guarantee', 'other'].includes(input.kind) ||
    !text(input.scope, 1000, true) ||
    !text(input.trigger_text, 4000) ||
    !['proposed', 'reported_satisfied', 'unknown'].includes(input.reported_state) ||
    !validDate(input.due_on) ||
    !text(input.missing_reason, 1000, input.reported_state === 'unknown')
  )
    invalid()
  return { ...input, source_refs: sources(input.source_refs) }
}
export function newClaim(kind: ExposureKind): EditorRecord<ClaimInput> {
  const roles = claimRoles(kind, 'paid')
  return {
    historical: false,
    input: {
      kind: 'paid',
      event_state: 'proposed',
      ...roles,
      currency: 'VND',
      amount_vnd: null,
      amount_missing_reason: null,
      occurred_on: null,
      planned_on: null,
      date_missing_reason: null,
      obligation_ref: null,
      source_refs: [{ kind: 'declaration', reported_by: roles.claimant_party }],
    },
  }
}
export function newCondition(): EditorRecord<ConditionInput> {
  return {
    historical: false,
    input: {
      kind: 'payment',
      scope: '',
      trigger_text: null,
      reported_state: 'proposed',
      due_on: null,
      missing_reason: null,
      source_refs: [{ kind: 'declaration', reported_by: 'organization' }],
    },
  }
}
function readRow<T>(value: unknown, validate: (input: T) => T): EditorRecord<T> {
  try {
    return { input: validate(value as T), historical: true }
  } catch {
    return { input: null, historical: true, original: value }
  }
}
export function transactionDraft(initial?: TransactionCaseDetail): TransactionDraft {
  const exposure = initial?.exposure
  const kind = initial?.exposure_kind ?? 'RECEIVABLE'
  return {
    kind,
    party: initial?.counterparty_id ?? '',
    amount: exposure ? exposure.amount_vnd : '',
    amountMissingReason: exposure?.amount_missing_reason ?? null,
    term: exposure ? (exposure.term_days === null ? null : String(exposure.term_days)) : '',
    termNullReason: exposure?.term_null_reason ?? null,
    dueDate: exposure?.due_date ?? null,
    reference: exposure?.contract_ref ?? '',
    stage: initial?.lifecycle_stage ?? 'proposed',
    claims: (exposure?.claims ?? []).map((value) =>
      readRow(value, (claim: ClaimInput) => validateClaim(claim, kind)),
    ),
    conditions: (exposure?.conditions ?? []).map((value) => readRow(value, validateCondition)),
  }
}
export type DocumentSourceOption = {
  key: string
  label: string
  source:
    | Omit<Extract<SourceInput, { kind: 'document' }>, 'reported_by'>
    | Extract<SourceInput, { kind: 'questionnaire' }>
}
export function questionnaireSourceOptions(
  forms: CaseDetail['questionnaires'] = [],
  locale: Locale = 'en',
): DocumentSourceOption[] {
  return forms.flatMap((form) =>
    (form.responses ?? [])
      .filter((r) => r.answer_state !== 'skipped' && r.reported_by)
      .map((r) => ({
        key: JSON.stringify(['questionnaire', form.id, r.question_id, r.id, r.revision]),
        label: `${form.questions.find((q) => q.id === r.question_id)?.label ?? translate(locale, 'question')} · ${translate(locale, r.origin as MessageKey)} · v${r.revision} · ${translate(locale, (r.verification_status ?? 'unverified') as MessageKey)}`,
        source: {
          kind: 'questionnaire' as const,
          reported_by: r.reported_by!,
          questionnaire_id: form.id,
          question_id: r.question_id,
          response_id: r.id,
          response_revision: r.revision,
        },
      })),
  )
}
export function documentSourceOptions(documents: Document[] = []): DocumentSourceOption[] {
  return documents.flatMap((doc) =>
    [...new Set((doc.extraction ?? []).flatMap((field) => field.evidence_refs))]
      .filter(
        (ref) =>
          uuid(ref) &&
          uuid(doc.id) &&
          Number.isSafeInteger(doc.version) &&
          doc.version > 0 &&
          /^[a-f0-9]{64}$/.test(doc.hash),
      )
      .map((ref) => ({
        key: JSON.stringify([doc.id, doc.version, doc.hash, ref]),
        label: `${doc.name ?? '—'} · v${doc.version}`,
        source: {
          kind: 'document' as const,
          document_id: doc.id,
          document_version: doc.version,
          document_sha256: doc.hash,
          evidence_ref: ref,
        },
      })),
  )
}
/** Explicitly accept the revision; preserve every user field and exact source tuple. */
export function rebaseTransaction(draft: TransactionDraft, latest: TransactionCaseDetail) {
  return {
    draft,
    revision: latest.revision,
    baseExposure: latest.exposure,
    documents: latest.documents ?? [],
  }
}
