'use client'
import { useState } from 'react'
import { useLocale } from '@/lib/i18n/locale-provider'
import { useMutation } from '@/hooks/use-mutation'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { factKeys, type FinancialSet } from '../api'
import { intakeApi, type IntakeItem, type PeriodSourceCandidate } from '../intake-api'
import { financialLabel } from '../labels'

const text = {
  vi: {
    heading: 'Đối chiếu nguồn cùng kỳ',
    help: 'Chỉ chọn bộ số liệu dùng cho kỳ đang đối chiếu. Cả hai PDF vẫn được giữ; số liệu các kỳ khác không thay đổi.',
    active: 'Nguồn đang dùng',
    incoming: 'Nguồn mới',
    current: 'Cột năm báo cáo',
    comparative: 'Cột năm so sánh',
    unspecified: 'Chưa xác định vai trò cột',
    source: 'Tài liệu',
    field: 'Chỉ tiêu',
    open: 'Mở tài liệu',
    keep: 'Giữ số liệu từ nguồn đang dùng cho {period}',
    use: 'Dùng số liệu từ nguồn mới cho {period}',
    unit: 'Đơn vị nhân',
    standalone: 'Riêng lẻ',
    consolidated: 'Hợp nhất',
    unavailable: 'Đang tải nguồn để đối chiếu…',
    review: 'Sau khi chọn nguồn, cần rà soát và xác nhận lại trước khi chấm điểm.',
  },
  en: {
    heading: 'Compare sources for the same period',
    help: 'Choose figures only for the period shown. Both PDFs are retained; figures for other periods stay unchanged.',
    active: 'Current source',
    incoming: 'New source',
    current: 'Current-year column',
    comparative: 'Comparative column',
    unspecified: 'Column role unverified',
    source: 'Document',
    field: 'Input',
    open: 'Open document',
    keep: 'Keep current source figures for {period}',
    use: 'Use new source figures for {period}',
    unit: 'Unit multiplier',
    standalone: 'Standalone',
    consolidated: 'Consolidated',
    unavailable: 'Loading source for comparison…',
    review: 'Review and confirm again before scoring after selecting a source.',
  },
  'zh-CN': {
    heading: '对比同报告期的来源',
    help: '仅选择当前报告期的数据。两个 PDF 均保留；其他报告期数据不变。',
    active: '当前来源',
    incoming: '新来源',
    current: '本年列',
    comparative: '比较列',
    unspecified: '列角色尚未验证',
    source: '文件',
    field: '指标',
    open: '打开文件',
    keep: '{period} 保留当前来源数据',
    use: '{period} 使用新来源数据',
    unit: '单位倍数',
    standalone: '个别报表',
    consolidated: '合并报表',
    unavailable: '正在加载对比来源…',
    review: '选择来源后，评分前需重新核查并确认。',
  },
}

export function PeriodSourceReview({
  item,
  candidate,
  items,
  sets,
  caseId,
  revision,
  reload,
  onPreview,
}: {
  item: IntakeItem
  candidate: PeriodSourceCandidate
  items: IntakeItem[]
  sets: FinancialSet[]
  caseId: string
  revision: number
  reload: () => void
  onPreview: (item: IntakeItem, page?: number) => void
}) {
  const { locale } = useLocale(),
    copy = text[locale],
    action = useMutation()
  const [chosen, setChosen] = useState(candidate.existing_sets[0]?.set_id ?? '')
  const set = sets.find((s) => s.id === chosen)
  const sources = items.filter((i) =>
    set?.facts.some((f) => 'source_id' in f.source && f.source.source_id === i.prepared_source_id),
  )
  const existing = candidate.existing_sets.find((s) => s.set_id === chosen)
  const periodLabel =
    candidate.period.kind === 'FY'
      ? candidate.period.end_date.slice(0, 4)
      : `${candidate.period.start_date} → ${candidate.period.end_date}`
  const role = (value: string) =>
    value === 'current'
      ? copy.current
      : value === 'comparative'
        ? copy.comparative
        : copy.unspecified
  const matches =
    set &&
    set.scope.period.kind === candidate.period.kind &&
    set.scope.period.start_date === candidate.period.start_date &&
    set.scope.period.end_date === candidate.period.end_date &&
    set.scope.basis === candidate.basis
  return (
    <section
      className="panel aic-section"
      aria-label={`${copy.heading} ${candidate.period.end_date}`}
    >
      <h3>
        {copy.heading}: {candidate.period.start_date} → {candidate.period.end_date} ·{' '}
        {candidate.basis === 'consolidated' ? copy.consolidated : copy.standalone}
      </h3>
      <p>{copy.help}</p>
      {candidate.existing_sets.length > 1 && (
        <label className="field-label">
          {copy.active}
          <select value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={action.busy}>
            {candidate.existing_sets.map((s) => (
              <option key={s.set_id} value={s.set_id}>
                {s.source_names.join(', ') || s.set_id}
              </option>
            ))}
          </select>
        </label>
      )}
      <p>
        {copy.incoming}:{' '}
        <button className="text-button" onClick={() => onPreview(item)}>
          {item.name}
        </button>{' '}
        · {role(candidate.role)} {periodLabel} · {candidate.currency} · {copy.unit}:{' '}
        {candidate.unit_multiplier}
      </p>
      <p>
        {copy.active}:{' '}
        {sources.length
          ? sources.map((s) => (
              <button key={s.id} className="text-button" onClick={() => onPreview(s)}>
                {s.name}
              </button>
            ))
          : existing?.source_names.join(', ') || copy.source}
        {' · '}
        {role(existing?.role ?? 'unspecified')} {periodLabel} · {set?.scope.currency} · {copy.unit}:{' '}
        {set?.scope.unit_multiplier}
      </p>
      {!matches ? (
        <p role="status">{copy.unavailable}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{copy.field}</th>
                <th>{copy.active}</th>
                <th>{copy.incoming}</th>
              </tr>
            </thead>
            <tbody>
              {factKeys.map((key) => {
                const incoming = candidate.facts.find((f) => f.key === key),
                  active = set.facts.find((f) => f.key === key)
                return (
                  <tr key={key}>
                    <th>{financialLabel(locale, 'fact', key).label}</th>
                    <td>{active?.raw_value ?? 'N/A'}</td>
                    <td>
                      {incoming?.value ?? 'N/A'}{' '}
                      {incoming && (
                        <button
                          className="text-button"
                          onClick={() => onPreview(item, incoming.page)}
                        >
                          {copy.open} · {incoming.page}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p>{copy.review}</p>
      <ErrorNotice error={action.error} />
      <div className="wrap-actions">
        {(['keep_period_source', 'select_period_source'] as const).map((choice) => (
          <button
            key={choice}
            className={choice === 'select_period_source' ? 'primary-button' : 'secondary-button'}
            disabled={!matches || action.busy}
            onClick={() =>
              set &&
              void action.run(
                (keys) =>
                  intakeApi.periodSource(caseId, item.id, choice, revision, candidate, set, keys),
                reload,
              )
            }
          >
            {(choice === 'select_period_source' ? copy.use : copy.keep).replace(
              '{period}',
              periodLabel,
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
