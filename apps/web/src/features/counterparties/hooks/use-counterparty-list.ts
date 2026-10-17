'use client'
import { counterpartiesApi } from '@/features/counterparties/api'
import { useResource } from '@/hooks/use-resource'
import { useSession } from '@/lib/auth/session-context'
import { useCallback, useState } from 'react'
export function useCounterpartyList() {
  const { status } = useSession()
  const [cursors, setCursors] = useState([''])
  const [query, setQuery] = useState('')
  const load = useCallback(
      (signal: AbortSignal) => counterpartiesApi.counterparties(cursors.at(-1)!, signal),
      [cursors],
    ),
    rows = useResource(load, status === 'ready')
  const visible =
    rows.data?.items.filter((p) =>
      `${p.name} ${p.tax_id ?? ''}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? []

  return { rows, visible, cursors, setCursors, query, setQuery }
}
