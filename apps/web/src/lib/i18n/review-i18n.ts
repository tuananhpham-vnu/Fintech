import { productText } from './product-copy'
import type { Locale } from '@/lib/api/contracts'

type Triplet = readonly [en: string, vi: string, zhCN: string]

function pick(triplet: Triplet, locale: Locale): string {
  return locale === 'vi' ? triplet[1] : locale === 'zh-CN' ? triplet[2] : triplet[0]
}

const ruleMap: Record<string, Triplet> = {
  counterparty_identity_source: [
    'Counterparty identity document',
    'Chứng từ xác minh danh tính/pháp nhân đối tác',
    '交易对手身份证明材料',
  ],
  financial_minimum: [
    'Minimum financial dataset',
    'Bộ dữ liệu tài chính tối thiểu',
    '最低财务数据集',
  ],
  transaction_contract: ['Transaction contract', 'Hợp đồng giao dịch', '交易合同'],
  delivery_acceptance_source: [
    'Delivery / acceptance record',
    'Chứng từ giao hàng / nghiệm thu',
    '交付 / 验收凭证',
  ],
  paid_received_source: [
    'Payment / receipt record',
    'Chứng từ thanh toán / nhận tiền',
    '收付款凭证',
  ],
  refund_guarantee_source: [
    'Refund / guarantee document',
    'Chứng từ hoàn tiền / bảo lãnh',
    '退款 / 担保文件',
  ],
  supplementary_tax_invoice: [
    'Supplementary tax invoice / report',
    'Hóa đơn / báo cáo thuế bổ sung',
    '补充税务发票 / 报告',
  ],
  identity_pending: [
    'Identity verification pending',
    'Đang chờ xác minh danh tính',
    '交易对手身份待确认',
  ],
  identity_conflict: [
    'Counterparty identity conflict',
    'Xung đột danh tính đối tác',
    '交易对手身份信息冲突',
  ],
}

const dynamicRulePrefixes: Array<{
  prefix: string
  label: Triplet
}> = [
  {
    prefix: 'document_unverified:',
    label: ['Document unverified', 'Tài liệu chưa qua xác minh', '文件尚未人工核实'],
  },
  {
    prefix: 'extraction_uncertain:',
    label: [
      'Extraction missing or uncertain',
      'Trích xuất còn thiếu hoặc chưa chắc chắn',
      '提取数据缺失或存疑',
    ],
  },
  {
    prefix: 'document_subject_mismatch:',
    label: ['Document subject mismatch', 'Nguồn không khớp chủ thể hồ sơ', '材料主体与案件不符'],
  },
  {
    prefix: 'invoice_not_payment:',
    label: [
      'Invoice is not payment proof',
      'Hóa đơn không thay thế chứng từ thanh toán',
      '发票不作为付款凭证',
    ],
  },
  {
    prefix: 'condition_unverified:',
    label: [
      'Contract condition unverified',
      'Điều kiện hợp đồng chưa xác minh',
      '合同条件尚未核实',
    ],
  },
  {
    prefix: 'claim_unverified:',
    label: ['Payment claim unverified', 'Khai báo thanh toán chưa xác minh', '收付款申报尚未核实'],
  },
]

const categoryMap: Record<string, Triplet> = {
  missing_document: ['Missing document', 'Thiếu chứng từ', '缺失文件'],
  financial_minimum: ['Financial minimum', 'Dữ liệu tài chính tối thiểu', '最低财务要求'],
  identity_uncertainty: [
    'Identity uncertainty',
    'Chưa đủ căn cứ xác minh danh tính',
    '身份依据不足',
  ],
  source_uncertainty: ['Source uncertainty', 'Nguồn tài liệu chưa xác thực', '材料来源存疑'],
  identity_conflict: ['Identity conflict', 'Xung đột định danh', '身份冲突'],
  transaction_uncertainty: [
    'Transaction uncertainty',
    'Nghiệp vụ giao dịch chưa xác thực',
    '交易事实存疑',
  ],
  contradiction: ['Contradiction', 'Mâu thuẫn thông tin', '信息矛盾'],
}

const severityMap: Record<string, Triplet> = {
  warning: ['Warning', 'Cảnh báo', '警告'],
  info: ['Information', 'Thông tin', '信息'],
  blocker: ['Blocker', 'Yếu tố chặn', '阻碍项'],
  critical: ['Critical', 'Nghiêm trọng', '严重'],
  high: ['High', 'Cao', '高'],
  medium: ['Medium', 'Trung bình', '中'],
  low: ['Low', 'Thấp', '低'],
}

const conditionKindMap: Record<string, Triplet> = {
  delivery: ['delivery', 'giao hàng', '交付'],
  acceptance: ['acceptance', 'nghiệm thu', '验收'],
  payment: ['payment', 'thanh toán', '付款'],
  refund: ['refund', 'hoàn tiền', '退款'],
  guarantee: ['guarantee', 'bảo lãnh', '担保'],
  other: ['other', 'khác', '其他'],
}

const claimStateMap: Record<string, Triplet> = {
  actual: ['Actual', 'Thực tế', '实际'],
  proposed: ['Proposed', 'Dự kiến', '拟议'],
}

const claimKindMap: Record<string, Triplet> = {
  paid: ['paid', 'đã chi trả', '已付款'],
  received: ['received', 'đã nhận', '已收款'],
}

const exactSummaryMap: Record<string, Triplet> = {
  'Counterparty identity remains unresolved.': [
    'Counterparty identity remains unresolved.',
    'Chưa hoàn tất xác minh danh tính pháp nhân đối tác.',
    '交易对手法人身份尚未确认。',
  ],
  'Counterparty identity is conflicting.': [
    'Counterparty identity is conflicting.',
    'Có mâu thuẫn trong thông tin danh tính đối tác.',
    '交易对手身份信息存在冲突。',
  ],
  'An invoice is not proof of payment or receipt.': [
    'An invoice is not proof of payment or receipt.',
    'Hóa đơn không phải là chứng từ thanh toán hoặc xác nhận nhận tiền.',
    '发票不作为付款或已收款的凭证。',
  ],
}

const structuredRuleSummaries: Record<string, Triplet> = {
  counterparty_identity_source: [
    'Missing documentary support: Counterparty identity',
    'Chưa có chứng từ phù hợp để xác minh danh tính đối tác',
    '缺少用于确认交易对手身份的支持文件',
  ],
  financial_minimum: [
    'Missing documentary support: Minimum financial dataset',
    'Chưa có báo cáo tài chính đáp ứng yêu cầu tối thiểu',
    '缺少满足最低要求的财务报表材料',
  ],
  transaction_contract: [
    'Missing documentary support: Transaction contract',
    'Chưa có hợp đồng giao dịch để chứng minh nghĩa vụ phát sinh',
    '缺少用于证明已发生义务的交易合同',
  ],
  delivery_acceptance_source: [
    'Missing documentary support: Delivery / acceptance record',
    'Chưa có chứng từ giao hàng hoặc biên bản nghiệm thu',
    '缺少交货凭证或验收记录',
  ],
  paid_received_source: [
    'Missing documentary support: Payment / receipt record',
    'Chưa có chứng từ thanh toán hoặc nhận tiền thực tế',
    '缺少实际收付款凭证',
  ],
  refund_guarantee_source: [
    'Missing documentary support: Refund / guarantee document',
    'Chưa có chứng từ bảo lãnh hoặc cam kết hoàn tiền',
    '缺少退款保证或担保文件',
  ],
  supplementary_tax_invoice: [
    'Missing documentary support: Supplementary tax invoice / report',
    'Chưa có hóa đơn hoặc báo cáo thuế bổ sung',
    '缺少补充发票或税务报告',
  ],
}

const absenceBasisMap: Record<string, Triplet> = {
  'No current document has matching specialist-reviewed scope and a policy-listed supporting type.':
    [
      'No current document has matching specialist-reviewed scope and a policy-listed supporting type.',
      'Hiện chưa có tài liệu nào thuộc phạm vi đã được chuyên viên rà soát và đúng loại chứng từ theo chính sách.',
      '当前暂无符合专员已复核范围且符合政策所列支持类型的文件。',
    ],
  'Missing support remains missing; no fact has been verified.': [
    'Missing support remains missing; no fact has been verified.',
    'Chứng từ còn thiếu vẫn ghi nhận là thiếu; chưa có dữ kiện nào được xác minh.',
    '缺失材料仍视为缺失；未核实任何事实。',
  ],
}

const limitationMap: Record<string, Triplet> = {
  'Assessment is decision support; acknowledgement is not transaction approval.': [
    'Assessment is decision support; acknowledgement is not transaction approval.',
    'Đánh giá hỗ trợ quyết định; ghi nhận đã xem không phải phê duyệt giao dịch.',
    '评估仅辅助决策；确认已阅不代表批准交易。',
  ],
  'AIC experimental financial index — NOT VALIDATED. No default calibration; PD remains null.': [
    'AIC experimental financial index — NOT VALIDATED. No default calibration; PD remains null.',
    'Chỉ số tài chính thử nghiệm AIC — CHƯA KIỂM ĐỊNH. Chưa hiệu chỉnh xác suất vỡ nợ; PD được giữ trống.',
    'AIC实验性财务指数 — 尚未验证。未进行违约概率校准；PD保持为空。',
  ],
  'Absence of a document does not establish absence of the underlying fact.': [
    'Absence of a document does not establish absence of the underlying fact.',
    'Việc thiếu chứng từ không đồng nghĩa với việc giao dịch hoặc dữ kiện thực tế không tồn tại.',
    '缺少文件并不等同于底层事实不存在。',
  ],
  'Numeric FHI blocked; document review, supported ratios and Transaction Review remain available independently. Method approval is a separate gate.':
    [
      'FHI publication depends on verified financial inputs and the method gate. See current assessment readiness. Document and transaction reviews remain separate.',
      'Phát điểm FHI phụ thuộc dữ kiện tài chính đã xác minh và cổng phương pháp. Xem điều kiện đánh giá hiện hành. Rà soát tài liệu và giao dịch vẫn tách riêng.',
      'FHI 分值发布取决于已核实的财务输入及方法门禁。请查看当前评估条件。文件与交易审查仍独立进行。',
    ],
  'limitation only; no automatic score penalty': [
    'Limitation only; no automatic score penalty.',
    'Chỉ ghi nhận hạn chế thẩm định; không tự động trừ điểm đánh giá.',
    '仅作为限制说明；不作自动评分扣减。',
  ],
  'request source or retain explicit missing limitation; legal-entity conclusion unavailable': [
    'Request source or retain explicit missing limitation; legal-entity conclusion unavailable.',
    'Cần yêu cầu bổ sung nguồn hoặc ghi nhận hạn chế thiếu chứng từ; chưa thể đưa ra kết luận pháp nhân.',
    '需索取来源材料或保留明确的缺失限制；暂无法得出法人主体结论。',
  ],
  'A declared registration and AI extraction do not verify the legal entity.': [
    'A declared registration and AI extraction do not verify the legal entity.',
    'Đăng ký kinh doanh do người dùng khai báo và kết quả trích xuất AI chưa đủ để xác nhận tư cách pháp nhân.',
    '申报的工商登记和 AI 提取结果不等于核实法人资格。',
  ],
  'Document classification, identity, dates, amounts and signatures remain subject to human verification.':
    [
      'Document classification, identity, dates, amounts and signatures remain subject to human verification.',
      'Phân loại tài liệu, danh tính, ngày tháng, số tiền và chữ ký vẫn phải qua bước xác minh của con người.',
      '文件分类、主体身份、日期、金额和签署仍须经人工核实。',
    ],
  'Unreadable, absent, failed or uncertain extraction is not silently replaced with a confirmed fact.':
    [
      'Unreadable, absent, failed or uncertain extraction is not silently replaced with a confirmed fact.',
      'Dữ liệu trích xuất bị mờ, thiếu, lỗi hoặc chưa chắc chắn không được tự động thay thế bằng dữ kiện đã xác nhận.',
      '不可读、缺失、失败或存疑的提取数据不会被隐式替换为已确认的事实。',
    ],
  'No verified settlement or outstanding balance is computed.': [
    'No verified settlement or outstanding balance is computed.',
    'Chưa có số liệu thanh toán hoặc số dư công nợ được tính toán có xác minh.',
    '尚未计算出经核实的结算金额或未结余额。',
  ],
  'Human verification remains required.': [
    'Human verification remains required.',
    'Vẫn bắt buộc phải có sự xác minh của chuyên viên.',
    '仍需人工专员进行核实。',
  ],
  'Document review does not verify facts or approve a transaction.': [
    'Document review does not verify facts or approve a transaction.',
    'Rà soát hồ sơ không xác minh thay cho dữ kiện thực tế và không cấu thành phê duyệt giao dịch.',
    '文件审查不代表核实事实或批准交易。',
  ],
  'Wrong subject source cannot satisfy documentary requirements or resolve findings.': [
    'Wrong subject source cannot satisfy documentary requirements or resolve findings.',
    'Tài liệu sai chủ thể không thể đáp ứng yêu cầu hồ sơ hoặc giải quyết các phát hiện.',
    '主体不符的材料无法满足文件要求或解除发现问题。',
  ],
  'do not treat transaction as supported active obligation; retain proposed/unsupported limitation for review':
    [
      'Do not treat transaction as supported active obligation; retain proposed/unsupported limitation for review.',
      'Không coi giao dịch là nghĩa vụ đã phát sinh có chứng từ; giữ nguyên hạn chế dự kiến/chưa đủ chứng từ khi rà soát.',
      '不得将交易视为有证明的已发生义务；在审查中保留拟议/缺乏支持的限制。',
    ],
  'flag unsupported performance/trigger; do not mark condition satisfied': [
    'Flag unsupported performance/trigger; do not mark condition satisfied.',
    'Cảnh báo điều kiện thực hiện/kích hoạt chưa có chứng từ; không đánh dấu điều kiện đã đáp ứng.',
    '提示履行/触发条件缺少证明；不得标记条件已满足。',
  ],
  'retain source claim as unverified or incomplete, never infer zero or nonpayment': [
    'Retain source claim as unverified or incomplete, never infer zero or nonpayment.',
    'Giữ khai báo nguồn ở trạng thái chưa xác minh hoặc chưa đầy đủ; không suy diễn thành 0 đồng hay chưa thanh toán.',
    '将来源申报保持为未核实或不完整；不得推断为零或未付款。',
  ],
  'flag unsupported safeguard, do not substitute financial health for delivery guarantee': [
    'Flag unsupported safeguard, do not substitute financial health for delivery guarantee.',
    'Cảnh báo biện pháp bảo đảm chưa có chứng từ; không lấy sức khỏe tài chính thay thế cho bảo lãnh giao hàng.',
    '提示保障措施缺乏证明；不得以财务健康状况替代交付担保。',
  ],
  'provisional document review only; no verified identity conclusion while source missing/conflicting':
    [
      'Provisional document review only; no verified identity conclusion while source missing/conflicting.',
      'Chỉ rà soát hồ sơ tạm thời; không đưa ra kết luận xác nhận danh tính khi thiếu hoặc xung đột nguồn.',
      '仅作为暂定文件审查；材料缺失或冲突期间不得得出确认身份的结论。',
    ],
  'Missing support remains missing; no fact has been verified.': [
    'Missing support remains missing; no fact has been verified.',
    'Chứng từ còn thiếu vẫn ghi nhận là thiếu; chưa có dữ kiện nào được xác minh.',
    '缺失材料仍视为缺失；未核实任何事实。',
  ],
  'No settlement or outstanding amount is inferred from invoices.': [
    'No settlement or outstanding amount is inferred from invoices.',
    'Không suy diễn giá trị thanh toán hoặc công nợ còn lại từ hóa đơn.',
    '不得根据发票推断结算金额或未结金额。',
  ],
  'Proposed or reported satisfaction is distinct from verified satisfaction.': [
    'Proposed or reported satisfaction is distinct from verified satisfaction.',
    'Việc dự kiến hoặc khai báo đã đáp ứng hoàn toàn khác biệt với việc đã xác minh đáp ứng.',
    '拟议或申报的满足状态与经核实的满足状态存在明确区别。',
  ],
  'Paid and received claims are not netted, summed or treated as independent verified settlements.':
    [
      'Paid and received claims are not netted, summed or treated as independent verified settlements.',
      'Các khoản khai báo đã trả và đã nhận không được tự cấn trừ, cộng dồn hay coi là các khoản thanh toán đã xác minh.',
      '已付与已收申报不作轧差、累加，亦不视为独立经核实的结算。',
    ],
  'Unknown amounts remain unknown; missing support is not zero or nonpayment.': [
    'Unknown amounts remain unknown; missing support is not zero or nonpayment.',
    'Khoản tiền chưa rõ được giữ nguyên là chưa rõ; thiếu chứng từ không có nghĩa là bằng 0 hay không thanh toán.',
    '未知金额保持为未知；缺少证明不代表金额为零或未付款。',
  ],
  'Affected identity conclusions are blocked. A waiver cannot resolve this conflict.': [
    'Affected identity conclusions are blocked. A waiver cannot resolve this conflict.',
    'Các kết luận pháp lý liên quan đến danh tính bị chặn. Chính sách bỏ qua không thể giải quyết xung đột này.',
    '受影响的身份结论已被阻止。豁免无法解决此冲突。',
  ],
}

const blockerMap: Record<string, Triplet> = {
  STALE_DOCUMENT_SNAPSHOT: [
    'The case changed during extraction. This result was withheld. Review the current source and submit a new source version explicitly if processing is still needed.',
    'Hồ sơ đã thay đổi trong khi trích xuất; kết quả này được giữ lại. Kiểm tra nguồn hiện hành và chủ động nộp phiên bản nguồn mới nếu vẫn cần xử lý.',
    '提取期间案件发生变化，结果已保留不发布。请核对当前来源，仍需处理时明确提交新的来源版本。',
  ],
  DOCUMENT_SUPERSEDED: [
    'This source or its counterparty snapshot has been replaced. Review the current source version.',
    'Nguồn hoặc phiên bản thông tin đối tác này đã được thay thế. Hãy kiểm tra phiên bản nguồn hiện hành.',
    '此来源或交易对手快照已被替换，请检查当前来源版本。',
  ],
  FINANCIAL_INPUTS_REQUIRED: [
    'Financial facts must be entered and verified before publishing a numeric index.',
    'Cần nhập và xác minh dữ kiện tài chính trước khi phát hành chỉ số dạng số.',
    '发布数值指数前需录入并核实财务事实。',
  ],
  REVIEW_REQUIRED: [
    'Run document review before assessing this case.',
    'Chạy rà soát tài liệu trước khi đánh giá hồ sơ.',
    '评估案件前请先运行文件审查。',
  ],
  STALE_REVIEW: [
    'Inputs changed. Run document review again.',
    'Dữ liệu đã thay đổi. Hãy chạy lại rà soát tài liệu.',
    '输入已改变，请重新运行文件审查。',
  ],
  SOURCE_PROCESSING: [
    'Wait for source processing to finish.',
    'Chờ xử lý tài liệu nguồn hoàn tất.',
    '请等待来源文件处理完成。',
  ],
  FHI_METHOD_UNCONFIGURED: [
    'Separate financial method approval is required.',
    'Cần có phê duyệt phương pháp tài chính riêng biệt.',
    '需要单独的财务方法审批。',
  ],
  VERIFIED_FINANCIAL_INPUTS_REQUIRED: [
    'Verified financial inputs are required.',
    'Yêu cầu phải có dữ liệu tài chính đầu vào đã qua xác minh.',
    '需要经过核实的财务输入数据。',
  ],
  'Separate financial method approval is required.': [
    'Separate financial method approval is required.',
    'Cần có phê duyệt phương pháp tài chính riêng biệt.',
    '需要单独的财务方法审批。',
  ],
}

export function localizeRuleId(ruleId: string | null | undefined, locale: Locale): string {
  if (!ruleId) return ''
  if (Object.hasOwn(ruleMap, ruleId)) return pick(ruleMap[ruleId], locale)
  for (const item of dynamicRulePrefixes) {
    if (ruleId.startsWith(item.prefix)) {
      return pick(item.label, locale)
    }
  }
  return productText(locale, 'unknown')
}

export function localizeCategory(category: string | null | undefined, locale: Locale): string {
  if (!category) return ''
  if (Object.hasOwn(categoryMap, category)) return pick(categoryMap[category], locale)
  return category
}

export function localizeSeverity(severity: string | null | undefined, locale: Locale): string {
  if (!severity) return ''
  if (Object.hasOwn(severityMap, severity)) return pick(severityMap[severity], locale)
  return severity
}

export function localizeConditionKind(kind: string | null | undefined, locale: Locale): string {
  if (!kind) return ''
  if (Object.hasOwn(conditionKindMap, kind)) return pick(conditionKindMap[kind], locale)
  return productText(locale, 'unknown')
}

export function localizeClaimState(state: string | null | undefined, locale: Locale): string {
  if (!state) return ''
  if (Object.hasOwn(claimStateMap, state)) return pick(claimStateMap[state], locale)
  return productText(locale, 'unknown')
}

export function localizeClaimKind(kind: string | null | undefined, locale: Locale): string {
  if (!kind) return ''
  if (Object.hasOwn(claimKindMap, kind)) return pick(claimKindMap[kind], locale)
  return productText(locale, 'unknown')
}

export function localizeRequirementKey(key: string | null | undefined, locale: Locale): string {
  if (!key) return ''
  return localizeRuleId(key, locale)
}

export function localizeAbsenceBasis(
  basis: string | null | undefined,
  locale: Locale,
): string | undefined {
  if (!basis) return undefined
  if (Object.hasOwn(absenceBasisMap, basis)) return pick(absenceBasisMap[basis], locale)
  return productText(locale, 'unknown')
}

export function localizeLimitation(text: string | null | undefined, locale: Locale): string {
  if (!text) return ''
  if (Object.hasOwn(limitationMap, text)) return pick(limitationMap[text], locale)
  return text
}

export function localizeBlocker(
  blocker: { code?: string; message?: string } | null | undefined,
  locale: Locale,
): string {
  if (!blocker) return ''
  if (blocker.code && Object.hasOwn(blockerMap, blocker.code))
    return pick(blockerMap[blocker.code], locale)
  if (blocker.message && Object.hasOwn(blockerMap, blocker.message))
    return pick(blockerMap[blocker.message], locale)
  return productText(locale, 'unknown')
}

export function localizeFindingSummary(
  finding: { rule_id?: string; summary?: string; issue_key?: string } | null | undefined,
  locale: Locale,
): string {
  if (!finding?.summary) return ''
  const summary = finding.summary

  if (Object.hasOwn(exactSummaryMap, summary)) {
    return pick(exactSummaryMap[summary], locale)
  }

  // 1. Missing documentary support: <key>
  const missingPrefix = 'Missing documentary support: '
  if (summary.startsWith(missingPrefix)) {
    const key = summary.slice(missingPrefix.length).trim()
    if (Object.hasOwn(structuredRuleSummaries, key)) {
      return pick(structuredRuleSummaries[key], locale)
    }
    return productText(locale, 'unknown')
  }

  // 2. Document <id> is declared, not verified.
  const declaredMatch = /^Document (.+) is declared, not verified\.$/.exec(summary)
  if (declaredMatch) {
    if (locale === 'vi') {
      return `Tài liệu nguồn mới ở trạng thái khai báo, chưa qua xác minh chuyên viên.`
    }
    if (locale === 'zh-CN') {
      return `来源文件 仅为申报状态，尚未经人工核实。`
    }
    return `The source document is declared, not verified.`
  }

  // 3. Document <id> has missing or uncertain extraction.
  const uncertainMatch = /^Document (.+) has missing or uncertain extraction\.$/.exec(summary)
  if (uncertainMatch) {
    if (locale === 'vi') {
      return `Tài liệu nguồn có trường dữ liệu trích xuất còn thiếu hoặc chưa chắc chắn.`
    }
    if (locale === 'zh-CN') {
      return `来源文件 存在缺失或存疑的提取字段。`
    }
    return `The source document has missing or uncertain extraction.`
  }

  // 4. Specialist identified a subject mismatch in document <id>.
  const mismatchMatch = /^Specialist identified a subject mismatch in document (.+)\.$/.exec(
    summary,
  )
  if (mismatchMatch) {
    if (locale === 'vi') {
      return `Chuyên viên ghi nhận tài liệu nguồn không đúng chủ thể hồ sơ.`
    }
    if (locale === 'zh-CN') {
      return `专员指出来源文件 的主体与本案不符。`
    }
    return `Specialist identified a subject mismatch in the source document.`
  }

  // 5. Reported <kind> condition remains unverified.
  const conditionMatch = /^Reported (.+) condition remains unverified\.$/.exec(summary)
  if (conditionMatch) {
    const kind = conditionMatch[1]
    if (locale === 'vi') {
      return `Điều kiện ${localizeConditionKind(kind, 'vi')} được khai báo nhưng chưa được xác minh.`
    }
    if (locale === 'zh-CN') {
      return `所申报的 ${localizeConditionKind(kind, 'zh-CN')} 条件尚未核实。`
    }
    return `Reported ${kind} condition remains unverified.`
  }

  // 6. <state> <kind> claim remains unverified.
  const claimMatch = /^(.+) (.+) claim remains unverified\.$/.exec(summary)
  if (claimMatch) {
    const state = claimMatch[1]
    const kind = claimMatch[2]
    if (locale === 'vi') {
      return `Khai báo ${localizeClaimState(state, 'vi')} (${localizeClaimKind(kind, 'vi')}) chưa được xác minh.`
    }
    if (locale === 'zh-CN') {
      return `所申报的 ${localizeClaimState(state, 'zh-CN')} (${localizeClaimKind(kind, 'zh-CN')}) 尚未核实。`
    }
    return `${state} ${kind} claim remains unverified.`
  }

  return productText(locale, 'unknown')
}

/** Only server-generated limitation slots may be localized. The second condition
 * limitation is the original staff missing_reason, even when it matches a message. */
export function localizeFindingLimitation(
  finding: { rule_id?: string; issue_key?: string },
  text: string,
  index: number,
  locale: Locale,
): string {
  if (index > 0 && (finding.rule_id ?? finding.issue_key ?? '').startsWith('condition_unverified:'))
    return text
  return localizeLimitation(text, locale)
}

/** Keep unknown code bytes available in technical disclosure, not as invented prose. */
export function systemLabel(raw: string, label: string, locale: Locale): string {
  return label === raw && raw.includes('_')
    ? pick(['Unrecognized system item', 'Mục hệ thống chưa có nhãn', '尚未识别的系统项目'], locale)
    : label
}
