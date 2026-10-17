'use client'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Modal } from '@/components/ui/modal'
import { counterpartiesApi, type CounterpartyCreateInput } from '@/features/counterparties/api'
import { useMutation } from '@/hooks/use-mutation'
import { ApiError } from '@/lib/api/client'
import { type Counterparty } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { useState } from 'react'

const labels = {
  en: {
    notice:
      'This staff declaration records reported information. Identity remains unresolved after saving.',
    reporter: 'Reported by',
    organization: 'Organization',
    counterparty: 'Counterparty',
    reference: 'Declaration reference',
    statement: 'Reported information',
    reason: 'Reason for saving',
    rebase: 'Keep my draft and use this revision',
    compare: 'Current saved record (your draft is preserved)',
  },
  vi: {
    notice:
      'Lời khai do chuyên viên nhập chỉ ghi nhận thông tin được báo cáo. Danh tính vẫn chưa được xác minh sau khi lưu.',
    reporter: 'Bên khai báo',
    organization: 'Tổ chức',
    counterparty: 'Đối tác',
    reference: 'Tham chiếu lời khai',
    statement: 'Thông tin được khai báo',
    reason: 'Lý do lưu',
    rebase: 'Giữ bản nháp và dùng phiên bản này',
    compare: 'Bản ghi hiện tại (bản nháp của bạn được giữ lại)',
  },
  'zh-CN': {
    notice: '此员工录入的声明仅记录所报告的信息。保存后身份仍未核实。',
    reporter: '报告方',
    organization: '本机构',
    counterparty: '交易对手',
    reference: '声明参考信息',
    statement: '所报告的信息',
    reason: '保存原因',
    rebase: '保留草稿并使用此版本',
    compare: '当前已保存的记录（您的草稿会保留）',
  },
}
export function PartyDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Counterparty
  onClose: () => void
  onSaved: () => void
}) {
  const { t, locale } = useLocale(),
    copy = labels[locale],
    action = useMutation(),
    [name, setName] = useState(initial?.name ?? ''),
    [tax, setTax] = useState(initial?.tax_id ?? ''),
    [industry, setIndustry] = useState(initial?.industry_code ?? ''),
    [country, setCountry] = useState(initial?.country ?? 'VN'),
    [revision, setRevision] = useState(initial?.revision ?? 0),
    [latest, setLatest] = useState<Counterparty | null>(null),
    [refreshing, setRefreshing] = useState(false),
    [reportedBy, setReportedBy] = useState<'organization' | 'counterparty'>('organization'),
    [reference, setReference] = useState(''),
    [statement, setStatement] = useState(''),
    [reason, setReason] = useState('')
  const dirty =
    name !== (initial?.name ?? '') ||
    tax !== (initial?.tax_id ?? '') ||
    industry !== (initial?.industry_code ?? '') ||
    country !== (initial?.country ?? 'VN') ||
    !!reference ||
    !!statement ||
    !!reason ||
    reportedBy !== 'organization'
  function submit() {
    if (
      !name.trim() ||
      !country.trim() ||
      !reference.trim() ||
      !statement.trim() ||
      !reason.trim()
    ) {
      action.setError(new ApiError(422, 'INVALID_INPUT', ''))
      return
    }
    const body: CounterpartyCreateInput = {
      name: name.trim(),
      country: country.trim(),
      tax_id: tax.trim() || null,
      industry_code: industry.trim() || null,
      source: {
        kind: 'declaration',
        reported_by: reportedBy,
        reported_reference: reference.trim(),
        statement: statement.trim(),
      },
      reason: reason.trim(),
    }
    void action.run(
      (keys) =>
        initial
          ? counterpartiesApi.updateCounterparty(
              initial.id,
              { ...body, expected_revision: revision },
              keys.for(initial.id, { ...body, expected_revision: revision }),
            )
          : counterpartiesApi.createCounterparty(body, keys.for('/counterparties', body)),
      () => {
        onSaved()
        onClose()
      },
    )
  }
  return (
    <Modal
      title={t(initial ? 'edit' : 'newParty')}
      onClose={onClose}
      dirty={dirty}
      busy={action.busy || refreshing}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <fieldset disabled={action.busy || refreshing}>
          <p className="muted">{copy.notice}</p>
          <label className="field-label">
            {t('name')} *
            <input
              autoFocus
              required
              maxLength={250}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field-label">
            {t('country')} *
            <input
              required
              maxLength={100}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </label>
          <label className="field-label">
            {t('taxId')}
            <input maxLength={100} value={tax} onChange={(e) => setTax(e.target.value)} />
          </label>
          <label className="field-label">
            {t('industry')}
            <input maxLength={50} value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </label>
          <label className="field-label">
            {copy.reporter} *
            <select
              value={reportedBy}
              onChange={(e) => setReportedBy(e.target.value as typeof reportedBy)}
            >
              <option value="organization">{copy.organization}</option>
              <option value="counterparty">{copy.counterparty}</option>
            </select>
          </label>
          <label className="field-label">
            {copy.reference} *
            <input
              required
              maxLength={500}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label className="field-label">
            {copy.statement} *
            <textarea
              required
              maxLength={4000}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
            />
          </label>
          <label className="field-label">
            {copy.reason} *
            <textarea
              required
              maxLength={4000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <ErrorNotice error={action.error} />
          {action.error instanceof ApiError && action.error.status === 409 && initial && (
            <div className="aic-recovery">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setLatest(null)
                  setRefreshing(true)
                  void counterpartiesApi
                    .counterparty(initial.id)
                    .then(setLatest)
                    .catch(action.setError)
                    .finally(() => setRefreshing(false))
                }}
              >
                {t('refresh')}
              </button>
              {latest && (
                <>
                  <p>
                    {copy.compare}: {latest.name} · {latest.country} · {latest.tax_id ?? '—'} ·{' '}
                    {latest.industry_code ?? '—'} · {t('revision')} {latest.revision}
                  </p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setRevision(latest.revision)
                      setLatest(null)
                      action.setError(null)
                    }}
                  >
                    {copy.rebase}
                  </button>
                </>
              )}
            </div>
          )}
          <div className="dialog-actions">
            <button className="primary-button" type="submit">
              {t(action.busy ? 'working' : 'save')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
