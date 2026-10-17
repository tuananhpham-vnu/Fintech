'use client'
import { casesApi } from '@/features/cases/api'
import { counterpartiesApi } from '@/features/counterparties/api'
import { useResource } from '@/hooks/use-resource'
import { type Counterparty } from '@/lib/api/contracts'
import { useSession } from '@/lib/auth/session-context'
import { useCallback, useMemo, useState } from 'react'
export function useCaseList() {
  const { status } = useSession()
  const [cursors, setCursors] = useState([''])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const cursor = cursors.at(-1)!,
    load = useCallback((signal: AbortSignal) => casesApi.cases(cursor, signal), [cursor]),
    rows = useResource(load, status === 'ready')
  const partyIds = useMemo(
    () => [...new Set(rows.data?.items.map((c) => c.counterparty_id) ?? [])],
    [rows.data],
  )
  const loadNames = useCallback(
    async (signal: AbortSignal) => {
      const values = await Promise.allSettled(
        partyIds.map((id) => counterpartiesApi.counterparty(id, signal)),
      )
      return Object.fromEntries(
        values.flatMap((value, i) =>
          value.status === 'fulfilled' ? [[partyIds[i], value.value]] : [],
        ),
      ) as Record<string, Counterparty>
    },
    [partyIds],
  )
  const names = useResource(loadNames, status === 'ready' && partyIds.length > 0)
  const visible =
    rows.data?.items.filter(
      (c) =>
        (!kind || c.exposure_kind === kind) &&
        `${names.data?.[c.counterparty_id]?.name ?? ''} ${names.data?.[c.counterparty_id]?.tax_id ?? ''} ${c.exposure.contract_ref ?? ''} ${c.id}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) ?? []

  return { rows, names, visible, cursors, setCursors, query, setQuery, kind, setKind }
}
