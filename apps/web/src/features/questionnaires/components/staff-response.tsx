'use client'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { Status } from '@/components/ui/status'
import { casesApi } from '@/features/cases/api'
import { type CaseDetail, type Question } from '@/lib/api/contracts'
import { questionnairesApi } from '../api'
import { useLocale } from '@/lib/i18n/locale-provider'
import { useState } from 'react'
export function StaffResponse({
  question,
  questionnaireId,
  detail,
  reload,
  onClose,
}: {
  question: Question
  questionnaireId: string
  detail: CaseDetail
  reload: () => void
  onClose: () => void
}) {
  const { t } = useLocale(),
    [answer, setAnswer] = useState(''),
    [state, setState] = useState('submitted'),
    [contact, setContact] = useState(''),
    [reportedBy, setReportedBy] = useState<'organization' | 'counterparty'>('counterparty'),
    [sources, setSources] = useState<string[]>([])
  const available = (detail.documents ?? []).flatMap((d) =>
    [...new Set(d.extraction?.flatMap((f) => f.evidence_refs) ?? [])].map((id) => ({
      id,
      name: `${d.name} · v${d.version}`,
    })),
  )
  return (
    <ActionDialog
      title={t('staffEntry')}
      loadLatest={() => casesApi.detail(detail.id)}
      revision={detail.revision}
      onClose={onClose}
      onSaved={reload}
      submit={(reason, expected_revision, keys) =>
        questionnairesApi.staff(
          questionnaireId,
          {
            reason,
            expected_revision,
            question_id: question.id,
            question_version: question.version,
            answer_state: state,
            answer_json: state === 'skipped' ? null : answer,
            reported_by: reportedBy,
            reported_reference: contact,
            source_refs: sources,
          },
          keys,
        )
      }
    >
      <h3>{question.label ?? t('question')}</h3>
      <Status value="staff_transcribed" />
      <Status value="unverified" />
      <label className="field-label">
        {t('status')}
        <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="submitted">{t('submitted')}</option>
          <option value="self_assessed">{t('self_assessed')}</option>
          {question.allowed_to_skip && <option value="skipped">{t('skipped')}</option>}
        </select>
      </label>
      <label className="field-label">
        {t('answer')} *
        <textarea
          required={state !== 'skipped'}
          disabled={state === 'skipped'}
          value={answer}
          maxLength={5000}
          onChange={(e) => setAnswer(e.target.value)}
        />
      </label>
      <label className="field-label">
        {t('recipient')}
        <input
          required
          value={contact}
          maxLength={500}
          onChange={(e) => setContact(e.target.value)}
        />
      </label>
      <label className="field-label">
        {t('reportedBy')}
        <select
          value={reportedBy}
          onChange={(e) => setReportedBy(e.target.value as typeof reportedBy)}
        >
          <option value="organization">{t('organization')}</option>
          <option value="counterparty">{t('counterparty')}</option>
        </select>
      </label>
      {available.map((source) => (
        <label className="check-label" key={source.id}>
          <input
            type="checkbox"
            checked={sources.includes(source.id)}
            onChange={(e) =>
              setSources((old) =>
                e.target.checked ? [...old, source.id] : old.filter((id) => id !== source.id),
              )
            }
          />
          {source.name} · {t('source')}
        </label>
      ))}
      <p className="help-text">{t('staffDeclarationLimit')}</p>
    </ActionDialog>
  )
}
