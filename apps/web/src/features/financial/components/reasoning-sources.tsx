'use client'
import { useState } from 'react'
import { useMutation } from '@/hooks/use-mutation'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { useLocale } from '@/lib/i18n/locale-provider'
import { companyHealthText } from '@/lib/i18n/company-health-copy'
import { financialApi, type FinancialSet, type ReasoningPage } from '../api'

export function ReasoningSources({
  set,
  caseId,
  revision,
  reload,
  onSource,
}: {
  set: FinancialSet
  caseId: string
  revision: number
  reload: () => void
  onSource?: (id: string, page: number) => void
}) {
  const { locale } = useLocale(),
    copy = (key: Parameters<typeof companyHealthText>[1]) => companyHealthText(locale, key),
    action = useMutation(),
    [rows, setRows] = useState<ReasoningPage['rows']>([]),
    [next, setNext] = useState<number | null>(0),
    [excluded, exclude] = useState<string[]>([]),
    [relations, setRelations] = useState<ReasoningPage['relations']>([]),
    [excludedRelations, excludeRelations] = useState<string[]>([]),
    [reason, setReason] = useState('')

  const summary = set.metadata.reasoning
  if (!summary) return null

  const sourceId =
    set.metadata.calculations?.find((p) => p.source_id)?.source_id ??
    set.facts.find((f) => 'source_id' in f.source)?.source
  const file =
    typeof sourceId === 'string'
      ? sourceId
      : sourceId && 'source_id' in sourceId
        ? sourceId.source_id
        : null

  return (
    <div className="reasoning-sources-container">
      <div style={{ marginBottom: '14px' }}>
        <h4 style={{ margin: '0 0 4px', fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
          {copy('sourcesRepoTitle')}
        </h4>
        <p style={{ margin: 0, fontSize: '12.5px', color: '#64748b', lineHeight: 1.5 }}>
          {copy('sourcesRepoDesc')}
        </p>
      </div>

      {relations.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
          {relations.map((r) => (
            <div key={r.id} className="proof-step-card">
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '13px',
                  color: '#1e293b',
                }}
              >
                <input
                  type="checkbox"
                  style={{ accentColor: '#0d9488', width: '15px', height: '15px' }}
                  checked={excludedRelations.includes(r.id)}
                  disabled={action.busy}
                  onChange={(e) =>
                    excludeRelations(
                      e.target.checked
                        ? [...excludedRelations, r.id]
                        : excludedRelations.filter((id) => id !== r.id),
                    )
                  }
                />
                <span>
                  {copy('excludeIdentifiedRelationPrefix')}
                  <strong>{r.label}</strong>
                </span>
              </label>
              <p style={{ margin: '4px 0 2px 23px', fontSize: '12px', color: '#64748b' }}>
                {r.reason}
              </p>
              {r.evidence?.map((e, i) => (
                <blockquote
                  key={i}
                  className="proof-evidence-quote"
                  style={{ margin: '4px 0 0 23px' }}
                >
                  {copy('pagePrefix')} {e.page}: "{e.quote}"
                </blockquote>
              ))}
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}
        >
          {rows.map((r) => (
            <div
              key={r.variable.id}
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '10px 12px',
              }}
            >
              <strong
                style={{
                  fontSize: '13px',
                  color: '#0f172a',
                  display: 'block',
                  marginBottom: '6px',
                }}
              >
                {r.variable.label}
              </strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {r.observations.map((o) => (
                  <div
                    key={o.id}
                    style={{
                      background: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      padding: '8px 10px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          cursor: 'pointer',
                          fontSize: '12.5px',
                          color: '#334155',
                        }}
                      >
                        <input
                          type="checkbox"
                          style={{ accentColor: '#0d9488', width: '14px', height: '14px' }}
                          checked={excluded.includes(o.id)}
                          disabled={action.busy}
                          onChange={(e) =>
                            exclude(
                              e.target.checked
                                ? [...excluded, o.id]
                                : excluded.filter((id) => id !== o.id),
                            )
                          }
                        />
                        <span>
                          {copy('excludeIdentifiedLinePrefix')}
                          <strong>{o.label}</strong> —{' '}
                          <code
                            style={{
                              background: '#f1f5f9',
                              padding: '1px 5px',
                              borderRadius: '4px',
                            }}
                          >
                            {o.raw_token}
                          </code>
                        </span>
                      </label>
                      {file && onSource && (
                        <button
                          type="button"
                          className="btn-open-source-pill"
                          onClick={() => onSource(file, o.page)}
                        >
                          📄 {copy('btnOpenSourceDoc')} ({o.page})
                        </button>
                      )}
                    </div>
                    {o.quote && (
                      <blockquote
                        className="proof-evidence-quote"
                        style={{ margin: '6px 0 0 22px' }}
                      >
                        "{o.quote}"
                      </blockquote>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {next !== null && (
        <button
          type="button"
          className="btn-proposal-revert"
          style={{ width: 'auto', padding: '7px 14px', marginBottom: '14px' }}
          disabled={action.busy}
          onClick={() =>
            void action.run(
              () => financialApi.reasoning(caseId, summary.receipt_id, next),
              (page) => {
                const combined = new Map(rows.map((r) => [r.variable.id, r]))
                for (const row of page.rows) {
                  const prior = combined.get(row.variable.id)
                  combined.set(
                    row.variable.id,
                    prior
                      ? { ...row, observations: [...prior.observations, ...row.observations] }
                      : row,
                  )
                }
                setRows([...combined.values()])
                setRelations([...relations, ...page.relations])
                setNext(page.next_offset)
              },
            )
          }
        >
          🔍 {rows.length ? copy('loadMoreSourceLines') : copy('viewSourceLines')}
        </button>
      )}

      {!!(excluded.length + excludedRelations.length) && (
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fef3c7',
            borderRadius: '8px',
            padding: '12px',
            marginTop: '10px',
          }}
        >
          <label
            style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: 600,
              color: '#92400e',
              marginBottom: '6px',
            }}
          >
            {copy('exclusionReasonLabel')}
            <textarea
              value={reason}
              maxLength={1000}
              placeholder="Nhập lý do loại bỏ (vd: nhầm dòng tiền với nợ...)"
              style={{
                display: 'block',
                width: '100%',
                marginTop: '6px',
                padding: '8px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                fontFamily: 'inherit',
                minHeight: '60px',
                boxSizing: 'border-box',
              }}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p style={{ margin: '4px 0 10px', fontSize: '12px', color: '#b45309' }}>
            ℹ️ {copy('recalculationReminder')}
          </p>
          <button
            type="button"
            className="btn-apply-proposals"
            style={{ background: '#d97706', fontSize: '13px', padding: '7px 16px' }}
            disabled={action.busy || !reason.trim()}
            onClick={() =>
              void action.run(
                (keys) =>
                  financialApi.reviewReasoning(
                    caseId,
                    summary.receipt_id,
                    {
                      set_id: set.id,
                      expected_revision: revision,
                      reason,
                      excluded_observation_ids: excluded,
                      excluded_relation_ids: excludedRelations,
                    },
                    keys,
                  ),
                () => {
                  exclude([])
                  excludeRelations([])
                  setRelations([])
                  setReason('')
                  setRows([])
                  setNext(0)
                  reload()
                },
              )
            }
          >
            {copy('btnExcludeAndRecalculate')}
          </button>
        </div>
      )}
      <ErrorNotice error={action.error} />
    </div>
  )
}
