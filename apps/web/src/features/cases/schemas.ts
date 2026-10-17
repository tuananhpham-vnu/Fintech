import { ApiError } from '@/lib/api/client'
import type { CaseCreate, Exposure } from '@/lib/api/contracts'
import { rolePairs } from '@/lib/domain/cases'
import { validAmount } from '@/lib/utils/money'
import {
  type EditorRecord,
  type TransactionDraft,
  projectHistoricalRecords,
  validateClaim,
  validateCondition,
  validDate,
} from './helpers/exposure-inputs'

export type { TransactionDraft } from './helpers/exposure-inputs'

export function buildTransactionInput(draft: TransactionDraft, base?: Exposure): CaseCreate {
  const amountReason =
    draft.amountMissingReason === undefined
      ? base?.amount_missing_reason
      : draft.amountMissingReason
  const termReason =
    draft.termNullReason === undefined ? base?.term_null_reason : draft.termNullReason
  if (
    !draft.party ||
    !Object.hasOwn(rolePairs, draft.kind) ||
    !['proposed', 'active'].includes(draft.stage) ||
    (draft.amount === null
      ? !amountReason?.trim() || amountReason.length > 1000
      : !validAmount(draft.amount)) ||
    (draft.term === null
      ? !['not_agreed', 'source_missing', 'ambiguous'].includes(termReason ?? '')
      : !/^\d+$/.test(draft.term) || !Number.isSafeInteger(Number(draft.term))) ||
    draft.reference.length > 250 ||
    !validDate(draft.dueDate === undefined ? (base?.due_date ?? null) : draft.dueDate)
  ) {
    throw new ApiError(422, 'INVALID_INPUT', '')
  }
  const [organization_role, counterparty_role] = rolePairs[draft.kind]
  function records<T>(rows: EditorRecord<T>[], validate: (value: T) => unknown) {
    if (rows.length > 50) throw new ApiError(422, 'INVALID_INPUT', '')
    return rows.map((row) => {
      if (row.input === null) throw new ApiError(422, 'EXPOSURE_HISTORY_UNSUPPORTED', '')
      return validate(row.input)
    })
  }
  return {
    counterparty_id: draft.party,
    exposure_kind: draft.kind,
    lifecycle_stage: draft.stage,
    exposure: {
      amount_vnd: draft.amount,
      ...(draft.amount === null ? { amount_missing_reason: amountReason!.trim() } : {}),
      term_days: draft.term === null ? null : Number(draft.term),
      ...(draft.term === null ? { term_null_reason: termReason } : {}),
      organization_role,
      counterparty_role,
      contract_ref: draft.reference.trim() || null,
      conditions: draft.conditions
        ? records(draft.conditions, validateCondition)
        : projectHistoricalRecords(base?.conditions ?? [], 'condition'),
      ...(draft.claims
        ? { claims: records(draft.claims, (claim) => validateClaim(claim, draft.kind)) }
        : base?.claims
          ? { claims: projectHistoricalRecords(base.claims, 'claim') }
          : {}),
      ...(draft.dueDate !== undefined
        ? { due_date: draft.dueDate }
        : base?.due_date !== undefined
          ? { due_date: base.due_date }
          : {}),
      source_origin: 'staff_entered',
    },
  }
}
