'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  enabled = true,
  interval = 0,
  resourceKey?: string,
) {
  // By default a new snapshot hides prior data. An explicit stable resource key
  // opts into background refresh without unmounting the current view or draft.
  const [state, setState] = useState<{
    load: typeof load
    data: T | null
    error: unknown
    loading: boolean
    resourceKey?: string
  }>({ load, resourceKey, data: null, error: null, loading: enabled })
  const [generation, setGeneration] = useState(0)
  const current = state.load === load
  const sameResource = resourceKey !== undefined && state.resourceKey === resourceKey
  const data = current || sameResource ? state.data : null
  const error = current ? state.error : null
  const loading = enabled && (!current || state.loading)
  const reload = useCallback(() => setGeneration((n) => n + 1), [])
  const failures = useRef(0)
  useEffect(() => {
    if (!enabled) {
      setState((previous) => ({ ...previous, loading: false }))
      return
    }
    const controller = new AbortController()
    setState((previous) => ({
      load,
      resourceKey,
      data:
        previous.load === load ||
        (resourceKey !== undefined && previous.resourceKey === resourceKey)
          ? previous.data
          : null,
      error: null,
      loading: true,
    }))
    void load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          failures.current = 0
          setState({ load, resourceKey, data: value, error: null, loading: false })
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          failures.current += 1
          setState((previous) => ({ ...previous, error: err, loading: false }))
        }
      })
    return () => controller.abort()
  }, [load, enabled, generation, resourceKey])
  useEffect(() => {
    if (!enabled || !interval || loading) return
    const timer = setTimeout(
      () => {
        if (document.visibilityState === 'visible' && navigator.onLine) reload()
      },
      Math.min(30000, interval * Math.pow(2, Math.min(failures.current, 4))),
    )
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
