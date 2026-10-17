'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  enabled = true,
  interval = 0,
) {
  // A new loader identifies a different snapshot (ID, revision or cursor).
  // Never expose the previous resource while the new request is pending/failed.
  const [state, setState] = useState<{
    load: typeof load
    data: T | null
    error: unknown
    loading: boolean
  }>({ load, data: null, error: null, loading: enabled })
  const [generation, setGeneration] = useState(0)
  const current = state.load === load
  const data = current ? state.data : null
  const error = current ? state.error : null
  const loading = enabled && (!current || state.loading)
  const reload = useCallback(() => setGeneration((n) => n + 1), [])
  const pollingStarted = useRef(0)
  useEffect(() => {
    pollingStarted.current = Date.now()
  }, [load, enabled, interval])
  useEffect(() => {
    if (!enabled) {
      setState((previous) => ({ ...previous, loading: false }))
      return
    }
    const controller = new AbortController()
    setState((previous) => ({
      load,
      data: previous.load === load ? previous.data : null,
      error: null,
      loading: true,
    }))
    void load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setState({ load, data: value, error: null, loading: false })
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setState((previous) => ({ ...previous, error: err, loading: false }))
      })
    return () => controller.abort()
  }, [load, enabled, generation])
  useEffect(() => {
    if (
      !enabled ||
      !interval ||
      loading ||
      error ||
      Date.now() - pollingStarted.current > 5 * 60 * 1000
    )
      return
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) reload()
    }, interval)
    const visible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) reload()
    }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('online', visible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('online', visible)
    }
  }, [enabled, interval, loading, error, generation, reload])
  return { data, error, loading, reload }
}
