'use client'
import { Status } from '@/components/ui/status'
import type { SourceTarget } from '@/features/evidence/types'
import type { Document } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import {
  FileText,
  Building,
  Receipt,
  FileCheck2,
  CreditCard,
  Package,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  FileSearch,
  CheckSquare,
} from 'lucide-react'
import { useState, type ComponentType, type CSSProperties } from 'react'
import { countUsableExtractedFields, groupDocuments, type DocumentGroupKey } from '../groups'

const groupIcons: Record<
  DocumentGroupKey,
  ComponentType<{ size?: number; className?: string; style?: CSSProperties }>
> = {
  bctc: Building,
  tax: Receipt,
  contract: FileCheck2,
  payment: CreditCard,
  debt: Package,
  other: HelpCircle,
}

export function DocumentGroups({
  documents,
  openSource,
  onInspect,
  onClassify,
}: {
  documents: Document[]
  openSource: (target: SourceTarget) => void
  onInspect: (doc: Document) => void
  onClassify: (doc: Document) => void
}) {
  const { t } = useLocale()
  const groups = groupDocuments(documents)
  // Default: open all groups that have documents
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // Filter groups: show groups with documents, and if all empty, show other
  const activeGroups = groups.filter((g) => g.documents.length > 0)
  const displayGroups = activeGroups.length > 0 ? activeGroups : groups

  return (
    <div className="aic-doc-groups">
      {displayGroups.map((group) => {
        const Icon = groupIcons[group.key] ?? FileText
        const isCollapsed = !!collapsed[group.key]
        const count = group.documents.length

        return (
          <section className="aic-group-section" key={group.key} data-group={group.key}>
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
                <Icon size={18} style={{ color: 'var(--primary)' }} />
                <h3>{t(group.titleKey)}</h3>
                <span className="aic-group-count">{count}</span>
              </div>
              {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
            </div>

            {!isCollapsed && (
              <div className="aic-group-body">
                {group.documents.length === 0 ? (
                  <p
                    style={{
                      padding: '16px 20px',
                      color: 'var(--muted)',
                      margin: 0,
                      fontSize: '13px',
                    }}
                  >
                    {t('unresolved')}
                  </p>
                ) : (
                  group.documents.map((doc) => {
                    const usableCount = countUsableExtractedFields(doc)
                    const isConfirmed = !!doc.source_review?.declared_type

                    return (
                      <article key={doc.id} className="document-row">
                        <div className="document-main">
                          <div className="file-icon">
                            <FileText size={20} />
                          </div>
                          <div className="file-copy">
                            <strong>{doc.name ?? t(doc.type)}</strong>
                            <p>
                              {t(doc.type)} · {t('version')} {doc.version} · {doc.pages} {t('page')}
                            </p>
                          </div>

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
                          {doc.status === 'completed' ? (
                            usableCount > 0 ? (
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
                          ) : (
                            <Status value={doc.status} />
                          )}

                          {/* AI Mode badge (live / mock) */}
                          {!!doc.source &&
                            typeof doc.source === 'object' &&
                            'ai_mode' in doc.source &&
                            ['live', 'mock'].includes(String(doc.source.ai_mode)) && (
                              <Status value={String(doc.source.ai_mode)} />
                            )}

                          {/* Source Review match status */}
                          {doc.source_review && (
                            <Status
                              value={
                                doc.source_review.subject_match === 'match'
                                  ? 'source_reviewed'
                                  : doc.source_review.subject_match === 'mismatch'
                                    ? 'source_mismatch'
                                    : 'unresolved'
                              }
                            />
                          )}
                        </div>

                        <div className="document-actions">
                          <button
                            className="text-button"
                            onClick={() =>
                              openSource({
                                documentId: doc.id,
                                version: doc.version,
                                hash: doc.hash,
                              })
                            }
                          >
                            <Eye size={13} />
                            <span>{t('source')}</span>
                          </button>
                          <button className="text-button" onClick={() => onInspect(doc)}>
                            <FileSearch size={13} />
                            <span>{t('inspect')}</span>
                          </button>
                          <button className="secondary-button" onClick={() => onClassify(doc)}>
                            <CheckSquare size={13} />
                            <span>{t('manual')}</span>
                          </button>
                        </div>
                      </article>
                    )
                  })
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
