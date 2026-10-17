'use client'
import { SessionProvider } from '@/features/auth/session-provider'
import { LocaleProvider } from '@/lib/i18n/locale-provider'
import type { ReactNode } from 'react'

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <SessionProvider>{children}</SessionProvider>
    </LocaleProvider>
  )
}
