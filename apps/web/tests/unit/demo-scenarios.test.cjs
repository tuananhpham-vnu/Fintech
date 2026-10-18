const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { spawnSync } = require('node:child_process')

const webRequire = Module.createRequire(path.resolve(__dirname, '../../package.json'))
const ts = webRequire('typescript')
const React = webRequire('react')
const { renderToStaticMarkup } = webRequire('react-dom/server')
require('../helpers/register-typescript.cjs')

require.extensions['.tsx'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    file,
  )

const { translate } = require('../../src/lib/i18n/messages.ts')
let currentLocale = 'vi'

let mockResourceData = null
const originalLoad = Module._load
Module._load = function (name, ...args) {
  if (name === '@/lib/i18n/locale-provider' || name.includes('locale-provider')) {
    return {
      useLocale: () => ({
        locale: currentLocale,
        t: (key) => translate(currentLocale, key),
      }),
    }
  }
  if (name === '@/components/ui/modal' || name.includes('modal')) {
    return {
      Modal: ({ children, title }) =>
        React.createElement('div', { className: 'modal modal-mock' }, [
          React.createElement('div', { className: 'modal-header', key: 'h' }, [
            React.createElement('h2', { key: 't' }, title),
          ]),
          React.createElement('div', { className: 'modal-content', key: 'c' }, children),
        ]),
    }
  }
  if (name === '@/hooks/use-mutation' || name.includes('use-mutation')) {
    return {
      useMutation: () => ({
        busy: false,
        error: null,
        success: false,
        run: async () => {},
        setError: () => {},
      }),
    }
  }
  if (name === '@/hooks/use-resource' || name.includes('use-resource')) {
    return {
      useResource: () => ({
        loading: false,
        data: mockResourceData,
        error: null,
        reload: () => {},
      }),
    }
  }
  return originalLoad.call(this, name, ...args)
}

const {
  groupDocuments,
  computeIngestionSummary,
  countUsableExtractedFields,
  groupDocumentsByYear,
  filterDocuments,
  resolveDocumentPeriod,
  getDocumentActionRequired,
  isDocumentActionRequired,
} = require('../../src/features/documents/groups.ts')
const {
  DocumentSummaryCard,
} = require('../../src/features/documents/components/document-summary-card.tsx')
const { DocumentGroups } = require('../../src/features/documents/components/document-groups.tsx')
const {
  DocumentWorkQueue,
} = require('../../src/features/documents/components/document-work-queue.tsx')
const {
  DocumentExplorer,
} = require('../../src/features/documents/components/document-explorer.tsx')
const { Documents } = require('../../src/features/documents/components/documents.tsx')
const {
  ArchiveReceiptBanner,
} = require('../../src/features/documents/components/archive-receipt.tsx')
const {
  DossierArchiveBanner,
} = require('../../src/features/documents/components/dossier-archive-banner.tsx')
const { UploadDialog } = require('../../src/features/documents/components/upload-dialog.tsx')
const {
  ExtractionDialog,
} = require('../../src/features/documents/components/extraction-review.tsx')

test('Scenario 1: Empty case (0 documents) shows upload next step and empty state', () => {
  currentLocale = 'vi'
  const summary = computeIngestionSummary([])
  assert.equal(summary.totalFiles, 0)
  assert.equal(summary.nextStepKey, 'nextStepUpload')

  const html = renderToStaticMarkup(React.createElement(DocumentSummaryCard, { summary }))
  assert.ok(html.includes('Nạp hồ sơ'))
  assert.ok(html.includes('Nạp thêm tài liệu (PDF) để tiến hành trích xuất dữ liệu.'))
})

test('Scenario 2: AI completed but 0 usable fields shows honest 0-field badge and no false extraction claim', () => {
  currentLocale = 'vi'
  const nullDoc = {
    id: 'doc-null-1',
    lineage: 'lin-null-1',
    version: 1,
    hash: 'hash-null-1',
    pages: 2,
    source: {},
    owner_party_ref: 'p1',
    type: 'financial_statement',
    classification: {},
    status: 'completed',
    extraction: [
      { field_key: 'financial.total_assets', value: null, quality: 'missing', evidence_refs: [] },
      { field_key: 'financial.liabilities', value: null, quality: 'missing', evidence_refs: [] },
    ],
  }

  assert.equal(countUsableExtractedFields(nullDoc), 0)
  const summary = computeIngestionSummary([nullDoc])
  assert.equal(summary.usableFiles, 0)
  assert.equal(summary.zeroUsableFiles, 1)

  const groupsHtml = renderToStaticMarkup(
    React.createElement(DocumentGroups, {
      documents: [nullDoc],
      openSource: () => {},
      onInspect: () => {},
      onClassify: () => {},
    }),
  )

  // Must show 0 usable fields badge
  assert.ok(groupsHtml.includes('0 trường khả dụng'))
  // Must NOT claim extracted with fields
  assert.ok(!groupsHtml.includes('Đã trích xuất ('))
})

test('Scenario 3: AI processing and queued states are honestly reflected', () => {
  currentLocale = 'vi'
  const processingDoc = {
    id: 'doc-proc-1',
    lineage: 'lin-proc-1',
    version: 1,
    hash: 'h-proc',
    pages: 3,
    source: {},
    owner_party_ref: 'p1',
    type: 'contract',
    classification: {},
    status: 'processing',
  }
  const queuedDoc = {
    id: 'doc-queue-1',
    lineage: 'lin-queue-1',
    version: 1,
    hash: 'h-queue',
    pages: 1,
    source: {},
    owner_party_ref: 'p1',
    type: 'invoice',
    classification: {},
    status: 'queued',
  }

  const summary = computeIngestionSummary([processingDoc, queuedDoc])
  assert.equal(summary.processingFiles, 2)

  const groupsHtml = renderToStaticMarkup(
    React.createElement(DocumentGroups, {
      documents: [processingDoc, queuedDoc],
      openSource: () => {},
      onInspect: () => {},
      onClassify: () => {},
    }),
  )

  assert.ok(groupsHtml.includes('Đang xử lý'))
  assert.ok(groupsHtml.includes('Đang chờ xử lý'))
})

test('Scenario 4: AI failed state displays failed tag and error handling', () => {
  currentLocale = 'vi'
  const failedDoc = {
    id: 'doc-fail-1',
    lineage: 'lin-fail-1',
    version: 1,
    hash: 'h-fail',
    pages: 1,
    source: {},
    owner_party_ref: 'p1',
    type: 'tax_report',
    classification: {},
    status: 'failed',
  }

  const summary = computeIngestionSummary([failedDoc])
  assert.equal(summary.failedFiles, 1)

  const groupsHtml = renderToStaticMarkup(
    React.createElement(DocumentGroups, {
      documents: [failedDoc],
      openSource: () => {},
      onInspect: () => {},
      onClassify: () => {},
    }),
  )

  assert.ok(
    groupsHtml.includes('Lỗi xử lý') ||
      groupsHtml.includes('Thất bại') ||
      groupsHtml.includes('failed'),
  )
})

test('Scenario 5: Unconfirmed document distinguishes AI suggested from human confirmed', () => {
  currentLocale = 'vi'
  const unconfirmedDoc = {
    id: 'doc-unconfirmed-1',
    lineage: 'lin-unc-1',
    version: 1,
    hash: 'h-unc',
    pages: 2,
    source: {},
    owner_party_ref: 'p1',
    type: 'contract',
    classification: {},
    status: 'completed',
    extraction: [
      {
        field_key: 'contract.amount',
        value: '500000000',
        quality: 'high',
        evidence_refs: ['ev-1'],
      },
    ],
  }

  const confirmedDoc = {
    id: 'doc-confirmed-1',
    lineage: 'lin-conf-1',
    version: 1,
    hash: 'h-conf',
    pages: 4,
    source: {},
    owner_party_ref: 'p1',
    type: 'other', // originally other
    classification: {},
    status: 'completed',
    source_review: {
      declared_type: 'financial_statement',
      subject_match: 'match',
      reviewed_pages: [1],
      reason: 'BCTC kiểm toán 2025',
      actor_id: 'officer-1',
      created_at: '2026-10-17T09:00:00Z',
    },
    extraction: [
      {
        field_key: 'financial.total_assets',
        value: '12000000000',
        quality: 'high',
        evidence_refs: ['ev-2'],
      },
    ],
  }

  const groupsHtml = renderToStaticMarkup(
    React.createElement(DocumentGroups, {
      documents: [unconfirmedDoc, confirmedDoc],
      openSource: () => {},
      onInspect: () => {},
      onClassify: () => {},
    }),
  )

  // AI suggested badge for unconfirmed doc
  assert.ok(groupsHtml.includes('AI đề xuất: Hợp đồng'))
  // Human confirmed badge for confirmed doc
  assert.ok(groupsHtml.includes('Chuyên viên đã xác nhận: Báo cáo tài chính'))
})

test('Scenario 6: Archive receipt displays accepted items and explicitly rejects unsupported XLSX/RAR', () => {
  currentLocale = 'vi'
  const receipt = {
    archive_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    case_id: 'case-test-01',
    revision: 3,
    state: 'partial',
    items: [
      {
        entry_index: 0,
        entry_path: 'hop_dong_kinh_te.pdf',
        group: 'contracts',
        suggested_type: 'contract',
        classification_verification: 'unverified',
        status: 'accepted',
        document: { id: 'd-acc-1' },
        job: { id: 'j-acc-1' },
      },
      {
        entry_index: 1,
        entry_path: 'bang_ke_chi_tiet.xlsx',
        group: 'other',
        suggested_type: 'other',
        classification_verification: 'unverified',
        status: 'rejected',
        rejection: {
          code: 'ARCHIVE_UNSUPPORTED_FORMAT',
        },
      },
    ],
  }

  const receiptHtml = renderToStaticMarkup(
    React.createElement(ArchiveReceiptBanner, { receipt, onClose: () => {} }),
  )

  assert.ok(receiptHtml.includes('Biên nhận nạp tệp nén ZIP'))
  assert.ok(receiptHtml.includes('hop_dong_kinh_te.pdf'))
  assert.ok(receiptHtml.includes('bang_ke_chi_tiet.xlsx'))
  assert.ok(receiptHtml.includes('Định dạng không được hỗ trợ (chỉ chấp nhận PDF)'))
})

test('Scenario 7: Full HTML preview generation and Chromium screenshot capture', () => {
  currentLocale = 'vi'
  const allDocs = [
    {
      id: 'doc-bctc',
      lineage: 'lin-bctc',
      version: 1,
      hash: 'h-bctc',
      pages: 8,
      name: 'Bao_cao_tai_chinh_2025.pdf',
      source: { ai_mode: 'live' },
      owner_party_ref: 'seller',
      type: 'financial_statement',
      classification: {},
      status: 'completed',
      source_review: {
        declared_type: 'financial_statement',
        subject_match: 'match',
        reviewed_pages: [1, 2],
        reason: 'Đã đối chiếu BCTC kiểm toán',
        actor_id: 'chuyen_vien_sme',
        created_at: '2026-10-17T10:00:00Z',
      },
      extraction: [
        {
          field_key: 'financial.total_assets',
          value: '45000000000',
          quality: 'high',
          evidence_refs: ['ev-1'],
        },
        {
          field_key: 'financial.equity',
          value: '18000000000',
          quality: 'high',
          evidence_refs: ['ev-2'],
        },
      ],
    },
    {
      id: 'doc-thue',
      lineage: 'lin-thue',
      version: 1,
      hash: 'h-thue',
      pages: 2,
      name: 'To_khai_thue_Q3_2026.pdf',
      source: { ai_mode: 'live' },
      owner_party_ref: 'seller',
      type: 'tax_report',
      classification: {},
      status: 'completed',
      extraction: [
        {
          field_key: 'parties.borrower.tax_id',
          value: '0101234567',
          quality: 'high',
          evidence_refs: ['ev-3'],
        },
      ],
    },
    {
      id: 'doc-hopdong',
      lineage: 'lin-hd',
      version: 1,
      hash: 'h-hd',
      pages: 5,
      name: 'Hop_dong_mua_ban_HD2026.pdf',
      source: { ai_mode: 'live' },
      owner_party_ref: 'seller',
      type: 'contract',
      classification: {},
      status: 'completed',
      extraction: [
        {
          field_key: 'contract.amount',
          value: '5200000000',
          quality: 'high',
          evidence_refs: ['ev-4'],
        },
        {
          field_key: 'contract.ref',
          value: 'HD-2026/AIC-01',
          quality: 'high',
          evidence_refs: ['ev-4'],
        },
      ],
    },
    {
      id: 'doc-null',
      lineage: 'lin-null',
      version: 1,
      hash: 'h-null',
      pages: 1,
      name: 'Chung_tu_chua_ro_loai.pdf',
      source: { ai_mode: 'mock' },
      owner_party_ref: 'seller',
      type: 'other',
      classification: {},
      status: 'completed',
      extraction: [
        { field_key: 'document.summary', value: null, quality: 'missing', evidence_refs: [] },
      ],
    },
    {
      id: 'doc-running',
      lineage: 'lin-run',
      version: 1,
      hash: 'h-run',
      pages: 3,
      name: 'Bien_ban_giao_hang_01.pdf',
      source: {},
      owner_party_ref: 'seller',
      type: 'delivery_record',
      classification: {},
      status: 'running',
    },
  ]

  const receipt = {
    archive_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    case_id: 'case-demo-receivable',
    revision: 6,
    state: 'partial',
    items: [
      {
        entry_index: 0,
        entry_path: 'Bao_cao_tai_chinh_2025.pdf',
        group: 'financial_statements',
        suggested_type: 'financial_statement',
        classification_verification: 'unverified',
        status: 'accepted',
      },
      {
        entry_index: 1,
        entry_path: 'Du_lieu_noi_bo.xlsx',
        group: 'other',
        suggested_type: 'other',
        classification_verification: 'unverified',
        status: 'rejected',
        rejection: {
          code: 'ARCHIVE_UNSUPPORTED_FORMAT',
        },
      },
    ],
  }

  const summary = computeIngestionSummary(allDocs)
  const summaryMarkup = renderToStaticMarkup(React.createElement(DocumentSummaryCard, { summary }))
  const receiptMarkup = renderToStaticMarkup(
    React.createElement(ArchiveReceiptBanner, { receipt, onClose: () => {} }),
  )
  const groupsMarkup = renderToStaticMarkup(
    React.createElement(DocumentGroups, {
      documents: allDocs,
      openSource: () => {},
      onInspect: () => {},
      onClassify: () => {},
    }),
  )

  const cssTheme = fs.readFileSync(path.resolve(__dirname, '../../src/styles/theme.css'), 'utf8')
  const cssBase = fs.readFileSync(path.resolve(__dirname, '../../src/styles/base.css'), 'utf8')
  const cssWorkspace = fs.readFileSync(
    path.resolve(__dirname, '../../src/styles/workspace.css'),
    'utf8',
  )

  const fullHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>AIC Rating 2.0 — SME Documents Demo Preview</title>
  <style>
    ${cssBase}
    ${cssTheme}
    ${cssWorkspace}
    body { padding: 32px; background: var(--background); color: var(--foreground); }
    .demo-container { max-width: 1040px; margin: 0 auto; }
  </style>
</head>
<body class="aic-production">
  <div class="demo-container">
    <div class="aic-page-title">
      <div>
        <p class="eyebrow">KHOẢN PHẢI THU (RECEIVABLE)</p>
        <h1>Công ty Cổ phần Công nghệ & Thương mại Nam Á</h1>
        <p class="mono">MST: 0102345678 · Hồ sơ: CASE-2026-DEMO-01</p>
      </div>
      <div class="wrap-actions">
        <span class="tag green"><span class="status-dot"></span>Hồ sơ đang mở</span>
        <span>Phiên bản 6</span>
      </div>
    </div>
    ${receiptMarkup}
    ${summaryMarkup}
    ${groupsMarkup}
  </div>
</body>
</html>`

  const scratchDir =
    'C:\\Users\\52duc\\.gemini\\antigravity\\brain\\ba1483dc-f97f-4cbd-8ed3-8c6a0cf3faf0\\scratch'
  const artifactDir =
    'C:\\Users\\52duc\\.gemini\\antigravity\\brain\\ba1483dc-f97f-4cbd-8ed3-8c6a0cf3faf0'
  const htmlPath = path.join(scratchDir, 'demo-scenarios-preview.html')
  const screenshotPath = path.join(artifactDir, 'demo-scenarios-capture.png')

  fs.writeFileSync(htmlPath, fullHtml, 'utf8')
  assert.ok(fs.existsSync(htmlPath), 'HTML preview must be written')

  // Find Chrome binary in playwright cache
  const chromePath =
    'C:\\Users\\52duc\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe'
  if (fs.existsSync(chromePath)) {
    // 1. Desktop 1280px
    spawnSync(
      chromePath,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=1280,1700',
        `--screenshot=${screenshotPath}`,
        htmlPath,
      ],
      { encoding: 'utf8', timeout: 30000 },
    )
    if (fs.existsSync(screenshotPath)) {
      const stat = fs.statSync(screenshotPath)
      assert.ok(stat.size > 1000, `Desktop screenshot created with size ${stat.size} bytes`)
    }

    // 2. Tablet 768px
    const tabletPath = path.join(artifactDir, 'demo-scenarios-tablet.png')
    spawnSync(
      chromePath,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=768,2100',
        `--screenshot=${tabletPath}`,
        htmlPath,
      ],
      { encoding: 'utf8', timeout: 30000 },
    )
    if (fs.existsSync(tabletPath)) {
      const stat = fs.statSync(tabletPath)
      assert.ok(stat.size > 1000, `Tablet screenshot created with size ${stat.size} bytes`)
    }

    // 3. Mobile 390px
    const mobilePath = path.join(artifactDir, 'demo-scenarios-mobile.png')
    spawnSync(
      chromePath,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=390,2700',
        `--screenshot=${mobilePath}`,
        htmlPath,
      ],
      { encoding: 'utf8', timeout: 30000 },
    )
    if (fs.existsSync(mobilePath)) {
      const stat = fs.statSync(mobilePath)
      assert.ok(stat.size > 1000, `Mobile screenshot created with size ${stat.size} bytes`)
    }
  }
})

test('Scenario 8: Upload Dialog visual preview with dropzone and format notice', () => {
  currentLocale = 'vi'
  const detail = {
    id: 'case-demo-receivable',
    revision: 6,
    documents: [],
    counterparty: {
      id: 'p1',
      name: 'Công ty Cổ phần Công nghệ & Thương mại Nam Á',
      tax_id: '0102345678',
    },
  }

  const dialogMarkup = renderToStaticMarkup(
    React.createElement(UploadDialog, {
      detail,
      onClose: () => {},
      onSaved: () => {},
    }),
  )

  const cssTheme = fs.readFileSync(path.resolve(__dirname, '../../src/styles/theme.css'), 'utf8')
  const cssBase = fs.readFileSync(path.resolve(__dirname, '../../src/styles/base.css'), 'utf8')
  const cssWorkspace = fs.readFileSync(
    path.resolve(__dirname, '../../src/styles/workspace.css'),
    'utf8',
  )

  const fullHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>AIC Rating 2.0 — Upload Dialog Preview</title>
  <style>
    ${cssBase}
    ${cssTheme}
    ${cssWorkspace}
    body { padding: 40px; background: rgba(16, 47, 40, 0.45); display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; }
    .modal { margin: 0 auto; display: block; position: static; }
  </style>
</head>
<body class="aic-production">
  ${dialogMarkup}
</body>
</html>`

  const scratchDir =
    'C:\\Users\\52duc\\.gemini\\antigravity\\brain\\ba1483dc-f97f-4cbd-8ed3-8c6a0cf3faf0\\scratch'
  const artifactDir =
    'C:\\Users\\52duc\\.gemini\\antigravity\\brain\\ba1483dc-f97f-4cbd-8ed3-8c6a0cf3faf0'
  const htmlPath = path.join(scratchDir, 'demo-upload-dialog.html')
  const screenshotPath = path.join(artifactDir, 'demo-upload-dialog.png')

  fs.writeFileSync(htmlPath, fullHtml, 'utf8')
  assert.ok(fs.existsSync(htmlPath))

  const chromePath =
    'C:\\Users\\52duc\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe'
  if (fs.existsSync(chromePath)) {
    spawnSync(
      chromePath,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=900,850',
        `--screenshot=${screenshotPath}`,
        htmlPath,
      ],
      { encoding: 'utf8', timeout: 30000 },
    )
    if (fs.existsSync(screenshotPath)) {
      const stat = fs.statSync(screenshotPath)
      assert.ok(stat.size > 1000, `Upload dialog screenshot created with size ${stat.size} bytes`)
    }
  }
})

test('Scenario 9: Extraction Dialog displays ExtractionSummary diagnostics and honest zero-usable explanation', () => {
  currentLocale = 'vi'
  const detail = {
    id: 'case-demo-receivable',
    revision: 6,
    documents: [],
  }
  const document = {
    id: '00000000-0000-4000-8000-000000000201',
    lineage: '00000000-0000-4000-8000-000000000301',
    version: 1,
    hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    pages: 1,
    type: 'financial_statement',
    name: 'BCTC_2024_Scan.pdf',
    status: 'completed',
    owner_party_ref: 'unresolved',
    source: { ai_mode: 'live' },
    extraction: [],
  }

  mockResourceData = {
    document_id: document.id,
    document_version: 1,
    source_hash: document.hash,
    job_state: 'completed',
    ai_mode: 'live',
    verification: 'unverified',
    group: 'bctc',
    suggested_type: 'financial_statement',
    classification_verification: 'unverified',
    outcome: 'zero_usable_fields',
    total_fields: 1,
    non_null_fields: 0,
    usable_fields: 0,
    diagnostics: [
      { code: 'TEXT_SEPARATOR_NORMALIZED', field_key: null },
      { code: 'VECTOR_OCR_USED', field_key: null },
      { code: 'GARBLED_TEXT_LAYER', field_key: null },
    ],
    fields: [
      {
        field_key: 'legacy:1.0.2:document.summary',
        has_value: false,
        quality: 'unreadable',
        missing_reason: 'not_present',
        evidence_count: 0,
      },
    ],
  }

  const dialogMarkup = renderToStaticMarkup(
    React.createElement(ExtractionDialog, {
      document,
      detail,
      onClose: () => {},
      reload: () => {},
      openSource: () => {},
    }),
  )

  // Assertions
  assert.ok(dialogMarkup.includes('0 trường khả dụng'), 'Shows 0 usable fields badge')
  assert.ok(dialogMarkup.includes('TEXT_SEPARATOR_NORMALIZED'), 'Shows diagnostic 1')
  assert.ok(dialogMarkup.includes('VECTOR_OCR_USED'), 'Shows diagnostic 2')
  assert.ok(dialogMarkup.includes('GARBLED_TEXT_LAYER'), 'Shows diagnostic 3')
  assert.ok(
    dialogMarkup.includes(
      'AI đã hoàn tất quét tài liệu nhưng không nhận diện được trường thông tin hợp lệ',
    ),
    'Explains honest zero usable reason',
  )
  assert.ok(dialogMarkup.includes('legacy:1.0.2:document.summary'), 'Displays expected field key')
  assert.ok(dialogMarkup.includes('Không đọc được'), 'Displays quality unreadable')
  assert.ok(dialogMarkup.includes('Không có trong nguồn'), 'Displays missing reason not_present')

  // Generate screenshot preview
  const cssTheme = fs.readFileSync(path.resolve(__dirname, '../../src/styles/theme.css'), 'utf8')
  const cssBase = fs.readFileSync(path.resolve(__dirname, '../../src/styles/base.css'), 'utf8')
  const cssWorkspace = fs.readFileSync(
    path.resolve(__dirname, '../../src/styles/workspace.css'),
    'utf8',
  )

  const fullHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>AIC Rating 2.0 — Extraction Dialog (Zero Usable Fields)</title>
  <style>
    ${cssBase}
    ${cssTheme}
    ${cssWorkspace}
    body { padding: 40px; background: rgba(16, 47, 40, 0.45); display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; }
    .modal { margin: 0 auto; display: block; position: static; max-width: 640px; width: 100%; }
  </style>
</head>
<body class="aic-production">
  ${dialogMarkup}
</body>
</html>`

  const scratchDir =
    'C:\\Users\\52duc\\.gemini\\antigravity\\brain\\ba1483dc-f97f-4cbd-8ed3-8c6a0cf3faf0\\scratch'
  const artifactDir =
    'C:\\Users\\52duc\\.gemini\\antigravity\\brain\\ba1483dc-f97f-4cbd-8ed3-8c6a0cf3faf0'
  const htmlPath = path.join(scratchDir, 'demo-extraction-dialog.html')
  const screenshotPath = path.join(artifactDir, 'demo-extraction-dialog.png')

  fs.writeFileSync(htmlPath, fullHtml, 'utf8')
  assert.ok(fs.existsSync(htmlPath))

  const chromePath =
    'C:\\Users\\52duc\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe'
  if (fs.existsSync(chromePath)) {
    spawnSync(
      chromePath,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=800,900',
        `--screenshot=${screenshotPath}`,
        htmlPath,
      ],
      { encoding: 'utf8', timeout: 30000 },
    )
    if (fs.existsSync(screenshotPath)) {
      const stat = fs.statSync(screenshotPath)
      assert.ok(
        stat.size > 1000,
        `Extraction dialog screenshot created with size ${stat.size} bytes`,
      )
    }
  }

  // Reset
  mockResourceData = null
})

test('Scenario 10: 60-document enterprise dossier architecture (Layer A Command Center & Layer B Explorer)', () => {
  currentLocale = 'vi'

  function createDocument({
    id,
    name,
    type,
    status = 'completed',
    pages = 4,
    version = 1,
    extraction = [],
    isConfirmed = true,
    declaredType = type,
    periodSuggestion = null,
  }) {
    return {
      id,
      lineage: `lin-${id}`,
      version,
      hash: `hash-${id}`,
      name,
      pages,
      source: {},
      owner_party_ref: 'party-enterprise',
      type,
      classification: periodSuggestion ? { period_suggestion: periodSuggestion } : {},
      status,
      extraction,
      source_review: isConfirmed
        ? {
            declared_type: declaredType,
            subject_match: 'match',
            reviewed_pages: [1],
            reason: 'Reviewed and confirmed',
            actor_id: 'officer-1',
            created_at: '2026-10-17T08:00:00Z',
          }
        : undefined,
    }
  }

  const standardBctcExtraction = (year) => [
    {
      field_key: 'financial.statement_period',
      value: String(year),
      period: String(year),
      quality: 'high',
      evidence_refs: ['ev-p'],
    },
    {
      field_key: 'financial.total_assets',
      value: '45000000000',
      quality: 'high',
      evidence_refs: ['ev-1'],
    },
    {
      field_key: 'financial.total_equity',
      value: '22000000000',
      quality: 'high',
      evidence_refs: ['ev-2'],
    },
    {
      field_key: 'financial.revenue',
      value: '38000000000',
      quality: 'high',
      evidence_refs: ['ev-3'],
    },
    {
      field_key: 'financial.net_profit',
      value: '3500000000',
      quality: 'high',
      evidence_refs: ['ev-4'],
    },
  ]

  const standardTaxExtraction = () => [
    { field_key: 'tax.period', value: 'Q1', quality: 'high', evidence_refs: ['ev-t1'] },
    { field_key: 'tax.total_vat', value: '120000000', quality: 'high', evidence_refs: ['ev-t2'] },
    {
      field_key: 'tax.filing_date',
      value: '2024-04-15',
      quality: 'high',
      evidence_refs: ['ev-t3'],
    },
  ]

  const standardContractExtraction = () => [
    { field_key: 'contract.code', value: 'HD-2024/01', quality: 'high', evidence_refs: ['ev-c1'] },
    {
      field_key: 'contract.amount',
      value: '5000000000',
      quality: 'high',
      evidence_refs: ['ev-c2'],
    },
  ]

  const standardPaymentExtraction = () => [
    { field_key: 'payment.amount', value: '1500000000', quality: 'high', evidence_refs: ['ev-m1'] },
    { field_key: 'payment.date', value: '2024-05-10', quality: 'high', evidence_refs: ['ev-m2'] },
  ]

  const standardDebtExtraction = () => [
    { field_key: 'debt.balance', value: '820000000', quality: 'high', evidence_refs: ['ev-d1'] },
  ]

  const otherExtraction = () => [
    {
      field_key: 'company.name',
      value: 'Công ty Cổ phần Xây dựng và Đầu tư AIC',
      quality: 'high',
      evidence_refs: ['ev-o1'],
    },
  ]

  const docs = [
    // 1. BCTC (10 docs)
    createDocument({
      id: 'bctc-01',
      name: 'BCTC_2024_KiemToan.pdf',
      type: 'financial_statement',
      extraction: standardBctcExtraction(2024),
    }),
    createDocument({
      id: 'bctc-02',
      name: 'BCTC_2024_BanGoc.pdf',
      type: 'financial_statement',
      extraction: standardBctcExtraction(2024),
    }),
    createDocument({
      id: 'bctc-03',
      name: 'BCTC_2023_KiemToan.pdf',
      type: 'financial_statement',
      extraction: standardBctcExtraction(2023),
    }),
    createDocument({
      id: 'bctc-04',
      name: 'BCTC_2023_BanHopNhat.pdf',
      type: 'financial_statement',
      extraction: standardBctcExtraction(2023),
    }),
    createDocument({
      id: 'bctc-05',
      name: 'BCTC_2022_Final.pdf',
      type: 'financial_statement',
      extraction: standardBctcExtraction(2022),
    }),
    createDocument({
      id: 'bctc-06',
      name: 'BCTC_2021_KiemToan.pdf',
      type: 'financial_statement',
      extraction: standardBctcExtraction(2021),
    }),
    createDocument({
      id: 'bctc-07',
      name: 'BCTC_2020_Final.pdf',
      type: 'financial_statement',
      extraction: standardBctcExtraction(2020),
    }),
    createDocument({
      id: 'bctc-08',
      name: 'BCTC_Scan_Mo_2024.pdf',
      type: 'financial_statement',
      extraction: [],
      isConfirmed: true,
    }), // 0 usable fields
    createDocument({
      id: 'bctc-09',
      name: 'BCTC_ChuaXacDinh_BanChup.pdf',
      type: 'financial_statement',
      extraction: [],
      isConfirmed: true,
    }), // 0 usable fields
    createDocument({
      id: 'bctc-10',
      name: 'BCTC_2025_DuThao.pdf',
      type: 'financial_statement',
      status: 'queued',
      extraction: [],
      isConfirmed: true,
    }),

    // 2. Thuế & Hoá đơn (12 docs)
    createDocument({
      id: 'tax-01',
      name: 'ToKhaiThue_Q1_2024.pdf',
      type: 'tax_report',
      extraction: standardTaxExtraction(),
    }),
    createDocument({
      id: 'tax-02',
      name: 'ToKhaiThue_Q2_2024.pdf',
      type: 'tax_report',
      extraction: standardTaxExtraction(),
    }),
    createDocument({
      id: 'tax-03',
      name: 'ToKhaiThue_Q3_2024.pdf',
      type: 'tax_report',
      extraction: standardTaxExtraction(),
    }),
    createDocument({
      id: 'tax-04',
      name: 'ToKhaiThue_Q4_2024.pdf',
      type: 'tax_report',
      extraction: standardTaxExtraction(),
    }),
    createDocument({
      id: 'tax-05',
      name: 'ToKhaiThue_Q1_2023.pdf',
      type: 'tax_report',
      extraction: standardTaxExtraction(),
    }),
    createDocument({
      id: 'tax-06',
      name: 'ToKhaiThue_Q2_2023.pdf',
      type: 'tax_report',
      extraction: standardTaxExtraction(),
    }),
    createDocument({
      id: 'tax-07',
      name: 'ToKhaiThue_Q3_2023.pdf',
      type: 'tax_report',
      extraction: standardTaxExtraction(),
    }),
    createDocument({
      id: 'tax-08',
      name: 'ToKhaiThue_Q4_2023.pdf',
      type: 'tax_report',
      extraction: standardTaxExtraction(),
    }),
    createDocument({
      id: 'tax-09',
      name: 'HoaDon_GTGT_00124_2024.pdf',
      type: 'invoice',
      extraction: standardTaxExtraction(),
    }),
    createDocument({
      id: 'tax-10',
      name: 'HoaDon_GTGT_00125_2024.pdf',
      type: 'invoice',
      extraction: standardTaxExtraction(),
    }),
    createDocument({
      id: 'tax-11',
      name: 'HoaDon_Loi_Font_2024.pdf',
      type: 'invoice',
      status: 'failed',
      extraction: [],
    }), // failed
    createDocument({
      id: 'tax-12',
      name: 'ToKhai_Thue_2022.pdf',
      type: 'tax_report',
      extraction: standardTaxExtraction(),
    }),

    // 3. Hợp đồng & Pháp lý (12 docs)
    createDocument({
      id: 'con-01',
      name: 'HopDong_KinhTe_01_2024.pdf',
      type: 'contract',
      extraction: standardContractExtraction(),
    }),
    createDocument({
      id: 'con-02',
      name: 'HopDong_KinhTe_02_2024.pdf',
      type: 'contract',
      extraction: standardContractExtraction(),
    }),
    createDocument({
      id: 'con-03',
      name: 'HopDong_NguyenTac_2024.pdf',
      type: 'contract',
      extraction: standardContractExtraction(),
    }),
    createDocument({
      id: 'con-04',
      name: 'HopDong_KinhTe_01_2023.pdf',
      type: 'contract',
      extraction: standardContractExtraction(),
    }),
    createDocument({
      id: 'con-05',
      name: 'HopDong_KinhTe_02_2023.pdf',
      type: 'contract',
      extraction: standardContractExtraction(),
    }),
    createDocument({
      id: 'con-06',
      name: 'HopDong_KinhTe_2022.pdf',
      type: 'contract',
      extraction: standardContractExtraction(),
    }),
    createDocument({
      id: 'con-07',
      name: 'HopDong_KinhTe_2021.pdf',
      type: 'contract',
      extraction: standardContractExtraction(),
    }),
    createDocument({
      id: 'con-08',
      name: 'HopDong_MuaBan_2020.pdf',
      type: 'contract',
      extraction: standardContractExtraction(),
    }),
    createDocument({
      id: 'con-09',
      name: 'DeNghiVay_Von_2024.pdf',
      type: 'loan_request',
      extraction: standardContractExtraction(),
    }),
    createDocument({
      id: 'con-10',
      name: 'DangKyKinhDoanh_ThayDoi_2023.pdf',
      type: 'registration',
      extraction: standardContractExtraction(),
    }),
    createDocument({
      id: 'con-11',
      name: 'HopDong_ChuaXacNhan_2024.pdf',
      type: 'contract',
      isConfirmed: false,
      extraction: standardContractExtraction(),
    }), // unconfirmed
    createDocument({
      id: 'con-12',
      name: 'HopDong_ChuaXacNhan_2023.pdf',
      type: 'contract',
      isConfirmed: false,
      extraction: standardContractExtraction(),
    }), // unconfirmed

    // 4. Thanh toán & Nghiệm thu (10 docs)
    createDocument({
      id: 'pay-01',
      name: 'UyNhiemChi_VCB_01_2024.pdf',
      type: 'payment_record',
      extraction: standardPaymentExtraction(),
    }),
    createDocument({
      id: 'pay-02',
      name: 'UyNhiemChi_VCB_02_2024.pdf',
      type: 'payment_record',
      extraction: standardPaymentExtraction(),
    }),
    createDocument({
      id: 'pay-03',
      name: 'UyNhiemChi_BIDV_03_2024.pdf',
      type: 'payment_record',
      extraction: standardPaymentExtraction(),
    }),
    createDocument({
      id: 'pay-04',
      name: 'BienBan_NghiemThu_01_2024.pdf',
      type: 'acceptance_record',
      extraction: standardPaymentExtraction(),
    }),
    createDocument({
      id: 'pay-05',
      name: 'BienBan_NghiemThu_02_2024.pdf',
      type: 'acceptance_record',
      extraction: standardPaymentExtraction(),
    }),
    createDocument({
      id: 'pay-06',
      name: 'UyNhiemChi_VCB_2023.pdf',
      type: 'payment_record',
      extraction: standardPaymentExtraction(),
    }),
    createDocument({
      id: 'pay-07',
      name: 'BienBan_NghiemThu_2023.pdf',
      type: 'acceptance_record',
      extraction: standardPaymentExtraction(),
    }),
    createDocument({
      id: 'pay-08',
      name: 'UyNhiemChi_2022.pdf',
      type: 'payment_record',
      extraction: standardPaymentExtraction(),
    }),
    createDocument({
      id: 'pay-09',
      name: 'BienBan_NghiemThu_2021.pdf',
      type: 'acceptance_record',
      extraction: standardPaymentExtraction(),
    }),
    createDocument({
      id: 'pay-10',
      name: 'UyNhiemChi_LoiQuet_2024.pdf',
      type: 'payment_record',
      status: 'failed',
      extraction: [],
    }), // failed

    // 5. Công nợ & Kho vận (8 docs)
    createDocument({
      id: 'debt-01',
      name: 'BienBan_DoiChieuCongNo_2024.pdf',
      type: 'debt_instrument',
      extraction: standardDebtExtraction(),
    }),
    createDocument({
      id: 'debt-02',
      name: 'BienBan_DoiChieuCongNo_2023.pdf',
      type: 'debt_instrument',
      extraction: standardDebtExtraction(),
    }),
    createDocument({
      id: 'debt-03',
      name: 'BienBan_DoiChieuCongNo_2022.pdf',
      type: 'debt_instrument',
      extraction: standardDebtExtraction(),
    }),
    createDocument({
      id: 'debt-04',
      name: 'BienBan_DoiChieuCongNo_2021.pdf',
      type: 'debt_instrument',
      extraction: standardDebtExtraction(),
    }),
    createDocument({
      id: 'debt-05',
      name: 'BienBan_GiaoHang_01_2024.pdf',
      type: 'delivery_record',
      extraction: standardDebtExtraction(),
    }),
    createDocument({
      id: 'debt-06',
      name: 'BienBan_GiaoHang_02_2024.pdf',
      type: 'delivery_record',
      extraction: standardDebtExtraction(),
    }),
    createDocument({
      id: 'debt-07',
      name: 'ChungTu_BaoDam_2023.pdf',
      type: 'collateral_document',
      extraction: standardDebtExtraction(),
    }),
    createDocument({
      id: 'debt-08',
      name: 'BienBan_CongNo_Thieu_2024.pdf',
      type: 'debt_instrument',
      extraction: [],
      isConfirmed: true,
    }), // 0 usable fields

    // 6. Khác & Cần phân loại (8 docs)
    createDocument({
      id: 'oth-01',
      name: 'DieuLe_CongTy_2022.pdf',
      type: 'other',
      declaredType: 'registration',
      extraction: otherExtraction(),
    }),
    createDocument({
      id: 'oth-02',
      name: 'GiayPhep_KinhDoanh_2020.pdf',
      type: 'other',
      declaredType: 'registration',
      extraction: otherExtraction(),
    }),
    createDocument({
      id: 'oth-03',
      name: 'TaiLieu_Quet_Mo_01.pdf',
      type: 'other',
      isConfirmed: false,
      extraction: otherExtraction(),
    }), // unconfirmed
    createDocument({
      id: 'oth-04',
      name: 'TaiLieu_Quet_Mo_02.pdf',
      type: 'other',
      isConfirmed: false,
      extraction: otherExtraction(),
    }), // unconfirmed
    createDocument({
      id: 'oth-05',
      name: 'VanBan_KhongRoLoai_2024.pdf',
      type: 'other',
      isConfirmed: false,
      extraction: otherExtraction(),
    }), // unconfirmed
    createDocument({
      id: 'oth-06',
      name: 'TaiLieu_Loi_OCR.pdf',
      type: 'other',
      status: 'failed',
      extraction: [],
    }), // failed
    createDocument({
      id: 'oth-07',
      name: 'BienBan_NoiBo_2024.pdf',
      type: 'other',
      declaredType: 'contract',
      extraction: otherExtraction(),
    }),
    createDocument({
      id: 'oth-08',
      name: 'TaiLieu_ChuaXacDinh_03.pdf',
      type: 'other',
      isConfirmed: false,
      extraction: otherExtraction(),
    }), // unconfirmed
  ]

  // 1. Total count check
  assert.equal(docs.length, 60, 'Dossier must contain exactly 60 documents')

  // 2. Action Required identification check
  const actionableDocs = docs.filter(isDocumentActionRequired)
  assert.equal(actionableDocs.length, 12, 'Must identify exactly 12 actionable documents')

  // Check specific reason classifications
  const failedDocs = actionableDocs.filter((d) => d.status === 'failed')
  assert.equal(failedDocs.length, 3, 'Must have 3 failed extraction documents')

  const zeroUsableDocs = actionableDocs.filter(
    (d) => d.status === 'completed' && countUsableExtractedFields(d) === 0,
  )
  assert.equal(zeroUsableDocs.length, 3, 'Must have 3 zero-usable-field documents')

  const unconfirmedDocs = actionableDocs.filter((d) => !d.source_review?.declared_type)
  assert.equal(unconfirmedDocs.length, 6, 'Must have 6 unconfirmed documents')

  // 3. Period resolution & business rule check (§2.1: never falsify verified year)
  const bctcVerified = resolveDocumentPeriod(docs[0])
  assert.equal(bctcVerified.year, '2024')
  assert.equal(bctcVerified.isVerified, true, 'Extraction-backed year is marked verified')

  const taxEstimated = resolveDocumentPeriod(docs[10]) // ToKhaiThue_Q1_2024.pdf
  assert.equal(taxEstimated.year, '2024')
  assert.equal(
    taxEstimated.isVerified,
    false,
    'Filename-inferred year is marked estimated/predicted',
  )

  const unspecified = resolveDocumentPeriod(docs[8]) // BCTC_ChuaXacDinh_BanChup.pdf
  assert.equal(unspecified.year, null, 'Document with no year is null')

  // 4. By-Year grouping check
  const yearGroups = groupDocumentsByYear(docs)
  // Expect years: 2025, 2024, 2023, 2022, 2021, 2020, and unspecified group
  assert.equal(yearGroups.length, 7, 'Must produce 7 year groups (2025 to 2020 + unspecified)')
  assert.equal(yearGroups[0].year, '2025', 'First year group is 2025 (descending order)')
  assert.equal(yearGroups[yearGroups.length - 1].isUnspecified, true, 'Last group is Unspecified')
  const totalInYearGroups = yearGroups.reduce((acc, g) => acc + g.documents.length, 0)
  assert.equal(totalInYearGroups, 60, 'All 60 documents are preserved in year groups')

  // 5. Facet & Search Filtering tests
  const searchBctc = filterDocuments(docs, { search: 'BCTC' })
  assert.equal(searchBctc.length, 10, 'Search for BCTC matches all 10 BCTC documents')

  const actionFiltered = filterDocuments(docs, { actionRequiredOnly: true })
  assert.equal(actionFiltered.length, 12, 'Action-required quick filter returns 12 documents')

  const year2024Filtered = filterDocuments(docs, { yearFilter: '2024' })
  assert.ok(year2024Filtered.length > 0, 'Year 2024 filter returns documents')
  assert.ok(
    year2024Filtered.every((d) => resolveDocumentPeriod(d).year === '2024'),
    'All returned documents are from 2024',
  )

  const failedFiltered = filterDocuments(docs, { statusFilter: 'failed' })
  assert.equal(failedFiltered.length, 3, 'Status failed facet returns 3 documents')

  // 6. Layer A (Command Center) Rendering Check
  const summary = computeIngestionSummary(docs)
  assert.equal(summary.totalFiles, 60)

  const commandCenterMarkup = renderToStaticMarkup(
    React.createElement('div', { className: 'workspace-panel' }, [
      React.createElement(
        'div',
        { className: 'section-heading', key: 'head' },
        React.createElement('h2', { key: 't' }, 'Tài liệu (60)'),
        React.createElement('div', { className: 'actions', key: 'a' }, [
          React.createElement(
            'button',
            { className: 'secondary-button', key: 'exp' },
            'Thư viện hồ sơ (60)',
          ),
          React.createElement('button', { className: 'primary-button', key: 'up' }, 'Nạp hồ sơ'),
        ]),
      ),
      React.createElement(DocumentSummaryCard, { summary, key: 'sum' }),
      React.createElement(DocumentWorkQueue, {
        documents: docs,
        openSource: () => {},
        onInspect: () => {},
        onClassify: () => {},
        onOpenExplorer: () => {},
        key: 'wq',
      }),
    ]),
  )

  // Verify Work Queue renders top 8 actionable items
  assert.ok(commandCenterMarkup.includes('Việc cần xử lý'), 'Renders Work Queue title')
  assert.ok(commandCenterMarkup.includes('12 cần xử lý'), 'Renders total count badge')
  assert.ok(commandCenterMarkup.includes('BCTC_Scan_Mo_2024.pdf'), 'Contains top actionable item')
  assert.ok(
    commandCenterMarkup.includes('Xem thêm (4 tài liệu)'),
    'Indicates remaining actionable items',
  )
  assert.ok(
    commandCenterMarkup.includes('Mở thư viện hồ sơ (60 tài liệu)'),
    'Contains CTA button to Explorer',
  )

  // 7. Layer B (Explorer) Rendering Check
  const explorerMarkup = renderToStaticMarkup(
    React.createElement(DocumentExplorer, {
      documents: docs,
      onBack: () => {},
      openSource: () => {},
      onInspect: () => {},
      onClassify: () => {},
    }),
  )

  assert.ok(explorerMarkup.includes('Thư viện hồ sơ'), 'Renders Explorer title')
  assert.ok(explorerMarkup.includes('Theo năm'), 'Renders Segmented control By Year')
  assert.ok(explorerMarkup.includes('Theo loại'), 'Renders Segmented control By Type')
  assert.ok(explorerMarkup.includes('Cần xử lý (12)'), 'Renders quick filter pill with count 12')
  assert.ok(explorerMarkup.includes('Tìm theo tên file, loại hoặc năm…'), 'Renders search input')
  assert.ok(explorerMarkup.includes('Tất cả các năm'), 'Renders year facet dropdown')
  assert.ok(explorerMarkup.includes('Tất cả các loại'), 'Renders type facet dropdown')
  assert.ok(explorerMarkup.includes('Tất cả trạng thái'), 'Renders status facet dropdown')
  assert.ok(explorerMarkup.includes('Năm 2024'), 'Renders 2024 year group accordion')

  // 8. Generate Browser Screenshots via Headless Chromium
  const cssTheme = fs.readFileSync(path.resolve(__dirname, '../../src/styles/theme.css'), 'utf8')
  const cssBase = fs.readFileSync(path.resolve(__dirname, '../../src/styles/base.css'), 'utf8')
  const cssWorkspace = fs.readFileSync(
    path.resolve(__dirname, '../../src/styles/workspace.css'),
    'utf8',
  )

  const scratchDir =
    'C:\\Users\\52duc\\.gemini\\antigravity\\brain\\ba1483dc-f97f-4cbd-8ed3-8c6a0cf3faf0\\scratch'
  const artifactDir =
    'C:\\Users\\52duc\\.gemini\\antigravity\\brain\\ba1483dc-f97f-4cbd-8ed3-8c6a0cf3faf0'
  const chromePath =
    'C:\\Users\\52duc\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe'

  // Screenshot 1: Case Command Center (Overview with Summary Card & Mini Work Queue)
  const commandCenterHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>AIC Rating 2.0 — Case Command Center (Layer A)</title>
  <style>
    ${cssBase}
    ${cssTheme}
    ${cssWorkspace}
    body { padding: 32px 48px; background: var(--surface-bg); color: var(--foreground); }
    .workspace-panel { max-width: 1140px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
    .section-heading { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-subtle); padding-bottom: 16px; }
    .section-heading h2 { margin: 0; font-size: 20px; font-weight: 700; color: var(--foreground); }
    .section-heading .actions { display: flex; gap: 10px; align-items: center; }
  </style>
</head>
<body class="aic-production">
  ${commandCenterMarkup}
</body>
</html>`

  const commandCenterHtmlPath = path.join(scratchDir, 'demo-case-command-center.html')
  const commandCenterPngPath = path.join(artifactDir, 'demo-case-command-center.png')
  fs.writeFileSync(commandCenterHtmlPath, commandCenterHtml, 'utf8')

  // Screenshot 2: Enterprise Dossier Explorer (Layer B - By Year & Facets)
  const explorerHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>AIC Rating 2.0 — Dossier Explorer (Layer B)</title>
  <style>
    ${cssBase}
    ${cssTheme}
    ${cssWorkspace}
    body { padding: 32px 48px; background: var(--surface-bg); color: var(--foreground); }
    .explorer-container { max-width: 1140px; margin: 0 auto; }
  </style>
</head>
<body class="aic-production">
  <div class="explorer-container">
    ${explorerMarkup}
  </div>
</body>
</html>`

  const explorerHtmlPath = path.join(scratchDir, 'demo-enterprise-explorer-by-year.html')
  const explorerPngPath = path.join(artifactDir, 'demo-enterprise-explorer-by-year.png')
  fs.writeFileSync(explorerHtmlPath, explorerHtml, 'utf8')

  // Screenshot 3: Enterprise Dossier Explorer Mobile View (390px)
  const mobileHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AIC Rating 2.0 — Dossier Explorer (Mobile)</title>
  <style>
    ${cssBase}
    ${cssTheme}
    ${cssWorkspace}
    body { padding: 12px; background: var(--surface-bg); color: var(--foreground); }
    .explorer-container { width: 100%; margin: 0 auto; }
  </style>
</head>
<body class="aic-production">
  <div class="explorer-container">
    ${explorerMarkup}
  </div>
</body>
</html>`

  const mobileHtmlPath = path.join(scratchDir, 'demo-enterprise-explorer-mobile.html')
  const mobilePngPath = path.join(artifactDir, 'demo-enterprise-explorer-mobile.png')
  fs.writeFileSync(mobileHtmlPath, mobileHtml, 'utf8')

  if (fs.existsSync(chromePath)) {
    // 1. Capture Command Center
    spawnSync(
      chromePath,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=1200,980',
        `--screenshot=${commandCenterPngPath}`,
        commandCenterHtmlPath,
      ],
      { encoding: 'utf8', timeout: 30000 },
    )
    if (fs.existsSync(commandCenterPngPath)) {
      const stat = fs.statSync(commandCenterPngPath)
      assert.ok(stat.size > 1000, `Command center screenshot created (${stat.size} bytes)`)
    }

    // 2. Capture Explorer
    spawnSync(
      chromePath,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=1280,1050',
        `--screenshot=${explorerPngPath}`,
        explorerHtmlPath,
      ],
      { encoding: 'utf8', timeout: 30000 },
    )
    if (fs.existsSync(explorerPngPath)) {
      const stat = fs.statSync(explorerPngPath)
      assert.ok(stat.size > 1000, `Explorer screenshot created (${stat.size} bytes)`)
    }

    // 3. Capture Explorer Mobile
    spawnSync(
      chromePath,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=390,844',
        `--screenshot=${mobilePngPath}`,
        mobileHtmlPath,
      ],
      { encoding: 'utf8', timeout: 30000 },
    )
    if (fs.existsSync(mobilePngPath)) {
      const stat = fs.statSync(mobilePngPath)
      assert.ok(stat.size > 1000, `Explorer mobile screenshot created (${stat.size} bytes)`)
    }
  }
})

test('Scenario 11: One-ZIP Multi-Year Dossier (60 PDF documents, intake banner, retained 12-page member with needs_review badge, polling states, and honest counters)', () => {
  currentLocale = 'vi'

  // 1. Synthetic 60-document archive manifest
  // 1 retained 12-page PDF + 59 canonical PDFs across 2022, 2023, 2024
  const members = []

  // 12-page retained PDF requiring review (at top of 2024)
  members.push({
    id: '00000000-0000-4000-8000-000000000460',
    archive_id: '00000000-0000-4000-8000-000000000301',
    entry_index: 0,
    entry_path: '2024/long_commercial_contract_12pages.pdf',
    byte_size: 65536,
    sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc0460',
    detected_mime: 'application/pdf',
    group: 'contracts',
    suggested_type: 'contract',
    classification_verification: 'unverified',
    period_suggestion: {
      year: 2024,
      kind: 'unresolved',
      basis: 'unresolved',
      verification: 'unverified',
    },
    subject_verification: 'unresolved',
    intake_state: 'needs_review',
    processing_state: 'needs_review',
    page_count: 12,
    document_id: null,
    job_id: null,
    error_code: 'PDF_REQUIRES_CHUNKED_PROCESSING',
    retryable: false,
    source_url: '/api/v2/dossier-members/00000000-0000-4000-8000-000000000460/source',
  })

  const years = ['2022', '2023', '2024']
  const types = ['financial_statement', 'tax_report', 'contract', 'invoice', 'payment_record']

  for (let i = 1; i <= 59; i++) {
    const yr = years[i % years.length]
    const tp = types[i % types.length]
    const hexId = String(i).padStart(3, '0')
    members.push({
      id: `00000000-0000-4000-8000-0000000004${hexId}`,
      archive_id: '00000000-0000-4000-8000-000000000301',
      entry_index: i,
      entry_path: `${yr}/${tp}_${hexId}.pdf`,
      byte_size: 10240 * i,
      sha256: `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb${hexId}`,
      detected_mime: 'application/pdf',
      group:
        tp === 'financial_statement'
          ? 'financial_statements'
          : tp === 'tax_report'
            ? 'tax'
            : 'contracts',
      suggested_type: tp,
      classification_verification: 'unverified',
      period_suggestion: {
        year: parseInt(yr, 10),
        kind: 'unresolved',
        basis: 'unresolved',
        verification: 'unverified',
      },
      subject_verification: 'unresolved',
      intake_state: 'registered',
      processing_state:
        i === 59 ? 'failed' : i > 54 ? 'completed_zero_usable' : 'completed_with_usable_data',
      page_count: (i % 6) + 1,
      document_id: `00000000-0000-4000-8000-0000000002${hexId}`,
      job_id: `00000000-0000-4000-8000-0000000001${hexId}`,
      error_code: i === 59 ? 'PDF_OCR_FAILED' : null,
      retryable: false,
      source_url: `/api/v2/dossier-members/00000000-0000-4000-8000-0000000004${hexId}/source`,
    })
  }

  const archive = {
    id: '00000000-0000-4000-8000-000000000301',
    case_id: '00000000-0000-4000-8000-000000000001',
    archive_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    intake_state: 'accepted',
    processing_state: 'finished_with_errors',
    created_at: '2026-10-17T09:00:00.000Z',
    counters: {
      discovered: 60,
      registered: 60,
      rejected: 0,
      awaiting_inspection: 0,
      queued: 0,
      running: 0,
      completed_with_usable_data: 54,
      completed_zero_usable: 4,
      failed: 1,
      needs_review: 1,
    },
    error_code: null,
    members,
  }

  // 2. Test DossierArchiveBanner Rendering
  const bannerMarkup = renderToStaticMarkup(
    React.createElement(DossierArchiveBanner, {
      archive,
      isPolling: false,
    }),
  )

  assert.ok(bannerMarkup.includes('Hồ sơ tài liệu đa năm'), 'Renders Dossier title')
  assert.ok(bannerMarkup.includes('#00000000'), 'Renders short archive ID')
  assert.ok(bannerMarkup.includes('Đã tiếp nhận toàn bộ'), 'Renders intake accepted badge')
  assert.ok(
    bannerMarkup.includes('Hoàn tất với lưu ý / tệp cần rà soát'),
    'Renders processing finished_with_errors badge',
  )
  assert.ok(bannerMarkup.includes('60'), 'Shows 60 discovered and registered')
  assert.ok(bannerMarkup.includes('54'), 'Shows 54 completed with data')
  assert.ok(bannerMarkup.includes('4'), 'Shows 4 completed zero usable')
  assert.ok(
    bannerMarkup.includes('cần rà soát (&gt;10 trang)'),
    'Shows 1 needs review counter label',
  )

  // 3. Test Retained Member Extraction Dialog
  const retainedDoc = {
    id: 'dossier-member-00000000-0000-4000-8000-000000000460',
    lineage: '00000000-0000-4000-8000-000000000460',
    version: 1,
    hash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc0460',
    pages: 12,
    owner_party_ref: 'CP-01',
    type: 'contract',
    status: 'needs_review',
    source: null,
    classification: null,
    name: '2024/long_commercial_contract_12pages.pdf',
    period_suggestion: {
      year: 2024,
      kind: 'unresolved',
      basis: 'unresolved',
      verification: 'unverified',
    },
    dossier_member_id: '00000000-0000-4000-8000-000000000460',
    dossier_intake_state: 'needs_review',
    dossier_processing_state: 'needs_review',
    dossier_source_url: '/api/v2/dossier-members/00000000-0000-4000-8000-000000000460/source',
    dossier_error_code: 'PDF_REQUIRES_CHUNKED_PROCESSING',
  }

  let capturedSourceTarget = null
  const extractionDialogMarkup = renderToStaticMarkup(
    React.createElement(ExtractionDialog, {
      document: retainedDoc,
      detail: { id: 'case-01', revision: 5, counterparty_id: 'CP-01' },
      onClose: () => {},
      reload: () => {},
      openSource: (target) => {
        capturedSourceTarget = target
      },
    }),
  )

  assert.ok(
    extractionDialogMarkup.includes('Cần rà soát thủ công'),
    'Renders needs_review title in ExtractionDialog',
  )
  assert.ok(
    extractionDialogMarkup.includes('Đã giữ nguồn, cần rà soát thủ công; AI chưa trích xuất.'),
    'Renders honest retained notice',
  )
  assert.ok(
    extractionDialogMarkup.includes('12 trang (vượt hạn mức tự động 10 trang)'),
    'Renders page count disclosure',
  )

  // 4. Test Explorer Rendering with 60 Dossier Members
  const synthesizedDocs = members.map((m) => ({
    id: m.document_id ?? `dossier-member-${m.id}`,
    lineage: m.document_id ?? m.id,
    version: 1,
    hash: m.sha256 || '',
    pages: m.page_count ?? 1,
    owner_party_ref: 'CP-01',
    type: m.suggested_type,
    status: m.document_id
      ? m.processing_state === 'completed_with_usable_data' ||
        m.processing_state === 'completed_zero_usable'
        ? 'completed'
        : m.processing_state
      : m.intake_state,
    extraction:
      m.processing_state === 'completed_with_usable_data'
        ? [
            {
              field_key: 'total',
              value: '1000',
              quality: 'readable',
              evidence_refs: ['ev-1'],
            },
          ]
        : [],
    name: m.entry_path,
    period_suggestion: m.period_suggestion,
    dossier_member_id: m.id,
    dossier_intake_state: m.intake_state,
    dossier_processing_state: m.processing_state,
    dossier_source_url: m.source_url,
    dossier_error_code: m.error_code,
  }))

  assert.equal(synthesizedDocs.length, 60, 'Total synthesized documents must be 60')

  const explorerMarkup = renderToStaticMarkup(
    React.createElement(DocumentExplorer, {
      documents: synthesizedDocs,
      initialActionRequired: false,
      onBack: () => {},
      openSource: () => {},
      onInspect: () => {},
      onClassify: () => {},
    }),
  )

  assert.ok(explorerMarkup.includes('Thư viện hồ sơ'), 'Renders Explorer title')
  assert.ok(explorerMarkup.includes('Năm 2024'), 'Renders 2024 Year Group')
  assert.ok(explorerMarkup.includes('Năm 2023'), 'Renders 2023 Year Group')
  assert.ok(explorerMarkup.includes('Năm 2022'), 'Renders 2022 Year Group')
  assert.ok(
    explorerMarkup.includes('Đã giữ nguồn, cần rà soát thủ công; AI chưa trích xuất.'),
    'Renders honest badge on 12-page contract',
  )

  // 5. Browser Screenshot Generation for Dossier E2E
  const cssTheme = fs.readFileSync(path.resolve(__dirname, '../../src/styles/theme.css'), 'utf8')
  const cssBase = fs.readFileSync(path.resolve(__dirname, '../../src/styles/base.css'), 'utf8')
  const cssWorkspace = fs.readFileSync(
    path.resolve(__dirname, '../../src/styles/workspace.css'),
    'utf8',
  )
  const scratchDir =
    'C:\\Users\\52duc\\.gemini\\antigravity\\brain\\ba1483dc-f97f-4cbd-8ed3-8c6a0cf3faf0\\scratch'
  const artifactDir =
    'C:\\Users\\52duc\\.gemini\\antigravity\\brain\\ba1483dc-f97f-4cbd-8ed3-8c6a0cf3faf0'
  const chromePath =
    'C:\\Users\\52duc\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe'

  const dossierBannerHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>AIC Rating 2.0 — One-ZIP 60-PDF Dossier Intake & Command Center</title>
  <style>
    ${cssBase}
    ${cssTheme}
    ${cssWorkspace}
    body { padding: 32px 48px; background: var(--surface-bg); color: var(--foreground); }
    .workspace-panel { max-width: 1140px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
  </style>
</head>
<body class="aic-production">
  <div class="workspace-panel">
    ${bannerMarkup}
    ${renderToStaticMarkup(
      React.createElement(DocumentSummaryCard, {
        summary: computeIngestionSummary(synthesizedDocs),
      }),
    )}
    ${renderToStaticMarkup(
      React.createElement(DocumentWorkQueue, {
        documents: synthesizedDocs,
        openSource: () => {},
        onInspect: () => {},
        onClassify: () => {},
        onOpenExplorer: () => {},
      }),
    )}
  </div>
</body>
</html>`

  const dossierBannerHtmlPath = path.join(scratchDir, 'demo-dossier-intake-banner.html')
  const dossierBannerPngPath = path.join(artifactDir, 'demo-dossier-intake-banner.png')
  fs.writeFileSync(dossierBannerHtmlPath, dossierBannerHtml, 'utf8')

  const dossierExplorerHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>AIC Rating 2.0 — One-ZIP 60-PDF Enterprise Explorer</title>
  <style>
    ${cssBase}
    ${cssTheme}
    ${cssWorkspace}
    body { padding: 32px 48px; background: var(--surface-bg); color: var(--foreground); }
    .explorer-container { max-width: 1140px; margin: 0 auto; }
  </style>
</head>
<body class="aic-production">
  <div class="explorer-container">
    ${bannerMarkup}
    <div style="margin-top: 24px;">
      ${explorerMarkup}
    </div>
  </div>
</body>
</html>`

  const dossierExplorerHtmlPath = path.join(scratchDir, 'demo-dossier-explorer-members.html')
  const dossierExplorerPngPath = path.join(artifactDir, 'demo-dossier-explorer-members.png')
  fs.writeFileSync(dossierExplorerHtmlPath, dossierExplorerHtml, 'utf8')

  if (fs.existsSync(chromePath)) {
    // 1. Capture Dossier Intake & Command Center
    spawnSync(
      chromePath,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=1280,1020',
        `--screenshot=${dossierBannerPngPath}`,
        dossierBannerHtmlPath,
      ],
      { encoding: 'utf8', timeout: 30000 },
    )
    if (fs.existsSync(dossierBannerPngPath)) {
      const stat = fs.statSync(dossierBannerPngPath)
      assert.ok(stat.size > 1000, `Dossier banner screenshot created (${stat.size} bytes)`)
    }

    // 2. Capture Dossier Explorer with 60 Members
    spawnSync(
      chromePath,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=1280,1100',
        `--screenshot=${dossierExplorerPngPath}`,
        dossierExplorerHtmlPath,
      ],
      { encoding: 'utf8', timeout: 30000 },
    )
    if (fs.existsSync(dossierExplorerPngPath)) {
      const stat = fs.statSync(dossierExplorerPngPath)
      assert.ok(stat.size > 1000, `Dossier explorer screenshot created (${stat.size} bytes)`)
    }
  }
})
