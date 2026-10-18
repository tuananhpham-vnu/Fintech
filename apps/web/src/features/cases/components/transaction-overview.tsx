'use client'
import { type TransactionCaseDetail as CaseDetail } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import type { MessageKey } from '@/lib/i18n/messages'
import { presentNote } from '@/lib/i18n/product-copy'
import { formatMoney } from '@/lib/utils/money'
import { transactionDraft } from '../helpers/exposure-inputs'
import { exposureText } from '../helpers/exposure-text'
export function Overview({ detail }: { detail: CaseDetail }) {
  const { t, locale } = useLocale()
  const copy = exposureText(locale)
  const conditions = transactionDraft(detail).conditions ?? []
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
        conditions.map((row, i) => {
          const condition = row.input
          const original = detail.exposure.conditions[i]
          return (
            <article className="request-preview" key={i}>
              {condition ? (
                <>
                  <strong>
                    {copy(condition.kind)} · {copy(condition.reported_state)}
                  </strong>
                  <p>
                    {copy('scope')}: {condition.scope}
                  </p>
                  {condition.trigger_text && (
                    <p>
                      {copy('trigger')}: {condition.trigger_text}
                    </p>
                  )}
                  <p>
                    {copy('dueDate')}: {condition.due_on ?? '—'}
                  </p>
                  {condition.missing_reason && (
                    <p>
                      {copy('reason')}: {presentNote(condition.missing_reason, locale)}
                    </p>
                  )}
                  <p>{copy('sources')}:</p>
                  <ul>
                    {condition.source_refs.map((source, index) => (
                      <li key={index}>
                        {source.kind === 'document'
                          ? `${detail.documents?.find((d) => d.id === source.document_id)?.name ?? t('source')} · v${source.document_version}`
                          : source.kind === 'questionnaire'
                            ? `${t('questionnaire')} · v${source.response_revision}`
                            : copy('declaration')}
                        {' · '}
                        {copy(source.reported_by)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <p>{t('needs_review')}</p>
                  {typeof original === 'object' && original && 'description' in original && (
                    <p>{String(original.description)}</p>
                  )}
                  <p>{copy('historical')}</p>
                </>
              )}
            </article>
          )
        })
      ) : (
        <p>{t('empty')}</p>
      )}
      <p>{t('noAutoApproval')}</p>
    </section>
  )
}
