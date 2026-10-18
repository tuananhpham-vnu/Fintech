'use client'
import type { SourceTarget } from '@/features/evidence/types'
import { documentTypes, type Document, type DocumentType } from '@/lib/api/contracts'
import { DocumentLineage } from './document-lineage'
import { useLocale } from '@/lib/i18n/locale-provider'
import { DocumentGroups } from './document-groups'
import {
  ArrowLeft,
  Calendar,
  Layers,
  Search,
  X,
  AlertTriangle,
  FileText,
  ChevronDown,
  ChevronUp,
  Eye,
  FileSearch,
  CheckSquare,
  RotateCcw,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  groupDocumentsByYear,
  filterDocuments,
  resolveDocumentPeriod,
  countUsableExtractedFields,
  isDocumentActionRequired,
} from '../groups'

export function DocumentExplorer({
  documents,
  initialActionRequired = false,
  onBack,
  openSource,
  onInspect,
  onClassify,
}: {
  documents: Document[]
  initialActionRequired?: boolean
  onBack: () => void
  openSource: (target: SourceTarget) => void
  onInspect: (doc: Document) => void
  onClassify: (doc: Document) => void
}) {
  const { t } = useLocale()

  // Explorer view state
  const [groupBy, setGroupBy] = useState<'year' | 'type'>('year')
  const [actionRequiredOnly, setActionRequiredOnly] = useState(initialActionRequired)
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<DocumentType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Pagination / chunking: group key -> display count
  const [groupLimits, setGroupLimits] = useState<Record<string, number>>({})

  // Accordion collapsed state: group key -> boolean
  const [collapsedState, setCollapsedState] = useState<Record<string, boolean>>({})

  // Distinct years present in documents
  const availableYears = useMemo(() => {
    const set = new Set<string>()
    let hasUnspecified = false
    for (const d of documents) {
      const p = resolveDocumentPeriod(d)
      if (p.year) set.add(p.year)
      else hasUnspecified = true
    }
    return {
      years: Array.from(set).sort((a, b) => b.localeCompare(a)),
      hasUnspecified,
    }
  }, [documents])

  // Count total action required
  const totalActionRequired = useMemo(
    () => documents.filter(isDocumentActionRequired).length,
    [documents],
  )

  // Active filters check
  const hasActiveFilters =
    search.trim() !== '' ||
    actionRequiredOnly ||
    yearFilter !== 'all' ||
    typeFilter !== 'all' ||
    statusFilter !== 'all'

  // Filtered documents
  const filteredDocuments = useMemo(() => {
    return filterDocuments(documents, {
      search,
      actionRequiredOnly,
      yearFilter: yearFilter === 'all' ? null : yearFilter,
      typeFilter: typeFilter === 'all' ? null : typeFilter,
      statusFilter: statusFilter as any,
    })
  }, [documents, search, actionRequiredOnly, yearFilter, typeFilter, statusFilter])

  // Reset all filters
  const resetFilters = () => {
    setSearch('')
    setActionRequiredOnly(false)
    setYearFilter('all')
    setTypeFilter('all')
    setStatusFilter('all')
  }

  // Toggle group collapse
  const toggleGroup = (key: string) => {
    setCollapsedState((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // Show more documents in a group
  const showMoreInGroup = (key: string, total: number) => {
    setGroupLimits((prev) => {
      const current = prev[key] ?? 10
      return { ...prev, [key]: Math.min(current + 15, total) }
    })
  }

  // Render groups according to selected mode
  const yearGroups = useMemo(() => {
    if (groupBy !== 'year') return []
    return groupDocumentsByYear(filteredDocuments)
  }, [groupBy, filteredDocuments])

  return (
    <div className="aic-dossier-explorer" role="region" aria-label={t('explorer')}>
      {/* Explorer Top Toolbar */}
      <div className="aic-explorer-toolbar">
        <div className="toolbar-left">
          <button className="text-button back-btn" onClick={onBack} title={t('backToOverview')}>
            <ArrowLeft size={16} />
            <span>{t('backToOverview')}</span>
          </button>
          <div className="toolbar-title-wrap">
            <h3 className="toolbar-title">{t('explorer')}</h3>
            <span className="aic-group-count">{filteredDocuments.length}</span>
          </div>
        </div>

        <div className="toolbar-right">
          {/* Segmented Control: By Year vs By Category */}
          <div className="aic-segmented-control" role="tablist" aria-label="Group by">
            <button
              role="tab"
              aria-selected={groupBy === 'year'}
              className={`segmented-btn ${groupBy === 'year' ? 'active' : ''}`}
              onClick={() => setGroupBy('year')}
            >
              <Calendar size={14} />
              <span>{t('groupByYear')}</span>
            </button>
            <button
              role="tab"
              aria-selected={groupBy === 'type'}
              className={`segmented-btn ${groupBy === 'type' ? 'active' : ''}`}
              onClick={() => setGroupBy('type')}
            >
              <Layers size={14} />
              <span>{t('groupByType')}</span>
            </button>
          </div>

          {/* Quick Filter: All vs Action Required */}
          <div className="aic-quick-filters">
            <button
              className={`filter-pill-btn ${!actionRequiredOnly ? 'active' : ''}`}
              onClick={() => setActionRequiredOnly(false)}
            >
              {t('filterAll')} ({documents.length})
            </button>
            <button
              className={`filter-pill-btn amber ${actionRequiredOnly ? 'active' : ''}`}
              onClick={() => setActionRequiredOnly(true)}
            >
              <AlertTriangle size={13} style={{ color: '#b85d19' }} />
              <span>
                {t('filterActionRequired')} ({totalActionRequired})
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Search & Facets Bar */}
      <div className="aic-explorer-facets">
        {/* Fast Search input */}
        <div className="aic-search-input-wrap">
          <Search size={15} className="search-icon" />
          <input
            type="search"
            className="aic-explorer-search"
            placeholder={t('searchDocuments')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('searchDocuments')}
          />
          {search && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearch('')}
              aria-label={t('cancel')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Facet: Year Dropdown */}
        <div className="facet-select-wrap">
          <select
            className="aic-facet-select"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            aria-label={t('filterYear')}
          >
            <option value="all">{t('allYears')}</option>
            {availableYears.years.map((y) => (
              <option key={y} value={y}>
                Năm {y}
              </option>
            ))}
            {availableYears.hasUnspecified && (
              <option value="unspecified">{t('yearUnspecified')}</option>
            )}
          </select>
        </div>

        {/* Facet: Type Dropdown */}
        <div className="facet-select-wrap">
          <select
            className="aic-facet-select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            aria-label={t('filterType')}
          >
            <option value="all">{t('allTypes')}</option>
            {documentTypes.map((dt) => (
              <option key={dt} value={dt}>
                {t(dt)}
              </option>
            ))}
          </select>
        </div>

        {/* Facet: Status Dropdown */}
        <div className="facet-select-wrap">
          <select
            className="aic-facet-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label={t('filterStatus')}
          >
            <option value="all">{t('allStatuses')}</option>
            <option value="usable">{t('extractedWithFields')}</option>
            <option value="zero_usable">{t('zero_usable_fields')}</option>
            <option value="processing">{t('processingExtraction')}</option>
            <option value="failed">{t('failed')}</option>
            <option value="unconfirmed">{t('unconfirmed')}</option>
          </select>
        </div>
      </div>

      {/* Active Filters Summary Chips Bar */}
      {hasActiveFilters && (
        <div className="aic-active-filters-bar">
          <div className="active-chips-wrap">
            <span className="results-label">
              Hiển thị <strong>{filteredDocuments.length}</strong> / {documents.length} tài liệu
            </span>

            {search.trim() && (
              <span className="filter-chip">
                <span>&ldquo;{search}&rdquo;</span>
                <button type="button" onClick={() => setSearch('')}>
                  <X size={12} />
                </button>
              </span>
            )}

            {actionRequiredOnly && (
              <span className="filter-chip amber">
                <span>{t('filterActionRequired')}</span>
                <button type="button" onClick={() => setActionRequiredOnly(false)}>
                  <X size={12} />
                </button>
              </span>
            )}

            {yearFilter !== 'all' && (
              <span className="filter-chip">
                <span>
                  {yearFilter === 'unspecified' ? t('yearUnspecified') : `Năm ${yearFilter}`}
                </span>
                <button type="button" onClick={() => setYearFilter('all')}>
                  <X size={12} />
                </button>
              </span>
            )}

            {typeFilter !== 'all' && (
              <span className="filter-chip">
                <span>{t(typeFilter as any)}</span>
                <button type="button" onClick={() => setTypeFilter('all')}>
                  <X size={12} />
                </button>
              </span>
            )}

            {statusFilter !== 'all' && (
              <span className="filter-chip">
                <span>
                  {statusFilter === 'usable'
                    ? t('extractedWithFields')
                    : statusFilter === 'zero_usable'
                      ? t('zero_usable_fields')
                      : statusFilter === 'processing'
                        ? t('processingExtraction')
                        : statusFilter === 'failed'
                          ? t('failed')
                          : t('unconfirmed')}
                </span>
                <button type="button" onClick={() => setStatusFilter('all')}>
                  <X size={12} />
                </button>
              </span>
            )}

            <button type="button" className="text-button clear-all-btn" onClick={resetFilters}>
              <RotateCcw size={12} />
              <span>{t('clearFilters')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Grouped Accordions List */}
      <div className="aic-explorer-groups">
        {filteredDocuments.length === 0 ? (
          <div className="aic-explorer-empty">
            <p>{t('noMatchingDocuments')}</p>
            <button className="secondary-button" onClick={resetFilters}>
              {t('resetFilters')}
            </button>
          </div>
        ) : groupBy === 'year' ? (
          yearGroups.map((group) => {
            // When search/filter is active, auto-expand groups that have matching documents
            const isAutoExpanded = hasActiveFilters && group.documents.length > 0
            const isCollapsed = isAutoExpanded ? false : !!collapsedState[group.key]
            const limit = groupLimits[group.key] ?? 10
            const visibleDocs = group.documents.slice(0, limit)
            const hasMore = group.documents.length > limit

            return (
              <section className="aic-group-section" key={group.key} data-year={group.year}>
                <div
                  className="aic-group-header"
                  onClick={() => toggleGroup(group.key)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={!isCollapsed}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleGroup(group.key)
                    }
                  }}
                >
                  <div className="aic-group-header-left">
                    <Calendar size={18} style={{ color: 'var(--primary)' }} />
                    <h3>{group.title}</h3>
                    <span className="aic-group-count">{group.documents.length}</span>
                    {group.actionCount > 0 && (
                      <span className="tag amber" style={{ fontSize: '11px', padding: '1px 6px' }}>
                        <span className="status-dot" />
                        {group.actionCount} {t('filterActionRequired').toLowerCase()}
                      </span>
                    )}
                  </div>
                  {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </div>

                {!isCollapsed && (
                  <div className="aic-group-body">
                    {visibleDocs.map((doc) => (
                      <ExplorerDocumentRow
                        key={doc.id}
                        doc={doc}
                        documents={documents}
                        openSource={openSource}
                        onInspect={onInspect}
                        onClassify={onClassify}
                      />
                    ))}

                    {hasMore && (
                      <div className="group-load-more">
                        <button
                          className="secondary-button load-more-btn"
                          onClick={() => showMoreInGroup(group.key, group.documents.length)}
                        >
                          Hiển thị {visibleDocs.length} / {group.documents.length} · {t('loadMore')}{' '}
                          ({group.documents.length - visibleDocs.length})
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )
          })
        ) : (
          <DocumentGroups
            documents={filteredDocuments}
            sourceDocuments={documents}
            openSource={openSource}
            onInspect={onInspect}
            onClassify={onClassify}
          />
        )}
      </div>
    </div>
  )
}

function ExplorerDocumentRow({
  doc,
  documents,
  openSource,
  onInspect,
  onClassify,
}: {
  doc: Document
  documents: Document[]
  openSource: (target: SourceTarget) => void
  onInspect: (doc: Document) => void
  onClassify: (doc: Document) => void
}) {
  const { t, locale } = useLocale()
  const usableCount = countUsableExtractedFields(doc)
  const isConfirmed = !!doc.source_review?.declared_type
  const periodInfo = resolveDocumentPeriod(doc)
  const raw = doc as unknown as Record<string, unknown>
  const isNeedsReview =
    doc.status === 'needs_review' ||
    raw.dossier_intake_state === 'needs_review' ||
    raw.dossier_error_code === 'PDF_REQUIRES_CHUNKED_PROCESSING'
  const isRejected = doc.status === 'rejected' || raw.dossier_intake_state === 'rejected'

  return (
    <article key={doc.id} className="document-row">
      <div className="document-main">
        <div className="file-icon">
          <FileText size={20} />
        </div>
        <div className="file-copy">
          <strong title={doc.name ?? t(doc.type)}>{doc.name ?? t(doc.type)}</strong>
          <DocumentLineage document={doc} documents={documents} />
          <p>
            {t(doc.type)} · {t('version')} {doc.version}
            {doc.pages > 0 && ` · ${doc.pages} ${t('page')}`}
          </p>
        </div>

        {/* Period badge (Verified vs Predicted vs Unspecified) */}
        {periodInfo.year ? (
          <span className={`tag ${periodInfo.isVerified ? 'green' : 'neutral'}`}>
            <span className="status-dot" />
            {periodInfo.isVerified
              ? `Năm ${periodInfo.year}`
              : `Năm ${periodInfo.year} (${t('yearPredicted')})`}
          </span>
        ) : (
          <span className="tag neutral">
            <span className="status-dot" />
            {t('yearUnspecified')}
          </span>
        )}

        {/* Classification badge: AI Suggested vs Human Confirmed */}
        {isConfirmed ? (
          <span className="tag green" title={t('humanConfirmed')}>
            <span className="status-dot" />
            {t('humanConfirmed')}: {t(doc.source_review!.declared_type)}
          </span>
        ) : (
          <span className="tag neutral" title={t('aiSuggested')}>
            <span className="status-dot" />
            {t('aiSuggested')}: {t(doc.type)}
          </span>
        )}

        {/* Extraction and document status badge */}
        {isNeedsReview ? (
          <span className="tag amber" title={t('retainedLongPdfNotice')}>
            <span className="status-dot" />
            {t('retainedLongPdfNotice')}
          </span>
        ) : isRejected ? (
          <span className="tag red">
            <span className="status-dot" />
            {locale === 'vi' ? 'Từ chối định dạng' : 'Rejected format'}
          </span>
        ) : doc.status === 'completed' ? (
          usableCount === null ? (
            <span className="tag neutral">{t('extractionUnavailable')}</span>
          ) : usableCount > 0 ? (
            <span className="tag green">
              <span className="status-dot" />
              {t('extractedWithFields')} ({usableCount})
            </span>
          ) : (
            <span className="tag amber">
              <span className="status-dot" />
              {t('noUsableFields')}
            </span>
          )
        ) : doc.status === 'queued' ? (
          <span className="tag neutral">
            <span className="status-dot" />
            {t('extractionQueued')}
          </span>
        ) : doc.status === 'processing' || doc.status === 'running' ? (
          <span className="tag amber">
            <span className="status-dot" />
            {t('processingExtraction')}
          </span>
        ) : doc.status === 'failed' ? (
          <span className="tag red">
            <span className="status-dot" />
            {t('failed')}
          </span>
        ) : (
          <span className="tag neutral">{doc.status}</span>
        )}
      </div>

      <div className="document-actions">
        {(!isRejected || Boolean(raw.dossier_source_url)) && (
          <button
            className="text-button"
            onClick={() => {
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
        )}
        <button className="text-button" onClick={() => onInspect(doc)} title={t('inspect')}>
          <FileSearch size={13} />
          <span>{t('inspect')}</span>
        </button>
        {!isRejected && (
          <button className="secondary-button" onClick={() => onClassify(doc)} title={t('manual')}>
            <CheckSquare size={13} />
            <span>{t('manual')}</span>
          </button>
        )}
      </div>
    </article>
  )
}
