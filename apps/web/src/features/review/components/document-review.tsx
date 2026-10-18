'use client'
import { TechnicalDetails } from '@/components/ui/technical-details'
import { Empty } from '@/components/feedback/empty'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { Success } from '@/components/feedback/success'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { SectionHeading } from '@/components/ui/section-heading'
import { Status } from '@/components/ui/status'
import { casesApi } from '@/features/cases/api'
import type { SourceTarget } from '@/features/evidence/types'
import { reviewApi } from '@/features/review/api'
import { IssueDecision } from '@/features/review/components/issue-decision'
import { useMutation } from '@/hooks/use-mutation'
import type { CaseDetail, Finding, Readiness } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import {
  localizeAbsenceBasis,
  localizeCategory,
  localizeFindingSummary,
  localizeFindingLimitation,
  localizeLimitation,
  localizeRequirementKey,
  localizeRuleId,
  systemLabel,
} from '@/lib/i18n/review-i18n'
import { useState } from 'react'
import { useReviewRun } from '../hooks/use-review-run'
export function DocumentReview({
  detail,
  readiness,
  reload,
  openSource,
}: {
  detail: CaseDetail
  readiness: Readiness | null
  reload: () => void
  openSource: (s: SourceTarget) => void
}) {
  const { t, locale } = useLocale(),
    action = useMutation(),
    [decision, setDecision] = useState<{
      finding: Finding
      action: 'resolve' | 'dismiss' | 'reopen'
    } | null>(null),
    [waiver, setWaiver] = useState<Readiness['waivable_requirements'][number] | null>(null),
    [revoke, setRevoke] = useState<string | null>(null)
  const { run, findings, stale, running } = useReviewRun(detail)
  const reloadReview = () => {
    run.reload()
    reload()
  }
  return (
    <>
      <SectionHeading title={t('review')}>
        <button
          className="secondary-button"
          onClick={() => {
            run.reload()
            reload()
          }}
        >
          {t('refresh')}
        </button>
        <button
          className="primary-button"
          disabled={!readiness?.document_review_allowed || action.busy || !!running}
          onClick={() => {
            const body = { expected_revision: detail.revision }
            void action.run((keys) => reviewApi.run(detail.id, body, keys), reload)
          }}
        >
          {t(action.busy ? 'working' : 'runReview')}
        </button>
      </SectionHeading>
      <ErrorNotice error={action.error} />
      <ErrorNotice error={run.error} retry={run.reload} />
      <Success show={action.success} />
      {detail.transaction_review && (
        <section className="panel aic-section">
          <h3>{t('transactionReview')}</h3>
          <Status value={detail.transaction_review.status} />
          {stale && <Status value="stale" tone="amber" />}
          {detail.transaction_review.limitations.map((limitation, i) => (
            <p key={i} className="help-text">
              {localizeLimitation(limitation, locale)}
            </p>
          ))}
        </section>
      )}
      {run.loading && <Loading />}
      {run.data && (
        <div className="aic-run-strip">
          <Status value={run.data.state} />
          <span>
            {t('revision')} {run.data.case_revision}
          </span>
          <TechnicalDetails>
            <p>
              {run.data.rules_version} · {run.data.policy_version}
            </p>
          </TechnicalDetails>
          {stale && <Status value="stale" tone="amber" />}
        </div>
      )}
      {!findings.length ? (
        <section className="panel">
          <Empty>
            <p>{t(!run.data ? 'reviewFirst' : run.data.state)}</p>
          </Empty>
        </section>
      ) : (
        <div className="question-list">
          {findings.map((f) => (
            <article className="panel aic-section" key={f.id}>
              <div className="question-card-heading">
                <div>
                  <p className="eyebrow">
                    {systemLabel(f.rule_id, localizeRuleId(f.rule_id, locale), locale)} ·{' '}
                    {systemLabel(f.category, localizeCategory(f.category, locale), locale)}
                  </p>
                  <h3>{localizeFindingSummary(f, locale)}</h3>
                  <TechnicalDetails>
                    <p className="mono">
                      {f.rule_id} · {f.category} · {f.id}
                    </p>
                  </TechnicalDetails>
                </div>
                <Status value={f.severity} />
              </div>
              <div className="status-trio">
                <Status value={f.finding_state} />
                <Status value={f.handling_state} />
              </div>
              {f.absence_basis && <p>{localizeAbsenceBasis(f.absence_basis, locale)}</p>}
              {(run.data?.issue_history ?? detail.issue_history)?.some(
                (item) => item.id === f.id,
              ) && <p className="help-text">{t('issueNoLongerDetected')}</p>}
              {f.limitations.map((text, i) => (
                <p key={i} className="help-text">
                  {localizeFindingLimitation(f, text, i, locale)}
                </p>
              ))}
              <div className="wrap-actions">
                {f.evidence_refs.map((id, i) => (
                  <button
                    className="text-button"
                    key={id}
                    onClick={() => openSource({ evidenceId: id })}
                  >
                    {t('source')} {i + 1}
                  </button>
                ))}
              </div>
              <div className="request-actions">
                {f.finding_state === 'open' ? (
                  <>
                    <button
                      className="secondary-button"
                      disabled={
                        !!stale ||
                        run.data?.state !== 'completed' ||
                        !!run.data?.findings.some((item) => item.id === f.id)
                      }
                      onClick={() => setDecision({ finding: f, action: 'resolve' })}
                    >
                      {t('resolve')}
                    </button>
                    <button
                      className="text-button"
                      disabled={!!stale || !run.data}
                      onClick={() => setDecision({ finding: f, action: 'dismiss' })}
                    >
                      {t('dismiss')}
                    </button>
                  </>
                ) : (
                  <button
                    className="text-button"
                    disabled={!!stale}
                    onClick={() => setDecision({ finding: f, action: 'reopen' })}
                  >
                    {t('reopen')}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {!!readiness?.waivable_requirements.length && (
        <section className="panel aic-section">
          <h3>{t('waive')}</h3>
          <p>{t('waiverHelp')}</p>
          {readiness.waivable_requirements.map((item) => (
            <div key={item.requirement_key} className="aic-checklist-row">
              <span>{localizeRequirementKey(item.label ?? item.requirement_key, locale)}</span>
              <button className="secondary-button" onClick={() => setWaiver(item)}>
                {t('waive')}
              </button>
            </div>
          ))}
        </section>
      )}
      {!!detail.waivers?.length && (
        <section className="panel aic-section">
          <h3>{t('waive')}</h3>
          {detail.waivers.map((item) => (
            <article className="aic-checklist-row" key={item.id}>
              <div>
                <strong>{localizeRequirementKey(item.requirement_key ?? item.id, locale)}</strong>
                <p>{item.reason}</p>
                <Status value={item.active ? 'waived' : 'revoked'} />
              </div>
              {item.active && (
                <button className="secondary-button" onClick={() => setRevoke(item.id)}>
                  {t('revoke')}
                </button>
              )}
            </article>
          ))}
        </section>
      )}
      {decision && (
        <IssueDecision
          detail={detail}
          decision={decision}
          reload={reloadReview}
          onClose={() => setDecision(null)}
        />
      )}{' '}
      {waiver && (
        <ActionDialog
          title={t('waive')}
          loadLatest={() => casesApi.detail(detail.id)}
          revision={detail.revision}
          onClose={() => setWaiver(null)}
          onSaved={reload}
          help={t('waiverHelp')}
          submit={(reason, revision, keys) => {
            const body = {
              expected_revision: revision,
              requirement_key: waiver.requirement_key,
              ...(waiver.issue_id ? { issue_id: waiver.issue_id } : {}),
              reason,
            }
            return reviewApi.waive(detail.id, body, keys.for('waive:' + detail.id, body))
          }}
        >
          <p>{localizeRequirementKey(waiver.label ?? waiver.requirement_key, locale)}</p>
        </ActionDialog>
      )}
      {revoke && (
        <ActionDialog
          title={t('revoke')}
          loadLatest={() => casesApi.detail(detail.id)}
          revision={detail.revision}
          onClose={() => setRevoke(null)}
          onSaved={reload}
          submit={(reason, revision, keys) => {
            return reviewApi.revoke(revoke, { expected_revision: revision, reason }, keys)
          }}
        />
      )}
    </>
  )
}
