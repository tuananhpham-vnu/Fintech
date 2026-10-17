'use client'
import { useLeaveGuard } from '@/hooks/use-leave-guard'
import { useSession } from '@/lib/auth/session-context'
import { useLocale } from '@/lib/i18n/locale-provider'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
export function Modal({
  title,
  children,
  onClose,
  dirty = false,
  busy = false,
  drawer = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  dirty?: boolean
  busy?: boolean
  drawer?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId(),
    { t } = useLocale(),
    { status } = useSession(),
    { guard, prompt } = useLeaveGuard(dirty)
  useEffect(() => {
    const node = ref.current
    const opener = document.activeElement
    if (status !== 'expired') node?.showModal()
    else node?.close()
    return () => {
      node?.close()
      // React may remove the dialog before passive cleanup, leaving body
      // focused instead of the opener. Preserve focus chosen by any newer UI.
      if (
        document.activeElement === document.body &&
        opener instanceof HTMLElement &&
        opener.isConnected
      )
        opener.focus()
    }
  }, [status])
  return (
    <>
      <dialog
        className={drawer ? 'modal drawer aic-drawer' : 'modal'}
        ref={ref}
        aria-labelledby={id}
        onCancel={(e) => {
          e.preventDefault()
          if (!busy) guard(onClose)
        }}
      >
        <div className="modal-header">
          <h2 id={id}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label={t('close')}
            onClick={() => guard(onClose)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="modal-content">{children}</div>
      </dialog>
      {prompt}
    </>
  )
}
