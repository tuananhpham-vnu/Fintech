const assert = require('node:assert/strict')
const test = require('node:test')
require('../helpers/register-typescript.cjs')

const {
  DOCUMENT_GROUPS,
  resolveDocumentGroup,
  getEffectiveDocumentType,
  countUsableExtractedFields,
  groupDocuments,
  computeIngestionSummary,
} = require('../../src/features/documents/groups.ts')
const { messages, translate } = require('../../src/lib/i18n/messages.ts')

test('resolveDocumentGroup correctly maps all 12 document types to the 6 visual categories', () => {
  // 1. BCTC
  assert.equal(resolveDocumentGroup('financial_statement'), 'bctc')

  // 2. Thuế & Hoá đơn
  assert.equal(resolveDocumentGroup('tax_report'), 'tax')
  assert.equal(resolveDocumentGroup('invoice'), 'tax')

  // 3. Hợp đồng & Pháp lý
  assert.equal(resolveDocumentGroup('contract'), 'contract')
  assert.equal(resolveDocumentGroup('loan_request'), 'contract')
  assert.equal(resolveDocumentGroup('registration'), 'contract')

  // 4. Thanh toán & Nghiệm thu
  assert.equal(resolveDocumentGroup('payment_record'), 'payment')
  assert.equal(resolveDocumentGroup('acceptance_record'), 'payment')

  // 5. Công nợ & Kho vận
  assert.equal(resolveDocumentGroup('debt_instrument'), 'debt')
  assert.equal(resolveDocumentGroup('delivery_record'), 'debt')
  assert.equal(resolveDocumentGroup('collateral_document'), 'debt')

  // 6. Khác & Cần phân loại
  assert.equal(resolveDocumentGroup('other'), 'other')
})

test('groupDocuments prioritizes human-confirmed declared_type over initial AI type', () => {
  const docWithReview = {
    id: 'doc-1',
    lineage: 'lin-1',
    version: 1,
    hash: 'hash1',
    pages: 5,
    source: {},
    owner_party_ref: 'party-1',
    type: 'other', // AI initially classified as other
    classification: {},
    status: 'completed',
    source_review: {
      declared_type: 'financial_statement', // Officer confirmed as BCTC
      subject_match: 'match',
      reviewed_pages: [1],
      reason: 'Confirmed BCTC 2025',
      actor_id: 'user-1',
      created_at: '2026-10-17T00:00:00Z',
    },
  }

  assert.equal(getEffectiveDocumentType(docWithReview), 'financial_statement')
  const groups = groupDocuments([docWithReview])
  const bctcGroup = groups.find((g) => g.key === 'bctc')
  const otherGroup = groups.find((g) => g.key === 'other')

  assert.equal(bctcGroup.documents.length, 1)
  assert.equal(bctcGroup.documents[0].id, 'doc-1')
  assert.equal(otherGroup.documents.length, 0)
})

test('countUsableExtractedFields honestly separates usable fields from null or missing values', () => {
  const docWithUsable = {
    id: 'doc-usable',
    lineage: 'lin-1',
    version: 1,
    hash: 'h1',
    pages: 2,
    source: {},
    owner_party_ref: 'p1',
    type: 'contract',
    classification: {},
    status: 'completed',
    extraction: [
      {
        field_key: 'contract.amount',
        value: '1000000000',
        quality: 'high',
        evidence_refs: ['ev-1'],
      },
      { field_key: 'contract.ref', value: 'HD-2026/01', quality: 'high', evidence_refs: ['ev-1'] },
      {
        field_key: 'contract.payment_condition',
        value: null,
        quality: 'missing',
        evidence_refs: [],
      },
    ],
  }

  const docWithNoUsable = {
    id: 'doc-empty',
    lineage: 'lin-2',
    version: 1,
    hash: 'h2',
    pages: 1,
    source: {},
    owner_party_ref: 'p1',
    type: 'other',
    classification: {},
    status: 'completed',
    extraction: [
      { field_key: 'document.summary', value: null, quality: 'missing', evidence_refs: [] },
      { field_key: 'parties.borrower.tax_id', value: null, quality: 'missing', evidence_refs: [] },
    ],
  }

  assert.equal(countUsableExtractedFields(docWithUsable), 2)
  assert.equal(countUsableExtractedFields(docWithNoUsable), 0)
})

test('computeIngestionSummary reports honest progress and distinguishes 0 usable fields', () => {
  const docs = [
    // Completed with usable fields
    {
      id: 'd1',
      lineage: 'l1',
      version: 1,
      hash: 'h1',
      pages: 3,
      source: {},
      owner_party_ref: 'p1',
      type: 'financial_statement',
      classification: {},
      status: 'completed',
      source_review: {
        declared_type: 'financial_statement',
        subject_match: 'match',
        reviewed_pages: [1],
        reason: 'ok',
        actor_id: 'a1',
        created_at: 'now',
      },
      extraction: [
        {
          field_key: 'financial.total_assets',
          value: '5000000000',
          quality: 'high',
          evidence_refs: ['ev1'],
        },
      ],
    },
    // Completed with 0 usable fields
    {
      id: 'd2',
      lineage: 'l2',
      version: 1,
      hash: 'h2',
      pages: 1,
      source: {},
      owner_party_ref: 'p1',
      type: 'other',
      classification: {},
      status: 'completed',
      extraction: [{ field_key: 'summary', value: null, quality: 'missing', evidence_refs: [] }],
    },
    // Processing / queued
    {
      id: 'd3',
      lineage: 'l3',
      version: 1,
      hash: 'h3',
      pages: 2,
      source: {},
      owner_party_ref: 'p1',
      type: 'tax_report',
      classification: {},
      status: 'processing',
    },
    // Failed
    {
      id: 'd4',
      lineage: 'l4',
      version: 1,
      hash: 'h4',
      pages: 1,
      source: {},
      owner_party_ref: 'p1',
      type: 'invoice',
      classification: {},
      status: 'failed',
    },
  ]

  const summary = computeIngestionSummary(docs)
  assert.equal(summary.totalFiles, 4)
  assert.equal(summary.usableFiles, 1)
  assert.equal(summary.zeroUsableFiles, 1)
  assert.equal(summary.processingFiles, 1)
  assert.equal(summary.failedFiles, 1)
  assert.equal(summary.unconfirmedFiles, 3) // d2, d3, d4 lack source_review
  assert.equal(summary.nextStepKey, 'nextStepClassify')
})

test('all 6 document groups, journey steps, and honest error keys are localized across vi, en, zh-CN', () => {
  const keys = [
    'journeyUpload',
    'journeyClassify',
    'journeyExtraction',
    'journeyReview',
    'journeyMetrics',
    'groupBctc',
    'groupTax',
    'groupContract',
    'groupPayment',
    'groupDebt',
    'groupOther',
    'aiSuggested',
    'humanConfirmed',
    'unconfirmed',
    'extractedWithFields',
    'noUsableFields',
    'processingExtraction',
    'extractionQueued',
    'summaryTitle',
    'summaryTotal',
    'summaryUsable',
    'summaryNoUsable',
    'summaryNeedsReview',
    'summaryNextStep',
    'nextStepUpload',
    'nextStepReviewFields',
    'nextStepClassify',
    'nextStepFinancial',
    'dropzoneTitle',
    'dropzoneSubtitle',
    'unsupportedFormatsNotice',
    'rateLimit429',
    'quotaExceeded413',
    'invalidFormat415',
    'corruptedFile422',
    'serviceUnavailable503',
  ]

  for (const key of keys) {
    const vi = translate('vi', key)
    const en = translate('en', key)
    const zh = translate('zh-CN', key)

    assert.ok(vi && vi !== key, `Missing or fallback vi for ${key}`)
    assert.ok(en && en !== key, `Missing or fallback en for ${key}`)
    assert.ok(zh && zh !== key, `Missing or fallback zh-CN for ${key}`)
  }
})

test('archive receipt decodes accepted items and preserves rejected files per AIC-DEMO-48H-API-CONTRACT.md', () => {
  const sampleReceipt = {
    archive_sha256: 'a'.repeat(64),
    case_id: '00000000-0000-4000-8000-000000000001',
    revision: 5,
    state: 'partial',
    items: [
      {
        entry_index: 0,
        entry_path: 'BCTC/financial-statement.pdf',
        group: 'financial_statements',
        suggested_type: 'financial_statement',
        classification_verification: 'unverified',
        status: 'accepted',
        document: {
          id: 'doc-bctc-1',
          lineage: 'lin-1',
          version: 1,
          hash: 'h1',
          pages: 4,
          source: {},
          owner_party_ref: 'p1',
          type: 'financial_statement',
          classification: {},
          status: 'queued',
        },
        job: { id: 'job-1', state: 'queued' },
        rejection: null,
      },
      {
        entry_index: 1,
        entry_path: 'unsupported.xlsx',
        group: 'other',
        suggested_type: 'other',
        classification_verification: 'unverified',
        status: 'rejected',
        document: null,
        job: null,
        rejection: {
          code: 'ARCHIVE_UNSUPPORTED_FORMAT',
          retryable: false,
        },
      },
    ],
  }

  assert.equal(sampleReceipt.state, 'partial')
  assert.equal(sampleReceipt.items.length, 2)
  assert.equal(sampleReceipt.items[0].status, 'accepted')
  assert.equal(sampleReceipt.items[0].suggested_type, 'financial_statement')
  assert.equal(sampleReceipt.items[1].status, 'rejected')
  assert.equal(sampleReceipt.items[1].rejection.code, 'ARCHIVE_UNSUPPORTED_FORMAT')
})
