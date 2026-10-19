'use client'
import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { useMutation } from '@/hooks/use-mutation'
import { useLocale } from '@/lib/i18n/locale-provider'
import { companyHealthText } from '@/lib/i18n/company-health-copy'
import { financialApi, factKeysForCountry, type FinancialSet } from '../api'
import { factCitations, sameReviewScope, periodReviewFacts } from '../intake-model'
import type { IntakeItem } from '../intake-api'
import { financialLabel } from '../labels'

export function IntakePeriodReview({
  item,
  predecessors,
  caseId,
  industry,
  country = 'VN',
  revision,
  sets,
  onClose,
  onSaved,
  onPreview,
}: {
  item: IntakeItem
  predecessors: IntakeItem['statements']
  caseId: string
  industry: string
  country?: string
  revision: number
  sets: FinancialSet[]
  onClose: () => void
  onSaved: () => void
  onPreview: () => void
}) {
  const { locale } = useLocale(),
    copy = (key: Parameters<typeof companyHealthText>[1]) => companyHealthText(locale, key)
  const first = item.classification?.periods[0]
  const factKeys = factKeysForCountry(country)
  const owned = [
    ...item.statements,
    ...predecessors,
    ...(item.origin.replaces_existing_sets ? (item.origin.duplicate_sets ?? []) : []),
  ]
  const initial = sets.find(
    (s) =>
      owned.some((t) => t.set_id === s.id) &&
      s.scope.period.end_date === first?.end_date &&
      s.scope.period.kind === first?.kind &&
      (!first?.start_date || s.scope.period.start_date === first.start_date) &&
      s.scope.basis === first?.basis,
  )
  const [expectedRevision] = useState(revision),
    [prior, setPrior] = useState(initial)
  const [chosen, setChosen] = useState('0'),
    [reason, setReason] = useState(''),
    [scopeQuote, setScopeQuote] = useState(first?.evidence?.[0]?.quote ?? ''),
    [scopePage, setScopePage] = useState(first?.pages[0] ?? 1),
    [kind, setKind] = useState(first?.kind ?? 'FY'),
    [start, setStart] = useState(first?.start_date ?? ''),
    [end, setEnd] = useState(first?.end_date ?? ''),
    [basis, setBasis] = useState(first?.basis ?? 'standalone'),
    [regime, setRegime] = useState(initial?.scope.accounting_regime ?? 'UNKNOWN'),
    [currency, setCurrency] = useState(
      initial?.scope.currency ?? (country === 'US' ? 'USD' : country === 'CN' ? 'CNY' : 'VND'),
    ),
    [unit, setUnit] = useState(initial?.scope.unit_multiplier ?? '1'),
    [values, setValues] = useState<Record<string, string>>(
      Object.fromEntries((initial?.facts ?? []).map((f) => [f.key, f.raw_value ?? ''])),
    ),
    [citations, setCitations] = useState<Record<string, { page: number; quote: string }>>(
      factCitations(initial),
    ),
    [receiptId] = useState(() => crypto.randomUUID())
  const action = useMutation()
  function choose(index: string) {
    setChosen(index)
    const period = item.classification?.periods[Number(index)]
    setKind(period?.kind ?? 'FY')
    setStart(period?.start_date ?? '')
    setEnd(period?.end_date ?? '')
    setBasis(period?.basis ?? 'standalone')
    setScopeQuote(period?.evidence?.[0]?.quote ?? '')
    setScopePage(period?.pages[0] ?? 1)
    const existing = sets.find(
      (s) =>
        owned.some((t) => t.set_id === s.id) &&
        s.scope.period.end_date === period?.end_date &&
        s.scope.period.kind === period?.kind &&
        (!period?.start_date || s.scope.period.start_date === period.start_date) &&
        s.scope.basis === period?.basis,
    )
    setPrior(existing)
    setRegime(existing?.scope.accounting_regime ?? 'UNKNOWN')
    setCurrency(existing?.scope.currency ?? 'VND')
    setUnit(existing?.scope.unit_multiplier ?? '1')
    setValues(Object.fromEntries((existing?.facts ?? []).map((f) => [f.key, f.raw_value ?? ''])))
    setCitations(factCitations(existing))
  }
  const scopeCompatible = sameReviewScope(prior, {
    kind,
    start,
    end,
    basis,
    regime,
    currency,
    unit,
  })
  const incompatibleCalculation = prior?.facts.some(
    (f) =>
      f.source.kind === 'calculated' &&
      values[f.key] &&
      (!scopeCompatible ||
        f.source.source_id !== item.prepared_source_id ||
        f.source.source_hash !== item.classification?.sha256),
  )
  const valid =
    !incompatibleCalculation &&
    start &&
    end &&
    start <= end &&
    scopeQuote.trim() &&
    reason.trim() &&
    /^[1-9][0-9]{0,11}$/.test(unit) &&
    factKeys.every(
      (k) =>
        !values[k] ||
        (/^-?\d{1,30}(\.\d{1,12})?$/.test(values[k]) &&
          citations[k]?.quote.trim() &&
          citations[k]?.page >= 1),
    )
  return (
    <Modal
      title={copy('modalPeriodReviewTitle')}
      onClose={onClose}
      dirty={!!reason || Object.values(values).some(Boolean)}
      busy={action.busy}
      drawer
    >
      <p>{item.name}</p>
      <button type="button" className="text-button" onClick={onPreview}>
        {copy('btnOpenToCompare')}
      </button>
      <p>{copy('periodReviewNotice')}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid || !item.prepared_source_id || !item.classification) return
          const facts = periodReviewFacts(
            prior,
            sameReviewScope(prior, { kind, start, end, basis, regime, currency, unit }),
            values,
            citations,
            {
              receipt_id: receiptId,
              source_id: item.prepared_source_id,
              source_hash: item.classification.sha256,
            },
            reason.trim(),
            (key) => financialLabel(locale, 'fact', key).label,
          )
          void action.run(
            (keys) =>
              financialApi.save(
                caseId,
                prior?.id,
                {
                  expected_revision: expectedRevision,
                  reason: reason.trim(),
                  intake_review: {
                    intake_id: item.id,
                    receipt_id: receiptId,
                    page: scopePage,
                    quote: scopeQuote.trim(),
                  },
                  period: { kind, start_date: start, end_date: end },
                  basis,
                  accounting_regime: regime,
                  currency,
                  unit_multiplier: unit,
                  industry_scope: industry,
                  observation_kind: 'actual',
                  audit_status: 'unknown',
                  statement_version: `human:${item.id}`,
                  facts,
                },
                keys,
              ),
            onSaved,
          )
        }}
      >
        <fieldset disabled={action.busy}>
          <label className="field-label">
            {copy('labelPeriodToReview')}
            <select value={chosen} onChange={(e) => choose(e.target.value)}>
              {(item.classification?.periods ?? []).map((p, i) => (
                <option key={i} value={i}>
                  {p.end_date} ·{' '}
                  {p.basis === 'consolidated' ? copy('consolidated') : copy('standalone')}
                </option>
              ))}
              <option value="new">{copy('addPeriodFromDoc')}</option>
            </select>
          </label>
          <label className="field-label">
            {copy('labelPeriodKind')}
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="FY">{copy('periodKindYear')}</option>
              <option value="INTERIM">{copy('periodKindInterim')}</option>
              <option value="TTM">{copy('periodKindTtm')}</option>
            </select>
          </label>
          <p>{copy('periodKindHelp')}</p>
          <label className="field-label">
            {copy('labelFromDate')}
            <input type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field-label">
            {copy('labelToDate')}
            <input type="date" required value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label className="field-label">
            {copy('labelReportingBasis')}
            <select value={basis} onChange={(e) => setBasis(e.target.value)}>
              <option value="standalone">{copy('standalone')}</option>
              <option value="consolidated">{copy('consolidated')}</option>
            </select>
          </label>
          <label className="field-label">
            {copy('labelAccountingRegime')}
            <select value={regime} onChange={(e) => setRegime(e.target.value)}>
              {['UNKNOWN', 'VN_TT200', 'VN_TT133', 'VN_TT99', 'VN_TT58', 'IFRS', 'OTHER'].map(
                (r) => (
                  <option key={r}>{r}</option>
                ),
              )}
            </select>
          </label>
          <label className="field-label">
            {copy('labelCurrency')}
            <input
              required
              pattern="[A-Z]{3}"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </label>
          <label className="field-label">
            {copy('labelUnitMultiplier')}
            <input
              required
              inputMode="numeric"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </label>
          <label className="field-label">
            {copy('labelScopePage')}
            <input
              type="number"
              min={1}
              max={item.classification?.page_count ?? 600}
              required
              value={scopePage}
              onChange={(e) => setScopePage(Number(e.target.value))}
            />
          </label>
          <label className="field-label">
            {copy('labelScopeQuote')}
            <textarea
              required
              maxLength={4000}
              value={scopeQuote}
              onChange={(e) => setScopeQuote(e.target.value)}
            />
          </label>
          <details>
            <summary>{copy('summaryInputFacts')}</summary>
            {incompatibleCalculation && (
              <p className="warning-banner">{copy('calculatedScopeReviewNotice')}</p>
            )}
            {factKeys.map((k) => (
              <div key={k}>
                <label className="field-label">
                  {financialLabel(locale, 'fact', k).label}
                  <input
                    inputMode="decimal"
                    placeholder="N/A"
                    disabled={prior?.facts.some(
                      (f) => f.key === k && f.source.kind === 'calculated',
                    )}
                    value={values[k] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                  />
                </label>
                {values[k] && (
                  <>
                    <label className="field-label">
                      {copy('sourcePage')}
                      <input
                        type="number"
                        min={1}
                        max={item.classification?.page_count ?? 600}
                        required
                        disabled={prior?.facts.some(
                          (f) => f.key === k && f.source.kind === 'calculated',
                        )}
                        value={citations[k]?.page ?? ''}
                        onChange={(e) =>
                          setCitations((v) => ({
                            ...v,
                            [k]: { page: Number(e.target.value), quote: v[k]?.quote ?? '' },
                          }))
                        }
                      />
                    </label>
                    <label className="field-label">
                      {copy('labelStatementLineQuote')}
                      <textarea
                        required
                        maxLength={4000}
                        disabled={prior?.facts.some(
                          (f) => f.key === k && f.source.kind === 'calculated',
                        )}
                        value={citations[k]?.quote ?? ''}
                        onChange={(e) =>
                          setCitations((v) => ({
                            ...v,
                            [k]: { page: v[k]?.page ?? scopePage, quote: e.target.value },
                          }))
                        }
                      />
                    </label>
                  </>
                )}
              </div>
            ))}
          </details>
          <label className="field-label">
            {copy('labelReviewReason')}
            <textarea
              required
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <ErrorNotice error={action.error} />
          <button className="primary-button" disabled={!valid}>
            {copy('btnSaveReviewedPeriod')}
          </button>
        </fieldset>
      </form>
    </Modal>
  )
}
