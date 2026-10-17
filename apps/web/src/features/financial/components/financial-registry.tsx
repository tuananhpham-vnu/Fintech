'use client'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { casesApi } from '@/features/cases/api'
import type { SourceTarget } from '@/features/evidence/types'
import { useResource } from '@/hooks/use-resource'
import type { CaseDetail, Locale } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { useCallback, useState } from 'react'
import {
  factKeys,
  financialApi,
  type FinancialInput,
  type FinancialSet,
  type FinancialSource,
} from '../api'
import { financialLabel } from '../labels'

type LabelKind = Parameters<typeof financialLabel>[1]

function TechnicalDetails({ locale, values }: { locale: Locale; values: string[] }) {
  return (
    <details>
      <summary>
        {locale === 'en' ? 'Technical details' : locale === 'vi' ? 'Chi tiết kỹ thuật' : '技术详情'}
      </summary>
      {values.map((value, i) => (
        <p key={i}>
          <code>{value}</code>
        </p>
      ))}
    </details>
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
}: {
  detail: CaseDetail
  reload: () => void
  openSource: (target: SourceTarget) => void
}) {
  const { locale, t } = useLocale(),
    word = (en: string, vi: string, zh: string) =>
      locale === 'en' ? en : locale === 'vi' ? vi : zh
  const [selected, setSelected] = useState('')
  const load = useCallback(
      (signal: AbortSignal) => financialApi.get(detail.id, signal, selected || undefined),
      [detail.id, detail.revision, selected],
    ),
    resource = useResource(load, true)
  const [edit, setEdit] = useState<FinancialSet | 'new' | null>(null),
    [verify, setVerify] = useState<FinancialSet | null>(null)
  const saved = () => {
    resource.reload()
    reload()
  }
  return (
    <section className="panel aic-section">
      <div className="section-title">
        <h3>
          {word(
            'Financial statement sets and facts',
            'Bộ BCTC và dữ kiện tài chính',
            '财务报表集与事实',
          )}
        </h3>
        <button className="secondary-button" onClick={() => setEdit('new')}>
          {t('create')}
        </button>
      </div>
      <p className="help-text">
        {word(
          'The method remains unconfigured. Save and verify source facts without publishing a score or band.',
          'Phương pháp chưa được kích hoạt. Có thể lưu và xác minh dữ kiện nguồn; không phát điểm hoặc phân hạng.',
          '方法尚未配置。可保存并核实来源事实，不发布分数或分档。',
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
      {resource.data?.sets.map((s) => (
        <article className="panel aic-section" key={s.id}>
          <strong>
            {financialLabel(locale, 'period', s.scope.period.kind).label}{' '}
            {s.scope.period.start_date}–{s.scope.period.end_date}
          </strong>
          <p>
            {financialLabel(locale, 'basis', s.scope.basis).label} ·{' '}
            {financialLabel(locale, 'regime', s.scope.accounting_regime).label} · {s.scope.currency}{' '}
            ×{s.scope.unit_multiplier} · v{s.revision} ·{' '}
            {financialLabel(locale, 'observation', s.metadata.observation_kind).label}
          </p>
          <TechnicalDetails
            locale={locale}
            values={[
              s.id,
              s.scope.entity_id,
              s.scope.period.kind,
              s.scope.basis,
              s.scope.accounting_regime,
              s.scope.pilot_scope,
              s.metadata.observation_kind,
            ]}
          />
          {s.verification_stale && (
            <span className="tag amber">
              {financialLabel(locale, 'verification', 'stale').label}
            </span>
          )}
          <div className="wrap-actions">
            <button className="secondary-button" onClick={() => setEdit(s)}>
              {t('edit')}
            </button>
            <button
              className="secondary-button"
              disabled={!s.facts.length}
              onClick={() => setVerify(s)}
            >
              {t('verify')}
            </button>
          </div>
          {s.facts.map((f) => (
            <div key={f.id} className="aic-checklist-row">
              <div>
                <strong>{f.raw_label}</strong>
                <p>
                  {f.raw_value ?? '—'} → {f.normalized_decimal ?? '—'} ·{' '}
                  {financialLabel(locale, 'verification', f.verification.status).label}
                </p>
                <p>{f.missing_reason}</p>
                <TechnicalDetails locale={locale} values={[f.key, f.verification.status]} />
                {f.source.kind === 'manual_entry' ? (
                  <blockquote>{f.source.statement}</blockquote>
                ) : (
                  <button
                    className="text-button"
                    onClick={() => {
                      if (f.source.kind === 'document')
                        openSource({ evidenceId: f.source.evidence_ref })
                    }}
                  >
                    {t('source')} · v{f.source.document_version} · {f.source.page}
                  </button>
                )}
              </div>
            </div>
          ))}
        </article>
      ))}
      {!resource.loading &&
        resource.data?.metrics.map((m) => (
          <article key={m.metric_id} className="aic-section">
            <strong>
              {financialLabel(locale, 'metric', m.metric_id).label} ·{' '}
              {financialLabel(locale, 'group', m.group).label} ·{' '}
              {financialLabel(locale, 'status', m.status).label}
            </strong>
            <p>
              {m.raw_ratio
                ? (m.raw_ratio.decimal ?? `${m.raw_ratio.numerator}/${m.raw_ratio.denominator}`)
                : '—'}
            </p>
            <p>
              {word(
                'Points unavailable pending method approval',
                'Điểm chưa khả dụng, chờ duyệt phương pháp',
                '分值待方法批准',
              )}{' '}
              · {m.max_points}
            </p>
            <details>
              <summary>
                {word(
                  'Formula inputs and method anchors',
                  'Đầu vào công thức và các mốc phương pháp',
                  '公式输入与方法锚点',
                )}
              </summary>
              <p>
                <code>
                  {m.metric_id} · {m.group} · {m.status}
                </code>
              </p>
              <p>
                <code>{m.formula}</code>
              </p>
              {m.source_facts.map((f) => (
                <p key={f.id}>
                  {f.key} · {f.value ?? '—'} · v{f.revision}
                </p>
              ))}
              <table>
                <thead>
                  <tr>
                    <th>{word('Ratio', 'Tỷ số', '比率')}</th>
                    <th>{word('Credit anchor', 'Tỷ lệ điểm tại mốc', '得分比例锚点')}</th>
                  </tr>
                </thead>
                <tbody>
                  {m.anchors.map((a) => (
                    <tr key={a.value}>
                      <td>{a.value}</td>
                      <td>{a.credit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            {m.blockers.map((b, i) => (
              <div key={i}>
                <p>{financialLabel(locale, 'blocker', b.code).label}</p>
                <TechnicalDetails locale={locale} values={[b.code]} />
              </div>
            ))}
          </article>
        ))}
      {resource.data?.limitations.map((l) => (
        <div key={l} className="help-text">
          <p>{financialLabel(locale, 'limitation', l).label}</p>
          <TechnicalDetails locale={locale} values={[l]} />
        </div>
      ))}
      {resource.data?.blockers.map((b) => (
        <div className="help-text" key={b}>
          <p>{financialLabel(locale, 'blocker', b).label}</p>
          <TechnicalDetails locale={locale} values={[b]} />
        </div>
      ))}
      {edit && (
        <FinancialEditor
          detail={detail}
          initial={edit === 'new' ? undefined : edit}
          reload={saved}
          onClose={() => setEdit(null)}
        />
      )}
      {verify && (
        <FinancialVerification
          detail={detail}
          set={verify}
          reload={saved}
          onClose={() => setVerify(null)}
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
}: {
  detail: CaseDetail
  initial?: FinancialSet
  reload: () => void
  onClose: () => void
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
            label: old?.raw_label ?? key,
            missing: old?.missing_reason ?? '',
            source: old?.source as FinancialSource | undefined,
            choice: old?.source.kind === 'document' ? old.source.evidence_ref : 'manual',
          },
        ]
      }),
    ),
  )
  const options = (detail.documents ?? []).flatMap((d) =>
    [...new Set(d.extraction?.flatMap((f) => f.evidence_refs) ?? [])].map((ref) => ({
      id: ref,
      doc: d,
    })),
  )
  const set = (key: string, patch: Partial<(typeof values)[string]>) =>
    setValues((old) => ({ ...old, [key]: { ...old[key], ...patch } }))
  return (
    <ActionDialog
      title={word('Financial facts', 'Dữ kiện tài chính', '财务事实')}
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
          'Entity/country are resolved from this case. Enter original source units. No automatic FX, annualization or profit substitutions.',
          'Pháp nhân/quốc gia do server lấy từ case. Nhập đơn vị gốc. Không tự đổi tiền, quy năm hoặc thay thế chỉ tiêu lợi nhuận.',
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
            values={['VN_TT133', 'VN_TT99', 'VN_TT58', 'IFRS', 'OTHER', 'UNKNOWN']}
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
        <section className="panel aic-section" key={key}>
          <strong>{financialLabel(locale, 'fact', key).label}</strong>
          <TechnicalDetails locale={locale} values={[key]} />
          <label className="field-label">
            {word('Original label', 'Nhãn gốc', '原始标签')}
            <input
              maxLength={500}
              value={values[key].label}
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
              {options.map((o, i) => (
                <option key={o.id} value={o.id}>
                  {o.doc.name} · v{o.doc.version} · {word('Source', 'Nguồn', '来源')} {i + 1}
                </option>
              ))}
            </select>
          </label>
          <TechnicalDetails locale={locale} values={[values[key].choice]} />
        </section>
      ))}
    </ActionDialog>
  )
}
function FinancialVerification({
  detail,
  set,
  reload,
  onClose,
}: {
  detail: CaseDetail
  set: FinancialSet
  reload: () => void
  onClose: () => void
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
      title={t('verify')}
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
        <label className="check-label" key={f.id}>
          <input
            type="checkbox"
            checked={ids.includes(f.id)}
            onChange={(e) =>
              setIds((old) => (e.target.checked ? [...old, f.id] : old.filter((id) => id !== f.id)))
            }
          />
          {f.raw_label}: {f.raw_value ?? '—'} → {f.normalized_decimal ?? '—'}
        </label>
      ))}
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
