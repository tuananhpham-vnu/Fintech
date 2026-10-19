'use client'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { casesApi } from '@/features/cases/api'
import type { SourceTarget } from '@/features/evidence/types'
import { useResource } from '@/hooks/use-resource'
import type { CaseDetail, Locale } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  factKeys,
  financialApi,
  type FinancialInput,
  type FinancialSet,
  type FinancialSource,
} from '../api'
import { financialLabel, metricExplanation } from '../labels'
import { FinancialImport } from './financial-import'
import { FinancialDiagnostics } from './financial-diagnostics'
import { importSourceUrl } from '../import-api'
import { TechnicalDetails as DeveloperDetails } from '@/components/ui/technical-details'
import { productText, presentNote, isSyntheticText } from '@/lib/i18n/product-copy'
import { displayDecimal, formatTime } from '@/lib/utils/format'
import { specialistText } from '@/lib/i18n/specialist-copy'
import { formatExactRatio, zeroDebtException, type FinancialAction } from '../presentation'

type LabelKind = Parameters<typeof financialLabel>[1]

function TechnicalDetails({ values }: { locale: Locale; values: string[] }) {
  return (
    <DeveloperDetails>
      {values.map((value, i) => (
        <p key={i}>{value}</p>
      ))}
    </DeveloperDetails>
  )
}

function FinancialOptions({
  locale,
  kind,
  values,
  current,
}: {
  locale: Locale
  kind: LabelKind
  values: string[]
  current: string
}) {
  return [...(values.includes(current) ? [] : [current]), ...values].map((value) => (
    <option key={value} value={value}>
      {financialLabel(locale, kind, value).label}
    </option>
  ))
}

export function FinancialInformation({
  detail,
  reload,
  openSource,
  selectedSetId,
  onSelectSet,
  actionRequest,
}: {
  detail: CaseDetail
  reload: () => void
  openSource: (target: SourceTarget) => void
  selectedSetId?: string
  onSelectSet?: (id: string) => void
  actionRequest?: FinancialAction
}) {
  const { locale, t } = useLocale(),
    word = (en: string, vi: string, zh: string) =>
      locale === 'en' ? en : locale === 'vi' ? vi : zh
  const [localSelected, setLocalSelected] = useState('')
  const selected = selectedSetId ?? localSelected
  const setSelected = onSelectSet ?? setLocalSelected
  const load = useCallback(
      (signal: AbortSignal) => financialApi.get(detail.id, signal, selected || undefined),
      [detail.id, detail.revision, selected],
    ),
    resource = useResource(load, true)
  const [edit, setEdit] = useState<FinancialSet | 'new' | null>(null),
    [verify, setVerify] = useState<FinancialSet | null>(null)
  const [importing, setImporting] = useState(false)
  const handledAction = useRef<number>(0)
  useEffect(() => {
    if (
      !actionRequest ||
      handledAction.current === actionRequest.nonce ||
      resource.loading ||
      !resource.data
    )
      return
    const set = resource.data.sets.find(
      (s) => s.id === (selected || resource.data?.selected_set_id),
    )
    if (actionRequest.kind !== 'create' && !set) return
    handledAction.current = actionRequest.nonce
    if (actionRequest.kind === 'create') setEdit('new')
    else if (actionRequest.kind === 'verify') setVerify(set!)
    else setEdit(set!)
  }, [actionRequest, resource.data, resource.loading, selected])
  const saved = () => {
    resource.reload()
    reload()
  }
  return (
    <section className="panel aic-section" id="financial-data">
      <div className="section-title">
        <h3>
          {word(
            'Financial statement sets and facts',
            'Bộ BCTC và dữ kiện tài chính',
            '财务报表集与事实',
          )}
        </h3>
        <div className="wrap-actions">
          <button className="primary-button" onClick={() => setImporting(true)}>
            {word(
              'Read PDF · VN / US / CN',
              'Đọc PDF · Việt / Mỹ / Trung',
              '读取 PDF · 越 / 美 / 中',
            )}
          </button>
          <button className="secondary-button" onClick={() => setEdit('new')}>
            {t('create')}
          </button>
        </div>
      </div>
      <p className="help-text">
        {word(
          'Save and verify financial facts. Run an assessment to publish a result when the method and source requirements are satisfied.',
          'Lưu và xác minh dữ kiện tài chính. Chạy đánh giá để phát hành kết quả khi phương pháp và nguồn đáp ứng đủ điều kiện.',
          '保存并核实财务事实。满足方法和来源要求后运行评估并发布结果。',
        )}
      </p>
      <ErrorNotice error={resource.error} retry={resource.reload} />
      {resource.loading && <Loading />}
      {!!resource.data?.sets.length && (
        <label className="field-label">
          {word(
            'Select one statement set for ratios',
            'Chọn một bộ BCTC để tính tỷ số',
            '选择一套报表计算比率',
          )}
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">
              {word(
                'Select explicitly when multiple sets exist',
                'Cần chọn rõ khi có nhiều bộ',
                '存在多套时需明确选择',
              )}
            </option>
            {resource.data.sets.map((s) => (
              <option value={s.id} key={s.id}>
                {financialLabel(locale, 'period', s.scope.period.kind).label}{' '}
                {s.scope.period.start_date}–{s.scope.period.end_date} ·{' '}
                {financialLabel(locale, 'basis', s.scope.basis).label} · v{s.revision}
              </option>
            ))}
          </select>
        </label>
      )}
      {resource.data?.sets
        .filter((s) => s.id === (selected || resource.data?.selected_set_id))
        .map((s) => (
          <article className="financial-set" key={s.id}>
            <div className="section-title">
              <div>
                <strong>
                  {financialLabel(locale, 'period', s.scope.period.kind).label}{' '}
                  {s.scope.period.start_date}–{s.scope.period.end_date}
                </strong>
                <p className="help-text">
                  {financialLabel(locale, 'basis', s.scope.basis).label} · {s.scope.currency} ×
                  {s.scope.unit_multiplier} ·{' '}
                  {financialLabel(locale, 'regime', s.scope.accounting_regime).label}
                </p>
              </div>
              <div className="wrap-actions">
                <button className="secondary-button" onClick={() => setEdit(s)}>
                  {t('edit')}
                </button>
                <button
                  className="primary-button"
                  disabled={!s.facts.length}
                  onClick={() => setVerify(s)}
                >
                  {t('verify')}
                </button>
              </div>
            </div>
            {s.facts.some(
              (f) => f.source.kind === 'manual_entry' && isSyntheticText(f.source.statement),
            ) && <p className="warning-banner">{productText(locale, 'synthetic')}</p>}
            {s.verification_stale && (
              <p className="warning-banner">
                {financialLabel(locale, 'verification', 'stale').label}
              </p>
            )}
            <div className="financial-table-wrap">
              <table className="financial-table">
                <caption className="sr-only">
                  {productText(locale, 'facts')} · {s.scope.period.end_date}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{productText(locale, 'fact')}</th>
                    <th scope="col">{productText(locale, 'original')}</th>
                    <th scope="col">{productText(locale, 'normalized')}</th>
                    <th scope="col">{productText(locale, 'verification')}</th>
                    <th scope="col">{productText(locale, 'sources')}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.facts.map((f) => (
                    <tr key={f.id}>
                      <th scope="row">{financialLabel(locale, 'fact', f.key).label}</th>
                      <td className="numeric">{displayDecimal(f.raw_value)}</td>
                      <td className="numeric">{displayDecimal(f.normalized_decimal)}</td>
                      <td>
                        <span
                          className={`tag ${f.verification.status === 'verified' ? 'green' : 'amber'}`}
                        >
                          {financialLabel(locale, 'verification', f.verification.status).label}
                        </span>
                      </td>
                      <td>
                        {f.source.kind === 'document' ? (
                          <button
                            className="text-button"
                            onClick={() => {
                              if (f.source.kind === 'document')
                                openSource({ evidenceId: f.source.evidence_ref })
                            }}
                          >
                            {productText(locale, 'viewSource')} · {t('page')} {f.source.page}
                          </button>
                        ) : f.source.kind === 'financial_import' ||
                          f.source.kind === 'statement_entry' ||
                          f.source.kind === 'calculated' ? (
                          <details>
                            <summary>
                              {productText(locale, 'viewSource')} · {t('page')} {f.source.page}
                            </summary>
                            <a
                              href={importSourceUrl(
                                { kind: f.source.source_kind, id: f.source.source_id },
                                f.source.page,
                              )}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {productText(locale, 'viewSource')}
                            </a>
                            <pre style={{ whiteSpace: 'pre-wrap' }}>{f.source.quote}</pre>
                          </details>
                        ) : (
                          <details>
                            <summary>{productText(locale, 'provenance')}</summary>
                            <p>
                              {isSyntheticText(f.source.statement)
                                ? productText(locale, 'synthetic')
                                : f.source.statement}
                            </p>
                            <small>{productText(locale, 'manual')}</small>
                          </details>
                        )}
                        {f.missing_reason && (
                          <p className="help-text">{presentNote(f.missing_reason, locale)}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      {!resource.loading && resource.data && !resource.data.sets.length && (
        <p className="empty-guidance">{productText(locale, 'noFacts')}</p>
      )}
      {!!resource.data?.sets.length && !selected && !resource.data.selected_set_id && (
        <p className="empty-guidance">{productText(locale, 'selectPeriod')}</p>
      )}
      {!!resource.data?.metrics.length && (
        <details className="ratio-details">
          <summary>{productText(locale, 'calculation')} · 7</summary>
          <p className="help-text">{productText(locale, 'ratioHelp')}</p>
          <div className="ratio-grid">
            {resource.data.metrics.map((m) => (
              <article key={m.metric_id}>
                <strong>{financialLabel(locale, 'metric', m.metric_id).label}</strong>
                <p className="ratio-value">
                  {zeroDebtException(m)
                    ? specialistText(locale, 'noDebt')
                    : formatExactRatio(m.raw_ratio, m.metric_id, locale)}
                </p>
                <span className="tag">
                  {zeroDebtException(m)
                    ? specialistText(locale, 'noDebt')
                    : financialLabel(locale, 'status', m.status).label}
                </span>
                <p>{metricExplanation(locale, m.metric_id)}</p>
                {m.blockers.map((b, i) => (
                  <p className="aic-blocker" key={i}>
                    {financialLabel(locale, 'blocker', b.code).label}
                  </p>
                ))}
              </article>
            ))}
          </div>
        </details>
      )}
      {(selected || resource.data?.selected_set_id) && (
        <FinancialDiagnostics
          caseId={detail.id}
          setId={selected || resource.data!.selected_set_id!}
          revision={detail.revision}
        />
      )}
      {resource.data?.blockers.map((b) => (
        <p className="aic-blocker" key={b}>
          {financialLabel(locale, 'blocker', b).label}
        </p>
      ))}
      {!!resource.data?.limitations.length && (
        <details className="case-context">
          <summary>{t('limitations')}</summary>
          {resource.data.limitations.map((limitation, i) => (
            <p key={i}>{financialLabel(locale, 'limitation', limitation).label}</p>
          ))}
          <TechnicalDetails locale={locale} values={resource.data.limitations} />
        </details>
      )}
      {importing && (
        <FinancialImport
          detail={detail}
          onSaved={saved}
          onClose={() => {
            setImporting(false)
            saved()
          }}
        />
      )}
      {edit && (
        <FinancialEditor
          detail={detail}
          initial={edit === 'new' ? undefined : edit}
          reload={saved}
          onClose={() => setEdit(null)}
          openSource={openSource}
          focusFactKey={actionRequest?.factKey}
        />
      )}
      {verify && (
        <FinancialVerification
          detail={detail}
          set={verify}
          reload={saved}
          onClose={() => setVerify(null)}
          openSource={openSource}
          focusFactKey={actionRequest?.factKey}
        />
      )}
    </section>
  )
}
function FinancialEditor({
  detail,
  initial,
  reload,
  onClose,
  openSource,
  focusFactKey,
}: {
  detail: CaseDetail
  initial?: FinancialSet
  reload: () => void
  onClose: () => void
  openSource: (target: SourceTarget) => void
  focusFactKey?: string
}) {
  const { locale, t } = useLocale(),
    word = (en: string, vi: string, zh: string) =>
      locale === 'en' ? en : locale === 'vi' ? vi : zh
  const [period, setPeriod] = useState(
      initial?.scope.period ?? { kind: 'FY', start_date: '', end_date: '' },
    ),
    [basis, setBasis] = useState(initial?.scope.basis ?? 'standalone'),
    [regime, setRegime] = useState(initial?.scope.accounting_regime ?? 'UNKNOWN'),
    [currency, setCurrency] = useState(initial?.scope.currency ?? 'VND'),
    [unit, setUnit] = useState(initial?.scope.unit_multiplier ?? '1'),
    [scope, setScope] = useState(initial?.scope.pilot_scope ?? 'UNKNOWN'),
    [observation, setObservation] = useState(initial?.metadata.observation_kind ?? 'actual'),
    [audit, setAudit] = useState(initial?.metadata.audit_status ?? 'unknown'),
    [version, setVersion] = useState(initial?.metadata.statement_version ?? ''),
    [statement, setStatement] = useState('')
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      factKeys.map((key) => {
        const old = initial?.facts.find((f) => f.key === key)
        return [
          key,
          {
            raw: old?.raw_value ?? '',
            label: old?.raw_label ?? financialLabel(locale, 'fact', key).label,
            missing: old?.missing_reason ?? '',
            source: old?.source as FinancialSource | undefined,
            choice:
              old?.source.kind === 'document'
                ? old.source.evidence_ref
                : old?.source.kind === 'financial_import'
                  ? 'imported'
                  : 'manual',
          },
        ]
      }),
    ),
  )
  const options = (detail.documents ?? []).flatMap((d) =>
    [...new Set(d.extraction?.flatMap((f) => f.evidence_refs) ?? [])].map((ref) => ({
      id: ref,
      doc: d,
      quote: d.extraction?.find((field) => field.evidence_refs.includes(ref))?.raw_value,
    })),
  )
  const set = (key: string, patch: Partial<(typeof values)[string]>) =>
    setValues((old) => ({ ...old, [key]: { ...old[key], ...patch } }))
  return (
    <ActionDialog
      title={`${word('Financial facts', 'Dữ kiện tài chính', '财务事实')} · ${period.start_date || '—'}–${period.end_date || '—'} · ${currency} ×${unit}`}
      wide
      revision={detail.revision}
      loadLatest={() => casesApi.detail(detail.id)}
      onClose={onClose}
      onSaved={reload}
      submit={async (reason, expected_revision, keys) => {
        const facts = []
        for (const key of factKeys) {
          const f = values[key]
          if (!f.raw && !f.missing) continue
          let source: FinancialSource
          if (f.choice === 'manual')
            source =
              f.source?.kind === 'manual_entry' && statement === ''
                ? f.source
                : { kind: 'manual_entry', statement }
          else if (f.choice === 'imported' && f.source?.kind === 'financial_import')
            source = f.source
          else {
            const e = await financialApi.evidence(f.choice)
            source = {
              kind: 'document',
              document_id: e.document_id,
              document_version: e.document_version,
              source_hash: e.source_hash,
              page: e.page,
              quote: e.quote,
              evidence_ref: e.id,
            }
          }
          facts.push({
            key,
            raw_value: f.raw || null,
            raw_label: f.label,
            missing_reason: f.raw ? null : f.missing,
            source,
          })
        }
        const body: FinancialInput = {
          reason,
          expected_revision,
          period,
          basis,
          accounting_regime: regime,
          currency,
          unit_multiplier: unit,
          industry_scope: scope,
          observation_kind: observation,
          audit_status: audit,
          statement_version: version,
          facts,
        }
        return financialApi.save(detail.id, initial?.id, body, keys)
      }}
    >
      <p>
        {word(
          'Entity and country follow the current case. Enter original source units. No automatic FX, annualization or profit substitutions.',
          'Pháp nhân và quốc gia được lấy từ hồ sơ đang xem. Nhập đơn vị gốc. Không tự đổi tiền, quy năm hoặc thay thế chỉ tiêu lợi nhuận.',
          '主体和国家由本案解析。输入原始单位，不自动换汇、年化或替代利润指标。',
        )}
      </p>
      <div className="form-two-columns">
        <label className="field-label">
          {word('Period kind', 'Loại kỳ', '期间类型')}
          <select
            value={period.kind}
            onChange={(e) => setPeriod({ ...period, kind: e.target.value })}
          >
            <FinancialOptions
              locale={locale}
              kind="period"
              current={period.kind}
              values={['FY', 'TTM', 'INTERIM']}
            />
          </select>
        </label>
        <label className="field-label">
          {word('Basis', 'Cơ sở', '口径')}
          <select value={basis} onChange={(e) => setBasis(e.target.value)}>
            <FinancialOptions
              locale={locale}
              kind="basis"
              current={basis}
              values={['standalone', 'consolidated']}
            />
          </select>
        </label>
      </div>
      <div className="form-two-columns">
        <label className="field-label">
          {word('Start', 'Từ ngày', '开始')}
          <input
            required
            type="date"
            value={period.start_date}
            onChange={(e) => setPeriod({ ...period, start_date: e.target.value })}
          />
        </label>
        <label className="field-label">
          {word('End', 'Đến ngày', '结束')}
          <input
            required
            type="date"
            value={period.end_date}
            onChange={(e) => setPeriod({ ...period, end_date: e.target.value })}
          />
        </label>
      </div>
      <label className="field-label">
        {word('Accounting regime', 'Chế độ kế toán', '会计准则')}
        <select value={regime} onChange={(e) => setRegime(e.target.value)}>
          <FinancialOptions
            locale={locale}
            kind="regime"
            current={regime}
            values={[
              'VN_TT133',
              'VN_TT200',
              'VN_TT99',
              'VN_TT58',
              'US_GAAP',
              'CN_ASBE',
              'IFRS',
              'OTHER',
              'UNKNOWN',
            ]}
          />
        </select>
      </label>
      <div className="form-two-columns">
        <label className="field-label">
          {word('Currency', 'Tiền tệ', '币种')}
          <input
            required
            pattern="[A-Z]{3}"
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          />
        </label>
        <label className="field-label">
          {word('Unit multiplier', 'Hệ số đơn vị', '单位倍数')}
          <input
            required
            pattern="[1-9][0-9]*"
            maxLength={12}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </label>
      </div>
      <label className="field-label">
        {word(
          'Industry scope (not pilot approval)',
          'Phạm vi ngành (không là phê duyệt thí điểm)',
          '行业范围（不代表试点获批）',
        )}
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <FinancialOptions
            locale={locale}
            kind="scope"
            current={scope}
            values={[
              'DISTRIBUTION_WHOLESALE_PILOT',
              'MANUFACTURING',
              'RETAIL',
              'BUSINESS_SERVICES',
              'CONSUMER_DURABLES',
              'OTHER',
              'UNKNOWN',
            ]}
          />
        </select>
      </label>
      <div className="form-two-columns">
        <label className="field-label">
          {word('Observation', 'Loại số liệu', '数据类型')}
          <select value={observation} onChange={(e) => setObservation(e.target.value)}>
            <FinancialOptions
              locale={locale}
              kind="observation"
              current={observation}
              values={['actual', 'forecast']}
            />
          </select>
        </label>
        <label className="field-label">
          {word('Audit status', 'Kiểm toán', '审计状态')}
          <select value={audit} onChange={(e) => setAudit(e.target.value)}>
            <FinancialOptions
              locale={locale}
              kind="audit"
              current={audit}
              values={['audited', 'unaudited', 'unknown']}
            />
          </select>
        </label>
      </div>
      <TechnicalDetails
        locale={locale}
        values={[period.kind, basis, regime, scope, observation, audit]}
      />
      <label className="field-label">
        {word('Source statement version', 'Phiên bản BCTC nguồn', '源报表版本')}
        <input
          required
          maxLength={100}
          value={version}
          onChange={(e) => setVersion(e.target.value)}
        />
      </label>
      <label className="field-label">
        {word(
          'Manual entry provenance / source statement',
          'Nguồn gốc nhập tay / lời khai',
          '手工录入来源陈述',
        )}
        <textarea
          maxLength={4000}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
        />
      </label>
      {factKeys.map((key) => (
        <section
          className={`panel aic-section ${focusFactKey === key ? 'target-fact' : ''}`}
          key={key}
        >
          <strong>{financialLabel(locale, 'fact', key).label}</strong>
          <TechnicalDetails locale={locale} values={[key]} />
          <label className="field-label">
            {word('Original label', 'Nhãn gốc', '原始标签')}
            <input
              maxLength={500}
              value={
                values[key].label === key
                  ? financialLabel(locale, 'fact', key).label
                  : values[key].label
              }
              onChange={(e) => set(key, { label: e.target.value })}
            />
          </label>
          <label className="field-label">
            {word(
              'Raw decimal (blank means unknown)',
              'Số thập phân gốc (trống là chưa biết)',
              '原始小数（空白为未知）',
            )}
            <input
              inputMode="decimal"
              pattern="-?[0-9]+(\.[0-9]+)?"
              maxLength={43}
              value={values[key].raw}
              autoFocus={focusFactKey === key}
              onChange={(e) => set(key, { raw: e.target.value })}
            />
          </label>
          <label className="field-label">
            {word(
              'Missing reason (leave both blank to omit this fact)',
              'Lý do thiếu (để cả hai trống nếu chưa nhập)',
              '缺失原因（两项留空则不录入）',
            )}
            <input
              maxLength={1000}
              value={values[key].missing}
              onChange={(e) => set(key, { missing: e.target.value })}
            />
          </label>
          <label className="field-label">
            {t('source')}
            <select
              value={values[key].choice}
              onChange={(e) => set(key, { choice: e.target.value })}
            >
              <option value="manual">
                {word(
                  'Manual declaration; unverified',
                  'Lời khai nhập tay; chưa xác minh',
                  '手工陈述，未核实',
                )}
              </option>
              {!options.some((o) => o.id === values[key].choice) &&
                values[key].choice !== 'manual' && (
                  <option value={values[key].choice}>
                    {word('Previously selected source', 'Nguồn đã chọn trước đó', '先前选定的来源')}
                  </option>
                )}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.doc.name} · v{o.doc.version} ·{' '}
                  {typeof o.quote === 'string' ? o.quote.slice(0, 100) : t('source')}
                </option>
              ))}
            </select>
          </label>
          {values[key].choice === 'imported' && values[key].source?.kind === 'financial_import' && (
            <p className="help-text">
              {word(
                'Imported source is preserved. To change a value, choose manual entry and state its source.',
                'Giữ nguyên nguồn đã trích xuất. Nếu sửa số, hãy chọn nhập tay và ghi rõ căn cứ.',
                '已保留提取来源。如需修改数值，请选择手工录入并注明依据。',
              )}
            </p>
          )}
          {!['manual', 'imported'].includes(values[key].choice) && (
            <FinancialSourcePreview id={values[key].choice} openSource={openSource} />
          )}
          <TechnicalDetails locale={locale} values={[values[key].choice]} />
        </section>
      ))}
    </ActionDialog>
  )
}
function FinancialSourcePreview({
  id,
  openSource,
}: {
  id: string
  openSource: (target: SourceTarget) => void
}) {
  const { t, locale } = useLocale()
  const load = useCallback((signal: AbortSignal) => financialApi.evidence(id, signal), [id])
  const source = useResource(load)
  return (
    <div>
      <ErrorNotice error={source.error} retry={source.reload} />
      {source.loading && <Loading />}
      {source.data && (
        <>
          <p>
            {t('page')} {source.data.page} · v{source.data.document_version}
          </p>
          <blockquote>{source.data.quote}</blockquote>
          <button
            type="button"
            className="text-button"
            onClick={() => openSource({ evidenceId: id })}
          >
            {t('source')}
          </button>
          <p className="help-text">
            {locale === 'vi'
              ? 'Đối chiếu đúng nhãn, cột kỳ báo cáo và đơn vị trước khi nhập. Chọn nguồn chưa xác minh không tự xác minh dữ kiện.'
              : locale === 'en'
                ? 'Match the label, reporting-period column and units before entering a value. Selecting an unverified source does not verify the fact.'
                : '录入前请核对标签、报告期间列及单位。选择未核实来源不会核实该事实。'}
          </p>
        </>
      )}
    </div>
  )
}
function FinancialVerification({
  detail,
  set,
  reload,
  onClose,
  openSource,
  focusFactKey,
}: {
  detail: CaseDetail
  set: FinancialSet
  reload: () => void
  onClose: () => void
  openSource: (target: SourceTarget) => void
  focusFactKey?: string
}) {
  const { t, locale } = useLocale(),
    word = (en: string, vi: string, zh: string) =>
      locale === 'en' ? en : locale === 'vi' ? vi : zh
  const [ids, setIds] = useState<string[]>([]),
    [status, setStatus] = useState('unverified'),
    [quick, setQuick] = useState(false),
    [eligible, setEligible] = useState(false),
    [da, setDa] = useState(false)
  return (
    <ActionDialog
      title={`${t('verify')} · ${set.scope.period.start_date}–${set.scope.period.end_date} · ${set.scope.currency} ×${set.scope.unit_multiplier}`}
      wide
      revision={detail.revision}
      loadLatest={() => casesApi.detail(detail.id)}
      onClose={onClose}
      onSaved={reload}
      submit={(reason, expected_revision, keys) =>
        financialApi.verify(
          set.id,
          {
            expected_revision,
            set_revision: set.revision,
            reason,
            status,
            fact_ids: ids,
            bridge_assertions: {
              quick_assets_non_overlapping: quick,
              quick_assets_eligible: eligible,
              da_addback_to_operating_profit: da,
            },
          },
          keys,
        )
      }
    >
      <section className="verification-context">
        <h3>{specialistText(locale, 'verificationScope')}</h3>
        <p>
          <strong>
            {set.scope.period.start_date}–{set.scope.period.end_date}
          </strong>{' '}
          · {financialLabel(locale, 'basis', set.scope.basis).label} · {set.scope.currency} ×
          {set.scope.unit_multiplier}
        </p>
        <p>
          {financialLabel(locale, 'regime', set.scope.accounting_regime).label} ·{' '}
          {specialistText(locale, 'sourceVersion')}: {set.metadata.statement_version || '—'}
        </p>
        {set.verification_stale && (
          <p className="warning-banner">{specialistText(locale, 'changed')}</p>
        )}
      </section>
      <p>
        {word(
          'Verify only facts personally checked against the original source/entry. This does not approve the FHI method or confirm identity.',
          'Chỉ xác minh dữ kiện đã trực tiếp kiểm với nguồn hoặc bản nhập gốc. Không duyệt phương pháp FHI hoặc xác nhận pháp nhân.',
          '仅核实已亲自对照原始材料或录入记录的事实，不批准FHI方法或确认身份。',
        )}
      </p>
      <select aria-label={t('status')} value={status} onChange={(e) => setStatus(e.target.value)}>
        <FinancialOptions
          locale={locale}
          kind="verification"
          current={status}
          values={['unverified', 'verified', 'rejected']}
        />
      </select>
      <TechnicalDetails locale={locale} values={[status]} />
      {set.facts.map((f) => (
        <article
          className={`verification-fact ${focusFactKey === f.key ? 'target-fact' : ''}`}
          key={f.id}
        >
          <label className="check-label">
            <input
              type="checkbox"
              checked={ids.includes(f.id)}
              autoFocus={focusFactKey === f.key}
              onChange={(e) =>
                setIds((old) =>
                  e.target.checked ? [...old, f.id] : old.filter((id) => id !== f.id),
                )
              }
            />
            {financialLabel(locale, 'fact', f.key).label}: {f.raw_value ?? '—'} →{' '}
            {f.normalized_decimal ?? '—'}
          </label>
          <p>
            {specialistText(locale, 'currentVerification')}:{' '}
            <span
              className={`tag ${f.verification.status === 'verified' && f.current_source ? 'green' : 'amber'}`}
            >
              {financialLabel(locale, 'verification', f.verification.status).label}
            </span>
          </p>
          {f.verification.verified_at && (
            <p className="help-text">
              {specialistText(locale, 'verifiedAt')}:{' '}
              {formatTime(f.verification.verified_at, locale)}
            </p>
          )}
          {f.source.kind === 'document' ? (
            <>
              <p>
                {specialistText(locale, 'sourceVersion')} {f.source.document_version} · {t('page')}{' '}
                {f.source.page}
              </p>
              <blockquote>{f.source.quote}</blockquote>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  f.source.kind === 'document' && openSource({ evidenceId: f.source.evidence_ref })
                }
              >
                {productText(locale, 'viewSource')}
              </button>
            </>
          ) : f.source.kind === 'financial_import' ||
            f.source.kind === 'statement_entry' ||
            f.source.kind === 'calculated' ? (
            <>
              <p>
                {t('page')} {f.source.page}
              </p>
              <blockquote>{f.source.quote}</blockquote>
              <a
                href={importSourceUrl(
                  { kind: f.source.source_kind, id: f.source.source_id },
                  f.source.page,
                )}
                target="_blank"
                rel="noreferrer"
              >
                {productText(locale, 'viewSource')}
              </a>
            </>
          ) : (
            <>
              <p>{productText(locale, 'manual')}</p>
              <details>
                <summary>{specialistText(locale, 'originalEntry')}</summary>
                <p>{f.source.statement}</p>
              </details>
            </>
          )}
          {f.verification.verified_by && (
            <details>
              <summary>{specialistText(locale, 'verifier')}</summary>
              <p>{f.verification.verified_by}</p>
              {f.verification_reason && <p>{presentNote(f.verification_reason, locale)}</p>}
            </details>
          )}
        </article>
      ))}
      <p className="help-text">{specialistText(locale, 'bridgeHelp')}</p>
      {[
        [
          quick,
          setQuick,
          word(
            'Quick asset components do not overlap',
            'Thành phần tài sản nhanh không trùng',
            '速动资产组成不重叠',
          ),
        ],
        [
          eligible,
          setEligible,
          word(
            'Quick asset eligibility checked against source',
            'Đã kiểm khả năng chuyển đổi nhanh theo nguồn',
            '已按来源核实速动资格',
          ),
        ],
        [
          da,
          setDa,
          word(
            'D&A is a sourced add-back to this operating profit',
            'Khấu hao/phân bổ là khoản cộng lại đúng lợi nhuận hoạt động này',
            '折旧摊销是该营业利润的有据加回项',
          ),
        ],
      ].map(([value, update, label], i) => (
        <label className="check-label" key={i}>
          <input
            type="checkbox"
            checked={value as boolean}
            onChange={(e) => (update as (v: boolean) => void)(e.target.checked)}
          />
          {label as string}
        </label>
      ))}
    </ActionDialog>
  )
}
