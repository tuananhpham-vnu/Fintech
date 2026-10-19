'use client'
import { importSourceUrl } from '../import-api'
import { useCallback, useState, useEffect, useRef } from 'react'
import { reportHtml } from '../report-html'
import { financialApi, type FinancialTrends } from '../api'
import { useResource } from '@/hooks/use-resource'
import { useLocale } from '@/lib/i18n/locale-provider'
import type { Assessment, CaseDetail, Counterparty, Readiness } from '@/lib/api/contracts'
import type { SourceTarget } from '@/features/evidence/types'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Modal } from '@/components/ui/modal'
import { TechnicalDetails } from '@/components/ui/technical-details'
import { financialLabel } from '../labels'
import { displayDecimal, formatTime } from '@/lib/utils/format'
import { formatExactRatio, zeroDebtException } from '../presentation'
import { specialistText } from '@/lib/i18n/specialist-copy'
import { productText, isSyntheticText, presentNote } from '@/lib/i18n/product-copy'
import { fhiMetrics } from '@/features/assessments/fhi'
import { localizeBlocker, localizeLimitation, localizeFindingSummary } from '@/lib/i18n/review-i18n'

export function FinancialInsights({
  detail,
  selected,
  select,
  result,
  current,
  scored,
  readiness,
  party,
  openSource,
  observation,
  captureReady,
}: {
  detail: CaseDetail
  selected: string
  select: (id: string) => void
  result: Assessment | null | undefined
  current: boolean
  scored: boolean
  captureReady: boolean
  readiness: Readiness | null
  party?: Counterparty | null
  openSource: (s: SourceTarget) => void
  observation: (s: string) => string
}) {
  const { locale, t } = useLocale()
  const word = (en: string, vi: string, zh: string) =>
    locale === 'vi' ? vi : locale === 'en' ? en : zh
  const load = useCallback(
    (signal: AbortSignal) => financialApi.trends(detail.id, signal, selected || undefined),
    [detail.id, detail.revision, selected],
  )
  const resource = useResource(load)
  const [report, setReport] = useState<{
    data: FinancialTrends
    result: Assessment | null
    current: boolean
    scored: boolean
    readiness: Readiness | null
    selected: string
    party?: Counterparty | null
  } | null>(null)
  useEffect(() => setReport(null), [detail.id])
  const reportRef = useRef<HTMLElement>(null)
  const [downloadUrl, setDownloadUrl] = useState('')
  useEffect(() => {
    if (!report || !reportRef.current) {
      setDownloadUrl('')
      return
    }
    const url = URL.createObjectURL(
      new Blob([reportHtml(reportRef.current, locale)], { type: 'text/html;charset=utf-8' }),
    )
    setDownloadUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [report, locale])
  const title = word('Financial health summary', 'Báo cáo sức khỏe tài chính', '财务健康摘要')
  const trendTitle = word(
    'Year-by-year financial comparison',
    'So sánh tài chính qua các năm',
    '历年财务比较',
  )
  const issue = (code: string) => {
    if (code === 'FULL_CALENDAR_FY_REQUIRED')
      return word(
        'Only full calendar financial years are comparable.',
        'Chỉ so sánh năm tài chính đủ kỳ từ 01/01 đến 31/12.',
        '仅比较完整日历财年。',
      )
    if (code === 'MULTIPLE_STATEMENT_VERSIONS')
      return word(
        'Multiple versions for this period need reconciliation.',
        'Có nhiều bộ cùng kỳ; cần đối chiếu bản điều chỉnh trước khi so sánh.',
        '本期间存在多个版本，需先核对调整。',
      )
    if (code === 'ACTUAL_KNOWN_ACCOUNTING_BASIS_REQUIRED')
      return financialLabel(locale, 'blocker', code).label
    return word(
      'Basis, regime, company, industry, currency or source unit differs from the selected baseline.',
      'Cơ sở, chế độ kế toán, doanh nghiệp, ngành, tiền tệ hoặc đơn vị nguồn khác bộ đang chọn.',
      '主体、行业、口径、制度、币种或来源单位与基准不一致。',
    )
  }
  const comparison = (data: FinancialTrends, interactive: boolean) => (
    <>
      <p className="help-text">
        {word(
          'Server-checked current source facts and FHI ratios; no FX, annualization or gap filling. Select a year to inspect evidence.',
          'Số liệu nguồn hiện tại và tỷ số FHI được kiểm tra tại máy chủ; không quy đổi tiền tệ, quy năm hoặc lấp khoảng trống. Chọn kỳ để đối chiếu nguồn.',
          '由服务器核对当前来源及FHI比率；不换汇、不年化、不填补缺失。选择期间查看来源。',
        )}
      </p>
      <div className="financial-table-wrap">
        <table className="financial-table trend-table">
          <caption>{trendTitle}</caption>
          <thead>
            <tr>
              <th>{productText(locale, 'selectedPeriod')}</th>
              {[
                'net_revenue',
                'operating_profit',
                'cash_from_operations',
                'interest_bearing_debt',
                'total_equity',
              ].map((k) => (
                <th key={k}>{financialLabel(locale, 'fact', k).label}</th>
              ))}
              <th>{t('status')}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.set.id}>
                <th scope="row">
                  {interactive ? (
                    <button className="text-button" onClick={() => select(row.set.id)}>
                      {row.set.scope.period.start_date}–{row.set.scope.period.end_date}
                    </button>
                  ) : (
                    `${row.set.scope.period.start_date}–${row.set.scope.period.end_date}`
                  )}
                  <small>
                    {financialLabel(locale, 'basis', row.set.scope.basis).label} ·{' '}
                    {row.set.scope.currency} ×1
                  </small>
                </th>
                {[
                  'net_revenue',
                  'operating_profit',
                  'cash_from_operations',
                  'interest_bearing_debt',
                  'total_equity',
                ].map((key) => {
                  const f = row.facts.find((f) => f.key === key)
                  return (
                    <td key={key}>
                      {f?.value !== null && f?.value !== undefined ? displayDecimal(f.value) : '—'}
                      {f?.status && f.status !== 'verified' && (
                        <small>
                          {f.status === 'missing'
                            ? word('Missing data', 'Thiếu dữ kiện', '缺少数据')
                            : financialLabel(locale, 'verification', f.status).label}
                        </small>
                      )}
                    </td>
                  )
                })}
                <td>
                  {row.comparison_issues.map((c, i) => (
                    <p key={i}>{issue(c)}</p>
                  ))}
                  {row.gap_before && (
                    <p>
                      {word('Missing intervening year(s).', 'Thiếu năm ở giữa.', '中间年份缺失。')}
                    </p>
                  )}
                  {!row.comparison_issues.length &&
                    word(
                      'Compatible scope; verification shown per value.',
                      'Cùng phạm vi; xác minh theo từng giá trị.',
                      '范围兼容；每个值单独标注核实状态。',
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="financial-table-wrap">
        <table className="financial-table">
          <caption>
            {word(
              'Seven FHI ratios — current sources',
              'Bảy tỷ số FHI — nguồn hiện tại',
              '七项FHI比率 — 当前来源',
            )}
          </caption>
          <thead>
            <tr>
              <th>{productText(locale, 'selectedPeriod')}</th>
              {fhiMetrics.map((m) => (
                <th key={m.id}>{financialLabel(locale, 'metric', m.id).label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.set.id}>
                <th>{row.set.scope.period.end_date}</th>
                {fhiMetrics.map((m) => {
                  const metric = row.metrics.find((v) => v.metric_id === m.id)
                  return (
                    <td key={m.id}>
                      {metric?.status === 'available'
                        ? zeroDebtException(metric)
                          ? specialistText(locale, 'noDebt')
                          : formatExactRatio(metric.raw_ratio, m.id, locale)
                        : '—'}
                      {metric?.blockers.map((b, i) => (
                        <small key={i}>{financialLabel(locale, 'blocker', b.code).label}</small>
                      ))}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
  const row = report?.data.rows.find((r) => r.set.id === report.selected)
  const reportResult = report?.current ? report.result : null
  return (
    <section className="panel aic-section financial-insights">
      <div className="section-title">
        <h3>{trendTitle}</h3>
        <button
          className="secondary-button"
          disabled={
            !captureReady ||
            resource.loading ||
            !resource.data ||
            resource.data.case_revision !== detail.revision ||
            !selected ||
            !party
          }
          onClick={() =>
            resource.data &&
            setReport({
              data: structuredClone(resource.data),
              result: result ? structuredClone(result) : null,
              current,
              scored,
              readiness: readiness ? structuredClone(readiness) : null,
              selected,
              party: party ? structuredClone(party) : null,
            })
          }
        >
          {title}
        </button>
      </div>
      <ErrorNotice error={resource.error} retry={resource.reload} />
      {resource.data?.case_revision === detail.revision &&
        !resource.loading &&
        comparison(resource.data, true)}
      {!selected && <p>{specialistText(locale, 'periodRequired')}</p>}
      {report && (
        <Modal title={title} onClose={() => setReport(null)} wide>
          <article className="health-report" ref={reportRef}>
            <div className="report-toolbar">
              {downloadUrl && (
                <a
                  className="secondary-button"
                  href={downloadUrl}
                  download="AIC-financial-health-summary.html"
                >
                  {word('Download HTML summary', 'Tải báo cáo HTML', '下载HTML摘要')}
                </a>
              )}
              <button className="primary-button" onClick={() => window.print()}>
                {word('Print / Save as PDF', 'In / Lưu PDF', '打印 / 保存PDF')}
              </button>
              <p>
                {word(
                  'Browser print. Unsigned summary of the data captured below.',
                  'In bằng trình duyệt. Báo cáo chưa ký, theo dữ liệu chụp tại thời điểm bên dưới.',
                  '通过浏览器打印。以下采集时点数据的未签名摘要。',
                )}
              </p>
            </div>
            <h1>{title}</h1>
            <h2>{report.party?.name ?? t('counterparty')}</h2>
            <p>
              {report.party?.tax_id ?? '—'} · {report.party?.country} ·{' '}
              {formatTime(report.data.captured_at, locale)}
            </p>
            <p className="warning-banner">{t('experimentalIndex')}</p>
            {row?.set.facts.some(
              (f) => f.source.kind === 'manual_entry' && isSyntheticText(f.source.statement),
            ) && <p className="warning-banner">{productText(locale, 'synthetic')}</p>}
            <h3>{productText(locale, 'selectedPeriod')}</h3>
            <p>
              {row?.set.scope.period.start_date}–{row?.set.scope.period.end_date} ·{' '}
              {row && financialLabel(locale, 'basis', row.set.scope.basis).label} ·{' '}
              {row?.set.scope.currency} ×{row?.set.scope.unit_multiplier} ·{' '}
              {row?.set.metadata.statement_version}
            </p>
            <h3>
              {report.scored
                ? specialistText(locale, 'ready')
                : specialistText(locale, 'needsData')}
            </h3>
            <p>
              {t('financialIndex')}:{' '}
              <strong>{report.scored ? reportResult?.financial_health?.score : '—'}</strong> ·{' '}
              {t('indexBand')}:{' '}
              <strong>{report.scored ? reportResult?.financial_health?.band : '—'}</strong>
            </p>
            {!report.current && <p>{specialistText(locale, 'historicHelp')}</p>}
            <ul>
              {report.readiness?.blockers.map((b, i) => (
                <li key={i}>
                  {financialLabel(locale, 'blocker', b.code).known
                    ? financialLabel(locale, 'blocker', b.code).label
                    : localizeBlocker(b, locale)}
                </li>
              ))}
            </ul>
            {!report.scored && !report.readiness?.blockers.length && (
              <p>
                {word(
                  'A current, complete published assessment is required for a score.',
                  'Cần bản đánh giá hiện hành, đầy đủ và được lưu để hiển thị điểm.',
                  '需要当前完整已存评估才能显示分数。',
                )}
              </p>
            )}
            <h3>{t('method')}</h3>
            <p>
              {report.result?.method_version ?? 'AIC-FHI-1.0'} ·{' '}
              {word('Weights', 'Trọng số', '权重')}: 15 / 10 / 20 / 10 / 15 / 10 / 20
            </p>
            <table className="financial-table">
              <caption>
                {word(
                  'Seven components and inputs',
                  'Bảy thành phần và dữ kiện đầu vào',
                  '七项组成与输入',
                )}
              </caption>
              <thead>
                <tr>
                  <th>{productText(locale, 'fact')}</th>
                  <th>{specialistText(locale, 'ratio')}</th>
                  <th>{t('score')}</th>
                  <th>{productText(locale, 'facts')}</th>
                </tr>
              </thead>
              <tbody>
                {fhiMetrics.map((m) => {
                  const v = report.data.baseline_metrics.find((v) => v.metric_id === m.id)
                  const part = reportResult?.financial_health?.components.find(
                    (p) => p.metric_id === m.id,
                  )
                  return (
                    <tr key={m.id}>
                      <th>{financialLabel(locale, 'metric', m.id).label}</th>
                      <td>
                        {v?.status === 'available'
                          ? zeroDebtException(v)
                            ? specialistText(locale, 'noDebt')
                            : formatExactRatio(v.raw_ratio, m.id, locale)
                          : '—'}
                      </td>
                      <td>
                        {report.scored ? displayDecimal(part?.points) : '—'} / {m.max}
                      </td>
                      <td>
                        {v?.source_facts.map((f, i) => (
                          <div key={i}>
                            {financialLabel(locale, 'fact', f.key).label}: {displayDecimal(f.value)}{' '}
                            {row?.set.scope.currency}
                          </div>
                        ))}
                        {v?.blockers.map((b, i) => (
                          <p key={i}>{financialLabel(locale, 'blocker', b.code).label}</p>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <h3>{productText(locale, 'facts')}</h3>
            {row?.set.facts.map((f) => (
              <section className="report-fact" key={f.id}>
                <strong>
                  {financialLabel(locale, 'fact', f.key).label}: {displayDecimal(f.raw_value)} ×
                  {row.set.scope.unit_multiplier} {row.set.scope.currency}
                </strong>
                <p>
                  {specialistText(locale, 'currentVerification')}:{' '}
                  {financialLabel(locale, 'verification', f.verification.status).label} ·{' '}
                  {f.verification.verified_at && formatTime(f.verification.verified_at, locale)}
                </p>
                {f.source.kind === 'document' ? (
                  <>
                    <p>
                      v{f.source.document_version} · {t('page')} {f.source.page}
                    </p>
                    <blockquote>{f.source.quote}</blockquote>
                    <button
                      className="text-button report-toolbar"
                      onClick={() =>
                        f.source.kind === 'document' &&
                        openSource({ evidenceId: f.source.evidence_ref })
                      }
                    >
                      {t('source')}
                    </button>
                    <code>{f.source.source_hash}</code>
                  </>
                ) : (
                  <p>
                    {f.source.kind === 'financial_import' ||
                    f.source.kind === 'statement_entry' ||
                    f.source.kind === 'calculated' ? (
                      <>
                        <a
                          href={importSourceUrl(
                            { kind: f.source.source_kind, id: f.source.source_id },
                            f.source.page,
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('source')} · {t('page')} {f.source.page}
                        </a>
                        <span>{f.source.quote}</span>
                      </>
                    ) : (
                      <>
                        {specialistText(locale, 'originalEntry')}: {f.source.statement}
                      </>
                    )}
                  </p>
                )}
                {f.verification.verified_by && (
                  <details className="source-reference">
                    <summary>{specialistText(locale, 'verifier')}</summary>
                    <code>{f.verification.verified_by}</code>
                    <p>{f.verification_reason}</p>
                  </details>
                )}
                {f.missing_reason && <p>{presentNote(f.missing_reason, locale)}</p>}
              </section>
            ))}
            <h3>{trendTitle}</h3>
            {comparison(report.data, false)}
            {(['strengths', 'weaknesses', 'redFlags'] as const).map((k, i) => (
              <section key={k}>
                <h3>{t(k)}</h3>
                {reportResult ? (
                  <ul>
                    {[reportResult.strengths, reportResult.weaknesses, reportResult.red_flags][
                      i
                    ].map((s, n) => (
                      <li key={n}>
                        {i === 2 ? localizeFindingSummary({ summary: s }, locale) : observation(s)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{specialistText(locale, 'historicHelp')}</p>
                )}
              </section>
            ))}
            <h3>{t('limitations')}</h3>
            <p>
              {word(
                'No FX conversion, annualization, inferred opening balance or substituted missing value. Source verification does not confirm legal identity. This summary is not a credit decision.',
                'Không quy đổi tiền tệ, quy năm, suy ra số dư đầu kỳ hoặc thay số liệu thiếu. Xác minh nguồn không xác nhận pháp nhân. Báo cáo không phải quyết định tín dụng.',
                '不换汇、不年化、不推断期初余额或替代缺失值。核实来源不代表确认主体，不构成信贷决定。',
              )}
            </p>
            {reportResult?.limitations.map((s, i) => (
              <p key={i}>{localizeLimitation(s, locale)}</p>
            ))}
            <h3>{word('References', 'Tham chiếu', '参考')}</h3>
            <p>
              AIC-FHI-1.0 · {report.data.contract_version} · {t('revision')}{' '}
              {report.data.case_revision}
            </p>
            <p>
              {report.result &&
                `${word('Saved assessment', 'Bản đánh giá đã lưu', '已存评估')}: ${formatTime(report.result.created_at, locale)} · ${report.result.snapshot_hash}`}
            </p>
            <TechnicalDetails>
              <p>
                {detail.id} · {row?.set.id} · {report.result?.id}
              </p>
            </TechnicalDetails>
          </article>
        </Modal>
      )}
    </section>
  )
}
