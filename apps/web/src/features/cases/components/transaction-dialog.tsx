'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Modal } from '@/components/ui/modal'
import { casesApi } from '@/features/cases/api'
import { useCounterpartyOptions } from '@/features/counterparties/hooks/use-counterparty-options'
import { useMutation } from '@/hooks/use-mutation'
import { ApiError } from '@/lib/api/client'
import { type TransactionCaseDetail as CaseDetail, type ExposureKind } from '@/lib/api/contracts'
import { rolePairs } from '@/lib/domain/cases'
import { useLocale } from '@/lib/i18n/locale-provider'
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { buildTransactionInput, type TransactionDraft } from '../schemas'
import {
  claimRoles,
  documentSourceOptions,
  questionnaireSourceOptions,
  rebaseTransaction,
  transactionDraft,
} from '../helpers/exposure-inputs'
import { exposureText } from '../helpers/exposure-text'
import { ExposureEditors } from './exposure-editors'
export function TransactionDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial?: CaseDetail
  onClose: () => void
  onSaved: () => void
}) {
  const { t, locale } = useLocale(),
    router = useRouter(),
    action = useMutation()
  const [draft, setDraft] = useState(() => transactionDraft(initial))
  const { kind, party, amount, term, reference, stage } = draft
  const copy = exposureText(locale)
  const [revision, setRevision] = useState(initial?.revision ?? 0),
    [baseExposure, setBaseExposure] = useState(initial?.exposure),
    [documents, setDocuments] = useState(initial?.documents ?? []),
    [questionnaires, setQuestionnaires] = useState(initial?.questionnaires ?? []),
    [latest, setLatest] = useState<CaseDetail | null>(null)
  const { options, parties, setCursor } = useCounterpartyOptions(!initial)
  const original = useRef(JSON.stringify(draft)),
    dirty = JSON.stringify(draft) !== original.current
  function update(values: Partial<TransactionDraft>) {
    setDraft((current) => ({ ...current, ...values }))
  }
  function submit() {
    let body
    try {
      body = buildTransactionInput(draft, baseExposure)
    } catch (error) {
      action.setError(error)
      return
    }
    const { exposure } = body
    void action.run(
      (keys) =>
        initial
          ? casesApi.exposure(
              initial.id,
              { exposure, expected_revision: revision },
              keys.for(initial.id, { exposure, expected_revision: revision }),
            )
          : casesApi.createCase(body, keys.for('/cases', body)),
      (result) => {
        onSaved()
        onClose()
        if (!initial && result && typeof result === 'object' && 'id' in result)
          router.push(`/cases/${String(result.id)}`)
      },
    )
  }
  return (
    <Modal
      title={t(initial ? 'edit' : 'newCase')}
      onClose={onClose}
      dirty={dirty}
      busy={action.busy}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <fieldset disabled={action.busy}>
          {!initial && (
            <>
              <label className="field-label">
                {t('counterparty')} *
                <select required value={party} onChange={(e) => update({ party: e.target.value })}>
                  <option value="">{t('select')}</option>
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.tax_id}
                    </option>
                  ))}
                </select>
              </label>
              <ErrorNotice error={parties.error} retry={parties.reload} />
              {parties.data?.next_cursor && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setCursor(parties.data!.next_cursor!)}
                >
                  {t('next')}
                </button>
              )}
              <Link className="text-button" href="/counterparties">
                {t('newParty')}
                <ArrowUpRight size={14} />
              </Link>
            </>
          )}
          <label className="field-label">
            {t('type')}
            <select
              value={kind}
              disabled={!!initial}
              onChange={(e) => {
                const nextKind = e.target.value as ExposureKind
                update({
                  kind: nextKind,
                  claims: draft.claims?.map((row) => {
                    if (!row.input || row.historical) return row
                    const roles = claimRoles(nextKind, row.input.kind)
                    return {
                      ...row,
                      input: {
                        ...row.input,
                        ...roles,
                        source_refs: row.input.source_refs.map((source) => ({
                          ...source,
                          reported_by: roles.claimant_party,
                        })),
                      },
                    }
                  }),
                })
              }}
            >
              {(initial ? [kind] : ['RECEIVABLE', 'PREPAYMENT']).map((k) => (
                <option key={k} value={k}>
                  {t(k as ExposureKind)}
                </option>
              ))}
            </select>
          </label>
          <div className="metadata-grid">
            <div>
              <span>{t('organization')}</span>
              <strong>{t(rolePairs[kind][0])}</strong>
            </div>
            <div>
              <span>{t('counterparty')}</span>
              <strong>{t(rolePairs[kind][1])}</strong>
            </div>
          </div>
          <label className="field-label">
            {t('stage')}
            <select
              value={stage}
              disabled={!!initial}
              onChange={(e) => update({ stage: e.target.value as typeof stage })}
            >
              <option value="proposed">{t('proposed')}</option>
              <option value="active">{t('active')}</option>
            </select>
          </label>
          <label className="field-label">
            {t('amount')} *
            <input
              required={amount !== null}
              disabled={amount === null}
              inputMode="numeric"
              pattern="[1-9][0-9]*"
              maxLength={24}
              value={amount ?? ''}
              onChange={(e) => update({ amount: e.target.value })}
            />
          </label>
          <label className="field-label">
            <span>
              <input
                type="checkbox"
                style={{ width: 'auto', padding: 0 }}
                checked={amount === null}
                onChange={(e) => update({ amount: e.target.checked ? null : '' })}
              />{' '}
              {t('amount')} · {copy('unknown')}
            </span>
          </label>
          {amount === null && (
            <label className="field-label">
              {copy('reason')} · {t('amount')} *
              <textarea
                required
                maxLength={1000}
                value={draft.amountMissingReason ?? ''}
                onChange={(e) => update({ amountMissingReason: e.target.value })}
              />
            </label>
          )}
          <div className="form-two-columns">
            <label className="field-label">
              {t('term')} *
              <input
                required={term !== null}
                disabled={term === null}
                type="number"
                min={0}
                step={1}
                value={term ?? ''}
                onChange={(e) => update({ term: e.target.value })}
              />
            </label>
            <label className="field-label">
              {t('reference')}
              <input
                maxLength={250}
                value={reference}
                onChange={(e) => update({ reference: e.target.value })}
              />
            </label>
          </div>
          <label className="field-label">
            <span>
              <input
                type="checkbox"
                style={{ width: 'auto', padding: 0 }}
                checked={term === null}
                onChange={(e) => update({ term: e.target.checked ? null : '' })}
              />{' '}
              {t('term')} · {copy('unknown')}
            </span>
          </label>
          {term === null && (
            <label className="field-label">
              {copy('reason')} · {t('term')} *
              <select
                required
                value={draft.termNullReason ?? ''}
                onChange={(e) =>
                  update({ termNullReason: e.target.value as TransactionDraft['termNullReason'] })
                }
              >
                <option value="">{t('select')}</option>
                {(['not_agreed', 'source_missing', 'ambiguous'] as const).map((reason) => (
                  <option key={reason} value={reason}>
                    {copy(reason)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field-label">
            {copy('dueDate')}
            <input
              type="date"
              value={draft.dueDate ?? ''}
              onChange={(e) => update({ dueDate: e.target.value || null })}
            />
          </label>
          <ExposureEditors
            kind={kind}
            claims={draft.claims ?? []}
            conditions={draft.conditions ?? []}
            sources={[
              ...documentSourceOptions(documents),
              ...questionnaireSourceOptions(questionnaires, locale),
            ]}
            onClaims={(claims) => update({ claims })}
            onConditions={(conditions) => update({ conditions })}
          />
          {action.error instanceof ApiError &&
            ['INVALID_INPUT', 'EXPOSURE_HISTORY_UNSUPPORTED'].includes(action.error.code) && (
              <p role="alert">
                {copy(
                  action.error.code === 'EXPOSURE_HISTORY_UNSUPPORTED' ? 'unsupported' : 'invalid',
                )}
              </p>
            )}
          <ErrorNotice error={action.error} />
          {action.error instanceof ApiError && action.error.status === 409 && initial && (
            <div className="aic-recovery">
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  void casesApi
                    .detail(initial.id)
                    .then((v) => {
                      if (!v.exposure) throw new Error('INVALID_API_RESPONSE')
                      setLatest(v)
                    })
                    .catch(action.setError)
                }
              >
                {t('refresh')}
              </button>
              {latest && (
                <>
                  <p>
                    {t('revision')} {latest.revision} · {copy('rebaseHelp')}
                  </p>
                  <pre className="request-preview">{t('conflict')}</pre>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      const rebased = rebaseTransaction(draft, latest)
                      setDraft(rebased.draft)
                      setRevision(rebased.revision)
                      setBaseExposure(rebased.baseExposure)
                      setDocuments(rebased.documents)
                      setQuestionnaires(latest.questionnaires ?? [])
                      setLatest(null)
                      action.setError(null)
                    }}
                  >
                    {copy('rebase')}
                  </button>
                </>
              )}
            </div>
          )}
          <div className="dialog-actions">
            <button type="submit" className="primary-button">
              {t(action.busy ? 'working' : initial ? 'save' : 'create')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
