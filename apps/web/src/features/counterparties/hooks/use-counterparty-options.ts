'use client'
import { useResource } from '@/hooks/use-resource'
import type { Counterparty } from '@/lib/api/contracts'
import { useCallback, useState } from 'react'
import { counterpartiesApi } from '../api'

export function useCounterpartyOptions(enabled: boolean) {
  const [cursor, setCursor] = useState('')
  const [options, setOptions] = useState<Counterparty[]>([])
  const load = useCallback(
    async (signal: AbortSignal) => {
      const page = await counterpartiesApi.counterparties(cursor, signal)
      setOptions((previous) => [
        ...new Map([...previous, ...page.items].map((p) => [p.id, p])).values(),
      ])
      return page
    },
    [cursor],
  )
  const parties = useResource(load, enabled)
  return { options, parties, setCursor }
}
