const {test}=require('node:test'); const assert=require('node:assert/strict');
const {financialComparisonIssues:issues,verifiedTrendFacts:facts}=require('../dist/financial/financial-trends');
const {standaloneTrendEligible}=require('../dist/financial/financial-trends');
const set=(year,id=year)=>({id,scope:{entity_id:'company',country:'VN',industry:'wholesale',pilot_scope:'wholesale',basis:'standalone',accounting_regime:'VAS_TT133',currency:'VND',unit_multiplier:'1000',period:{kind:'FY',start_date:`${year}-01-01`,end_date:`${year}-12-31`}},metadata:{observation_kind:'actual'},facts:[]});
test('same full FY scope across years; inputs remain immutable',()=>{const a=set('2024'),b=set('2025'); const before=JSON.stringify([a,b]);assert.deepEqual(issues(a,b,[a,b]),[]);assert.equal(JSON.stringify([a,b]),before)});
test('currency, units, basis, regime and entity cannot be silently aligned',()=>{for(const key of ['currency','unit_multiplier','basis','accounting_regime','entity_id','industry','pilot_scope']){const a=set('2024'),b=set('2025');a.scope[key]='other';assert.ok(issues(a,b,[a,b]).includes('INCOMPATIBLE_'+key.toUpperCase()))}});
test('short/opening, forecast, unknown regime and restatement ambiguity remain excluded',()=>{let a=set('2024'),b=set('2025');a.scope.period.start_date='2024-04-01';assert.ok(issues(a,b,[a,b]).includes('FULL_CALENDAR_FY_REQUIRED'));a=set('2024');a.metadata.observation_kind='forecast';assert.ok(issues(a,b,[a,b]).includes('ACTUAL_KNOWN_ACCOUNTING_BASIS_REQUIRED'));a=set('2024');assert.ok(issues(a,b,[a,b,set('2024','restated')]).includes('MULTIPLE_STATEMENT_VERSIONS'))});
test('only verified current facts retain exact decimal values; no zero fill',()=>{const a=set('2025');a.facts=[{id:'a',revision:2,key:'net_revenue',normalized_decimal:'9007199254740993.001',current_source:true,verification:{status:'verified'}},{id:'b',revision:1,key:'operating_profit',normalized_decimal:'80',current_source:true,verification:{status:'unverified'}},{id:'c',revision:1,key:'cash_from_operations',normalized_decimal:'32',current_source:false,verification:{status:'verified'}}];const out=facts(a);assert.equal(out[0].value,'9007199254740993.001');assert.equal(out[1].value,null);assert.equal(out[2].status,'stale');assert.equal(out[3].status,'missing');assert.equal(out[4].value,null)});
test('rejected source decisions remain distinct from not-yet-verified data',()=>{const a=set('2025');a.facts=[{id:'a',revision:1,key:'net_revenue',normalized_decimal:'400',current_source:true,verification:{status:'rejected'}}];assert.equal(facts(a)[0].value,null);assert.equal(facts(a)[0].status,'rejected')});

test('empty newer interim with unknown regime does not erase a valid annual column',()=>{
  const annual=set('2025'), empty=set('2026');
  empty.scope.period={kind:'INTERIM',start_date:'2026-04-01',end_date:'2026-06-30'};
  empty.scope.accounting_regime='UNKNOWN';
  assert.ok(issues(annual,empty,[annual,empty]).length);
  assert.equal(standaloneTrendEligible(annual,[annual,empty]),true);
  assert.equal(standaloneTrendEligible(empty,[annual,empty]),false);
  assert.equal(standaloneTrendEligible(annual,[annual,set('2025','unresolved-copy')]),false);
});
