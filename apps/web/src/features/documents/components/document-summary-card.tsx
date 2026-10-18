'use client'
import { useLocale } from '@/lib/i18n/locale-provider'
import type { IngestionSummary } from '../groups'
import { CheckCircle2, Clock, ArrowRight, Layers, FileCheck } from 'lucide-react'

export function DocumentSummaryCard({ summary }: { summary: IngestionSummary }) {
  const { t, locale } = useLocale()

  return (
    <section className="aic-section" aria-label={t('summaryTitle')}>
      {summary.processingFiles > 0 && (
        <p className="warning-banner">
          {locale === 'vi'
            ? 'Chờ trích xuất hoàn tất trước khi sửa hồ sơ. Thay đổi hồ sơ trong lúc xử lý có thể khiến kết quả AI bị giữ lại vì nguồn đã cũ.'
            : locale === 'en'
              ? 'Wait for extraction to finish before editing the case. Changes during processing can cause the AI result to be withheld as stale.'
              : '请等待提取完成后再编辑案件。处理期间的变更可能使AI结果因快照过期而无法发布。'}
        </p>
      )}
      {/* 5-Step Journey Stepper */}
      <div className="aic-journey-stepper" role="navigation" aria-label={t('summaryNextStep')}>
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
            summary.totalFiles > 0 &&
            summary.usableFiles + summary.zeroUsableFiles === summary.totalFiles
              ? 'completed'
              : summary.processingFiles > 0
                ? 'active'
                : ''
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
              : summary.failedFiles > 0
                ? `${summary.failedFiles} ${t('failed').toLowerCase()}`
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
        {summary.failedFiles > 0 && (
          <article className="aic-metric-card metric-nousable">
            <p>{t('failed')}</p>
            <strong>{summary.failedFiles}</strong>
            <small>{t('extractionUnavailable')}</small>
          </article>
        )}

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
