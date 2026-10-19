import type { IntakeItem } from './intake-api'
import { factKeys, factKeysForCountry, type FinancialSet, type FactInput } from './api'
import type { Locale } from '@/lib/api/contracts'
import { financialLabel } from './labels'

export function intakeReviewMessage(
  item: IntakeItem,
  locale: Locale,
  sets?: FinancialSet[],
): string | null {
  const pending = item.origin.period_candidates?.filter((c) => c.status === 'pending') ?? []
  if (pending.length) {
    const periods = pending.map((c) => `${c.period.start_date} → ${c.period.end_date}`).join(', ')
    return locale === 'vi'
      ? `Có nhiều nguồn số liệu cho kỳ ${periods}. Đối chiếu bên dưới để chọn số liệu cho kỳ này; cả hai tài liệu và các kỳ khác vẫn được giữ.`
      : locale === 'zh-CN'
        ? `报告期 ${periods} 有多个数据来源。请在下方选择本期数据；两个文件及其他报告期均保留。`
        : `Multiple sources contain ${periods}. Choose figures for this period below; both files and other periods are retained.`
  }
  if (
    item.state !== 'needs_review' ||
    (item.error_code && item.error_code !== 'FINANCIAL_PERIOD_OR_FIELDS_UNRESOLVED')
  )
    return null
  const periods = item.classification?.periods ?? []
  const resolved =
    periods.length > 0 &&
    !item.classification?.period_issues?.some((i) => i.severity === 'blocking') &&
    periods.every(
      (p) =>
        p.start_date &&
        (item.statements.some(
          (s) =>
            s.kind === p.kind &&
            s.start_date === p.start_date &&
            s.end_date === p.end_date &&
            s.basis === p.basis,
        ) ||
          item.origin.period_candidates?.some(
            (c) =>
              c.status === 'kept' &&
              c.period.kind === p.kind &&
              c.period.start_date === p.start_date &&
              c.period.end_date === p.end_date &&
              c.basis === p.basis,
          )),
    )
  if (!resolved) return null
  const missing = [
    ...new Set(
      item.statements.flatMap((s) => {
        const active = sets?.find((set) => set.id === s.set_id)
        return active
          ? factKeysForCountry(active.scope?.country).filter(
              (key) => !active.facts.some((f) => f.key === key && f.raw_value !== null),
            )
          : s.missing_keys
      }),
    ),
  ]
    .map((key) => financialLabel(locale, 'fact', key).label)
    .join(', ')
  return locale === 'vi'
    ? `Đã xác định kỳ báo cáo. ${missing ? `Chưa đủ số liệu: ${missing}. ` : ''}Rà soát số liệu và xác nhận trước khi chấm điểm.`
    : locale === 'zh-CN'
      ? `报告期已确定。${missing ? `缺失数据：${missing}。` : ''}请在评分前核查并确认数据。`
      : `Reporting periods identified. ${missing ? `Missing figures: ${missing}. ` : ''}Review and confirm figures before scoring.`
}

export function factCitations(set?: FinancialSet) {
  return Object.fromEntries(
    (set?.facts ?? []).flatMap((f) =>
      ['financial_import', 'statement_entry', 'calculated'].includes(f.source.kind) &&
      'page' in f.source
        ? [[f.key, { page: f.source.page, quote: f.source.quote }]]
        : [],
    ),
  ) as Record<string, { page: number; quote: string }>
}

export function sameReviewScope(
  set: FinancialSet | undefined,
  scope: {
    kind: string
    start: string
    end: string
    basis: string
    regime: string
    currency: string
    unit: string
  },
) {
  return (
    !!set &&
    set.scope.period.kind === scope.kind &&
    set.scope.period.start_date === scope.start &&
    set.scope.period.end_date === scope.end &&
    set.scope.basis === scope.basis &&
    set.scope.accounting_regime === scope.regime &&
    set.scope.currency === scope.currency &&
    set.scope.unit_multiplier === scope.unit
  )
}

/** A scope review must not turn a calculation into a directly printed value. */
export function periodReviewFacts(
  set: FinancialSet | undefined,
  retain: boolean,
  values: Record<string, string>,
  citations: Record<string, { page: number; quote: string }>,
  file: { receipt_id: string; source_id: string; source_hash: string },
  reason: string,
  label: (key: string) => string,
): FactInput[] {
  return factKeys
    .filter((key) => key !== 'eligible_cash_and_equivalents' || set?.scope.country !== 'VN')
    .filter((key) => values[key])
    .map((key) => {
      const prior = set?.facts.find((f) => f.key === key),
        citation = citations[key]
      if (
        prior?.source.kind === 'calculated' &&
        (!retain ||
          values[key] !== prior.raw_value ||
          prior.source.source_id !== file.source_id ||
          prior.source.source_hash !== file.source_hash ||
          citation?.page !== prior.source.page ||
          citation?.quote !== prior.source.quote)
      )
        throw Error(
          'Số tính toán phải giữ nguyên phạm vi và dẫn chứng; gỡ đề xuất trước khi đổi phạm vi.',
        )
      if (
        retain &&
        prior &&
        prior.raw_value === values[key] &&
        'source_id' in prior.source &&
        prior.source.source_id === file.source_id &&
        'page' in prior.source &&
        citation?.page === prior.source.page &&
        citation?.quote === prior.source.quote
      ) {
        return {
          key,
          raw_value: prior.raw_value,
          raw_label: prior.raw_label,
          missing_reason: prior.missing_reason,
          source: prior.source,
        }
      }
      if (!citation?.quote.trim() || !Number.isInteger(citation.page) || citation.page < 1)
        throw Error('Trang nguồn và trích dẫn BCTC là bắt buộc.')
      return {
        key,
        raw_value: values[key],
        raw_label: label(key),
        missing_reason: null,
        source: {
          kind: 'statement_entry',
          ...file,
          source_kind: 'financial_file',
          fact_key: key,
          page: citation.page,
          quote: citation.quote.trim(),
          reason,
        },
      }
    })
}

/** Human additions carry BCTC provenance; absent values are never manufactured. */
export function reviewedFacts(
  set: FinancialSet,
  values: Record<string, string>,
  citations: Record<string, { page: number; quote: string }>,
  reason: string,
): FactInput[] {
  const template = set.facts.find(
    (f) => f.source.kind === 'financial_import' || f.source.kind === 'statement_entry',
  )?.source
  return factKeysForCountry(set.scope?.country).flatMap((key) => {
    const original = set.facts.find((f) => f.key === key),
      raw = values[key] || null
    if (original)
      return [
        {
          key,
          raw_value: raw,
          raw_label: original.raw_label,
          missing_reason: raw === null ? reason : null,
          source:
            raw !== original.raw_value && original.source.kind === 'financial_import'
              ? { ...original.source, human_correction: { reason } }
              : original.source,
        },
      ]
    if (raw === null) return []
    const citation = citations[key]
    if (
      !template ||
      (template.kind !== 'financial_import' && template.kind !== 'statement_entry') ||
      !citation?.quote.trim() ||
      !Number.isInteger(citation.page) ||
      citation.page < 1 ||
      citation.page > 600
    )
      throw Error('Trang nguồn và trích dẫn BCTC là bắt buộc.')
    return [
      {
        key,
        raw_value: raw,
        raw_label: key,
        missing_reason: null,
        source: {
          kind: 'statement_entry',
          receipt_id: template.receipt_id,
          fact_key: key,
          source_kind: template.source_kind,
          source_id: template.source_id,
          source_hash: template.source_hash,
          page: citation.page,
          quote: citation.quote.trim(),
          reason,
        },
      },
    ]
  })
}
export const pendingIntakes = (items: IntakeItem[]) =>
  items.filter(
    (i) =>
      !i.superseded_by &&
      i.classification?.document_type !== 'other' &&
      ['queued', 'running', 'needs_review', 'failed', 'duplicate'].includes(i.state),
  )
export function intakeWarnings(item: IntakeItem) {
  const messages: Record<string, string> = {
    DISCOVERY_OCR_COVERAGE_LIMIT:
      'Tài liệu scan vượt phạm vi OCR tự động. Cần đối chiếu các trang chưa đọc.',
    DISCOVERY_TEXT_COVERAGE_LIMIT:
      'Tài liệu vượt phạm vi đọc tự động. Cần đối chiếu các trang còn lại.',
    PERIOD_EVIDENCE_UNRESOLVED:
      'Một kỳ do AI đề xuất chưa được kiểm chứng trong lần xử lý cũ. Thử lại để xem chi tiết từng kỳ.',
    FORMULA_WITHOUT_CACHED_VALUE:
      'Excel có công thức chưa lưu kết quả. Giá trị chưa đọc được giữ N/A.',
    FORMULA_CACHED_VALUE_REQUIRES_REVIEW: 'Cần đối chiếu kết quả công thức đã lưu trong Excel.',
    XLS_STORED_VALUES_REQUIRES_REVIEW: 'Cần đối chiếu các giá trị đã lưu trong file XLS.',
  }
  const periodReasons: Record<string, string> = {
    PERIOD_DATE_INVALID: 'ngày bắt đầu hoặc kết thúc chưa hợp lệ',
    QUOTE_NOT_IN_SOURCE: 'trích dẫn chưa khớp trang nguồn',
    PERIOD_PAGES_UNREAD: 'các trang làm căn cứ chưa đọc được',
    PERIOD_CONTEXT_REQUIRED: 'chưa liên kết được nhãn cột với kỳ báo cáo',
  }
  return [
    ...new Set([...(item.classification?.warnings ?? []), ...(item.origin.warnings ?? [])]),
  ].map((code) =>
    code.startsWith('PERIOD_REVIEW_REQUIRED:')
      ? `Kỳ ${code.split(':')[1] === 'unknown' ? 'chưa xác định' : code.split(':')[1]} cần đối chiếu: ${periodReasons[code.split(':')[2]] ?? 'chưa đủ căn cứ'}. Các kỳ đã nhận diện vẫn được giữ.`
      : code.startsWith('DISCOVERY_OCR_PAGE_FAILED:')
        ? `Chưa đọc được trang ${code.split(':')[1]}. Hãy đối chiếu trang này trong bản gốc.`
        : code.startsWith('PERIOD_EXTRACTION_FAILED:')
          ? `Chưa trích xuất được kỳ ${code.split(':')[1]}. Hãy rà soát hoặc thử lại.`
          : (messages[code] ?? code),
  )
}
export function intakeProgress(items: IntakeItem[]) {
  const files = items.filter(
    (i) =>
      (i.content_type !== 'application/zip' || i.state !== 'expanded') &&
      !i.superseded_by &&
      (i.state !== 'skipped' || i.classification?.document_type === 'other'),
  )
  const success = files.filter((i) => i.state === 'ready').length,
    failed = files.filter((i) => i.state === 'failed').length
  const completed = files.filter((i) => !['queued', 'running'].includes(i.state)).length
  return {
    total: files.length,
    success,
    failed,
    completed,
    percent: files.length ? Math.round((completed / files.length) * 100) : 0,
    active:
      files.some((i) => ['queued', 'running'].includes(i.state)) ||
      items.some((i) => i.state === 'queued' || i.state === 'running'),
  }
}
