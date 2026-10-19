const {test}=require('node:test'),assert=require('node:assert/strict');
const {solveReasoning,reasoningCalculations,reasoningSummary}=require('../dist/financial/financial-reasoning');
const scope={country:'VN',start_date:'2024-01-01',end_date:'2024-12-31',basis:'standalone',currency:'VND',unit_multiplier:'1'};
const variable=(id,key=null,extra={})=>({id,key,label:id,dimension:'money',nature:'instant',as_of:scope.end_date,...extra});
const observation=(variable_id,value,extra={})=>({id:'o_'+variable_id,variable_id,value,label:variable_id,raw_token:value.replace('.',','),page:1,
 quote:variable_id+' '+value.replace('.',','),period_start:scope.start_date,period_end:scope.end_date,basis:scope.basis,currency:scope.currency,unit_multiplier:'1',dimension:'money',...extra});
const relation=(id,positive,negative,extra={})=>({id,label:id,kind:'identity',reason:'SYNTHETIC complete partition',assumptions:[],evidence:[{page:1,quote:id}],
 terms:[...positive.map(variable_id=>({variable_id,coefficient:'1'})),...negative.map(variable_id=>({variable_id,coefficient:'-1'}))],...extra});
function graph(){return {version:'AIC-FINANCIAL-REASONING-1',variables:[variable('total','total_liabilities'),variable('long'),variable('short','current_liabilities'),variable('payable'),variable('loan','interest_bearing_debt')],
 observations:[observation('total','100'),observation('long','20'),observation('payable','30')],
 relations:[relation('partition',['total'],['short','long']),relation('current',['short'],['payable','loan'])],diagnostics:[],coverage:{pages_read:[1],pages_available:[1],complete:true}};}
const target=(g,key='interest_bearing_debt')=>solveReasoning(g,scope).resolutions.find(r=>r.key===key);
test('solves missing intermediate and target from extra printed components with complete leaf proof',()=>{
 const g=graph(),result=target(g);assert.equal(result.value,'50');assert.equal(result.code,null);
 assert.deepEqual(new Set(result.proof.leaf_ids),new Set(['o_total','o_long','o_payable']));
 assert.ok(result.proof.intermediate_values.some(v=>v.variable_id==='short'&&v.value.decimal==='80'));
 assert.equal(result.proof.steps.length,2);assert.equal(g.observations.length,3);
});
test('solves simultaneous equations without a single-unknown starting equation',()=>{
 const g=graph();g.variables=[variable('x','total_assets'),variable('y'),variable('a'),variable('b')];
 g.observations=[observation('a','100'),observation('b','20')];
 g.relations=[relation('one',['x','y'],['a']),relation('two',['x'],['y','b'])];
 assert.equal(target(g,'total_assets').value,'60');
});
test('does not choose arbitrary values for an underdetermined system',()=>{
 const g=graph();g.observations=g.observations.filter(o=>o.variable_id!=='long');
 assert.equal(target(g).code,'UNDERDETERMINED');assert.equal(target(g).value,null);
});
test('independent identified targets survive free variables elsewhere',()=>{
 const g=graph();g.variables.push(variable('x'),variable('y'));g.relations.push(relation('free',['x'],['y']));
 assert.equal(target(g).value,'50');
});
test('circular identities with no source observations cannot manufacture values',()=>{
 const g=graph();g.observations=[];assert.equal(target(g).code,'UNDERDETERMINED');
});
test('contradictory derivations block the whole affected component but not unrelated facts',()=>{
 const g=graph();g.observations.push(observation('loan','51'));g.variables.push(variable('assets','total_assets'));g.observations.push(observation('assets','150'));
 assert.equal(target(g).code,'CONFLICT');assert.equal(target(g,'total_assets').value,'150');
});
test('matching alternative observations preserve both sources and exact result',()=>{
 const g=graph();g.observations.push(observation('loan','50',{id:'o_second',page:2}));assert.equal(target(g).value,'50');
 assert.ok(target(g).proof.leaf_ids.includes('o_second'));
});
test('conflicting observations are not overwritten by the last value',()=>{
 const g=graph();g.observations.push(observation('total','101',{id:'o_other'}));assert.equal(target(g).code,'CONFLICT');
});
for(const [name,edit,code] of [
 ['wrong period',g=>g.observations[0].period_end='2023-12-31','INPUT_SCOPE_OR_UNIT_MISMATCH'],
 ['wrong currency',g=>g.observations[0].currency='USD','INPUT_SCOPE_OR_UNIT_MISMATCH'],
 ['wrong basis',g=>g.observations[0].basis='consolidated','INPUT_SCOPE_OR_UNIT_MISMATCH'],
 ['fabricated token',g=>g.observations[0].value='101','INPUT_VALUE_MISMATCH'],
 ['repeated variables in partition',g=>g.relations[0].terms.push(g.relations[0].terms[1]),'UNDERDETERMINED'],
 ['unproven assumptions',g=>g.relations[0].assumptions=['Ownership unknown'],'UNDERDETERMINED'],
 ['missing reference',g=>g.relations[0].terms[0].variable_id='untrusted','INVALID_RELATION_REFERENCE'],
 ['executable coefficient',g=>g.relations[0].terms[0].coefficient='process.exit()','INVALID_RELATION_REFERENCE'],
])test('blocks '+name,()=>{const g=graph();edit(g);assert.equal(target(g).code,code)});
test('exact arithmetic supports large values above JS safe integer without rounding',()=>{
 const g=graph();g.observations[0]=observation('total','9007199254740993');assert.equal(target(g).value,'9007199254740943');
});
test('printed zero is retained as a resolved observation',()=>{
 const g=graph();g.observations=g.observations.map(o=>({...o,value:'0',raw_token:'0',quote:o.label+' 0'}));assert.equal(target(g).value,'0');
});
test('source units normalize exactly to receipt units before solving',()=>{
 const g=graph();g.observations[0]=observation('total','0.1',{unit_multiplier:'1000'});assert.equal(target(g).value,'50');
});
test('non-terminating final values are not rounded into a financial fact',()=>{
 const g=graph();g.variables=[variable('x','total_assets'),variable('y'),variable('z'),variable('total')];g.observations=[observation('total','1')];
 g.relations=[relation('sum',['total'],['x','y','z']),relation('equal1',['x'],['y']),relation('equal2',['y'],['z'])];
 assert.equal(target(g,'total_assets').code,'PRECISION_POLICY_REQUIRED');
});
test('opening balances cannot be mapped to a closing target',()=>{
 const g=graph();g.variables[0].as_of='2023-12-31';assert.equal(target(g,'total_liabilities').code,'TEMPORAL_SCOPE_MISMATCH');
});
test('rollforward handles opening stocks and period movement with explicit temporal roles',()=>{
 const g=graph();g.variables=[variable('closing','total_assets'),variable('opening',null,{as_of:'2023-12-31'}),variable('movement',null,{nature:'duration',as_of:null})];
 g.observations=[observation('opening','20'),observation('movement','5')];g.relations=[relation('movement_relation',['closing'],['opening','movement'],{kind:'rollforward'})];
 assert.equal(target(g,'total_assets').value,'25');
});
test('graph projections retain proof and cannot overwrite a direct fact',()=>{
 const receipt={scope,facts:[{key:'total_liabilities',value:'100'}],reasoning:graph()};
 const proposals=reasoningCalculations(receipt);assert.ok(!proposals.some(p=>p.key==='total_liabilities'));
 assert.equal(proposals.find(p=>p.key==='interest_bearing_debt').computed_value,'50');
});
module.exports={graph,scope};

test('unlinked provision observations are disclosed without inventing an allocation or alias',()=>{
 const g=receivables('100','-10');
 g.variables.find(v=>v.id==='allowance').label='Dự phòng phải thu ngắn hạn khó đòi mã 137';
 g.variables.push(variable('read_provision',null,{label:'Dự phòng phải thu ngắn hạn khó đòi'}));
 g.observations.find(o=>o.variable_id==='allowance').variable_id='read_provision';
 const receipt={scope,facts:[],reasoning:g},before=JSON.stringify(g);
 const p=reasoningCalculations(receipt).find(p=>p.key==='trade_receivables');
 assert.equal(p.computed_value,null);assert.equal(p.blocked_reason,'UNDERDETERMINED');
 assert.ok(!p.reason.includes('Số đọc trực tiếp đã đối chiếu'));
 const missing=p.blocked_details.missing_variables.find(v=>v.id==='allowance');
 assert.equal(missing.source_status,'allocation_unproven');
 assert.equal(missing.source_candidates[0].observation_id,'o_allowance');
 assert.equal(JSON.stringify(g),before);
 g.observations.find(o=>o.id==='o_allowance').period_end='2023-12-31';
 const mismatch=reasoningCalculations(receipt).find(p=>p.key==='trade_receivables').blocked_details.missing_variables.find(v=>v.id==='allowance');
 assert.equal(mismatch.source_status,'scope_mismatch');
 g.observations=g.observations.filter(o=>o.id!=='o_allowance');
 assert.equal(reasoningCalculations(receipt).find(p=>p.key==='trade_receivables').blocked_details.missing_variables.find(v=>v.id==='allowance').source_status,'not_observed');
});

test('proof fingerprint survives object-key reordering during JSONB persistence',()=>{
 const r={receipt_id:'00000000-0000-4000-8000-000000000001',scope,facts:[],reasoning:graph()};
 const reordered=Object.fromEntries(Object.entries(r.reasoning).reverse());
 assert.equal(reasoningSummary(r).proof_hash,reasoningSummary({...r,reasoning:reordered}).proof_hash);
});

function receivables(gross,allowance,label='Dự phòng phải thu ngắn hạn khó đòi') {
 const g=graph();g.variables=[variable('gross'),variable('allowance'),variable('net','trade_receivables')];
 g.observations=[observation('gross',gross,{label:'Phải thu ngắn hạn của khách hàng',quote:'Phải thu ngắn hạn của khách hàng '+gross})];
 if(allowance!==null)g.observations.push(observation('allowance',allowance,{label,quote:label+' '+allowance}));
 g.relations=[relation('net_relation',['net'],['gross',...(allowance!==null?['allowance']:[])])];return g;
}
test('a renamed gross receivable cannot bypass net semantics through a one-input identity',()=>{
 assert.equal(target(receivables('100',null),'trade_receivables').code,'NET_TRADE_RECEIVABLES_REQUIRED');
});
test('a general nonzero provision cannot be allocated entirely to customer receivables by a model',()=>{
 assert.equal(target(receivables('100','-10'),'trade_receivables').code,'UNALLOCATED_RECEIVABLES_PROVISION');
});
test('a specifically owned allowance adds its signed negative amount, never a second subtraction',()=>{
 const g=receivables('100','-10','Dự phòng phải thu khách hàng');assert.equal(target(g,'trade_receivables').value,'90');
 g.relations[0].terms[2].coefficient='1';assert.equal(target(g,'trade_receivables').code,'RECEIVABLES_BRIDGE_SIGN_MISMATCH');
});
test('a printed zero general provision permits the gross-to-net identity without fabricating zero',()=>{
 assert.equal(target(receivables('100','0'),'trade_receivables').value,'100');
});
test('invalid gross-to-net semantics cannot feed a downstream otherwise valid expression',()=>{
 const g=receivables('100',null);g.variables.push(variable('factor',null,{dimension:'scalar'}),variable('assets','total_assets'));
 g.observations.push(observation('factor','2',{dimension:'scalar'}));
 g.relations.push(relation('multiply',['assets'],['net','factor'],{kind:'expression',output_variable_id:'assets',expression:['net','factor','*']}));
 assert.equal(target(g,'trade_receivables').code,'NET_TRADE_RECEIVABLES_REQUIRED');
 assert.equal(target(g,'total_assets').value,null);
});

test('40 independent Python Fraction oracle cases retain exact large-value simultaneous solutions',()=>{
 for(const c of require('./helpers/reasoning-oracle.json')){
  const g=graph();g.variables=[variable('x','total_assets'),variable('y'),variable('a'),variable('b')];
  g.observations=[observation('a',c.a),observation('b',c.b)];
  g.relations=[relation('one',['x','y'],['a']),relation('two',['x'],['y','b'])];
  assert.equal(target(g,'total_assets').value,c.expected);
 }
});
test('known multiplication/division can follow a solved intermediate and feed another equation',()=>{
 const g=graph();g.variables.push(variable('factor',null,{dimension:'scalar'}),variable('product'),variable('assets','total_assets'));
 g.observations.push(observation('factor','2',{dimension:'scalar'}));
 g.relations.push(relation('multiply',['product'],['loan','factor'],{kind:'expression',output_variable_id:'product',expression:['loan','factor','*']}));
 g.relations.push(relation('assets_relation',['assets'],['product','payable']));
 const r=target(g,'total_assets');assert.equal(r.value,'130');assert.ok(r.proof.relation_ids.includes('multiply'));
 assert.ok(r.proof.leaf_ids.includes('o_factor'));
});
test('division by a sourced zero blocks the expression without losing unrelated direct values',()=>{
 const g=graph();g.variables.push(variable('factor',null,{dimension:'scalar'}),variable('assets','total_assets'));
 g.observations.push(observation('factor','0',{dimension:'scalar'}));
 g.relations.push(relation('divide',['assets'],['loan','factor'],{kind:'expression',output_variable_id:'assets',expression:['loan','factor','/']}));
 assert.equal(target(g,'total_assets').code,'DIVISION_BY_ZERO');assert.equal(target(g,'total_liabilities').value,'100');
});
test('expression result disagreeing with a direct observation is a conflict',()=>{
 const g=graph();g.variables.push(variable('factor',null,{dimension:'scalar'}),variable('assets','total_assets'));
 g.observations.push(observation('factor','2',{dimension:'scalar'}),observation('assets','99'));
 g.relations.push(relation('multiply',['assets'],['loan','factor'],{kind:'expression',output_variable_id:'assets',expression:['loan','factor','*']}));
 assert.equal(target(g,'total_assets').code,'CONFLICT');
});

test('conflicting alternative expressions invalidate the affected component, not unrelated targets',()=>{
 const g=graph();g.variables.push(variable('factor',null,{dimension:'scalar'}),variable('product'),variable('assets','total_assets'));
 g.observations.push(observation('factor','2',{dimension:'scalar'}));
 g.variables.push(variable('cash','cash'));g.observations.push(observation('cash','10'));
 g.relations.push(relation('multiply',['product'],['loan','factor'],{kind:'expression',output_variable_id:'product',expression:['loan','factor','*']}));
 g.relations.push(relation('divide',['product'],['loan','factor'],{kind:'expression',output_variable_id:'product',expression:['loan','factor','/']}));
 g.relations.push(relation('downstream',['assets'],['product','payable']));
 assert.equal(target(g,'total_assets').code,'CONFLICT');assert.equal(target(g,'cash').value,'10');
});

test('equal alternative expressions retain both relation paths and their sourced leaves',()=>{
 const g=graph();g.variables.push(variable('factor',null,{dimension:'scalar'}),variable('assets','total_assets'));
 g.observations.push(observation('factor','2',{dimension:'scalar'}));
 g.relations.push(relation('multiply',['assets'],['loan','factor'],{kind:'expression',output_variable_id:'assets',expression:['loan','factor','*']}));
 g.relations.push(relation('add',['assets'],['loan'],{kind:'expression',output_variable_id:'assets',expression:['loan','loan','+']}));
 const r=target(g,'total_assets');assert.equal(r.value,'100');
 assert.ok(r.proof.relation_ids.includes('multiply')&&r.proof.relation_ids.includes('add'));
 assert.ok(r.proof.leaf_ids.includes('o_factor'));
});
