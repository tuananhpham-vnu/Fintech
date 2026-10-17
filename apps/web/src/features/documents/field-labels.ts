import type { Locale } from '@/lib/api/contracts'

type Labels = readonly [en: string, vi: string, zhCN: string]

// Source-document roles from contracts 1.0.2 and services/ai/extraction/extractor.py.
// These labels establish neither application-party identity nor verification status.
const labels: Record<string, Labels> = {
  'borrower.name': ['Document entity name', 'Tên đơn vị trên tài liệu', '文件所载主体名称'],
  'borrower.tax_id': [
    'Document entity tax ID',
    'Mã số thuế đơn vị trên tài liệu',
    '文件所载主体税号',
  ],
  'financial.period_end': ['Reporting period end', 'Ngày kết thúc kỳ báo cáo', '报告期末日期'],
  'financial.scope': ['Financial statement scope', 'Phạm vi báo cáo tài chính', '财务报表范围'],
  'financial.unit_multiplier': ['Unit multiplier', 'Hệ số đơn vị tính', '计量单位倍数'],
  'financial.total_assets': ['Total assets', 'Tổng tài sản', '资产总额'],
  'financial.liabilities': ['Total liabilities', 'Tổng nợ phải trả', '负债总额'],
  'financial.equity': ['Equity', 'Vốn chủ sở hữu', '所有者权益'],
  'money.currency': ['Currency', 'Loại tiền tệ', '币种'],
  'loan.amount': ['Requested loan amount', 'Số tiền đề nghị vay', '申请贷款金额'],
  'receipt.amount': ['Receipt claim amount', 'Số tiền khai báo thu', '收款申报金额'],
  'receipt.contract_ref': [
    'Receipt contract reference',
    'Tham chiếu hợp đồng của khoản thu',
    '收款合同引用',
  ],
  'receipt.scope_ref': ['Receipt scope reference', 'Tham chiếu phạm vi khoản thu', '收款范围引用'],
  'receipt.claim_type': ['Receipt claim type', 'Loại khai báo thu tiền', '收款申报类型'],
  'receipt.expected_date': ['Expected receipt date', 'Ngày dự kiến thu tiền', '预计收款日期'],
  'contract.ref': ['Contract reference', 'Tham chiếu hợp đồng', '合同引用'],
  'parties.borrower.tax_id': [
    'Source seller / payee tax ID',
    'Mã số thuế bên bán / bên nhận tiền trên tài liệu',
    '来源文件中卖方 / 收款方税号',
  ],
  'parties.counterparty.tax_id': [
    'Source buyer / payer tax ID',
    'Mã số thuế bên mua / bên trả tiền trên tài liệu',
    '来源文件中买方 / 付款方税号',
  ],
  'contract.amount': ['Contract amount', 'Giá trị hợp đồng', '合同金额'],
  'contract.scope_ref': ['Contract scope reference', 'Tham chiếu phạm vi hợp đồng', '合同范围引用'],
  'contract.payment_condition': [
    'Contract payment condition',
    'Điều kiện thanh toán hợp đồng',
    '合同付款条件',
  ],
  'acceptance.ref': [
    'Acceptance record reference',
    'Tham chiếu biên bản nghiệm thu',
    '验收凭证引用',
  ],
  'acceptance.contract_ref': [
    'Acceptance contract reference',
    'Tham chiếu hợp đồng nghiệm thu',
    '验收合同引用',
  ],
  'acceptance.date': ['Acceptance date', 'Ngày nghiệm thu', '验收日期'],
  'acceptance.scope_ref': [
    'Acceptance scope reference',
    'Tham chiếu phạm vi nghiệm thu',
    '验收范围引用',
  ],
  'acceptance.scope_text': [
    'Acceptance scope description',
    'Mô tả phạm vi nghiệm thu',
    '验收范围描述',
  ],
  'acceptance.amount': ['Acceptance amount', 'Giá trị nghiệm thu', '验收金额'],
  'payment.ref': ['Payment record reference', 'Tham chiếu chứng từ thanh toán', '付款凭证引用'],
  'payment.contract_ref': [
    'Payment contract reference',
    'Tham chiếu hợp đồng thanh toán',
    '付款合同引用',
  ],
  'parties.payee.tax_id': [
    'Source payee tax ID',
    'Mã số thuế bên nhận tiền trên tài liệu',
    '来源文件中收款方税号',
  ],
  'parties.payer.tax_id': [
    'Source payer tax ID',
    'Mã số thuế bên trả tiền trên tài liệu',
    '来源文件中付款方税号',
  ],
  'payment.date': ['Payment date', 'Ngày thanh toán', '付款日期'],
  'payment.amount': ['Payment amount', 'Số tiền thanh toán', '付款金额'],
  'payment.status': ['Payment status', 'Trạng thái thanh toán', '付款状态'],
  'document.summary': ['Document summary', 'Tóm tắt tài liệu', '文件摘要'],
}

const legacyPrefix = 'legacy:1.0.2:'
const unknown: Labels = ['Extracted field', 'Trường dữ liệu trích xuất', '提取字段']

/** Recognizes registry keys and only the exact legacy 1.0.2 namespace; retains raw input. */
export function documentFieldLabel(
  fieldKey: string,
  locale: Locale,
): { label: string; raw: string; known: boolean } {
  const key = fieldKey.startsWith(legacyPrefix) ? fieldKey.slice(legacyPrefix.length) : fieldKey
  const known = Object.prototype.hasOwnProperty.call(labels, key)
  const text = known ? labels[key] : unknown
  return { label: text[locale === 'en' ? 0 : locale === 'vi' ? 1 : 2], raw: fieldKey, known }
}
