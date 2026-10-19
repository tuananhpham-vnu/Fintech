'use client'
import { useState } from 'react'
import { useMutation } from '@/hooks/use-mutation'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { financialApi, type FinancialSet, type CalculationProposal, type FactInput } from '../api'
import { financialLabel } from '../labels'
import { useLocale } from '@/lib/i18n/locale-provider'
import { companyHealthText } from '@/lib/i18n/company-health-copy'
import { ReasoningSources } from './reasoning-sources'

export function calculationFormula(proposal: CalculationProposal) {
  if (proposal.reasoning_version)
    return proposal.proof?.steps.length
      ? `Tính từ ${proposal.proof.steps.length} quan hệ kế toán và ${proposal.proof.leaf_ids.length} dòng nguồn.`
      : proposal.computed_value !== null
        ? 'Số đọc trực tiếp từ BCTC.'
        : 'Chưa xác định được đủ quan hệ và dữ kiện.'
  const stack: string[] = []
  for (const token of proposal.expression) {
    const input = proposal.inputs.find((i) => i.id === token)
    if (input) stack.push(`${input.label} (${input.value})`)
    else {
      const b = stack.pop(),
        a = stack.pop()
      if (!a || !b || !['+', '-', '*', '/'].includes(token)) return 'Công thức không hợp lệ'
      stack.push(`(${a} ${token} ${b})`)
    }
  }
  return stack.length === 1 ? stack[0] : 'Công thức không hợp lệ'
}

export function relationFormula(
  step: NonNullable<CalculationProposal['proof']>['steps'][number],
  proof: NonNullable<CalculationProposal['proof']>,
) {
  const label = (id: string) => proof.variables.find((v) => v.id === id)?.label ?? id
  if (step.kind === 'expression' && step.expression) {
    const stack: string[] = []
    for (const token of step.expression) {
      if (proof.variables.some((v) => v.id === token)) stack.push(label(token))
      else {
        const b = stack.pop(),
          a = stack.pop()
        if (!a || !b || !['+', '-', '*', '/'].includes(token)) return 'Quan hệ cần rà soát'
        stack.push(`(${a} ${token} ${b})`)
      }
    }
    return stack.length === 1
      ? `${label(step.output_variable_id ?? '')} = ${stack[0]}`
      : 'Quan hệ cần rà soát'
  }
  return (
    step.terms
      .map((t) => `${t.coefficient === '-1' ? '−' : '+'} ${label(t.variable_id)}`)
      .join(' ') + ' = 0'
  )
}

const reasons: Record<string, string> = {
  UNRESOLVED_ASSUMPTIONS: 'Còn giả định chưa được chứng minh bằng nguồn.',
  INPUT_SCOPE_OR_UNIT_MISMATCH: 'Nguồn khác kỳ, cơ sở báo cáo hoặc đơn vị.',
  OVERLAPPING_INPUTS: 'Các thành phần có nguy cơ đếm trùng.',
  REUSED_INPUT: 'Một thành phần được sử dụng nhiều lần.',
  DIVISION_BY_ZERO: 'Phép chia có mẫu số bằng 0.',
  NON_TERMINATING_DECIMAL: 'Kết quả không biểu diễn được chính xác bằng số thập phân hữu hạn.',
  TARGET_ALREADY_PRESENT: 'Chỉ tiêu đã có số liệu trực tiếp.',
  NOT_IDENTIFIED: 'Chưa xác định được chỉ tiêu này trong các trang đã đọc.',
  UNDERDETERMINED: 'Các quan hệ hiện có chưa đủ xác định duy nhất giá trị này.',
  CONFLICT: 'Các số nguồn hoặc quan hệ cho kết quả mâu thuẫn. Cần đối chiếu trước khi dùng.',
  AMBIGUOUS_TARGET: 'Có nhiều cách ánh xạ chỉ tiêu; cần xác định đúng phạm vi.',
  TEMPORAL_SCOPE_MISMATCH: 'Số dư đầu kỳ/cuối kỳ hoặc số phát sinh trong kỳ chưa khớp.',
  PRECISION_POLICY_REQUIRED: 'Kết quả cần chính sách độ chính xác trước khi đưa vào chấm điểm.',
  CALCULATION_LIMIT: 'Đã đạt giới hạn xử lý; chưa thể kết luận tài liệu thiếu số liệu.',
  MODEL_OUTPUT_INVALID: 'AI chưa trả được kết quả hợp lệ; có thể thử lại phần xử lý.',
  PROVIDER_UNAVAILABLE: 'Lời gọi AI chưa hoàn tất; dữ liệu đã đọc được vẫn được giữ lại.',
  BUDGET_EXHAUSTED: 'Chưa hoàn tất trong giới hạn xử lý; cần tiếp tục đọc.',
  INVALID_RELATION_SCHEMA:
    'Một quan hệ AI đề xuất chưa hợp lệ; các quan hệ hợp lệ khác vẫn được giữ.',
  TARGETED_SOURCE_SEARCH: 'Đã tìm thêm các trang nguồn liên quan.',
  SOURCE_REVIEW_EXCLUSIONS: 'Đã tính lại sau khi loại dòng nhận diện theo rà soát.',
  SOURCE_COLUMN_MISMATCH: 'Số đọc không thuộc cột kỳ báo cáo đang chọn; đã loại khỏi tính toán.',
  SOURCE_COLUMN_NOT_AVAILABLE: 'Bảng không có cột số liệu cho kỳ đang chọn.',
  NET_TRADE_RECEIVABLES_REQUIRED:
    'Nguồn mới có phải thu khách hàng gộp; cần căn cứ xác định số thuần.',
  UNALLOCATED_RECEIVABLES_PROVISION:
    'Chưa có căn cứ phân bổ dự phòng chung cho phải thu khách hàng.',
  RECEIVABLES_BRIDGE_SIGN_MISMATCH:
    'Công thức trừ dự phòng chưa đúng quy ước dấu của số liệu nguồn.',
  DOWNSTREAM_INPUT_INVALID: 'Chuỗi tính phụ thuộc vào số liệu chưa đáp ứng điều kiện kế toán.',
  RELATION_CONFLICT: 'Các quan hệ sau chưa khớp với số nguồn; cần rà soát hoặc loại quan hệ sai',
  PLANNING_REPAIRED: 'AI đã bổ sung lại liên kết biến thành phần',
}

export function CalculationProposals({
  set,
  revision,
  caseId,
  reload,
  onSource,
}: {
  set: FinancialSet
  revision: number
  caseId: string
  reload: () => void
  onSource?: (sourceId: string, page: number) => void
}) {
  const { locale } = useLocale(),
    copy = (key: Parameters<typeof companyHealthText>[1]) => companyHealthText(locale, key),
    action = useMutation(),
    [selected, select] = useState<string[]>([]),
    [reviewed, review] = useState(false),
    [showCoverage, setShowCoverage] = useState(false),
    [showSources, setShowSources] = useState(false)

  const proposals = set.metadata.calculations ?? []
  if (!proposals.length && !set.metadata.reasoning)
    return set.facts.filter((f) => f.raw_value !== null).length < 14 ? (
      <p className="help-text">{copy('aiProposalsEmpty')}</p>
    ) : null

  const eligible = proposals.filter(
    (p) =>
      !p.blocked_reason &&
      p.computed_value !== null &&
      !set.facts.some((f) => f.key === p.key && f.raw_value !== null),
  )
  const choices = eligible.filter((p) => selected.includes(p.id))
  const appliedCount = proposals.filter((p) =>
    set.facts.some(
      (f) => f.key === p.key && f.source.kind === 'calculated' && f.source.calculation_id === p.id,
    ),
  ).length
  const blockedCount = proposals.filter(
    (p) => !!p.blocked_reason || p.computed_value === null,
  ).length

  const save = (facts: FactInput[], reason: string) =>
    action.run(
      (keys) =>
        financialApi.save(
          caseId,
          set.id,
          {
            expected_revision: revision,
            reason,
            period: set.scope.period,
            basis: set.scope.basis,
            accounting_regime: set.scope.accounting_regime,
            currency: set.scope.currency,
            unit_multiplier: set.scope.unit_multiplier,
            industry_scope: set.scope.pilot_scope,
            observation_kind: set.metadata.observation_kind,
            audit_status: set.metadata.audit_status,
            statement_version: set.metadata.statement_version,
            facts,
          },
          keys,
        ),
      () => {
        select([])
        review(false)
        reload()
      },
    )

  return (
    <section className="ai-proposals-panel">
      {/* Header */}
      <div className="ai-panel-header">
        <div className="ai-header-top">
          <div className="ai-title-group">
            <div className="ai-sparkle-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
            <div>
              <h3 className="ai-panel-title">{copy('aiProposalsHeading')}</h3>
            </div>
          </div>
          <div className="ai-stats-pills">
            <span className="ai-stat-pill total">
              {proposals.length} {copy('proposalsCountSuffix')}
            </span>
            {appliedCount > 0 && (
              <span className="ai-stat-pill applied">
                ✓ {appliedCount} {copy('appliedCountSuffix')}
              </span>
            )}
            {eligible.length > 0 && (
              <span className="ai-stat-pill ready">
                {eligible.length} {copy('eligibleCountSuffix')}
              </span>
            )}
            {blockedCount > 0 && (
              <span className="ai-stat-pill blocked">
                ⚠ {blockedCount} {copy('blockedCountSuffix')}
              </span>
            )}
          </div>
        </div>
        <p className="ai-panel-desc">{copy('aiProposalsDesc')}</p>
      </div>

      {/* Diagnostics Drawer Toggles */}
      {set.metadata.reasoning && (
        <div className="ai-diagnostics-bar">
          <button
            type="button"
            className={`diag-drawer-toggle ${showCoverage ? 'active' : ''}`}
            onClick={() => setShowCoverage((v) => !v)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {copy('drawerCoverageTitle')} ({set.metadata.reasoning.coverage.pages_read.length}/
            {set.metadata.reasoning.coverage.pages_available.length}{' '}
            {set.metadata.reasoning.coverage.complete ? 'hoàn tất' : 'chưa đủ'})
          </button>
          <button
            type="button"
            className={`diag-drawer-toggle ${showSources ? 'active' : ''}`}
            onClick={() => setShowSources((v) => !v)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {copy('drawerSourcesTitle')}
          </button>
        </div>
      )}

      {/* Coverage Drawer Content */}
      {showCoverage && set.metadata.reasoning && (
        <div className="diag-drawer-content">
          <p style={{ margin: 0, fontSize: '13px', color: '#475569' }}>
            {copy('coverageAnalyzedPrefix')} {set.metadata.reasoning.coverage.pages_read.length}/
            {set.metadata.reasoning.coverage.pages_available.length} {copy('coveragePagesSuffix')}
            {!set.metadata.reasoning.coverage.complete && copy('coverageIncompleteNotice')}
          </p>
          <div className="diag-targets-grid">
            {set.metadata.reasoning.targets.map((t) => (
              <div
                key={t.key}
                className={`diag-target-chip ${t.status === 'resolved' ? 'resolved' : 'unresolved'}`}
              >
                <strong>{financialLabel(locale, 'fact', t.key).label}</strong>
                <span>
                  {t.status === 'resolved'
                    ? t.origin === 'direct'
                      ? copy('targetDirect')
                      : copy('targetCalculated')
                    : (reasons[t.code ?? ''] ?? t.code)}
                </span>
              </div>
            ))}
          </div>
          {set.metadata.reasoning.diagnostics.map((d, i) => (
            <p key={i} className="help-text">
              {reasons[d.code] ?? d.code}: {d.detail}
            </p>
          ))}
        </div>
      )}

      {/* Sources Drawer Content */}
      {showSources && (
        <div className="diag-drawer-content" style={{ background: '#fafbfc' }}>
          <ReasoningSources
            key={set.metadata.reasoning?.receipt_id}
            set={set}
            caseId={caseId}
            revision={revision}
            reload={reload}
            onSource={onSource}
          />
        </div>
      )}

      {/* Proposals List */}
      <div className="ai-proposals-list">
        {proposals.map((p) => {
          const applied = set.facts.find(
            (f) =>
              f.key === p.key && f.source.kind === 'calculated' && f.source.calculation_id === p.id,
          )
          const isBlocked = !!p.blocked_reason || p.computed_value === null
          const isEligible = eligible.includes(p)
          const isSelected = selected.includes(p.id)

          return (
            <article
              key={p.id}
              className={`ai-proposal-card ${applied ? 'applied' : ''} ${isBlocked ? 'blocked' : ''}`}
            >
              <div className="proposal-card-header">
                <div className="proposal-header-left">
                  <input
                    type="checkbox"
                    className="proposal-checkbox-custom"
                    checked={isSelected}
                    disabled={!isEligible || action.busy}
                    onChange={(e) =>
                      select(
                        e.target.checked
                          ? [...selected, p.id]
                          : selected.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <div className="proposal-name-wrap">
                    <span className="proposal-name-text">
                      {financialLabel(locale, 'fact', p.key).label}
                    </span>
                    {p.computed_value !== null ? (
                      <span className="proposal-val-badge success">
                        {p.computed_value} {set.scope.currency}
                      </span>
                    ) : (
                      <span className="proposal-val-badge blocked">
                        {copy('insufficientBasis')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="proposal-header-right">
                  {applied ? (
                    <>
                      <span className="proposal-status-pill applied">
                        ✓{' '}
                        {applied.verification.status === 'verified'
                          ? copy('statusVerifiedApplied')
                          : copy('statusPendingConfirmation')}
                      </span>
                      <button
                        type="button"
                        className="btn-proposal-revert"
                        disabled={action.busy}
                        onClick={() =>
                          void save(
                            set.facts.filter((f) => f.key !== p.key),
                            copy('removeAppliedSuccessNote'),
                          )
                        }
                      >
                        {copy('btnRemoveAppliedFact')}
                      </button>
                    </>
                  ) : isEligible ? (
                    <span className="proposal-status-pill ready">{copy('statusReadyToApply')}</span>
                  ) : (
                    <span className="proposal-status-pill blocked">
                      ⚠ {copy('statusNeedsSources')}
                    </span>
                  )}
                </div>
              </div>

              <div className="proposal-card-body">
                <div className="formula-reasoning-box">
                  <div className="formula-row">
                    <span className="formula-icon">∑</span>
                    <span className="formula-text">
                      <strong>{copy('basisOfCalculation')}:</strong> {calculationFormula(p)}
                    </span>
                  </div>
                  {p.reason && (
                    <div className="reasoning-row">
                      <span className="reasoning-icon">💡</span>
                      <span>{isBlocked ? copy('blockedProposalReason') : p.reason}</span>
                    </div>
                  )}
                </div>

                {p.proof && (
                  <details className="proposal-details-accordion">
                    <summary className="proposal-accordion-summary">
                      <span>{copy('summaryProofSteps')}</span>
                      <span>▾</span>
                    </summary>
                    <div className="proposal-accordion-content">
                      {p.proof.steps.map((step) => (
                        <div key={step.id} className="proof-step-card">
                          <div className="proof-step-top">
                            <strong>{step.label}</strong>: {relationFormula(step, p.proof!)}
                          </div>
                          <p style={{ margin: '2px 0', color: '#64748b' }}>{step.reason}</p>
                          {step.evidence.map((e, i) => (
                            <div key={i} className="proof-evidence-quote">
                              "{e.quote}"
                              {onSource && (
                                <div>
                                  <button
                                    type="button"
                                    className="btn-open-source-pill"
                                    onClick={() => onSource(p.source_id, e.page)}
                                  >
                                    📄 {copy('pagePrefix')} {e.page}
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                      {p.proof.intermediate_values.length > 0 && (
                        <div style={{ marginTop: '6px' }}>
                          <strong style={{ fontSize: '12px', color: '#475569' }}>
                            Các giá trị trung gian:
                          </strong>
                          <ul style={{ margin: '4px 0 0 18px', color: '#64748b' }}>
                            {p.proof.intermediate_values.map((v) => (
                              <li key={v.variable_id}>
                                {p.proof!.variables.find((n) => n.id === v.variable_id)?.label ??
                                  v.variable_id}
                                : {v.value.decimal ?? `${v.value.numerator}/${v.value.denominator}`}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </details>
                )}

                {p.inputs.map((input) => (
                  <details key={input.id} className="proposal-details-accordion">
                    <summary className="proposal-accordion-summary">
                      <span>
                        {copy('summarySourceLine')}: <strong>{input.label}</strong> (
                        {input.raw_token}) · {copy('pagePrefix')} {input.page}
                      </span>
                      {onSource && (
                        <button
                          type="button"
                          className="btn-open-source-pill"
                          onClick={(e) => {
                            e.stopPropagation()
                            onSource(p.source_id, input.page)
                          }}
                        >
                          📄 {copy('btnOpenSourceDoc')}
                        </button>
                      )}
                    </summary>
                    <div className="proposal-accordion-content">
                      <p style={{ color: '#64748b', margin: 0 }}>
                        {input.period_start} → {input.period_end} · {input.basis} · {input.currency}{' '}
                        × {input.unit_multiplier}
                      </p>
                      <blockquote className="proof-evidence-quote">"{input.quote}"</blockquote>
                    </div>
                  </details>
                ))}

                {!!p.assumptions.length && (
                  <ul style={{ margin: '8px 0 0 18px', color: '#64748b', fontSize: '12.5px' }}>
                    {p.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                )}

                {p.blocked_reason && (
                  <div className="proposal-warning-callout">
                    <span style={{ fontSize: '15px' }}>⚠</span>
                    <div>
                      {reasons[p.blocked_reason] ??
                        'Công thức hoặc căn cứ chưa hợp lệ; không thể áp dụng.'}
                    </div>
                  </div>
                )}

                {p.blocked_details && (
                  <div
                    className="proposal-warning-callout"
                    style={{ background: '#fefce8', borderColor: '#fef08a', color: '#854d0e' }}
                  >
                    <span style={{ fontSize: '15px' }}>ℹ</span>
                    <div>
                      {!!p.blocked_details.missing_variables.length && (
                        <div>
                          <p style={{ margin: 0 }}>{copy('missingSourceVariablesPrefix')}:</p>
                          {p.blocked_details.missing_variables.map((v) => (
                            <div key={v.id}>
                              <p>
                                {v.label} —{' '}
                                {copy(
                                  v.source_status === 'allocation_unproven'
                                    ? 'sourceAllocationUnproven'
                                    : v.source_status === 'observed_unlinked'
                                      ? 'sourceObservedUnlinked'
                                      : v.source_status === 'scope_mismatch'
                                        ? 'sourceScopeMismatch'
                                        : 'sourceNotObserved',
                                )}
                              </p>
                              {v.source_candidates?.map((o) => (
                                <p key={o.observation_id}>
                                  <button
                                    type="button"
                                    className="text-button"
                                    disabled={!onSource}
                                    onClick={() => onSource?.(p.source_id, o.page)}
                                  >
                                    {copy('pagePrefix')} {o.page}: {o.label}
                                  </button>{' '}
                                  · {o.quote}
                                </p>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                      {p.blocked_details.assumptions.map((a, i) => (
                        <p key={i} style={{ margin: '2px 0 0' }}>
                          {copy('assumptionPrefix')}: {a}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {/* Footer Confirmation & Action Bar */}
      <div className="ai-panel-footer">
        <label className="footer-confirm-label">
          <input type="checkbox" checked={reviewed} onChange={(e) => review(e.target.checked)} />
          <span>{copy('reviewConfirmCheckboxText')}</span>
        </label>
        <ErrorNotice error={action.error} />
        <button
          className="btn-apply-proposals"
          disabled={action.busy || !reviewed || !choices.length}
          onClick={() =>
            void save(
              [
                ...set.facts.filter((f) => !choices.some((p) => p.key === f.key)),
                ...choices.map((p) => ({
                  key: p.key,
                  raw_value: p.computed_value,
                  raw_label: 'Số tính ra: ' + p.key,
                  missing_reason: null,
                  source: {
                    kind: 'calculated' as const,
                    receipt_id: p.receipt_id,
                    calculation_id: p.id,
                    fact_key: p.key,
                    source_kind: p.source_kind,
                    source_id: p.source_id,
                    source_hash: p.source_hash,
                    page: p.inputs[0].page,
                    quote: p.inputs[0].quote,
                  },
                })),
              ],
              copy('applySuccessNote'),
            )
          }
        >
          {copy('btnApplySelectedProposals')}
          {choices.length > 0 ? ` (${choices.length})` : ''}
        </button>
      </div>
    </section>
  )
}
