'use client'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { casesApi } from '@/features/cases/api'
import { documentsApi } from '@/features/documents/api'
import type { CaseDetail, Document, DocumentType } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { useState } from 'react'
import type { SourceTarget } from '@/features/evidence/types'
export function DocumentClassification({
  document,
  detail,
  onClose,
  onSaved,
  openSource,
}: {
  document: Document
  detail: CaseDetail
  onClose: () => void
  onSaved: () => void
  openSource: (s: SourceTarget) => void
}) {
  const { t } = useLocale(),
    [type, setType] = useState(document.source_review?.declared_type ?? document.type),
    [match, setMatch] = useState<'match' | 'mismatch' | 'unresolved'>(
      document.source_review?.subject_match ?? 'unresolved',
    ),
    [page, setPage] = useState(document.source_review?.reviewed_pages[0] ?? 1)
  return (
    <ActionDialog
      title={t('classify')}
      loadLatest={() => casesApi.detail(detail.id)}
      revision={detail.revision}
      onClose={onClose}
      onSaved={onSaved}
      submit={(reason, revision, keys) =>
        documentsApi.classify(
          document.id,
          {
            expected_revision: revision,
            reason,
            declared_type: type,
            subject_match: match,
            reviewed_pages: [page],
            evidence_refs: [],
          },
          keys,
        )
      }
    >
      <h3>
        {document.name ?? t(document.type)} · v{document.version}
      </h3>
      <button
        type="button"
        className="secondary-button"
        onClick={() =>
          openSource({
            documentId: document.id,
            version: document.version,
            hash: document.hash,
            name: document.name,
          })
        }
      >
        {t('source')} · v{document.version}
      </button>
      <label className="field-label">
        {t('documentType')}
        <select value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
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
          ).map((value) => (
            <option key={value} value={value}>
              {t(value)}
            </option>
          ))}
        </select>
      </label>
      <label className="field-label">
        {t('sourceSubjectReview')}
        <select value={match} onChange={(e) => setMatch(e.target.value as typeof match)}>
          <option value="unresolved">{t('subjectUnresolved')}</option>
          <option value="match">{t('subjectMatch')}</option>
          <option value="mismatch">{t('subjectMismatch')}</option>
        </select>
      </label>
      <label className="field-label">
        {t('page')}
        <input
          type="number"
          min={1}
          max={document.pages}
          value={page}
          onChange={(e) => setPage(Number(e.target.value))}
        />
      </label>
      <p className="help-text">{t('sourceReviewLimit')}</p>
    </ActionDialog>
  )
}
