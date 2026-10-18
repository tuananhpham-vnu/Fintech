'use client'
import { useLocale } from '@/lib/i18n/locale-provider'
import Link from 'next/link'
export default function NotFound() {
  const { t } = useLocale()
  return (
    <main className="session-wall">
      <p className="eyebrow">AIC RATING · 404</p>
      <h1>{t('notFound')}</h1>
      <Link href="/cases" className="primary-button">
        {t('back')}
      </Link>
    </main>
  )
}
