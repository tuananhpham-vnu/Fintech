'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Modal } from '@/components/ui/modal'
import { useMutation } from '@/hooks/use-mutation'
import { ApiError } from '@/lib/api/client'
import { type CaseDetail, type DocumentRequest, type DocumentType } from '@/lib/api/contracts'
import { requestsApi } from '@/features/requests/api'
import { useLocale } from '@/lib/i18n/locale-provider'
import { localizeFindingSummary } from '@/lib/i18n/review-i18n'
import { useState } from 'react'
export function RequestDraft({
  initial,
  detail,
  onClose,
  onSaved,
}: {
  initial?: DocumentRequest
  detail: CaseDetail
  onClose: () => void
  onSaved: () => void
}) {
  const { t, locale } = useLocale(),
    action = useMutation(),
    [purpose, setPurpose] = useState(initial?.purpose ?? ''),
    [content, setContent] = useState(initial?.content ?? ''),
    [issue, setIssue] = useState(initial?.issue_id ?? ''),
    [documentType, setDocumentType] = useState<DocumentType>(
      initial?.document_types?.[0] ?? 'registration',
    ),
    dirty =
      purpose !== (initial?.purpose ?? '') ||
      content !== (initial?.content ?? '') ||
      issue !== (initial?.issue_id ?? '') ||
      documentType !== (initial?.document_types?.[0] ?? 'registration')
  return (
    <Modal title={t('request')} dirty={dirty} busy={action.busy} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!purpose.trim() || !content.trim() || !issue || !detail.latest_review_run_id)
            return action.setError(new ApiError(422, 'INVALID_INPUT', ''))
          const body = {
            expected_revision: detail.revision,
            run_id: detail.latest_review_run_id,
            issue_id: issue,
            purpose,
            content,
            document_types: [documentType],
          }
          void action.run(
            (keys) => requestsApi.draft(detail.id, initial?.id, body, keys),
            () => {
              onSaved()
              onClose()
            },
          )
        }}
      >
        <fieldset disabled={action.busy}>
          <p className="mono">
            {detail.id} · {detail.latest_review_run_id ?? '—'}
          </p>
          <label className="field-label">
            {t('findings')}
            <select required value={issue} onChange={(e) => setIssue(e.target.value)}>
              <option value="">{t('select')}</option>
              {detail.findings?.map((f) => (
                <option key={f.id} value={f.id}>
                  {localizeFindingSummary(f, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            {t('type')} *
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as DocumentType)}
            >
              {(
                [
                  'registration',
                  'loan_request',
                  'financial_statement',
                  'contract',
                  'acceptance_record',
                  'payment_record',
                  'invoice',
                  'other',
                ] as DocumentType[]
              ).map((type) => (
                <option key={type} value={type}>
                  {t(type)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            {t('purpose')} *
            <input
              required
              maxLength={500}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
          </label>
          <label className="field-label">
            {t('content')} *
            <textarea
              required
              className="large-textarea"
              maxLength={10000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          <ErrorNotice error={action.error} />
          <div className="dialog-actions">
            <button className="primary-button" type="submit">
              {t('save')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
