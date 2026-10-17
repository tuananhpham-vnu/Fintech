'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { Brand } from '@/components/layout/brand'
import { LocaleSelect } from '@/components/layout/locale-select'
import { questionnairesApi } from '@/features/questionnaires/api'
import { useLeaveGuard } from '@/hooks/use-leave-guard'
import { useMutation } from '@/hooks/use-mutation'
import { useResource } from '@/hooks/use-resource'
import { ApiError } from '@/lib/api/client'
import { useLocale } from '@/lib/i18n/locale-provider'
import { useCallback, useEffect, useRef, useState } from 'react'
import { validateNativeAnswers } from '../schemas'
import { nativeCopy } from '../native-copy'
import type { NativeReceipt } from '../api'
export function RespondentForm() {
  const { t, locale } = useLocale(),
    copy = nativeCopy(locale),
    [token, setToken] = useState<string | null>(null),
    [answers, setAnswers] = useState<
      Record<string, { state: string; value: string; reason?: string }>
    >({}),
    [reporter, setReporter] = useState(''),
    [receipt, setReceipt] = useState<NativeReceipt | null>(null),
    [preview, setPreview] = useState(false),
    action = useMutation()
  const fragmentConsumed = useRef(false)
  useEffect(() => {
    // Strict Mode replays effects in development. The fragment is deliberately
    // erased on first consumption; a replay must not replace that token with ''.
    if (fragmentConsumed.current) return
    fragmentConsumed.current = true
    const params = new URLSearchParams(window.location.hash.slice(1))
    setToken(params.get('token') ?? '')
    window.history.replaceState(null, '', window.location.pathname)
  }, [])
  const load = useCallback(
    (signal: AbortSignal) => questionnairesApi.respondentForm(token ?? '', signal),
    [token],
  )
  const resource = useResource(load, !!token),
    dirty = !receipt && Object.values(answers).some((a) => a.value || a.state === 'skipped'),
    { prompt } = useLeaveGuard(dirty)
  function check() {
    try {
      validateNativeAnswers(resource.data?.questions ?? [], answers)
      if (
        !reporter.trim() ||
        (resource.data?.questions ?? []).some(
          (q) => answers[q.id]?.state === 'skipped' && !answers[q.id]?.reason?.trim(),
        )
      )
        throw new ApiError(422, 'INVALID_INPUT', '')
    } catch (error) {
      action.setError(error)
      return
    }
    action.setError(null)
    setPreview(true)
  }
  return (
    <main className="questionnaire-page">
      <header className="questionnaire-header">
        <Brand />
        <LocaleSelect />
      </header>
      <div className="questionnaire-content">
        <div className="questionnaire-intro">
          <p className="eyebrow">AIC RATING</p>
          <h1>{t('questionnaire')}</h1>
          <p>{t('scopedHelp')}</p>
          <p>{copy('limitation')}</p>
        </div>
        {token === null ? (
          <Loading />
        ) : !token ? (
          <ErrorNotice error={new ApiError(404, 'NOT_FOUND', '')} />
        ) : (
          <>
            <ErrorNotice error={resource.error} retry={resource.reload} />
            {resource.error instanceof ApiError && resource.error.status === 404 && (
              <p>{copy('unavailable')}</p>
            )}
            {resource.loading ? (
              <Loading />
            ) : (receipt ?? resource.data?.receipt) ? (
              <section className="panel">
                <h2>{copy('receipt')}</h2>
                <p>{(receipt ?? resource.data?.receipt)?.receipt_id}</p>
                <p>{(receipt ?? resource.data?.receipt)?.submitted_at}</p>
                <p>{copy('limitation')}</p>
              </section>
            ) : (
              resource.data && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!preview) check()
                    else {
                      const body = {
                        reported_reference: reporter,
                        answers: resource.data!.questions.map((q) => {
                          const answer = answers[q.id] ?? { state: 'submitted', value: '' }
                          return {
                            question_id: q.id,
                            question_version: 1 as const,
                            answer_state: answer.state as 'submitted' | 'self_assessed' | 'skipped',
                            answer_json: answer.state === 'skipped' ? null : answer.value,
                            skip_reason:
                              answer.state === 'skipped' ? (answer.reason ?? null) : null,
                          }
                        }),
                      }
                      void action.run(
                        (keys) =>
                          questionnairesApi.submitRespondent(
                            token!,
                            body,
                            keys.for('/respondent/responses', body),
                          ),
                        setReceipt,
                      )
                    }
                  }}
                >
                  <fieldset disabled={action.busy}>
                    <label className="field-label">
                      {copy('identity')}
                      <input
                        required
                        maxLength={500}
                        value={reporter}
                        onChange={(e) => {
                          setReporter(e.target.value)
                          setPreview(false)
                        }}
                      />
                    </label>
                    <div className="questionnaire-questions">
                      {resource.data.questions.map((q) => {
                        const answer = answers[q.id] ?? { value: '', state: 'submitted' },
                          set = (patch: Partial<typeof answer>) =>
                            setAnswers((current) => ({
                              ...current,
                              [q.id]: { ...answer, ...patch },
                            }))
                        return (
                          <section className="panel questionnaire-question" key={q.id}>
                            <h2>{q.label ?? q.id}</h2>
                            <p>{t(q.requiredness === 'required' ? 'required' : 'optional')}</p>
                            {preview ? (
                              <>
                                <p>{t(answer.state as 'submitted')}</p>
                                <blockquote>{answer.value || '—'}</blockquote>
                              </>
                            ) : ['text', 'string', 'textarea'].includes(q.answer_type) ? (
                              <>
                                <label className="field-label">
                                  {t('status')}
                                  <select
                                    value={answer.state}
                                    onChange={(e) => set({ state: e.target.value })}
                                  >
                                    <option value="submitted">{t('submitted')}</option>
                                    <option value="self_assessed">{t('self_assessed')}</option>
                                    {q.allowed_to_skip && (
                                      <option value="skipped">{t('skipped')}</option>
                                    )}
                                  </select>
                                </label>
                                <label className="field-label">
                                  {t('answer')}
                                  <textarea
                                    maxLength={5000}
                                    disabled={answer.state === 'skipped'}
                                    value={answer.value}
                                    onChange={(e) => set({ value: e.target.value })}
                                  />
                                </label>
                                {answer.state === 'skipped' && (
                                  <label className="field-label">
                                    {copy('skip')}
                                    <textarea
                                      required
                                      maxLength={4000}
                                      value={answer.reason ?? ''}
                                      onChange={(e) => set({ reason: e.target.value })}
                                    />
                                  </label>
                                )}
                              </>
                            ) : (
                              <p className="warning-banner">{t('integrationPending')}</p>
                            )}
                          </section>
                        )
                      })}
                    </div>
                    <ErrorNotice error={action.error} />
                    <div className="questionnaire-actions">
                      {preview && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setPreview(false)}
                        >
                          {t('edit')}
                        </button>
                      )}
                      <button type="submit" className="primary-button" disabled={action.busy}>
                        {t(preview ? 'submit' : 'preview')}
                      </button>
                    </div>
                  </fieldset>
                </form>
              )
            )}
          </>
        )}
        {prompt}
      </div>
    </main>
  )
}
