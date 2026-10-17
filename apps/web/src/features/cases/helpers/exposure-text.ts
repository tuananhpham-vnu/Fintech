import type { Locale } from '@/lib/api/contracts'

// LocaleProvider currently releases en/vi/zh-CN. Keep this feature's copy local.
const words = {
  claims: ['Payment claims', 'Khai báo thanh toán', '付款申报'],
  conditions: ['Conditions', 'Điều kiện', '条件'],
  addClaim: ['Add claim', 'Thêm khai báo', '添加申报'],
  addCondition: ['Add condition', 'Thêm điều kiện', '添加条件'],
  remove: ['Remove', 'Xóa', '移除'],
  unknown: ['Unknown', 'Chưa rõ', '未知'],
  reason: ['Missing information reason', 'Lý do thiếu thông tin', '信息缺失原因'],
  not_agreed: ['Not agreed', 'Chưa thỏa thuận', '未约定'],
  source_missing: ['Source missing', 'Thiếu nguồn', '缺少来源'],
  ambiguous: ['Ambiguous', 'Chưa rõ nghĩa', '含义不明'],
  dueDate: ['Due date', 'Ngày đến hạn', '到期日'],
  paid: ['Paid', 'Đã chi trả', '已付款'],
  received: ['Received', 'Đã nhận', '已收款'],
  proposed: ['Proposed', 'Dự kiến', '拟议'],
  actual: ['Actual', 'Thực tế', '实际'],
  reported_satisfied: ['Reported satisfied', 'Được khai báo đã đáp ứng', '申报已满足'],
  payer: ['Payer', 'Bên trả tiền', '付款方'],
  payee: ['Payee', 'Bên nhận tiền', '收款方'],
  claimant: ['Claimant / reported by', 'Bên khai báo', '申报方'],
  organization: ['Organization', 'Tổ chức', '本机构'],
  counterparty: ['Counterparty', 'Đối tác', '交易对手'],
  occurred: ['Actual date', 'Ngày thực tế', '实际日期'],
  planned: ['Planned date', 'Ngày dự kiến', '计划日期'],
  obligation: ['Obligation reference', 'Tham chiếu nghĩa vụ', '义务参考'],
  payment: ['Payment', 'Thanh toán', '付款'],
  delivery: ['Delivery', 'Giao hàng', '交付'],
  acceptance: ['Acceptance', 'Nghiệm thu', '验收'],
  refund: ['Refund', 'Hoàn tiền', '退款'],
  guarantee: ['Guarantee', 'Bảo lãnh', '担保'],
  other: ['Other', 'Khác', '其他'],
  scope: ['Scope / obligation', 'Phạm vi / nghĩa vụ', '范围 / 义务'],
  trigger: ['Trigger', 'Điều kiện kích hoạt', '触发条件'],
  sources: ['Sources', 'Nguồn', '来源'],
  declaration: [
    'Staff-transcribed declaration',
    'Khai báo do chuyên viên ghi nhận',
    '员工转录声明',
  ],
  addSource: ['Add source', 'Thêm nguồn', '添加来源'],
  noDocuments: [
    'No document evidence available. Use a declaration.',
    'Chưa có bằng chứng tài liệu. Sử dụng khai báo.',
    '暂无文件证据。请使用声明。',
  ],
  unverified: [
    'Declarations and claims remain unverified.',
    'Khai báo chưa được xác minh.',
    '声明和申报仍未经核实。',
  ],
  historical: [
    'Historical sources are retained exactly and cannot be rebound here.',
    'Giữ nguyên nguồn lịch sử; không thể gắn lại nguồn tại đây.',
    '历史来源保持原样，无法在此重新绑定。',
  ],
  unsupported: [
    'This historical record is read-only. It cannot be submitted under the released schema; explicitly remove it to continue.',
    'Bản ghi lịch sử chỉ đọc, không phù hợp schema hiện hành. Cần xóa rõ ràng để tiếp tục lưu.',
    '此历史记录只读，无法按当前架构提交；请明确移除后再保存。',
  ],
  rebase: [
    'Use this revision and keep my inputs',
    'Dùng phiên bản này và giữ nội dung đang nhập',
    '使用此版本并保留我的输入',
  ],
  rebaseHelp: [
    'Review the latest Exposure below. Saving after rebase replaces it with your current editor input, including claims, conditions and exact sources.',
    'Xem Exposure mới nhất bên dưới. Sau khi cập nhật phiên bản, lưu sẽ thay bằng nội dung đang nhập, gồm khai báo, điều kiện và nguồn chính xác.',
    '请查看下方最新敞口。更新版本后保存，将以当前输入替换它，包括申报、条件及精确来源。',
  ],
  invalid: [
    'Check amounts, dates, missing reasons and sources in each entry.',
    'Kiểm tra số tiền, ngày, lý do thiếu và nguồn của từng mục.',
    '请检查各项金额、日期、缺失原因及来源。',
  ],
} satisfies Record<string, [string, string, string]>
export function exposureText(locale: Locale) {
  const index = locale === 'vi' ? 1 : locale === 'zh-CN' ? 2 : 0
  return (key: keyof typeof words) => words[key][index]
}
export type ExposureText = ReturnType<typeof exposureText>
