'use client'
import { useCallback } from 'react'
import { useResource } from '@/hooks/use-resource'
import { importApi } from '../import-api'
import { useLocale } from '@/lib/i18n/locale-provider'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { financialLabel } from '../labels'

export function FinancialDiagnostics({
  caseId,
  setId,
  revision,
}: {
  caseId: string
  setId: string
  revision: number
}) {
  const { locale } = useLocale(),
    w = (en: string, vi: string, zh: string) => (locale === 'vi' ? vi : locale === 'en' ? en : zh)
  const load = useCallback(
    (signal: AbortSignal) => importApi.diagnostics(caseId, setId, signal),
    [caseId, setId, revision],
  )
  const resource = useResource(load, true)
  const observation: Record<string, string> = {
    NEGATIVE_TOTAL_EQUITY: w('Equity is negative', 'Vốn chủ sở hữu âm', '所有者权益为负'),
    NEGATIVE_OPERATING_PROFIT: w(
      'Operating result is negative',
      'Kết quả kinh doanh từ hoạt động âm',
      '营业利润为负',
    ),
    NEGATIVE_CASH_FROM_OPERATIONS: w(
      'Net operating cash flow is negative',
      'Dòng tiền thuần từ kinh doanh âm',
      '经营现金流量净额为负',
    ),
    CURRENT_LIABILITIES_EXCEED_CURRENT_ASSETS: w(
      'Current liabilities exceed current assets',
      'Nợ ngắn hạn lớn hơn tài sản ngắn hạn',
      '流动负债超过流动资产',
    ),
  }
  const names: Record<string, string> = {
    current_ratio: w('Current ratio', 'Khả năng thanh toán hiện hành', '流动比率'),
    liabilities_to_assets: w('Liabilities / assets', 'Nợ phải trả / tài sản', '负债 / 资产'),
    equity_to_assets: w('Equity / assets', 'Vốn chủ sở hữu / tài sản', '权益 / 资产'),
    interest_debt_to_assets: w(
      'Interest-bearing debt / assets',
      'Nợ vay có lãi / tài sản',
      '有息负债 / 资产',
    ),
    operating_margin: w(
      'Operating profit / revenue',
      'Lợi nhuận hoạt động / doanh thu',
      '营业利润 / 营业收入',
    ),
    operating_cash_margin: w(
      'Operating cash flow / revenue',
      'Dòng tiền kinh doanh / doanh thu',
      '经营现金流 / 营业收入',
    ),
    interest_coverage: w(
      'Operating profit / gross interest expense',
      'Lợi nhuận hoạt động / chi phí lãi vay gộp',
      '营业利润 / 利息费用',
    ),
  }
  return (
    <section className="panel aic-section">
      <h3>
        {w(
          'Financial ratios and observations',
          'Tỷ số tài chính và dấu hiệu cần xem xét',
          '财务比率及待关注事实',
        )}
      </h3>
      <p className="help-text">
        {w(
          'Calculated only from verified current facts in this statement set. These observations are not calibrated credit ratings or probabilities of default. Accounting definitions may differ between countries.',
          'Chỉ tính từ dữ kiện đã xác minh và còn hiệu lực trong bộ BCTC đang chọn. Các dấu hiệu này chưa phải xếp hạng tín dụng hay xác suất vỡ nợ đã kiểm định. Định nghĩa kế toán có thể khác giữa các nước.',
          '仅使用本套报表中已核实且有效的数据。这些事实不等于经校准的信用评级或违约概率，各国会计定义可能不同。',
        )}
      </p>
      <ErrorNotice error={resource.error} retry={resource.reload} />
      {resource.data && (
        <>
          <div className="ratio-grid">
            {resource.data.metrics.map((m) => (
              <article key={m.id}>
                <strong>{names[m.id] ?? m.id}</strong>
                <p className="ratio-value">{m.display === null ? '—' : m.display + ' ×'}</p>
                <p>
                  {financialLabel(locale, 'fact', m.numerator).label} /{' '}
                  {financialLabel(locale, 'fact', m.denominator).label}
                </p>
                {m.display === null && (
                  <p className="help-text">
                    {w(
                      'Requires verified facts and a positive denominator.',
                      'Cần dữ kiện đã xác minh và mẫu số dương.',
                      '需要已核实数据及正分母。',
                    )}
                  </p>
                )}
              </article>
            ))}
          </div>
          {resource.data.observations.map((o) => (
            <p className="warning-banner" key={o.code}>
              {observation[o.code] ?? o.code}
            </p>
          ))}
          <p>
            {w(
              'Assets − liabilities − equity',
              'Tài sản − nợ phải trả − vốn chủ sở hữu',
              '资产 − 负债 − 权益',
            )}
            : {resource.data.balance_check.residual ?? '—'}
          </p>
          {resource.data.balance_check.status === 'not_exact' && (
            <p className="help-text">
              {w(
                'Review rounding, consolidation scope and the source rows before drawing conclusions.',
                'Cần xem lại làm tròn, phạm vi hợp nhất và các dòng nguồn trước khi kết luận.',
                '请先复核舍入、合并范围及原始行后再作判断。',
              )}
            </p>
          )}
        </>
      )}
    </section>
  )
}
