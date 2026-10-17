'use client'
import { useLocale } from '@/lib/i18n/locale-provider'
import { CheckCircle2 } from 'lucide-react'
export function Success({ show }: { show: boolean }) {
  const { t } = useLocale()
  return show ? (
    <p role="status" className="aic-success">
      <CheckCircle2 size={17} />
      {t('saved')}
    </p>
  ) : null
}
