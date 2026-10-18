'use client'
import { ActionDialog } from '@/components/forms/revision-action-dialog'
import { casesApi } from '@/features/cases/api'
import { reviewApi } from '@/features/review/api'
import type { CaseDetail, Finding } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { localizeFindingSummary } from '@/lib/i18n/review-i18n'
import { useState } from 'react'
export function IssueDecision({
  detail,
  decision,
  reload,
  onClose,
}: {
  detail: CaseDetail
  decision: { finding: Finding; action: 'resolve' | 'dismiss' | 'reopen' }
  reload: () => void
  onClose: () => void
}) {
  const { t, locale } = useLocale()
  const available = [
    ...new Set([
      ...(detail.documents ?? [])
        .filter((d) => d.source_review?.subject_match === 'match')
        .flatMap((d) => d.extraction?.flatMap((f) => f.evidence_refs) ?? []),
    ]),
  ]
  const [refs, setRefs] = useState(
    decision.action === 'reopen'
      ? []
      : decision.finding.evidence_refs.filter((ref) => available.includes(ref)),
  )
  return (
    <ActionDialog
      title={t(decision.action)}
      loadLatest={() => casesApi.detail(detail.id)}
      revision={detail.revision}
      onClose={onClose}
      onSaved={reload}
      submit={(reason, revision, keys) => {
        return reviewApi.decide(
          decision.finding.id,
          { expected_revision: revision, action: decision.action, reason, evidence_refs: refs },
          keys,
        )
      }}
    >
      <p>{localizeFindingSummary(decision.finding, locale)}</p>
      <h3>{t('evidence')}</h3>
      {available.map((id, i) => (
        <label className="check-label" key={id}>
          <input
            type="checkbox"
            checked={refs.includes(id)}
            onChange={(e) =>
              setRefs((current) =>
                e.target.checked ? [...current, id] : current.filter((x) => x !== id),
              )
            }
          />
          {t('evidence')} {i + 1}
        </label>
      ))}
      {!available.length && <p>{t('empty')}</p>}
    </ActionDialog>
  )
}
