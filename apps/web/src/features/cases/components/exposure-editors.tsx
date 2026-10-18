'use client'
import type { ExposureKind } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import {
  claimRoles,
  newClaim,
  newCondition,
  type ClaimInput,
  type ConditionInput,
  type DocumentSourceOption,
  type EditorRecord,
  type Party,
  type SourceInput,
} from '../helpers/exposure-inputs'
import { exposureText, type ExposureText } from '../helpers/exposure-text'

function Sources({
  values,
  historical,
  claimant,
  options,
  onChange,
  copy,
}: {
  values: SourceInput[]
  historical: boolean
  claimant?: Party
  options: DocumentSourceOption[]
  onChange: (sources: SourceInput[]) => void
  copy: ExposureText
}) {
  const keyOf = (source: SourceInput) =>
    source.kind === 'questionnaire'
      ? JSON.stringify([
          'questionnaire',
          source.questionnaire_id,
          source.question_id,
          source.response_id,
          source.response_revision,
        ])
      : source.kind === 'document'
        ? JSON.stringify([
            source.document_id,
            source.document_version,
            source.document_sha256,
            source.evidence_ref,
          ])
        : 'declaration'
  function replace(index: number, value: SourceInput) {
    onChange(values.map((source, i) => (i === index ? value : source)))
  }
  return (
    <div>
      <strong>{copy('sources')}</strong>
      {historical ? (
        <>
          <p className="help-text">{copy('historical')}</p>
          {values.map((source, i) => (
            <pre key={i} className="request-preview">
              {source.kind === 'document'
                ? copy('sources')
                : source.kind === 'questionnaire'
                  ? copy('sources')
                  : copy('declaration')}
            </pre>
          ))}
        </>
      ) : (
        <>
          {!options.length && <p className="help-text">{copy('noDocuments')}</p>}
          {values.map((source, index) => (
            <div key={index}>
              <label className="field-label">
                {copy('sources')} {index + 1}
                <select
                  value={keyOf(source)}
                  onChange={(event) => {
                    const selected = options.find((option) => option.key === event.target.value)
                    const reported_by =
                      selected?.source.kind === 'questionnaire'
                        ? selected.source.reported_by
                        : (claimant ?? source.reported_by)
                    replace(
                      index,
                      selected
                        ? { ...selected.source, reported_by }
                        : { kind: 'declaration', reported_by },
                    )
                  }}
                >
                  <option value="declaration">{copy('declaration')}</option>
                  {source.kind !== 'declaration' &&
                    !options.some((option) => option.key === keyOf(source)) && (
                      <option value={keyOf(source)}>{copy('historical')}</option>
                    )}
                  {options
                    .filter(
                      (o) =>
                        o.source.kind !== 'questionnaire' ||
                        !claimant ||
                        o.source.reported_by === claimant,
                    )
                    .map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                </select>
              </label>
              {source.kind !== 'declaration' && (
                <pre className="request-preview">
                  {source.kind === 'document'
                    ? copy('sources')
                    : source.kind === 'questionnaire'
                      ? copy('sources')
                      : copy('declaration')}
                </pre>
              )}
              <label className="field-label">
                {copy('claimant')}
                <select
                  value={claimant ?? source.reported_by}
                  disabled={!!claimant || source.kind === 'questionnaire'}
                  onChange={(event) =>
                    replace(index, { ...source, reported_by: event.target.value as Party })
                  }
                >
                  <option value="organization">{copy('organization')}</option>
                  <option value="counterparty">{copy('counterparty')}</option>
                </select>
              </label>
              <button
                type="button"
                className="text-button"
                disabled={values.length <= 1}
                onClick={() => onChange(values.filter((_, i) => i !== index))}
              >
                {copy('remove')} · {copy('sources')} {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-button"
            disabled={values.length >= 20}
            onClick={() =>
              onChange([
                ...values,
                { kind: 'declaration', reported_by: claimant ?? 'organization' },
              ])
            }
          >
            {copy('addSource')}
          </button>
        </>
      )}
    </div>
  )
}

export function ExposureEditors({
  kind,
  claims,
  conditions,
  sources,
  onClaims,
  onConditions,
}: {
  kind: ExposureKind
  claims: EditorRecord<ClaimInput>[]
  conditions: EditorRecord<ConditionInput>[]
  sources: DocumentSourceOption[]
  onClaims: (claims: EditorRecord<ClaimInput>[]) => void
  onConditions: (conditions: EditorRecord<ConditionInput>[]) => void
}) {
  const { locale, t } = useLocale(),
    copy = exposureText(locale)
  function updateClaim(index: number, input: ClaimInput) {
    onClaims(claims.map((row, i) => (i === index ? { ...row, input } : row)))
  }
  function updateCondition(index: number, input: ConditionInput) {
    onConditions(conditions.map((row, i) => (i === index ? { ...row, input } : row)))
  }
  return (
    <>
      <h3>{copy('claims')}</h3>
      <p className="help-text">{copy('unverified')}</p>
      {claims.map((row, index) => {
        const claim = row.input
        return (
          <section
            className="panel aic-section"
            key={index}
            aria-label={`${copy('claims')} ${index + 1}`}
          >
            <strong>
              {copy('claims')} {index + 1}
            </strong>
            {claim === null ? (
              <>
                <p>{copy('unsupported')}</p>
                <pre className="request-preview">{copy('historical')}</pre>
              </>
            ) : (
              <>
                <div className="form-two-columns">
                  <label className="field-label">
                    {t('type')}
                    <select
                      value={claim.kind}
                      disabled={row.historical}
                      onChange={(event) => {
                        const observation = event.target.value as ClaimInput['kind'],
                          roles = claimRoles(kind, observation)
                        updateClaim(index, {
                          ...claim,
                          kind: observation,
                          ...roles,
                          source_refs: claim.source_refs.map((source) => ({
                            ...source,
                            reported_by: roles.claimant_party,
                          })),
                        })
                      }}
                    >
                      <option value="paid">{copy('paid')}</option>
                      <option value="received">{copy('received')}</option>
                    </select>
                  </label>
                  <label className="field-label">
                    {t('stage')}
                    <select
                      value={claim.event_state}
                      onChange={(event) =>
                        updateClaim(index, {
                          ...claim,
                          event_state: event.target.value as ClaimInput['event_state'],
                          ...(event.target.value === 'proposed' ? { occurred_on: null } : {}),
                        })
                      }
                    >
                      <option value="proposed">{copy('proposed')}</option>
                      <option value="actual">{copy('actual')}</option>
                    </select>
                  </label>
                </div>
                <div className="metadata-grid">
                  <div>
                    <span>{copy('payer')}</span>
                    <strong>{copy(claimRoles(kind, claim.kind).payer_party)}</strong>
                  </div>
                  <div>
                    <span>{copy('payee')}</span>
                    <strong>{copy(claimRoles(kind, claim.kind).payee_party)}</strong>
                  </div>
                  <div>
                    <span>{copy('claimant')}</span>
                    <strong>{copy(claimRoles(kind, claim.kind).claimant_party)}</strong>
                  </div>
                </div>
                <label className="field-label">
                  {t('amount')} (VND)
                  <input
                    inputMode="numeric"
                    pattern="0|[1-9][0-9]*"
                    maxLength={24}
                    placeholder={copy('unknown')}
                    value={claim.amount_vnd ?? ''}
                    onChange={(event) =>
                      updateClaim(index, {
                        ...claim,
                        amount_vnd: event.target.value || null,
                        ...(event.target.value ? { amount_missing_reason: null } : {}),
                      })
                    }
                  />
                </label>
                {claim.amount_vnd === null && (
                  <label className="field-label">
                    {copy('reason')} *
                    <textarea
                      required
                      maxLength={1000}
                      value={claim.amount_missing_reason ?? ''}
                      onChange={(event) =>
                        updateClaim(index, { ...claim, amount_missing_reason: event.target.value })
                      }
                    />
                  </label>
                )}
                <div className="form-two-columns">
                  <label className="field-label">
                    {copy('planned')}
                    <input
                      type="date"
                      value={claim.planned_on ?? ''}
                      onChange={(event) =>
                        updateClaim(index, { ...claim, planned_on: event.target.value || null })
                      }
                    />
                  </label>
                  {claim.event_state === 'actual' && (
                    <label className="field-label">
                      {copy('occurred')}
                      <input
                        type="date"
                        value={claim.occurred_on ?? ''}
                        onChange={(event) =>
                          updateClaim(index, {
                            ...claim,
                            occurred_on: event.target.value || null,
                            ...(event.target.value ? { date_missing_reason: null } : {}),
                          })
                        }
                      />
                    </label>
                  )}
                </div>
                {claim.occurred_on === null && (
                  <label className="field-label">
                    {copy('reason')} ·{' '}
                    {copy(claim.event_state === 'actual' ? 'occurred' : 'planned')}{' '}
                    {claim.event_state === 'actual' ? '*' : ''}
                    <textarea
                      required={claim.event_state === 'actual'}
                      maxLength={1000}
                      value={claim.date_missing_reason ?? ''}
                      onChange={(event) =>
                        updateClaim(index, {
                          ...claim,
                          date_missing_reason: event.target.value || null,
                        })
                      }
                    />
                  </label>
                )}
                <label className="field-label">
                  {copy('obligation')}
                  <input
                    value={claim.obligation_ref ?? ''}
                    onChange={(event) =>
                      updateClaim(index, { ...claim, obligation_ref: event.target.value || null })
                    }
                  />
                </label>
                <Sources
                  values={claim.source_refs}
                  historical={row.historical}
                  claimant={claimRoles(kind, claim.kind).claimant_party}
                  options={sources}
                  copy={copy}
                  onChange={(source_refs) => updateClaim(index, { ...claim, source_refs })}
                />
              </>
            )}
            <button
              type="button"
              className="text-button"
              onClick={() => onClaims(claims.filter((_, i) => i !== index))}
            >
              {copy('remove')} · {copy('claims')} {index + 1}
            </button>
          </section>
        )
      })}
      <button
        type="button"
        className="secondary-button"
        disabled={claims.length >= 50}
        onClick={() => onClaims([...claims, newClaim(kind)])}
      >
        {copy('addClaim')}
      </button>
      <h3>{copy('conditions')}</h3>
      {conditions.map((row, index) => {
        const condition = row.input
        return (
          <section
            className="panel aic-section"
            key={index}
            aria-label={`${copy('conditions')} ${index + 1}`}
          >
            <strong>
              {copy('conditions')} {index + 1}
            </strong>
            {condition === null ? (
              <>
                <p>{copy('unsupported')}</p>
                <pre className="request-preview">{copy('historical')}</pre>
              </>
            ) : (
              <>
                <div className="form-two-columns">
                  <label className="field-label">
                    {t('type')}
                    <select
                      value={condition.kind}
                      onChange={(event) =>
                        updateCondition(index, {
                          ...condition,
                          kind: event.target.value as ConditionInput['kind'],
                        })
                      }
                    >
                      {(
                        [
                          'payment',
                          'delivery',
                          'acceptance',
                          'refund',
                          'guarantee',
                          'other',
                        ] as const
                      ).map((key) => (
                        <option key={key} value={key}>
                          {copy(key)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    {t('stage')}
                    <select
                      value={condition.reported_state}
                      onChange={(event) =>
                        updateCondition(index, {
                          ...condition,
                          reported_state: event.target.value as ConditionInput['reported_state'],
                        })
                      }
                    >
                      {(['proposed', 'reported_satisfied', 'unknown'] as const).map((key) => (
                        <option key={key} value={key}>
                          {copy(key)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="field-label">
                  {copy('scope')} *
                  <textarea
                    required
                    maxLength={1000}
                    value={condition.scope}
                    onChange={(event) =>
                      updateCondition(index, { ...condition, scope: event.target.value })
                    }
                  />
                </label>
                <label className="field-label">
                  {copy('trigger')}
                  <textarea
                    maxLength={4000}
                    value={condition.trigger_text ?? ''}
                    onChange={(event) =>
                      updateCondition(index, {
                        ...condition,
                        trigger_text: event.target.value || null,
                      })
                    }
                  />
                </label>
                <label className="field-label">
                  {copy('dueDate')}
                  <input
                    type="date"
                    value={condition.due_on ?? ''}
                    onChange={(event) =>
                      updateCondition(index, { ...condition, due_on: event.target.value || null })
                    }
                  />
                </label>
                <label className="field-label">
                  {copy('reason')} {condition.reported_state === 'unknown' ? '*' : ''}
                  <textarea
                    required={condition.reported_state === 'unknown'}
                    maxLength={1000}
                    value={condition.missing_reason ?? ''}
                    onChange={(event) =>
                      updateCondition(index, {
                        ...condition,
                        missing_reason: event.target.value || null,
                      })
                    }
                  />
                </label>
                <Sources
                  values={condition.source_refs}
                  historical={row.historical}
                  options={sources}
                  copy={copy}
                  onChange={(source_refs) => updateCondition(index, { ...condition, source_refs })}
                />
              </>
            )}
            <button
              type="button"
              className="text-button"
              onClick={() => onConditions(conditions.filter((_, i) => i !== index))}
            >
              {copy('remove')} · {copy('conditions')} {index + 1}
            </button>
          </section>
        )
      })}
      <button
        type="button"
        className="secondary-button"
        disabled={conditions.length >= 50}
        onClick={() => onConditions([...conditions, newCondition()])}
      >
        {copy('addCondition')}
      </button>
    </>
  )
}
