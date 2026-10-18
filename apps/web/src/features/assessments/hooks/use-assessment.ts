'use client'
import { assessmentsApi } from '@/features/assessments/api'
import { useResource } from '@/hooks/use-resource'
import { type CaseDetail, type Readiness } from '@/lib/api/contracts'
import { useSession } from '@/lib/auth/session-context'
import { useCallback } from 'react'
import { assessmentIsStale, numericAssessmentAllowed } from '../model'
export function useAssessment(
  detail: CaseDetail,
  readiness: Readiness | null,
  setId?: string,
  assessmentId?: string,
) {
  const { status } = useSession()
  const jobState = detail.jobs?.map((job) => `${job.id}:${job.state}`).join('|')
  const id = assessmentId || detail.latest_assessment_id,
    load = useCallback(
      (signal: AbortSignal) => assessmentsApi.assessment(id!, signal),
      [id, detail.revision, detail.updated_at, detail.assessment?.state, jobState],
    ),
    resource = useResource(load, status === 'ready' && !!id)
  const loadReadiness = useCallback(
    (signal: AbortSignal) => assessmentsApi.readiness(detail.id, signal, setId),
    [detail.id, detail.revision, setId, jobState],
  )
  const readinessResource = useResource(loadReadiness, status === 'ready')
  const current =
    readinessResource.data?.case_revision === detail.revision
      ? readinessResource.data
      : !setId && !readinessResource.error
        ? readiness
        : null
  const result = resource.error
      ? null
      : (resource.data ?? (!assessmentId ? detail.assessment : null)),
    stale = assessmentIsStale(result, detail.revision, detail.id),
    numericAllowed = numericAssessmentAllowed(current, detail.revision, detail.exposure_kind),
    allowed =
      !!current &&
      current.case_revision === detail.revision &&
      (current.assessment_allowed ?? numericAllowed)
  return { resource, result, stale, allowed, numericAllowed, readiness: current, readinessResource }
}
