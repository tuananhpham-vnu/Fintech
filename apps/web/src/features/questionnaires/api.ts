import { apiPath, request, unknownResponse, type MutationKey } from '@/lib/api/client'
import type { Question } from '@/lib/api/contracts'

export type NativeInvitation = {
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
export type InvitationInput = {
  expected_revision: number
  reason: string
  question_ids: string[]
  reported_by: 'organization' | 'counterparty'
  recipient_reference: string
}
export type ReasonInput = { expected_revision: number; reason: string }
export type NativeReceipt = {
  receipt_id: string
  submitted_at: string
  answer_count: number
  identity_assurance: 'self_reported_capability_only'
}
export type NativeForm = {
  questions: Question[]
  expires_at: string
  questionnaire_version: 1
  receipt?: NativeReceipt
}
export type RespondentInput = {
  reported_reference: string
  answers: {
    question_id: string
    question_version: 1
    answer_state: 'submitted' | 'self_assessed' | 'skipped'
    answer_json: string | null
    skip_reason: string | null
  }[]
}
type Obj = Record<string, unknown>
function object(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid object')
  return value as Obj
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw Error('Invalid text')
  return value
}
function time(value: unknown) {
  const result = text(value)
  if (!Number.isFinite(Date.parse(result))) throw Error('Invalid timestamp')
  return result
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw Error('Invalid revision')
  return value as number
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw Error('Invalid value')
  return value as T
}
function version(value: unknown): 1 {
  if (value !== 1) throw Error('Unsupported questionnaire version')
  return 1
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw Error('Invalid scope')
  const result = value.map(text)
  if (new Set(result).size !== result.length) throw Error('Duplicate scope')
  return result
}
function invitation(value: unknown): NativeInvitation {
  const v = object(value)
  return {
    id: text(v.id),
    questionnaire_id: text(v.questionnaire_id),
    questionnaire_version: version(v.questionnaire_version),
    question_ids: ids(v.question_ids),
    reported_by: choice(v.reported_by, ['organization', 'counterparty']),
    recipient_reference: text(v.recipient_reference),
    expires_at: time(v.expires_at),
    created_at: time(v.created_at),
    status: choice(v.status, ['active', 'revoked', 'expired', 'submitted', 'closed']),
    token_delivery: choice(v.token_delivery, ['one_time_response_header']),
  }
}
function invitationResult(value: unknown) {
  const v = object(value)
  return { invitation: invitation(v.invitation), revision: revision(v.revision) }
}
function receipt(value: unknown): NativeReceipt {
  const v = object(value),
    count = revision(v.answer_count)
  if (count > 20) throw Error('Invalid answer count')
  return {
    receipt_id: text(v.receipt_id),
    submitted_at: time(v.submitted_at),
    answer_count: count,
    identity_assurance: choice(v.identity_assurance, ['self_reported_capability_only']),
  }
}
function nativeForm(value: unknown): NativeForm {
  const v = object(value)
  if (!Array.isArray(v.questions) || !v.questions.length || v.questions.length > 20)
    throw Error('Invalid questions')
  const questions = v.questions.map((value): Question => {
    const q = object(value)
    if (typeof q.allowed_to_skip !== 'boolean') throw Error('Invalid skip policy')
    return {
      id: text(q.id),
      version: version(q.version),
      answer_type: choice(q.answer_type, ['text']),
      requiredness: choice(q.requiredness, ['optional', 'required']),
      allowed_to_skip: q.allowed_to_skip,
      source_requirements: q.source_requirements,
      verification_policy: q.verification_policy,
      ...(q.label === undefined ? {} : { label: text(q.label) }),
    }
  })
  ids(questions.map((q) => q.id))
  const result = {
    questions,
    expires_at: time(v.expires_at),
    questionnaire_version: version(v.questionnaire_version),
    ...(v.receipt === undefined ? {} : { receipt: receipt(v.receipt) }),
  }
  if (result.receipt && result.receipt.answer_count !== questions.length)
    throw Error('Receipt scope mismatch')
  return result
}
const reasonBody = (input: ReasonInput) => ({
  expected_revision: input.expected_revision,
  reason: input.reason,
})
export const questionnairesApi = {
  create: (
    caseId: string,
    body: { expected_revision: number; reason: string; questions: { label: string }[] },
    keys: MutationKey,
  ) => {
    const path = apiPath('cases', caseId, '/questionnaires')
    return request(path, unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
  staff: (
    id: string,
    body: {
      expected_revision: number
      reason: string
      question_id: string
      question_version: number
      answer_state: string
      answer_json: string | null
      reported_by: 'organization' | 'counterparty'
      reported_reference: string
      source_refs: string[]
    },
    keys: MutationKey,
  ) => {
    const path = apiPath('questionnaires', id, '/staff-responses')
    return request(path, unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
  verify: (
    id: string,
    body: {
      expected_revision: number
      response_revision: number
      reason: string
      status: string
      evidence_refs: string[]
    },
    keys: MutationKey,
  ) => {
    const path = apiPath('responses', id, '/verification')
    return request(path, unknownResponse, {
      method: 'POST',
      body,
      idempotencyKey: keys.for(path, body),
    })
  },
  createInvitation: (
    id: string,
    input: InvitationInput,
    key: string,
    onToken?: (token: string) => void,
  ) => {
    const body = {
      ...reasonBody(input),
      question_ids: [...input.question_ids],
      reported_by: input.reported_by,
      recipient_reference: input.recipient_reference,
    }
    return request(apiPath('questionnaires', id, '/invitations'), invitationResult, {
      method: 'POST',
      body,
      idempotencyKey: key,
      onSuccessHeaders: (headers) => {
        const token = headers.get('x-invitation-token')
        if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) onToken?.(token)
      },
    })
  },
  revokeInvitation: (id: string, input: ReasonInput, key: string) =>
    request(apiPath('invitations', id, '/revoke'), invitationResult, {
      method: 'POST',
      body: reasonBody(input),
      idempotencyKey: key,
    }),
  closeQuestionnaire: (id: string, input: ReasonInput, key: string) =>
    request(
      apiPath('questionnaires', id, '/close'),
      (value) => {
        const v = object(value)
        return {
          id: text(v.id),
          version: version(v.version),
          state: choice(v.state, ['closed']),
          revision: revision(v.revision),
        }
      },
      { method: 'POST', body: reasonBody(input), idempotencyKey: key },
    ),
  respondentForm: (token: string, signal?: AbortSignal) =>
    request('/respondent/form', nativeForm, { signal, respondentToken: token }),
  submitRespondent: (token: string, input: RespondentInput, key: string) =>
    request('/respondent/responses', receipt, {
      method: 'POST',
      respondentToken: token,
      idempotencyKey: key,
      body: {
        reported_reference: input.reported_reference,
        answers: input.answers.map((a) => ({
          question_id: a.question_id,
          question_version: a.question_version,
          answer_state: a.answer_state,
          answer_json: a.answer_json,
          skip_reason: a.skip_reason,
        })),
      },
    }),
}
