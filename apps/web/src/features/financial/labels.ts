import type { Locale } from '@/lib/api/contracts'

type Text = readonly [en: string, vi: string, zh: string]
type Kind =
  | 'fact'
  | 'metric'
  | 'group'
  | 'status'
  | 'verification'
  | 'period'
  | 'basis'
  | 'regime'
  | 'scope'
  | 'observation'
  | 'audit'
  | 'blocker'
  | 'limitation'

// Presentation only: keys, raw source text and submitted values are never rewritten.
const labels: Record<Kind, Record<string, Text>> = {
  fact: {
    eligible_cash_and_equivalents: [
      'Eligible cash and cash equivalents',
      'Tiền và tương đương tiền đủ điều kiện (trình bày gộp)',
      '符合条件的现金及现金等价物合计',
    ],
    current_assets: ['Current assets', 'Tài sản ngắn hạn', '流动资产'],
    current_liabilities: ['Current liabilities', 'Nợ ngắn hạn', '流动负债'],
    cash: ['Cash', 'Tiền', '现金'],
    unrestricted_short_term_equivalents: [
      'Unrestricted short-term equivalents',
      'Các khoản tương đương tiền ngắn hạn không bị hạn chế',
      '不受限制的短期现金等价物',
    ],
    trade_receivables: ['Trade receivables', 'Phải thu khách hàng', '应收账款'],
    total_equity: ['Total equity', 'Tổng vốn chủ sở hữu', '所有者权益合计'],
    total_assets: ['Total assets', 'Tổng tài sản', '资产总计'],
    total_liabilities: ['Total liabilities', 'Tổng nợ phải trả', '负债合计'],
    interest_bearing_debt: ['Interest-bearing debt', 'Nợ vay chịu lãi', '有息债务'],
    operating_profit: [
      'Operating profit per statement',
      'Lợi nhuận hoạt động theo BCTC',
      '报表营业利润',
    ],
    depreciation_amortization: [
      'Depreciation and amortization',
      'Khấu hao và phân bổ',
      '折旧与摊销',
    ],
    interest_expense: ['Interest expense', 'Chi phí lãi vay', '利息费用'],
    net_revenue: ['Net revenue', 'Doanh thu thuần', '净营业收入'],
    cash_from_operations: [
      'Cash flow from operations',
      'Lưu chuyển tiền từ hoạt động kinh doanh',
      '经营活动现金流量',
    ],
  },
  metric: {
    'AIC-M01': ['Current ratio', 'Hệ số thanh toán hiện hành', '流动比率'],
    'AIC-M02': ['Quick ratio', 'Hệ số thanh toán nhanh', '速动比率'],
    'AIC-M03': ['Equity to total assets', 'Vốn chủ sở hữu trên tổng tài sản', '权益资产比率'],
    'AIC-M04': [
      'Interest-bearing debt to EBITDA',
      'Nợ vay chịu lãi trên EBITDA',
      '有息债务与EBITDA之比',
    ],
    'AIC-M05': [
      'Operating profit to interest expense',
      'Lợi nhuận hoạt động trên chi phí lãi vay',
      '营业利润与利息费用之比',
    ],
    'AIC-M06': ['Operating profit margin', 'Biên lợi nhuận hoạt động', '营业利润率'],
    'AIC-M07': [
      'Operating cash flow to net revenue',
      'Lưu chuyển tiền kinh doanh trên doanh thu thuần',
      '经营现金流与净营业收入之比',
    ],
  },
  group: {
    liquidity: ['Liquidity', 'Thanh khoản', '流动性'],
    capital: ['Capital', 'Vốn', '资本'],
    leverage: ['Leverage', 'Đòn bẩy', '杠杆'],
    profitability: ['Profitability', 'Khả năng sinh lời', '盈利能力'],
  },
  status: {
    available: ['Calculation available', 'Có kết quả tính toán', '计算结果可用'],
    unavailable: ['Cannot calculate', 'Chưa thể tính', '无法计算'],
  },
  verification: {
    unverified: ['Unverified', 'Chưa xác minh', '未核实'],
    verified: ['Verified against source', 'Đã xác minh theo nguồn', '已对照来源核实'],
    rejected: ['Rejected', 'Bị từ chối', '已拒绝'],
    stale: ['Verification needs renewal', 'Cần xác minh lại', '需重新核实'],
  },
  period: {
    FY: ['Financial year', 'Năm tài chính', '财政年度'],
    TTM: ['Trailing twelve months', 'Mười hai tháng gần nhất', '过去十二个月'],
    INTERIM: ['Interim period', 'Kỳ giữa niên độ', '中期'],
  },
  basis: {
    standalone: ['Standalone', 'Riêng lẻ', '单体'],
    consolidated: ['Consolidated', 'Hợp nhất', '合并'],
  },
  regime: {
    VN_TT200: [
      'Vietnamese accounting regime — Circular 200',
      'Chế độ kế toán Việt Nam — Thông tư 200',
      '越南会计制度：第200号通函',
    ],
    US_GAAP: [
      'US Generally Accepted Accounting Principles',
      'Chuẩn mực kế toán Mỹ (US GAAP)',
      '美国公认会计准则',
    ],
    CN_ASBE: [
      'Chinese Accounting Standards for Business Enterprises',
      'Chuẩn mực kế toán doanh nghiệp Trung Quốc',
      '中国企业会计准则',
    ],
    VN_TT133: [
      'Vietnamese accounting regime — Circular 133',
      'Chế độ kế toán Việt Nam — Thông tư 133',
      '越南会计制度：第133号通函',
    ],
    VN_TT99: [
      'Vietnamese accounting regime — Circular 99',
      'Chế độ kế toán Việt Nam — Thông tư 99',
      '越南会计制度：第99号通函',
    ],
    VN_TT58: [
      'Vietnamese accounting regime — Circular 58',
      'Chế độ kế toán Việt Nam — Thông tư 58',
      '越南会计制度：第58号通函',
    ],
    IFRS: [
      'International Financial Reporting Standards (IFRS)',
      'Chuẩn mực báo cáo tài chính quốc tế (IFRS)',
      '国际财务报告准则（IFRS）',
    ],
    OTHER: ['Other accounting regime', 'Chế độ kế toán khác', '其他会计制度'],
    UNKNOWN: ['Accounting regime unknown', 'Chưa rõ chế độ kế toán', '会计制度未知'],
  },
  scope: {
    DISTRIBUTION_WHOLESALE_PILOT: [
      'Distribution and wholesale pilot scope',
      'Phạm vi thí điểm phân phối và bán buôn',
      '分销与批发试点范围',
    ],
    MANUFACTURING: ['Manufacturing', 'Sản xuất', '制造业'],
    RETAIL: ['Retail', 'Bán lẻ', '零售业'],
    BUSINESS_SERVICES: ['Business services', 'Dịch vụ doanh nghiệp', '企业服务'],
    CONSUMER_DURABLES: ['Consumer durables', 'Hàng tiêu dùng lâu bền', '耐用消费品'],
    OTHER: ['Other industry', 'Ngành khác', '其他行业'],
    UNKNOWN: ['Industry scope unknown', 'Chưa rõ phạm vi ngành', '行业范围未知'],
  },
  observation: {
    actual: ['Actual', 'Thực tế', '实际'],
    forecast: ['Forecast', 'Dự báo', '预测'],
  },
  audit: {
    audited: ['Audited', 'Đã kiểm toán', '已审计'],
    unaudited: ['Unaudited', 'Chưa kiểm toán', '未经审计'],
    unknown: ['Audit status unknown', 'Chưa rõ tình trạng kiểm toán', '审计状态未知'],
  },
  blocker: {
    OPERATING_PROFIT_BRIDGE_UNAVAILABLE: [
      'A complete CAS operating-profit reconciliation needs source review.',
      'Cần bảng điều chỉnh lợi nhuận hoạt động theo CAS có chứng cứ đầy đủ.',
      '需要具有完整来源依据的中国准则经营利润调节表。',
    ],
    FHI_METHOD_UNCONFIGURED: [
      'Financial health method is not configured',
      'Phương pháp sức khỏe tài chính chưa được cấu hình',
      '财务健康方法尚未配置',
    ],
    ACTUAL_KNOWN_ACCOUNTING_BASIS_REQUIRED: [
      'Actual figures and a known accounting regime are required',
      'Cần số liệu thực tế và chế độ kế toán đã xác định',
      '需要实际数据和已知会计制度',
    ],
    EXPLICIT_STATEMENT_SET_SELECTION_REQUIRED: [
      'Select a statement set explicitly',
      'Cần chọn rõ một bộ báo cáo tài chính',
      '请明确选择一套财务报表',
    ],
    FINANCIAL_INPUTS_REQUIRED: [
      'Financial inputs are required',
      'Cần dữ kiện tài chính',
      '需要财务输入',
    ],
    INVALID_INPUT: ['Financial input is invalid', 'Dữ kiện tài chính không hợp lệ', '财务输入无效'],
    INVALID_SCOPE: ['Financial scope is invalid', 'Phạm vi tài chính không hợp lệ', '财务范围无效'],
    OUT_OF_PILOT_SCOPE: ['Outside the pilot scope', 'Ngoài phạm vi thí điểm', '超出试点范围'],
    COUNTRY_METHOD_NOT_VALIDATED: [
      'The credit method has not been validated for this country; review verified ratios and observations.',
      'Phương pháp điểm tín dụng chưa được kiểm định cho quốc gia này; hãy xem tỷ số và dấu hiệu từ số liệu đã xác minh.',
      '信用评分方法尚未针对该国家验证，请查看已核实数据的比率与事实。',
    ],
    UNSUPPORTED_FACT_KEY: [
      'Financial fact is not supported',
      'Dữ kiện tài chính chưa được hỗ trợ',
      '不支持该财务事实',
    ],
    MISSING_FACT: [
      'A required financial fact is missing',
      'Thiếu dữ kiện tài chính bắt buộc',
      '缺少必需财务事实',
    ],
    DUPLICATE_FACT: [
      'A financial fact is duplicated',
      'Dữ kiện tài chính bị trùng',
      '财务事实重复',
    ],
    INVALID_FACT: ['A financial fact is invalid', 'Dữ kiện tài chính không hợp lệ', '财务事实无效'],
    UNVERIFIED_FACT: [
      'A financial fact does not meet current verification requirements',
      'Dữ kiện tài chính chưa đáp ứng yêu cầu xác minh hiện hành',
      '财务事实不符合当前核实要求',
    ],
    STALE_FACT: [
      'A financial fact needs verification again',
      'Dữ kiện tài chính cần xác minh lại',
      '财务事实需重新核实',
    ],
    SOURCE_UNAVAILABLE: [
      'Required source references are missing or invalid',
      'Tham chiếu nguồn bắt buộc bị thiếu hoặc không hợp lệ',
      '必需来源引用缺失或无效',
    ],
    STATEMENT_SET_MISMATCH: [
      'Statement sets do not match',
      'Không khớp bộ báo cáo tài chính',
      '报表集不匹配',
    ],
    SCOPE_MISMATCH: [
      'Financial scopes do not match',
      'Không khớp phạm vi tài chính',
      '财务范围不匹配',
    ],
    PERIOD_MISMATCH: ['Reporting periods do not match', 'Không khớp kỳ báo cáo', '报告期间不匹配'],
    BASIS_MISMATCH: ['Statement bases do not match', 'Không khớp cơ sở báo cáo', '报表口径不匹配'],
    ACCOUNTING_REGIME_MISMATCH: [
      'Accounting regimes do not match',
      'Không khớp chế độ kế toán',
      '会计制度不匹配',
    ],
    CURRENCY_MISMATCH: ['Currencies do not match', 'Không khớp tiền tệ', '币种不匹配'],
    UNIT_MISMATCH: ['Units do not match', 'Không khớp đơn vị', '单位不匹配'],
    INVALID_DECIMAL: ['A decimal value is invalid', 'Giá trị thập phân không hợp lệ', '小数值无效'],
    QUICK_ASSETS_UNAVAILABLE: [
      'Verified eligible, non-overlapping quick asset components are required',
      'Cần các thành phần tài sản nhanh đủ điều kiện, không trùng và đã xác minh',
      '需要已核实、符合资格且不重叠的速动资产组成',
    ],
    EBITDA_BRIDGE_UNAVAILABLE: [
      'A verified operating profit and depreciation/amortization add-back bridge is required',
      'Cần xác minh cầu nối lợi nhuận hoạt động và khoản cộng lại khấu hao, phân bổ',
      '需要已核实的营业利润与折旧摊销加回关系',
    ],
    EBITDA_NON_POSITIVE: [
      'EBITDA is zero or negative',
      'EBITDA bằng không hoặc âm',
      'EBITDA为零或负数',
    ],
    ZERO_DENOMINATOR: ['The ratio denominator is zero', 'Mẫu số tỷ số bằng không', '比率分母为零'],
    ZERO_INTEREST_REQUIRES_VERIFIED_ZERO_DEBT: [
      'Zero interest expense requires verified zero interest-bearing debt',
      'Chi phí lãi vay bằng không cần nợ vay chịu lãi bằng không đã xác minh',
      '零利息费用需要已核实的零有息债务',
    ],
    INVALID_FINANCIAL_BOUNDS: [
      'Financial values violate the supported bounds',
      'Giá trị tài chính ngoài giới hạn được hỗ trợ',
      '财务数值超出支持范围',
    ],
    BALANCE_SHEET_UNRECONCILED: [
      'The balance sheet does not reconcile exactly',
      'Bảng cân đối kế toán chưa khớp chính xác',
      '资产负债表未精确勾稽一致',
    ],
  },
  limitation: {
    'AIC experimental method is not approved; no score or band is published.': [
      'AIC experimental method is not approved; no score or band is published.',
      'Phương pháp thử nghiệm AIC chưa được phê duyệt; không công bố điểm hoặc phân hạng.',
      'AIC实验方法尚未获批，不发布分数或分档。',
    ],
    'Verified entry/source fidelity does not confirm legal identity.': [
      'Verified entry/source fidelity does not confirm legal identity.',
      'Xác minh dữ kiện khớp nguồn không xác nhận danh tính pháp lý.',
      '核实录入或来源一致性不等于确认法律身份。',
    ],
    'No FX, annualization, profit proxy or weight redistribution.': [
      'No FX, annualization, profit proxy or weight redistribution.',
      'Không đổi tiền tệ, quy năm, thay thế chỉ tiêu lợi nhuận hoặc phân bổ lại trọng số.',
      '不换汇、不年化、不替代利润指标、不重新分配权重。',
    ],
    'Balance sheet tolerance awaits approval; only exact reconciliation is accepted by this implementation.':
      [
        'Balance sheet tolerance awaits approval; only exact reconciliation is accepted by this implementation.',
        'Ngưỡng sai lệch bảng cân đối chờ phê duyệt; hiện chỉ chấp nhận đối chiếu khớp chính xác.',
        '资产负债表容差待批准，当前实现仅接受精确勾稽一致。',
      ],
  },
}

const unknown: Record<Kind, Text> = {
  fact: ['Financial fact', 'Dữ kiện tài chính', '财务事实'],
  metric: ['Financial ratio', 'Tỷ số tài chính', '财务比率'],
  group: ['Financial group', 'Nhóm tài chính', '财务分组'],
  status: ['Ratio status unavailable', 'Chưa rõ trạng thái tỷ số', '比率状态未知'],
  verification: ['Verification status unknown', 'Chưa rõ trạng thái xác minh', '核实状态未知'],
  period: ['Reporting period', 'Kỳ báo cáo', '报告期间'],
  basis: ['Statement basis unknown', 'Chưa rõ cơ sở báo cáo', '报表口径未知'],
  regime: ['Accounting regime unknown', 'Chưa rõ chế độ kế toán', '会计制度未知'],
  scope: ['Industry scope unknown', 'Chưa rõ phạm vi ngành', '行业范围未知'],
  observation: ['Observation type unknown', 'Chưa rõ loại số liệu', '数据类型未知'],
  audit: ['Audit status unknown', 'Chưa rõ tình trạng kiểm toán', '审计状态未知'],
  blocker: [
    'A financial requirement needs attention',
    'Cần rà soát điều kiện tài chính',
    '有财务条件需要处理',
  ],
  limitation: [
    'A financial limitation applies',
    'Có giới hạn về dữ liệu tài chính',
    '存在财务限制',
  ],
}

export function financialLabel(locale: Locale, kind: Kind, raw: string) {
  const known = Object.prototype.hasOwnProperty.call(labels[kind], raw)
  const text = known ? labels[kind][raw] : unknown[kind]
  return { label: text[locale === 'en' ? 0 : locale === 'vi' ? 1 : 2], raw, known }
}

const metricHelp: Record<string, Text> = {
  'AIC-M01': [
    'Current assets divided by current liabilities: resources available for short-term obligations.',
    'Tài sản ngắn hạn chia nợ ngắn hạn: nguồn lực để đáp ứng nghĩa vụ ngắn hạn.',
    '流动资产除以流动负债，反映应对短期债务的资源。',
  ],
  'AIC-M02': [
    'Eligible cash, equivalents and trade receivables divided by current liabilities; components must not overlap.',
    'Tiền, tương đương tiền đủ điều kiện và phải thu khách hàng chia nợ ngắn hạn; các thành phần không được trùng.',
    '符合条件的现金、等价物和应收账款除以流动负债，各项不得重复。',
  ],
  'AIC-M03': [
    'Equity divided by total assets: the share of assets financed by owners.',
    'Vốn chủ sở hữu chia tổng tài sản: tỷ trọng tài sản được tài trợ bằng vốn của chủ sở hữu.',
    '所有者权益除以总资产，反映由所有者资金支持的资产比例。',
  ],
  'AIC-M04': [
    'Interest-bearing debt divided by EBITDA. EBITDA is operating profit (EBIT) plus sourced depreciation and amortization; it must be positive.',
    'Nợ vay chịu lãi chia EBITDA. EBITDA là lợi nhuận hoạt động (EBIT) cộng khấu hao, phân bổ có căn cứ và phải lớn hơn 0.',
    '有息债务除以 EBITDA。EBITDA 为营业利润（EBIT）加有来源的折旧摊销，必须大于零。',
  ],
  'AIC-M05': [
    'Operating profit (EBIT) divided by interest expense: coverage of interest costs. A verified zero-debt exception is shown separately.',
    'Lợi nhuận hoạt động (EBIT) chia chi phí lãi vay: khả năng trang trải lãi. Ngoại lệ không nợ vay đã xác minh được ghi riêng.',
    '营业利润（EBIT）除以利息费用，反映利息覆盖能力。经核实的零债务例外单独标记。',
  ],
  'AIC-M06': [
    'Operating profit (EBIT) divided by net revenue: profit generated from operations per unit of revenue.',
    'Lợi nhuận hoạt động (EBIT) chia doanh thu thuần: lợi nhuận hoạt động trên mỗi đồng doanh thu.',
    '营业利润（EBIT）除以净营业收入，反映每单位收入的营业利润。',
  ],
  'AIC-M07': [
    'Operating cash flow divided by net revenue: cash generated by business operations per unit of revenue.',
    'Dòng tiền từ kinh doanh chia doanh thu thuần: tiền tạo ra từ hoạt động trên mỗi đồng doanh thu.',
    '经营现金流除以净营业收入，反映每单位收入产生的经营现金。',
  ],
}
export function metricExplanation(locale: Locale, id: string) {
  const text = metricHelp[id]
  return text
    ? text[locale === 'en' ? 0 : locale === 'vi' ? 1 : 2]
    : financialLabel(locale, 'metric', id).label
}
