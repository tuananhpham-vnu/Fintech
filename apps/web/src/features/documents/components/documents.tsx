'use client'
import { Empty } from '@/components/feedback/empty'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { ApiError } from '@/lib/api/client'
import { TechnicalDetails } from '@/components/ui/technical-details'
import { localizeBlocker } from '@/lib/i18n/review-i18n'
import { SectionHeading } from '@/components/ui/section-heading'
import { Status } from '@/components/ui/status'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { casesApi } from '@/features/cases/api'
import { documentsApi } from '@/features/documents/api'
import { ExtractionDialog } from '@/features/documents/components/extraction-review'
import { UploadDialog } from '@/features/documents/components/upload-dialog'
import { FinancialImport } from '@/features/financial/components/financial-import'
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
  openFinancial,
}: {
  detail: CaseDetail
  reload: () => void
  openSource: (target: SourceTarget) => void
  openFinancial: () => void
}) {
  const { t, locale } = useLocale(),
    [upload, setUpload] = useState(false),
    [inspect, setInspect] = useState<Document | null>(null),
    [manual, setManual] = useState<Document | null>(null),
    [retryId, setRetryId] = useState<string | null>(null),
    [archiveReceipt, setArchiveReceipt] = useState<ArchiveReceipt | null>(null),
    [dossierArchive, setDossierArchive] = useState<DossierArchive | null>(null),
    [isPollingDossier, setIsPollingDossier] = useState(false),
    [viewMode, setViewMode] = useState<'command_center' | 'explorer'>('command_center'),
    [explorerInitialActionRequired, setExplorerInitialActionRequired] = useState(false)
  const [dossierError, setDossierError] = useState<unknown>(null)
  const [financialImport, setFinancialImport] = useState(false)

  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  const handleOpenExplorer = (actionRequiredOnly = false) => {
    setExplorerInitialActionRequired(actionRequiredOnly)
    setViewMode('explorer')
  }

  // Load latest dossier archive on mount or case switch
  const loadLatestDossier = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setDossierError(null)
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
        if (!signal?.aborted) setDossierArchive(null)
      } catch (error) {
        if (signal?.aborted) return null
        if (!(error instanceof ApiError && error.status === 404)) setDossierError(error)
      }
      return null
    },
    [detail.id],
  )

  useEffect(() => {
    const controller = new AbortController()
    setDossierArchive(null)
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
          setDossierError(null)
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
        .catch((error) => {
          setDossierError(error)
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
        <button className="secondary-button" onClick={() => setFinancialImport(true)}>
          {locale === 'vi'
            ? 'Đọc BCTC Việt / Mỹ / Trung'
            : locale === 'en'
              ? 'Read VN / US / CN statements'
              : '读取越 / 美 / 中财报'}
        </button>
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
      {financialImport && (
        <FinancialImport
          detail={detail}
          onSaved={reload}
          onClose={() => {
            setFinancialImport(false)
            reload()
          }}
        />
      )}
      <section className="panel aic-section">
        <h3>
          {locale === 'vi'
            ? 'Từ tài liệu đến dữ kiện tài chính'
            : locale === 'en'
              ? 'From documents to financial facts'
              : '从文件到财务事实'}
        </h3>
        <ol>
          <li>
            {locale === 'vi'
              ? 'Kiểm đúng doanh nghiệp, loại tài liệu và phiên bản PDF.'
              : locale === 'en'
                ? 'Confirm company, document type and exact PDF version.'
                : '确认主体、文件类别及准确PDF版本。'}
          </li>
          <li>
            {locale === 'vi'
              ? 'Đối chiếu và sửa từng trường với trang nguồn. Trường đọc được chưa phải dữ kiện đã xác minh.'
              : locale === 'en'
                ? 'Review and correct each field against its source page. Readable does not mean verified.'
                : '逐项对照来源页并更正。可读不等于已核实。'}
          </li>
          <li>
            {locale === 'vi'
              ? 'Lập bộ BCTC đúng kỳ, cơ sở và đơn vị; chọn trích dẫn cho từng chỉ tiêu. Không tự ghép cột nhiều năm.'
              : locale === 'en'
                ? 'Create a statement set for the correct period, basis and units, selecting evidence per fact. Multi-year columns are never automatically combined.'
                : '按正确期间、口径和单位建立报表集，逐项选引用。不会自动合并多年列。'}
          </li>
          <li>
            {locale === 'vi'
              ? 'Xác minh dữ kiện và từng cầu nối trước khi đánh giá.'
              : locale === 'en'
                ? 'Verify facts and each bridge before assessment.'
                : '评估前核实事实及各项衔接。'}
          </li>
        </ol>
        <button className="secondary-button" onClick={openFinancial}>
          {locale === 'vi'
            ? 'Mở bộ BCTC và dữ kiện'
            : locale === 'en'
              ? 'Open statement sets and facts'
              : '打开报表集与事实'}
        </button>
      </section>
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
          <h3>
            {locale === 'vi'
              ? 'Nhật ký xử lý tài liệu'
              : locale === 'en'
                ? 'Document processing history'
                : '文件处理历史'}
          </h3>
          <p className="help-text">
            {locale === 'vi'
              ? 'Lỗi của lần xử lý cũ được giữ để truy vết. Trạng thái nguồn hiện hành nằm trên từng tài liệu; hoàn tất xử lý không xác minh dữ kiện hoặc phát điểm.'
              : locale === 'en'
                ? 'Earlier failures remain for traceability. Current source status is shown on each document; processing completion does not verify facts or publish a score.'
                : '保留旧失败供追溯。当前来源状态见各文件；处理完成不代表核实事实或发布分数。'}
          </p>
          {detail.jobs.map((job, index) => (
            <div className="aic-job" key={job.id}>
              <strong>
                {locale === 'vi' ? 'Lần xử lý' : locale === 'en' ? 'Processing run' : '处理记录'} ·{' '}
                {index + 1}
              </strong>
              <Status value={job.state} />
              <TechnicalDetails>
                <code>{job.id}</code>
              </TechnicalDetails>
              {job.errors?.map((e, i) => (
                <p className="form-error" key={i}>
                  {localizeBlocker(e, locale)}
                </p>
              ))}
              {job.state === 'failed' && (
                <>
                  <button
                    className="secondary-button"
                    disabled={!job.retryable || retryId !== null}
                    onClick={() => setRetryId(job.id)}
                  >
                    {t('retry')}
                  </button>
                  {!job.retryable && (
                    <p className="help-text">
                      {locale === 'vi'
                        ? 'Lần xử lý này không được phép thử lại. Kiểm tra nguồn hiện hành; nếu cần, tải bản thay thế hoặc liên hệ người quản lý hồ sơ.'
                        : locale === 'en'
                          ? 'This processing run cannot be retried. Check the current source; upload a replacement or contact the case owner if needed.'
                          : '此记录不能重试。请核对当前来源，必要时上传替代版本或联系档案负责人。'}
                    </p>
                  )}
                </>
              )}
            </div>
          ))}
        </section>
      ) : null}
      <ErrorNotice error={dossierError} retry={() => void loadLatestDossier()} />
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
          openSource={openSource}
          document={manual}
          detail={detail}
          onClose={() => setManual(null)}
          onSaved={reload}
        />
      )}
    </>
  )
}
