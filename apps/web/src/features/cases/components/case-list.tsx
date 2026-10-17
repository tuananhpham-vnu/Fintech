'use client'
import { Empty } from '@/components/feedback/empty'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { Pagination } from '@/components/ui/pagination'
import { Status } from '@/components/ui/status'
import { TransactionDialog } from '@/features/cases/components/transaction-dialog'
import { type ExposureKind } from '@/lib/api/contracts'
import { rolePairs } from '@/lib/domain/cases'
import { useLocale } from '@/lib/i18n/locale-provider'
import { formatMoney } from '@/lib/utils/money'
import { ArrowUpRight, Building2, Plus, RefreshCw, Search } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useCaseList } from '../hooks/use-case-list'
export function CaseList() {
  const { t, locale } = useLocale()
  const [open, setOpen] = useState(false)
  const { rows, names, visible, cursors, setCursors, query, setQuery, kind, setKind } =
    useCaseList()
  return (
    <>
      <div className="aic-page-title">
        <div>
          <p className="eyebrow">AIC RATING</p>
          <h1>{t('hero')}</h1>
          <p>{t('heroText')}</p>
        </div>
        <button className="primary-button" onClick={() => setOpen(true)}>
          <Plus size={17} />
          {t('newCase')}
        </button>
      </div>
      <section className="panel">
        <div className="aic-list-heading">
          <h2>{t('cases')}</h2>
          <button
            className="icon-button"
            aria-label={t('refresh')}
            disabled={rows.loading}
            onClick={rows.reload}
          >
            <RefreshCw size={18} />
          </button>
        </div>
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
          <select
            className="filter-select"
            aria-label={t('type')}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">{t('all')}</option>
            {Object.keys(rolePairs).map((k) => (
              <option key={k} value={k}>
                {t(k as ExposureKind)}
              </option>
            ))}
          </select>
        </div>
        <ErrorNotice error={rows.error} retry={rows.reload} />
        {rows.loading && <Loading />}
        {!rows.loading &&
          rows.data &&
          (rows.data.items.length === 0 ? (
            <Empty>
              <p>{t('emptyCases')}</p>
              <Link href="/counterparties" className="secondary-button">
                {t('newParty')}
              </Link>
            </Empty>
          ) : visible.length ? (
            <div className="aic-case-list">
              {visible.map((c) => (
                <Link key={c.id} href={`/cases/${c.id}`} className="aic-case-row">
                  <div className="aic-party-name">
                    <div className="avatar">
                      <Building2 size={20} />
                    </div>
                    <div>
                      <strong>{names.data?.[c.counterparty_id]?.name ?? c.counterparty_id}</strong>
                      <small>{names.data?.[c.counterparty_id]?.tax_id ?? c.id}</small>
                    </div>
                  </div>
                  <div>
                    <strong>{t(c.exposure_kind)}</strong>
                    <small>{c.exposure.contract_ref ?? '—'}</small>
                  </div>
                  <div>
                    <strong>{formatMoney(c.exposure.amount_vnd, locale)}</strong>
                    <small>
                      {c.exposure.term_days ?? '—'} {t('days')}
                    </small>
                  </div>
                  <Status value={c.lifecycle_stage} />
                  <ArrowUpRight size={18} />
                </Link>
              ))}
            </div>
          ) : (
            <p className="empty-state">{t('noMatches')}</p>
          ))}
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
      {open && <TransactionDialog onClose={() => setOpen(false)} onSaved={rows.reload} />}
    </>
  )
}
