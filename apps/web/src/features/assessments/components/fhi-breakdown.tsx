'use client'
import { Modal } from '@/components/ui/modal'
import { fhiMetrics } from '@/features/assessments/fhi'
import { financialLabel } from '@/features/financial/labels'
import { Status } from '@/components/ui/status'
import type { Assessment } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { displayValue } from '@/lib/utils/format'
import { useState } from 'react'

export function FhiBreakdown({
  result,
  showNumbers,
}: {
  result: Assessment | null | undefined
  showNumbers: boolean
}) {
  const { t, locale } = useLocale()
  const [selected, setSelected] = useState<(typeof fhiMetrics)[number] | null>(null)
  const health = result?.financial_health
  const component = health?.components.find((part) => part.metric_id === selected?.id)
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
      {!health && <p className="help-text">{t('integrationPending')}</p>}
      {health && (
        <>
          <p>
            <Status value={health.status} />
          </p>
          <details>
            <summary>
              {locale === 'en'
                ? 'Technical details'
                : locale === 'vi'
                  ? 'Chi tiết kỹ thuật'
                  : '技术详情'}
            </summary>
            <code>
              {health.status} · {health.score_quality}
            </code>
          </details>
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
              <details>
                <summary>
                  {locale === 'en'
                    ? 'Technical details'
                    : locale === 'vi'
                      ? 'Chi tiết kỹ thuật'
                      : '技术详情'}
                </summary>
                <code>{displayValue(item)}</code>
              </details>
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
                {showNumbers ? (part?.points ?? '—') : '—'} / {metric.max}
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
          <details>
            <summary>
              {locale === 'en'
                ? 'Technical details'
                : locale === 'vi'
                  ? 'Chi tiết kỹ thuật'
                  : '技术详情'}
            </summary>
            <code>
              {selected.id} · {selected.formula}
            </code>
            {component?.formula_id && <p>{component.formula_id}</p>}
          </details>
          <p>
            {t('effective')}: {component?.raw_value ?? '—'}
          </p>
          <p>
            {t('score')}: {showNumbers ? (component?.points ?? '—') : '—'} / {selected.max}
          </p>
          {component?.verification_state && <Status value={component.verification_state} />}
          <h3>{t('sourceFacts')}</h3>
          {component?.source_facts.map((ref) => (
            <p className="mono" key={ref}>
              {ref}
            </p>
          ))}
          <p>{t('factSourcePending')}</p>
        </Modal>
      )}
    </section>
  )
}
