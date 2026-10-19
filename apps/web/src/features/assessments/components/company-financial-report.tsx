'use client'
import { useCallback } from 'react'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { useMutation } from '@/hooks/use-mutation'
import { useResource } from '@/hooks/use-resource'
import type { CaseDetail, Readiness } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { companyHealthText } from '@/lib/i18n/company-health-copy'
import { displayDecimal, formatTime } from '@/lib/utils/format'
import { financialApi, type Registry } from '@/features/financial/api'
import { intakeProgress, intakeWarnings } from '@/features/financial/intake-model'
import type { IntakePage } from '@/features/financial/intake-api'
import { financialLabel } from '@/features/financial/labels'
import { formatExactRatio } from '@/features/financial/presentation'
import { assessmentsApi } from '../api'
import { useAssessment } from '../hooks/use-assessment'
import { fhiMetrics } from '../fhi'
import { companyResult, companyResultText } from '../company-result'
import { DataLimitedScore } from './data-limited-score'
import { CaseAggregationSources } from './case-aggregation-sources'

export function Radar({
  points,
  locale,
}: {
  points: { id: string; label: string; value: number | null }[]
  locale: Parameters<typeof companyHealthText>[0]
}) {
  const xy = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / points.length
    return [180 + Math.cos(a) * r, 165 + Math.sin(a) * r]
  }
  const complete = points.every((p) => p.value !== null)
  const available = points.filter(p => p.value !== null).length
  return (
    <figure className="financial-radar">
      <svg
        viewBox="0 0 360 340"
        role="img"
        aria-label={
          locale === 'vi' ? `Radar: ${available}/${points.length} chỉ tiêu có điểm`
            : locale === 'zh-CN' ? `雷达图：${available}/${points.length} 项指标有得分`
            : `Radar: ${available}/${points.length} metrics scored`
        }
      >
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <polygon
            key={r}
            points={points.map((_, i) => xy(i, 110 * r).join(',')).join(' ')}
            fill="none"
            stroke="currentColor"
            opacity=".14"
          />
        ))}
        {points.map((p, i) => {
          const [x, y] = xy(i, 138),
            end = xy(i, 110)
          return (
            <g key={p.id}>
              <line x1="180" y1="165" x2={end[0]} y2={end[1]} stroke="currentColor" opacity=".18" />
              <text x={x} y={y} textAnchor="middle" fontSize="11">
                {p.id.replace('AIC-', '')}
                <title>{`${p.label}: ${p.value === null
                    ? 'N/A'
                    : `${Math.round(p.value * 100)}% ${locale === 'vi' ? 'điểm tối đa' : locale === 'zh-CN' ? '满分' : 'of max'}`}`}</title>
              </text>
            </g>
          )
        })}
        {complete ? (
          <polygon
            points={points.map((p, i) => xy(i, 110 * p.value!).join(',')).join(' ')}
            fill="var(--aic-accent, #2c7666)"
            fillOpacity=".2"
            stroke="var(--aic-accent, #2c7666)"
            strokeWidth="2"
          />
        ) : points.some(p => p.value !== null) ? (
          points.map((p, i) => {
            if (p.value === null) return null
            const [x, y] = xy(i, 110 * p.value)
            return <circle key={p.id} cx={x} cy={y} r="4" fill="var(--aic-accent, #2c7666)">
              <title>{`${p.label}: ${Math.round(p.value * 100)}%`}</title>
            </circle>
          })
        ) : (
          <text x="180" y="170" textAnchor="middle" fontSize="22">N/A</text>
        )}
      </svg>
      <figcaption>{companyHealthText(locale, 'radarCaption')}</figcaption>
    </figure>
  )
}
export function CompanyFinancialReport({
  detail,
  registry,
  page,
  readiness: initial,
  reload,
  onSelectTab,
}: {
  detail: CaseDetail
  registry: Registry | null
  page: IntakePage
  readiness: Readiness | null
  reload: () => void
  onSelectTab?: (tab: string) => void
}) {
  const { locale } = useLocale(),
    copy = (key: Parameters<typeof companyHealthText>[1]) => companyHealthText(locale, key),
    action = useMutation()
  const latestDate = registry?.sets
    .map((s) => s.scope.period.end_date)
    .sort()
    .at(-1)
  const { resource, result, stale, allowed, readiness, readinessResource } = useAssessment(detail, initial)
  const loadTrends = useCallback(
    (signal: AbortSignal) => financialApi.trends(detail.id, signal),
    [detail.id, detail.revision],
  )
  const trends = useResource(loadTrends)
  const presentation = companyResult(result, {
    caseId: detail.id,
    revision: detail.revision,
    requireCaseAggregation: true,
    confirmed: page.review.confirmed,
    loading:
      resource.loading ||
      readinessResource.loading ||
      !!resource.error ||
      !!readinessResource.error,
    readiness,
  })
  const show = presentation.complete,
    partial = presentation.partial
  const resultCopy = companyResultText[locale]
  const health = show || !!partial ? result?.financial_health : null,
    progress = intakeProgress(page.items)
  const points = fhiMetrics.map((m) => {
    const c = health?.components.find((c) => c.metric_id === m.id)
      ?? partial?.components.find((c) => c.metric_id === m.id)
    return {
      id: m.id,
      label: financialLabel(locale, 'metric', m.id).label,
      value: c?.points != null ? Number(c.points) / Number(c.max_points) : null,
    }
  })
  const blocked = (readiness?.blockers ?? []).map((b) => b.code)
  function explain(code: string) {
    if (code === 'INCOMPATIBLE_CASE_SCOPE') return locale === 'vi'
      ? 'Các năm có cơ sở báo cáo, chế độ kế toán hoặc tiền tệ khác nhau. Cần đối chiếu trước khi tổng hợp.'
      : locale === 'zh-CN' ? '各年度口径、会计制度或币种不同，需核对后汇总。'
      : 'Annual reporting bases, accounting regimes or currencies differ. Reconcile before aggregation.'
    if (code === 'MULTIPLE_STATEMENT_VERSIONS') return locale === 'vi'
      ? 'Có nhiều bộ cùng kỳ chưa được đối chiếu nguồn.'
      : locale === 'zh-CN' ? '同期间存在尚未核对的多个版本。' : 'Same-period versions require source reconciliation.'
    if (code === 'FINANCIAL_REVIEW_ALL_REQUIRED')
      return locale === 'vi'
        ? 'Cần xác nhận rà soát tất cả tại tab Tài liệu.'
        : locale === 'zh-CN'
          ? '请在“文件”标签页确认全部核查。'
          : 'Confirm all reviews on the Documents tab.'
    if (code === 'SOURCE_PROCESSING')
      return locale === 'vi'
        ? 'Tài liệu đang được xử lý.'
        : locale === 'zh-CN'
          ? '文件正在处理中。'
          : 'Documents are currently being processed.'
    if (code === 'FINANCIAL_PERIOD_REVIEW_REQUIRED')
      return locale === 'vi'
        ? 'Còn kỳ báo cáo chưa được giải quyết. Rà soát tại tab Tài liệu.'
        : locale === 'zh-CN'
          ? '存在尚未解决的报告期，请在“文件”标签页核查。'
          : 'Unresolved reporting periods remain. Review on the Documents tab.'
    if (code === 'INVALID_SCOPE')
      return locale === 'vi'
        ? 'Thông tin doanh nghiệp đã thay đổi. Rà soát lại kỳ và số liệu tại tab Tài liệu.'
        : locale === 'zh-CN'
          ? '企业信息已发生变更，请在“文件”标签页重新核查报告期与数据。'
          : 'Enterprise information has changed. Review periods and facts on the Documents tab.'
    if (code === 'EXPLICIT_STATEMENT_SET_SELECTION_REQUIRED')
      return locale === 'vi'
        ? 'Có nhiều cơ sở báo cáo ở kỳ mới nhất. Chọn kỳ/cơ sở để chấm điểm.'
        : locale === 'zh-CN'
          ? '最新报告期存在多种编制口径，请选择要评分的报告期/口径。'
          : 'Multiple reporting bases available for the latest period. Select a period/basis to score.'
    return financialLabel(locale, 'blocker', code).label
  }
  function observation(text: string) {
    const match = /^(AIC-M0[1-7]): (maximum|zero) points in the AIC pilot rubric\.$/.exec(text)
    if (!match) return text
    const metricLabel = financialLabel(locale, 'metric', match[1]).label
    const isMax = match[2] === 'maximum'
    if (locale === 'vi') {
      return `${metricLabel}: ${isMax ? 'đạt điểm tối đa' : 'không đạt điểm'} theo method hiện tại.`
    }
    if (locale === 'zh-CN') {
      return `${metricLabel}：在当前方法下${isMax ? '获得满分' : '得0分'}。`
    }
    return `${metricLabel}: ${isMax ? 'maximum points' : 'zero points'} in the current method.`
  }
  return (
    <div className="company-financial-report">
      <div className="aic-list-heading">
        <div>
          <h2>
            <svg
              className="section-title-icon"
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {copy('financialOverviewHeading')}
          </h2>
          <p className="muted">{copy('financialMethodSubtitle')}</p>
        </div>
        <div className="wrap-actions">
          <span>
            {copy('latestPeriod')}: {latestDate ?? 'N/A'}
          </span>
          <button
            className="primary-button"
            disabled={
              !allowed || !page.review.confirmed || progress.active || action.busy
            }
            onClick={() =>
              void action.run(
                (keys) =>
                  assessmentsApi.run(
                    detail.id,
                    { expected_revision: page.revision },
                    keys,
                  ),
                () => {
                  reload()
                  resource.reload()
                  readinessResource.reload()
                  trends.reload()
                },
              )
            }
          >
            {action.busy ? copy('scoringAction') : copy('scoreAction')}
          </button>
        </div>
      </div>
      <ErrorNotice error={action.error} />
      <ErrorNotice error={resource.error} retry={resource.reload} />
      <ErrorNotice error={readinessResource.error} retry={readinessResource.reload} />
      <div className="financial-summary-grid">
        <article className="panel financial-total">
          {partial ? (
            <DataLimitedScore value={partial} locale={locale} />
          ) : (
            <>
              <p>{copy('totalScore')}</p>
              <strong>{health?.score ?? 'N/A'}</strong>
              <span>/ 100</span>
              <p>
                {health?.band
                  ? `${copy('band')} ${health.band}`
                  : presentation.current
                    ? resultCopy.completedBlocked
                    : copy('noScoreResult')}
              </p>
            </>
          )}
          {presentation.current && result && (
            <small>
              {resultCopy.completed}: {formatTime(result.created_at, locale)}
            </small>
          )}
          <small>{copy('experimentalIndicatorNote')}</small>
        </article>
        <article className="panel">
          <Radar points={points} locale={locale} />
        </article>
        <article className="panel aic-section docs-warnings-card">
          {/* Header */}
          <div className="dw-header">
            <div className="dw-title-wrap">
              <div className="dw-icon-badge" aria-hidden="true">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <h3 className="dw-title">{copy('documentsAndWarnings')}</h3>
            </div>
            {stale ? (
              <span className="dw-status-pill stale">● {copy('statusStale')}</span>
            ) : show || (blocked.length === 0 && page.review.confirmed) ? (
              <span className="dw-status-pill ready">● {copy('statusEligibleToScore')}</span>
            ) : (
              <span className="dw-status-pill needs-work">● {copy('statusNeedsWork')}</span>
            )}
          </div>

          {/* Ingestion stats bar */}
          <div className="dw-stats-bar">
            <div className="dw-stat-col">
              <span className="dw-stat-val">{progress.total}</span>
              <span className="dw-stat-label">{copy('statDocuments')}</span>
            </div>
            <div className="dw-stat-col">
              <span className={`dw-stat-val ${progress.success > 0 ? 'success' : ''}`}>
                {progress.success}
              </span>
              <span className="dw-stat-label">{copy('statExtractedOk')}</span>
            </div>
            <div className="dw-stat-col">
              <span className={`dw-stat-val ${progress.failed > 0 ? 'failed' : ''}`}>
                {progress.failed}
              </span>
              <span className="dw-stat-label">{copy('statFailed')}</span>
            </div>
          </div>

          {/* Review Confirmation Banner */}
          <div
            className={`dw-review-banner ${page.review.confirmed ? 'confirmed' : 'unconfirmed'}`}
          >
            <div className="dw-review-text">
              {page.review.confirmed ? (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              )}
              <span>
                {page.review.confirmed ? copy('reviewConfirmedAll') : copy('reviewUnconfirmed')}
              </span>
            </div>
            {!page.review.confirmed && onSelectTab && (
              <button type="button" className="dw-action-link" onClick={() => onSelectTab('files')}>
                {copy('btnGoToFiles')}
              </button>
            )}
          </div>

          {/* Stale result warning */}
          {stale && (
            <div className="dw-stale-banner">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span>{copy('staleWarning')}</span>
            </div>
          )}

          {/* Blockers & Conditions Section */}
          {!show && blocked.length > 0 ? (
            <div className="dw-blockers-section">
              <div className="dw-blockers-heading">
                <span>{partial
                  ? locale === 'vi' ? 'Phần chưa đủ dữ liệu trong tổng điểm'
                    : locale === 'zh-CN' ? '总分中数据尚不完整的部分' : 'Unresolved parts of the total score'
                  : copy('blockersHeading')}</span>
                <span className="dw-blockers-count">{blocked.length}</span>
              </div>
              <div className="dw-blocker-list">
                {blocked.slice(0, 5).map((code) => (
                  <div key={code} className="dw-blocker-item">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <div className="dw-blocker-text">{explain(code)}</div>
                  </div>
                ))}
              </div>
              {blocked.length > 5 && (
                <details className="dw-more-accordion">
                  <summary className="dw-more-summary">
                    <span>
                      +{blocked.length - 5} {copy('otherConditionsSuffix')}
                    </span>
                    <span>▾</span>
                  </summary>
                  <div className="dw-more-content">
                    {blocked.slice(5).map((code) => (
                      <div key={code} className="dw-blocker-item">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <div className="dw-blocker-text">{explain(code)}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div className="dw-ready-state">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <div>
                <div>{copy('allConditionsMet')}</div>
                <div
                  style={{ fontSize: '11.5px', fontWeight: 400, opacity: 0.9, marginTop: '2px' }}
                >
                  {copy('allConditionsMetDesc')}
                </div>
              </div>
            </div>
          )}
        </article>
      </div>
      {presentation.current && result?.case_aggregation && (show || partial) && <CaseAggregationSources value={result.case_aggregation} registry={registry} page={page} locale={locale} />}
      <section className="panel aic-section">
        <details>
          <summary>
            {locale === 'vi'
              ? `Tài liệu đã tải (${page.items.length}) và kết quả xử lý`
              : locale === 'zh-CN'
                ? `已上传文件 (${page.items.length}) 及处理结果`
                : `Uploaded documents (${page.items.length}) and processing results`}
          </summary>
          {page.items.map((item) => (
            <div key={item.id} className="financial-file-row">
              <div>
                <strong>{item.name}</strong>
                <p>
                  {item.classification?.document_type === 'other'
                    ? locale === 'vi'
                      ? 'Đã phân loại ngoài phạm vi BCTC'
                      : locale === 'zh-CN'
                        ? '已分类为非财报文件'
                        : 'Classified outside financial statement scope'
                    : item.state === 'failed'
                      ? locale === 'vi'
                        ? 'Xử lý thất bại — xem lỗi và thử lại ở tab Tài liệu'
                        : locale === 'zh-CN'
                          ? '处理失败 — 请在“文件”标签页查看错误并重试'
                          : 'Processing failed — view errors and retry on Documents tab'
                      : item.state === 'needs_review'
                        ? locale === 'vi'
                          ? 'Cần rà soát kỳ hoặc số liệu'
                          : locale === 'zh-CN'
                            ? '需要核查报告期或数据'
                            : 'Requires review of periods or facts'
                        : item.state === 'ready'
                          ? locale === 'vi'
                            ? 'Đã trích xuất'
                            : locale === 'zh-CN'
                              ? '已提取'
                              : 'Extracted'
                          : item.state === 'expanded'
                            ? locale === 'vi'
                              ? 'Đã mở ZIP'
                              : locale === 'zh-CN'
                                ? '已解压ZIP'
                                : 'Extracted ZIP'
                            : item.state === 'skipped'
                              ? locale === 'vi'
                                ? 'Không dùng để đánh giá'
                                : locale === 'zh-CN'
                                  ? '不用于评估'
                                  : 'Excluded from assessment'
                              : locale === 'vi'
                                ? 'Đang xử lý'
                                : locale === 'zh-CN'
                                  ? '处理中'
                                  : 'Processing'}
                </p>
                {intakeWarnings(item).map((w) => (
                  <p key={w} className="warning-banner">
                    {w}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </details>
      </section>
      <section className="panel aic-section">
        <h3>{copy('componentScoresHeading')}</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{copy('tableMetric')}</th>
                <th>{copy('tableValue')}</th>
                <th>{copy('tablePoints')}</th>
                <th>{copy('tableNotes')}</th>
              </tr>
            </thead>
            <tbody>
              {fhiMetrics.map((m) => {
                const component = health?.components.find((x) => x.metric_id === m.id),
                  caseMetric = presentation.current ? result?.case_aggregation?.metrics.find(x => x.metric_id === m.id) : null,
                  partialComponent = partial?.components.find((x) => x.metric_id === m.id)
                return (
                  <tr key={m.id}>
                    <th>{financialLabel(locale, 'metric', m.id).label}</th>
                    <td>{caseMetric?.contributions.length
                      ? `${caseMetric.contributions.length} ${locale === 'vi' ? 'năm hợp lệ' : locale === 'zh-CN' ? '个合格年度' : 'eligible years'}` : 'N/A'}</td>
                    <td>
                      {displayDecimal(component?.points ?? partialComponent?.points)} / {m.max}
                    </td>
                    <td>
                      {component?.blockers?.length
                        ? [...new Set(component.blockers.map((b) => explain(String(b))))].join(' · ')
                        : partialComponent
                          ? resultCopy.partialComponent
                          : show
                            ? copy('calculatedUnderMethod')
                            : copy('scoreNotAssigned')}
                      {component?.flags?.map((f) => (
                        <p key={f}>{financialLabel(locale, 'blocker', f).label}</p>
                      ))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div className="financial-observations">
        <section className="panel aic-section">
          <h3>{copy('strengthsHeading')}</h3>
          {show && result?.strengths.length ? (
            result.strengths.map((s, i) => <p key={i}>{observation(s)}</p>)
          ) : (
            <p className="muted">
              {show
                ? locale === 'vi'
                  ? 'Chưa có chỉ tiêu đạt điểm tối đa.'
                  : locale === 'zh-CN'
                    ? '暂无达到满分的指标。'
                    : 'No metric reached maximum points.'
                : presentation.current
                  ? resultCopy.blockedObservations
                  : locale === 'vi'
                    ? 'N/A — chưa có kết quả chấm điểm hiện tại.'
                    : locale === 'zh-CN'
                      ? 'N/A — 暂无当前评分结果。'
                      : 'N/A — no score result yet.'}
            </p>
          )}
        </section>
        <section className="panel aic-section">
          <h3>{copy('weaknessesHeading')}</h3>
          {show && result?.weaknesses.length ? (
            result.weaknesses.map((s, i) => <p key={i}>{observation(s)}</p>)
          ) : (
            <p className="muted">
              {show
                ? locale === 'vi'
                  ? 'Chưa có chỉ tiêu nhận điểm bằng 0.'
                  : locale === 'zh-CN'
                    ? '暂无获得0分的指标。'
                    : 'No metric received zero points.'
                : presentation.current
                  ? resultCopy.blockedObservations
                  : locale === 'vi'
                    ? 'N/A — chưa có kết quả chấm điểm hiện tại.'
                    : locale === 'zh-CN'
                      ? 'N/A — 暂无当前评分结果。'
                      : 'N/A — no score result yet.'}
            </p>
          )}
        </section>
      </div>
      <section className="panel aic-section">
        <h3>{copy('multiYearComparison')}</h3>
        <p className="muted">
          {locale === 'vi'
            ? 'Mỗi cột là một kỳ và cơ sở báo cáo. Kỳ thiếu dữ liệu có thể hiện N/A; các chỉ tiêu đủ điều kiện của kỳ khác vẫn được hiển thị. Khác biệt giữa các kỳ được ghi chú riêng.'
            : locale === 'zh-CN'
              ? '每列为一个报告期及口径。缺失数据可显示 N/A，其他期间符合条件的指标仍然显示。可比性差异单独注明。'
              : 'Each column represents a period and reporting basis. Missing data may show N/A; eligible metrics in other periods remain visible. Comparability differences are noted separately.'}
        </p>
        <p className="muted">
          {locale === 'vi'
            ? 'Xanh nhạt: có giá trị · Vàng: cần rà soát · Xám: N/A. Cột mới nhất được làm nổi bật.'
            : locale === 'zh-CN'
              ? '浅绿：有值 · 黄色：需核查 · 灰色：N/A。最新列突出显示。'
              : 'Light teal: value present · Yellow: review needed · Gray: N/A. Latest column highlighted.'}
        </p>
        <ErrorNotice error={trends.error} retry={trends.reload} />
        {trends.loading && <Loading />}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{copy('tableMetric')}</th>
                {trends.data?.rows.map((r) => (
                  <th key={r.set.id}>
                    {r.set.scope.period.end_date}
                    <small>
                      {r.set.scope.basis === 'consolidated'
                        ? copy('consolidated')
                        : copy('standalone')}{' '}
                      · {r.set.scope.currency}
                    </small>
                  </th>
                ))}
                {!trends.data?.rows.length && (
                  <th>
                    {locale === 'vi' ? 'Năm: N/A' : locale === 'zh-CN' ? '年份: N/A' : 'Year: N/A'}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {fhiMetrics.map((m) => (
                <tr key={m.id}>
                  <th>{financialLabel(locale, 'metric', m.id).label}</th>
                  {trends.data?.rows.length ? (
                    trends.data.rows.map((r) => (
                      <td
                        key={r.set.id}
                        className={`${r.set.scope.period.end_date === latestDate ? 'financial-latest' : ''} ${r.comparison_issues.length || r.metrics.find((x) => x.metric_id === m.id)?.blockers.length ? 'financial-value-review' : r.metrics.find((x) => x.metric_id === m.id)?.raw_ratio ? 'financial-value-present' : 'financial-value-missing'}`}
                        title={r.comparison_issues.map(explain).join(' · ')}
                      >
                        {formatExactRatio(
                          r.metrics.find((x) => x.metric_id === m.id)?.raw_ratio,
                          m.id,
                          locale,
                        )}
                      </td>
                    ))
                  ) : (
                    <td>N/A</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
