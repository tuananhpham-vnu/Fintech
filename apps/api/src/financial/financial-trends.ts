/** Read-only comparison rules, AIC-FINANCIAL-TRENDS-1. No scoring or imputation. */
export function financialComparisonIssues(set: any, baseline: any, all: any[]): string[] {
  const issues: string[] = [];
  const p = set.scope.period;
  const year = p.start_date.slice(0, 4);
  // Only full calendar FY is supported. Short, opening and shifted fiscal periods
  // remain visible with a reason; they are never annualized or silently aligned.
  if (p.kind !== 'FY' || p.start_date !== `${year}-01-01` || p.end_date !== `${year}-12-31`)
    issues.push('FULL_CALENDAR_FY_REQUIRED');
  if (set.metadata.observation_kind !== 'actual' || set.scope.accounting_regime === 'UNKNOWN')
    issues.push('ACTUAL_KNOWN_ACCOUNTING_BASIS_REQUIRED');
  for (const key of ['entity_id', 'country', 'industry', 'pilot_scope', 'basis', 'accounting_regime', 'currency', 'unit_multiplier'])
    if (set.scope[key] !== baseline.scope[key]) issues.push('INCOMPATIBLE_' + key.toUpperCase());
  if (all.some(s => s.id !== set.id && s.scope.period.start_date === p.start_date &&
    s.scope.period.end_date === p.end_date && s.scope.basis === set.scope.basis))
    issues.push('MULTIPLE_STATEMENT_VERSIONS');
  return issues;
}

export function verifiedTrendFacts(set: any) {
  return ['net_revenue', 'operating_profit', 'cash_from_operations', 'interest_bearing_debt', 'total_equity'].map(key => {
    const f = set.facts.find((f: any) => f.key === key);
    const valid = f && f.normalized_decimal !== null && f.current_source && f.verification.status === 'verified';
    return { key, value: valid ? f.normalized_decimal : null,
      fact_id: f?.id ?? null, fact_revision: f?.revision ?? null,
      status: valid ? 'verified' : !f || f.normalized_decimal === null ? 'missing' : !f.current_source || f.verification.status === 'stale' ? 'stale' : f.verification.status === 'rejected' ? 'rejected' : 'unverified' };
  });
}
