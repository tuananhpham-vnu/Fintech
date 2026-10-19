const {test}=require('node:test'), assert=require('node:assert/strict');
const sample=require('./helpers/fhi-input.cjs');
const {scoreFhi}=require('../dist/financial/fhi-scorer');
const {partialAssessment}=require('../dist/financial/partial-assessment');
const {aggregateCaseAssessment}=require('../dist/financial/case-assessment');
const {ACCOUNTING_PROFILES,fullFinancialYear,accountingProfile,profileMethodHash,intakeCountryEnabled}=require('../dist/financial/accounting-profiles');

function international(country,combined=false) {
 const input=structuredClone(sample()), profile=ACCOUNTING_PROFILES.find(p=>p.country===country);
 const scope=input.statement_set.scope;
 Object.assign(scope,{country,accounting_regime:profile.accounting_regime,currency:country==='US'?'USD':'CNY'});
 scope.period=country==='US'?{kind:'FY',start_date:'2024-12-01',end_date:'2025-11-30'}:scope.period;
 input.facts.forEach(f=>f.scope=scope);
 input.accounting_profile=profile;
 input.international_operating_profit_reconciled=true;
 if(combined) {
  const cash=structuredClone(input.facts.find(f=>f.key==='cash'));
  Object.assign(cash,{id:'aggregate-cash',key:'eligible_cash_and_equivalents',value:'50'});
  input.facts=input.facts.filter(f=>!['cash','unrestricted_short_term_equivalents'].includes(f.key));
  input.facts.push(cash);
  input.quick_assets_bridge.components=[{key:cash.key,fact_id:cash.id,fact_revision:1},input.quick_assets_bridge.components.find(c=>c.key==='trade_receivables')];
 }
 return input;
}
function fact(input,key,value) {input.facts.find(f=>f.key===key).value=value;}
function record(input,id='set') {
 const engine=scoreFhi(input);
 return {set:{id,revision:1,scope:structuredClone(input.statement_set.scope),metadata:{observation_kind:'actual'},facts:input.facts},engine,blockers:engine.blockers.map(b=>b.code)};
}

for(const country of ['US','CN']) {
 const scenarios=[
  ['separate source components',()=>{},r=>assert.equal(r.calculation.display_total,'82.5')],
  ['combined cash preserves score',()=>{},r=>assert.equal(r.calculation.display_total,'82.5'),true],
  ['aggregate is alternative, not additional',i=>{const f=structuredClone(i.facts[0]);Object.assign(f,{id:'unused-cash',key:'cash',value:'999999'});i.facts.push(f);},r=>assert.equal(r.calculation.display_total,'82.5'),true],
  ['unverified aggregate stays unavailable',i=>i.facts.find(f=>f.key==='eligible_cash_and_equivalents').verification={status:'unverified'},r=>assert.equal(r.metrics[1].status,'unavailable'),true],
  ['aggregate bridge must bind its actual source',i=>i.quick_assets_bridge.components[0].fact_id='invented',r=>assert.ok(r.metrics[1].blockers.some(b=>b.code==='QUICK_ASSETS_UNAVAILABLE')),true],
  ['restricted/ineligible components do not score',i=>i.quick_assets_bridge.acceptable_per_source=false,r=>assert.equal(r.metrics[1].status,'unavailable'),true],
  ['missing receivable has no invented zero',i=>i.facts=i.facts.filter(f=>f.key!=='trade_receivables'),r=>assert.equal(r.metrics[1].points,null),true],
  ['nonpositive EBITDA is not a healthy zero',i=>{fact(i,'operating_profit','-20');fact(i,'depreciation_amortization','10');},r=>assert.ok(r.metrics[3].blockers.some(b=>b.code==='EBITDA_NON_POSITIVE'))],
  ['zero current liability is explicit',i=>fact(i,'current_liabilities','0'),r=>assert.equal(r.metrics[0].points,null)],
  ['negative cash rejected',i=>fact(i,'cash','-1'),r=>assert.ok(r.metrics[1].blockers.some(b=>b.code==='INVALID_FINANCIAL_BOUNDS'))],
  ['source rounding bounded by three quantums',i=>{fact(i,'total_assets','501');i.rounding_quantums={total_assets:'1',total_liabilities:'1',total_equity:'1'};},r=>assert.ok(r.metrics[2].flags.includes('BALANCE_WITHIN_SOURCE_ROUNDING'))],
  ['no inferred rounding tolerance',i=>fact(i,'total_assets','501'),r=>assert.ok(r.metrics[2].blockers.some(b=>b.code==='BALANCE_SHEET_UNRECONCILED'))],
  ['exact unit scaling leaves score unchanged',i=>i.facts.forEach(f=>f.value=String(BigInt(f.value)*1000000n)),r=>assert.equal(r.calculation.display_total,'82.5')],
  ['wrong source period cannot enter a ratio',i=>i.facts.find(f=>f.key==='net_revenue').scope={...i.statement_set.scope,period:{kind:'FY',start_date:'2023-01-01',end_date:'2023-12-31'}},r=>assert.equal(r.metrics[5].points,null)],
  [country==='CN'?'legacy CAS needs reviewed reconciliation':'forged profile rejected',i=>{if(country==='CN')i.international_operating_profit_reconciled=false;else i.accounting_profile={...i.accounting_profile,id:'CN_ASBE_DISTRIBUTION_1'};},r=>assert.ok(r.blockers.length)],
 ];
 for(const [name,mutate,check,combined] of scenarios) test(`${country}: ${name}`,()=>{
  const input=international(country,combined); mutate(input);const result=scoreFhi(input);check(result);
  assert.equal(result.score,null);assert.equal(result.pd,null);
  assert.equal(result.method_version,input.accounting_profile.id.startsWith(country)?input.accounting_profile.method_version:'1.0.0');
 });
}
test('international annual eligibility accepts shifted and weeks-based years, rejects stubs and malformed dates',()=>{
 for(const [start_date,end_date,yes] of [['2024-12-01','2025-11-30',true],['2024-09-29','2025-09-27',true],['2023-09-24','2024-09-28',true],['2025-01-01','2025-12-31',true],['2025-01-01','2025-06-30',false],['2025-02-30','2026-02-28',false]])
  assert.equal(fullFinancialYear({kind:'FY',start_date,end_date}),yes);
});
test('case average retains fixed weights and explicitly selected basis',()=>{
 const first=international('CN',true),second=international('CN',true),parent=international('CN',true);
 second.statement_set.scope.period={kind:'FY',start_date:'2024-01-01',end_date:'2024-12-31'};second.facts.forEach(f=>f.scope=second.statement_set.scope);
 first.statement_set.scope.basis='consolidated';second.statement_set.scope.basis='consolidated';
 parent.statement_set.scope.basis='standalone';
 const combined=aggregateCaseAssessment([record(first,'fy25'),record(second,'fy24'),record(parent,'parent')],'consolidated');
 assert.equal(combined.engine.calculation.display_total,'82.5');
 assert.deepEqual(combined.summary.included_set_ids.sort(),['fy24','fy25']);
 assert.ok(combined.summary.excluded_sets.find(s=>s.set_id==='parent').reasons.includes('REPORTING_BASIS_NOT_SELECTED'));
 assert.equal(combined.summary.accounting_profile.country,'CN');
});
test('partial international score retains covered denominator and no missing vote',()=>{
 const input=international('US',true);input.facts=input.facts.filter(f=>f.key!=='interest_expense');
 const result=record(input),combined=aggregateCaseAssessment([result]);
 const partial=partialAssessment(combined.engine,{company:true,policyActive:true,reviewAllowed:true,blockers:combined.blockers});
 assert.equal(partial.available_max_points,'85');assert.equal(partial.unresolved_max_points,'15');
 assert.equal(combined.engine.calculation.exact_total,null);
});
test('countries need separate approvals; profiles never reclassify IFRS as US GAAP',()=>{
 assert.equal(accountingProfile({...international('US').statement_set.scope,accounting_regime:'IFRS'}),null);
 assert.equal(intakeCountryEnabled({},'org','US',new Date().toISOString()),false);
 assert.equal(intakeCountryEnabled({},'org','VN',new Date().toISOString()),true);
 assert.notEqual(profileMethodHash(ACCOUNTING_PROFILES[0]),profileMethodHash(ACCOUNTING_PROFILES[1]));
});
test('parenthesized interest needs an explicit source-sign review and never mutates raw facts',()=>{
 const input=international('US');fact(input,'interest_expense','-20');
 assert.equal(scoreFhi(input).metrics[4].points,null);
 input.reviewed_expense_magnitude_fact_ids=['interest_expense'];
 const scored=scoreFhi(input);assert.equal(scored.calculation.display_total,'82.5');
 assert.ok(scored.metrics[4].flags.includes('SOURCE_EXPENSE_MAGNITUDE_REVIEWED:interest_expense'));
 assert.equal(input.facts.find(f=>f.key==='interest_expense').value,'-20');
});
test('an aggregate-cash source observation does not invalidate the other 14 reasoning targets',()=>{
 const {solveReasoning}=require('../dist/financial/financial-reasoning');
 const scope={country:'US',start_date:'2025-01-01',end_date:'2025-12-31',basis:'consolidated',currency:'USD',unit_multiplier:'1'};
 const values={total_liabilities:'60',current_liabilities:'25',eligible_cash_and_equivalents:'15'};
 const graph=require('./helpers/reasoning-fixture.cjs')(scope,values);
 const result=solveReasoning(graph,scope);
 assert.equal(result.resolutions.length,14);
 assert.ok(!result.diagnostics.some(d=>/INVALID_VARIABLE|INVALID_REASONING_GRAPH/.test(d.code)));
 assert.equal(result.resolutions.find(r=>r.key==='current_liabilities').value,'25');
});
