'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Modal } from '@/components/ui/modal'
import { useMutation } from '@/hooks/use-mutation'
import { useResource } from '@/hooks/use-resource'
import { useLocale } from '@/lib/i18n/locale-provider'
import type { Locale } from '@/lib/api/contracts'
import { companyHealthText } from '@/lib/i18n/company-health-copy'
import { financialLabel } from '../labels'
import { importApi } from '../import-api'
import {
  financialApi,
  factKeys,
  factKeysForCountry,
  type FinancialSet,
  type Registry,
} from '../api'
import { intakeApi, type IntakeItem, type IntakePage } from '../intake-api'
import {
  intakeProgress,
  pendingIntakes,
  reviewedFacts,
  intakeWarnings,
  intakeReviewMessage,
} from '../intake-model'
import { IntakePeriodReview } from './intake-period-review'
import { CalculationProposals } from './calculation-proposals'
import { PeriodSourceReview } from './period-source-review'

const getStates = (locale: Locale): Record<IntakeItem['state'], string> => ({
  queued: locale === 'vi' ? 'Đang chờ' : locale === 'zh-CN' ? '排队中' : 'Queued',
  running: locale === 'vi' ? 'Đang trích xuất' : locale === 'zh-CN' ? '提取中' : 'Extracting',
  ready: locale === 'vi' ? 'Đã trích xuất' : locale === 'zh-CN' ? '已提取' : 'Extracted',
  needs_review: locale === 'vi' ? 'Cần rà soát' : locale === 'zh-CN' ? '待核查' : 'Needs review',
  failed: locale === 'vi' ? 'Xử lý thất bại' : locale === 'zh-CN' ? '处理失败' : 'Failed',
  duplicate:
    locale === 'vi' ? 'Trùng kỳ báo cáo' : locale === 'zh-CN' ? '报告期重复' : 'Duplicate period',
  skipped:
    locale === 'vi' ? 'Giữ bản trước' : locale === 'zh-CN' ? '保留上一版本' : 'Keep previous',
  expanded: locale === 'vi' ? 'Đã mở ZIP' : locale === 'zh-CN' ? '已解压ZIP' : 'Extracted ZIP',
})

const getErrors = (locale: Locale): Record<string, string> => ({
  AI_SPEND_BUDGET_EXHAUSTED:
    locale === 'vi'
      ? 'Đã chạm hạn mức chi phí AI. Kết quả đã có được giữ lại; chưa gửi thêm yêu cầu tính phí.'
      : 'AI spending ceiling reached. Existing results retained.',
  FINANCIAL_ENTITY_MISMATCH:
    locale === 'vi'
      ? 'BCTC không khớp tên doanh nghiệp trong hồ sơ. Hãy kiểm tra nguồn hoặc chọn đúng doanh nghiệp.'
      : 'The financial statement does not match the case company.',
  ACCOUNTING_PROFILE_NOT_SUPPORTED:
    locale === 'vi'
      ? 'Chuẩn kế toán hoặc ngành của báo cáo chưa thuộc phạm vi US GAAP/CAS phân phối, bán buôn được bật. Bản gốc được giữ để đối chiếu.'
      : 'The accounting standard or industry is outside the enabled US GAAP/CAS distribution pilot. The original is retained for review.',
  FINANCIAL_COUNTRY_MISMATCH:
    locale === 'vi'
      ? 'Quốc gia của BCTC không khớp doanh nghiệp trong hồ sơ.'
      : 'The statement country does not match the case company.',
  FINANCIAL_SCOPE_MISMATCH:
    locale === 'vi'
      ? 'Quốc gia, kỳ hoặc cơ sở hợp nhất/riêng lẻ không khớp phạm vi được chọn. Hãy đối chiếu bản gốc.'
      : 'Statement country, period or reporting basis does not match the selected scope.',
  NOT_FINANCIAL_STATEMENT:
    locale === 'vi'
      ? 'Đã phân loại: tài liệu ngoài phạm vi BCTC.'
      : locale === 'zh-CN'
        ? '已分类：文件超出财务报表范围。'
        : 'Classified: document is outside financial statement scope.',
  DOCUMENT_TYPE_UNRESOLVED:
    locale === 'vi'
      ? 'Chưa xác định được tài liệu có phải BCTC. Hãy đối chiếu bản gốc.'
      : locale === 'zh-CN'
        ? '未能确定文件是否为财务报表，请对照原始文件。'
        : 'Unresolved whether document is a financial statement. Compare with original.',
  HUMAN_PERIOD_REVIEWED:
    locale === 'vi'
      ? 'Đã lưu rà soát kỳ. Kiểm tra số liệu còn thiếu và xác nhận chung.'
      : locale === 'zh-CN'
        ? '报告期核查已保存。请检查缺失数据并进行统一确认。'
        : 'Period review saved. Check missing figures and confirm common review.',
  FINANCIAL_REPLACEMENT_INCOMPLETE:
    locale === 'vi'
      ? 'Bản thay thế chưa xử lý đủ các kỳ. Bản trước vẫn được giữ; hãy rà soát từng kỳ hoặc thử lại.'
      : locale === 'zh-CN'
        ? '替换版本尚未解决所有报告期。保留先前版本；请逐期核查或重试。'
        : 'Replacement statement has not resolved all periods. Previous version retained; review periods or retry.',
  FINANCIAL_PERIOD_SOURCE_SELECTION_REQUIRED:
    locale === 'vi'
      ? 'Có nguồn khác cho cùng kỳ. Hãy đối chiếu và chọn nguồn cho từng kỳ bên dưới.'
      : locale === 'zh-CN'
        ? '同一报告期有其他来源，请在下方逐期核对并选择。'
        : 'Another source exists for this period. Compare and choose each period below.',
  FINANCIAL_PERIOD_OR_FIELDS_UNRESOLVED:
    locale === 'vi'
      ? 'Chưa xác định đầy đủ kỳ hoặc số liệu. Hãy đối chiếu bản gốc.'
      : locale === 'zh-CN'
        ? '报告期或财务数据尚未完全解决，请对照原始文件。'
        : 'Periods or financial facts not fully resolved. Compare with original.',
  FINANCIAL_PROCESSING_UNAVAILABLE:
    locale === 'vi'
      ? 'Dịch vụ xử lý chưa sẵn sàng. Có thể thử lại.'
      : locale === 'zh-CN'
        ? '处理服务不可用，可重试。'
        : 'Processing service unavailable. You may retry.',
  PROVIDER_UNAVAILABLE:
    locale === 'vi'
      ? 'Dịch vụ AI chưa sẵn sàng.'
      : locale === 'zh-CN'
        ? 'AI 服务不可用。'
        : 'AI service unavailable.',
  INVALID_MODEL_OUTPUT:
    locale === 'vi'
      ? 'AI trả kết quả chưa đúng cấu trúc. Hãy rà soát theo bản gốc hoặc thử lại.'
      : locale === 'zh-CN'
        ? 'AI 返回结果结构不符合规范，请对照原始文件核查或重试。'
        : 'AI returned unstructured output. Review against original or retry.',
  MODEL_OUTPUT_BLOCKED:
    locale === 'vi'
      ? 'AI từ chối trả nội dung ở một số bước. Hãy mở bản gốc để rà soát kỳ và số liệu.'
      : locale === 'zh-CN'
        ? 'AI 在某些步骤被阻止输出，请打开原始文件核查报告期与数据。'
        : 'AI content blocked at some steps. Open original document to review periods and facts.',
  MODEL_OUTPUT_TRUNCATED:
    locale === 'vi'
      ? 'Kết quả AI bị ngắt vì giới hạn độ dài. Hãy rà soát theo bản gốc.'
      : locale === 'zh-CN'
        ? 'AI 输出因长度限制被截断，请对照原始文件核查。'
        : 'AI output truncated due to length limits. Review against original.',
  MODEL_OUTPUT_EMPTY:
    locale === 'vi'
      ? 'AI chưa trả nội dung. Hãy rà soát theo bản gốc hoặc thử lại.'
      : locale === 'zh-CN'
        ? 'AI 未返回内容，请对照原始文件核查或重试。'
        : 'AI returned empty output. Review against original or retry.',
  PDF_NO_TEXT:
    locale === 'vi'
      ? 'Chưa đọc được chữ trong tài liệu.'
      : locale === 'zh-CN'
        ? '未能读取文件中的文本。'
        : 'Unable to read text from document.',
  PROCESSING_ATTEMPTS_EXHAUSTED:
    locale === 'vi'
      ? 'Đã hết lượt xử lý tự động. Hãy kiểm tra và tải lại bản rõ hơn.'
      : locale === 'zh-CN'
        ? '已用完自动处理尝试次数，请检查并重新上传更清晰的版本。'
        : 'Automatic processing attempts exhausted. Check and re-upload a clearer version.',
})

export function IntakeItemProgress({
  createdAt,
  state,
  locale,
}: {
  createdAt: string
  state: string
  locale: Locale
}) {
  const sinceUpload = () => {
    const start = Date.parse(createdAt)
    return Number.isFinite(start) ? Math.max(0, Math.floor((Date.now() - start) / 1000)) : 0
  }
  const [elapsed, setElapsed] = useState(sinceUpload)
  useEffect(() => {
    setElapsed(sinceUpload())
    if (state !== 'running' && state !== 'queued') return
    const timer = setInterval(() => setElapsed(sinceUpload()), 1000)
    return () => clearInterval(timer)
  }, [createdAt, state])
  const queued = state === 'queued'
  const text =
    locale === 'vi'
      ? queued
        ? 'Đang xếp hàng chờ xử lý…'
        : 'Đang xử lý tài liệu…'
      : locale === 'zh-CN'
        ? queued
          ? '正在排队等待处理…'
          : '正在处理文件…'
        : queued
          ? 'Queued for processing…'
          : 'Processing document…'
  const time =
    locale === 'vi'
      ? 'Giây kể từ khi tải lên'
      : locale === 'zh-CN'
        ? '上传后秒数'
        : 'Seconds since upload'
  return (
    <div className="compact-progress-box" role="status">
      <span className={queued ? 'status-msg waiting' : 'status-msg running'}>
        <span className="mini-spin" aria-hidden="true" />
        {text}
      </span>
      <small>
        {time}: {elapsed}
      </small>
    </div>
  )
}

export function FinancialIntake({
  industry,
  caseId,
  page,
  registry,
  reload,
  onPreview,
}: {
  industry: string
  caseId: string
  page: IntakePage
  registry: Registry | null
  reload: () => void
  onPreview: (item: IntakeItem) => void
}) {
  const { locale } = useLocale(),
    copy = (key: Parameters<typeof companyHealthText>[1]) => companyHealthText(locale, key),
    states = getStates(locale),
    errors = getErrors(locale),
    action = useMutation(),
    input = useRef<HTMLInputElement>(null),
    [reviewing, setReviewing] = useState(false),
    [checked, setChecked] = useState(false),
    [bridges, setBridges] = useState(false),
    [profitReconciled, setProfitReconciled] = useState(false),
    [roundingReviewed, setRoundingReviewed] = useState(false),
    [assessmentBasis, setAssessmentBasis] = useState(''),
    [expenseSignReviewed, setExpenseSignReviewed] = useState(false),
    [year, setYear] = useState('all'),
    [periodReview, setPeriodReview] = useState<IntakeItem | null>(null),
    [excluding, setExcluding] = useState<IntakeItem | null>(null),
    [excludeReason, setExcludeReason] = useState('')
  const loadExisting = useCallback(
    (signal: AbortSignal) => importApi.sources(caseId, signal),
    [caseId, page.revision],
  )
  const existing = useResource(loadExisting, true, 0, caseId)
  const progress = intakeProgress(page.items),
    pending = pendingIntakes(page.items).filter(
      (i) => !(page.review.confirmed && i.state === 'needs_review'),
    )
  const chooseBasis =
    page.capabilities?.country !== undefined &&
    page.capabilities.country !== 'VN' &&
    new Set(registry?.sets.filter((s) => s.facts.length).map((s) => s.scope.basis)).size > 1
  const library = page.items.filter((i) => !pending.some((p) => p.id === i.id))
  const confirmButton = (
    <button
      className="primary-button"
      disabled={
        action.busy ||
        progress.active ||
        !!page.review.unresolved_count ||
        page.items.some((i) => i.state === 'duplicate') ||
        !registry?.sets.length
      }
      onClick={() => {
        setChecked(false)
        setBridges(false)
        setReviewing(true)
      }}
    >
      {copy(page.review.confirmed ? 'confirmAgainButton' : 'confirmAllButton')}
    </button>
  )
  const years = [
    ...new Set(
      page.items.flatMap((i) => i.classification?.periods.map((p) => p.end_date.slice(0, 4)) ?? []),
    ),
  ]
    .sort()
    .reverse()
  function upload(files: FileList | null) {
    if (!files?.length) return
    const chosen = Array.from(files)
    void action.run(async (keys) => {
      let revision = page.revision
      for (const file of chosen) {
        // Polling workers can advance the case while a batch is being submitted.
        revision = (await intakeApi.list(caseId)).revision
        const result = await intakeApi.upload(caseId, file, revision, keys)
        revision = result.revision
        keys.clear()
        reload()
      }
    }, reload)
  }
  const unprocessed =
    existing.data?.sources.filter(
      (s) => !page.items.some((i) => i.sha256 === s.sha256 || i.prepared_source_id === s.id),
    ) ?? []
  return (
    <div className="financial-intake">
      <div className="aic-list-heading financial-intake-heading">
        <div>
          <h2>
            <svg
              className="section-title-icon"
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            {copy('intakeDocHeading')}
          </h2>
          <p className="muted financial-intake-desc">
            {copy('intakeDocDesc')}
            <span className="ai-smart-tag">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              {copy('intakeAiBadge')}
            </span>
          </p>
        </div>
        <div className="wrap-actions">
          <button
            className="primary-button prominent-upload-btn"
            disabled={action.busy}
            onClick={() => input.current?.click()}
          >
            {action.busy ? copy('uploading') : copy('btnSelectDocument')}
          </button>
          {confirmButton}
          <label className="financial-country-label">
            {copy('countryLabel')}{' '}
            <select
              aria-label={copy('countrySelectLabel')}
              value={page.capabilities?.country ?? 'VN'}
              disabled
            >
              <option value="VN">{copy('countryVn')}</option>
              <option value="US">
                {locale === 'vi'
                  ? 'Mỹ · US GAAP'
                  : locale === 'zh-CN'
                    ? '美国 · US GAAP'
                    : 'United States · US GAAP'}
              </option>
              <option value="CN">
                {locale === 'vi'
                  ? 'Trung Quốc · CAS'
                  : locale === 'zh-CN'
                    ? '中国 · CAS'
                    : 'China · CAS'}
              </option>
            </select>
          </label>
          {page.capabilities &&
            !page.capabilities.countries.includes(
              page.capabilities.country as 'VN' | 'US' | 'CN',
            ) && (
              <span role="status">
                {locale === 'vi'
                  ? 'Quốc gia này chưa được bật nhập và chấm điểm.'
                  : 'Financial intake is not enabled for this country.'}
              </span>
            )}
        </div>
      </div>
      <div
        className={`financial-dropzone ${action.busy ? 'busy' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          if (!action.busy) upload(e.dataTransfer.files)
        }}
      >
        <input
          ref={input}
          type="file"
          multiple
          accept=".pdf,.xls,.xlsx,.jpg,.jpeg,.png,.zip"
          hidden
          onChange={(e) => {
            upload(e.target.files)
            e.target.value = ''
          }}
        />
        <strong>{copy('dropzonePrompt')}</strong>
        <p>{copy('dropzoneFormats')}</p>
      </div>
      <ErrorNotice error={action.error} />
      <section className="financial-progress financial-batch-card" aria-live="polite">
        <div className="aic-list-heading">
          <strong>{copy('batchProgressTitle')}</strong>
          <span className="batch-progress-percent">
            {progress.completed}/{progress.total} {copy('batchProcessedSuffix')} ({progress.percent}
            %)
          </span>
        </div>
        <div className="batch-progress-track">
          <div className="batch-progress-bar" style={{ width: `${progress.percent}%` }} />
        </div>
        <progress
          className="sr-only"
          aria-label={copy('extractProgressLabel')}
          value={progress.completed}
          max={progress.total || 1}
        />
        <p className="batch-progress-meta">
          <span className="batch-meta-tag success">
            {progress.success} {copy('batchSuccessSuffix')}
          </span>
          <span className="batch-meta-sep">·</span>
          <span className="batch-meta-tag failed">
            {progress.failed} {copy('batchFailedSuffix')}
          </span>
          <span className="batch-meta-sep">·</span>
          <span className="batch-meta-tag review">
            {
              page.items.filter(
                (i) => i.state === 'needs_review' && i.classification?.document_type !== 'other',
              ).length
            }{' '}
            {copy('batchReviewSuffix')}
          </span>
          <span className="batch-meta-sep">·</span>
          <span className="batch-meta-tag other">
            {page.items.filter((i) => i.classification?.document_type === 'other').length}{' '}
            {copy('batchOtherSuffix')}
          </span>
          {progress.active ? (
            <>
              <span className="batch-meta-sep">·</span>
              <span className="batch-meta-tag active">
                <span className="mini-spin" /> {copy('batchProcessing')}
              </span>
            </>
          ) : null}
        </p>
      </section>
      <div className={`financial-confirm-bar ${page.review.confirmed ? 'confirmed' : ''}`}>
        <div>
          <strong>
            {page.review.confirmed
              ? copy('confirmedAllStatus')
              : page.review.stale
                ? copy('confirmBarReviewStale')
                : copy('reviewUnconfirmed')}
          </strong>
          <p>{copy('confirmBarHelp')}</p>
        </div>
        {!!page.review.unresolved_count && (
          <p>
            {copy('unresolvedPrefix')} {page.review.unresolved_count} {copy('unresolvedSuffix')}
          </p>
        )}
      </div>
      {unprocessed.length > 0 && (
        <details>
          <summary>
            {copy('unprocessedTitle')} ({unprocessed.length})
          </summary>
          <p>{copy('unprocessedHelp')}</p>
          {unprocessed.map((s) => (
            <div className="financial-file-row" key={s.id}>
              <span>{s.name}</span>
              <button
                className="secondary-button"
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    (keys) => intakeApi.existing(caseId, s, page.revision, keys),
                    reload,
                  )
                }
              >
                {copy('btnExtractBctc')}
              </button>
            </div>
          ))}
        </details>
      )}
      <section className="panel aic-section">
        <div className="compact-queue-header">
          <h3>
            {copy('queueTitle')} ({pending.length})
          </h3>
          {progress.active && (
            <span className="compact-auto-refresh">
              <span className="mini-spin" /> {copy('queueAutoRefresh')}
            </span>
          )}
        </div>
        {!pending.length && <p className="muted">{copy('queueEmpty')}</p>}
        {pending.length > 0 && (
          <div className="compact-queue-table">
            {pending.map((i) => {
              const warnings = intakeWarnings(i)
              const target = page.items.find((s) => s.id === i.duplicate_of)
              const identical = i.state === 'duplicate' && !!target && target.sha256 === i.sha256
              const needsChoice = i.origin.period_candidates?.some((c) => c.status === 'pending')
              return (
                <div key={i.id} className={`financial-file-row compact-file-row status-${i.state}`}>
                  <div className="compact-file-col">
                    <div className={`compact-file-icon status-${i.state}`} aria-hidden="true">
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        stroke="currentColor"
                        fill="none"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                    </div>
                    <div className="compact-file-info">
                      <strong className="compact-file-name" title={i.name}>
                        {i.name}
                      </strong>
                      <div className="compact-file-sub">
                        <span className={`compact-badge status-${i.state}`}>
                          {i.state === 'duplicate'
                            ? copy(identical ? 'duplicateFileBadge' : 'overlapPeriodBadge')
                            : states[i.state]}
                        </span>
                        {i.classification?.page_count ? (
                          <span className="compact-meta-item">
                            · {i.classification.page_count} {copy('pagesSuffix')}
                          </span>
                        ) : null}
                        {i.attempts > 1 ? (
                          <span className="compact-meta-item">
                            · {copy('attemptPrefix')} {i.attempts}/3
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="compact-progress-col">
                    {['queued', 'running'].includes(i.state) ? (
                      <IntakeItemProgress
                        createdAt={i.created_at}
                        state={i.state}
                        locale={locale}
                      />
                    ) : (
                      <div className="compact-progress-box">
                        <div className="compact-progress-status">
                          <span className={`status-msg status-${i.state}`}>
                            {i.state === 'needs_review' && (
                              <span className="status-bullet warn">⚠</span>
                            )}
                            {i.state === 'failed' && <span className="status-bullet err">✕</span>}
                            {i.state === 'duplicate' && (
                              <span className="status-bullet dup">ℹ</span>
                            )}
                            {i.state === 'ready' && <span className="status-bullet ok">✓</span>}
                            <span className="status-desc">
                              {intakeReviewMessage(i, locale, registry?.sets) ??
                                (i.error_code
                                  ? (errors[i.error_code] ?? copy('defaultErrorDesc'))
                                  : i.state === 'needs_review'
                                    ? copy('needsReviewDefaultDesc')
                                    : i.state === 'duplicate'
                                      ? copy(
                                          identical ? 'duplicateFileNotice' : 'overlapPeriodNotice',
                                        )
                                      : i.state === 'failed'
                                        ? copy('failedDefaultDesc')
                                        : states[i.state])}
                            </span>
                          </span>
                          <span className={`percent-text status-${i.state}`}>
                            {i.state === 'needs_review'
                              ? copy('statusBadgeNeedsReview')
                              : i.state === 'duplicate'
                                ? copy(identical ? 'duplicateFileBadge' : 'overlapPeriodBadge')
                                : i.state === 'failed'
                                  ? copy('statusBadgeFailed')
                                  : copy('statusBadgeReady')}
                          </span>
                        </div>
                        <div className="compact-progress-track">
                          <div
                            className={`compact-progress-bar status-${i.state}`}
                            style={{ width: '100%' }}
                          />
                        </div>
                      </div>
                    )}
                    {warnings.length > 0 && (
                      <div className="compact-warning-list">
                        {warnings.map((w) => (
                          <div className="compact-warning-pill" key={w} title={w}>
                            ⚠ {w}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="wrap-actions compact-actions-col">
                    {i.prepared_source_id &&
                      !['queued', 'running', 'duplicate'].includes(i.state) &&
                      !needsChoice && (
                        <button
                          className="secondary-button compact-btn-review"
                          disabled={action.busy}
                          onClick={() => setPeriodReview(i)}
                        >
                          {copy('btnReviewPeriod')}
                        </button>
                      )}
                    <button className="text-button compact-btn-open" onClick={() => onPreview(i)}>
                      {copy('btnOpenDoc')}
                    </button>
                    {['failed', 'needs_review'].includes(i.state) &&
                      i.attempts < 3 &&
                      !needsChoice && (
                        <button
                          className="secondary-button compact-btn-retry"
                          disabled={action.busy}
                          onClick={() =>
                            void action.run(
                              (keys) =>
                                intakeApi.decide(caseId, i.id, 'retry', page.revision, keys),
                              reload,
                            )
                          }
                        >
                          {copy('btnRetry')}
                        </button>
                      )}
                    {!['queued', 'running'].includes(i.state) && !i.statements.length && (
                      <button
                        className="text-button compact-btn-exclude"
                        disabled={action.busy}
                        onClick={() => {
                          setExcluding(i)
                          setExcludeReason('')
                        }}
                      >
                        {copy('btnExclude')}
                      </button>
                    )}
                    {['queued', 'running'].includes(i.state) && (
                      <span className="compact-processing-badge">
                        <span className="mini-spin" />
                        {copy('batchProcessing')}
                      </span>
                    )}
                    {i.state === 'duplicate' && (
                      <>
                        <button
                          className="secondary-button"
                          disabled={action.busy}
                          onClick={() =>
                            void action.run(
                              (keys) =>
                                intakeApi.decide(
                                  caseId,
                                  i.id,
                                  'keep_existing',
                                  page.revision,
                                  keys,
                                ),
                              reload,
                            )
                          }
                        >
                          {copy('btnKeepExisting')}
                        </button>
                        {!identical && (
                          <button
                            className="primary-button"
                            disabled={action.busy}
                            onClick={() =>
                              void action.run(
                                (keys) =>
                                  intakeApi.decide(
                                    caseId,
                                    i.id,
                                    'compare_periods',
                                    page.revision,
                                    keys,
                                  ),
                                reload,
                              )
                            }
                          >
                            {copy('comparePeriodsButton')}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
      {page.items.flatMap((item) =>
        (item.origin.period_candidates ?? [])
          .filter(
            (candidate) =>
              candidate.status === 'pending' && !item.superseded_by && !item.origin.exclusion,
          )
          .map((candidate) => (
            <PeriodSourceReview
              key={candidate.receipt_id}
              item={item}
              candidate={candidate}
              items={page.items}
              sets={registry?.sets ?? []}
              caseId={caseId}
              revision={page.revision}
              reload={reload}
              onPreview={onPreview}
            />
          )),
      )}
      <section className="panel aic-section">
        <div className="aic-list-heading">
          <h3>
            {copy('libraryHeading')} ({library.length})
          </h3>
          <select aria-label="Năm tài liệu" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="all">{copy('allYears')}</option>
            <option value="unknown">{copy('unknownYear')}</option>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </div>
        {library
          .filter(
            (i) =>
              year === 'all' ||
              (year === 'unknown'
                ? !i.classification?.periods.length
                : i.classification?.periods.some((p) => p.end_date.startsWith(year))),
          )
          .map((i) => (
            <div className="financial-file-row" key={i.id}>
              <div>
                <button className="text-button" onClick={() => onPreview(i)}>
                  {i.name}
                </button>
                {i.classification && (
                  <p>
                    {copy('recognizedEntity')}: {i.classification.entity_name ?? 'N/A'} ·{' '}
                    {copy('taxId')}: {i.classification.tax_id ?? 'N/A'}
                  </p>
                )}
                <p>
                  {i.classification?.periods
                    .map(
                      (p) =>
                        `${p.end_date} · ${p.basis === 'consolidated' ? copy('consolidated') : copy('standalone')}`,
                    )
                    .join(' / ') || copy('yearNa')}
                </p>
                {!!i.origin.rejected?.length && (
                  <p className="warning-banner">
                    {copy('zipRejectedPrefix')} {i.origin.rejected.length}{' '}
                    {copy('zipRejectedSuffix')} {i.origin.rejected.map((e) => e.name).join(', ')}
                  </p>
                )}
              </div>
              <span className="tag">
                {i.superseded_by
                  ? copy('statusSuperseded')
                  : i.state === 'needs_review' && page.review.confirmed
                    ? copy('statusReviewedIncomplete')
                    : i.classification?.document_type === 'other'
                      ? copy('statusOtherDoc')
                      : i.origin.exclusion
                        ? copy('statusExcluded')
                        : states[i.state]}
              </span>
              {i.state === 'skipped' &&
                !i.origin.exclusion &&
                i.attempts < 3 &&
                (i.origin.duplicate_sets?.length ||
                  page.items.some((t) => t.id === i.duplicate_of && t.sha256 !== i.sha256)) && (
                  <button
                    className="secondary-button"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(
                        (keys) =>
                          intakeApi.decide(caseId, i.id, 'compare_periods', page.revision, keys),
                        reload,
                      )
                    }
                  >
                    {copy('comparePeriodsButton')}
                  </button>
                )}
              {i.prepared_source_id &&
                !i.superseded_by &&
                !i.origin.exclusion &&
                i.state !== 'expanded' &&
                (i.state !== 'skipped' || i.classification?.document_type === 'other') && (
                  <button
                    className="secondary-button"
                    disabled={action.busy}
                    onClick={() => setPeriodReview(i)}
                  >
                    {copy('btnReviewPeriod')}
                  </button>
                )}
            </div>
          ))}
      </section>
      {periodReview && (
        <IntakePeriodReview
          item={periodReview}
          predecessors={
            page.items.find((i) => i.id === periodReview.replacement_of)?.statements ?? []
          }
          caseId={caseId}
          industry={industry}
          country={page.capabilities?.country ?? 'VN'}
          revision={page.revision}
          sets={registry?.sets ?? []}
          onClose={() => setPeriodReview(null)}
          onPreview={() => onPreview(periodReview)}
          onSaved={() => {
            setPeriodReview(null)
            reload()
          }}
        />
      )}
      {excluding && (
        <Modal
          title={copy('modalExcludeTitle')}
          onClose={() => setExcluding(null)}
          busy={action.busy}
        >
          <p>
            {excluding.name}. {copy('modalExcludeSub')}
          </p>
          <label className="field-label">
            {copy('modalExcludeReason')}
            <textarea
              required
              maxLength={2000}
              value={excludeReason}
              onChange={(e) => setExcludeReason(e.target.value)}
            />
          </label>
          <ErrorNotice error={action.error} />
          <button
            className="primary-button"
            disabled={!excludeReason.trim() || action.busy}
            onClick={() =>
              void action.run(
                (keys) =>
                  intakeApi.decide(
                    caseId,
                    excluding.id,
                    'exclude',
                    page.revision,
                    keys,
                    excludeReason.trim(),
                  ),
                () => {
                  setExcluding(null)
                  reload()
                },
              )
            }
          >
            {copy('modalExcludeSave')}
          </button>
        </Modal>
      )}
      {reviewing && (
        <Modal
          title={copy('modalConfirmTitle')}
          onClose={() => setReviewing(false)}
          busy={action.busy}
        >
          <p>
            {copy('modalConfirmDescPrefix')} {registry?.sets.length ?? 0}{' '}
            {copy('modalConfirmDescSuffix')}
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {copy('modalConfirmCheck1')}
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={bridges}
              onChange={(e) => setBridges(e.target.checked)}
            />
            {copy('modalConfirmCheck2')}
          </label>
          <p className="muted">{copy('modalConfirmHelp')}</p>
          {chooseBasis && (
            <label className="field-label">
              {locale === 'vi'
                ? 'Chọn cơ sở báo cáo dùng chấm điểm toàn hồ sơ'
                : 'Reporting basis for the case-wide score'}
              <select
                value={assessmentBasis}
                onChange={(e) => setAssessmentBasis(e.target.value)}
                required
              >
                <option value="">
                  {locale === 'vi' ? 'Chọn hợp nhất hoặc riêng lẻ' : 'Choose a reporting basis'}
                </option>
                <option value="consolidated">{copy('consolidated')}</option>
                <option value="standalone">{copy('standalone')}</option>
              </select>
            </label>
          )}
          {page.capabilities?.country === 'CN' && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={profitReconciled}
                onChange={(e) => setProfitReconciled(e.target.checked)}
              />
              {locale === 'vi'
                ? 'Đã đối chiếu đầy đủ phép điều chỉnh lợi nhuận Trung Quốc, loại đúng ảnh hưởng tài trợ và đầu tư theo phương pháp. Chỉ chọn khi đã kiểm tra chứng cứ.'
                : locale === 'zh-CN'
                  ? '已完整核对中国准则经营利润调整及其融资、投资项目证据。'
                  : 'Reviewed the complete source-supported CAS operating-profit adjustments for financing and investment items.'}
            </label>
          )}
          {registry?.sets.some(
            (s) => s.metadata.accounting_profile && s.metadata.source_rounding,
          ) && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={roundingReviewed}
                onChange={(e) => setRoundingReviewed(e.target.checked)}
              />
              {locale === 'vi'
                ? 'Đã kiểm tra quy tắc làm tròn và độ chính xác trình bày của bảng cân đối.'
                : 'Reviewed the source rounding convention and balance-sheet display precision.'}
            </label>
          )}
          {registry?.sets.some(
            (s) =>
              s.metadata.accounting_profile &&
              s.facts.some(
                (f) => f.key === 'interest_expense' && f.normalized_decimal?.startsWith('-'),
              ),
          ) && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={expenseSignReviewed}
                onChange={(e) => setExpenseSignReviewed(e.target.checked)}
              />
              {locale === 'vi'
                ? 'Đã đối chiếu dấu âm/ngoặc của chi phí lãi vay là cách trình bày khoản bị trừ, không phải hoàn nhập hay thu nhập lãi. Dùng độ lớn chi phí khi tính tỷ số, giữ nguyên số gốc.'
                : 'Verified that negative/parenthesized gross interest is an expense presentation, not a reversal or interest income. Use its magnitude for ratios; retain the source sign.'}
            </label>
          )}
          <ErrorNotice error={action.error} />
          <div className="dialog-actions">
            <button
              className="primary-button"
              disabled={!checked || action.busy || (chooseBasis && !assessmentBasis)}
              onClick={() =>
                void action.run(
                  (keys) =>
                    intakeApi.confirm(
                      caseId,
                      page.revision,
                      page.review.source_snapshot_hash,
                      {
                        quick_assets_non_overlapping: bridges,
                        quick_assets_eligible: bridges,
                        da_addback_to_operating_profit: bridges,
                        ...(page.capabilities?.country === 'CN'
                          ? { international_operating_profit_reconciled: profitReconciled }
                          : {}),
                        ...(page.capabilities?.country && page.capabilities.country !== 'VN'
                          ? { source_rounding_reviewed: roundingReviewed }
                          : {}),
                        ...(chooseBasis && ['standalone', 'consolidated'].includes(assessmentBasis)
                          ? { assessment_basis: assessmentBasis as 'standalone' | 'consolidated' }
                          : {}),
                        ...(page.capabilities?.country && page.capabilities.country !== 'VN'
                          ? { expense_presentation_sign_reviewed: expenseSignReviewed }
                          : {}),
                      },
                      keys,
                    ),
                  () => {
                    setReviewing(false)
                    reload()
                  },
                )
              }
            >
              {copy('modalConfirmSave')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export function FinancialReviewGrid({
  caseId,
  revision,
  registry,
  items,
  onPreview,
  reload,
}: {
  caseId: string
  revision: number
  registry: Registry | null
  items: IntakeItem[]
  onPreview: (item: IntakeItem, page?: number) => void
  reload: () => void
}) {
  const { locale } = useLocale(),
    copy = (key: Parameters<typeof companyHealthText>[1]) => companyHealthText(locale, key),
    [selected, setSelected] = useState(''),
    [editing, setEditing] = useState<FinancialSet | null>(null),
    [editingRevision, setEditingRevision] = useState(revision)
  const set = registry?.sets.find((s) => s.id === (selected || registry.selected_set_id))
  return (
    <section className="panel aic-section">
      <div className="aic-list-heading">
        <h2>{copy('reviewGridHeading')}</h2>
        <select
          aria-label={copy('selectPeriod')}
          value={selected || registry?.selected_set_id || ''}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="" disabled>
            {copy('selectPeriod')}
          </option>
          {registry?.sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.scope.period.end_date} ·{' '}
              {s.scope.basis === 'consolidated' ? copy('consolidated') : copy('standalone')}
            </option>
          ))}
        </select>
      </div>
      {!set ? (
        <p>{items.length ? copy('reviewGridEmptyWithItems') : copy('reviewGridEmptyNoItems')}</p>
      ) : (
        <>
          <div className="aic-list-heading">
            <p>
              {set.scope.period.start_date} → {set.scope.period.end_date} · {set.scope.currency} ·{' '}
              {copy('unitMultiplierPrefix')} {set.scope.unit_multiplier}
            </p>
            <button
              className="secondary-button"
              onClick={() => {
                setEditing(set)
                setEditingRevision(revision)
              }}
            >
              {copy('btnEditExtractedFacts')}
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{copy('colInputFact')}</th>
                  <th>{copy('colStatementValue')}</th>
                  <th>{copy('colSource')}</th>
                </tr>
              </thead>
              <tbody>
                {factKeysForCountry(set.scope.country).map((key) => {
                  const f = set.facts.find((f) => f.key === key),
                    source = f?.source,
                    job =
                      source?.kind === 'financial_import' ||
                      source?.kind === 'statement_entry' ||
                      source?.kind === 'calculated'
                        ? items.find((i) => i.prepared_source_id === source.source_id)
                        : undefined
                  return (
                    <tr key={key}>
                      <th>{financialLabel(locale, 'fact', key).label}</th>
                      <td>
                        {f?.raw_value ?? 'N/A'}
                        {source?.kind === 'calculated' && (
                          <small> · {copy('calculatedSuffix')}</small>
                        )}
                      </td>
                      <td>
                        {job &&
                        (source?.kind === 'financial_import' ||
                          source?.kind === 'statement_entry' ||
                          source?.kind === 'calculated') ? (
                          <button
                            className="text-button"
                            onClick={() => onPreview(job, source.page)}
                          >
                            {copy('pagePrefix')} {source.page}
                          </button>
                        ) : (
                          'N/A'
                        )}
                        {f?.missing_reason && <small>{f.missing_reason}</small>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <CalculationProposals
            key={`${set.id}:${set.revision}`}
            set={set}
            revision={revision}
            caseId={caseId}
            reload={reload}
            onSource={(id, page) => {
              const item = items.find((i) => i.prepared_source_id === id)
              if (item) onPreview(item, page)
            }}
          />
        </>
      )}
      {editing && (
        <FinancialCorrections
          key={`${editing.id}:${editing.revision}`}
          caseId={caseId}
          revision={editingRevision}
          set={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </section>
  )
}

function FinancialCorrections({
  caseId,
  revision,
  set,
  onClose,
  onSaved,
}: {
  caseId: string
  revision: number
  set: FinancialSet
  onClose: () => void
  onSaved: () => void
}) {
  const { locale } = useLocale(),
    copy = (key: Parameters<typeof companyHealthText>[1]) => companyHealthText(locale, key),
    action = useMutation(),
    [values, setValues] = useState(
      Object.fromEntries(
        factKeys.map((key) => [key, set.facts.find((f) => f.key === key)?.raw_value ?? '']),
      ),
    ),
    [reason, setReason] = useState(''),
    [citations, setCitations] = useState<Record<string, { page: number; quote: string }>>({})
  const changed = factKeys.some(
      (key) => values[key] !== (set.facts.find((f) => f.key === key)?.raw_value ?? ''),
    ),
    valid = Object.values(values).every((v) => !v || /^-?\d{1,30}(\.\d{1,12})?$/.test(v))
  return (
    <Modal
      title={copy('modalEditFactsTitle')}
      onClose={onClose}
      dirty={changed}
      busy={action.busy}
      drawer
    >
      <p>
        {set.scope.period.end_date} · {set.scope.currency} · {copy('unitMultiplierPrefix')}{' '}
        {set.scope.unit_multiplier}. {copy('modalEditFactsHelp')}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!changed || !valid || !reason.trim()) return
          void action.run(
            (keys) =>
              financialApi.save(
                caseId,
                set.id,
                {
                  expected_revision: revision,
                  reason: reason.trim(),
                  period: set.scope.period,
                  basis: set.scope.basis,
                  accounting_regime: set.scope.accounting_regime,
                  currency: set.scope.currency,
                  unit_multiplier: set.scope.unit_multiplier,
                  industry_scope: set.scope.pilot_scope,
                  ...set.metadata,
                  facts: reviewedFacts(set, values, citations, reason.trim()),
                },
                keys,
              ),
            onSaved,
          )
        }}
      >
        <fieldset disabled={action.busy}>
          {factKeys.map((key) => {
            const f = set.facts.find((f) => f.key === key)
            return (
              <div key={key}>
                <label className="field-label">
                  {financialLabel(locale, 'fact', key).label}
                  <input
                    inputMode="decimal"
                    placeholder="N/A"
                    disabled={f?.source.kind === 'calculated'}
                    value={values[key]}
                    onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  />
                  {f && (
                    <small>
                      {f.source.kind !== 'manual_entry'
                        ? `${copy('pagePrefix')} ${f.source.page} · ${f.source.quote}`
                        : f.source.statement}
                    </small>
                  )}
                </label>
                {!f && values[key] && (
                  <div className="financial-manual-citation">
                    <p>{copy('manualCitationNotice')}</p>
                    <label className="field-label">
                      {copy('sourcePage')}
                      <input
                        type="number"
                        required
                        min={1}
                        max={600}
                        value={citations[key]?.page ?? ''}
                        onChange={(e) =>
                          setCitations((v) => ({
                            ...v,
                            [key]: { page: Number(e.target.value), quote: v[key]?.quote ?? '' },
                          }))
                        }
                      />
                    </label>
                    <label className="field-label">
                      {copy('sourceQuote')}
                      <textarea
                        required
                        maxLength={4000}
                        value={citations[key]?.quote ?? ''}
                        onChange={(e) =>
                          setCitations((v) => ({
                            ...v,
                            [key]: { page: v[key]?.page ?? 1, quote: e.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>
                )}
              </div>
            )
          })}
          <label className="field-label">
            {copy('editReasonLabel')}
            <textarea
              required
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {!valid && <p className="warning-banner">{copy('formatWarning')}</p>}
          <p>{copy('reconfirmReminder')}</p>
          <ErrorNotice error={action.error} />
          <div className="dialog-actions">
            <button className="primary-button" disabled={!changed || !valid || !reason.trim()}>
              {copy('btnSaveEditedFacts')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
