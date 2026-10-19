const {test}=require('node:test'),assert=require('node:assert/strict');
const {evaluateCalculation,evaluateCalculations}=require('../dist/financial/financial-calculations');
const scope={country:'VN',start_date:'2025-01-01',end_date:'2025-12-31',basis:'standalone',currency:'VND',unit_multiplier:'1'};
function input(id,value,dimension='money') {return {id,value,raw_token:value,label:id,page:1,quote:id+' '+value,
  period_start:scope.start_date,period_end:scope.end_date,basis:scope.basis,currency:scope.currency,unit_multiplier:'1',dimension};}
function proposal() {return {id:'liabilities',key:'current_liabilities',reason:'SYNTHETIC complete balance sheet identity',assumptions:[],
  inputs:[input('total','9007199254740993'),input('long_term','17')],expression:['total','long_term','-']};}
test('large financial values are subtracted exactly, never through binary float',()=>{
  const result=evaluateCalculation(proposal(),scope);assert.equal(result.computed_value,'9007199254740976');assert.equal(result.blocked_reason,null);
});
for(const [name,mutate,code] of [
  ['different period',p=>p.inputs[0].period_end='2024-12-31','INPUT_SCOPE_OR_UNIT_MISMATCH'],
  ['different currency',p=>p.inputs[0].currency='USD','INPUT_SCOPE_OR_UNIT_MISMATCH'],
  ['different multiplier',p=>p.inputs[0].unit_multiplier='1000','INPUT_SCOPE_OR_UNIT_MISMATCH'],
  ['different basis',p=>p.inputs[0].basis='consolidated','INPUT_SCOPE_OR_UNIT_MISMATCH'],
  ['assumptions',p=>p.assumptions=['Provision ownership not evidenced'],'UNRESOLVED_ASSUMPTIONS'],
  ['literal constant',p=>p.expression=['total','1','-'],'INVALID_EXPRESSION'],
  ['arbitrary JavaScript',p=>p.expression=['total','process.exit()','-'],'INVALID_EXPRESSION'],
  ['duplicated input',p=>p.expression=['total','total','-'],'REUSED_INPUT'],
  ['unprinted value',p=>p.inputs[0].value='10','INPUT_VALUE_MISMATCH'],
  ['numeric substring',p=>{p.inputs[0].value='12';p.inputs[0].raw_token='12';p.inputs[0].quote='total 123'},'INVALID_INPUT_EVIDENCE'],
  ['money multiplied by money',p=>p.expression=['total','long_term','*'],'INVALID_RESULT_DIMENSION'],
  ['missing operand',p=>p.expression=['total','-','long_term'],'INVALID_EXPRESSION'],
]) test('blocks '+name,()=>{const p=proposal();mutate(p);const result=evaluateCalculation(p,scope);assert.equal(result.computed_value,null);assert.equal(result.blocked_reason,code)});
test('addition multiplication and division support dimensioned values and exact decimals',()=>{
  const p=proposal();p.inputs=[input('amount','0,1'),input('factor','0,2','scalar')];
  p.inputs[0].value='0.1';p.inputs[1].value='0.2';p.expression=['amount','factor','*'];assert.equal(evaluateCalculation(p,scope).computed_value,'0.02');
  p.inputs=[input('amount','1'),input('factor','4','scalar')];p.expression=['amount','factor','/'];assert.equal(evaluateCalculation(p,scope).computed_value,'0.25');
  p.inputs[1]=input('factor','3','scalar');assert.equal(evaluateCalculation(p,scope).blocked_reason,'NON_TERMINATING_DECIMAL');
  p.inputs[1]=input('factor','0','scalar');assert.equal(evaluateCalculation(p,scope).blocked_reason,'DIVISION_BY_ZERO');
  p.inputs=[input('amount','1'),input('other','2')];p.expression=['amount','other','+'];assert.equal(evaluateCalculation(p,scope).computed_value,'3');
});
test('existing facts and duplicate proposals cannot be overwritten or selected ambiguously',()=>{
  const p=proposal();assert.equal(evaluateCalculation(p,scope,[{key:p.key,value:'0'}]).blocked_reason,'TARGET_ALREADY_PRESENT');
  const results=evaluateCalculations({scope,facts:[],calculations:[p,structuredClone(p)]});assert.ok(results.every(r=>r.computed_value===null));
});
