// Synthetic values only. No customer financial statements or identifiers.
module.exports = function fhiInput() {
  const scope = { country: 'VN', entity_id: 'synthetic', industry: 'wholesale',
    pilot_scope: 'DISTRIBUTION_WHOLESALE_PILOT',
    period: { kind: 'FY', start_date: '2025-01-01', end_date: '2025-12-31' },
    basis: 'standalone', accounting_regime: 'VN_TT200', currency: 'VND', unit_multiplier: '1' }
  const verification = { status: 'verified', verified_revision: 1,
    verified_by: 'synthetic-specialist', verified_at: '2026-01-01T00:00:00Z' }
  const values = { current_assets: '200', current_liabilities: '100', cash: '30',
    unrestricted_short_term_equivalents: '20', trade_receivables: '50', total_assets: '500',
    total_liabilities: '300', total_equity: '200', interest_bearing_debt: '100',
    operating_profit: '80', depreciation_amortization: '20', interest_expense: '20',
    net_revenue: '400', cash_from_operations: '32' }
  const facts = Object.entries(values).map(([key, value]) => ({
    id: key, key, value, revision: 1, scope, statement_set_id: 'synthetic-set',
    statement_set_revision: 1, verification, current_source: true,
    source_refs: [{ kind: 'verified_entry', entry_id: key, entry_revision: 1 }],
  }))
  function bridge(kind, keys) {
    return { id: kind, revision: 1, kind, statement_set_id: 'synthetic-set',
      statement_set_revision: 1, verification, current_source: true,
      source_refs: [{ kind: 'verified_entry', entry_id: kind, entry_revision: 1 }],
      components: keys.map(key => ({ key, fact_id: key, fact_revision: 1 })),
      non_overlapping: true }
  }
  return { statement_set: { id: 'synthetic-set', revision: 1, scope }, facts,
    quick_assets_bridge: { ...bridge('quick_assets', ['cash', 'unrestricted_short_term_equivalents', 'trade_receivables']), acceptable_per_source: true },
    ebitda_bridge: { ...bridge('ebitda', ['operating_profit', 'depreciation_amortization']), da_is_addback_to_ebit: true },
  }
}
