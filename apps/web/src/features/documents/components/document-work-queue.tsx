'use client'
import type { SourceTarget } from '@/features/evidence/types'
import type { Document } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileSearch,
  CheckSquare,
  FileText,
  FolderOpen,
  ArrowRight,
} from 'lucide-react'
import {
  getDocumentActionRequired,
  resolveDocumentPeriod,
  countUsableExtractedFields,
} from '../groups'

export function DocumentWorkQueue({
  documents,
  onInspect,
  onClassify,
  openSource,
  onOpenExplorer,
}: {
  documents: Document[]
  onInspect: (doc: Document) => void
  onClassify: (doc: Document) => void
  openSource: (target: SourceTarget) => void
  onOpenExplorer: (filterActionRequired?: boolean) => void
}) {
  const { t, locale } = useLocale()

  const actionableDocs = documents.filter((d) => getDocumentActionRequired(d).required)
  const displayLimit = 8
  const displayedDocs = actionableDocs.slice(0, displayLimit)
  const remainingCount = actionableDocs.length - displayedDocs.length

  if (actionableDocs.length === 0) {
    return (
      <section className="aic-section aic-work-queue empty" aria-label={t('workQueue')}>
        <div className="aic-work-queue-card empty-card">
          <div className="empty-card-icon">
            <CheckCircle2 size={24} style={{ color: 'var(--primary)' }} />
          </div>
          <div className="empty-card-content">
            <h4>{t('noActionRequired')}</h4>
            <p>{t('noActionRequiredDesc')}</p>
          </div>
          <button
            className="secondary-button aic-open-explorer-btn"
            onClick={() => onOpenExplorer(false)}
          >
            <FolderOpen size={15} />
            {t('openExplorer')} ({documents.length})
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="aic-section aic-work-queue" aria-label={t('workQueue')}>
      <div className="aic-work-queue-header">
        <div className="aic-work-queue-title">
          <AlertTriangle size={17} style={{ color: '#b85d19' }} />
          <h3>{t('workQueue')}</h3>
          <span className="tag amber">
            <span className="status-dot" />
            {actionableDocs.length} {t('filterActionRequired').toLowerCase()}
          </span>
        </div>
        <button
          className="text-button aic-view-all-link"
          onClick={() => onOpenExplorer(true)}
          title={t('viewAllActionRequired')}
        >
          <span>
            {t('viewAllActionRequired')} ({actionableDocs.length})
          </span>
          <ArrowRight size={13} />
        </button>
      </div>

      <div className="aic-work-queue-list">
        {displayedDocs.map((doc) => {
          const actionInfo = getDocumentActionRequired(doc)
          const periodInfo = resolveDocumentPeriod(doc)
          const usableCount = countUsableExtractedFields(doc)
          const isConfirmed = !!doc.source_review?.declared_type

          return (
            <article key={doc.id} className="aic-work-queue-row">
              <div className="row-main">
                <div className="row-icon">
                  <FileText size={18} />
                </div>
                <div className="row-info">
                  <strong className="row-filename" title={doc.name ?? t(doc.type)}>
                    {doc.name ?? t(doc.type)}
                  </strong>
                  <div className="row-meta">
                    {/* Period tag */}
                    {periodInfo.year ? (
                      <span className="meta-pill">
                        {periodInfo.isVerified
                          ? `${periodInfo.year} (${t('yearConfirmed')})`
                          : `${periodInfo.year} (${t('yearPredicted')})`}
                      </span>
                    ) : (
                      <span className="meta-pill muted">{t('yearUnspecified')}</span>
                    )}

                    {/* Document type tag */}
                    <span className="meta-pill">
                      {isConfirmed
                        ? `${t(doc.source_review!.declared_type)} (${t('humanConfirmed')})`
                        : `${t(doc.type)} (${t('aiSuggested')})`}
                    </span>

                    {/* Pages */}
                    {doc.pages > 0 && (
                      <span className="meta-pill">
                        {doc.pages} {t('page')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Prominent Action Reason badge */}
                <div className="row-badge">
                  {doc.status === 'failed' ? (
                    <span className="tag red">
                      <span className="status-dot" />
                      {t('failed')}
                    </span>
                  ) : actionInfo.reasonKey === 'needs_review' ? (
                    <span className="tag amber" title={t('retainedLongPdfNotice')}>
                      <span className="status-dot" />
                      {t('retainedLongPdfNotice')}
                    </span>
                  ) : actionInfo.reasonKey === 'rejected' ? (
                    <span className="tag red">
                      <span className="status-dot" />
                      {locale === 'vi' ? 'Từ chối định dạng' : 'Rejected format'}
                    </span>
                  ) : doc.status === 'completed' && usableCount === 0 ? (
                    <span className="tag amber">
                      <span className="status-dot" />
                      {t('noUsableFields')}
                    </span>
                  ) : !isConfirmed ? (
                    <span className="tag amber">
                      <span className="status-dot" />
                      {t('unconfirmed')}
                    </span>
                  ) : actionInfo.reasonKey ? (
                    <span className={`tag ${actionInfo.tone}`}>
                      <span className="status-dot" />
                      {t(actionInfo.reasonKey)}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="row-actions">
                <button
                  className="text-button"
                  onClick={() => {
                    const raw = doc as unknown as Record<string, unknown>
                    if (raw.dossier_member_id) {
                      openSource({
                        dossierMemberId: raw.dossier_member_id as string,
                        name: doc.name,
                        hash: doc.hash || null,
                      })
                    } else {
                      openSource({
                        documentId: doc.id,
                        version: doc.version,
                        hash: doc.hash,
                        name: doc.name,
                      })
                    }
                  }}
                  title={t('source')}
                >
                  <Eye size={13} />
                  <span>{t('source')}</span>
                </button>
                <button className="text-button" onClick={() => onInspect(doc)} title={t('inspect')}>
                  <FileSearch size={13} />
                  <span>{t('inspect')}</span>
                </button>
                <button
                  className="secondary-button"
                  onClick={() => onClassify(doc)}
                  title={t('manual')}
                >
                  <CheckSquare size={13} />
                  <span>{t('manual')}</span>
                </button>
              </div>
            </article>
          )
        })}
      </div>

      <div className="aic-work-queue-footer">
        {remainingCount > 0 ? (
          <button className="secondary-button" onClick={() => onOpenExplorer(true)}>
            {t('loadMore')} ({remainingCount} {t('files').toLowerCase()})
          </button>
        ) : null}

        <button
          className="primary-button aic-open-library-btn"
          onClick={() => onOpenExplorer(false)}
        >
          <FolderOpen size={15} />
          <span>
            {t('openExplorer')} ({documents.length} {t('files').toLowerCase()})
          </span>
        </button>
      </div>
    </section>
  )
}
