'use client'
import { ApiError } from '@/lib/api/client'
import { useLocale } from '@/lib/i18n/locale-provider'
import { type MessageKey } from '@/lib/i18n/messages'
import { AlertCircle } from 'lucide-react'
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useLocale()
  if (!error) return null
  const api = error instanceof ApiError ? error : null
  const key: MessageKey =
    api?.code === 'CONTRACT_NOT_RELEASED'
      ? 'integrationPending'
      : api?.code === 'STALE_SOURCE'
        ? 'sourceStale'
        : api?.code === 'INVALID_API_RESPONSE'
          ? 'invalidResponse'
          : api?.status === 413 || api?.status === 415 || api?.code === 'INVALID_PDF'
            ? 'invalidFile'
            : api?.status === 409
              ? 'conflict'
              : api?.status === 401
                ? 'expired'
                : api?.status === 403
                  ? 'forbidden'
                  : api?.status === 404
                    ? 'notFound'
                    : api?.status === 422 || api?.status === 400
                      ? 'invalid'
                      : api?.status === 429
                        ? 'limited'
                        : 'serviceHelp'
  return (
    <div className="aic-error" role="alert">
      <AlertCircle size={19} />
      <div>
        <p>{t(key)}</p>
        {api?.status === 422 && api.message && !/^[A-Z_]+$/.test(api.message) && (
          <p>{api.message}</p>
        )}
        {api?.requestId && (
          <small>
            {t('requestId')}: {api.requestId}
          </small>
        )}
        {retry && (
          <button type="button" className="text-button" onClick={retry}>
            {t('retry')}
          </button>
        )}
      </div>
    </div>
  )
}
