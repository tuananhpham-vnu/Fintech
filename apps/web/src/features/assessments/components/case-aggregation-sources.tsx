import type { CaseAggregation, Locale } from '@/lib/api/contracts'
import type { Registry } from '@/features/financial/api'
import type { IntakePage } from '@/features/financial/intake-api'
import { importSourceUrl } from '@/features/financial/import-api'
import { financialLabel } from '@/features/financial/labels'
import { formatRatio } from '@/features/financial/presentation'
import { displayDecimal } from '@/lib/utils/format'

export function CaseAggregationSources({
  value,
  registry,
  page,
  locale,
}: {
  value: CaseAggregation
  registry: Registry | null
  page: IntakePage
  locale: Locale
}) {
  const text = (vi: string, en: string, zh: string) =>
    locale === 'vi' ? vi : locale === 'en' ? en : zh
  function reason(code: string) {
    if (code === 'REPORTING_BASIS_NOT_SELECTED')
      return text(
        'Không thuộc cơ sở hợp nhất/riêng lẻ đã chọn.',
        'Outside the selected reporting basis.',
        '不属于所选合并/个别报表范围。',
      )
    if (code === 'FULL_CALENDAR_FY_REQUIRED')
      return text(
        'Chưa dùng trong bình quân năm: kỳ chưa đủ một năm theo phương pháp.',
        'Excluded from annual mean: not a full financial year under the method.',
        '未纳入年度均值：不符合方法的完整财年要求。',
      )
    if (code === 'NO_ASSESSABLE_METRICS')
      return text(
        'Chưa có chỉ tiêu đủ điều kiện tính.',
        'No eligible metrics yet.',
        '暂无符合条件的指标。',
      )
    if (code === 'MULTIPLE_STATEMENT_VERSIONS')
      return text(
        'Có nhiều bản cùng kỳ, cần đối chiếu nguồn.',
        'Same-period versions need source reconciliation.',
        '同期间存在多个版本，需核对来源。',
      )
    return financialLabel(locale, 'blocker', code).label
  }
  return (
    <section className="panel aic-section">
      <h3>
        {text('Cơ sở tổng hợp toàn hồ sơ', 'Case-wide assessment basis', '整个档案的汇总依据')}
      </h3>
      {value.accounting_profile && (
        <p role="note">
          {value.accounting_profile.country} · {value.accounting_profile.accounting_regime} ·{' '}
          {value.accounting_profile.method_version}.{' '}
          {text(
            'Điểm sức khỏe tài chính thử nghiệm. Giữ cách phân loại dòng tiền theo chuẩn nguồn; chưa hiệu chỉnh rủi ro tín dụng giữa các nước.',
            'Experimental financial-health points. Source cash-flow classification retained; credit risk is not calibrated across countries.',
            '试验性财务健康评分。保留来源准则的现金流分类；未进行跨国信用风险校准。',
          )}
        </p>
      )}
      <p>
        {text(
          'Bình quân điểm từng chỉ tiêu qua các năm hợp lệ; giữ nguyên trọng số. Năm thiếu chỉ tiêu không tham gia bình quân chỉ tiêu đó.',
          'Average each metric’s points across eligible years, retaining its original weight. A missing observation has no vote.',
          '对各指标的合格年度得分取平均，保留原权重。缺失年度不参与该指标均值。',
        )}
      </p>
      <p>
        {value.included_set_ids.length}{' '}
        {text('năm có đóng góp', 'contributing years', '个年度参与汇总')} ·{' '}
        {value.excluded_sets.length} {text('kỳ chưa dùng', 'excluded periods', '个期间未纳入')}
      </p>
      <details>
        <summary>
          {text(
            'Xem điểm từng năm và nguồn đã dùng',
            'Inspect annual points and sources',
            '查看各年度得分及来源',
          )}
        </summary>
        {value.metrics.map((metric) => (
          <div key={metric.metric_id}>
            <h4>{financialLabel(locale, 'metric', metric.metric_id).label}</h4>
            {!metric.contributions.length ? (
              <p>N/A</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{text('Năm', 'Year', '年度')}</th>
                      <th>{text('Tỷ số trong năm', 'Annual ratio', '年度比率')}</th>
                      <th>{text('Điểm trong năm', 'Annual points', '年度得分')}</th>
                      <th>{text('Nguồn', 'Sources', '来源')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metric.contributions.map((c) => {
                      const set = registry?.sets.find(
                        (s) => s.id === c.set_id && s.revision === c.set_revision,
                      )
                      const facts = set?.facts.filter((f) => c.source_fact_ids.includes(f.id)) ?? []
                      const sources = [
                        ...new Map(
                          facts
                            .filter((f) => f.source.kind !== 'manual_entry')
                            .map((f) => {
                              const source = f.source
                              if (source.kind === 'manual_entry') return ['', null] as const
                              const id =
                                source.kind === 'document' ? source.document_id : source.source_id
                              const kind =
                                source.kind === 'document' ? 'document' : source.source_kind
                              const name =
                                page.items.find((i) => i.prepared_source_id === id)?.name ??
                                text('Tài liệu nguồn', 'Source document', '来源文件')
                              return [
                                `${kind}:${id}:${source.page}`,
                                { id, kind, page: source.page, name },
                              ] as const
                            }),
                        ).values(),
                      ].filter((s) => s !== null)
                      return (
                        <tr key={c.set_id}>
                          <td>
                            {c.period.end_date.slice(0, 4)}
                            <small>
                              {set ? financialLabel(locale, 'basis', set.scope.basis).label : ''}
                            </small>
                          </td>
                          <td>
                            {c.raw_value === null
                              ? 'N/A'
                              : formatRatio(c.raw_value, metric.metric_id, locale)}
                          </td>
                          <td>{displayDecimal(c.points)}</td>
                          <td>
                            {sources.map((s) => (
                              <p key={`${s.kind}:${s.id}:${s.page}`}>
                                <a
                                  href={importSourceUrl(s, s.page)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {s.name} · {text('trang', 'page', '页')} {s.page}
                                </a>
                              </p>
                            ))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!!metric.omitted_sets.length && (
              <p className="muted">
                {text('Không tính vào bình quân:', 'Omitted from this mean:', '未参与该均值：')}{' '}
                {metric.omitted_sets
                  .map(
                    (s) =>
                      registry?.sets
                        .find((r) => r.id === s.set_id)
                        ?.scope.period.end_date.slice(0, 4) ?? 'N/A',
                  )
                  .join(', ')}
              </p>
            )}
          </div>
        ))}
      </details>
      {!!value.excluded_sets.length && (
        <details>
          <summary>
            {text(
              'Các kỳ chưa dùng và lý do',
              'Excluded periods and reasons',
              '未纳入的期间及原因',
            )}
          </summary>
          {value.excluded_sets.map((s) => (
            <p key={s.set_id}>
              {registry?.sets.find((r) => r.id === s.set_id)?.scope.period.end_date ?? 'N/A'}:{' '}
              {s.reasons.map(reason).join(' · ')}
            </p>
          ))}
        </details>
      )}
    </section>
  )
}
