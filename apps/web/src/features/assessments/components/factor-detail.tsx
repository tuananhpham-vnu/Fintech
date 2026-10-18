'use client'
import { Modal } from '@/components/ui/modal'
import { Status } from '@/components/ui/status'
import type { SourceTarget } from '@/features/evidence/types'
import { type Factor } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { localizeLimitation } from '@/lib/i18n/review-i18n'
import { financialLabel, metricExplanation } from '@/features/financial/labels'
import { displayDecimal } from '@/lib/utils/format'
export function FactorDetail({
  factor,
  onClose,
  openSource,
}: {
  factor: Factor
  onClose: () => void
  openSource: (s: SourceTarget) => void
}) {
  const { t, locale } = useLocale()
  return (
    <Modal
      title={financialLabel(locale, 'metric', factor.factor_id).label}
      onClose={onClose}
      drawer
    >
      <div className="metadata-grid">
        <div>
          <span>{t('effective')}</span>
          <strong>{displayDecimal(factor.value)}</strong>
        </div>
      </div>
      <Status value={factor.status} />
      <Status value={factor.verification_state} />
      <p>{metricExplanation(locale, factor.factor_id)}</p>
      <ul>
        {factor.limitations.map((l, i) => (
          <li key={i}>{localizeLimitation(l, locale)}</li>
        ))}
      </ul>
      <h3>{t('evidence')}</h3>
      {factor.evidence_refs.map((id, i) => (
        <button key={id} className="inline-source" onClick={() => openSource({ evidenceId: id })}>
          {t('source')} {i + 1}
        </button>
      ))}
    </Modal>
  )
}
