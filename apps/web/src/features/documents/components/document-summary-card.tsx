'use client'
import { useLocale } from '@/lib/i18n/locale-provider'
import type { IngestionSummary } from '../groups'
import { CheckCircle2, Clock, ArrowRight, Layers, FileCheck } from 'lucide-react'

export function DocumentSummaryCard({ summary }: { summary: IngestionSummary }) {
  const { t } = useLocale()

  return (
    <section className="aic-section" aria-label={t('summaryTitle')}>
      {/* 5-Step Journey Stepper */}
      <div className="aic-journey-stepper" role="navigation" aria-label="Journey Steps">
        <div className={`aic-journey-step ${summary.totalFiles > 0 ? 'completed' : 'active'}`}>
          <CheckCircle2 size={15} />
          <span>{t('journeyUpload')}</span>
        </div>
        <div
          className={`aic-journey-step ${
            summary.totalFiles > 0 && summary.unconfirmedFiles === 0
              ? 'completed'
              : summary.totalFiles > 0
                ? 'active'
                : ''
          }`}
        >
          <Layers size={15} />
          <span>{t('journeyClassify')}</span>
        </div>
        <div
          className={`aic-journey-step ${
            summary.usableFiles > 0 ? 'completed' : summary.processingFiles > 0 ? 'active' : ''
          }`}
        >
          <Clock size={15} />
          <span>{t('journeyExtraction')}</span>
        </div>
        <div className="aic-journey-step">
          <FileCheck size={15} />
          <span>{t('journeyReview')}</span>
        </div>
        <div className="aic-journey-step">
          <span>{t('journeyMetrics')}</span>
        </div>
      </div>

      {/* SME Metrics Grid */}
      <div className="aic-sme-summary">
        <article className="aic-metric-card metric-total">
          <p>{t('summaryTotal')}</p>
          <strong>{summary.totalFiles}</strong>
          <small>
            {summary.processingFiles > 0
              ? `${summary.processingFiles} ${t('processingExtraction').toLowerCase()}`
              : t('ready')}
          </small>
        </article>
        <article className="aic-metric-card metric-usable">
          <p>{t('summaryUsable')}</p>
          <strong style={{ color: summary.usableFiles > 0 ? 'var(--primary)' : 'inherit' }}>
            {summary.usableFiles}
          </strong>
          <small>{t('extractedWithFields')}</small>
        </article>
        <article className="aic-metric-card metric-nousable">
          <p>{t('summaryNoUsable')}</p>
          <strong style={{ color: summary.zeroUsableFiles > 0 ? '#b85d19' : 'inherit' }}>
            {summary.zeroUsableFiles}
          </strong>
          <small>{t('noUsableFields')}</small>
        </article>
        <article className="aic-metric-card metric-review">
          <p>{t('summaryNeedsReview')}</p>
          <strong style={{ color: summary.unconfirmedFiles > 0 ? '#b85d19' : 'inherit' }}>
            {summary.unconfirmedFiles}
          </strong>
          <small>{t('unconfirmed')}</small>
        </article>

        {/* Actionable Next Step Box */}
        <div className="aic-next-step-box">
          <div className="aic-next-step-content">
            <strong>{t('summaryNextStep')}</strong>
            <p>{t(summary.nextStepKey)}</p>
          </div>
          <div className="aic-next-step-icon">
            <ArrowRight size={16} />
          </div>
        </div>
      </div>
    </section>
  )
}
