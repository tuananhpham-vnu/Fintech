'use client'
import {
  type DossierArchive,
  type DossierArchiveSummary,
  type DossierIntakeState,
  type DossierProcessingState,
} from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { AlertCircle, FolderArchive, RefreshCw, X } from 'lucide-react'

export function DossierArchiveBanner({
  archive,
  isPolling,
  onRefresh,
  onClose,
}: {
  archive: DossierArchiveSummary | DossierArchive
  isPolling?: boolean
  onRefresh?: () => void
  onClose?: () => void
}) {
  const { t, locale } = useLocale()

  const counters = archive.counters
  const totalDiscovered = counters.discovered
  // Terminal member outcomes: completed (with data or zero), failed, needs_review, rejected
  const terminalOutcomes =
    counters.completed_with_usable_data +
    counters.completed_zero_usable +
    counters.failed +
    counters.needs_review +
    counters.rejected
  const progressPercent =
    totalDiscovered > 0 ? Math.min(100, Math.round((terminalOutcomes / totalDiscovered) * 100)) : 0

  const resolveIntakeLabel = (state: DossierIntakeState) => {
    switch (state) {
      case 'queued':
        return t('intakeQueued')
      case 'validating':
        return t('intakeValidating')
      case 'registering':
        return t('intakeRegistering')
      case 'accepted':
        return t('intakeAccepted')
      case 'partially_accepted':
        return t('intakePartiallyAccepted')
      case 'rejected':
        return t('intakeRejected')
      default:
        return state
    }
  }

  const resolveProcessingLabel = (state: DossierProcessingState) => {
    switch (state) {
      case 'waiting':
        return t('processingWaiting')
      case 'processing':
        return t('processingRunning')
      case 'finished':
        return t('processingFinished')
      case 'finished_with_errors':
        return t('processingFinishedErrors')
      default:
        return state
    }
  }

  const resolveArchiveError = (code: string | null) => {
    if (!code) return null
    if (code === 'ARCHIVE_UNSAFE_PATH') {
      return locale === 'vi'
        ? 'Tệp ZIP chứa đường dẫn không an toàn hoặc ký tự bất thường.'
        : locale === 'en'
          ? 'ZIP archive contains unsafe or traversal paths.'
          : 'ZIP 压缩包包含不安全路径。'
    }
    if (code === 'ARCHIVE_DUPLICATE_PATH') {
      return locale === 'vi'
        ? 'Tệp ZIP chứa các đường dẫn tệp trùng lặp sau chuẩn hóa.'
        : locale === 'en'
          ? 'ZIP archive contains normalized duplicate paths.'
          : 'ZIP 压缩包包含重复规范化路径。'
    }
    if (code === 'ARCHIVE_ENTRY_LIMIT') {
      return locale === 'vi'
        ? 'Tệp ZIP vượt quá giới hạn 128 mục (bao gồm cả thư mục).'
        : locale === 'en'
          ? 'ZIP archive exceeds the 128 entry limit.'
          : 'ZIP 压缩包超过 128 个条目上限。'
    }
    if (code === 'ARCHIVE_EXPANDED_SIZE_LIMIT') {
      return locale === 'vi'
        ? 'Dung lượng giải nén vượt quá giới hạn 64 MiB.'
        : locale === 'en'
          ? 'Expanded archive exceeds 64 MiB limit.'
          : '解压后总大小超过 64 MiB 上限。'
    }
    if (code === 'ARCHIVE_COMPRESSION_RATIO') {
      return locale === 'vi'
        ? 'Tỷ lệ nén vượt ngưỡng an toàn cho phép.'
        : locale === 'en'
          ? 'Archive compression ratio exceeds safe limit.'
          : '压缩率超出安全限制。'
    }
    if (code === 'ARCHIVE_ENCRYPTED') {
      return locale === 'vi'
        ? 'Tệp ZIP có mật khẩu bảo vệ hoặc mã hóa.'
        : locale === 'en'
          ? 'ZIP archive is encrypted or password-protected.'
          : 'ZIP 压缩包已加密或设有密码。'
    }
    if (code === 'DOSSIER_INTAKE_ATTEMPTS_EXHAUSTED') {
      return locale === 'vi'
        ? 'Đã thử phân tích tệp nén 3 lần nhưng không thành công.'
        : locale === 'en'
          ? 'Dossier parse attempts exhausted after 3 retries.'
          : '卷宗解析尝试次数已耗尽（最多3次）。'
    }
    return code
  }

  const isIntakeTerminal = ['accepted', 'partially_accepted', 'rejected'].includes(
    archive.intake_state,
  )
  const isProcessingTerminal = ['finished', 'finished_with_errors'].includes(
    archive.processing_state,
  )
  const isTerminal =
    archive.intake_state === 'rejected' || (isIntakeTerminal && isProcessingTerminal)

  return (
    <section className="aic-archive-receipt aic-dossier-banner" aria-label="Dossier Ingestion">
      <div className="aic-archive-header">
        <div className="aic-archive-header-left">
          <FolderArchive size={20} style={{ color: 'var(--primary)' }} />
          <div>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{t('dossierBatchArchive')}</span>
              <span className="mono" style={{ fontSize: '11px', color: 'var(--muted)' }}>
                #{archive.id.slice(0, 8)}
              </span>
            </h3>
          </div>

          {/* Intake state badge */}
          <span
            className={`tag ${
              archive.intake_state === 'accepted'
                ? 'green'
                : archive.intake_state === 'rejected'
                  ? 'red'
                  : 'amber'
            }`}
          >
            <span className="status-dot" />
            {resolveIntakeLabel(archive.intake_state)}
          </span>

          {/* Processing state badge */}
          {archive.intake_state !== 'rejected' && (
            <span
              className={`tag ${
                archive.processing_state === 'finished'
                  ? 'green'
                  : archive.processing_state === 'finished_with_errors'
                    ? 'amber'
                    : archive.processing_state === 'processing'
                      ? 'blue'
                      : 'neutral'
              }`}
            >
              <span className="status-dot" />
              {resolveProcessingLabel(archive.processing_state)}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isPolling && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: '12px',
                color: 'var(--primary)',
              }}
            >
              <RefreshCw size={13} className="spin-animate" />
              <span>{t('liveSync')}</span>
            </span>
          )}

          {onRefresh && (
            <button
              type="button"
              className="icon-button"
              title={t('refreshState')}
              aria-label={t('refreshState')}
              onClick={onRefresh}
            >
              <RefreshCw size={15} />
            </button>
          )}

          {onClose && isTerminal && (
            <button
              type="button"
              className="icon-button"
              aria-label="Close dossier banner"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar (Honest non-overlapping progress) */}
      {totalDiscovered > 0 && archive.intake_state !== 'rejected' && (
        <div style={{ margin: '8px 0 14px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
              color: 'var(--muted)',
              marginBottom: 4,
            }}
          >
            <span>{t('dossierProgress')}</span>
            <strong>{progressPercent}%</strong>
          </div>
          <div
            style={{
              height: 6,
              background: 'var(--border, #e5e7eb)',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progressPercent}%`,
                background:
                  archive.processing_state === 'finished'
                    ? '#096b52'
                    : archive.processing_state === 'finished_with_errors'
                      ? '#b85d19'
                      : 'var(--primary)',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>
      )}

      {/* Error alert if archive failed */}
      {archive.error_code && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: '#fff8f5',
            border: '1px solid #f6d2c4',
            borderRadius: 'var(--radius-sm)',
            color: '#8c2e1b',
            fontSize: '12.5px',
            marginBottom: 12,
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span>{resolveArchiveError(archive.error_code)}</span>
        </div>
      )}

      {/* Honest Counters Grid */}
      <div className="aic-archive-stats" style={{ margin: 0, flexWrap: 'wrap', gap: 14 }}>
        <span>
          <strong style={{ color: 'var(--foreground)' }}>{counters.discovered}</strong>{' '}
          {locale === 'vi' ? 'tệp phát hiện' : locale === 'en' ? 'discovered' : '发现文件'}
        </span>

        <span>
          <strong style={{ color: '#096b52' }}>{counters.registered}</strong>{' '}
          {locale === 'vi' ? 'nguồn đã lưu' : locale === 'en' ? 'stored sources' : '已存储源'}
        </span>

        {counters.completed_with_usable_data > 0 && (
          <span>
            <strong style={{ color: '#096b52' }}>{counters.completed_with_usable_data}</strong>{' '}
            {locale === 'vi'
              ? 'trích xuất có dữ liệu'
              : locale === 'en'
                ? 'with data'
                : '有可用数据'}
          </span>
        )}

        {counters.completed_zero_usable > 0 && (
          <span>
            <strong style={{ color: '#b85d19' }}>{counters.completed_zero_usable}</strong>{' '}
            {locale === 'vi' ? '0 trường khả dụng' : locale === 'en' ? '0 usable' : '0个可用字段'}
          </span>
        )}

        {counters.needs_review > 0 && (
          <span>
            <strong style={{ color: '#b85d19' }}>{counters.needs_review}</strong>{' '}
            {locale === 'vi'
              ? 'cần rà soát (>10 trang)'
              : locale === 'en'
                ? 'review required'
                : '需核查'}
          </span>
        )}

        {counters.rejected > 0 && (
          <span>
            <strong style={{ color: '#c5221f' }}>{counters.rejected}</strong>{' '}
            {locale === 'vi' ? 'từ chối' : locale === 'en' ? 'rejected' : '已拒绝'}
          </span>
        )}

        {counters.failed > 0 && (
          <span>
            <strong style={{ color: '#c5221f' }}>{counters.failed}</strong>{' '}
            {locale === 'vi' ? 'thất bại' : locale === 'en' ? 'failed' : '失败'}
          </span>
        )}

        {(counters.running > 0 || counters.queued > 0) && (
          <span>
            <strong style={{ color: 'var(--primary)' }}>
              {counters.running + counters.queued}
            </strong>{' '}
            {locale === 'vi' ? 'đang xử lý' : locale === 'en' ? 'processing' : '正在处理'}
          </span>
        )}
      </div>
    </section>
  )
}
