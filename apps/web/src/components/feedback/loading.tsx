'use client'
import { useLocale } from '@/lib/i18n/locale-provider'
import { LoaderCircle } from 'lucide-react'
export function Loading() {
  const { t } = useLocale()
  return (
    <div className="aic-loading" role="status">
      <LoaderCircle className="spin" size={21} />
      {t('loading')}
    </div>
  )
}
