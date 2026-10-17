'use client'
import { useLocale } from '@/lib/i18n/locale-provider'
import { useEffect, useRef } from 'react'
export function LeavePrompt({ stay, leave }: { stay: () => void; leave: () => void }) {
  const ref = useRef<HTMLDialogElement>(null),
    { t } = useLocale()
  useEffect(() => {
    const node = ref.current
    node?.showModal()
    return () => node?.close()
  }, [])
  return (
    <dialog
      className="modal leave-prompt"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        stay()
      }}
    >
      <div className="modal-content">
        <h2>{t('unsaved')}</h2>
        <div className="dialog-actions">
          <button className="secondary-button" onClick={stay}>
            {t('keepEditing')}
          </button>
          <button className="primary-button" onClick={leave}>
            {t('discard')}
          </button>
        </div>
      </div>
    </dialog>
  )
}
