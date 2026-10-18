'use client'
import { Status } from '@/components/ui/status'
import { useLocale } from '@/lib/i18n/locale-provider'
import type { ArchiveReceipt } from '../api'
import { AlertCircle, CheckCircle2, FileX, FolderArchive, X } from 'lucide-react'

export function ArchiveReceiptBanner({
  receipt,
  onClose,
}: {
  receipt: ArchiveReceipt
  onClose: () => void
}) {
  const { t, locale } = useLocale()

  const acceptedCount = receipt.items.filter((i) => i.status === 'accepted').length
  const rejectedCount = receipt.items.filter((i) => i.status === 'rejected').length

  const resolveRejectionMessage = (code?: string) => {
    if (!code) return ''
    if (code === 'ARCHIVE_UNSUPPORTED_FORMAT') {
      return locale === 'vi'
        ? 'Định dạng không được hỗ trợ (chỉ chấp nhận PDF)'
        : locale === 'en'
          ? 'Unsupported format (PDF only)'
          : '不支持的格式 (仅限 PDF)'
    }
    if (code === 'ARCHIVE_FILE_TOO_LARGE') {
      return locale === 'vi'
        ? 'Vượt dung lượng tối đa 10 MiB'
        : locale === 'en'
          ? 'Exceeds 10 MiB file limit'
          : '超过 10 MiB 文件上限'
    }
    return code
  }

  return (
    <section className="aic-archive-receipt" aria-label="Archive Ingestion Receipt">
      <div className="aic-archive-header">
        <div className="aic-archive-header-left">
          <FolderArchive size={18} style={{ color: 'var(--primary)' }} />
          <h3>
            {locale === 'vi'
              ? 'Biên nhận nạp tệp nén ZIP'
              : locale === 'en'
                ? 'ZIP Archive Ingestion Receipt'
                : 'ZIP 归档提取回执'}
          </h3>
          <Status value={receipt.state} />
        </div>
        <button type="button" className="icon-button" aria-label="Close receipt" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="aic-archive-stats">
        <span>
          <strong style={{ color: 'var(--foreground)' }}>{receipt.items.length}</strong>{' '}
          {t('files')}
        </span>
        <span>
          <strong style={{ color: '#096b52' }}>{acceptedCount}</strong>{' '}
          {locale === 'vi' ? 'chấp nhận' : locale === 'en' ? 'accepted' : '已接收'}
        </span>
        {rejectedCount > 0 && (
          <span>
            <strong style={{ color: '#b85d19' }}>{rejectedCount}</strong>{' '}
            {locale === 'vi' ? 'từ chối' : locale === 'en' ? 'rejected' : '已拒绝'}
          </span>
        )}
      </div>

      <div className="aic-archive-items">
        {receipt.items.map((item) => (
          <div
            key={item.entry_index}
            className={`aic-archive-item ${item.status === 'accepted' ? 'accepted' : 'rejected'}`}
          >
            <div className="aic-archive-item-left">
              {item.status === 'accepted' ? (
                <CheckCircle2 size={16} style={{ color: '#096b52', flexShrink: 0 }} />
              ) : (
                <FileX size={16} style={{ color: '#b85d19', flexShrink: 0 }} />
              )}
              <code>{item.entry_path}</code>
            </div>

            <div className="aic-archive-item-right">
              {item.status === 'accepted' ? (
                <span className="tag neutral">
                  {t('aiSuggested')}: {t(item.suggested_type)}
                </span>
              ) : (
                <span className="tag red" title={item.rejection?.code}>
                  <AlertCircle size={12} />
                  {resolveRejectionMessage(item.rejection?.code)}
                </span>
              )}
              <Status value={item.status} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
