'use client'
import type { Session } from '@/lib/api/contracts'
import { createContext, useContext } from 'react'

export type SessionContextValue = {
  session: Session | null
  status: 'loading' | 'ready' | 'anonymous' | 'expired' | 'error'
  error: unknown
  login: (name: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => void
}
export const SessionContext = createContext<SessionContextValue | null>(null)
export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('SessionProvider is missing')
  return value
}
