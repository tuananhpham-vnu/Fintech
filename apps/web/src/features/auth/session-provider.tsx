'use client'
import { ApiError, setCsrfToken } from '@/lib/api/client'
import type { Session } from '@/lib/api/contracts'
import { SessionContext, type SessionContextValue } from '@/lib/auth/session-context'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { authApi } from './api'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<SessionContextValue['status']>('loading')
  const [error, setError] = useState<unknown>(null)
  const [generation, setGeneration] = useState(0)
  const epoch = useRef(0)
  const accept = useCallback((next: Session) => {
    setCsrfToken(next.csrf_token)
    setSession(next)
    setStatus('ready')
    setError(null)
  }, [])
  useEffect(() => {
    if (window.location.pathname === '/respondent') {
      setStatus('anonymous')
      return
    }
    const controller = new AbortController(),
      version = ++epoch.current
    setStatus('loading')
    void authApi
      .me(controller.signal)
      .then((next) => {
        if (version === epoch.current) accept(next)
      })
      .catch((err) => {
        if (controller.signal.aborted || version !== epoch.current) return
        const anonymous = err instanceof ApiError && err.status === 401
        setError(anonymous ? null : err)
        setStatus(anonymous ? 'anonymous' : 'error')
      })
    return () => controller.abort()
  }, [generation, accept])
  useEffect(() => {
    const expire = () => {
      epoch.current++
      setCsrfToken(null)
      setStatus((current) => (current === 'anonymous' ? current : 'expired'))
    }
    window.addEventListener('aic:session-expired', expire)
    return () => window.removeEventListener('aic:session-expired', expire)
  }, [])
  useEffect(() => {
    if (!session || status !== 'ready') return
    const timer = setTimeout(
      () => window.dispatchEvent(new Event('aic:session-expired')),
      Math.max(0, Date.parse(session.expires_at) - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [session, status])
  async function login(name: string, password: string) {
    const version = ++epoch.current,
      next = await authApi.login(name, password)
    if (version !== epoch.current) return
    if (
      session &&
      (next.user.id !== session.user.id ||
        next.user.organization_id !== session.user.organization_id)
    ) {
      window.location.replace('/cases')
      return
    }
    accept(next)
  }
  async function logout() {
    await authApi.logout()
    epoch.current++
    setCsrfToken(null)
    setSession(null)
    setStatus('anonymous')
    window.location.replace('/login')
  }
  return (
    <SessionContext.Provider
      value={{
        session,
        status,
        error,
        login,
        logout,
        refreshSession: () => setGeneration((n) => n + 1),
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}
