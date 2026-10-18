'use client'
import { assessmentsApi } from '@/features/assessments/api'
import { currentReadiness } from '@/features/assessments/model'
import { casesApi } from '@/features/cases/api'
import { counterpartiesApi } from '@/features/counterparties/api'
import { useResource } from '@/hooks/use-resource'
import { useSession } from '@/lib/auth/session-context'
import { hasRunningWork } from '@/lib/domain/cases'
import { useCallback, useEffect, useRef, useState } from 'react'
export function useCaseWorkspace(caseId: string) {
  const { status } = useSession()
  const [poll, setPoll] = useState(false)
  const pollingStarted = useRef(0)
  const load = useCallback((signal: AbortSignal) => casesApi.detail(caseId, signal), [caseId]),
    resource = useResource(load, status === 'ready', poll ? 3000 : 0),
    detail = resource.data
  const loadReadiness = useCallback(
      (signal: AbortSignal) => assessmentsApi.readiness(caseId, signal),
      [caseId, detail?.revision],
    ),
    readiness = useResource(loadReadiness, status === 'ready' && !!detail)
  const loadParty = useCallback(
      (signal: AbortSignal) => counterpartiesApi.counterparty(detail!.counterparty_id, signal),
      [detail?.counterparty_id, detail?.revision],
    ),
    party = useResource(loadParty, status === 'ready' && !!detail)
  const reload = useCallback(() => {
    pollingStarted.current = Date.now()
    resource.reload()
    readiness.reload()
  }, [resource.reload, readiness.reload])
  useEffect(() => {
    if (!detail || !hasRunningWork(detail)) {
      setPoll(false)
      pollingStarted.current = 0
      return
    }
    if (!pollingStarted.current) pollingStarted.current = Date.now()
    setPoll(Date.now() - pollingStarted.current < 5 * 60 * 1000)
  }, [detail])
  const availableReadiness = currentReadiness(detail, readiness.data)
  return { resource, detail, readiness, party, reload, currentReadiness: availableReadiness }
}
