'use client'
import type { Locale } from '@/lib/api/contracts'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { translate, type MessageKey } from './messages'

type LocaleContextValue = {
  locale: Locale
  setLocale: (value: Locale) => void
  t: (key: MessageKey) => string
}
const LocaleContext = createContext<LocaleContextValue | null>(null)
export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode
  initialLocale?: Locale
}) {
  const [locale, setLanguage] = useState<Locale>(initialLocale ?? 'en')
  useEffect(() => {
    try {
      const stored = localStorage.getItem('aic.locale')
      if (stored === 'en' || stored === 'vi' || stored === 'zh-CN') setLanguage(stored)
    } catch {
      /* Language preference storage is optional. */
    }
  }, [])
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  function setLocale(value: Locale) {
    setLanguage(value)
    try {
      localStorage.setItem('aic.locale', value)
    } catch {
      /* Optional. */
    }
  }
  return (
    <LocaleContext.Provider value={{ locale, setLocale, t: (key) => translate(locale, key) }}>
      {children}
    </LocaleContext.Provider>
  )
}
export function useLocale() {
  const value = useContext(LocaleContext)
  if (!value) throw new Error('LocaleProvider is missing')
  return value
}
