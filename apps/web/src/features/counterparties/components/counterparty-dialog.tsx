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
    rebase: 'Keep my draft and use this revision',
    compare: 'Current saved record (your draft is preserved)',
  },
  vi: {
    rebase: 'Giữ bản nháp và dùng phiên bản này',
    compare: 'Bản ghi hiện tại (bản nháp của bạn được giữ lại)',
  },
  'zh-CN': { rebase: '保留草稿并使用此版本', compare: '当前已保存的记录（您的草稿会保留）' },
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
    [refreshing, setRefreshing] = useState(false)
  const dirty =
    name !== (initial?.name ?? '') ||
    tax !== (initial?.tax_id ?? '') ||
    industry !== (initial?.industry_code ?? '') ||
    country !== (initial?.country ?? 'VN')
  function submit() {
    if (!name.trim() || !country.trim()) {
      action.setError(new ApiError(422, 'INVALID_INPUT', ''))
      return
    }
    const body: CounterpartyCreateInput = {
      name: name.trim(),
      country: country.trim(),
      tax_id: tax.trim() || null,
      industry_code: industry.trim() || null,
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
            <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
              <option value="">Chưa xác định</option>
              <option value="DISTRIBUTION_WHOLESALE_PILOT">
                Phân phối / bán buôn — method hiện tại
              </option>
              {['MANUFACTURING', 'RETAIL', 'BUSINESS_SERVICES', 'CONSUMER_DURABLES', 'OTHER'].map(
                (code) => (
                  <option key={code} value={code}>
                    {
                      (
                        {
                          MANUFACTURING: 'Sản xuất',
                          RETAIL: 'Bán lẻ',
                          BUSINESS_SERVICES: 'Dịch vụ doanh nghiệp',
                          CONSUMER_DURABLES: 'Hàng tiêu dùng lâu bền',
                          OTHER: 'Ngành khác',
                        } as Record<string, string>
                      )[code]
                    }{' '}
                    — chưa hỗ trợ phát điểm
                  </option>
                ),
              )}
              {industry &&
                ![
                  'DISTRIBUTION_WHOLESALE_PILOT',
                  'MANUFACTURING',
                  'RETAIL',
                  'BUSINESS_SERVICES',
                  'CONSUMER_DURABLES',
                  'OTHER',
                ].includes(industry) && (
                  <option value={industry}>{industry} — cần rà soát mã ngành</option>
                )}
            </select>
            {industry !== 'DISTRIBUTION_WHOLESALE_PILOT' && (
              <small>
                Method hiện tại chỉ phát điểm cho phạm vi Phân phối / bán buôn. Hồ sơ ngành khác vẫn
                có thể lưu và rà soát.
              </small>
            )}
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
