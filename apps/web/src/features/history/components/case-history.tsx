'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { Pagination } from '@/components/ui/pagination'
import { type CaseDetail } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { actionText, presentNote, productText } from '@/lib/i18n/product-copy'
import { companyHealthText } from '@/lib/i18n/company-health-copy'
import { formatTime } from '@/lib/utils/format'
import { useCaseHistory } from '../hooks/use-case-history'
export function CaseHistory({ detail }: { detail: CaseDetail }) {
  const { t, locale } = useLocale()
  const { history, cursors, setCursors } = useCaseHistory(detail)
  return (
    <section className="panel timeline-panel">
      <div className="section-title">
        <h3>
          {detail.purpose === 'company_health'
            ? companyHealthText(locale, 'history')
            : t('history')}
        </h3>
        <button className="text-button" onClick={history.reload}>
          {t('refresh')}
        </button>
      </div>
      <ErrorNotice error={history.error} retry={history.reload} />
      {history.loading ? (
        <Loading />
      ) : !history.data?.items.length ? (
        <p className="help-text">{t('noHistory')}</p>
      ) : (
        <ol className="timeline">
          {history.data.items.map((event) => (
            <li key={event.id}>
              <span className="timeline-point" />
              <strong>{actionText(event.action, locale)}</strong>
              <p>{presentNote(event.reason, locale)}</p>
              <small>
                {productText(locale, 'recorded')} · {t('revision')} {event.revision_before ?? '—'} →{' '}
                {event.revision_after ?? '—'}
              </small>
              <time dateTime={event.time}>{formatTime(event.time, locale)}</time>
            </li>
          ))}
        </ol>
      )}
      <Pagination
        hasPrevious={cursors.length > 1}
        hasNext={!!history.data?.next_cursor}
        busy={history.loading}
        previous={() => setCursors((c) => c.slice(0, -1))}
        next={() => {
          if (history.data?.next_cursor) setCursors((c) => [...c, history.data!.next_cursor!])
        }}
      />
    </section>
  )
}
