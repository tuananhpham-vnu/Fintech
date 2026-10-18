'use client'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { ErrorNotice } from '@/components/feedback/error-notice'
import { Loading } from '@/components/feedback/loading'
import { PdfView } from '@/features/evidence/components/pdf-view'
import { MutationKey } from '@/lib/api/client'
import type { CaseDetail } from '@/lib/api/contracts'
import { useLocale } from '@/lib/i18n/locale-provider'
import { financialApi, factKeys } from '../api'
import { financialLabel } from '../labels'
import {
  importApi,
  importSourceUrl,
  candidateSource,
  type ImportIndex,
  type ImportReceipt,
  type ImportSource,
} from '../import-api'

export function FinancialImport({
  detail,
  onSaved,
  onClose,
}: {
  detail: CaseDetail
  onSaved: () => void
  onClose: () => void
}) {
  const { locale } = useLocale(),
    w = (en: string, vi: string, zh: string) => (locale === 'vi' ? vi : locale === 'en' ? en : zh)
  const [sources, setSources] = useState<ImportSource[]>([]),
    [sourceId, setSourceId] = useState('')
  const [revision, setRevision] = useState(detail.revision),
    [index, setIndex] = useState<ImportIndex | null>(null)
  const [draft, setDraft] = useState<ImportReceipt | null>(null),
    [pages, setPages] = useState<number[]>([])
  const [country, setCountry] = useState('VN'),
    [basis, setBasis] = useState('consolidated'),
    [endDate, setEndDate] = useState('')
  const [selected, setSelected] = useState<string[]>([]),
    [industry, setIndustry] = useState('UNKNOWN')
  const [confirmed, setConfirmed] = useState(false),
    [reason, setReason] = useState(''),
    [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null)
  const keys = useRef(new MutationKey())
  const source = sources.find((s) => s.kind + ':' + s.id === sourceId) ?? index?.source
  const refresh = async () => {
    const result = await importApi.sources(detail.id)
    setSources(result.sources)
    setRevision(result.revision)
    setConfirmed(false)
  }
  useEffect(() => {
    const abort = new AbortController()
    void importApi
      .sources(detail.id, abort.signal)
      .then((result) => {
        setSources(result.sources)
        setRevision(result.revision)
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e)
      })
    return () => abort.abort()
  }, [detail.id])
  async function run(work: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  const acceptIndex = (result: ImportIndex) => {
    setIndex(result)
    setPages(result.suggested_pages)
    setRevision(result.revision)
    setSources((old) => [...old.filter((s) => s.id !== result.source.id), result.source])
    setSourceId(result.source.kind + ':' + result.source.id)
    setDraft(null)
    setConfirmed(false)
  }
  return (
    <Modal
      title={w(
        'Import financial statements · Vietnam / US / China',
        'Đọc BCTC · Việt Nam / Mỹ / Trung Quốc',
        '导入财务报表 · 越南 / 美国 / 中国',
      )}
      onClose={onClose}
      busy={busy}
      dirty={!!draft}
      wide
    >
      <p>
        {w(
          'Upload the original PDF, select its statement pages, then compare the proposed figures with the source.',
          'Tải PDF gốc, chọn các trang bảng báo cáo rồi đối chiếu số liệu AI đề xuất với nguồn.',
          '上传原始 PDF，选择报表页，然后对照原文核查 AI 建议数据。',
        )}
      </p>
      <p className="help-text">
        {w(
          'PDF up to 25 MB / 600 pages; up to 16 selected pages (8 scanned). Spreadsheet files must currently be exported to PDF with visible units and column headers.',
          'PDF tối đa 25 MB / 600 trang; mỗi lần chọn tối đa 16 trang (8 trang scan). Với Excel, hãy xuất các bảng cần dùng ra PDF, giữ rõ đơn vị và tiêu đề cột.',
          'PDF 上限 25 MB / 600 页；每次最多选择 16 页（扫描件 8 页）。Excel 请先导出 PDF 并保留单位及列标题。',
        )}
      </p>
      <fieldset disabled={busy}>
        <label className="field-label">
          {w('Upload PDF', 'Tải PDF lên', '上传 PDF')}
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file)
                void run(async () =>
                  acceptIndex(await importApi.upload(detail.id, file, revision, keys.current)),
                )
            }}
          />
        </label>
        <label className="field-label">
          {w(
            'Or choose an existing PDF (including ZIP members)',
            'Hoặc chọn PDF đã nạp (kể cả tệp trong ZIP)',
            '或选择已上传的 PDF（含 ZIP 内文件）',
          )}
          <select
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value)
              setIndex(null)
              setDraft(null)
              setConfirmed(false)
            }}
          >
            <option value="">{w('Select source', 'Chọn nguồn', '选择来源')}</option>
            {sources.map((s) => (
              <option key={s.kind + ':' + s.id} value={s.kind + ':' + s.id}>
                {s.name} · {s.page_count ?? '?'} {w('pages', 'trang', '页')}
              </option>
            ))}
          </select>
        </label>
        {source && !index && (
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              void run(async () => {
                acceptIndex(
                  (await importApi.run(
                    detail.id,
                    source,
                    revision,
                    [],
                    undefined,
                    false,
                    keys.current,
                  )) as ImportIndex,
                )
              })
            }
          >
            {w('Read page index', 'Đọc danh sách trang', '读取页面索引')}
          </button>
        )}
        {index && (
          <>
            <details open>
              <summary>
                {w('Select original statement pages', 'Chọn trang báo cáo gốc', '选择原始报表页')} ·{' '}
                {pages.length}/16
              </summary>
              <p className="help-text">
                {w(
                  'Select balance sheet, income statement and cash flow statement for one reporting basis. Suggested pages are only hints; check continuation pages and notes.',
                  'Chọn bảng cân đối, kết quả kinh doanh và lưu chuyển tiền tệ cùng cơ sở báo cáo. Trang gợi ý chỉ để tham khảo; kiểm tra cả trang tiếp nối và thuyết minh cần thiết.',
                  '选择同一口径的资产负债表、利润表及现金流量表。建议页仅供参考，请检查续页及必要附注。',
                )}
              </p>
              <div style={{ maxHeight: 260, overflow: 'auto' }}>
                {index.pages.map((p) => (
                  <label
                    className="check-label"
                    key={p.page}
                    style={{ display: 'flex', gap: 8, alignItems: 'start', padding: 6 }}
                  >
                    <input
                      type="checkbox"
                      checked={pages.includes(p.page)}
                      disabled={!pages.includes(p.page) && pages.length >= 16}
                      onChange={(e) => {
                        setPages((old) =>
                          e.target.checked
                            ? [...old, p.page].sort((a, b) => a - b)
                            : old.filter((n) => n !== p.page),
                        )
                        setDraft(null)
                        setConfirmed(false)
                      }}
                    />
                    <span>
                      {w('Page', 'Trang', '页')} {p.page} {p.needs_ocr ? '· OCR' : ''} ·{' '}
                      {p.preview ||
                        w(
                          'No embedded text: inspect the original image',
                          'Không có chữ nhúng: cần xem ảnh gốc',
                          '无嵌入文字：请查看原图',
                        )}
                    </span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setPreview(importSourceUrl(index.source, p.page))}
                    >
                      {w('View', 'Xem', '查看')}
                    </button>
                  </label>
                ))}
              </div>
            </details>
            <div className="form-two-columns">
              <label className="field-label">
                {w('Report country', 'Quốc gia của báo cáo', '报表国家')}
                <select
                  value={country}
                  onChange={(e) => {
                    setCountry(e.target.value)
                    setDraft(null)
                  }}
                >
                  <option value="VN">Việt Nam</option>
                  <option value="US">United States</option>
                  <option value="CN">中国</option>
                </select>
              </label>
              <label className="field-label">
                {w('Reporting basis', 'Cơ sở báo cáo', '报表口径')}
                <select
                  value={basis}
                  onChange={(e) => {
                    setBasis(e.target.value)
                    setDraft(null)
                  }}
                >
                  <option value="consolidated">{w('Consolidated', 'Hợp nhất', '合并')}</option>
                  <option value="standalone">
                    {w('Standalone / parent', 'Riêng lẻ / công ty mẹ', '单体 / 母公司')}
                  </option>
                </select>
              </label>
              <label className="field-label">
                {w('Period end to extract', 'Ngày kết thúc kỳ cần lấy', '提取期间结束日')}
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value)
                    setDraft(null)
                  }}
                />
              </label>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={!pages.length || !endDate}
              onClick={() =>
                void run(async () => {
                  const result = (await importApi.run(
                    detail.id,
                    index.source,
                    revision,
                    pages,
                    { country, basis, end_date: endDate },
                    true,
                    keys.current,
                  )) as ImportReceipt
                  setDraft(result)
                  setRevision(result.revision)
                  setSelected(result.facts.map((f) => f.key))
                  setConfirmed(false)
                })
              }
            >
              {w('Extract financial facts', 'Trích xuất dữ kiện tài chính', '提取财务事实')}
            </button>
          </>
        )}
        {draft && (
          <section className="panel aic-section">
            <h3>{draft.scope.entity_name}</h3>
            <p>
              {draft.scope.start_date} – {draft.scope.end_date} ·{' '}
              {financialLabel(locale, 'period', draft.scope.period_kind).label} ·{' '}
              {financialLabel(locale, 'basis', draft.scope.basis).label} · {draft.scope.currency} ×{' '}
              {draft.scope.unit_multiplier} ·{' '}
              {financialLabel(locale, 'regime', draft.scope.accounting_regime).label}
            </p>
            <p className="warning-banner">
              {w(
                'AI candidates are unverified. Review entity, year column, basis, sign and units. Saving does not verify facts or approve a credit rating.',
                'Đây là dữ kiện AI đề xuất, chưa xác minh. Cần đối chiếu pháp nhân, cột năm, cơ sở, dấu và đơn vị. Lưu chưa phải là xác minh dữ kiện hay phê duyệt xếp hạng tín dụng.',
                'AI 建议尚未核实。请核对主体、年份列、口径、正负号及单位。保存不等于核实或批准信用评级。',
              )}
            </p>
            {!!draft.ocr_failures?.length && (
              <p className="warning-banner">
                {w(
                  'Some selected pages could not be read. Their figures are missing and must be checked on the original source.',
                  'Một số trang chưa đọc được. Số liệu ở các trang này còn thiếu và cần kiểm tra trên bản gốc.',
                  '部分所选页面未能读取，其中数据仍缺失，需对照原件核查。',
                )}{' '}
                {w('Pages', 'Trang', '页')}: {draft.ocr_failures.map((p) => p.page).join(', ')}
              </p>
            )}
            {draft.document_type !== 'financial_statement' && (
              <p className="warning-banner">
                {w(
                  'The source was not identified as financial statements. No financial facts can be saved.',
                  'Nguồn không được nhận diện là BCTC. Không có dữ kiện tài chính để lưu.',
                  '来源未识别为财务报表，不能保存财务事实。',
                )}
              </p>
            )}
            <details>
              <summary>
                {w('Scope evidence', 'Căn cứ kỳ, đơn vị và pháp nhân', '主体、期间及单位依据')}
              </summary>
              {draft.scope_evidence.map((e, i) => (
                <blockquote key={i}>
                  <a href={importSourceUrl(draft.source, e.page)} target="_blank" rel="noreferrer">
                    {w('Page', 'Trang', '页')} {e.page}
                  </a>
                  <pre style={{ whiteSpace: 'pre-wrap' }}>{e.quote}</pre>
                </blockquote>
              ))}
            </details>
            <div className="financial-table-wrap">
              <table className="financial-table">
                <caption>
                  {w('Grounded candidates', 'Dữ kiện có căn cứ nguồn', '有原文依据的建议')}
                </caption>
                <thead>
                  <tr>
                    <th>{w('Use', 'Dùng', '采用')}</th>
                    <th>{w('Fact', 'Chỉ tiêu', '指标')}</th>
                    <th>{w('Original value', 'Số gốc', '原值')}</th>
                    <th>{w('Source', 'Nguồn', '来源')}</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.facts.map((f) => (
                    <tr key={f.key}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={financialLabel(locale, 'fact', f.key).label}
                          checked={selected.includes(f.key)}
                          onChange={(e) => {
                            setSelected((old) =>
                              e.target.checked ? [...old, f.key] : old.filter((k) => k !== f.key),
                            )
                            setConfirmed(false)
                          }}
                        />
                      </td>
                      <th scope="row">
                        {financialLabel(locale, 'fact', f.key).label}
                        <p className="help-text">{f.label}</p>
                      </th>
                      <td className="numeric">
                        {f.raw_token}
                        <p className="help-text">
                          {f.value} × {draft.scope.unit_multiplier}
                        </p>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setPreview(importSourceUrl(draft.source, f.page))}
                        >
                          {w('Page', 'Trang', '页')} {f.page} · {f.method}
                        </button>
                        <details>
                          <summary>{w('Quote', 'Trích dẫn', '引文')}</summary>
                          <pre style={{ whiteSpace: 'pre-wrap' }}>{f.quote}</pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              {w(
                'Missing or not sufficiently grounded',
                'Thiếu hoặc chưa đủ căn cứ',
                '缺失或依据不足',
              )}
              :{' '}
              {factKeys
                .filter((k) => !draft.facts.some((f) => f.key === k))
                .map((k) => financialLabel(locale, 'fact', k).label)
                .join('; ') || '—'}
            </p>
            {!!draft.rejected.length && (
              <p className="help-text">
                {w(
                  'Withheld because the source, numeric token or financial label requires further review',
                  'Đã giữ lại để rà soát thêm do nguồn, cách ghi số hoặc ý nghĩa chỉ tiêu chưa đủ chắc chắn',
                  '因来源、数值写法或财务含义仍需复核而暂未采用',
                )}
                :{' '}
                {draft.rejected.map((r) => financialLabel(locale, 'fact', r.key).label).join('; ')}
              </p>
            )}
            <label className="field-label">
              {w('Company industry', 'Ngành của doanh nghiệp', '企业行业')}
              <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
                {[
                  'UNKNOWN',
                  'MANUFACTURING',
                  'RETAIL',
                  'BUSINESS_SERVICES',
                  'CONSUMER_DURABLES',
                  'DISTRIBUTION_WHOLESALE_PILOT',
                  'OTHER',
                ].map((v) => (
                  <option key={v} value={v}>
                    {financialLabel(locale, 'scope', v).label}
                  </option>
                ))}
              </select>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{' '}
              {w(
                'I compared the selected facts, entity, period, basis, currency and units against the original pages. These are actual results, not forecasts.',
                'Tôi đã đối chiếu các chỉ tiêu chọn, pháp nhân, kỳ, cơ sở, tiền tệ và đơn vị với trang gốc. Đây là số thực tế, không phải dự báo.',
                '我已对照原页核查所选指标、主体、期间、口径、币种及单位，确认其为实际数据而非预测。',
              )}
            </label>
            <label className="field-label">
              {w('Review note', 'Ghi chú đối chiếu', '核对说明')}
              <textarea
                value={reason}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="primary-button"
              disabled={
                !confirmed ||
                !selected.length ||
                reason.trim().length < 3 ||
                draft.document_type !== 'financial_statement'
              }
              onClick={() =>
                void run(async () => {
                  const s = draft.scope
                  await financialApi.save(
                    detail.id,
                    undefined,
                    {
                      expected_revision: revision,
                      reason: reason.trim(),
                      period: {
                        kind: s.period_kind,
                        start_date: s.start_date,
                        end_date: s.end_date,
                      },
                      basis: s.basis,
                      accounting_regime: s.accounting_regime,
                      currency: s.currency,
                      unit_multiplier: s.unit_multiplier,
                      industry_scope: industry,
                      observation_kind: 'actual',
                      audit_status: 'unknown',
                      statement_version: `import:${draft.receipt_id}`,
                      import_review: { receipt_id: draft.receipt_id, confirmed: true },
                      facts: draft.facts
                        .filter((f) => selected.includes(f.key))
                        .map((f) => ({
                          key: f.key,
                          raw_value: f.value,
                          raw_label: f.label,
                          missing_reason: null,
                          source: candidateSource(draft, f),
                        })),
                    },
                    keys.current,
                  )
                  onSaved()
                  onClose()
                })
              }
            >
              {w('Save unverified facts', 'Lưu dữ kiện chờ xác minh', '保存为待核实事实')}
            </button>
          </section>
        )}
      </fieldset>
      {busy && <Loading />}
      {busy && (
        <p role="status">
          {w(
            'Processing selected pages. OCR may take several minutes.',
            'Đang xử lý các trang đã chọn. OCR có thể cần vài phút.',
            '正在处理所选页面，OCR 可能需要几分钟。',
          )}
        </p>
      )}
      <ErrorNotice error={error} />
      {!!error && (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void run(refresh)}
        >
          {w('Refresh case revision', 'Lấy phiên bản hồ sơ mới', '刷新案件版本')}
        </button>
      )}
      {preview && (
        <section>
          <div className="section-title">
            <h3>{w('Original PDF', 'PDF gốc', '原始 PDF')}</h3>
            <button type="button" className="text-button" onClick={() => setPreview('')}>
              {w('Close preview', 'Đóng bản xem', '关闭预览')}
            </button>
          </div>
          <a href={preview} target="_blank" rel="noreferrer">
            {w('Open source in a separate tab', 'Mở nguồn ở tab riêng', '在单独标签页打开原文')}
          </a>
          <PdfView
            key={preview}
            url={preview.split('#')[0]}
            initialPage={Number(preview.split('#page=')[1]) || 1}
            onPageChange={() => {}}
          />
        </section>
      )}
    </Modal>
  )
}
