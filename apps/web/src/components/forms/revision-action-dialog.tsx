'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Modal } from '@/components/ui/modal'
import { useMutation } from '@/hooks/use-mutation'
import { ApiError, MutationKey } from '@/lib/api/client'
import { type Case } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { formatMoney } from '@/lib/utils/money'
import { useRef, useState, type ReactNode } from 'react'
export function ActionDialog({
  title,
  loadLatest,
  revision,
  children,
  onClose,
  onSaved,
  submit,
  help,
}: {
  title: string
  loadLatest: () => Promise<Case>
  revision: number
  children?: ReactNode
  help?: string
  onClose: () => void
  onSaved: () => void
  submit: (reason: string, revision: number, keys: MutationKey) => Promise<unknown>
}) {
  const { t, locale } = useLocale(),
    action = useMutation(),
    [reason, setReason] = useState(''),
    [changed, setChanged] = useState(false),
    [base, setBase] = useState(revision),
    [latest, setLatest] = useState<Case | null>(null),
    capture = useRef(submit)
  capture.current = submit
  return (
    <Modal title={title} onClose={onClose} dirty={changed} busy={action.busy}>
      <form
        onChange={() => setChanged(true)}
        onSubmit={(e) => {
          e.preventDefault()
          if (reason.trim().length < 3)
            return action.setError(new ApiError(422, 'INVALID_INPUT', ''))
          void action.run(
            (keys) => capture.current(reason.trim(), base, keys),
            () => {
              onSaved()
              onClose()
            },
          )
        }}
      >
        <fieldset disabled={action.busy}>
          {help && <p>{help}</p>}
          {children}
          <label className="field-label">
            {t('reason')} *
            <textarea
              required
              minLength={3}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <ErrorNotice error={action.error} />
          {action.error instanceof ApiError && action.error.status === 409 && (
            <div className="aic-recovery">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void loadLatest().then(setLatest).catch(action.setError)}
              >
                {t('refresh')}
              </button>
              {latest && (
                <>
                  <p>
                    {t('revision')} {latest.revision} ·{' '}
                    {formatMoney(latest.exposure.amount_vnd, locale)} ·{' '}
                    {latest.exposure.contract_ref}
                  </p>
                  <p>{t('conflict')}</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setBase(latest.revision)
                      action.setError(null)
                    }}
                  >
                    {t('keepEditing')}
                  </button>
                </>
              )}
            </div>
          )}
          <div className="dialog-actions">
            <button type="submit" className="primary-button">
              {t(action.busy ? 'working' : 'save')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
