'use client'
import { historyApi } from '@/features/history/api'
import { useResource } from '@/hooks/use-resource'
import { type CaseDetail } from '@/lib/api/contracts'
import { useSession } from '@/lib/auth/session-context'
import { useCallback, useState } from 'react'
export function useCaseHistory(detail: CaseDetail) {
  const { status } = useSession()
  const [cursors, setCursors] = useState([''])
  // Audit-only actions can add events without advancing the business revision.
  const load = useCallback(
      (signal: AbortSignal) => historyApi.history(detail.id, cursors.at(-1)!, signal),
      [detail, cursors],
    ),
    history = useResource(load, status === 'ready')

  return { history, cursors, setCursors }
}
