'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { BackLink } from '@/components/layout/back-link'
import { SectionHeading } from '@/components/ui/section-heading'
import { Status } from '@/components/ui/status'
import { RiskAssessment } from '@/features/assessments/components/risk-assessment'
import { CaseAssistant } from '@/features/assistant/components/case-assistant'
import { TransactionDialog } from '@/features/cases/components/transaction-dialog'
import { Overview } from '@/features/cases/components/transaction-overview'
import { Documents } from '@/features/documents/components/documents'
import { SourceViewer } from '@/features/evidence/components/source-viewer'
import { type SourceTarget } from '@/features/evidence/types'
import { NonFinancialInformation } from '@/features/questionnaires/components/non-financial-information'
import { RequestsHistory } from '@/features/requests/components/requests-history'
import { CaseHistory } from '@/features/history/components/case-history'
import { companyHealthText } from '@/lib/i18n/company-health-copy'
import { DocumentReview } from '@/features/review/components/document-review'
import { useLocale } from '@/lib/i18n/locale-provider'
import type { MessageKey } from '@/lib/i18n/messages'
import { localizeBlocker, localizeLimitation } from '@/lib/i18n/review-i18n'
import { productText, isSyntheticText } from '@/lib/i18n/product-copy'
import { financialLabel } from '@/features/financial/labels'
import { specialistText } from '@/lib/i18n/specialist-copy'
import { formatMoney } from '@/lib/utils/money'
import {
  ClipboardList,
  FileCheck,
  FileText,
  FolderOpen,
  History,
  MessageSquareText,
  RefreshCw,
  TrendingUp,
} from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'
import { useCaseWorkspace } from '../hooks/use-case-workspace'
export const tabs = [
  'overview',
  'files',
  'review',
  'information',
  'assessment',
  'assistant',
  'history',
] as const
export type Tab = (typeof tabs)[number]
const tabIcons: Record<Tab, ComponentType<{ size?: number; className?: string }>> = {
  overview: FileText,
  files: FolderOpen,
  review: FileCheck,
  information: ClipboardList,
  assessment: TrendingUp,
  assistant: MessageSquareText,
  history: History,
}
export function Workspace({ caseId }: { caseId: string }) {
  const { t, locale } = useLocale(),
    [tab, setTab] = useState<Tab>('overview'),
    [source, setSource] = useState<SourceTarget | null>(null),
    [editing, setEditing] = useState(false)
  const { resource, detail, readiness, party, reload, currentReadiness } = useCaseWorkspace(caseId)
  useEffect(() => {
    const syncTab = () => {
      const candidate = window.location.hash.slice(1)
      setTab(tabs.includes(candidate as Tab) ? (candidate as Tab) : 'overview')
    }
    syncTab()
    window.addEventListener('hashchange', syncTab)
    return () => window.removeEventListener('hashchange', syncTab)
  }, [])
  function selectTab(next: Tab) {
    setTab(next)
    window.history.replaceState(window.history.state, '', `#${next}`)
  }
  if (!detail)
    return (
      <>
        <BackLink />
        {resource.loading ? (
          <Loading />
        ) : (
          <ErrorNotice error={resource.error} retry={resource.reload} />
        )}
      </>
    )
  const company = detail.purpose === 'company_health'
  const activeTabs: readonly Tab[] = company ? ['overview', 'files', 'assessment', 'history'] : tabs
  const selectedTab = activeTabs.includes(tab) ? tab : 'overview'
  return (
    <>
      <BackLink />
      <div className="aic-page-title">
        <div>
          <p className="eyebrow">
            {detail.exposure_kind ? t(detail.exposure_kind) : companyHealthText(locale, 'title')}
          </p>
          <h1>{party.data?.name ?? t('counterparty')}</h1>
          <p className="mono">{party.data?.tax_id ?? '—'}</p>
        </div>
        <div className="wrap-actions">
          {detail.lifecycle_stage && <Status value={detail.lifecycle_stage} />}
          <span>
            {t('revision')} {detail.revision}
          </span>
          <button
            className="icon-button"
            aria-label={t('refresh')}
            disabled={resource.loading}
            onClick={reload}
          >
            <RefreshCw size={19} />
          </button>
        </div>
      </div>
      <ErrorNotice error={resource.error} retry={reload} />
      <ErrorNotice error={party.error} retry={party.reload} />
      {(isSyntheticText(detail.exposure?.contract_ref) || isSyntheticText(party.data?.name)) &&
        selectedTab !== 'assessment' && (
          <p className="warning-banner">{productText(locale, 'synthetic')}</p>
        )}
      {detail.exposure && (
        <details className="case-context">
          <summary>
            {t(detail.exposure_kind!)} · {t('reference')}: {detail.exposure.contract_ref ?? '—'}
          </summary>
          <div className="aic-transaction-strip">
            <div>
              <span>{t('amount')}</span>
              <strong>{formatMoney(detail.exposure.amount_vnd, locale)}</strong>
            </div>
            <div>
              <span>{t('term')}</span>
              <strong>{detail.exposure.term_days ?? '—'}</strong>
            </div>
            <div>
              <span>{t('organization')}</span>
              <strong>{t(detail.exposure.organization_role as MessageKey)}</strong>
            </div>
            <div>
              <span>{t('counterparty')}</span>
              <strong>{t(detail.exposure.counterparty_role as MessageKey)}</strong>
            </div>
          </div>
        </details>
      )}
      <div className="workspace-tabs" role="tablist" aria-label={t('desk')}>
        {activeTabs.map((key) => {
          const Icon = tabIcons[key]
          const isSelected = selectedTab === key
          return (
            <button
              key={key}
              id={`tab-${key}`}
              role="tab"
              aria-controls={`panel-${key}`}
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              className={isSelected ? 'active selected' : ''}
              onClick={() => selectTab(key)}
              onKeyDown={(e) => {
                if (e.ctrlKey || e.metaKey || e.altKey) return
                let index = activeTabs.indexOf(selectedTab)
                if (e.key === 'ArrowRight') index = (index + 1) % activeTabs.length
                else if (e.key === 'ArrowLeft')
                  index = (index + activeTabs.length - 1) % activeTabs.length
                else if (e.key === 'Home') index = 0
                else if (e.key === 'End') index = activeTabs.length - 1
                else return
                e.preventDefault()
                selectTab(activeTabs[index])
                document.getElementById(`tab-${activeTabs[index]}`)?.focus()
              }}
            >
              <Icon size={16} />
              <span>
                {company && key === 'history' ? companyHealthText(locale, 'history') : t(key)}
              </span>
            </button>
          )
        })}
      </div>
      {activeTabs.map((key) => (
        <div
          key={key}
          id={`panel-${key}`}
          role="tabpanel"
          aria-labelledby={`tab-${key}`}
          hidden={selectedTab !== key}
        >
          {key === 'overview' && (
            <>
              <SectionHeading title={t('overview')}>
                {!company && (
                  <button className="secondary-button" onClick={() => setEditing(true)}>
                    {t('edit')}
                  </button>
                )}
              </SectionHeading>
              <div className="overview-summary">
                <article className="panel aic-section">
                  <p>{t('files')}</p>
                  <strong className="overview-count">{detail.documents?.length ?? '—'}</strong>
                  <p>{t('source')}</p>
                  <button className="text-button" onClick={() => selectTab('files')}>
                    {t('files')}
                  </button>
                </article>
                {!company && (
                  <article className="panel aic-section">
                    <p>{t('review')}</p>
                    <p className="tag">
                      {detail.latest_review_run_id
                        ? specialistText(locale, 'reviewSaved')
                        : t('missing')}
                    </p>
                    <p>{t('reviewFirst')}</p>
                    <button className="text-button" onClick={() => selectTab('review')}>
                      {t('review')}
                    </button>
                  </article>
                )}
                {company && (
                  <article className="panel aic-section">
                    <h3>{companyHealthText(locale, 'verify')}</h3>
                    <p>{companyHealthText(locale, 'verifyHelp')}</p>
                    <button className="text-button" onClick={() => selectTab('assessment')}>
                      {t('assessment')}
                    </button>
                  </article>
                )}
                <article className="panel aic-section">
                  <p>{productText(locale, 'result')}</p>
                  <p className="tag amber">
                    {specialistText(locale, detail.latest_assessment_id ? 'saved' : 'noResult')}
                  </p>
                  <p>{productText(locale, 'selectPeriod')}</p>
                  <button className="primary-button" onClick={() => selectTab('assessment')}>
                    {t('assessment')}
                  </button>
                </article>
              </div>
              {detail.exposure && (
                <details className="case-context">
                  <summary>{t('conditions')}</summary>
                  <Overview detail={detail} />
                </details>
              )}
              <section className="panel aic-section">
                <p className="eyebrow">{productText(locale, 'next')}</p>
                <h3>{t('readiness')}</h3>
                <ErrorNotice error={readiness.error} retry={readiness.reload} />
                {readiness.loading && !currentReadiness ? (
                  <Loading />
                ) : (
                  <>
                    <Status value={currentReadiness?.method_status ?? 'missing'} />
                    {currentReadiness?.blockers.map((b) => (
                      <p key={b.code}>
                        {financialLabel(locale, 'blocker', b.code).known
                          ? financialLabel(locale, 'blocker', b.code).label
                          : localizeBlocker(b, locale)}
                      </p>
                    ))}
                    {currentReadiness?.limitations.map((l, i) => (
                      <p key={i}>{localizeLimitation(l, locale)}</p>
                    ))}
                  </>
                )}
                <div className="request-actions">
                  <button className="primary-button" onClick={() => selectTab('files')}>
                    {t('files')}
                  </button>
                  {!company && (
                    <button className="secondary-button" onClick={() => selectTab('review')}>
                      {t('review')}
                    </button>
                  )}
                </div>
              </section>
            </>
          )}
          {key === 'files' && (
            <Documents
              detail={detail}
              reload={reload}
              openSource={setSource}
              openFinancial={() => selectTab('assessment')}
            />
          )}{' '}
          {key === 'review' && (
            <DocumentReview
              detail={detail}
              readiness={currentReadiness}
              reload={reload}
              openSource={setSource}
            />
          )}{' '}
          {key === 'information' && <NonFinancialInformation detail={detail} reload={reload} />}{' '}
          {key === 'assessment' && (
            <RiskAssessment
              detail={detail}
              party={party.data}
              readiness={currentReadiness}
              reload={reload}
              openSource={setSource}
            />
          )}{' '}
          {key === 'history' &&
            (company ? (
              <CaseHistory detail={detail} />
            ) : (
              <RequestsHistory detail={detail} reload={reload} />
            ))}
        </div>
      ))}
      {editing && detail.exposure && (
        <TransactionDialog initial={detail} onClose={() => setEditing(false)} onSaved={reload} />
      )}{' '}
      {source && (
        <SourceViewer
          key={
            'evidenceId' in source
              ? source.evidenceId
              : 'dossierMemberId' in source
                ? source.dossierMemberId
                : `${source.documentId}:${source.version}:${source.hash}`
          }
          target={source}
          onClose={() => setSource(null)}
        />
      )}
    </>
  )
}
