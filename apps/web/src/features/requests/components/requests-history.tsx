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
import { displayValue } from '@/lib/utils/format'
import { Download } from 'lucide-react'
import { useState } from 'react'
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
                  <strong>{r.id}</strong>
                  <Status value={r.status} />
                </div>
                <p>{r.purpose}</p>
                <pre className="request-preview">
                  {r.approved_payload !== undefined
                    ? displayValue(r.approved_payload)
                    : (r.content ?? '—')}
                </pre>
                <div className="binding-grid">
                  <span>{t('revision')}</span>
                  <strong>{r.revision}</strong>
                  <span>{t('review')}</span>
                  <strong>{r.run_id ?? '—'}</strong>
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
                      onClick={() => void action.run(() => download(r.id))}
                    >
                      <Download size={15} />
                      {t('export')}
                    </button>
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
          <pre className="request-preview">
            {displayValue(decision.request.approved_payload ?? decision.request.content)}
          </pre>
        </ActionDialog>
      )}
    </>
  )
}
