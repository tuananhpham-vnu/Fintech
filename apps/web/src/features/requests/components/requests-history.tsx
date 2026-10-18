'use client'
import { Empty } from '@/components/feedback/empty'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { SectionHeading } from '@/components/ui/section-heading'
import { Status } from '@/components/ui/status'
import { casesApi } from '@/features/cases/api'
import { CaseHistory } from '@/features/history/components/case-history'
import { requestsApi } from '@/features/requests/api'
import { RequestDraft } from '@/features/requests/components/request-draft'
import { useMutation } from '@/hooks/use-mutation'
import { type CaseDetail, type DocumentRequest } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '@/lib/api/client'
function requestContent(request: DocumentRequest): string {
  const approved = request.approved_payload
  if (
    approved &&
    typeof approved === 'object' &&
    'content' in approved &&
    typeof approved.content === 'string'
  )
    return approved.content
  return request.content ?? '—'
}
export function RequestsHistory({ detail, reload }: { detail: CaseDetail; reload: () => void }) {
  const { t } = useLocale(),
    action = useMutation(),
    [editing, setEditing] = useState<DocumentRequest | 'new' | null>(null),
    [decision, setDecision] = useState<{
      request: DocumentRequest
      mode: 'approve' | 'cancel' | 'ack'
    } | null>(null)
  async function download(id: string) {
    const blob = await requestsApi.export(id)
    const url = URL.createObjectURL(blob),
      link = document.createElement('a')
    link.href = url
    link.download = `request-${id}.txt`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function downloadContent(id: string) {
    const original = await requestsApi.export(id)
    let approved: unknown
    try {
      approved = JSON.parse(await original.text())
    } catch {
      throw new ApiError(502, 'INVALID_API_RESPONSE', '')
    }
    if (
      !approved ||
      typeof approved !== 'object' ||
      !('purpose' in approved) ||
      typeof approved.purpose !== 'string' ||
      !('content' in approved) ||
      typeof approved.content !== 'string'
    )
      throw new ApiError(502, 'INVALID_API_RESPONSE', '')
    const url = URL.createObjectURL(
      new Blob([`${approved.purpose}\n\n${approved.content}\n\n${t('noAutoApproval')}\n`], {
        type: 'text/plain;charset=utf-8',
      }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'aic-document-request.txt'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <>
      <SectionHeading title={t('history')}>
        <button className="primary-button" onClick={() => setEditing('new')}>
          {t('request')}
        </button>
      </SectionHeading>
      <ErrorNotice error={action.error} />
      <div className="requests-grid">
        <section className="panel request-section">
          <div className="section-title">
            <h3>{t('request')}</h3>
          </div>
          {detail.requests === undefined ? (
            <p className="aic-section">{t('integrationPending')}</p>
          ) : detail.requests.length ? (
            detail.requests.map((r) => (
              <article key={r.id} className="request-card">
                <div className="request-card-heading">
                  <strong>{r.purpose}</strong>
                  <Status value={r.status} />
                </div>
                <p>{r.purpose}</p>
                <pre className="request-preview">{requestContent(r)}</pre>
                <div className="binding-grid">
                  <span>{t('revision')}</span>
                  <strong>{r.revision}</strong>
                  <span>{t('review')}</span>
                  <strong>{t('review')}</strong>
                </div>
                <div className="request-actions">
                  {r.status === 'draft' && (
                    <>
                      <button className="secondary-button" onClick={() => setEditing(r)}>
                        {t('edit')}
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => setDecision({ request: r, mode: 'approve' })}
                      >
                        {t('approve')}
                      </button>
                    </>
                  )}
                  {r.approved_payload !== undefined && (
                    <button
                      className="secondary-button"
                      disabled={action.busy}
                      onClick={() => void action.run(() => downloadContent(r.id))}
                    >
                      <Download size={15} />
                      {t('export')}
                    </button>
                  )}
                  {r.approved_payload !== undefined && (
                    <details>
                      <summary>{t('requestRecord')}</summary>
                      <p className="help-text">{t('requestRecordHelp')}</p>
                      <button
                        className="text-button"
                        disabled={action.busy}
                        onClick={() => void action.run(() => download(r.id))}
                      >
                        {t('downloadRecord')}
                      </button>
                    </details>
                  )}
                  {['draft', 'approved'].includes(r.status) && (
                    <button
                      className="text-button"
                      onClick={() => setDecision({ request: r, mode: 'cancel' })}
                    >
                      {t('cancel')}
                    </button>
                  )}
                  {r.status === 'approved' && (
                    <button
                      className="secondary-button"
                      onClick={() => setDecision({ request: r, mode: 'ack' })}
                    >
                      {t('acknowledgeResponse')}
                    </button>
                  )}
                </div>
              </article>
            ))
          ) : (
            <Empty>
              <p>{t('noRequests')}</p>
            </Empty>
          )}
        </section>
        <CaseHistory detail={detail} />
      </div>
      {editing && (
        <RequestDraft
          initial={editing === 'new' ? undefined : editing}
          detail={detail}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {decision && (
        <ActionDialog
          title={t(
            decision.mode === 'approve'
              ? 'approve'
              : decision.mode === 'ack'
                ? 'acknowledgeResponse'
                : 'cancel',
          )}
          loadLatest={() => casesApi.detail(detail.id)}
          revision={detail.revision}
          onClose={() => setDecision(null)}
          onSaved={reload}
          submit={(reason, revision, keys) => {
            return requestsApi.decide(
              decision.request.id,
              decision.mode,
              { expected_revision: revision, reason },
              keys,
            )
          }}
        >
          <p>{decision.request.purpose}</p>
          <pre className="request-preview">{requestContent(decision.request)}</pre>
        </ActionDialog>
      )}
    </>
  )
}
