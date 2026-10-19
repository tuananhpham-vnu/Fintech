const {test}=require('node:test'), assert=require('node:assert/strict')
const input=require('./helpers/fhi-input.cjs')
const {scoreFhi}=require('../dist/financial/fhi-scorer')
const {aggregateCaseAssessment:aggregate}=require('../dist/financial/case-assessment')
const {partialAssessment}=require('../dist/financial/partial-assessment')
const {Decimal}=require('../dist/financial/decimal')
function record(year,changes={},missing=[]) {
  const i=input(), id='set-'+year
  i.statement_set.id=id
  i.statement_set.scope.period={kind:'FY',start_date:year+'-01-01',end_date:year+'-12-31'}
  i.facts=i.facts.filter(f=>!missing.includes(f.key))
  for(const f of i.facts){f.id=year+'-'+f.key;f.statement_set_id=id;f.value=changes[f.key]??f.value;f.scope=i.statement_set.scope}
  for(const b of [i.quick_assets_bridge,i.ebitda_bridge]) {
    b.statement_set_id=id
    for(const c of b.components)c.fact_id=year+'-'+c.key
  }
  return {set:{id,revision:1,scope:i.statement_set.scope,metadata:{observation_kind:'actual'},facts:i.facts},engine:scoreFhi(i),blockers:[]}
}
const number=v=>Number(v.numerator)/Number(v.denominator)

test('one FY reproduces its original points and multiple years average points, applying each weight once',()=>{
  const a=record('2024',{current_assets:'75',cash:'15',unrestricted_short_term_equivalents:'10',trade_receivables:'25'}), b=record('2025'), snapshot=JSON.stringify([a,b])
  assert.equal(aggregate([b]).engine.calculation.display_total,b.engine.calculation.display_total)
  const result=aggregate([a,b]), m=result.engine.metrics[0]
  assert.equal(number(m.points),9,'Mean of the 3 and 15 earned points, not the score of the mean ratio')
  assert.equal(m.raw_ratio,null)
  assert.equal(result.engine.calculation.status,'complete')
  assert.equal(number(result.engine.calculation.exact_total),
    (number(a.engine.calculation.exact_total)+number(b.engine.calculation.exact_total))/2)
  assert.equal(result.summary.metrics[0].contributions.length,2)
  assert.equal(new Set(m.source_facts.map(f=>f.id)).size,4)
  assert.equal(JSON.stringify([a,b]),snapshot)
})
test('each metric has its own sample count; missing observations have no vote and verified zero remains a vote',()=>{
  const a=record('2024',{current_assets:'0'}),b=record('2025'), c=record('2023',{},['current_assets'])
  const result=aggregate([a,b,c])
  assert.equal(number(result.engine.metrics[0].points),7.5)
  assert.equal(result.summary.metrics[0].contributions.length,2)
  assert.equal(result.summary.metrics[2].contributions.length,3)
  assert.equal(result.summary.metrics[0].omitted_sets.length,1)
})
test('new empty quarter and forecast/unknown regime do not erase verified annual evidence',()=>{
  const annual=record('2025'), quarter=record('2026',{},['current_assets','current_liabilities','cash','unrestricted_short_term_equivalents','trade_receivables','total_equity','total_assets','total_liabilities','interest_bearing_debt','operating_profit','depreciation_amortization','interest_expense','net_revenue','cash_from_operations'])
  quarter.set.scope.period={kind:'INTERIM',start_date:'2026-04-01',end_date:'2026-06-30'}
  quarter.set.scope.accounting_regime='UNKNOWN'
  const forecast=record('2027'); forecast.set.metadata.observation_kind='forecast'
  const result=aggregate([annual,quarter,forecast])
  assert.equal(result.engine.calculation.display_total,annual.engine.calculation.display_total)
  assert.deepEqual(result.summary.included_set_ids,[annual.set.id])
  assert.equal(result.summary.excluded_sets.length,2)
  assert.deepEqual(result.blockers,[])
})
test('missing metrics retain original partial weights and bounds; different periods cannot fill a ratio together',()=>{
  const a=record('2024',{},['current_assets','trade_receivables','depreciation_amortization']),
    b=record('2025',{},['current_liabilities','trade_receivables','depreciation_amortization'])
  const result=aggregate([a,b]), partial=partialAssessment(result.engine,{company:true,policyActive:true,reviewAllowed:true,blockers:result.blockers})
  assert.equal(result.engine.metrics[0].status,'unavailable')
  assert.equal(partial.available_max_points,'65')
  assert.equal(partial.unresolved_max_points,'35')
  assert.equal(result.engine.calculation.display_total,null)
  assert.deepEqual(result.summary.metrics[0].contributions,[])
})
test('unreconciled same-period copies and incompatible cohorts cannot silently authorize a total',()=>{
  const a=record('2024'),b=record('2024');b.set.id='another-copy'
  const duplicate=aggregate([a,b,record('2025')])
  assert.ok(duplicate.blockers.includes('MULTIPLE_STATEMENT_VERSIONS'))
  assert.equal(duplicate.summary.metrics[0].contributions.length,1)
  for(const key of ['basis','accounting_regime','currency','entity_id']) {
    const a=record('2024'),b=record('2025');b.set.scope[key]='different'
    assert.ok(aggregate([a,b]).blockers.includes('INCOMPATIBLE_CASE_SCOPE'))
  }
})
test('exact arithmetic averages repeating values before display; no-data and out-of-scope cannot produce a total',()=>{
  const a=record('2024'),b=record('2025')
  a.engine.metrics[0].points=Decimal.fraction(1n,3n).toExact()
  b.engine.metrics[0].points=Decimal.fraction(2n,3n).toExact()
  assert.equal(aggregate([a,b]).engine.metrics[0].points.decimal,'0.5')
  assert.equal(aggregate([]).engine.calculation.display_total,null)
  const bad=record('2025');bad.blockers=['INVALID_SCOPE']
  assert.equal(aggregate([bad]).engine.calculation.display_total,null)
})

test('unknown industry preserves the exclusion reason without erasing valid annual contributors',()=>{
  const unknown=record('2024')
  unknown.set.scope.industry='UNKNOWN'
  unknown.set.scope.pilot_scope='UNKNOWN'
  unknown.engine=scoreFhi({...input(),statement_set:{...input().statement_set,scope:unknown.set.scope}})
  const blocked=aggregate([unknown])
  assert.ok(blocked.blockers.includes('OUT_OF_PILOT_SCOPE'))
  assert.equal(blocked.summary.included_set_ids.length,0)
  assert.equal(blocked.engine.calculation.display_total,null)
  const valid=record('2025'), mixed=aggregate([unknown,valid])
  assert.deepEqual(mixed.summary.included_set_ids,[valid.set.id])
  assert.equal(mixed.engine.calculation.display_total,valid.engine.calculation.display_total)
  assert.ok(!mixed.blockers.includes('OUT_OF_PILOT_SCOPE'))
})
