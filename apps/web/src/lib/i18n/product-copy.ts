import type { Locale } from '@/lib/api/contracts'

type Copy = readonly [string, string, string]
const copy = {
  synthetic: [
    'Illustrative test data — not information about a real business.',
    'Dữ liệu minh họa phục vụ kiểm thử — không phải thông tin của doanh nghiệp thật.',
    '测试示例数据，并非真实企业信息。',
  ],
  provenance: ['Entry provenance', 'Nguồn gốc số liệu', '数据录入来源'],
  manual: [
    'Manually entered; verification is recorded separately.',
    'Số liệu nhập tay; trạng thái xác minh được ghi riêng.',
    '手工录入，核实状态单独记录。',
  ],
  calculation: ['How this is calculated', 'Xem cách tính', '查看计算方法'],
  sources: ['Source and verification', 'Nguồn và xác minh', '来源与核实'],
  unknown: ['Needs review', 'Cần kiểm tra', '需要核查'],
  next: ['Next step', 'Việc cần làm tiếp', '下一步'],
  data: ['Financial data', 'Dữ liệu tài chính', '财务数据'],
  result: ['Financial health', 'Sức khỏe tài chính', '财务健康'],
  selectedPeriod: ['Reporting period', 'Kỳ báo cáo đang xem', '当前报告期间'],
  selectPeriod: [
    'Choose a financial statement set to see its data and assessment.',
    'Chọn một bộ BCTC để xem dữ kiện và kết quả tương ứng.',
    '请选择一套财务报表，查看对应数据和评估。',
  ],
  noFacts: [
    'No financial facts yet. Add a statement set and check its sources.',
    'Chưa có dữ kiện tài chính. Thêm bộ BCTC và kiểm tra nguồn số liệu.',
    '暂无财务事实。请添加报表并核查数据来源。',
  ],
  fact: ['Financial item', 'Chỉ tiêu tài chính', '财务项目'],
  original: ['Original value', 'Số liệu gốc', '原始数值'],
  normalized: [
    'Value in base currency units',
    'Giá trị theo đơn vị tiền tệ cơ sở',
    '基础货币单位数值',
  ],
  verification: ['Verification', 'Xác minh', '核实'],
  period: ['Period', 'Kỳ báo cáo', '报告期间'],
  resultPeriod: ['Saved result period', 'Kỳ của kết quả đã lưu', '已存结果所属期间'],
  facts: ['Review source data', 'Kiểm tra số liệu nguồn', '检查来源数据'],
  ratioHelp: [
    'Read each ratio with its reporting period and source. Missing inputs are not treated as zero.',
    'Tỷ số cần được đọc cùng kỳ báo cáo và nguồn số liệu tương ứng. Dữ kiện còn thiếu không được xem là số 0.',
    '请结合对应报告期间及来源解读比率，缺失数据不会按零处理。',
  ],
  noObservation: [
    'No observation recorded in this result.',
    'Chưa có nhận định được ghi trong kết quả này.',
    '本结果尚未记录此类分析。',
  ],
  originalSource: ['Original source excerpt', 'Trích dẫn tài liệu gốc', '原始材料摘录'],
  sourceIdentity: ['Check source version', 'Đối chiếu phiên bản nguồn', '核对来源版本'],
  viewSource: ['View source data', 'Xem nguồn số liệu', '查看数据来源'],
  historyAction: ['Record updated', 'Đã cập nhật hồ sơ', '档案已更新'],
  specialist: ['Specialist', 'Chuyên viên', '专员'],
  recorded: ['Recorded', 'Đã ghi nhận', '已记录'],
  support: ['Reference for support', 'Mã tra soát hỗ trợ', '支持查询编号'],
  missing: ['Not provided', 'Chưa có số liệu', '暂无数据'],
  directResponse: [
    'Self-reported answer submitted',
    'Đã gửi câu trả lời tự khai',
    '已提交自报回答',
  ],
} satisfies Record<string, Copy>
export type ProductKey = keyof typeof copy
export function productText(locale: Locale, key: ProductKey) {
  return copy[key][locale === 'en' ? 0 : locale === 'vi' ? 1 : 2]
}

export function isSyntheticText(text: string | null | undefined) {
  return !!text && /\bsynthetic\b|\bfixture\b|dữ liệu (?:tổng hợp|minh họa)/i.test(text)
}

/** For staff notes/provenance only. Never apply to source quotes or legal entity names. */
export function presentNote(text: string | null | undefined, locale: Locale) {
  if (!text) return ''
  if (text === 'Self-reported capability submission') return productText(locale, 'directResponse')
  if (isSyntheticText(text)) return productText(locale, 'synthetic')
  if (/(?:[A-Z]:[\\/]|(?:docs|src|node_modules)\/|\.md\b|stack trace|^\s*\{)/i.test(text))
    return productText(locale, 'provenance')
  return text
}

const actions: Record<string, Copy> = {
  'request.approve': ['Supplement request approved', 'Đã duyệt yêu cầu bổ sung', '已批准补充请求'],
  'request.cancel': ['Supplement request cancelled', 'Đã hủy yêu cầu bổ sung', '已取消补充请求'],
  'request.ack': ['Supplement review recorded', 'Đã ghi nhận rà soát bổ sung', '已记录补充审查'],
  'questionnaire.direct_response': ['Answer received', 'Đã nhận câu trả lời', '已收到回答'],
  'questionnaire.closed': ['Questionnaire closed', 'Đã đóng bộ câu hỏi', '已关闭问卷'],
  'invitation.created': ['Invitation created', 'Đã tạo lời mời', '已创建邀请'],
  'invitation.revoked': ['Invitation revoked', 'Đã thu hồi lời mời', '已撤销邀请'],
  'case.created': ['Case created', 'Đã tạo hồ sơ', '已创建档案'],
  'company_health.created': [
    'Company assessment created',
    'Đã tạo hồ sơ đánh giá doanh nghiệp',
    '已创建企业评估档案',
  ],
  'case.exposure_updated': [
    'Transaction information updated',
    'Đã cập nhật thông tin giao dịch',
    '已更新交易信息',
  ],
  'review.completed': ['Document review completed', 'Đã hoàn tất rà soát hồ sơ', '已完成文件审查'],
  'assessment.completed': ['Assessment saved', 'Đã lưu kết quả đánh giá', '已保存评估结果'],
  'assessment.acknowledged': ['Assessment reviewed', 'Đã ghi nhận xem đánh giá', '已确认查看评估'],
  'financial.created': ['Statement set added', 'Đã thêm bộ BCTC', '已添加财务报表集'],
  'financial.revised': [
    'Financial facts updated',
    'Đã cập nhật dữ kiện tài chính',
    '已更新财务事实',
  ],
  'financial.verified': [
    'Financial verification recorded',
    'Đã ghi nhận xác minh số liệu',
    '已记录财务核实',
  ],
  'request.drafted': [
    'Supplement request drafted',
    'Đã tạo nháp yêu cầu bổ sung',
    '已起草补充请求',
  ],
  'request.approved': ['Supplement request approved', 'Đã duyệt yêu cầu bổ sung', '已批准补充请求'],
  'request.edited': ['Request updated', 'Đã chỉnh sửa yêu cầu', '已更新请求'],
  'questionnaire.created': ['Questionnaire created', 'Đã tạo bộ câu hỏi', '已创建问卷'],
}
export function actionText(action: string, locale: Locale) {
  const text = actions[action]
  return text
    ? text[locale === 'en' ? 0 : locale === 'vi' ? 1 : 2]
    : productText(locale, 'historyAction')
}
