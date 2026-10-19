require('../helpers/register-typescript.cjs')
const {test}=require('node:test'),assert=require('node:assert/strict')
const {caseAggregation}=require('../../src/lib/api/decoders.ts')
const {companyResult}=require('../../src/features/assessments/company-result.ts')
const {hasCompleteFhi,fhiMetrics}=require('../../src/features/assessments/fhi.ts')
const {CaseAggregationSources}=require('../../src/features/assessments/components/case-aggregation-sources.tsx')
const {renderToStaticMarkup}=require('react-dom/server'),{createElement}=require('react')
function summary(){return {method:'mean_metric_points_v1',included_set_ids:['2024','2025'],excluded_sets:[],
  metrics:fhiMetrics.map(m=>({metric_id:m.id,contributions:[2024,2025].map(y=>({set_id:String(y),set_revision:1,
    period:{kind:'FY',start_date:y+'-01-01',end_date:y+'-12-31'},points:m.max,raw_value:'1.25',source_fact_ids:['fact-'+y]})),omitted_sets:[]}))}}
test('case decoder preserves per-year contributors and rejects duplicate periods, inflation, unsupported methods and unrelated sets',()=>{
  const good=summary(); assert.deepEqual(caseAggregation(good),good)
  for(const change of [s=>s.method='other',s=>s.metrics.push(s.metrics[0]),s=>s.metrics[0].contributions[0].points='100',
    s=>s.metrics[0].contributions.push(s.metrics[0].contributions[0]),s=>s.metrics[0].contributions[0].set_id='foreign',
    s=>s.metrics[0].contributions[0].period.kind='INTERIM',s=>s.included_set_ids.push('unused')]) {
    const s=summary();change(s);assert.throws(()=>caseAggregation(s))
  }
})
test('current aggregate result has no selected year; old single-period results cannot masquerade as case-wide totals',()=>{
  const result={purpose:'company_health',case_aggregation:summary(),state:'completed',case_id:'case',case_revision:3,
    checked_case_revision:3,stale:false,financial_set_id:null,financial_health:{status:'PREVIEW_ELIGIBLE',score:'100',band:'AIC-F1',blockers:[],
      components:fhiMetrics.map(m=>({metric_id:m.id,points:m.max,max_points:m.max,raw_value:null,source_facts:['fact'],blockers:[]}))}}
  const ctx={caseId:'case',revision:3,requireCaseAggregation:true,confirmed:true,loading:false,
    readiness:{case_revision:3,method_status:'configured_pilot',numeric_assessment_allowed:true,assessment_allowed:true,blockers:[]}}
  assert.equal(hasCompleteFhi(result),true)
  assert.equal(companyResult(result,ctx).complete,true)
  assert.equal(companyResult({...result,stale:true},ctx).complete,false)
  assert.equal(companyResult({...result,case_aggregation:undefined,financial_set_id:'2025'},{...ctx,setId:'2025'}).current,false)
})
test('aggregate source presentation identifies contributing years and exact source pages in every locale',()=>{
  const value=summary(),registry={sets:[2024,2025].map(y=>({id:String(y),revision:1,scope:{basis:'standalone'},
    facts:[{id:'fact-'+y,source:{kind:'financial_import',source_kind:'financial_file',source_id:'source-'+y,page:2}}]}))},
    page={items:[2024,2025].map(y=>({prepared_source_id:'source-'+y,name:'SYNTHETIC '+y+'.pdf'}))}
  for(const locale of ['vi','en','zh-CN']) {
    const html=renderToStaticMarkup(createElement(CaseAggregationSources,{value,registry,page,locale}))
    assert.match(html,/2024/);assert.match(html,/2025/)
    assert.match(html,/financial-files\/source-2024\/source#page=2/)
    assert.match(html,/SYNTHETIC 2025.pdf/)
  }
})

test('comparison reader accepts flagged standalone annual columns while preserving incompatible transaction and intrinsic-period guards',async()=>{
  const {financialApi}=require('../../src/features/financial/api.ts'),before=global.fetch
  const set={id:'annual',revision:1,created_at:'2026-10-19T00:00:00Z',scope:{entity_id:'synthetic',country:'VN',industry:'WHOLESALE',
    pilot_scope:'DISTRIBUTION_WHOLESALE_PILOT',period:{kind:'FY',start_date:'2025-01-01',end_date:'2025-12-31'},basis:'standalone',accounting_regime:'VN_TT200',currency:'VND',unit_multiplier:'1'},
    metadata:{observation_kind:'actual',audit_status:'unknown',statement_version:'synthetic'},facts:[],verification_stale:false}
  const row={set,standalone_values:true,comparison_issues:['INCOMPATIBLE_ACCOUNTING_REGIME'],gap_before:false,
    facts:[{key:'net_revenue',value:'400',status:'verified',fact_id:'synthetic',fact_revision:1}],metrics:[]}
  const body={contract_version:'AIC-FINANCIAL-TRENDS-1',case_revision:1,captured_at:'2026-10-19T00:00:00Z',baseline_set_id:null,baseline_metrics:[],rows:[row]}
  try {
    global.fetch=async()=>Response.json(body)
    assert.equal((await financialApi.trends('synthetic')).rows[0].facts[0].value,'400')
    for(const patch of [{standalone_values:undefined},{standalone_values:false},{comparison_issues:['FULL_CALENDAR_FY_REQUIRED']}]) {
      const bad=structuredClone(body);Object.assign(bad.rows[0],patch);global.fetch=async()=>Response.json(bad)
      await assert.rejects(financialApi.trends('synthetic'))
    }
  } finally {global.fetch=before}
})
