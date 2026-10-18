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
import type { Factor } from '@/lib/api/contracts'
import { FhiBreakdown } from '@/features/assessments/components/fhi-breakdown'
import { hasCompleteFhi } from '@/features/assessments/fhi'
import { casesApi } from '@/features/cases/api'
import type { SourceTarget } from '@/features/evidence/types'
import { useMutation } from '@/hooks/use-mutation'
import { type CaseDetail, type Readiness } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import {
  localizeBlocker,
  localizeFindingSummary,
  localizeLimitation,
  localizeRequirementKey,
  localizeRuleId,
} from '@/lib/i18n/review-i18n'
import { formatTime } from '@/lib/utils/format'
import { useCallback, useEffect, useState } from 'react'
import { useResource } from '@/hooks/use-resource'
import { useAssessment } from '../hooks/use-assessment'
import { FinancialInformation } from '@/features/financial/components/financial-registry'
import { financialLabel } from '@/features/financial/labels'
import { financialApi } from '@/features/financial/api'
import { productText, presentNote, isSyntheticText } from '@/lib/i18n/product-copy'
import { specialistText } from '@/lib/i18n/specialist-copy'
import type { FinancialAction } from '@/features/financial/presentation'
import { FinancialInsights } from '@/features/financial/components/financial-insights'
import { useSession } from '@/lib/auth/session-context'
import type { Counterparty } from '@/lib/api/contracts'
export function RiskAssessment({
  detail,
  readiness: initialReadiness,
  reload,
  openSource,
  party,
}: {
  detail: CaseDetail
  readiness: Readiness | null
  reload: () => void
  openSource: (s: SourceTarget) => void
  party?: Counterparty | null
}) {
  const { t, locale } = useLocale(),
    action = useMutation(),
    [ack, setAck] = useState(false)
  const [selected, setSelected] = useState<Factor | null>(null)
  const [financialSet, setFinancialSet] = useState('')
  const [selectedAssessment, setSelectedAssessment] = useState('')
  const [historyCursor, setHistoryCursor] = useState<string>()
  const [financialAction, setFinancialAction] = useState<FinancialAction>()
  const { session } = useSession()
  const storageKey = `aic:financial-view:${session?.user.id}:${detail.id}`
  const [restoredKey, setRestoredKey] = useState('')
  const loadHistory = useCallback(
    (signal: AbortSignal) => assessmentsApi.history(detail.id, signal, historyCursor),
    [detail.id, detail.revision, historyCursor],
  )
  const history = useResource(loadHistory)
  useEffect(() => {
    let saved: { set?: string; assessment?: string } = {}
    try {
      saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}')
    } catch {}
    const id = /^[a-f0-9-]{36}$/
    setFinancialSet(typeof saved.set === 'string' && id.test(saved.set) ? saved.set : '')
    setSelectedAssessment(
      typeof saved.assessment === 'string' && id.test(saved.assessment) ? saved.assessment : '',
    )
    setRestoredKey(storageKey)
    setHistoryCursor(undefined)
    setAck(false)
  }, [detail.id, storageKey])
  useEffect(() => {
    if (restoredKey !== storageKey) return
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ set: financialSet, assessment: selectedAssessment }),
      )
    } catch {}
  }, [storageKey, restoredKey, financialSet, selectedAssessment])
  const { resource, result, stale, allowed, numericAllowed, readiness, readinessResource } =
    useAssessment(
      detail,
      initialReadiness,
      financialSet || undefined,
      selectedAssessment || undefined,
    )
  const loadSets = useCallback(
    (signal: AbortSignal) => financialApi.get(detail.id, signal, financialSet || undefined),
    [detail.id, detail.revision, financialSet],
  )
  const statementSets = useResource(loadSets)
  useEffect(() => {
    if (
      !statementSets.loading &&
      statementSets.data &&
      financialSet &&
      !statementSets.data.sets.some((s) => s.id === financialSet)
    )
      setFinancialSet('')
  }, [statementSets.data, statementSets.loading, financialSet])
  const resultSet = statementSets.data?.sets.find((s) => s.id === result?.financial_set_id)
  const periodMatches = !!financialSet && result?.financial_set_id === financialSet
  const currentResult =
    !!result && !stale && periodMatches && !resource.loading && !readinessResource.loading
  const requestFinancialAction = (kind: FinancialAction['kind'], factKey?: string) => {
    setFinancialAction((previous) => ({ kind, factKey, nonce: (previous?.nonce ?? 0) + 1 }))
    document
      .getElementById('financial-data')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const showNumbers =
    currentResult &&
    numericAllowed &&
    !stale &&
    hasCompleteFhi(result) &&
    ['completed', 'provisional'].includes(result?.state ?? '')
  const pilotObservation = (text: string) => {
    const match = /^(AIC-M0[1-7]): (maximum|zero) points in the AIC pilot rubric\.$/.exec(text)
    if (!match) return text
    const maximum = match[2] === 'maximum'
    return `${financialLabel(locale, 'metric', match[1]).label}: ${
      locale === 'vi'
        ? maximum
          ? 'đạt điểm tối đa theo thang pilot AIC.'
          : 'không đạt điểm theo thang pilot AIC.'
        : locale === 'zh-CN'
          ? maximum
            ? '在 AIC 试点评分规则中获得满分。'
            : '在 AIC 试点评分规则中得零分。'
          : maximum
            ? 'maximum points in the AIC pilot rubric.'
            : 'zero points in the AIC pilot rubric.'
    }`
  }
  return (
    <>
      <SectionHeading title={t('assessment')} help={t('noAutoApproval')}>
        <button
          className="secondary-button"
          onClick={() => {
            resource.reload()
            readinessResource.reload()
            history.reload()
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
            const body = {
              expected_revision: detail.revision,
              ...(financialSet ? { financial_set_id: financialSet } : {}),
            }
            void action.run(
              (keys) => assessmentsApi.run(detail.id, body, keys),
              () => {
                setSelectedAssessment('')
                setHistoryCursor(undefined)
                reload()
              },
            )
          }}
        >
          {t(action.busy ? 'working' : 'runAssessment')}
        </button>
      </SectionHeading>
      <section className="assessment-period panel aic-section">
        <label className="field-label">
          {productText(locale, 'selectedPeriod')}
          <select
            id="assessment-period-select"
            value={financialSet}
            onChange={(e) => setFinancialSet(e.target.value)}
          >
            <option value="">{productText(locale, 'selectPeriod')}</option>
            {statementSets.data?.sets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.scope.period.start_date}–{set.scope.period.end_date} ·{' '}
                {financialLabel(locale, 'basis', set.scope.basis).label} · {set.scope.currency}
              </option>
            ))}
          </select>
        </label>
        <ErrorNotice error={statementSets.error} retry={statementSets.reload} />
        {resultSet && (
          <p className="help-text">
            {productText(locale, 'resultPeriod')}: {resultSet.scope.period.start_date}–
            {resultSet.scope.period.end_date} ·{' '}
            {financialLabel(locale, 'basis', resultSet.scope.basis).label} ·{' '}
            {resultSet.scope.currency} ×{resultSet.scope.unit_multiplier}
          </p>
        )}
        {(readiness?.method_status !== 'validated_for_limited_use' ||
          resultSet?.facts.some(
            (f) => f.source.kind === 'manual_entry' && isSyntheticText(f.source.statement),
          )) && (
          <p className="warning-banner">
            {readiness?.method_status !== 'validated_for_limited_use' && t('experimentalIndex')}{' '}
            {resultSet?.facts.some(
              (f) => f.source.kind === 'manual_entry' && isSyntheticText(f.source.statement),
            ) && productText(locale, 'synthetic')}
          </p>
        )}
      </section>
      <section
        className="panel aic-section assessment-next-actions"
        aria-labelledby="assessment-next-title"
      >
        <div className="section-title">
          <h3 id="assessment-next-title">{specialistText(locale, 'nextActions')}</h3>
          <span className={`tag ${showNumbers ? 'green' : 'amber'}`}>
            {specialistText(locale, showNumbers ? 'ready' : 'needsData')}
          </span>
        </div>
        {!financialSet && <p>{specialistText(locale, 'periodRequired')}</p>}
        <div className="wrap-actions">
          {!financialSet && !!statementSets.data?.sets.length && (
            <button
              type="button"
              className="primary-button"
              onClick={() => document.getElementById('assessment-period-select')?.focus()}
            >
              {specialistText(locale, 'choose')}
            </button>
          )}
          {!statementSets.loading && !statementSets.data?.sets.length && (
            <button
              type="button"
              className="primary-button"
              onClick={() => requestFinancialAction('create')}
            >
              {specialistText(locale, 'addSet')}
            </button>
          )}
        </div>
        <ul className="readiness-task-list">
          {readiness?.blockers.map((blocker, index) => {
            const verify = [
              'UNVERIFIED_FACT',
              'STALE_FACT',
              'QUICK_ASSETS_UNAVAILABLE',
              'EBITDA_BRIDGE_UNAVAILABLE',
            ].includes(blocker.code)
            const edit = [
              'FINANCIAL_INPUTS_REQUIRED',
              'MISSING_FACT',
              'INVALID_FACT',
              'ACTUAL_KNOWN_ACCOUNTING_BASIS_REQUIRED',
              'EBITDA_NON_POSITIVE',
              'EBITDA_NONPOSITIVE',
              'BALANCE_SHEET_UNRECONCILED',
            ].includes(blocker.code)
            const review = /REVIEW|INPUTS_CHANGED|STALE_REVIEW/.test(blocker.code)
            return (
              <li key={`${blocker.code}:${index}`}>
                <span>
                  {financialLabel(locale, 'blocker', blocker.code).known
                    ? financialLabel(locale, 'blocker', blocker.code).label
                    : localizeBlocker(blocker, locale)}
                </span>
                {(verify || edit) && financialSet ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      requestFinancialAction(
                        verify ? 'verify' : 'edit',
                        blocker.code === 'UNVERIFIED_FACT'
                          ? statementSets.data?.sets
                              .find((s) => s.id === financialSet)
                              ?.facts.find((f) => f.verification.status !== 'verified')?.key
                          : undefined,
                      )
                    }
                  >
                    {specialistText(locale, verify ? 'verifyFacts' : 'editFacts')}
                  </button>
                ) : blocker.code === 'EXPLICIT_STATEMENT_SET_SELECTION_REQUIRED' ? (
                  <button
                    className="text-button"
                    onClick={() => document.getElementById('assessment-period-select')?.focus()}
                  >
                    {specialistText(locale, 'choose')}
                  </button>
                ) : review ? (
                  <a className="text-button" href="#review">
                    {specialistText(locale, 'reviewDocuments')}
                  </a>
                ) : (
                  <small>{specialistText(locale, 'methodHelp')}</small>
                )}
              </li>
            )
          })}
        </ul>
      </section>
      <ErrorNotice error={action.error} />
      <ErrorNotice error={resource.error} retry={resource.reload} />
      <ErrorNotice error={readinessResource.error} retry={readinessResource.reload} />
      <ErrorNotice error={history.error} retry={history.reload} />
      <Success show={action.success} />
      {resource.loading && <Loading />}
      {result ? (
        <>
          <div className="aic-run-strip">
            <span className={`tag ${showNumbers ? 'green' : 'amber'}`}>
              {specialistText(
                locale,
                currentResult ? (showNumbers ? 'ready' : 'saved') : 'historic',
              )}
            </span>
            {stale && <Status value="stale" tone="amber" />}
            <span>
              {t('revision')} {result.case_revision} · {formatTime(result.created_at, locale)}
            </span>
          </div>
          {financialSet && result.financial_set_id !== financialSet && (
            <p className="warning-banner">
              {locale === 'vi'
                ? 'Kết quả này thuộc bộ BCTC khác với bộ đang chọn. Chạy đánh giá mới cho bộ đã chọn để xem điểm tương ứng.'
                : locale === 'en'
                  ? 'This result belongs to a different statement set. Run a new assessment for the selected set to view its score.'
                  : '此结果属于另一套报表。请对所选报表重新评估以查看对应分值。'}
            </p>
          )}
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
            </article>
          </div>
          {!currentResult && (
            <p className="warning-banner">
              {specialistText(locale, 'historicHelp')} · {formatTime(result.created_at, locale)}
            </p>
          )}
          {currentResult ? (
            <div className="aic-result-grid">
              {(['strengths', 'weaknesses', 'redFlags'] as const).map((key, index) => (
                <section className="panel aic-section" key={key}>
                  <h3>{t(key)}</h3>
                  {![result.strengths, result.weaknesses, result.red_flags][index].length && (
                    <p className="help-text">{productText(locale, 'noObservation')}</p>
                  )}
                  <ul>
                    {[result.strengths, result.weaknesses, result.red_flags][index].map(
                      (text, i) => (
                        <li key={i}>
                          {key === 'redFlags'
                            ? localizeFindingSummary({ summary: text }, locale)
                            : pilotObservation(text)}
                        </li>
                      ),
                    )}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <details className="case-context historical-observations">
              <summary>
                {specialistText(locale, 'historic')} · {formatTime(result.created_at, locale)}
              </summary>
              <p>{specialistText(locale, 'historicHelp')}</p>
              {(['strengths', 'weaknesses', 'redFlags'] as const).map((key, index) => (
                <section key={key}>
                  <h3>{t(key)}</h3>
                  <ul>
                    {[result.strengths, result.weaknesses, result.red_flags][index].map(
                      (text, i) => (
                        <li key={i}>
                          {key === 'redFlags'
                            ? localizeFindingSummary({ summary: text }, locale)
                            : pilotObservation(text)}
                        </li>
                      ),
                    )}
                  </ul>
                </section>
              ))}
            </details>
          )}
          {result.limitations.length > 0 && (
            <details className="case-context">
              <summary>{t('limitations')}</summary>
              <h3>{t('limitations')}</h3>
              <ul>
                {result.limitations.map((l, i) => (
                  <li key={i}>{localizeLimitation(l, locale)}</li>
                ))}
              </ul>
            </details>
          )}
          <button
            className="primary-button"
            disabled={
              !currentResult ||
              !!result.acknowledged_by ||
              !['completed', 'provisional'].includes(result.state)
            }
            onClick={() => setAck(true)}
          >
            {t('acknowledge')}
          </button>
          {result.acknowledged_at && (
            <p className="help-text">
              {t('acknowledge')} · {formatTime(result.acknowledged_at, locale)} ·{' '}
              {presentNote(result.acknowledgement_reason, locale)}
            </p>
          )}
        </>
      ) : (
        <section className="panel">
          <Empty>
            <p>{t('noAssessment')}</p>
          </Empty>
        </section>
      )}
      <section className="panel aic-section assessment-readiness">
        <div className="section-title">
          <h3>{t('readiness')}</h3>
          <Status value={readiness?.method_status ?? 'missing'} />
          <button
            type="button"
            className="text-button"
            onClick={() =>
              financialSet
                ? requestFinancialAction('verify')
                : statementSets.data?.sets.length
                  ? document.getElementById('assessment-period-select')?.focus()
                  : requestFinancialAction('create')
            }
          >
            {productText(locale, 'facts')}
          </button>
        </div>
        {readiness?.blockers.map((b) => (
          <p className="aic-blocker" key={b.code}>
            {financialLabel(locale, 'blocker', b.code).known
              ? financialLabel(locale, 'blocker', b.code).label
              : localizeBlocker(b, locale)}
          </p>
        ))}
        <details>
          <summary>{productText(locale, 'calculation')}</summary>
          <p>{t('methodHelp')}</p>
          <p>{t('fhiScope')}</p>
          {readiness?.limitations.map((l, i) => (
            <p className="help-text" key={i}>
              {localizeLimitation(l, locale)}
            </p>
          ))}
          {readiness?.waivable_requirements.map((item) => (
            <p key={item.requirement_key}>
              {localizeRequirementKey(item.label ?? item.requirement_key, locale)}
            </p>
          ))}
        </details>
      </section>
      <FinancialInsights
        captureReady={!statementSets.loading && !resource.loading && !readinessResource.loading}
        detail={detail}
        selected={financialSet}
        select={setFinancialSet}
        result={result}
        current={currentResult}
        scored={showNumbers}
        readiness={readiness}
        party={party}
        openSource={openSource}
        observation={pilotObservation}
      />
      {!!history.data?.items.length && (
        <section className="panel aic-section assessment-history">
          <label className="field-label">
            {t('history')} · {t('assessment')}
            <select
              value={selectedAssessment}
              onChange={(e) => setSelectedAssessment(e.target.value)}
            >
              <option value="">
                {locale === 'vi'
                  ? 'Kết quả mới nhất'
                  : locale === 'en'
                    ? 'Latest result'
                    : '最新结果'}
              </option>
              {selectedAssessment &&
                !history.data.items.some((item) => item.id === selectedAssessment) && (
                  <option value={selectedAssessment}>
                    {result ? formatTime(result.created_at, locale) : t('working')}
                  </option>
                )}
              {history.data.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {formatTime(item.created_at, locale)} · {t('revision')} {item.case_revision}
                </option>
              ))}
            </select>
          </label>
          {(historyCursor || history.data.next_cursor) && (
            <div className="wrap-actions">
              <button
                className="secondary-button"
                disabled={!historyCursor}
                onClick={() => setHistoryCursor(undefined)}
              >
                {t('previous')}
              </button>
              <button
                className="secondary-button"
                disabled={!history.data.next_cursor}
                onClick={() => setHistoryCursor(history.data?.next_cursor ?? undefined)}
              >
                {t('next')}
              </button>
            </div>
          )}
        </section>
      )}
      <FhiBreakdown
        result={result}
        showNumbers={showNumbers}
        openSource={openSource}
        statementSet={resultSet}
        current={currentResult}
      />
      <FinancialInformation
        detail={detail}
        reload={reload}
        openSource={openSource}
        selectedSetId={financialSet}
        onSelectSet={setFinancialSet}
        actionRequest={financialAction}
      />

      {detail.purpose !== 'company_health' && (
        <section className="panel aic-section">
          <h3>{t('transactionReview')}</h3>
          <p>{t('transactionReviewHelp')}</p>
          {result?.transaction_review ? (
            <>
              <Status value={result.transaction_review.status} />
              <p>{t(result.transaction_review.exposure_kind)}</p>
              {result.transaction_review.findings.map((finding, index) => {
                const documentId =
                  /^(?:document_unverified|extraction_uncertain|document_subject_mismatch):(.+)$/.exec(
                    finding.code,
                  )?.[1]
                const document = detail.documents?.find((doc) => doc.id === documentId)
                return (
                  <article className="aic-checklist-row" key={`${finding.code}:${index}`}>
                    <div>
                      <strong>{localizeRuleId(finding.code, locale)}</strong>
                      {documentId && (
                        <p className="help-text">
                          {document?.name ?? t('source')} {document ? `· v${document.version}` : ''}{' '}
                          ·{' '}
                        </p>
                      )}
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
                )
              })}
              {result.transaction_review.limitations?.map((item, index) => (
                <p key={index}>{localizeLimitation(item, locale)}</p>
              ))}
            </>
          ) : (
            <p>{t('noAssessment')}</p>
          )}
          <a className="text-button" href="#review">
            {t('review')}
          </a>
        </section>
      )}
      {result?.factors
        .filter((f) => !financialLabel(locale, 'metric', f.factor_id).known)
        .map((f) => (
          <button key={f.factor_id} className="secondary-button" onClick={() => setSelected(f)}>
            {f.label}
          </button>
        ))}
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
