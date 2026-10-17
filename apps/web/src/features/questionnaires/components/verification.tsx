'use client'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { Status } from '@/components/ui/status'
import { casesApi } from '@/features/cases/api'
import { type CaseDetail, type ResponseRecord } from '@/lib/api/contracts'
import { questionnairesApi } from '../api'
import { useLocale } from '@/lib/i18n/locale-provider'
import { displayValue } from '@/lib/utils/format'
import { useState } from 'react'
export function Verification({
  response,
  detail,
  reload,
  onClose,
}: {
  response: ResponseRecord
  detail: CaseDetail
  reload: () => void
  onClose: () => void
}) {
  const { t } = useLocale(),
    [verification, setVerification] = useState(response.verification_status ?? 'unverified'),
    [sources, setSources] = useState(response.source_refs)
  const available = (detail.documents ?? [])
    .filter((d) => d.source_review?.subject_match === 'match')
    .flatMap((d) =>
      [...new Set(d.extraction?.flatMap((f) => f.evidence_refs) ?? [])].map((id) => ({
        id,
        name: `${d.name} · v${d.version}`,
      })),
    )
  return (
    <ActionDialog
      title={t('verify')}
      loadLatest={() => casesApi.detail(detail.id)}
      revision={detail.revision}
      onClose={onClose}
      onSaved={reload}
      submit={(reason, expected_revision, keys) =>
        questionnairesApi.verify(
          response.id,
          {
            reason,
            expected_revision,
            response_revision: response.revision,
            status: verification,
            evidence_refs: sources,
          },
          keys,
        )
      }
    >
      <blockquote>{displayValue(response.answer_json)}</blockquote>
      <Status value={response.origin} />
      <label className="field-label">
        {t('status')}
        <select value={verification} onChange={(e) => setVerification(e.target.value)}>
          {['unverified', 'verified', 'conflicting'].map((k) => (
            <option key={k} value={k}>
              {t(k as 'verified')}
            </option>
          ))}
        </select>
      </label>
      <label className="field-label">
        {t('evidence')}
        {available.map((source) => (
          <span className="check-label" key={source.id}>
            <input
              type="checkbox"
              checked={sources.includes(source.id)}
              onChange={(e) =>
                setSources((old) =>
                  e.target.checked ? [...old, source.id] : old.filter((id) => id !== source.id),
                )
              }
            />
            {source.name}
          </span>
        ))}
      </label>
      <p className="help-text">{t('responseVerificationLimit')}</p>
    </ActionDialog>
  )
}
