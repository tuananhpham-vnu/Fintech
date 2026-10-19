import { Decimal } from './decimal';

/** A table heading containing both labels does not identify either column. */
export function reportingColumnRole(periods: any[], period: any): 'current' | 'comparative' | 'unspecified' {
  const item = periods.find(p => p.kind === period.kind && p.end_date === period.end_date &&
    p.start_date === period.start_date && p.basis === period.basis);
  let current = false, comparative = false, reportingYear = false;
  for (const e of item?.evidence ?? []) {
    const quote = e.quote.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase();
    const hasCurrent = /\bnam nay\b|\bcurrent year\b|\breporting year\b/.test(quote);
    const hasPrevious = /\bnam truoc\b|\bprevious year\b|\bprior year\b|\bcomparative\b|\bso sanh\b/.test(quote);
    if (hasCurrent && hasPrevious) continue;
    current ||= hasCurrent;
    comparative ||= hasPrevious;
    reportingYear ||= new RegExp(`\\b(?:nam(?: tai chinh)?|reporting year|year ended)\\s+(?:[^0-9]{0,20})?${period.end_date.slice(0, 4)}\\b`).test(quote);
  }
  if (current && comparative) return 'unspecified';
  if (comparative) return 'comparative';
  return current || reportingYear ? 'current' : 'unspecified';
}

/** Skip a source decision only for the same complete set of known values and scope. */
export function identicalPeriodFigures(scope: any, facts: any[], output: any): boolean {
  const incoming = output.scope;
  if (scope.period.kind !== incoming.period_kind || scope.period.start_date !== incoming.start_date ||
    scope.period.end_date !== incoming.end_date || scope.basis !== incoming.basis ||
    scope.currency !== incoming.currency || scope.unit_multiplier !== incoming.unit_multiplier ||
    scope.accounting_regime !== incoming.accounting_regime || !output.facts.length ||
    output.calculations?.length || output.reasoning) return false;
  const known = facts.filter(f => f.raw_value !== null && f.raw_value !== undefined);
  if (known.length !== output.facts.length || new Set(known.map(f => f.key)).size !== known.length ||
    new Set(output.facts.map((f: any) => f.key)).size !== output.facts.length) return false;
  return output.facts.every((f: any) => {
    const active = known.find(a => a.key === f.key);
    return !!active && Decimal.parse(active.raw_value).compare(Decimal.parse(f.value)) === 0;
  });
}
