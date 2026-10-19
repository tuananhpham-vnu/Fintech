import { readFileSync } from 'node:fs';
import { Decimal } from './decimal';
import { requestHash } from '../foundation/canonical';
import { FHI_METHOD_ID, FHI_METRICS, FHI_PILOT_SCOPE } from './fhi-method';

export const INTERNATIONAL_CASH_KEY = 'eligible_cash_and_equivalents' as const;
export const INTERNATIONAL_METHOD_VERSIONS = ['1.0.0-us-gaap-pilot.1', '1.0.0-cn-asbe-pilot.1'] as const;
export type AccountingProfile = Readonly<{
  id: string; country: 'US' | 'CN'; accounting_regime: 'US_GAAP' | 'CN_ASBE';
  mapping_version: 'international-accounting-v1'; method_version: string;
}>;
export const ACCOUNTING_PROFILES: readonly AccountingProfile[] = Object.freeze([
  Object.freeze({id:'US_GAAP_DISTRIBUTION_1',country:'US',accounting_regime:'US_GAAP',mapping_version:'international-accounting-v1',method_version:INTERNATIONAL_METHOD_VERSIONS[0]} as const),
  Object.freeze({id:'CN_ASBE_DISTRIBUTION_1',country:'CN',accounting_regime:'CN_ASBE',mapping_version:'international-accounting-v1',method_version:INTERNATIONAL_METHOD_VERSIONS[1]} as const),
]);

export function accountingProfile(scope: any): AccountingProfile | null {
  return ACCOUNTING_PROFILES.find(p => p.country === scope?.country && p.accounting_regime === scope?.accounting_regime &&
    scope?.pilot_scope === FHI_PILOT_SCOPE && ['standalone','consolidated'].includes(scope?.basis)) ?? null;
}

/** Annual intervals remain source facts. Never infer dates or annualize a stub here. */
export function fullFinancialYear(period: any): boolean {
  if (period?.kind !== 'FY' || !/^\d{4}-\d{2}-\d{2}$/.test(period.start_date ?? '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(period.end_date ?? '')) return false;
  const start = new Date(period.start_date + 'T00:00:00Z'), end = new Date(period.end_date + 'T00:00:00Z');
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start.toISOString().slice(0,10)!==period.start_date ||
      end.toISOString().slice(0,10)!==period.end_date || start > end) return false;
  const days = (+end - +start) / 86400000 + 1;
  // A documented calendar anniversary or exactly 52/53 weeks; not a generic day-count tolerance.
  const next = new Date(end); next.setUTCDate(next.getUTCDate()+1);
  const anniversary = new Date(start); anniversary.setUTCFullYear(anniversary.getUTCFullYear()+1);
  return +next === +anniversary || days === 364 || days === 371;
}

export function profileMethodHash(profile: AccountingProfile) {
  return requestHash({profile, method_id:FHI_METHOD_ID, metrics:FHI_METRICS,
    quick_assets:'eligible cash aggregate OR separate components; verified disjoint net trade receivables',
    operating_profit:'before financing and nonoperating investment; complete sourced bridge required for legacy CAS',
    leases:'borrowings plus proven finance-lease components; no unclassified CAS lease liability',
    cfo:'as reported; no cross-country cash-flow reclassification',
    fiscal_year:'calendar anniversary or source-evidenced 52/53 weeks',
    rounding:'nearest rounding only when explicitly evidenced and reviewed; half sum of quantums'});
}

export interface InternationalPolicy {
  policy_id: string; status: 'configured_pilot'; organization_ids: string[];
  profiles: {profile_id:string; method_hash:string}[];
  approval: {by:string; recorded_at:string; source:string; scope:string};
  effective_from:string; effective_until:string|null;
}
export function loadInternationalPolicy(file: string | undefined): Readonly<InternationalPolicy> | undefined {
  if (!file) return undefined;
  const p = JSON.parse(readFileSync(file,'utf8'));
  const nonempty = (s:any) => typeof s==='string' && s.trim().length>0;
  const dated = (s:any) => nonempty(s) && Number.isFinite(Date.parse(s));
  if (!p || !nonempty(p.policy_id) || p.status!=='configured_pilot' || !Array.isArray(p.organization_ids) ||
      !p.organization_ids.length || p.organization_ids.some((id:any)=>typeof id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) ||
      new Set(p.organization_ids).size!==p.organization_ids.length || !Array.isArray(p.profiles) || !p.profiles.length ||
      new Set(p.profiles.map((v:any)=>v.profile_id)).size!==p.profiles.length || p.profiles.some((v:any)=>{
        const profile=ACCOUNTING_PROFILES.find(x=>x.id===v.profile_id); return !profile || v.method_hash!==profileMethodHash(profile);
      }) || !p.approval || !['by','source','scope'].every(k=>nonempty(p.approval[k])) || !dated(p.approval.recorded_at) ||
      !dated(p.effective_from) || Date.parse(p.effective_from)<Date.parse(p.approval.recorded_at) ||
      (p.effective_until!==null && (!dated(p.effective_until) || Date.parse(p.effective_until)<=Date.parse(p.effective_from))))
    throw new Error('Invalid AIC_INTERNATIONAL_POLICY_PATH approval artifact');
  p.profiles.forEach(Object.freeze); Object.freeze(p.profiles); Object.freeze(p.organization_ids); Object.freeze(p.approval);
  return Object.freeze(p);
}

export function internationalPolicy(config:any, organizationId:string, at:string, country?:string) {
  const p:InternationalPolicy|undefined=config.internationalPolicy, instant=Date.parse(at);
  if (!p || !p.organization_ids.includes(organizationId) || !Number.isFinite(instant) ||
      instant<Date.parse(p.approval.recorded_at) || instant<Date.parse(p.effective_from) ||
      (p.effective_until!==null && instant>=Date.parse(p.effective_until))) return null;
  const allowed=p.profiles.filter(v=>ACCOUNTING_PROFILES.some(x=>x.id===v.profile_id && (!country || x.country===country)));
  return allowed.length ? p : null;
}

export function intakeCountryEnabled(config:any, organizationId:string, country:string, at:string) {
  return country==='VN' || (['US','CN'].includes(country) && !!internationalPolicy(config,organizationId,at,country));
}

export function sameFinancialEntity(left:string, right:string) {
  const fold=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\p{P}\p{Z}\s]/gu,'');
  return !!left?.trim() && !!right?.trim() && fold(left)===fold(right);
}

/** An AI number is not permission to round away a real mismatch. */
export function sourceRoundingQuantum(label:string, quote:string, multiplier:string): string | null {
  if (!/round(?:ed|ing)\s+to\s+(?:the\s+)?nearest|四舍五入/.test((quote ?? '').toLowerCase())) return null;
  const token=label.match(/^-?\(?[\d,]+(?:\.(\d+))?\)?$/);
  if (!token) return null;
  return Decimal.parse(multiplier).div(Decimal.parse('1'+'0'.repeat(token[1]?.length ?? 0))).toString();
}
