import type { Locale } from '@/lib/api/contracts'

const text = {
  historic: ['Earlier assessment', 'Bản đánh giá trước đây', '历史评估'],
  historicHelp: [
    'These saved observations are not current conclusions for the selected data.',
    'Nhận định đã lưu không phải kết luận hiện hành cho dữ liệu đang chọn.',
    '这些已存分析不代表当前所选数据的结论。',
  ],
  changed: [
    'Current data has changed. Review the sources before reassessing.',
    'Dữ liệu hiện tại đã thay đổi. Kiểm tra nguồn trước khi đánh giá lại.',
    '当前数据已更改。请先核查来源再重新评估。',
  ],
  savedVerification: [
    'Verification when this assessment was saved',
    'Xác minh tại thời điểm lưu đánh giá',
    '保存评估时的核实状态',
  ],
  currentFacts: [
    'Current source data — not the historical snapshot',
    'Dữ kiện hiện tại — không phải bản nguồn lịch sử',
    '当前来源数据，并非历史快照',
  ],
  currentVerification: ['Current verification', 'Xác minh hiện tại', '当前核实状态'],
  noSnapshot: [
    'The original fact values are not included in this saved result. Current data below must not be treated as the historical source.',
    'Bản kết quả này không chứa đầy đủ giá trị nguồn tại thời điểm lưu. Không dùng dữ kiện hiện tại bên dưới thay cho nguồn lịch sử.',
    '此结果未包含保存时的完整来源数值。不得以以下当前数据替代历史来源。',
  ],
  needsData: [
    'Not ready to publish a score',
    'Chưa đủ điều kiện phát điểm',
    '尚不满足发布分数的条件',
  ],
  ready: ['Current experimental result', 'Kết quả thử nghiệm hiện hành', '当前试验结果'],
  saved: [
    'Analysis saved — check current readiness',
    'Đã lưu phân tích — kiểm tra điều kiện hiện hành',
    '已保存分析，请检查当前就绪条件',
  ],
  noResult: ['No assessment saved', 'Chưa có bản đánh giá', '尚无已存评估'],
  reviewSaved: ['Document review saved', 'Đã lưu rà soát tài liệu', '已保存文件审查'],
  nextActions: ['Actions needed', 'Việc cần xử lý', '待处理事项'],
  choose: ['Choose a reporting period', 'Chọn kỳ báo cáo', '选择报告期间'],
  addSet: ['Add financial statements', 'Thêm bộ BCTC', '添加财务报表'],
  editFacts: ['Complete source data', 'Hoàn thiện dữ kiện nguồn', '完善来源数据'],
  verifyFacts: ['Review facts and sources', 'Đối chiếu dữ kiện và nguồn', '对照数据与来源'],
  reviewDocuments: ['Open document review', 'Mở rà soát tài liệu', '打开文件审查'],
  methodHelp: [
    'This condition needs the methodology owner or additional evidence. It cannot be bypassed by editing a score.',
    'Điều kiện này cần người phụ trách phương pháp hoặc bằng chứng bổ sung; không thể bỏ qua bằng cách sửa điểm.',
    '此条件需要方法负责人或补充证据，不能通过修改分数绕过。',
  ],
  verificationScope: [
    'Data selected for human verification',
    'Dữ liệu đang được chuyên viên đối chiếu',
    '供专员核对的数据',
  ],
  sourceVersion: ['Source version', 'Phiên bản nguồn', '来源版本'],
  verifiedAt: [
    'Review decision recorded at',
    'Quyết định rà soát ghi nhận lúc',
    '审查决定记录时间',
  ],
  verifier: ['Verifier reference', 'Tham chiếu người xác minh', '核实人参考'],
  originalEntry: ['Original manual entry', 'Bản nhập gốc', '原始手工录入'],
  bridgeHelp: [
    'Check each bridge separately against the same period and source. Selecting facts does not establish a bridge.',
    'Kiểm tra riêng từng cầu nối theo đúng kỳ và nguồn. Chọn dữ kiện không tự xác nhận cầu nối.',
    '请按相同期间和来源分别核对各项衔接。选择数据不代表确认衔接。',
  ],
  noDebt: [
    'Verified zero-debt / zero-interest exception',
    'Ngoại lệ đã xác minh: không có nợ vay và lãi vay',
    '已核实的零债务、零利息例外',
  ],
  ratio: ['Ratio', 'Tỷ số', '比率'],
  cancel: ['Cancel', 'Hủy', '取消'],
  periodRequired: [
    'Select a period first; no historical conclusions are applied to an unspecified period.',
    'Chọn kỳ trước; không áp nhận định lịch sử cho kỳ chưa xác định.',
    '请先选择期间，不会将历史结论套用于未指定期间。',
  ],
} as const

export function specialistText(locale: Locale, key: keyof typeof text) {
  return text[key][locale === 'en' ? 0 : locale === 'vi' ? 1 : 2]
}
