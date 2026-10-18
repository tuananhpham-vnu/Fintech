'use client'
import { Empty } from '@/components/feedback/empty'
import { SectionHeading } from '@/components/ui/section-heading'
import { Status } from '@/components/ui/status'
import { CreateQuestionnaire } from '@/features/questionnaires/components/create-questionnaire'
import { Invitation } from '@/features/questionnaires/components/invitation'
import { StaffResponse } from '@/features/questionnaires/components/staff-response'
import { Verification } from '@/features/questionnaires/components/verification'
import { type CaseDetail, type Question, type ResponseRecord } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { displayValue } from '@/lib/utils/format'
import { useState } from 'react'
export function NonFinancialInformation({
  detail,
  reload,
}: {
  detail: CaseDetail
  reload: () => void
}) {
  const { t } = useLocale(),
    [create, setCreate] = useState(false),
    [entry, setEntry] = useState<{ question: Question; questionnaireId: string } | null>(null),
    [verify, setVerify] = useState<ResponseRecord | null>(null)
  return (
    <>
      <SectionHeading title={t('information')}>
        <button className="primary-button" onClick={() => setCreate(true)}>
          {t('questionnaire')}
        </button>
      </SectionHeading>
      <div className="aic-category-strip">
        {(['legal', 'credit', 'sector', 'paymentHistory', 'finance', 'collateral'] as const).map(
          (k) => (
            <span className="tag" key={k}>
              {t(k)}
            </span>
          ),
        )}
      </div>
      {detail.questionnaires === undefined ? (
        <p className="warning-banner">{t('integrationPending')}</p>
      ) : !detail.questionnaires.length ? (
        <section className="panel">
          <Empty>
            <p>{t('noQuestions')}</p>
          </Empty>
        </section>
      ) : (
        detail.questionnaires.map((form) => (
          <section key={form.id} className="question-list">
            <div className="invitation-strip">
              <strong>{t('questionnaire')}</strong>
              <Status value={form.state ?? 'draft'} />
            </div>
            <Invitation detail={detail} questionnaire={form} reload={reload} />
            {form.questions.map((q) => {
              const responses = form.responses?.filter((r) => r.question_id === q.id) ?? []
              return (
                <article className="panel aic-section" key={q.id}>
                  <div className="question-card-heading">
                    <h3>{q.label ?? q.id}</h3>
                    <Status value={q.requiredness} />
                  </div>
                  {responses.length ? (
                    responses.map((r) => (
                      <div key={r.id}>
                        <blockquote>{displayValue(r.answer_json)}</blockquote>
                        <div className="status-trio">
                          <Status value={r.answer_state} />
                          <Status value={r.origin} />
                          <Status value={r.verification_status ?? 'unverified'} />
                          {r.verification_stale && <Status value="stale" tone="amber" />}
                        </div>
                        <p className="help-text">
                          {t('revision')} {r.revision}
                          {r.reported_reference && ` · ${r.reported_reference}`}
                        </p>
                        <button className="text-button" onClick={() => setVerify(r)}>
                          {t('verify')}
                        </button>
                      </div>
                    ))
                  ) : (
                    <Status value="missing" />
                  )}
                  <div className="request-actions">
                    <button
                      className="secondary-button"
                      disabled={form.state === 'closed'}
                      onClick={() => setEntry({ question: q, questionnaireId: form.id })}
                    >
                      {t('staffEntry')}
                    </button>
                  </div>
                </article>
              )
            })}
          </section>
        ))
      )}
      {create && (
        <CreateQuestionnaire detail={detail} reload={reload} onClose={() => setCreate(false)} />
      )}{' '}
      {entry && (
        <StaffResponse
          question={entry.question}
          questionnaireId={entry.questionnaireId}
          detail={detail}
          reload={reload}
          onClose={() => setEntry(null)}
        />
      )}{' '}
      {verify && (
        <Verification
          response={verify}
          detail={detail}
          reload={reload}
          onClose={() => setVerify(null)}
        />
      )}{' '}
    </>
  )
}
