'use client'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { casesApi } from '@/features/cases/api'
import type { CaseDetail } from '@/lib/api/contracts'
import { questionnairesApi } from '../api'
import { useLocale } from '@/lib/i18n/locale-provider'
import { useState } from 'react'
export function CreateQuestionnaire({
  detail,
  reload,
  onClose,
}: {
  detail: CaseDetail
  reload: () => void
  onClose: () => void
}) {
  const { t } = useLocale(),
    [text, setText] = useState('')
  return (
    <ActionDialog
      title={t('questionnaire')}
      loadLatest={() => casesApi.detail(detail.id)}
      revision={detail.revision}
      onClose={onClose}
      onSaved={reload}
      submit={(reason, expected_revision, keys) =>
        questionnairesApi.create(
          detail.id,
          { reason, expected_revision, questions: [{ label: text }] },
          keys,
        )
      }
    >
      <label className="field-label">
        {t('content')} *
        <textarea
          required
          value={text}
          maxLength={3000}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="help-text">{t('optionalQuestionPolicy')}</p>
    </ActionDialog>
  )
}
