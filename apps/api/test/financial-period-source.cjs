const {test}=require('node:test'),assert=require('node:assert/strict');
const {unresolvedIntakes}=require('../dist/financial/financial-review-state');
const {reportingColumnRole,identicalPeriodFigures}=require('../dist/financial/financial-period-source');

test('column roles ignore shared headings and use the reporting-year evidence',()=>{
 const current={kind:'FY',start_date:'2024-01-01',end_date:'2024-12-31',basis:'standalone',
   evidence:[{quote:'[01] Kỳ tính thuế: Năm 2024'},{quote:'| Năm nay | Năm trước |'}]};
 const previous={...current,start_date:'2023-01-01',end_date:'2023-12-31',
   evidence:[{quote:'[01] Kỳ tính thuế: Năm 2024'},{quote:'Năm trước'}]};
 assert.equal(reportingColumnRole([current,previous],current),'current');
 assert.equal(reportingColumnRole([current,previous],previous),'comparative');
 assert.equal(reportingColumnRole([{...current,evidence:[{quote:'Năm nay | Năm trước'}]}],current),'unspecified');
 const other={...current,kind:'INTERIM',start_date:'2024-04-01'};
 assert.equal(reportingColumnRole([current,other],other),'current');
 assert.equal(reportingColumnRole([{...other,evidence:[]}],other),'unspecified');
});

test('identical sources require the same known facts and scope, with exact decimal comparison',()=>{
 const scope={period:{kind:'FY',start_date:'2024-01-01',end_date:'2024-12-31'},basis:'standalone',
   currency:'VND',unit_multiplier:'1',accounting_regime:'VN_TT200'};
 const output={scope:{...scope,period_kind:'FY',start_date:scope.period.start_date,end_date:scope.period.end_date},
   facts:[{key:'net_revenue',value:'9007199254740993.00'}]};
 const facts=[{key:'net_revenue',raw_value:'9007199254740993'}];
 assert.equal(identicalPeriodFigures(scope,facts,output),true);
 assert.equal(identicalPeriodFigures(scope,facts,{...output,facts:[{key:'net_revenue',value:'9007199254740992'}]}),false);
 assert.equal(identicalPeriodFigures(scope,[...facts,{key:'cash',raw_value:'0'}],output),false);
 assert.equal(identicalPeriodFigures(scope,facts,{...output,facts:[...output.facts,{key:'cash',value:'0'}]}),false);
 assert.equal(identicalPeriodFigures(scope,[],{...output,facts:[]}),false);
 for (const [key,value] of Object.entries({currency:'USD',unit_multiplier:'1000',basis:'consolidated',accounting_regime:'IFRS',start_date:'2024-04-01'}))
   assert.equal(identicalPeriodFigures(scope,facts,{...output,scope:{...output.scope,[key]:value}}),false,key);
 assert.equal(identicalPeriodFigures(scope,facts,{...output,calculations:[{id:'new'}]}),false);
});
test('a resolved Q2 does not resolve an unextracted cumulative period sharing its end date',()=>{
 const quarter={kind:'INTERIM',start_date:'2026-04-01',end_date:'2026-06-30',basis:'standalone'};
 const cumulative={...quarter,start_date:'2026-01-01'};
 const row={state:'needs_review',classification_json:{document_type:'financial_statement',periods:[quarter,cumulative]},
   origin_json:{},result_json:[{...quarter,set_id:'quarter'}]};
 assert.equal(unresolvedIntakes([row]).length,1);
 row.result_json.push({...cumulative,set_id:'cumulative'});
 assert.equal(unresolvedIntakes([row]).length,0);
 row.origin_json.period_candidates=[{period:cumulative,basis:'standalone',status:'pending'}];
 assert.equal(unresolvedIntakes([row]).length,1);
 row.origin_json.period_candidates[0].status='kept';
 assert.equal(unresolvedIntakes([row]).length,0);
});
