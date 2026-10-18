'use client'
import { useLocale } from '@/lib/i18n/locale-provider'
import { BriefcaseBusiness } from 'lucide-react'
import { type ReactNode } from 'react'
export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useLocale()
  return (
    <div className="empty-state">
      <BriefcaseBusiness size={32} />
      <h3>{t('empty')}</h3>
      {children}
    </div>
  )
}
