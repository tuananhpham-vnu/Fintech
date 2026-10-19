'use client'
import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/modal'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { useResource } from '@/hooks/use-resource'
import { useMutation } from '@/hooks/use-mutation'
import { useCounterpartyOptions } from '@/features/counterparties/hooks/use-counterparty-options'
import { useLocale } from '@/lib/i18n/locale-provider'
import { companyHealthText } from '@/lib/i18n/company-health-copy'
import { casesApi } from '../api'

export function CompanyHealthDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const { t, locale } = useLocale(),
    router = useRouter(),
    action = useMutation()
  const [party, setParty] = useState(''),
    [reason, setReason] = useState('')
  const { options, parties, setCursor } = useCounterpartyOptions(true)
  const load = useCallback((signal: AbortSignal) => casesApi.companyCapabilities(signal), [])
  const capability = useResource(load)
  const copy = (key: Parameters<typeof companyHealthText>[1]) => companyHealthText(locale, key)
  return (
    <Modal title={copy('create')} onClose={onClose} dirty={!!party || !!reason} busy={action.busy}>
      <p>{copy('intro')}</p>
      <ErrorNotice error={capability.error} retry={capability.reload} />
      {capability.data?.available === false && (
        <p className="warning-banner" role="status">
          {copy('pending')}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!capability.data?.available) return
          const body = {
            schema_version: 'AIC-COMPANY-HEALTH-1' as const,
            counterparty_id: party,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          }
          void action.run(
            (keys) => casesApi.createCompany(body, keys.for('/company-assessments', body)),
            (result) => {
              onSaved()
              onClose()
              router.push(`/cases/${result.id}`)
            },
          )
        }}
      >
        <fieldset disabled={action.busy || !capability.data?.available}>
          <label className="field-label">
            {copy('company')} *
            <select required value={party} onChange={(e) => setParty(e.target.value)}>
              <option value="">{t('select')}</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.tax_id ?? '—'}
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
          <label className="field-label">
            {copy('reason')}
            <textarea maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </fieldset>
        <Link className="text-button" href="/counterparties">
          {t('newParty')}
        </Link>
        <ErrorNotice error={action.error} />
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={action.busy}
            onClick={onClose}
          >
            {t('cancel')}
          </button>
          <button
            className="primary-button"
            disabled={action.busy || !capability.data?.available || !party}
          >
            {copy('create')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
