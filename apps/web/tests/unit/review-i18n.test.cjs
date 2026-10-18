const test = require('node:test')
const assert = require('node:assert/strict')
require('../helpers/register-typescript.cjs')

const {
  localizeRuleId,
  localizeCategory,
  localizeSeverity,
  localizeFindingSummary,
  localizeAbsenceBasis,
  localizeLimitation,
  localizeBlocker,
  localizeRequirementKey,
  localizeConditionKind,
  localizeClaimState,
  localizeClaimKind,
} = require('../../src/lib/i18n/review-i18n.ts')
const { messages, translate } = require('../../src/lib/i18n/messages.ts')

test('review-i18n maps all core checklist and policy rule IDs across en, vi, and zh-CN', () => {
  const rules = [
    'counterparty_identity_source',
    'financial_minimum',
    'transaction_contract',
    'delivery_acceptance_source',
    'paid_received_source',
    'refund_guarantee_source',
    'supplementary_tax_invoice',
    'identity_pending',
    'identity_conflict',
  ]

  for (const rule of rules) {
    const vi = localizeRuleId(rule, 'vi')
    const en = localizeRuleId(rule, 'en')
    const zh = localizeRuleId(rule, 'zh-CN')

    assert.ok(vi && vi.length > 0, `Missing vi for rule: ${rule}`)
    assert.ok(en && en.length > 0, `Missing en for rule: ${rule}`)
    assert.ok(zh && zh.length > 0, `Missing zh-CN for rule: ${rule}`)

    // Must not return raw snake_case
    assert.ok(!vi.includes('_'), `Vietnamese rule label has snake_case: ${vi}`)
    assert.ok(!en.includes('_'), `English rule label has snake_case: ${en}`)
    assert.ok(!zh.includes('_'), `Chinese rule label has snake_case: ${zh}`)
  }

  // Exact Vietnamese expectations
  assert.equal(
    localizeRuleId('counterparty_identity_source', 'vi'),
    'Chứng từ xác minh danh tính/pháp nhân đối tác',
  )
  assert.equal(localizeRuleId('financial_minimum', 'vi'), 'Bộ dữ liệu tài chính tối thiểu')
  assert.equal(localizeRuleId('transaction_contract', 'vi'), 'Hợp đồng giao dịch')
  assert.equal(
    localizeRuleId('delivery_acceptance_source', 'vi'),
    'Chứng từ giao hàng / nghiệm thu',
  )
  assert.equal(localizeRuleId('paid_received_source', 'vi'), 'Chứng từ thanh toán / nhận tiền')
  assert.equal(localizeRuleId('refund_guarantee_source', 'vi'), 'Chứng từ hoàn tiền / bảo lãnh')
  assert.equal(localizeRuleId('supplementary_tax_invoice', 'vi'), 'Hóa đơn / báo cáo thuế bổ sung')
})

test('review-i18n handles dynamic rule ID prefixes with document or condition IDs', () => {
  const docId = '55aa4b21-9704-4b49-b4b7-30348359bd43'
  assert.equal(localizeRuleId(`document_unverified:${docId}`, 'vi'), 'Tài liệu chưa qua xác minh')
  assert.equal(localizeRuleId(`document_unverified:${docId}`, 'en'), 'Document unverified')
  assert.equal(localizeRuleId(`document_unverified:${docId}`, 'zh-CN'), '文件尚未人工核实')

  assert.equal(
    localizeRuleId(`extraction_uncertain:${docId}`, 'vi'),
    'Trích xuất còn thiếu hoặc chưa chắc chắn',
  )
  assert.equal(
    localizeRuleId(`document_subject_mismatch:${docId}`, 'vi'),
    'Nguồn không khớp chủ thể hồ sơ',
  )
  assert.equal(
    localizeRuleId(`invoice_not_payment:${docId}`, 'vi'),
    'Hóa đơn không thay thế chứng từ thanh toán',
  )
  assert.equal(
    localizeRuleId('condition_unverified:cond-123', 'vi'),
    'Điều kiện hợp đồng chưa xác minh',
  )
  assert.equal(
    localizeRuleId('claim_unverified:claim-123', 'vi'),
    'Khai báo thanh toán chưa xác minh',
  )
})

test('review-i18n localizes categories and severities across all 3 locales', () => {
  const categories = [
    'missing_document',
    'financial_minimum',
    'identity_uncertainty',
    'source_uncertainty',
    'identity_conflict',
    'transaction_uncertainty',
    'contradiction',
  ]

  for (const cat of categories) {
    const vi = localizeCategory(cat, 'vi')
    const en = localizeCategory(cat, 'en')
    const zh = localizeCategory(cat, 'zh-CN')

    assert.ok(vi && !vi.includes('_'), `Category vi leaked snake_case: ${vi}`)
    assert.ok(en && !en.includes('_'), `Category en leaked snake_case: ${en}`)
    assert.ok(zh && !zh.includes('_'), `Category zh leaked snake_case: ${zh}`)
  }

  assert.equal(localizeCategory('missing_document', 'vi'), 'Thiếu chứng từ')
  assert.equal(localizeCategory('financial_minimum', 'vi'), 'Dữ liệu tài chính tối thiểu')
  assert.equal(localizeCategory('identity_uncertainty', 'vi'), 'Chưa đủ căn cứ xác minh danh tính')
  assert.equal(localizeCategory('source_uncertainty', 'vi'), 'Nguồn tài liệu chưa xác thực')

  assert.equal(localizeSeverity('warning', 'vi'), 'Cảnh báo')
  assert.equal(localizeSeverity('info', 'vi'), 'Thông tin')
  assert.equal(localizeSeverity('blocker', 'vi'), 'Yếu tố chặn')

  assert.equal(localizeSeverity('warning', 'en'), 'Warning')
  assert.equal(localizeSeverity('info', 'en'), 'Information')
  assert.equal(localizeSeverity('blocker', 'en'), 'Blocker')

  assert.equal(localizeSeverity('warning', 'zh-CN'), '警告')
  assert.equal(localizeSeverity('info', 'zh-CN'), '信息')
  assert.equal(localizeSeverity('blocker', 'zh-CN'), '阻碍项')
})

test('review-i18n localizes finding summaries without leaking backend English or raw machine codes', () => {
  // Missing documentary support
  const missingIdentity = {
    rule_id: 'counterparty_identity_source',
    summary: 'Missing documentary support: counterparty_identity_source',
  }
  assert.equal(
    localizeFindingSummary(missingIdentity, 'vi'),
    'Chưa có chứng từ phù hợp để xác minh danh tính đối tác',
  )
  assert.equal(
    localizeFindingSummary(missingIdentity, 'en'),
    'Missing documentary support: Counterparty identity',
  )
  assert.equal(
    localizeFindingSummary(missingIdentity, 'zh-CN'),
    '缺少用于确认交易对手身份的支持文件',
  )

  const missingFin = {
    rule_id: 'financial_minimum',
    summary: 'Missing documentary support: financial_minimum',
  }
  assert.equal(
    localizeFindingSummary(missingFin, 'vi'),
    'Chưa có báo cáo tài chính đáp ứng yêu cầu tối thiểu',
  )

  const missingTax = {
    rule_id: 'supplementary_tax_invoice',
    summary: 'Missing documentary support: supplementary_tax_invoice',
  }
  assert.equal(
    localizeFindingSummary(missingTax, 'vi'),
    'Chưa có hóa đơn hoặc báo cáo thuế bổ sung',
  )

  // Document declared
  const docDeclared = {
    summary: 'Document 55aa4b21-9704-4b49-b4b7-30348359bd43 is declared, not verified.',
  }
  assert.equal(
    localizeFindingSummary(docDeclared, 'vi'),
    'Tài liệu 55aa4b21-9704-4b49-b4b7-30348359bd43 mới ở trạng thái khai báo, chưa qua xác minh chuyên viên.',
  )

  // Document extraction uncertain
  const docUncertain = {
    summary: 'Document 6d8eae40-8648-4b67-a816-cd8f11784397 has missing or uncertain extraction.',
  }
  assert.equal(
    localizeFindingSummary(docUncertain, 'vi'),
    'Tài liệu 6d8eae40-8648-4b67-a816-cd8f11784397 có trường dữ liệu trích xuất còn thiếu hoặc chưa chắc chắn.',
  )

  // Identity unresolved
  const idUnresolved = {
    summary: 'Counterparty identity remains unresolved.',
  }
  assert.equal(
    localizeFindingSummary(idUnresolved, 'vi'),
    'Chưa hoàn tất xác minh danh tính pháp nhân đối tác.',
  )
})

test('review-i18n localizes all standard backend limitations and absence bases', () => {
  const absence =
    'No current document has matching specialist-reviewed scope and a policy-listed supporting type.'
  assert.equal(
    localizeAbsenceBasis(absence, 'vi'),
    'Hiện chưa có tài liệu nào thuộc phạm vi đã được chuyên viên rà soát và đúng loại chứng từ theo chính sách.',
  )
  assert.equal(localizeAbsenceBasis(absence, 'en'), absence)
  assert.equal(
    localizeAbsenceBasis(absence, 'zh-CN'),
    '当前暂无符合专员已复核范围且符合政策所列支持类型的文件。',
  )

  const limitations = [
    'Absence of a document does not establish absence of the underlying fact.',
    'Numeric FHI blocked; document review, supported ratios and Transaction Review remain available independently. Method approval is a separate gate.',
    'limitation only; no automatic score penalty',
    'request source or retain explicit missing limitation; legal-entity conclusion unavailable',
    'A declared registration and AI extraction do not verify the legal entity.',
    'Document classification, identity, dates, amounts and signatures remain subject to human verification.',
    'Unreadable, absent, failed or uncertain extraction is not silently replaced with a confirmed fact.',
    'No verified settlement or outstanding balance is computed.',
    'Human verification remains required.',
    'Document review does not verify facts or approve a transaction.',
    'Wrong subject source cannot satisfy documentary requirements or resolve findings.',
  ]

  for (const l of limitations) {
    const vi = localizeLimitation(l, 'vi')
    assert.notEqual(vi, l, `Limitation was not translated in Vietnamese: "${l}"`)
    const zh = localizeLimitation(l, 'zh-CN')
    assert.notEqual(zh, l, `Limitation was not translated in Chinese: "${l}"`)
    const en = localizeLimitation(l, 'en')
    assert.ok(en.length > 0)
  }
})

test('review-i18n safely handles edge cases, missing parameters, and unknown codes', () => {
  assert.equal(localizeRuleId(null, 'vi'), '')
  assert.equal(localizeRuleId(undefined, 'vi'), '')
  assert.equal(localizeRuleId('unknown_custom_rule', 'vi'), 'unknown_custom_rule')

  assert.equal(localizeCategory(null, 'vi'), '')
  assert.equal(localizeCategory(undefined, 'vi'), '')
  assert.equal(localizeCategory('unknown_category', 'vi'), 'unknown_category')

  assert.equal(localizeSeverity(null, 'vi'), '')
  assert.equal(localizeFindingSummary(null, 'vi'), '')
  assert.equal(localizeFindingSummary({ summary: '' }, 'vi'), '')
  assert.equal(
    localizeFindingSummary({ summary: '<script>alert(1)</script>' }, 'vi'),
    '<script>alert(1)</script>',
  )

  assert.equal(localizeAbsenceBasis(null, 'vi'), undefined)
  assert.equal(localizeLimitation(null, 'vi'), '')
  assert.equal(localizeBlocker(null, 'vi'), '')
})

test('regression check matching the exact user screenshot findings in Vietnamese', () => {
  // Simulates the exact payload from the user's report
  const findingsFromScreenshot = [
    {
      rule_id: 'counterparty_identity_source',
      category: 'missing_document',
      severity: 'warning',
      summary: 'Missing documentary support: counterparty_identity_source',
      absence_basis:
        'No current document has matching specialist-reviewed scope and a policy-listed supporting type.',
      limitations: [
        'request source or retain explicit missing limitation; legal-entity conclusion unavailable',
        'Absence of a document does not establish absence of the underlying fact.',
      ],
    },
    {
      rule_id: 'financial_minimum',
      category: 'financial_minimum',
      severity: 'info',
      summary: 'Missing documentary support: financial_minimum',
      absence_basis:
        'No current document has matching specialist-reviewed scope and a policy-listed supporting type.',
      limitations: [
        'Numeric FHI blocked; document review, supported ratios and Transaction Review remain available independently. Method approval is a separate gate.',
        'Absence of a document does not establish absence of the underlying fact.',
      ],
    },
    {
      rule_id: 'supplementary_tax_invoice',
      category: 'missing_document',
      severity: 'info',
      summary: 'Missing documentary support: supplementary_tax_invoice',
      absence_basis:
        'No current document has matching specialist-reviewed scope and a policy-listed supporting type.',
      limitations: [
        'limitation only; no automatic score penalty',
        'Absence of a document does not establish absence of the underlying fact.',
      ],
    },
    {
      rule_id: 'identity_pending',
      category: 'identity_uncertainty',
      severity: 'warning',
      summary: 'Counterparty identity remains unresolved.',
      limitations: ['A declared registration and AI extraction do not verify the legal entity.'],
    },
    {
      rule_id: 'document_unverified:55aa4b21-9704-4b49-b4b7-30348359bd43',
      category: 'source_uncertainty',
      severity: 'info',
      summary: 'Document 55aa4b21-9704-4b49-b4b7-30348359bd43 is declared, not verified.',
      limitations: [
        'Document classification, identity, dates, amounts and signatures remain subject to human verification.',
      ],
    },
    {
      rule_id: 'extraction_uncertain:6d8eae40-8648-4b67-a816-cd8f11784397',
      category: 'source_uncertainty',
      severity: 'warning',
      summary: 'Document 6d8eae40-8648-4b67-a816-cd8f11784397 has missing or uncertain extraction.',
      limitations: [
        'Unreadable, absent, failed or uncertain extraction is not silently replaced with a confirmed fact.',
      ],
    },
  ]

  for (const f of findingsFromScreenshot) {
    const ruleLabel = localizeRuleId(f.rule_id, 'vi')
    const catLabel = localizeCategory(f.category, 'vi')
    const sevLabel = localizeSeverity(f.severity, 'vi')
    const summary = localizeFindingSummary(f, 'vi')
    const absence = localizeAbsenceBasis(f.absence_basis, 'vi')
    const limitations = f.limitations.map((l) => localizeLimitation(l, 'vi'))

    // 1. No raw snake_case or technical keywords in Vietnamese UI view
    assert.ok(!ruleLabel.includes('_'), `ruleLabel has _: ${ruleLabel}`)
    assert.ok(!catLabel.includes('_'), `catLabel has _: ${catLabel}`)
    assert.notEqual(sevLabel, 'warning')
    assert.notEqual(sevLabel, 'info')
    assert.notEqual(sevLabel, 'blocker')

    // 2. Summary does not retain raw English sentence
    assert.ok(
      !summary.startsWith('Missing documentary support:'),
      `Summary starts with English: ${summary}`,
    )
    assert.ok(!summary.includes('remains unresolved'), `Summary has English unresolved: ${summary}`)
    assert.ok(
      !summary.includes('is declared, not verified'),
      `Summary has English unverified: ${summary}`,
    )
    assert.ok(
      !summary.includes('has missing or uncertain extraction'),
      `Summary has English uncertain: ${summary}`,
    )

    // 3. Absence basis does not retain English sentence
    if (absence) {
      assert.ok(
        !absence.startsWith('No current document'),
        `Absence basis is in English: ${absence}`,
      )
    }

    // 4. Limitations do not retain English sentences
    for (const l of limitations) {
      assert.ok(!l.startsWith('Absence of a document'), `Limitation is in English: ${l}`)
      assert.ok(!l.startsWith('Numeric FHI blocked'), `Limitation is in English: ${l}`)
      assert.ok(!l.startsWith('limitation only'), `Limitation is in English: ${l}`)
      assert.ok(!l.startsWith('A declared registration'), `Limitation is in English: ${l}`)
      assert.ok(!l.startsWith('Document classification'), `Limitation is in English: ${l}`)
      assert.ok(!l.startsWith('Unreadable, absent'), `Limitation is in English: ${l}`)
    }
  }
})
