'use client'
import { Empty } from '@/components/feedback/empty'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { Modal } from '@/components/ui/modal'
import { Status } from '@/components/ui/status'
import { documentsApi } from '@/features/documents/api'
import { FieldCorrection } from '@/features/documents/components/field-correction'
import { documentFieldLabel } from '../field-labels'
import { DocumentClassification } from './document-classification'
import type { SourceTarget } from '@/features/evidence/types'
import { useResource } from '@/hooks/use-resource'
import { type CaseDetail, type Document, type ExtractedField } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { messages, type MessageKey } from '@/lib/i18n/messages'
import { displayValue } from '@/lib/utils/format'
import { useCallback, useState } from 'react'
import { AlertCircle, AlertTriangle, Cpu, Eye } from 'lucide-react'
export function ExtractionDialog({
  document,
  detail,
  onClose,
  reload,
  openSource,
}: {
  document: Document
  detail: CaseDetail
  onClose: () => void
  reload: () => void
  openSource: (s: SourceTarget) => void
}) {
  const { t, locale } = useLocale(),
    [field, setField] = useState<ExtractedField | null>(null),
    [verificationOnly, setVerificationOnly] = useState(false),
    [classify, setClassify] = useState(false)

  const raw = document as unknown as Record<string, unknown>
  const isRetainedReview =
    document.status === 'needs_review' ||
    raw.dossier_intake_state === 'needs_review' ||
    raw.dossier_error_code === 'PDF_REQUIRES_CHUNKED_PROCESSING'
  const isRejectedMember = document.status === 'rejected' || raw.dossier_intake_state === 'rejected'
  const isSyntheticMember = document.id.startsWith('dossier-member-')

  const loadSummary = useCallback(
    (signal: AbortSignal) => {
      if (isSyntheticMember) return Promise.resolve(null)
      return documentsApi.extractionSummary(document.id, signal)
    },
    [document.id, isSyntheticMember],
  )
  const summaryResource = useResource(loadSummary, !isSyntheticMember)
  const summary = summaryResource.data

  const load = useCallback(
    (signal: AbortSignal) => {
      if (isSyntheticMember) return Promise.resolve([])
      return documentsApi.extraction(document.id, signal)
    },
    [document.id, isSyntheticMember],
  )
  const resource = useResource(load, !document.extraction && !isSyntheticMember)
  const fields = document.extraction ?? resource.data

  const isZeroUsable =
    summary?.outcome === 'zero_usable_fields' ||
    (document.status === 'completed' && (!fields || fields.length === 0))

  return (
    <>
      <Modal title={t('inspect')} onClose={onClose} drawer>
        <h3>
          {document.name ?? t(document.type)} · v{document.version}
        </h3>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            margin: '8px 0 16px',
          }}
        >
          <Status value={document.status} />
          {summary?.outcome === 'ready_for_review' && (
            <span className="tag green">
              <span className="status-dot" />
              {t('ready_for_review')}: {summary.usable_fields}/{summary.total_fields}{' '}
              {t('available').toLowerCase()}
            </span>
          )}
          {isZeroUsable && !isRetainedReview && !isRejectedMember && (
            <span className="tag amber">
              <span className="status-dot" />
              {t('zero_usable_fields')}
            </span>
          )}
          {summary?.ai_mode && <span className="tag neutral">AI: {summary.ai_mode}</span>}
        </div>

        {/* Retained member notice */}
        {isRetainedReview && (
          <div
            style={{
              padding: '12px 16px',
              margin: '12px 0 16px',
              background: '#fffbf0',
              border: '1px solid #f6d2c4',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <AlertTriangle size={16} style={{ color: '#b85d19' }} />
              <strong style={{ color: '#8c2e1b' }}>{t('needs_review')}</strong>
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: '#4a5568' }}>
              {t('retainedLongPdfNotice')}
            </p>
            {document.pages > 10 && (
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--muted)' }}>
                {locale === 'vi'
                  ? `Dung lượng: ${document.pages} trang (vượt hạn mức tự động 10 trang).`
                  : `Length: ${document.pages} pages (exceeds 10-page auto limit).`}
              </p>
            )}
            {Boolean(raw.dossier_member_id) && (
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    openSource({
                      dossierMemberId: raw.dossier_member_id as string,
                      name: document.name,
                      hash: document.hash || null,
                    })
                  }
                >
                  <Eye size={14} />
                  <span>{t('source')}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Rejected member notice */}
        {isRejectedMember && (
          <div
            style={{
              padding: '12px 16px',
              margin: '12px 0 16px',
              background: '#fff8f5',
              border: '1px solid #f6d2c4',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={16} style={{ color: '#c5221f' }} />
              <strong style={{ color: '#8c2e1b' }}>
                {locale === 'vi' ? 'Tệp tin bị từ chối' : 'Member Rejected'}
              </strong>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#4a5568' }}>
              {String(raw.dossier_error_code ?? 'ARCHIVE_UNSUPPORTED_FORMAT')}
            </p>
          </div>
        )}

        {!isRejectedMember && (
          <button className="secondary-button" onClick={() => setClassify(true)}>
            {t('classify')}
          </button>
        )}

        {summary?.diagnostics && summary.diagnostics.length > 0 && (
          <div
            style={{
              margin: '12px 0',
              padding: '10px 14px',
              background: 'var(--bg-subtle, #f8f9fa)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Cpu size={14} style={{ color: 'var(--primary)' }} />
              <strong style={{ fontSize: '12px' }}>{t('diagnostics')}</strong>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {summary.diagnostics.map((d, i) => (
                <span
                  key={i}
                  className="tag neutral"
                  style={{ fontSize: '11px' }}
                  title={d.field_key ?? undefined}
                >
                  {d.code}
                </span>
              ))}
            </div>
          </div>
        )}

        {isZeroUsable && (
          <div
            style={{
              margin: '16px 0',
              padding: '14px 16px',
              background: 'var(--amber-bg, #fffbeb)',
              border: '1px solid var(--amber-border, #fcd34d)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertCircle
                size={18}
                style={{ color: 'var(--amber, #d97706)', flexShrink: 0, marginTop: 2 }}
              />
              <div>
                <strong
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    color: 'var(--amber-text, #92400e)',
                    marginBottom: 4,
                  }}
                >
                  {t('zero_usable_fields')}
                </strong>
                <p
                  style={{
                    margin: 0,
                    fontSize: '12px',
                    color: 'var(--text-secondary, #475569)',
                    lineHeight: 1.5,
                  }}
                >
                  {t('zeroUsableFieldsNotice')}
                </p>
              </div>
            </div>
          </div>
        )}

        {!isZeroUsable && <ErrorNotice error={resource.error} retry={resource.reload} />}
        {resource.loading && !fields && !isZeroUsable && <Loading />}

        {fields?.length ? (
          fields.map((f) => (
            <article className="field-card" key={f.field_key}>
              <h3>{documentFieldLabel(f.field_key, locale).label}</h3>
              <details>
                <summary>
                  {locale === 'en'
                    ? 'Technical details'
                    : locale === 'vi'
                      ? 'Chi tiết kỹ thuật'
                      : '技术详情'}
                </summary>
                <code>{f.field_key}</code>
              </details>
              <div className="metadata-grid">
                <div>
                  <span>{t('raw')}</span>
                  <strong>{displayValue(f.raw_value)}</strong>
                </div>
                <div>
                  <span>{t('effective')}</span>
                  <strong>{displayValue(f.value)}</strong>
                </div>
              </div>
              <Status value={f.quality} />
              {f.missing_reason && (
                <p>
                  {Object.hasOwn(messages, f.missing_reason)
                    ? t(f.missing_reason as MessageKey)
                    : f.missing_reason}
                </p>
              )}
              <p>
                {f.party_role} · {f.period} · {f.currency}
              </p>
              <div className="wrap-actions">
                {f.evidence_refs.map((id) => (
                  <button
                    key={id}
                    className="text-button"
                    onClick={() => openSource({ evidenceId: id })}
                  >
                    {t('source')}
                  </button>
                ))}
                <button
                  className="secondary-button"
                  onClick={() => {
                    setVerificationOnly(false)
                    setField(f)
                  }}
                >
                  {t('correct')}
                </button>
                <button
                  className="secondary-button"
                  disabled={f.value === null || !f.evidence_refs.length}
                  onClick={() => {
                    setVerificationOnly(true)
                    setField(f)
                  }}
                >
                  {t('verify')}
                </button>
              </div>
            </article>
          ))
        ) : summary?.fields?.length ? (
          <section style={{ marginTop: 12 }}>
            <h4
              style={{
                fontSize: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--muted)',
                marginBottom: 8,
              }}
            >
              {t('fields')} ({summary.fields.length})
            </h4>
            {summary.fields.map((f) => (
              <div
                key={f.field_key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 6,
                }}
              >
                <div>
                  <strong style={{ fontSize: '13px' }}>
                    {documentFieldLabel(f.field_key, locale).label}
                  </strong>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--muted)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {f.field_key}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    className={`tag ${
                      f.quality === 'readable'
                        ? 'green'
                        : f.quality === 'uncertain'
                          ? 'amber'
                          : 'neutral'
                    }`}
                  >
                    {t(f.quality as MessageKey)}
                  </span>
                  {f.missing_reason && (
                    <span className="tag amber" style={{ fontSize: '11px' }}>
                      {Object.hasOwn(messages, f.missing_reason)
                        ? t(f.missing_reason as MessageKey)
                        : f.missing_reason}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </section>
        ) : (
          !resource.loading && !summaryResource.loading && !isZeroUsable && <Empty />
        )}
      </Modal>
      {field && (
        <FieldCorrection
          field={field}
          verificationOnly={verificationOnly}
          documentId={document.id}
          detail={detail}
          onClose={() => setField(null)}
          onSaved={reload}
        />
      )}{' '}
      {classify && (
        <DocumentClassification
          document={document}
          detail={detail}
          onClose={() => setClassify(false)}
          onSaved={reload}
        />
      )}
    </>
  )
}
