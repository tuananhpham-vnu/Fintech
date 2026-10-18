'use client'
import { useLocale } from '@/lib/i18n/locale-provider'
import { messages, type MessageKey } from '@/lib/i18n/messages'
function resolveTone(value: string): string {
  if (
    [
      'completed',
      'confirmed',
      'verified',
      'verified_resolved',
      'approved',
      'ready',
      'CLEAR_FOR_REVIEW',
      'CLEAR',
    ].includes(value)
  )
    return 'green'
  if (['failed', 'conflicting', 'blocker', 'BLOCKED', 'critical'].includes(value)) return 'red'
  if (
    [
      'missing',
      'partial',
      'waived',
      'open',
      'warning',
      'FOLLOW_UP',
      'review_required',
      'blocked',
    ].includes(value)
  )
    return 'amber'
  return 'neutral'
}

export function Status({ value, tone, label }: { value: string; tone?: string; label?: string }) {
  const { t } = useLocale()
  return (
    <span className={`tag ${tone ?? resolveTone(value)}`}>
      <span className="status-dot" />
      {label ?? (Object.hasOwn(messages, value) ? t(value as MessageKey) : t('needs_review'))}
    </span>
  )
}
