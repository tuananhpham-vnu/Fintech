'use client'
import { MutationKey } from '@/lib/api/client'
import { useRef, useState } from 'react'

export function useMutation() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [success, setSuccess] = useState(false),
    lock = useRef(false),
    key = useRef(new MutationKey())
  async function run<T>(operation: (key: MutationKey) => Promise<T>, done?: (value: T) => void) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    setSuccess(false)
    try {
      const value = await operation(key.current)
      key.current.clear()
      setSuccess(true)
      done?.(value)
    } catch (err) {
      setError(err)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return { busy, error, success, run, setError }
}
