require('../helpers/register-typescript.cjs')
const { test } = require('node:test'),
  assert = require('node:assert/strict')
const React = require('react'),
  { renderToStaticMarkup } = require('react-dom/server')
const { LocaleProvider } = require('../../src/lib/i18n/locale-provider.tsx')
const {
  IntakeItemProgress,
  FinancialIntake,
} = require('../../src/features/financial/components/financial-intake.tsx')
const {
  PeriodSourceReview,
} = require('../../src/features/financial/components/period-source-review.tsx')
const { intakeApi } = require('../../src/features/financial/intake-api.ts')
const render = (locale, Component, props) =>
  renderToStaticMarkup(
    React.createElement(
      LocaleProvider,
      { initialLocale: locale },
      React.createElement(Component, props),
    ),
  )

test('long-running and queued tasks show elapsed time without fabricated steps or percentages in all locales', () => {
  for (const locale of ['vi', 'en', 'zh-CN'])
    for (const state of ['running', 'queued']) {
      const html = render(locale, IntakeItemProgress, {
        createdAt: new Date(Date.now() - 7200000).toISOString(),
        state,
        locale,
      })
      assert.match(html, /role="status"/)
      assert.doesNotMatch(html, /%|4\/4|progressbar/)
      assert.match(html, /7200/)
    }
})

test('confirmation action and confirmed status stay distinct', () => {
  const page = {
      revision: 1,
      items: [],
      review: {
        confirmed: false,
        stale: false,
        processing: false,
        source_snapshot_hash: 'a'.repeat(64),
      },
    },
    props = {
      industry: 'DISTRIBUTION_WHOLESALE_PILOT',
      caseId: 'synthetic',
      page,
      registry: { sets: [] },
      reload() {},
      onPreview() {},
    }
  const before = render('vi', FinancialIntake, props)
  assert.match(before, />Xác nhận rà soát tất cả<\/button>/)
  assert.doesNotMatch(before, />Đã xác nhận rà soát tất cả<\/button>/)
  const after = render('vi', FinancialIntake, {
    ...props,
    page: { ...page, review: { ...page.review, confirmed: true } },
  })
  assert.match(after, /Đã xác nhận rà soát tất cả/)
  assert.match(after, />Xác nhận lại<\/button>/)
})

test('period source comparison displays both values, source roles and actions without inferring a winner', () => {
  const period = { kind: 'FY', start_date: '2024-01-01', end_date: '2024-12-31' },
    candidate = {
      receipt_id: 'r',
      period,
      basis: 'standalone',
      currency: 'VND',
      unit_multiplier: '1',
      role: 'current',
      status: 'pending',
      existing_sets: [
        {
          set_id: 'set',
          revision: 1,
          ...period,
          basis: 'standalone',
          source_names: ['SYNTHETIC_2025.pdf'],
          role: 'comparative',
        },
      ],
      facts: [
        { key: 'net_revenue', value: '101', label: 'Revenue', page: 1, quote: 'Revenue 101' },
      ],
    },
    item = { id: 'new', name: 'SYNTHETIC_2024.pdf', prepared_source_id: 'new-source' },
    old = { id: 'old', name: 'SYNTHETIC_2025.pdf', prepared_source_id: 'old-source' },
    set = {
      id: 'set',
      revision: 1,
      scope: { period, basis: 'standalone', currency: 'VND', unit_multiplier: '1' },
      facts: [
        {
          key: 'net_revenue',
          raw_value: '100',
          source: { kind: 'financial_import', source_id: 'old-source' },
        },
      ],
    }
  for (const locale of ['vi', 'en', 'zh-CN']) {
    const html = render(locale, PeriodSourceReview, {
      candidate,
      item,
      items: [old, item],
      sets: [set],
      caseId: 'synthetic',
      revision: 2,
      reload() {},
      onPreview() {},
    })
    assert.match(html, /SYNTHETIC_2024.pdf/)
    assert.match(html, /SYNTHETIC_2025.pdf/)
    assert.match(html, />100<\/td>/)
    assert.match(html, />101 /)
    assert.doesNotMatch(html, /selected=""|checked=""/)
    assert.doesNotMatch(html, /class="primary-button" disabled/)
    if (locale === 'vi') {
      assert.match(html, /Cả hai PDF vẫn được giữ/)
      assert.match(html, /Cột năm báo cáo.*2024/)
      assert.match(html, /Cột năm so sánh.*2024/)
      assert.match(html, /Giữ số liệu từ nguồn đang dùng cho 2024/)
      assert.match(html, /Dùng số liệu từ nguồn mới cho 2024/)
    }
  }
})

test('intake decoder rejects malformed period source candidates', async (t) => {
  const item = {
      id: 'new',
      name: 'SYNTHETIC.pdf',
      sha256: 'a'.repeat(64),
      state: 'needs_review',
      attempts: 1,
      statements: [],
      classification: null,
      origin: {
        period_candidates: [
          {
            receipt_id: 'r',
            period: { kind: 'FY', start_date: '2024-01-01', end_date: '2024-12-31' },
            basis: 'standalone',
            currency: 'VND',
            unit_multiplier: '1',
            role: 'comparative',
            status: 'pending',
            facts: [],
            existing_sets: [{ set_id: 's', revision: 1, source_names: [] }],
          },
        ],
      },
    },
    page = {
      contract_version: 'AIC-FINANCIAL-INTAKE-1',
      revision: 1,
      items: [item],
      review: {
        confirmed: false,
        stale: false,
        processing: false,
        source_snapshot_hash: 'a'.repeat(64),
        id: null,
        confirmed_at: null,
      },
    }
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  let response = page
  globalThis.fetch = async () =>
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  await assert.doesNotReject(() => intakeApi.list('synthetic'))
  for (const edit of [
    (c) => (c.role = 'invented'),
    (c) => (c.facts = [{ key: 'cash', value: 'NaN', page: 1, quote: 'cash' }]),
    (c) => (c.existing_sets[0].revision = 0.5),
  ]) {
    const copy = structuredClone(page)
    edit(copy.items[0].origin.period_candidates[0])
    response = copy
    await assert.rejects(
      () => intakeApi.list('synthetic'),
      (e) => e.code === 'INVALID_API_RESPONSE',
    )
  }
})
