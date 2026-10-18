'use client'
import type { ReactNode } from 'react'
import { useSession } from '@/lib/auth/session-context'

/** Opt-in developer diagnostics only; never mount their payload in the production DOM. */
export function TechnicalDetails({ children }: { children: ReactNode }) {
  const { status } = useSession()
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.NEXT_PUBLIC_AIC_DEBUG_UI !== '1' ||
    status !== 'ready'
  )
    return null
  return (
    <details className="developer-details">
      <summary>Developer diagnostics</summary>
      {children}
    </details>
  )
}
