'use client'
import { Empty } from '@/components/feedback/empty'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { Success } from '@/components/feedback/success'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { SectionHeading } from '@/components/ui/section-heading'
import { Status } from '@/components/ui/status'
import { assessmentsApi } from '@/features/assessments/api'
import { FactorDetail } from '@/features/assessments/components/factor-detail'
import { FhiBreakdown } from '@/features/assessments/components/fhi-breakdown'
import { hasCompleteFhi } from '@/features/assessments/fhi'
import { casesApi } from '@/features/cases/api'
import type { SourceTarget } from '@/features/evidence/types'
import { useMutation } from '@/hooks/use-mutation'
import { type CaseDetail, type Factor, type Readiness } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import {
  localizeBlocker,
  localizeLimitation,
  localizeRequirementKey,
  localizeRuleId,
} from '@/lib/i18n/review-i18n'
import { formatTime } from '@/lib/utils/format'
import { useState } from 'react'
import { useAssessment } from '../hooks/use-assessment'
import { FinancialInformation } from '@/features/financial/components/financial-registry'
export function RiskAssessment({
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
    [selected, setSelected] = useState<Factor | null>(null),
    [ack, setAck] = useState(false)
  const { resource, result, stale, allowed } = useAssessment(detail, readiness)
  const showNumbers =
    allowed &&
    !stale &&
    hasCompleteFhi(result) &&
    ['completed', 'provisional'].includes(result?.state ?? '')
  return (
    <>
      <FinancialInformation detail={detail} reload={reload} openSource={openSource} />
      <SectionHeading title={t('assessment')} help={t('noAutoApproval')}>
        <button
          className="secondary-button"
          onClick={() => {
            resource.reload()
            reload()
          }}
        >
          {t('refresh')}
        </button>
        <button
          className="primary-button"
          disabled={
            !allowed ||
            action.busy ||
            !!detail.jobs?.some((j) => ['queued', 'running'].includes(j.state))
          }
          onClick={() => {
            const body = { expected_revision: detail.revision }
            void action.run((keys) => assessmentsApi.run(detail.id, body, keys), reload)
          }}
        >
          {t(action.busy ? 'working' : 'runAssessment')}
        </button>
      </SectionHeading>
      <ErrorNotice error={action.error} />
      <ErrorNotice error={resource.error} retry={resource.reload} />
      <Success show={action.success} />
      <section className="panel aic-section">
        <div className="section-title">
          <h3>{t('readiness')}</h3>
          <Status value={readiness?.method_status ?? 'missing'} />
        </div>
        <p>{t('methodHelp')}</p>
        <p className="help-text">{t('fhiScope')}</p>
        {readiness?.method_status !== 'validated_for_limited_use' && (
          <p className="warning-banner">{t('experimentalIndex')}</p>
        )}
        {readiness?.blockers.map((b) => (
          <p className="aic-blocker" key={b.code}>
            {localizeBlocker(b, locale)}
          </p>
        ))}
        {readiness?.limitations.map((l, i) => (
          <p className="help-text" key={i}>
            {localizeLimitation(l, locale)}
          </p>
        ))}
        {readiness?.waivable_requirements.map((item) => (
          <p key={item.requirement_key}>
            {t('waive')}: {localizeRequirementKey(item.label ?? item.requirement_key, locale)}
          </p>
        ))}
      </section>
      {resource.loading && <Loading />}
      {result ? (
        <>
          <div className="aic-run-strip">
            <Status value={result.state} />
            {stale && <Status value="stale" tone="amber" />}
            <span>
              {result.method_version} · {result.policy_version} · {t('revision')}{' '}
              {result.case_revision} · {formatTime(result.created_at, locale)}
            </span>
          </div>
          <div className="aic-result-grid">
            <article className="panel aic-section">
              <p>{t('financialIndex')}</p>
              <strong className="aic-score">
                {showNumbers ? (result.financial_health?.score ?? '—') : '—'}
              </strong>
            </article>
            <article className="panel aic-section">
              <p>{t('indexBand')}</p>
              <strong className="aic-score">
                {showNumbers ? (result.financial_health?.band ?? '—') : '—'}
              </strong>
            </article>
            <article className="panel aic-section">
              <p>{t('method')}</p>
              <strong>{result.method_version}</strong>
              <small className="aic-hash">{result.snapshot_hash}</small>
            </article>
          </div>
          <div className="aic-result-grid">
            {(['strengths', 'weaknesses', 'redFlags'] as const).map((key, index) => (
              <section className="panel aic-section" key={key}>
                <h3>{t(key)}</h3>
                <ul>
                  {[result.strengths, result.weaknesses, result.red_flags][index].map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="aic-factor-grid">
            {result.factors.map((f) => (
              <button key={f.factor_id} className="panel aic-factor" onClick={() => setSelected(f)}>
                <strong>{f.label}</strong>
                <Status value={f.status} />
                <p>{f.rationale}</p>
              </button>
            ))}
          </div>
          {result.limitations.length > 0 && (
            <section className="panel aic-section">
              <h3>{t('limitations')}</h3>
              <ul>
                {result.limitations.map((l, i) => (
                  <li key={i}>{localizeLimitation(l, locale)}</li>
                ))}
              </ul>
            </section>
          )}
          <button
            className="primary-button"
            disabled={!!stale || !['completed', 'provisional'].includes(result.state)}
            onClick={() => setAck(true)}
          >
            {t('acknowledge')}
          </button>
        </>
      ) : (
        <section className="panel">
          <Empty>
            <p>{t('noAssessment')}</p>
          </Empty>
        </section>
      )}
      <FhiBreakdown result={result} showNumbers={showNumbers} />
      <section className="panel aic-section">
        <h3>{t('transactionReview')}</h3>
        <p>{t('transactionReviewHelp')}</p>
        {result?.transaction_review ? (
          <>
            <Status value={result.transaction_review.status} />
            <p>{t(result.transaction_review.exposure_kind)}</p>
            {result.transaction_review.findings.map((finding, index) => (
              <article className="aic-checklist-row" key={`${finding.code}:${index}`}>
                <div>
                  <strong>{localizeRuleId(finding.code, locale)}</strong>
                  <p>
                    <Status value={finding.severity} /> ·{' '}
                    <Status value={finding.verification_state} />
                  </p>
                  {finding.evidence_refs.map((id, i) => (
                    <button
                      className="text-button"
                      key={id}
                      onClick={() => openSource({ evidenceId: id })}
                    >
                      {t('source')} {i + 1}
                    </button>
                  ))}
                </div>
              </article>
            ))}
            {result.transaction_review.limitations?.map((item, index) => (
              <p key={index}>{localizeLimitation(item, locale)}</p>
            ))}
          </>
        ) : (
          <p>{t('integrationPending')}</p>
        )}
        <a className="text-button" href="#review">
          {t('review')}
        </a>
      </section>
      <section className="panel aic-section">
        <h3>{t('metrics')}</h3>
        {detail.financial_metrics?.length ? (
          detail.financial_metrics.map((m) => (
            <article className="aic-checklist-row" key={m.metric_id}>
              <div>
                <strong>
                  {m.metric_id}: {m.status === 'available' ? m.value : '—'}
                </strong>
                <p>
                  {m.formula_id} · {m.period}
                </p>
                {m.reason && <p>{m.reason}</p>}
                <div className="wrap-actions">
                  {m.input_refs.map((id, i) => (
                    <button
                      className="text-button"
                      key={id}
                      onClick={() => openSource({ evidenceId: id })}
                    >
                      {t('source')} {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          ))
        ) : (
          <p>{t('empty')}</p>
        )}
      </section>
      {selected && (
        <FactorDetail factor={selected} onClose={() => setSelected(null)} openSource={openSource} />
      )}
      {ack && result && (
        <ActionDialog
          title={t('acknowledge')}
          help={t('acknowledgeHelp')}
          loadLatest={() => casesApi.detail(detail.id)}
          revision={detail.revision}
          onClose={() => setAck(false)}
          onSaved={reload}
          submit={(reason, revision, keys) => {
            return assessmentsApi.acknowledge(
              result.id,
              { expected_revision: revision, reason },
              keys,
            )
          }}
        />
      )}
    </>
  )
}
