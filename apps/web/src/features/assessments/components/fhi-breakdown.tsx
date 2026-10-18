'use client'
import { TechnicalDetails } from '@/components/ui/technical-details'
import { Modal } from '@/components/ui/modal'
import { fhiMetrics } from '@/features/assessments/fhi'
import { financialLabel, metricExplanation } from '@/features/financial/labels'
import { Status } from '@/components/ui/status'
import type { Assessment } from '@/lib/api/contracts'
import type { SourceTarget } from '@/features/evidence/types'
import { useLocale } from '@/lib/i18n/locale-provider'
import { displayDecimal, displayValue } from '@/lib/utils/format'
import type { FinancialSet } from '@/features/financial/api'
import { productText, presentNote } from '@/lib/i18n/product-copy'
import { useState } from 'react'
import { specialistText } from '@/lib/i18n/specialist-copy'
import { formatRatio } from '@/features/financial/presentation'

export function FhiBreakdown({
  result,
  showNumbers,
  openSource,
  statementSet,
  current = false,
}: {
  result: Assessment | null | undefined
  statementSet?: FinancialSet
  current?: boolean
  showNumbers: boolean
  openSource: (target: SourceTarget) => void
}) {
  const { t, locale } = useLocale()
  const [selected, setSelected] = useState<(typeof fhiMetrics)[number] | null>(null)
  const health = result?.financial_health
  const component = health?.components.find((part) => part.metric_id === selected?.id)
  const sources =
    result?.factors.find((factor) => factor.factor_id === selected?.id)?.evidence_refs ?? []
  return (
    <section className="panel aic-section">
      <h3>{t('financialIndex')} · AIC-FHI-1.0</h3>
      <p>{t('fhiScope')}</p>
      <div className="aic-category-strip">
        {(
          [
            ['liquidity', '25'],
            ['capital', '20'],
            ['leverage', '25'],
            ['profitability', '30'],
          ] as const
        ).map(([key, weight]) => (
          <span className="tag" key={key}>
            {t(key)} · {weight}/100
          </span>
        ))}
      </div>
      {!health && <p className="help-text">{t('noAssessment')}</p>}
      {health && (
        <>
          <p>
            <Status value={showNumbers ? health.status : 'needs_review'} />
          </p>
          <TechnicalDetails>
            <code>
              {health.status} · {health.score_quality}
            </code>
          </TechnicalDetails>
          {[...(health.blockers ?? []), ...(health.missing_facts ?? [])].map((item, index) => (
            <div className="aic-blocker" key={index}>
              <p>
                {
                  financialLabel(
                    locale,
                    'blocker',
                    typeof item === 'string' ? item : displayValue(item),
                  ).label
                }
              </p>
              <TechnicalDetails>
                <code>{displayValue(item)}</code>
              </TechnicalDetails>
            </div>
          ))}
        </>
      )}
      <div className="aic-factor-grid">
        {fhiMetrics.map((metric) => {
          const part = health?.components.find((value) => value.metric_id === metric.id)
          return (
            <button
              className="panel aic-factor"
              key={metric.id}
              onClick={() => setSelected(metric)}
            >
              <strong>
                {financialLabel(locale, 'metric', metric.id).label} · {t(metric.group)}
              </strong>
              <span>
                {showNumbers ? displayDecimal(part?.points) : '—'} / {metric.max}
              </span>
            </button>
          )
        })}
      </div>
      {selected && (
        <Modal
          title={financialLabel(locale, 'metric', selected.id).label}
          onClose={() => setSelected(null)}
          drawer
        >
          <h3>{t(selected.group)}</h3>
          {!current && (
            <p className="warning-banner">
              {specialistText(locale, 'historic')} · {specialistText(locale, 'changed')}
            </p>
          )}
          {statementSet && (
            <p className="help-text">
              {productText(locale, 'resultPeriod')}: {statementSet.scope.period.start_date}–
              {statementSet.scope.period.end_date} ·{' '}
              {financialLabel(locale, 'basis', statementSet.scope.basis).label} ·{' '}
              {statementSet.scope.currency}
            </p>
          )}
          <p>{metricExplanation(locale, selected.id)}</p>
          <TechnicalDetails>
            <code>
              {selected.id} · {selected.formula}
            </code>
            {component?.formula_id && <p>{component.formula_id}</p>}
          </TechnicalDetails>
          <p>
            {specialistText(locale, 'ratio')}:{' '}
            {formatRatio(component?.raw_value, selected.id, locale)}
          </p>
          <p>
            {t('score')}: {showNumbers ? displayDecimal(component?.points) : '—'} / {selected.max}
          </p>
          {component?.verification_state && (
            <p>
              {specialistText(locale, 'savedVerification')}:{' '}
              <Status value={component.verification_state} />
            </p>
          )}
          {!current && <p className="help-text">{specialistText(locale, 'noSnapshot')}</p>}
          <h3>{current ? t('sourceFacts') : specialistText(locale, 'currentFacts')}</h3>
          {statementSet?.facts
            .filter((f) => component?.source_facts.includes(f.id))
            .map((f) => (
              <div className="source-fact" key={f.id}>
                <strong>{financialLabel(locale, 'fact', f.key).label}</strong>
                <p>
                  {displayDecimal(f.normalized_decimal)} · {statementSet.scope.currency} ·{' '}
                  {specialistText(locale, 'currentVerification')}:{' '}
                  {financialLabel(locale, 'verification', f.verification.status).label}
                </p>
                {f.source.kind === 'manual_entry' && (
                  <p className="help-text">{presentNote(f.source.statement, locale)}</p>
                )}
                {f.source.kind === 'document' && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      f.source.kind === 'document' &&
                      openSource({ evidenceId: f.source.evidence_ref })
                    }
                  >
                    {productText(locale, 'viewSource')} · {t('page')} {f.source.page} ·{' '}
                    {specialistText(locale, 'sourceVersion')} {f.source.document_version}
                  </button>
                )}
              </div>
            ))}
          {sources.map((id, index) => (
            <button key={id} className="text-button" onClick={() => openSource({ evidenceId: id })}>
              {t('source')} {index + 1}
            </button>
          ))}
          <p className="help-text">{productText(locale, 'ratioHelp')}</p>
        </Modal>
      )}
    </section>
  )
}
