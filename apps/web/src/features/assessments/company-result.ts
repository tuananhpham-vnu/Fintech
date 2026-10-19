import type { Assessment, Readiness } from '@/lib/api/contracts'
import { assessmentIsStale } from './model'
import { hasCompleteFhi } from './fhi'

const dataBlockers = new Set([
  'MISSING_FACT',
  'UNVERIFIED_FACT',
  'QUICK_ASSETS_UNAVAILABLE',
  'EBITDA_BRIDGE_UNAVAILABLE',
  'OPERATING_PROFIT_BRIDGE_UNAVAILABLE',
])

/** Presentation gating only; all point arithmetic is performed by the backend. */
export function companyResult(
  result: Assessment | null | undefined,
  context: {
    caseId: string
    revision: number
    setId?: string
    requireCaseAggregation?: boolean
    confirmed: boolean
    loading: boolean
    readiness: Readiness | null
  },
) {
  const current =
    !!result &&
    result.state === 'completed' &&
    (result.case_aggregation
      ? result.purpose === 'company_health' && result.financial_set_id === null
      : !context.requireCaseAggregation &&
        !!context.setId &&
        result.financial_set_id === context.setId) &&
    !assessmentIsStale(result, context.revision, context.caseId) &&
    context.confirmed &&
    !context.loading &&
    context.readiness?.case_revision === context.revision
  const approved =
    !!context.readiness &&
    ['configured_pilot', 'validation_pending', 'validated_for_limited_use'].includes(
      context.readiness.method_status,
    )
  const complete =
    current && approved && !!context.readiness?.numeric_assessment_allowed && hasCompleteFhi(result)
  const partial =
    current &&
    approved &&
    result?.purpose === 'company_health' &&
    ['configured_pilot', 'validation_pending'].includes(context.readiness!.method_status) &&
    context.readiness?.assessment_allowed &&
    context.readiness.blockers.every((b) => dataBlockers.has(b.code)) &&
    result.financial_health?.score === null &&
    result.financial_health.band === null &&
    result.financial_health.status === 'blocked'
      ? (result.financial_health.partial_assessment ?? null)
      : null
  return { current, complete, partial }
}

export const companyResultText = {
  vi: {
    partialTitle: 'Điểm phần đã đủ dữ liệu',
    coverage: 'chỉ tiêu đủ điều kiện tính',
    range: 'Khoảng tổng điểm nếu các chỉ tiêu còn lại đủ điều kiện',
    note: 'Giữ nguyên trọng số. Phần chưa xác định có thể đóng góp từ 0 đến',
    points: 'điểm; chưa gán giá trị cho phần thiếu.',
    noBand:
      'Chưa xác định tổng điểm duy nhất hoặc band. Khoảng này không phải khoảng tin cậy thống kê hay PD.',
    partialComponent: 'Điểm phần đã xác minh; tổng điểm chưa đầy đủ',
    completedBlocked: 'Đã đánh giá — chưa đủ điều kiện phát tổng điểm',
    completed: 'Đã đánh giá',
    blockedObservations: 'Đã đánh giá; xem điểm từng chỉ tiêu và các điều kiện còn thiếu.',
  },
  en: {
    partialTitle: 'Points for assessable metrics',
    coverage: 'metrics eligible for calculation',
    range: 'Total-score bounds if the remaining metrics become eligible',
    note: 'Original weights retained. Unresolved metrics could contribute 0 to',
    points: 'points; missing values have not been assigned.',
    noBand:
      'No single total or band is assigned. These bounds are not a statistical confidence interval or PD.',
    partialComponent: 'Verified metric points; the total remains incomplete',
    completedBlocked: 'Assessment completed — total score unavailable',
    completed: 'Assessment completed',
    blockedObservations: 'Assessment completed; see individual metrics and unresolved conditions.',
  },
  'zh-CN': {
    partialTitle: '可评估指标得分',
    coverage: '项指标符合计算条件',
    range: '其余指标符合条件时的总分范围',
    note: '保留原有权重。未确定指标可能贡献 0 至',
    points: '分；未为缺失数据赋值。',
    noBand: '尚未确定单一总分或等级。此范围并非统计置信区间或违约概率 (PD)。',
    partialComponent: '已核实指标得分；总分尚不完整',
    completedBlocked: '评估已完成，尚不满足总分发布条件',
    completed: '评估已完成',
    blockedObservations: '评估已完成；请查看各指标和未解决条件。',
  },
} as const
