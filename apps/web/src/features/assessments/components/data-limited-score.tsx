import type { Locale, PartialAssessment } from '@/lib/api/contracts'
import { displayDecimal } from '@/lib/utils/format'
import { companyResultText } from '../company-result'

export function DataLimitedScore({ value, locale }: { value: PartialAssessment; locale: Locale }) {
  const copy = companyResultText[locale]
  return (
    <>
      <p>{copy.partialTitle}</p>
      <strong>≈ {displayDecimal(value.available_points)}</strong>
      <span>/ {value.available_max_points}</span>
      <p>
        {value.components.length}/{value.total_metric_count} {copy.coverage}
      </p>
      <p>
        {copy.range}:{' '}
        <b>
          {value.lower_bound}–{value.upper_bound} / 100
        </b>
      </p>
      <small>
        {copy.note} {value.unresolved_max_points} {copy.points}
      </small>
      <small>{copy.noBand}</small>
    </>
  )
}
