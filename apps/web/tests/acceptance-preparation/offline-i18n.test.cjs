// Explicit offline acceptance probes. Some intentionally fail until the lead fixes
// the documented defects. No browser, listener, database, or provider is used.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
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
const i18n = require('../../src/lib/i18n/review-i18n.ts')
let locale = 'en'
let findings = []
let resourceData = null
const originalLoad = Module._load
// Only hook/context/Modal boundaries are stubbed. The production mapper,
// DocumentReview, ExtractionDialog and SourceViewer render functions are real.
Module._load = function (name, ...args) {
  if (name === '@/lib/i18n/locale-provider')
    return { useLocale: () => ({ locale, t: (key) => translate(locale, key) }) }
  if (name === '@/components/ui/modal')
    return { Modal: ({ children }) => React.createElement('div', null, children) }
  if (name === '@/hooks/use-resource')
    return { useResource: () => ({ data: resourceData, loading: false, error: null, reload() {} }) }
  if (name === '../hooks/use-review-run')
    return {
      useReviewRun: () => ({
        run: { data: { state: 'completed', findings }, loading: false, reload() {} },
        findings,
        stale: false,
        running: false,
      }),
    }
  return originalLoad.call(this, name, ...args)
}
globalThis.fetch = () => {
  throw new Error('Network forbidden in offline acceptance probes')
}

const {
  ExtractionDialog,
} = require('../../src/features/documents/components/extraction-review.tsx')
const { SourceViewer } = require('../../src/features/evidence/components/source-viewer.tsx')
const { DocumentReview } = require('../../src/features/review/components/document-review.tsx')
const { FhiBreakdown } = require('../../src/features/assessments/components/fhi-breakdown.tsx')
const locales = ['en', 'vi', 'zh-CN']
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props))
const escaped = (text) => renderToStaticMarkup(React.createElement('span', null, text)).slice(6, -7)
const noop = () => {}
const field = {
  field_key: 'legacy:contract_ref',
  raw_value: 'Human verification remains required.',
  value: 'RAW_Company_000123',
  quality: 'readable',
  missing_reason: null,
  evidence_refs: [],
  party_role: 'seller',
  period: '2026',
  currency: 'VND',
}
const extractionProps = (overrides = {}) => ({
  document: {
    id: 'synthetic-document',
    name: 'RAW_Company_000123',
    version: 1,
    status: 'completed',
    extraction: [{ ...field, ...overrides }],
  },
  detail: { id: 'synthetic-case', revision: 1 },
  onClose: noop,
  reload: noop,
  openSource: noop,
})

test('known labels and severities localize in all three locales', () => {
  assert.equal(
    i18n.localizeRuleId('counterparty_identity_source', 'vi'),
    'Chứng từ xác minh danh tính/pháp nhân đối tác',
  )
  assert.equal(i18n.localizeSeverity('warning', 'zh-CN'), '警告')
  for (const lang of locales)
    assert.notEqual(i18n.localizeCategory('missing_document', lang), 'missing_document')
})

test('UI-I18N-01: unknown codes and arbitrary requirement labels keep exact original text', () => {
  for (const lang of locales)
    for (const name of [
      'localizeRuleId',
      'localizeCategory',
      'localizeSeverity',
      'localizeRequirementKey',
    ])
      assert.equal(
        i18n[name]('CUSTOM_2026_unknown', lang),
        'CUSTOM_2026_unknown',
        `${name}/${lang}`,
      )
})

test('UI-I18N-01: an unknown structured summary keeps the exact original message', () => {
  const summary = 'Missing documentary support:  CUSTOM_RAW_2026  '
  for (const lang of locales)
    assert.equal(
      i18n.localizeFindingSummary({ rule_id: 'CUSTOM_RAW_2026', summary }, lang),
      summary,
    )
})

test('UI-I18N-04: inherited object property names are unknown strings, not dictionary entries', () => {
  for (const lang of locales)
    for (const value of ['toString', 'constructor', '__proto__'])
      assert.equal(i18n.localizeRuleId(value, lang), value, `${value}/${lang}`)
})

test('UI-I18N-02: the released not_present reason is localized in rendered extraction', () => {
  for (const lang of ['vi', 'zh-CN']) {
    locale = lang
    const html = render(ExtractionDialog, extractionProps({ missing_reason: 'not_present' }))
    assert.ok(!html.includes('>not_present<'), `raw not_present leaked in ${lang}`)
  }
})

test('UI-I18N-03: a raw condition missing_reason retains original text even if it matches a system message', () => {
  // mvp-workflow.service.ts places condition.missing_reason after its generated
  // limitation. DocumentReview must preserve this user-controlled second entry.
  const rawReason = 'Human verification remains required.'
  findings = [
    {
      id: 'synthetic-finding',
      rule_id: 'condition_unverified:synthetic-condition',
      category: 'transaction_uncertainty',
      severity: 'warning',
      finding_state: 'open',
      handling_state: 'open',
      summary: 'Reported delivery condition remains unverified.',
      evidence_refs: [],
      limitations: [
        'Proposed or reported satisfaction is distinct from verified satisfaction.',
        rawReason,
      ],
    },
  ]
  for (const lang of ['vi', 'zh-CN']) {
    locale = lang
    const html = render(DocumentReview, {
      detail: { id: 'synthetic-case', revision: 1 },
      readiness: null,
      reload: noop,
      openSource: noop,
    })
    assert.ok(html.includes(escaped(rawReason)), `raw condition reason translated in ${lang}`)
  }
})

test('raw extraction values and company identifiers stay original in all locales', () => {
  const before = JSON.stringify(field)
  for (const lang of locales) {
    locale = lang
    const html = render(ExtractionDialog, extractionProps())
    assert.ok(html.includes(escaped(field.raw_value)))
    assert.ok(html.includes(escaped(field.value)))
  }
  assert.equal(JSON.stringify(field), before)
})

test('evidence quote, source hash, version and page stay original in all locales', () => {
  const quote = 'Missing documentary support: RAW_EVIDENCE_2026 <signed> 000123'
  resourceData = {
    document_id: 'synthetic-document',
    document_version: 7,
    page: 2,
    source_hash: 'a'.repeat(64),
    quote,
  }
  const before = JSON.stringify(resourceData)
  for (const lang of locales) {
    locale = lang
    const html = render(SourceViewer, {
      target: { evidenceId: 'synthetic-evidence' },
      onClose: noop,
    })
    assert.ok(html.includes(`<blockquote>${escaped(quote)}</blockquote>`))
    assert.ok(html.includes(resourceData.source_hash))
    assert.ok(html.includes('7'))
    assert.ok(html.includes('2'))
  }
  assert.equal(JSON.stringify(resourceData), before)
})

test('unknown prose, absence bases and blocker messages remain original', () => {
  const raw = 'RAW_Company_000123: original evidence wording'
  for (const lang of locales) {
    assert.equal(i18n.localizeFindingSummary({ summary: raw }, lang), raw)
    assert.equal(i18n.localizeLimitation(raw, lang), raw)
    assert.equal(i18n.localizeAbsenceBasis(raw, lang), raw)
    assert.equal(i18n.localizeBlocker({ code: 'UNKNOWN_2026', message: raw }, lang), raw)
  }
})

test('FHI reference cards localize labels, disclose technical blockers, and keep gated points absent', () => {
  const health = {
    status: 'unconfigured',
    score_quality: 'unconfigured',
    score: null,
    band: null,
    pd: null,
    components: [{ metric_id: 'AIC-M01', points: '99', raw_value: '12345.678' }],
    blockers: ['FHI_METHOD_UNCONFIGURED', { code: 'FUTURE_BLOCKER_2026' }],
    missing_facts: ['current_assets'],
  }
  const original = JSON.stringify(health)
  for (const lang of locales) {
    locale = lang
    const html = render(FhiBreakdown, { result: { financial_health: health }, showNumbers: false })
    const primary = html.replace(/<details>[\s\S]*?<\/details>/g, '')
    for (const raw of ['current_assets', 'FHI_METHOD_UNCONFIGURED', 'FUTURE_BLOCKER_2026']) {
      assert.ok(html.includes(raw), 'Original technical value must remain available')
      assert.ok(!primary.includes(raw), 'Technical code must not be a primary label')
    }
    assert.ok(
      !primary.includes('12345.678') && !primary.includes('99'),
      'Unapproved points and ratio must stay gated',
    )
    assert.ok(
      !primary.includes('current_liabilities'),
      'Raw formula must not leak from reference card',
    )
    assert.equal((html.match(/class="panel aic-factor"/g) ?? []).length, 7)
  }
  assert.equal(JSON.stringify(health), original)
})

test('extraction field headings localize registry keys while technical disclosure and raw values remain exact', () => {
  for (const lang of locales) {
    locale = lang
    const html = render(
      ExtractionDialog,
      extractionProps({ field_key: 'legacy:1.0.2:parties.borrower.tax_id' }),
    )
    assert.ok(html.includes('<code>legacy:1.0.2:parties.borrower.tax_id</code>'))
    assert.ok(!/<h3>[^<]*(?:tax_id|legacy:)/.test(html))
    assert.ok(html.includes(escaped(field.raw_value)) && html.includes(escaped(field.value)))
  }
})
