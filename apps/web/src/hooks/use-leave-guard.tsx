'use client'
import { LeavePrompt } from '@/components/ui/leave-prompt'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
export function useLeaveGuard(dirty: boolean) {
  const router = useRouter(),
    [pending, setPending] = useState<(() => void) | null>(null)
  const guard = (fn: () => void) => {
    if (dirty) setPending(() => fn)
    else fn()
  }
  useEffect(() => {
    if (!dirty) return
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const click = (e: MouseEvent) => {
      const a = (e.target as Element)?.closest<HTMLAnchorElement>('a[href]')
      if (
        !a ||
        a.target === '_blank' ||
        a.hasAttribute('download') ||
        a.origin !== window.location.origin
      )
        return
      e.preventDefault()
      e.stopPropagation()
      setPending(() => () => router.push(a.pathname + a.search + a.hash))
    }
    window.addEventListener('beforeunload', unload)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('beforeunload', unload)
      document.removeEventListener('click', click, true)
    }
  }, [dirty, router])
  return {
    guard,
    prompt: pending ? (
      <LeavePrompt
        stay={() => setPending(null)}
        leave={() => {
          setPending(null)
          pending()
        }}
      />
    ) : null,
  }
}
