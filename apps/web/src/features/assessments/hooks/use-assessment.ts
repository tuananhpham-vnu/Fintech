'use client'
import { assessmentsApi } from '@/features/assessments/api'
import { useResource } from '@/hooks/use-resource'
import { type CaseDetail, type Readiness } from '@/lib/api/contracts'
import { useSession } from '@/lib/auth/session-context'
import { useCallback } from 'react'
import { assessmentIsStale, numericAssessmentAllowed } from '../model'
export function useAssessment(detail: CaseDetail, readiness: Readiness | null) {
  const { status } = useSession()
  const jobState = detail.jobs?.map((job) => `${job.id}:${job.state}`).join('|')
  const id = detail.latest_assessment_id,
    load = useCallback(
      (signal: AbortSignal) => assessmentsApi.assessment(id!, signal),
      [id, detail.revision, detail.updated_at, detail.assessment?.state, jobState],
    ),
    resource = useResource(load, status === 'ready' && !!id)
  const result = resource.data ?? detail.assessment,
    stale = assessmentIsStale(result, detail.revision, detail.id),
    allowed = numericAssessmentAllowed(readiness, detail.revision, detail.exposure_kind)
  return { resource, result, stale, allowed }
}
