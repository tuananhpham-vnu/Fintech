'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { Pagination } from '@/components/ui/pagination'
import { type CaseDetail } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { formatTime } from '@/lib/utils/format'
import { useCaseHistory } from '../hooks/use-case-history'
export function CaseHistory({ detail }: { detail: CaseDetail }) {
  const { t, locale } = useLocale()
  const { history, cursors, setCursors } = useCaseHistory(detail)
  return (
    <section className="panel timeline-panel">
      <div className="section-title">
        <h3>{t('history')}</h3>
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
              <strong>{event.action}</strong>
              <p>{event.reason}</p>
              <small>
                {event.actor} · {t('revision')} {event.revision_before ?? '—'} →{' '}
                {event.revision_after ?? '—'}
              </small>
              <time dateTime={event.time}>{formatTime(event.time, locale)}</time>
              <details>
                <summary>{t('evidence')}</summary>
                {event.subject_refs.map((ref) => (
                  <p className="mono" key={ref}>
                    {ref}
                  </p>
                ))}
              </details>
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
