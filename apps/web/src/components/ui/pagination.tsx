'use client'
import { useLocale } from '@/lib/i18n/locale-provider'
export function Pagination({
  hasPrevious,
  hasNext,
  previous,
  next,
  busy,
}: {
  hasPrevious: boolean
  hasNext: boolean
  previous: () => void
  next: () => void
  busy?: boolean
}) {
  const { t } = useLocale()
  return (
    <div className="pagination">
      <button className="secondary-button" disabled={!hasPrevious || busy} onClick={previous}>
        {t('previous')}
      </button>
      <button className="secondary-button" disabled={!hasNext || busy} onClick={next}>
        {t('next')}
      </button>
    </div>
  )
}
