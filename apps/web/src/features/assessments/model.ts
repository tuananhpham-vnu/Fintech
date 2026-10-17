import type { Assessment, CaseDetail, Readiness } from '@/lib/api/contracts'

export function currentReadiness(
  detail: CaseDetail | null,
  remote: Readiness | null,
): Readiness | null {
  if (!detail) return null
  return remote?.case_revision === detail.revision
    ? remote
    : detail.readiness?.case_revision === detail.revision
      ? detail.readiness
      : null
}
export function assessmentIsStale(
  result: Assessment | null | undefined,
  revision: number,
  caseId?: string,
) {
  return (
    !!result &&
    (result.stale ||
      result.case_revision !== revision ||
      (caseId !== undefined && result.case_id !== caseId))
  )
}
export function numericAssessmentAllowed(
  readiness: Readiness | null,
  revision: number,
  exposureKind?: CaseDetail['exposure_kind'],
) {
  return (
    exposureKind !== 'LOAN' &&
    exposureKind !== 'DEBT_INVESTMENT' &&
    !!readiness?.numeric_assessment_allowed &&
    ['configured_pilot', 'validation_pending', 'validated_for_limited_use'].includes(
      readiness.method_status,
    ) &&
    readiness.case_revision === revision
  )
}
