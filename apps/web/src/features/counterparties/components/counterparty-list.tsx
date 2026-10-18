'use client'
import { Empty } from '@/components/feedback/empty'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { BackLink } from '@/components/layout/back-link'
import { Pagination } from '@/components/ui/pagination'
import { SectionHeading } from '@/components/ui/section-heading'
import { Status } from '@/components/ui/status'
import { PartyDialog } from '@/features/counterparties/components/counterparty-dialog'
import { type Counterparty } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { formatTime } from '@/lib/utils/format'
import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { useCounterpartyList } from '../hooks/use-counterparty-list'
export function PartyList() {
  const { t, locale } = useLocale()
  const [editing, setEditing] = useState<Counterparty | 'new' | null>(null)
  const { rows, visible, cursors, setCursors, query, setQuery } = useCounterpartyList()
  return (
    <>
      <BackLink />
      <SectionHeading title={t('counterparties')}>
        <button className="secondary-button" disabled={rows.loading} onClick={rows.reload}>
          {t('refresh')}
        </button>
        <button className="primary-button" onClick={() => setEditing('new')}>
          <Plus size={16} />
          {t('newParty')}
        </button>
      </SectionHeading>
      <section className="panel">
        <div className="aic-filters">
          <label className="search-box">
            <Search size={17} />
            <input
              aria-label={t('search')}
              placeholder={t('search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <ErrorNotice error={rows.error} retry={rows.reload} />
        {rows.loading ? (
          <Loading />
        ) : (
          rows.data &&
          (!rows.data.items.length ? (
            <Empty />
          ) : !visible.length ? (
            <p className="empty-state">{t('noMatches')}</p>
          ) : (
            visible.map((p) => (
              <article key={p.id} className="aic-party-row">
                <div>
                  <strong>{p.name}</strong>
                  <p>
                    {p.tax_id ?? '—'} · {p.industry_code ?? '—'}
                  </p>
                  <small>{formatTime(p.updated_at, locale)}</small>
                </div>
                <Status value={p.identity_status} />
                <button className="secondary-button" onClick={() => setEditing(p)}>
                  {t('edit')}
                </button>
              </article>
            ))
          ))
        )}
        <Pagination
          busy={rows.loading}
          hasPrevious={cursors.length > 1}
          hasNext={!!rows.data?.next_cursor}
          previous={() => setCursors((c) => c.slice(0, -1))}
          next={() => {
            if (rows.data?.next_cursor) setCursors((c) => [...c, rows.data!.next_cursor!])
          }}
        />
      </section>
      {editing && (
        <PartyDialog
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={rows.reload}
        />
      )}
    </>
  )
}
