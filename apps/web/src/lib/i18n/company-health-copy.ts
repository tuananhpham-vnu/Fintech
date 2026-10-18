import type { Locale } from '@/lib/api/contracts'
const copy = {
  vi: {
    history: 'Lịch sử hồ sơ',
    filter: 'Phân loại hồ sơ',
    title: 'Đánh giá sức khỏe doanh nghiệp',
    create: 'Tạo hồ sơ đánh giá doanh nghiệp',
    intro:
      'Chọn doanh nghiệp, bổ sung báo cáo theo năm và đối chiếu nguồn để xem tình hình tài chính cùng báo cáo tham khảo.',
    company: 'Doanh nghiệp',
    reason: 'Mục đích lập hồ sơ',
    pending:
      'Luồng đánh giá doanh nghiệp đang chờ cập nhật cấu trúc dữ liệu. Quản trị viên cần triển khai bản cập nhật đã kiểm thử trước khi tạo hồ sơ tại đây.',
    sources: '1. Bổ sung báo cáo tài chính',
    verify: '2. Đối chiếu và xác minh số liệu',
    assess: '3. Đánh giá và xem báo cáo',
    sourceHelp: 'Tải tài liệu đúng doanh nghiệp và kỳ báo cáo. Kiểm tra phiên bản và trang nguồn.',
    verifyHelp:
      'Chọn kỳ, nhập hoặc sửa số liệu từ nguồn rõ ràng. Xác minh từng số liệu và các cầu nối với lý do cụ thể.',
    assessHelp:
      'Xem chỉ số, so sánh các năm phù hợp và lập báo cáo. Khi thiếu bằng chứng, báo cáo sẽ nêu phần còn thiếu.',
    noExposure: 'Hồ sơ tài chính doanh nghiệp',
    saved: 'Đã lưu hồ sơ',
  },
  en: {
    history: 'Case history',
    filter: 'Case category',
    title: 'Business financial health',
    create: 'Start a company assessment',
    intro:
      'Choose a company, add annual statements and check sources to view financial health and a reference report.',
    company: 'Company',
    reason: 'Purpose of this assessment',
    pending:
      'Company assessments are awaiting a data structure update. An administrator must release the tested update before cases can be created here.',
    sources: '1. Add financial statements',
    verify: '2. Check and verify financial facts',
    assess: '3. Assess and view report',
    sourceHelp:
      'Upload statements for the correct company and period. Check source version and page.',
    verifyHelp:
      'Select a period and enter or correct facts from clear sources. Verify individual facts and bridges with specific reasons.',
    assessHelp:
      'Inspect metrics, compare compatible years and prepare a report. Missing evidence remains explicit in the report.',
    noExposure: 'Company financial workspace',
    saved: 'Case saved',
  },
  'zh-CN': {
    history: '档案历史',
    filter: '档案类别',
    title: '企业财务健康评估',
    create: '创建企业评估档案',
    intro: '选择企业，添加年度财务报表并核对来源，查看财务状况和参考报告。',
    company: '企业',
    reason: '本次评估目的',
    pending: '企业评估功能正在等待数据结构更新。管理员发布已测试的更新后，方可在此创建档案。',
    sources: '1. 添加财务报表',
    verify: '2. 核对并验证财务数据',
    assess: '3. 评估并查看报告',
    sourceHelp: '上传正确企业和报告期的报表，核对来源版本和页码。',
    verifyHelp: '选择报告期，根据明确来源录入或更正数据。逐项核验数据及桥接关系，并记录具体理由。',
    assessHelp: '查看指标、比较口径一致的年度并生成报告。缺失证据将在报告中明确列出。',
    noExposure: '企业财务档案',
    saved: '档案已保存',
  },
} as const
export const companyHealthText = (locale: Locale, key: keyof typeof copy.vi) => copy[locale][key]
