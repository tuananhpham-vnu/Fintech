'use client'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { casesApi } from '@/features/cases/api'
import { type CaseDetail, type ExtractedField } from '@/lib/api/contracts'
import { documentsApi } from '@/features/documents/api'
import { useLocale } from '@/lib/i18n/locale-provider'
import { displayValue } from '@/lib/utils/format'
import { useState } from 'react'
import { documentFieldLabel } from '../field-labels'
export function FieldCorrection({
  field,
  verificationOnly = false,
  documentId,
  detail,
  onClose,
  onSaved,
}: {
  field: ExtractedField
  verificationOnly?: boolean
  documentId: string
  detail: CaseDetail
  onClose: () => void
  onSaved: () => void
}) {
  const { t, locale } = useLocale(),
    [value, setValue] = useState(field.value == null ? '' : String(field.value)),
    [missing, setMissing] = useState(field.value == null)
  return (
    <ActionDialog
      title={t(verificationOnly ? 'verify' : 'correct')}
      loadLatest={() => casesApi.detail(detail.id)}
      revision={detail.revision}
      onClose={onClose}
      onSaved={onSaved}
      submit={(reason, revision, keys) =>
        verificationOnly
          ? documentsApi.verifyField(
              documentId,
              {
                reason,
                expected_revision: revision,
                field_key: field.field_key,
                evidence_refs: field.evidence_refs,
              },
              keys,
            )
          : documentsApi.correct(
              documentId,
              {
                expected_revision: revision,
                reason,
                field_key: field.field_key,
                value: missing ? null : value,
                evidence_refs: field.evidence_refs,
              },
              keys,
            )
      }
    >
      <h3>{documentFieldLabel(field.field_key, locale).label}</h3>
      <details>
        <summary>
          {locale === 'en'
            ? 'Technical details'
            : locale === 'vi'
              ? 'Chi tiết kỹ thuật'
              : '技术详情'}
        </summary>
        <code>{field.field_key}</code>
      </details>
      <p>
        {t('raw')}: {displayValue(field.raw_value)}
      </p>
      {!verificationOnly && (
        <label className="check-label">
          <input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} />
          {t('nullValue')}
        </label>
      )}
      <label className="field-label">
        {t('effective')}
        <input
          disabled={missing || verificationOnly}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <p>{t('sourceReviewLimit')}</p>
    </ActionDialog>
  )
}
