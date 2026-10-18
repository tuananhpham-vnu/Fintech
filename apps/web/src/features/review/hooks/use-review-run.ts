'use client'
import { reviewApi } from '@/features/review/api'
import { useResource } from '@/hooks/use-resource'
import type { CaseDetail } from '@/lib/api/contracts'
import { useSession } from '@/lib/auth/session-context'
import { useCallback } from 'react'
export function useReviewRun(detail: CaseDetail) {
  const { status } = useSession()
  const jobState = detail.jobs?.map((job) => `${job.id}:${job.state}`).join('|')
  const id = detail.latest_review_run_id,
    load = useCallback(
      (signal: AbortSignal) => reviewApi.review(id!, signal),
      [id, detail.revision, detail.updated_at, jobState],
    ),
    run = useResource(load, status === 'ready' && !!id, 0)
  const findings = [
      ...(run.data?.findings ?? detail.findings ?? []),
      ...(run.data?.issue_history ?? detail.issue_history ?? []),
    ],
    stale =
      detail.review_stale ||
      run.data?.stale ||
      (run.data &&
        ((run.data.checked_case_revision ?? run.data.case_revision) !== detail.revision ||
          run.data.case_id !== detail.id)),
    running = detail.jobs?.some((j) => ['queued', 'running'].includes(j.state))

  return { run, findings, stale, running }
}
