'use client'
import { useLocale } from '@/lib/i18n/locale-provider'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
export function BackLink() {
  const { t } = useLocale()
  return (
    <Link href="/cases" className="back-link">
      <ArrowLeft size={15} />
      {t('back')}
    </Link>
  )
}
