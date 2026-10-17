import { ApiError } from '@/lib/api/client'
import type { Question } from '@/lib/api/contracts'

export type RespondentAnswers = Record<string, { state: string; value: string }>
export function validateRespondentAnswers(questions: Question[], answers: RespondentAnswers) {
  if (questions.some((q) => !['text', 'string', 'textarea'].includes(q.answer_type)))
    throw new ApiError(0, 'CONTRACT_NOT_RELEASED', 'Answer type schema required')
  if (
    questions.some((q) => {
      const answer = answers[q.id]
      if (answer && !['submitted', 'self_assessed', 'skipped'].includes(answer.state)) return true
      if (answer?.state === 'skipped') return !q.allowed_to_skip
      return (
        q.requiredness === 'required' &&
        !answer?.value.trim() &&
        !(q.allowed_to_skip && answer?.state === 'skipped')
      )
    })
  )
    throw new ApiError(422, 'INVALID_INPUT', '')
}

/** Native submission answers every scoped question, explicitly skipping with a reason. */
export function validateNativeAnswers(
  questions: Question[],
  answers: Record<string, { state: string; value: string; reason?: string }>,
) {
  validateRespondentAnswers(questions, answers)
  if (
    !questions.length ||
    questions.some((q) => {
      const a = answers[q.id]
      return a?.state === 'skipped' ? !a.reason?.trim() : !a?.value.trim()
    })
  )
    throw new ApiError(422, 'INVALID_INPUT', '')
}
