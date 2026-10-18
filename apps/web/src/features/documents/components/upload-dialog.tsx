'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Modal } from '@/components/ui/modal'
import { casesApi } from '@/features/cases/api'
import { documentsApi } from '@/features/documents/api'
import { useMutation } from '@/hooks/use-mutation'
import { ApiError } from '@/lib/api/client'
import {
  supportedDocumentTypes,
  type CaseDetail,
  type DocumentType,
  type DossierAccepted,
} from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { buildUploadForm, type UploadMode } from '../schemas'

import { type ArchiveReceipt } from '../api'

export function UploadDialog({
  detail,
  onClose,
  onSaved,
  onArchiveSaved,
  onDossierAccepted,
}: {
  detail: CaseDetail
  onClose: () => void
  onSaved: () => void
  onArchiveSaved?: (receipt: ArchiveReceipt) => void
  onDossierAccepted?: (accepted: DossierAccepted) => void
}) {
  const { t, locale } = useLocale(),
    action = useMutation(),
    [file, setFile] = useState<File | null>(null),
    [type, setType] = useState<DocumentType>('other'),
    [mode, setMode] = useState<UploadMode>('new'),
    [target, setTarget] = useState(''),
    [sourceClass, setSourceClass] = useState(''),
    [isDragging, setIsDragging] = useState(false),
    [formatNotice, setFormatNotice] = useState<string | null>(null)
  const [revision, setRevision] = useState(detail.revision),
    [latest, setLatest] = useState<CaseDetail | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  function handleFile(selected: File | null) {
    if (!selected) {
      setFile(null)
      setFormatNotice(null)
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    const nameLower = selected.name.toLowerCase()
    const isPdf = nameLower.endsWith('.pdf')
    const isZip = nameLower.endsWith('.zip')
    const isUnsupported =
      nameLower.endsWith('.rar') ||
      nameLower.endsWith('.xlsx') ||
      nameLower.endsWith('.xls') ||
      nameLower.endsWith('.png') ||
      nameLower.endsWith('.jpg') ||
      nameLower.endsWith('.jpeg') ||
      nameLower.endsWith('.doc') ||
      nameLower.endsWith('.docx')

    if (isUnsupported) {
      setFile(null)
      setFormatNotice(t('unsupportedFormatsNotice'))
      return
    }

    if (isZip) {
      if (selected.size > 32 * 1024 * 1024) {
        setFile(null)
        setFormatNotice(
          locale === 'vi'
            ? 'Tệp ZIP vượt quá giới hạn 32 MiB cho phép.'
            : locale === 'en'
              ? 'ZIP file exceeds the 32 MiB limit.'
              : 'ZIP 文件超过 32 MiB 限制。',
        )
        return
      }
      setFile(selected)
      setFormatNotice(
        locale === 'vi'
          ? 'Đã chọn tệp ZIP hồ sơ đa năm (tối đa 32 MiB, 64 tệp PDF). Hệ thống sẽ tiếp nhận và xử lý; theo dõi kết quả từng tệp trong Tài liệu.'
          : locale === 'en'
            ? 'Multi-year dossier ZIP selected (max 32 MiB, 64 PDFs). Track intake and processing for each file in Documents.'
            : '已选择多年卷宗 ZIP 压缩包（最大 32 MiB，64 个 PDF）。上传后请在文件中查看各文件处理结果。',
      )
      return
    }

    if (!isPdf) {
      setFile(null)
      setFormatNotice(t('invalidFormat415'))
      return
    }

    if (selected.size > 10 * 1024 * 1024) {
      setFile(null)
      setFormatNotice(t('quotaExceeded413'))
      return
    }

    setFormatNotice(null)
    setFile(selected)
  }

  async function submit(key: string) {
    if (file && file.name.toLowerCase().endsWith('.zip')) {
      const form = new FormData()
      form.set('file', file)
      form.set('expected_revision', String(revision))
      try {
        const accepted = await documentsApi.uploadDossierArchive(detail.id, form, key)
        if (onDossierAccepted) onDossierAccepted(accepted)
        return accepted
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          const receipt = await documentsApi.uploadArchive(detail.id, form, key)
          if (onArchiveSaved) onArchiveSaved(receipt)
          return receipt
        }
        throw err
      }
    }
    const form = await buildUploadForm({ file, type, mode, sourceClass, target, revision })
    return documentsApi.upload(detail.id, form, key)
  }

  return (
    <Modal title={t('upload')} dirty={!!file || !!sourceClass} busy={action.busy} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void action.run(
            (keys) =>
              submit(
                keys.for(detail.id, {
                  file: file
                    ? { name: file.name, size: file.size, modified: file.lastModified }
                    : null,
                  type,
                  sourceClass,
                  mode,
                  target,
                  revision,
                }),
              ),
            () => {
              onSaved()
              onClose()
            },
          )
        }}
      >
        <fieldset disabled={action.busy}>
          <p>{t('uploadHelp')}</p>

          {/* Drag & Drop Zone */}
          <div
            className={`aic-dropzone ${isDragging ? 'drag-active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              setIsDragging(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              const dropped = e.dataTransfer.files?.[0] ?? null
              handleFile(dropped)
            }}
            onClick={() => {
              document.getElementById('aic-upload-file-input')?.click()
            }}
            role="region"
            aria-label={t('dropzoneTitle')}
          >
            <Upload size={24} className="aic-dropzone-icon" />
            <strong>{isDragging ? t('dropzoneActive') : t('dropzoneTitle')}</strong>
            <p>{t('dropzoneSubtitle')}</p>
          </div>

          <label className="field-label">
            {t('mode')}
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as UploadMode)
                setTarget('')
              }}
            >
              {['new', 'replace', 'response'].map((k) => (
                <option key={k} value={k}>
                  {t(k as 'new')}
                </option>
              ))}
            </select>
          </label>
          {mode !== 'new' && (
            <label className="field-label">
              {t('target')} *
              <select required value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">{t('select')}</option>
                {mode === 'replace'
                  ? detail.documents
                      ?.filter((d) => !['superseded', 'retired'].includes(d.status))
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name ?? t('files')} · v{d.version} ·{' '}
                          {d.status === 'failed'
                            ? t('failed')
                            : d.status === 'completed'
                              ? t('completed')
                              : d.status}{' '}
                        </option>
                      ))
                  : detail.requests
                      ?.filter((r) => r.status === 'approved')
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.purpose}
                        </option>
                      ))}
              </select>
            </label>
          )}
          <label className="field-label">
            {t('documentType')}
            <select value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
              {supportedDocumentTypes.map((k) => (
                <option key={k} value={k}>
                  {t(k)}
                </option>
              ))}
            </select>
          </label>
          <p className="help-text">{t('supportedDocumentTypesHint')}</p>
          <label className="field-label">
            {t('sourceClass')} *
            <select required value={sourceClass} onChange={(e) => setSourceClass(e.target.value)}>
              <option value="">
                {locale === 'vi'
                  ? 'Chọn nguồn tài liệu…'
                  : locale === 'en'
                    ? 'Select the document source…'
                    : '选择材料来源…'}
              </option>
              <option value="user_upload">
                {locale === 'vi'
                  ? 'Tài liệu do người dùng tải lên'
                  : locale === 'en'
                    ? 'Uploaded by the user'
                    : '用户上传的材料'}
              </option>
              <option value="counterparty_provided">
                {locale === 'vi'
                  ? 'Tài liệu do đối tác cung cấp'
                  : locale === 'en'
                    ? 'Provided by the counterparty'
                    : '交易对手提供的材料'}
              </option>
              <option value="organization_provided">
                {locale === 'vi'
                  ? 'Tài liệu do doanh nghiệp sử dụng cung cấp'
                  : locale === 'en'
                    ? 'Provided by the user organization'
                    : '使用机构提供的材料'}
              </option>
              <option value="other">{t('other')}</option>
            </select>
          </label>
          <label className="field-label">
            {t('chooseFile')} *
            <input
              id="aic-upload-file-input"
              ref={fileInput}
              required
              type="file"
              accept="application/pdf,.pdf,.zip"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {/* Selected File Preview */}
          {file && (
            <div className="aic-file-preview">
              <div className="aic-file-preview-info">
                <strong>{file.name}</strong>
                <span>
                  {(file.size / (1024 * 1024)).toFixed(2)} MiB · {file.type || 'application/pdf'}
                </span>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t('removeSelectedFile')}
                onClick={() => handleFile(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* Unsupported Formats & Honesty Disclosure */}
          <div className="aic-unsupported-warning">
            {formatNotice ? <strong>{formatNotice}</strong> : t('unsupportedFormatsNotice')}
          </div>

          {/* Specific HTTP Error Mapping */}
          {action.error instanceof ApiError && (
            <div className="aic-error" role="alert">
              {action.error.status === 429 && <p>{t('rateLimit429')}</p>}
              {action.error.status === 413 && <p>{t('quotaExceeded413')}</p>}
              {action.error.status === 415 && <p>{t('invalidFormat415')}</p>}
              {action.error.status === 422 && action.error.code === 'INVALID_PDF' && (
                <p>{t('corruptedFile422')}</p>
              )}
              {action.error.status === 503 && <p>{t('serviceUnavailable503')}</p>}
              {action.error.status === 404 && file?.name.toLowerCase().endsWith('.zip') && (
                <p>
                  {locale === 'vi'
                    ? 'Tính năng nhận hồ sơ ZIP chưa khả dụng. Vui lòng tải từng PDF phù hợp giới hạn.'
                    : locale === 'en'
                      ? 'ZIP intake is unavailable. Please upload individual PDFs within the limits.'
                      : 'ZIP卷宗上传暂不可用，请按限制逐个上传PDF。'}
                </p>
              )}
              {action.error.status === 409 &&
                action.error.code === 'DOSSIER_CASE_ARCHIVE_LIMIT' && (
                  <p>
                    {locale === 'vi'
                      ? 'Hồ sơ đã đạt giới hạn tối đa 4 tệp nén ZIP.'
                      : locale === 'en'
                        ? 'Case has reached the maximum limit of 4 dossier archives.'
                        : '案件已达到最多 4 个 ZIP 归档包上限。'}
                  </p>
                )}
            </div>
          )}

          <ErrorNotice error={action.error} />
          {action.error instanceof ApiError && action.error.status === 409 && (
            <div className="aic-recovery">
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  void casesApi.detail(detail.id).then(setLatest).catch(action.setError)
                }
              >
                {t('refresh')}
              </button>
              {latest && (
                <>
                  <p>
                    {t('revision')}: {latest.revision} · {latest.documents?.length ?? 0}{' '}
                    {t('files')}
                  </p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setRevision(latest.revision)
                      action.setError(null)
                    }}
                  >
                    {t('keepEditing')}
                  </button>
                </>
              )}
            </div>
          )}
          <div className="dialog-actions">
            <button className="primary-button" type="submit" disabled={!file}>
              {t(action.busy ? 'working' : 'upload')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
