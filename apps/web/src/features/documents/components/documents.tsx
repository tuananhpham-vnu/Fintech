'use client'
import { Empty } from '@/components/feedback/empty'
import { SectionHeading } from '@/components/ui/section-heading'
import { Status } from '@/components/ui/status'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { casesApi } from '@/features/cases/api'
import { documentsApi } from '@/features/documents/api'
import { ExtractionDialog } from '@/features/documents/components/extraction-review'
import { UploadDialog } from '@/features/documents/components/upload-dialog'
import { DocumentClassification } from './document-classification'
import { DocumentWorkQueue } from './document-work-queue'
import { DocumentExplorer } from './document-explorer'
import { DocumentSummaryCard } from './document-summary-card'
import { ArchiveReceiptBanner } from './archive-receipt'
import { DossierArchiveBanner } from './dossier-archive-banner'
import { computeIngestionSummary } from '../groups'
import type { ArchiveReceipt } from '../api'
import type { SourceTarget } from '@/features/evidence/types'
import {
  type CaseDetail,
  type Document,
  type DossierArchive,
  type DossierAccepted,
} from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { Upload, FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export function Documents({
  detail,
  reload,
  openSource,
}: {
  detail: CaseDetail
  reload: () => void
  openSource: (target: SourceTarget) => void
}) {
  const { t } = useLocale(),
    [upload, setUpload] = useState(false),
    [inspect, setInspect] = useState<Document | null>(null),
    [manual, setManual] = useState<Document | null>(null),
    [retryId, setRetryId] = useState<string | null>(null),
    [archiveReceipt, setArchiveReceipt] = useState<ArchiveReceipt | null>(null),
    [dossierArchive, setDossierArchive] = useState<DossierArchive | null>(null),
    [isPollingDossier, setIsPollingDossier] = useState(false),
    [viewMode, setViewMode] = useState<'command_center' | 'explorer'>('command_center'),
    [explorerInitialActionRequired, setExplorerInitialActionRequired] = useState(false)

  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  const handleOpenExplorer = (actionRequiredOnly = false) => {
    setExplorerInitialActionRequired(actionRequiredOnly)
    setViewMode('explorer')
  }

  // Load latest dossier archive on mount or case switch
  const loadLatestDossier = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const archives = await documentsApi.listDossierArchives(detail.id, signal)
        if (archives && archives.length > 0) {
          const sorted = [...archives].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          )
          const latestSummary = sorted[0]
          const manifest = await documentsApi.getDossierArchive(latestSummary.id, signal)
          setDossierArchive(manifest)
          return manifest
        }
      } catch {
        // Dossier endpoint may not be active on older backends; silently ignore
      }
      return null
    },
    [detail.id],
  )

  useEffect(() => {
    const controller = new AbortController()
    void loadLatestDossier(controller.signal)
    return () => {
      controller.abort()
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [loadLatestDossier])

  // Polling management for active dossier archives
  useEffect(() => {
    if (!dossierArchive) {
      setIsPollingDossier(false)
      return
    }

    const isIntakePending = ['queued', 'validating', 'registering'].includes(
      dossierArchive.intake_state,
    )
    const isProcessingPending = ['waiting', 'processing'].includes(dossierArchive.processing_state)
    const needsPolling =
      dossierArchive.intake_state !== 'rejected' && (isIntakePending || isProcessingPending)

    if (!needsPolling) {
      setIsPollingDossier(false)
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      return
    }

    setIsPollingDossier(true)
    if (pollingRef.current) clearInterval(pollingRef.current)

    pollingRef.current = setInterval(() => {
      void documentsApi
        .getDossierArchive(dossierArchive.id)
        .then((updated) => {
          setDossierArchive(updated)
          const isFinished =
            updated.intake_state === 'rejected' ||
            ['finished', 'finished_with_errors'].includes(updated.processing_state)
          if (isFinished) {
            setIsPollingDossier(false)
            if (pollingRef.current) {
              clearInterval(pollingRef.current)
              pollingRef.current = null
            }
            reload()
          }
        })
        .catch(() => {
          // Keep polling on transient transport error
        })
    }, 2500)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [dossierArchive?.id, dossierArchive?.intake_state, dossierArchive?.processing_state, reload])

  // Merge canonical documents with dossier members for unified 60-file library
  const allDocuments = useMemo(() => {
    if (detail.documents === undefined) return undefined

    const existingDocs = [...detail.documents]
    if (!dossierArchive || !dossierArchive.members || dossierArchive.members.length === 0) {
      return existingDocs
    }

    const docMap = new Map<string, Document>()
    for (const d of existingDocs) {
      docMap.set(d.id, d)
    }

    for (const member of dossierArchive.members) {
      if (member.document_id) {
        const existing = docMap.get(member.document_id)
        if (existing) {
          docMap.set(member.document_id, {
            ...existing,
            name: existing.name ?? member.entry_path,
            dossier_member_id: member.id,
            dossier_intake_state: member.intake_state,
            dossier_processing_state: member.processing_state,
            dossier_source_url: member.source_url,
            dossier_error_code: member.error_code,
          } as unknown as Document)
        } else {
          docMap.set(member.document_id, {
            id: member.document_id,
            lineage: member.document_id,
            version: 1,
            hash: member.sha256 ?? '',
            pages: member.page_count ?? 1,
            owner_party_ref: detail.counterparty_id,
            type: member.suggested_type,
            status:
              member.processing_state === 'completed_with_usable_data' ||
              member.processing_state === 'completed_zero_usable'
                ? 'completed'
                : member.processing_state === 'failed'
                  ? 'failed'
                  : member.processing_state === 'needs_review'
                    ? 'needs_review'
                    : 'processing',
            source: null,
            classification: null,
            name: member.entry_path,
            period_suggestion: member.period_suggestion,
            dossier_member_id: member.id,
            dossier_intake_state: member.intake_state,
            dossier_processing_state: member.processing_state,
            dossier_source_url: member.source_url,
            dossier_error_code: member.error_code,
          } as unknown as Document)
        }
      } else {
        // Retained >10-page document or rejected entry without canonical document_id
        const syntheticId = `dossier-member-${member.id}`
        docMap.set(syntheticId, {
          id: syntheticId,
          lineage: member.id,
          version: 1,
          hash: member.sha256 ?? '',
          pages: member.page_count ?? 0,
          owner_party_ref: detail.counterparty_id,
          type: member.suggested_type ?? 'other',
          status:
            member.intake_state === 'needs_review'
              ? 'needs_review'
              : member.intake_state === 'rejected'
                ? 'rejected'
                : member.intake_state,
          source: null,
          classification: null,
          name: member.entry_path,
          period_suggestion: member.period_suggestion,
          dossier_member_id: member.id,
          dossier_intake_state: member.intake_state,
          dossier_processing_state: member.processing_state,
          dossier_source_url: member.source_url,
          dossier_error_code: member.error_code,
        } as unknown as Document)
      }
    }

    return Array.from(docMap.values())
  }, [detail.documents, detail.counterparty_id, dossierArchive])

  const hasDocs = !!(allDocuments && allDocuments.length > 0)

  const handleDossierAccepted = useCallback((accepted: DossierAccepted) => {
    void documentsApi
      .getDossierArchive(accepted.archive_id)
      .then(setDossierArchive)
      .catch(() => {
        setDossierArchive({
          id: accepted.archive_id,
          case_id: accepted.case_id,
          archive_sha256: accepted.archive_sha256,
          intake_state: 'queued',
          processing_state: 'waiting',
          created_at: new Date().toISOString(),
          counters: {
            discovered: 0,
            registered: 0,
            rejected: 0,
            awaiting_inspection: 0,
            queued: 0,
            running: 0,
            completed_with_usable_data: 0,
            completed_zero_usable: 0,
            failed: 0,
            needs_review: 0,
          },
          error_code: null,
          members: [],
        })
      })
  }, [])

  return (
    <>
      <SectionHeading title={t('files')} help={t('uploadHelp')}>
        {hasDocs && viewMode === 'command_center' && (
          <button
            className="secondary-button"
            onClick={() => handleOpenExplorer(false)}
            title={t('openExplorer')}
          >
            <FolderOpen size={15} />
            <span>
              {t('explorer')} ({allDocuments!.length})
            </span>
          </button>
        )}
        <button className="primary-button" onClick={() => setUpload(true)}>
          <Upload size={16} />
          {t('upload')}
        </button>
      </SectionHeading>
      {dossierArchive && (
        <DossierArchiveBanner
          archive={dossierArchive}
          isPolling={isPollingDossier}
          onRefresh={() => void loadLatestDossier()}
          onClose={() => setDossierArchive(null)}
        />
      )}
      {archiveReceipt && (
        <ArchiveReceiptBanner receipt={archiveReceipt} onClose={() => setArchiveReceipt(null)} />
      )}
      {allDocuments === undefined ? (
        <div className="panel">
          <p className="aic-section">{t('integrationPending')}</p>
        </div>
      ) : allDocuments.length === 0 ? (
        <div className="panel">
          <Empty />
        </div>
      ) : viewMode === 'command_center' ? (
        <>
          <DocumentSummaryCard summary={computeIngestionSummary(allDocuments)} />
          <DocumentWorkQueue
            documents={allDocuments}
            openSource={openSource}
            onInspect={setInspect}
            onClassify={setManual}
            onOpenExplorer={handleOpenExplorer}
          />
        </>
      ) : (
        <DocumentExplorer
          documents={allDocuments}
          initialActionRequired={explorerInitialActionRequired}
          onBack={() => setViewMode('command_center')}
          openSource={openSource}
          onInspect={setInspect}
          onClassify={setManual}
        />
      )}
      {detail.jobs?.length ? (
        <section className="panel aic-section">
          <h3>{t('status')}</h3>
          {detail.jobs.map((job) => (
            <div className="aic-job" key={job.id}>
              <span className="mono">{job.id}</span>
              <Status value={job.state} />
              {job.errors?.map((e, i) => (
                <p className="form-error" key={i}>
                  {e.message ?? e.code}
                </p>
              ))}
              {job.state === 'failed' && (
                <button
                  className="secondary-button"
                  disabled={!job.retryable || retryId !== null}
                  onClick={() => setRetryId(job.id)}
                >
                  {t('retry')}
                </button>
              )}
            </div>
          ))}
        </section>
      ) : null}
      {retryId && (
        <ActionDialog
          title={t('retry')}
          loadLatest={() => casesApi.detail(detail.id)}
          revision={detail.revision}
          onClose={() => setRetryId(null)}
          onSaved={reload}
          submit={(reason, revision, keys) =>
            documentsApi.retry(retryId, { expected_revision: revision, reason }, keys)
          }
        />
      )}
      {upload && (
        <UploadDialog
          detail={detail}
          onClose={() => setUpload(false)}
          onSaved={reload}
          onArchiveSaved={setArchiveReceipt}
          onDossierAccepted={handleDossierAccepted}
        />
      )}{' '}
      {inspect && (
        <ExtractionDialog
          document={inspect}
          detail={detail}
          openSource={openSource}
          onClose={() => setInspect(null)}
          reload={reload}
        />
      )}{' '}
      {manual && (
        <DocumentClassification
          document={manual}
          detail={detail}
          onClose={() => setManual(null)}
          onSaved={reload}
        />
      )}
    </>
  )
}
