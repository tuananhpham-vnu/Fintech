'use client'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { casesApi } from '@/features/cases/api'
import type { CaseDetail, Questionnaire } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { useState } from 'react'
import { questionnairesApi } from '../api'
import { nativeCopy } from '../native-copy'

export function Invitation({
  detail,
  questionnaire,
  reload,
}: {
  detail: CaseDetail
  questionnaire: Questionnaire
  reload: () => void
}) {
  const { t, locale } = useLocale(),
    copy = nativeCopy(locale)
  const [mode, setMode] = useState<'create' | 'close' | string | null>(null),
    [recipient, setRecipient] = useState(''),
    [party, setParty] = useState<'organization' | 'counterparty'>('counterparty'),
    [selected, setSelected] = useState(questionnaire.questions.map((q) => q.id)),
    [link, setLink] = useState<string | null>(null),
    [delivered, setDelivered] = useState(false)
  return (
    <>
      <div className="wrap-actions">
        <button
          className="secondary-button"
          disabled={questionnaire.state === 'closed'}
          onClick={() => {
            setLink(null)
            setDelivered(false)
            setMode('create')
          }}
        >
          {copy('invite')}
        </button>
        <button
          className="text-button"
          disabled={questionnaire.state === 'closed'}
          onClick={() => setMode('close')}
        >
          {copy('close')}
        </button>
      </div>
      <p className="help-text">{copy('limitation')}</p>
      {delivered && (
        <div className="panel">
          <p>{copy(link ? 'link' : 'lost')}</p>
          {link && (
            <input
              aria-label={copy('link')}
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
            />
          )}
        </div>
      )}
      {questionnaire.invitations?.map((invite) => (
        <div className="aic-checklist-row" key={invite.id}>
          <span>
            {invite.recipient_reference} · {invite.status} · {invite.expires_at}
          </span>
          {!['revoked', 'closed'].includes(invite.status) && (
            <button className="text-button" onClick={() => setMode(invite.id)}>
              {copy('revoke')}
            </button>
          )}
        </div>
      ))}
      {mode && (
        <ActionDialog
          title={copy(mode === 'create' ? 'invite' : mode === 'close' ? 'close' : 'revoke')}
          revision={detail.revision}
          loadLatest={() => casesApi.detail(detail.id)}
          onClose={() => setMode(null)}
          onSaved={reload}
          submit={async (reason, expected_revision, keys) => {
            if (mode === 'create') {
              const body = {
                reason,
                expected_revision,
                question_ids: selected,
                reported_by: party,
                recipient_reference: recipient,
              }
              const value = await questionnairesApi.createInvitation(
                questionnaire.id,
                body,
                keys.for('invite:' + questionnaire.id, body),
                (token) => setLink(`${window.location.origin}/respondent#token=${token}`),
              )
              setDelivered(true)
              return value
            }
            const body = { reason, expected_revision }
            return mode === 'close'
              ? questionnairesApi.closeQuestionnaire(
                  questionnaire.id,
                  body,
                  keys.for('close:' + questionnaire.id, body),
                )
              : questionnairesApi.revokeInvitation(mode, body, keys.for('revoke:' + mode, body))
          }}
        >
          {mode === 'create' && (
            <>
              <label className="field-label">
                {copy('recipient')}
                <input
                  required
                  maxLength={500}
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                />
              </label>
              <label className="field-label">
                {t('reportedBy')}
                <select value={party} onChange={(e) => setParty(e.target.value as typeof party)}>
                  <option value="organization">{t('organization')}</option>
                  <option value="counterparty">{t('counterparty')}</option>
                </select>
              </label>
              {questionnaire.questions.map((q) => (
                <label className="check-label" key={q.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(q.id)}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked ? [...old, q.id] : old.filter((id) => id !== q.id),
                      )
                    }
                  />
                  {q.label ?? q.id}
                </label>
              ))}
            </>
          )}
        </ActionDialog>
      )}
    </>
  )
}
