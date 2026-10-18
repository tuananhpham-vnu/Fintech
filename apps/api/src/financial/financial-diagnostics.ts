import { Decimal } from './decimal'

/** Arithmetic observations, not rating thresholds, probabilities or cross-country calibration. */
const ratios = [
  ['current_ratio','current_assets','current_liabilities'],
  ['liabilities_to_assets','total_liabilities','total_assets'],
  ['equity_to_assets','total_equity','total_assets'],
  ['interest_debt_to_assets','interest_bearing_debt','total_assets'],
  ['operating_margin','operating_profit','net_revenue'],
  ['operating_cash_margin','cash_from_operations','net_revenue'],
  ['interest_coverage','operating_profit','interest_expense'],
] as const
export function financialDiagnostics(set:any) {
  const zero=Decimal.parse('0')
  const read=(key:string)=>{
    const f=set?.facts.find((f:any)=>f.key===key)
    if(!f||f.normalized_decimal===null)return {key,status:'missing',value:null,fact_id:f?.id??null}
    if(!f.current_source||f.verification.status==='stale')return {key,status:'stale',value:null,fact_id:f.id}
    if(f.verification.status!=='verified')return {key,status:f.verification.status,value:null,fact_id:f.id}
    return {key,status:'verified',value:Decimal.parse(f.normalized_decimal),fact_id:f.id}
  }
  const scopeValid=!!set&&set.metadata.observation_kind==='actual'&&set.scope.accounting_regime!=='UNKNOWN'
  const metrics=ratios.map(([id,numerator,denominator])=>{
    const a=read(numerator),b=read(denominator),issues:string[]=[]
    if(!scopeValid)issues.push('ACTUAL_KNOWN_ACCOUNTING_BASIS_REQUIRED')
    for(const f of [a,b])if(f.status!=='verified')issues.push(f.key+':'+f.status)
    if(b.value&&b.value.compare(zero)<=0)issues.push('NONPOSITIVE_DENOMINATOR')
    const value=issues.length?null:a.value!.div(b.value!)
    return {id,numerator,denominator,status:value?'available':'unavailable',value:value?.toExact()??null,
      display:value?.format(6)??null,issues,source_fact_ids:[a.fact_id,b.fact_id].filter(Boolean)}
  })
  const observations:{code:string;source_fact_ids:string[]}[]=[]
  if(scopeValid)for(const key of ['total_equity','operating_profit','cash_from_operations']){
    const f=read(key)
    if(f.value&&f.value.compare(zero)<0)observations.push({code:'NEGATIVE_'+key.toUpperCase(),source_fact_ids:[f.fact_id]})
  }
  const assets=read('current_assets'),liabilities=read('current_liabilities')
  if(scopeValid&&assets.value&&liabilities.value&&assets.value.compare(liabilities.value)<0)
    observations.push({code:'CURRENT_LIABILITIES_EXCEED_CURRENT_ASSETS',source_fact_ids:[assets.fact_id,liabilities.fact_id]})
  const a=read('total_assets'),l=read('total_liabilities'),e=read('total_equity')
  const residual=scopeValid&&a.value&&l.value&&e.value?a.value.sub(l.value).sub(e.value):null
  return {contract_version:'AIC-FINANCIAL-DIAGNOSTICS-1',set_id:set?.id??null,
    scope:set?.scope??null,credit_score:null,pd:null,metrics,observations,
    balance_check:{status:!residual?'unavailable':residual.compare(zero)===0?'exact':'not_exact',residual:residual?.toString()??null},
    limitations:['VERIFIED_FACTS_ONLY','ACCOUNTING_BASIS_DIFFERS_BY_COUNTRY','NO_FX_OR_ANNUALIZATION',
      'NO_CALIBRATED_CREDIT_SCORE_OR_PD','NONEXACT_BALANCE_CAN_INCLUDE_ROUNDING_OR_SCOPE_DIFFERENCES']}
}
