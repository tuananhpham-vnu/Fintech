'use client'
import { ApiError } from '@/lib/api/client'
import { useLocale } from '@/lib/i18n/locale-provider'
import { type MessageKey } from '@/lib/i18n/messages'
import { AlertCircle } from 'lucide-react'
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useLocale()
  if (!error) return null
  const api = error instanceof ApiError ? error : null
  const specific: Record<string, MessageKey> = {
    FINANCIAL_COUNTRY_MISMATCH: 'financialImportCountryMismatch',
    FINANCIAL_SCOPE_MISMATCH: 'financialImportScopeMismatch',
    FINANCIAL_PAGE_SELECTION_REQUIRED: 'financialImportPages',
    FINANCIAL_OCR_PAGE_LIMIT: 'financialImportPages',
    FINANCIAL_TEXT_LIMIT: 'financialImportPages',
    FINANCIAL_SOURCE_REVIEW_REQUIRED: 'financialImportReviewRequired',
    FINANCIAL_IMPORT_VALUE_OR_SCOPE_CHANGED: 'financialImportLockedValue',
    INVALID_MODEL_OUTPUT: 'financialImportUncertain',
    RECHECK_REQUIRED: 'responseRecheckRequired',
    RESPONSE_SOURCE_REVIEW_REQUIRED: 'responseSourceReviewRequired',
    REVIEW_BLOCKED: 'reviewBlocked',
    INVALID_REQUEST_STATE: 'requestStateConflict',
  }
  const key: MessageKey =
    api?.code && Object.hasOwn(specific, api.code)
      ? specific[api.code]
      : api?.code === 'ASSESSMENT_NOT_READY'
        ? 'assessmentNotReady'
        : api?.code === 'STALE_ASSESSMENT'
          ? 'staleAssessment'
          : api?.code === 'ASSESSMENT_ALREADY_ACKNOWLEDGED'
            ? 'assessmentAlreadyAcknowledged'
            : api?.code === 'STALE_REVIEW'
              ? 'staleReview'
              : api?.code === 'EXTRACTION_NOT_AVAILABLE'
                ? 'extractionUnavailable'
                : api?.code === 'CONTRACT_NOT_RELEASED'
                  ? 'integrationPending'
                  : api?.code === 'STALE_SOURCE'
                    ? 'sourceStale'
                    : api?.code === 'INVALID_API_RESPONSE'
                      ? 'invalidResponse'
                      : api?.status === 413 || api?.status === 415 || api?.code === 'INVALID_PDF'
                        ? 'invalidFile'
                        : api?.status === 409
                          ? api.code === 'REVISION_CONFLICT'
                            ? 'conflict'
                            : 'actionBlocked'
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
        {api?.requestId && (
          <details>
            <summary>{t('requestId')}</summary>
            <small>{api.requestId}</small>
          </details>
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
