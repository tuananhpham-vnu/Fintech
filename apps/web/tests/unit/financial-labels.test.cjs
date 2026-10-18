require('../helpers/register-typescript.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { financialLabel } = require('../../src/features/financial/labels.ts')
const { factKeys } = require('../../src/features/financial/api.ts')

const locales = ['en', 'vi', 'zh-CN']
const known = {
  fact: factKeys,
  metric: ['AIC-M01', 'AIC-M02', 'AIC-M03', 'AIC-M04', 'AIC-M05', 'AIC-M06', 'AIC-M07'],
  group: ['liquidity', 'capital', 'leverage', 'profitability'],
  status: ['available', 'unavailable'],
  verification: ['unverified', 'verified', 'stale', 'rejected'],
  period: ['FY', 'TTM', 'INTERIM'],
  basis: ['standalone', 'consolidated'],
  regime: ['VN_TT133', 'VN_TT99', 'VN_TT58', 'IFRS', 'OTHER', 'UNKNOWN'],
  scope: [
    'DISTRIBUTION_WHOLESALE_PILOT',
    'MANUFACTURING',
    'RETAIL',
    'BUSINESS_SERVICES',
    'CONSUMER_DURABLES',
    'OTHER',
    'UNKNOWN',
  ],
  observation: ['actual', 'forecast'],
  audit: ['audited', 'unaudited', 'unknown'],
  blocker: [
    'FHI_METHOD_UNCONFIGURED',
    'ACTUAL_KNOWN_ACCOUNTING_BASIS_REQUIRED',
    'EXPLICIT_STATEMENT_SET_SELECTION_REQUIRED',
    'FINANCIAL_INPUTS_REQUIRED',
    'INVALID_INPUT',
    'INVALID_SCOPE',
    'OUT_OF_PILOT_SCOPE',
    'UNSUPPORTED_FACT_KEY',
    'MISSING_FACT',
    'DUPLICATE_FACT',
    'INVALID_FACT',
    'UNVERIFIED_FACT',
    'STALE_FACT',
    'SOURCE_UNAVAILABLE',
    'STATEMENT_SET_MISMATCH',
    'SCOPE_MISMATCH',
    'PERIOD_MISMATCH',
    'BASIS_MISMATCH',
    'ACCOUNTING_REGIME_MISMATCH',
    'CURRENCY_MISMATCH',
    'UNIT_MISMATCH',
    'INVALID_DECIMAL',
    'QUICK_ASSETS_UNAVAILABLE',
    'EBITDA_BRIDGE_UNAVAILABLE',
    'EBITDA_NON_POSITIVE',
    'ZERO_DENOMINATOR',
    'ZERO_INTEREST_REQUIRES_VERIFIED_ZERO_DEBT',
    'INVALID_FINANCIAL_BOUNDS',
    'BALANCE_SHEET_UNRECONCILED',
  ],
  limitation: [
    'AIC experimental method is not approved; no score or band is published.',
    'Verified entry/source fidelity does not confirm legal identity.',
    'No FX, annualization, profit proxy or weight redistribution.',
    'Balance sheet tolerance awaits approval; only exact reconciliation is accepted by this implementation.',
  ],
}

test('all financial system values have distinct en/vi/zh-CN presentation with exact technical values', () => {
  for (const [kind, values] of Object.entries(known)) {
    for (const raw of values) {
      const presentations = locales.map((locale) => financialLabel(locale, kind, raw))
      for (const value of presentations) {
        assert.equal(value.known, true, `${kind}: ${raw}`)
        assert.equal(value.raw, raw)
        assert.equal(typeof value.label, 'string')
        assert.ok(value.label.length > 0)
        if (kind !== 'limitation') assert.notEqual(value.label, raw)
      }
      assert.equal(new Set(presentations.map((value) => value.label)).size, 3, raw)
    }
  }
})

test('unknown and inherited keys use a localized generic label and retain raw bytes', () => {
  const inherited = 'FUTURE_INHERITED_FINANCIAL_CODE'
  Object.defineProperty(Object.prototype, inherited, {
    configurable: true,
    value: ['Forged English', 'Forged Vietnamese', 'Forged Chinese'],
  })
  try {
    for (const kind of Object.keys(known)) {
      const fallbacks = locales.map((locale) => financialLabel(locale, kind, 'FUTURE_CODE').label)
      assert.equal(new Set(fallbacks).size, 3)
      for (const raw of [
        '__proto__',
        'constructor',
        'toString',
        'hasOwnProperty',
        inherited,
        '',
        ' FUTURE_\n代码 ',
      ]) {
        for (const [i, locale] of locales.entries()) {
          assert.deepEqual(financialLabel(locale, kind, raw), {
            label: fallbacks[i],
            raw,
            known: false,
          })
        }
      }
    }
  } finally {
    delete Object.prototype[inherited]
  }
})

test('lookup is exact and category-specific; future values cannot acquire unrelated meanings', () => {
  for (const locale of locales) {
    for (const [kind, raw] of [
      ['fact', 'Current_assets'],
      ['fact', 'current_assets '],
      ['audit', 'verified'],
      ['status', 'verified'],
      ['basis', 'UNKNOWN'],
    ]) {
      assert.equal(financialLabel(locale, kind, raw).known, false)
      assert.equal(financialLabel(locale, kind, raw).raw, raw)
    }
    assert.notEqual(
      financialLabel(locale, 'verification', 'verified').label,
      financialLabel(locale, 'audit', 'audited').label,
    )
    assert.notEqual(
      financialLabel(locale, 'status', 'available').label,
      financialLabel(locale, 'verification', 'verified').label,
    )
  }
})

test('presentation preserves original text and decimal spelling, including text resembling known keys', () => {
  for (const raw of [
    'current_assets',
    '1.250000000000000000001',
    '-0.000',
    '  Nợ gốc / 原文\n"PDF quote"  ',
    'FUTURE_BLOCKER:<not markup>',
  ]) {
    for (const locale of locales) {
      const result = financialLabel(locale, 'fact', raw)
      assert.equal(result.raw, raw)
      result.raw = 'changed display object'
      assert.equal(financialLabel(locale, 'fact', raw).raw, raw)
    }
  }
})

test('registry renders localized labels, keeps system codes out of production DOM and preserves source facts', (t) => {
  const fs = require('node:fs')
  const path = require('node:path')
  const Module = require('node:module')
  const ts = require('typescript')
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { SessionContext } = require('../../src/lib/auth/session-context.ts')
  const previousMode = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  t.after(() => {
    if (previousMode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousMode
  })
  const file = path.resolve(
    __dirname,
    '../../src/features/financial/components/financial-registry.tsx',
  )
  const registry = {
    selected_set_id: 'set-id',
    sets: [
      {
        id: 'set-id',
        revision: 3,
        verification_stale: true,
        scope: {
          entity_id: 'entity-id',
          period: { kind: 'FY', start_date: '2025-01-01', end_date: '2025-12-31' },
          basis: 'standalone',
          accounting_regime: 'VN_TT133',
          currency: 'VND',
          unit_multiplier: '1000',
          pilot_scope: 'DISTRIBUTION_WHOLESALE_PILOT',
        },
        metadata: { observation_kind: 'actual' },
        facts: [
          {
            id: 'fact-id',
            key: 'operating_profit',
            raw_label: 'current_assets',
            raw_value: '1.250000000000000000001',
            normalized_decimal: '1250.000000000000000001',
            missing_reason: 'Original missing reason / 原文',
            verification: { status: 'rejected' },
            source: {
              kind: 'manual_entry',
              statement: 'Original declaration / Lời khai gốc / 原始陈述',
            },
          },
          {
            id: 'pdf-fact-id',
            key: 'trade_receivables',
            raw_label: 'Original PDF label',
            raw_value: '-0.000',
            normalized_decimal: '0',
            missing_reason: null,
            verification: { status: 'unverified' },
            source: {
              kind: 'document',
              evidence_ref: 'evidence-id',
              document_version: 7,
              page: 2,
              quote: 'Exact PDF quote / 原文\n1.250',
            },
          },
        ],
      },
    ],
    metrics: [
      {
        metric_id: 'AIC-M01',
        group: 'liquidity',
        status: 'FUTURE_STATUS',
        formula: 'current_assets / current_liabilities',
        raw_ratio: { decimal: null, numerator: '5', denominator: '3' },
        max_points: '15',
        points: null,
        anchors: [],
        source_facts: [],
        blockers: [{ code: 'FUTURE_METRIC_BLOCKER' }],
      },
    ],
    blockers: ['FHI_METHOD_UNCONFIGURED'],
    limitations: [known.limitation[1], 'FUTURE_LIMITATION'],
    score: null,
    band: null,
    grade: null,
    pd: null,
  }
  const before = JSON.stringify(registry)
  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.freeze(value)
      Object.values(value).forEach(freeze)
    }
  }
  freeze(registry)
  for (const locale of locales) {
    const compiled = new Module(file, module)
    compiled.filename = file
    compiled.paths = Module._nodeModulePaths(path.dirname(file))
    compiled.require = (name) => {
      if (name === '@/lib/i18n/locale-provider')
        return { useLocale: () => ({ locale, t: (key) => key }) }
      if (name === '@/hooks/use-resource')
        return { useResource: () => ({ data: registry, loading: false, error: null, reload() {} }) }
      if (name === '@/components/feedback/error-notice') return { ErrorNotice: () => null }
      if (name === './financial-diagnostics') return { FinancialDiagnostics: () => null }
      if (
        [
          '@/components/forms/revision-action-dialog',
          '@/components/feedback/loading',
          '@/features/cases/api',
        ].includes(name)
      )
        return {}
      return Module.prototype.require.call(compiled, name)
    }
    compiled._compile(
      ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      file,
    )
    const html = renderToStaticMarkup(
      React.createElement(
        SessionContext.Provider,
        { value: { status: 'ready', session: null } },
        React.createElement(compiled.exports.FinancialInformation, {
          detail: { id: 'case-id', revision: 1 },
          reload() {},
          openSource() {},
        }),
      ),
    )
    const primary = html.replace(/<details(?:\s[^>]*)?>[\s\S]*?<\/details>/g, '')
    for (const raw of [
      'AIC-M01',
      'liquidity',
      'FUTURE_STATUS',
      'rejected',
      'FY',
      'standalone',
      'VN_TT133',
      'DISTRIBUTION_WHOLESALE_PILOT',
      'operating_profit',
      'FUTURE_METRIC_BLOCKER',
      'FHI_METHOD_UNCONFIGURED',
      'FUTURE_LIMITATION',
      'entity-id',
    ]) {
      assert.ok(!html.includes(raw), `technical value not mounted in production DOM: ${raw}`)
      assert.ok(!primary.includes(raw), `technical value hidden from primary presentation: ${raw}`)
    }
    for (const original of [
      '1.250000000000000000001',
      '1250.000000000000000001',
      'Original missing reason / 原文',
      'Original declaration / Lời khai gốc / 原始陈述',
      'VND',
    ])
      assert.ok(html.includes(original), original)
    for (const [kind, raw] of [
      ['metric', 'AIC-M01'],
      ['verification', 'rejected'],
      ['blocker', 'FUTURE_METRIC_BLOCKER'],
      ['limitation', 'FUTURE_LIMITATION'],
    ])
      assert.ok(html.includes(financialLabel(locale, kind, raw).label), `${locale}: ${kind}/${raw}`)
    assert.equal(JSON.stringify(registry), before)
  }
})
