const {test}=require('node:test')
const assert=require('node:assert/strict')
const {financialDiagnostics}=require('../dist/financial/financial-diagnostics')
const set=(country='VN')=>({id:'set-1',scope:{country,accounting_regime:country==='US'?'US_GAAP':country==='CN'?'CN_ASBE':'VN_TT133'},
  metadata:{observation_kind:'actual'},facts:Object.entries({current_assets:'500',current_liabilities:'250',total_assets:'1000',
    total_liabilities:'600',total_equity:'400',interest_bearing_debt:'200',operating_profit:'-50',net_revenue:'1000',
    cash_from_operations:'-20',interest_expense:'10'}).map(([key,normalized_decimal])=>({id:key,key,normalized_decimal,
      current_source:true,verification:{status:'verified'}}))})
for(const country of ['VN','US','CN'])test(`${country}: verified exact ratios and observations without credit score or PD`,()=>{
  const result=financialDiagnostics(set(country))
  assert.equal(result.metrics.find(m=>m.id==='current_ratio').value.decimal,'2')
  assert.equal(result.metrics.find(m=>m.id==='liabilities_to_assets').value.decimal,'0.6')
  assert.equal(result.metrics.find(m=>m.id==='interest_coverage').value.decimal,'-5')
  assert.equal(result.balance_check.status,'exact')
  assert.ok(result.observations.some(o=>o.code==='NEGATIVE_OPERATING_PROFIT'))
  assert.ok(result.observations.some(o=>o.code==='NEGATIVE_CASH_FROM_OPERATIONS'))
  assert.equal(result.credit_score,null);assert.equal(result.pd,null)
})
test('unverified/stale facts and nonpositive denominators never enter ratios',()=>{
  const input=set('US');input.facts.find(f=>f.key==='current_assets').verification.status='unverified'
  input.facts.find(f=>f.key==='interest_expense').normalized_decimal='0'
  input.facts.find(f=>f.key==='net_revenue').current_source=false
  const result=financialDiagnostics(input)
  for(const id of ['current_ratio','interest_coverage','operating_margin','operating_cash_margin'])
    assert.equal(result.metrics.find(m=>m.id===id).value,null)
})
test('unknown regime / forecast withhold arithmetic and do not manufacture zeros',()=>{
  const input=set();input.scope.accounting_regime='UNKNOWN'
  assert.ok(financialDiagnostics(input).metrics.every(m=>m.value===null))
  input.scope.accounting_regime='VN_TT133';input.metadata.observation_kind='forecast'
  assert.ok(financialDiagnostics(input).metrics.every(m=>m.value===null))
  assert.ok(financialDiagnostics(undefined).metrics.every(m=>m.value===null))
})
test('balance residual retained without inventing tolerance or rewriting source totals',()=>{
  const input=set();input.facts.find(f=>f.key==='total_equity').normalized_decimal='399'
  const result=financialDiagnostics(input)
  assert.deepEqual(result.balance_check,{status:'not_exact',residual:'1'})
  assert.equal(input.facts.find(f=>f.key==='total_equity').normalized_decimal,'399')
})
