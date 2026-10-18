'use client'
import { type CaseDetail } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import type { MessageKey } from '@/lib/i18n/messages'
import { displayValue } from '@/lib/utils/format'
import { formatMoney } from '@/lib/utils/money'
export function Overview({ detail }: { detail: CaseDetail }) {
  const { t, locale } = useLocale()
  return (
    <section className="panel aic-section">
      <div className="metadata-grid">
        <div>
          <span>
            {t('organization')} · {t('role')}
          </span>
          <strong>{t(detail.exposure.organization_role as MessageKey)}</strong>
        </div>
        <div>
          <span>
            {t('counterparty')} · {t('role')}
          </span>
          <strong>{t(detail.exposure.counterparty_role as MessageKey)}</strong>
        </div>
        <div>
          <span>{t('amount')}</span>
          <strong>{formatMoney(detail.exposure.amount_vnd, locale)}</strong>
        </div>
        <div>
          <span>{t('stage')}</span>
          <strong>{t(detail.lifecycle_stage)}</strong>
        </div>
      </div>
      <h3>{t('conditions')}</h3>
      {detail.exposure.conditions.length ? (
        detail.exposure.conditions.map((condition, i) => (
          <pre className="request-preview" key={i}>
            {displayValue(condition)}
          </pre>
        ))
      ) : (
        <p>{t('empty')}</p>
      )}
      <p>{t('noAutoApproval')}</p>
    </section>
  )
}
