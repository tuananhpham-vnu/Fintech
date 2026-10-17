'use client'
import { useLocale } from '@/lib/i18n/locale-provider'
import Link from 'next/link'
export function Brand() {
  const { t } = useLocale()
  return (
    <Link href="/cases" className="brand" aria-label="AIC Rating">
      <div
        className="brand-mark"
        style={{ overflow: 'hidden', padding: 0, background: 'transparent' }}
      >
        <img
          src="/icon.svg"
          alt="AIC Rating Logo"
          width={36}
          height={36}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
      <div className="brand-copy">
        <strong>AIC Rating</strong>
        <small>{t('desk')}</small>
      </div>
    </Link>
  )
}
