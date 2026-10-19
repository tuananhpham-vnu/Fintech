'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BackLink } from '@/components/layout/back-link'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { Modal } from '@/components/ui/modal'
import { useResource } from '@/hooks/use-resource'
import type { CaseDetail, Counterparty, Readiness } from '@/lib/api/contracts'
import { useSession } from '@/lib/auth/session-context'
import { useLocale } from '@/lib/i18n/locale-provider'
import { companyHealthText } from '@/lib/i18n/company-health-copy'
import { financialLabel } from '@/features/financial/labels'
import { financialApi } from '@/features/financial/api'
import { intakeApi, type IntakeItem } from '@/features/financial/intake-api'
import { intakeProgress } from '@/features/financial/intake-model'
import {
  FinancialIntake,
  FinancialReviewGrid,
} from '@/features/financial/components/financial-intake'
import { IntakePreview } from '@/features/financial/components/intake-preview'
import { CompanyFinancialReport } from '@/features/assessments/components/company-financial-report'
import { CaseHistory } from '@/features/history/components/case-history'

const tabKeys = ['overview', 'files', 'review', 'history'] as const

export function CompanyWorkspace({
  detail,
  party,
  readiness,
  reload,
}: {
  detail: CaseDetail
  party: Counterparty | null
  readiness: Readiness | null
  reload: () => void
}) {
  const { status } = useSession(),
    { locale } = useLocale(),
    [tab, setTab] = useState('overview'),
    [preview, setPreview] = useState<{ item: IntakeItem; page: number } | null>(null)

  const copy = (key: Parameters<typeof companyHealthText>[1]) => companyHealthText(locale, key)

  const tabs: readonly (readonly [string, string])[] = [
    ['overview', copy('tabOverview')],
    ['files', copy('tabFiles')],
    ['review', copy('tabReview')],
    ['history', copy('tabHistory')],
  ]

  const loadIntakes = useCallback(
    (signal: AbortSignal) => intakeApi.list(detail.id, signal),
    [detail.id],
  )
  const intakes = useResource(loadIntakes, status === 'ready', 3000, detail.id),
    page = intakes.data
  const loadFinancial = useCallback(
    (signal: AbortSignal) => financialApi.get(detail.id, signal),
    [detail.id, detail.revision, page?.review.source_snapshot_hash, page?.review.confirmed],
  )
  const registry = useResource(loadFinancial, status === 'ready', 0, detail.id),
    lastRevision = useRef(detail.revision)
  useEffect(() => {
    if (page && page.revision !== lastRevision.current) {
      lastRevision.current = page.revision
      reload()
    }
  }, [page?.revision, reload])
  useEffect(() => {
    const sync = () => {
      const candidate = window.location.hash.slice(1)
      setTab(tabKeys.includes(candidate as (typeof tabKeys)[number]) ? candidate : 'overview')
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  function select(next: string) {
    setTab(next)
    window.history.replaceState(window.history.state, '', `#${next}`)
  }
  function refresh() {
    intakes.reload()
    registry.reload()
    reload()
  }
  function open(item: IntakeItem, page = 1) {
    setPreview({ item, page })
  }
  const progress = page ? intakeProgress(page.items) : null
  return (
    <div className="company-workspace">
      <BackLink />
      <div className="aic-page-title">
        <div>
          <p className="eyebrow">{copy('workspaceEyebrow')}</p>
          <h1>{party?.name ?? copy('defaultCompany')}</h1>
          <div className="company-metadata-badges">
            <span className="badge badge-slate" title={copy('badgeTaxIdTitle')}>
              <svg
                className="badge-icon"
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
              >
                <line x1="4" y1="9" x2="20" y2="9" />
                <line x1="4" y1="15" x2="20" y2="15" />
                <line x1="10" y1="3" x2="8" y2="21" />
                <line x1="16" y1="3" x2="14" y2="21" />
              </svg>
              {copy('badgeTaxId')}: <strong>{party?.tax_id ?? 'N/A'}</strong>
            </span>
            <span className="badge badge-blue" title={copy('badgeCountryTitle')}>
              <svg
                className="badge-icon"
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              {copy('badgeCountry')}:{' '}
              <strong>
                {party?.country === 'VN' ? copy('badgeCountryVn') : (party?.country ?? 'N/A')}
              </strong>
            </span>
            <span className="badge badge-green" title={copy('badgeIndustryTitle')}>
              <svg
                className="badge-icon"
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
              >
                <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
                <line x1="9" y1="22" x2="9" y2="22.01" />
                <line x1="15" y1="22" x2="15" y2="22.01" />
                <line x1="9" y1="6" x2="9" y2="6.01" />
                <line x1="15" y1="6" x2="15" y2="6.01" />
                <line x1="9" y1="10" x2="9" y2="10.01" />
                <line x1="15" y1="10" x2="15" y2="10.01" />
                <line x1="9" y1="14" x2="9" y2="14.01" />
                <line x1="15" y1="14" x2="15" y2="14.01" />
                <line x1="9" y1="18" x2="9" y2="18.01" />
                <line x1="15" y1="18" x2="15" y2="18.01" />
              </svg>
              {copy('badgeIndustry')}:{' '}
              <strong>
                {party?.industry_code === 'DISTRIBUTION_WHOLESALE_PILOT'
                  ? copy('badgeIndustryWholesale')
                  : party?.industry_code
                    ? financialLabel(locale, 'scope', party.industry_code).label
                    : 'N/A'}
              </strong>
            </span>
            <span className="badge badge-purple" title={copy('badgeModelTitle')}>
              <svg
                className="badge-icon"
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
              >
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              {copy('badgeModel')}: <strong>AIC-FHI-1.0 (v1.0.0)</strong>
            </span>
          </div>
        </div>
        <button className="secondary-button" onClick={refresh}>
          {copy('refresh')}
        </button>
      </div>
      {party && party.industry_code !== 'DISTRIBUTION_WHOLESALE_PILOT' && (
        <div className="warning-banner" role="status">
          <p>
            {locale === 'vi'
              ? !party.industry_code || party.industry_code === 'UNKNOWN'
                ? 'Chưa xác định ngành của doanh nghiệp nên chưa thể phát điểm. Hãy khai báo ngành thực tế tại Đối tác; method hiện tại hỗ trợ Phân phối / bán buôn. Tải thêm BCTC không giải quyết được điều kiện này.'
                : 'Ngành đã khai báo chưa thuộc phạm vi Phân phối / bán buôn của method hiện tại. Kiểm tra ngành thực tế tại Đối tác trước khi chấm điểm.'
              : locale === 'zh-CN'
                ? '企业行业未确定或不在当前批发/分销试点范围内，暂不能发布得分。请在交易对手页面核实实际行业；增加报表不能解除此限制。'
                : 'The company industry is unknown or outside the current wholesale/distribution pilot. Verify its actual industry under Counterparties before scoring. Uploading more reports will not resolve this condition.'}
          </p>
          <Link className="text-button" href="/counterparties">
            {locale === 'vi'
              ? 'Kiểm tra ngành tại Đối tác'
              : locale === 'zh-CN'
                ? '核实交易对手行业'
                : 'Verify counterparty industry'}
          </Link>
        </div>
      )}
      <div className="workspace-tabs" role="tablist" aria-label={copy('tabOverview')}>
        {tabs.map(([id, label], index) => (
          <button
            key={id}
            role="tab"
            id={`company-tab-${id}`}
            aria-controls={`company-panel-${id}`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? 'active selected' : ''}
            onClick={() => select(id)}
            onKeyDown={(e) => {
              const n =
                e.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : e.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? tabs.length - 1
                        : -1
              if (n >= 0) {
                e.preventDefault()
                select(tabs[n][0])
                document.getElementById(`company-tab-${tabs[n][0]}`)?.focus()
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorNotice error={intakes.error} retry={refresh} />
      <ErrorNotice error={registry.error} retry={registry.reload} />
      {!page ? (
        <Loading />
      ) : (
        <>
          {progress?.active && tab !== 'files' && (
            <p className="financial-inline-progress" role="status">
              {copy('extractionProgressBanner')}: {progress.completed}/{progress.total}{' '}
              {copy('filesProcessed')}.{' '}
              <button className="text-button" onClick={() => select('files')}>
                {copy('viewFiles')}
              </button>
            </p>
          )}
          <div role="tabpanel" id={`company-panel-${tab}`} aria-labelledby={`company-tab-${tab}`}>
            {tab === 'overview' && (
              <CompanyFinancialReport
                key={tab}
                detail={detail}
                registry={registry.data}
                page={page}
                readiness={readiness}
                reload={refresh}
                onSelectTab={select}
              />
            )}
            {tab === 'files' && (
              <FinancialIntake
                industry={
                  [
                    'DISTRIBUTION_WHOLESALE_PILOT',
                    'MANUFACTURING',
                    'RETAIL',
                    'BUSINESS_SERVICES',
                    'CONSUMER_DURABLES',
                    'OTHER',
                  ].includes(party?.industry_code ?? '')
                    ? party!.industry_code!
                    : 'UNKNOWN'
                }
                caseId={detail.id}
                page={page}
                registry={registry.data}
                reload={refresh}
                onPreview={open}
              />
            )}
            {tab === 'review' && (
              <FinancialReviewGrid
                caseId={detail.id}
                revision={page.revision}
                registry={registry.data}
                items={page.items}
                onPreview={open}
                reload={refresh}
              />
            )}
            {tab === 'history' && <CaseHistory detail={detail} />}
          </div>
        </>
      )}
      {preview && (
        <Modal title={copy('previewOriginalModal')} onClose={() => setPreview(null)} drawer>
          <IntakePreview item={preview.item} initialPage={preview.page} />
        </Modal>
      )}
    </div>
  )
}
