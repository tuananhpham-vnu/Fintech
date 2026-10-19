import { createHash } from 'node:crypto';
import { Decimal } from './decimal';
import { FHI_FACT_KEYS } from './fhi-method';
import { canonicalJson } from '../foundation/canonical';

const ZERO = Decimal.parse('0');
const ONE = Decimal.parse('1');
const id = /^[a-z][a-z0-9_]{0,63}$/;
const same = (a: Decimal, b: Decimal) => a.compare(b) === 0;
const tidy = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const words = (s:string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
const fail = (code: string): never => { throw new Error(code); };
const limited = (x: Decimal) => {
  if (x.numerator.toString().length > 1000 || x.denominator.toString().length > 1000) fail('CALCULATION_LIMIT');
  return x;
};
export const REASONING_VERSION = 'AIC-FINANCIAL-REASONING-1';

/** Observations are verified against source text by the AI boundary, then sealed in the receipt.
 * Recheck token/value/scope here before any application publication. No executable model text. */
function observationValue(o: any, scope: any): Decimal {
  if (!id.test(o.id) || !id.test(o.variable_id) || !Number.isInteger(o.page) || o.page < 1 || o.page > 600 ||
      typeof o.label !== 'string' || typeof o.quote !== 'string' || typeof o.raw_token !== 'string' ||
      !tidy(o.quote).includes(tidy(o.label))) fail('INVALID_INPUT_EVIDENCE');
  if (o.period_start !== scope.start_date || o.period_end !== scope.end_date || o.basis !== scope.basis ||
      o.currency !== scope.currency || !/^[1-9][0-9]{0,11}$/.test(o.unit_multiplier) ||
      !['money','scalar'].includes(o.dimension)) fail('INPUT_SCOPE_OR_UNIT_MISMATCH');
  const raw = tidy(o.raw_token), escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp('(?<![\\d.,])' + escaped + '(?![\\d.,])').test(tidy(o.quote))) fail('INVALID_INPUT_EVIDENCE');
  let token = raw.replace(/\u2212/g,'-'), negative = false;
  if (token.startsWith('(') && token.endsWith(')')) { negative = true; token = token.slice(1,-1).trim(); }
  const group = scope.country === 'VN' ? '.' : ',', decimal = scope.country === 'VN' ? ',' : '.';
  if (token.includes(' ')) {
    if (!/^-?\d{1,3}(?: \d{3})+(?:[.,]\d{1,12})?$/.test(token)) fail('INVALID_INPUT_TOKEN');
    token = token.replace(/ /g,'');
  }
  if (!new RegExp('^-?(?:\\d+|\\d{1,3}(?:' + (group === '.' ? '\\.' : ',') + '\\d{3})+)(?:' +
      (decimal === '.' ? '\\.' : ',') + '\\d{1,12})?$').test(token)) fail('INVALID_INPUT_TOKEN');
  const parsed = Decimal.parse((negative ? '-' : '') + token.split(group).join('').replace(decimal,'.'));
  if (typeof o.value !== 'string' || !/^-?\d{1,30}(\.\d{1,12})?$/.test(o.value) || !same(parsed,Decimal.parse(o.value))) fail('INPUT_VALUE_MISMATCH');
  if (o.dimension === 'scalar') {
    if (o.unit_multiplier !== '1') fail('INPUT_SCOPE_OR_UNIT_MISMATCH');
    return parsed;
  }
  return limited(parsed.mul(Decimal.parse(o.unit_multiplier)).div(Decimal.parse(scope.unit_multiplier)));
}

type Row = { a: Decimal[]; b: Decimal; evidence: Set<string>; relations: Set<string> };
type Solved = {value:Decimal;leaves:string[];relation_ids:string[];depth:number};
const union = <T>(a: Set<T>, b: Set<T>) => { for (const item of b) a.add(item); };

function solveLinearReasoning(graph: any, scope: any, seeds=new Map<string,Solved>(), failures=new Map<string,string>()) {
  const resolutions: any[] = [];
  const diagnostics = [...(Array.isArray(graph?.diagnostics) ? graph.diagnostics : [])];
  try {
    if (graph?.version !== REASONING_VERSION || !Array.isArray(graph.variables) || graph.variables.length > 240 ||
        !Array.isArray(graph.observations) || graph.observations.length > 500 ||
        !Array.isArray(graph.relations) || graph.relations.length > 100) fail('INVALID_REASONING_GRAPH');
    const variables = new Map<string, any>(), observations = new Map<string, any[]>();
    const values = new Map<string, Decimal>([...seeds].map(([k,v])=>[k,v.value])), invalid = new Map<string,string>(failures);
    const parent = new Map<string,string>(), relations: any[] = [];
    const root = (v: string): string => { const p=parent.get(v)!; if(p===v)return v; const r=root(p);parent.set(v,r);return r; };
    const join = (a: string,b: string) => parent.set(root(a),root(b));
    const priorDay = new Date(Date.parse(scope.start_date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
    for (const v of graph.variables) {
      if (!id.test(v.id) || variables.has(v.id) || typeof v.label !== 'string' ||
          !['money','scalar'].includes(v.dimension) || !['instant','duration'].includes(v.nature) ||
          (v.key !== null && !FHI_FACT_KEYS.includes(v.key) &&
            !(v.key==='eligible_cash_and_equivalents' && ['US','CN'].includes(scope.country))) ||
          (v.nature === 'instant' ? ![scope.end_date,scope.start_date,priorDay].includes(v.as_of) : v.as_of !== null)) fail('INVALID_VARIABLE');
      variables.set(v.id,v); parent.set(v.id,v.id);
    }
    const seen = new Set<string>();
    for (const o of graph.observations) {
      if (seen.has(o.id) || !variables.has(o.variable_id)) fail('INVALID_OBSERVATION_REFERENCE');
      seen.add(o.id);
      const list = observations.get(o.variable_id) ?? [];list.push(o);observations.set(o.variable_id,list);
      try {
        const value=observationValue(o,scope);
        if(variables.get(o.variable_id).dimension !== o.dimension) fail('DIMENSION_MISMATCH');
        if(values.has(o.variable_id) && !same(values.get(o.variable_id)!,value)) fail('CONFLICT');
        values.set(o.variable_id,value);
      } catch(e) {invalid.set(o.variable_id,e instanceof Error ? e.message : 'INVALID_OBSERVATION');}
    }
    const relationIds = new Set<string>();
    for(const relation of graph.relations) {
      if(relation.kind==='expression')continue;
      if (!id.test(relation.id) || relationIds.has(relation.id) || !Array.isArray(relation.terms) ||
          relation.terms.length < 2 || relation.terms.length > 32 || !['identity','rollforward'].includes(relation.kind) ||
          !Array.isArray(relation.assumptions) || !Array.isArray(relation.evidence) || !relation.evidence.length) fail('INVALID_RELATION');
      relationIds.add(relation.id);
      const refs = relation.terms.map((t:any)=>variables.get(t.variable_id));
      if(refs.some((v:any)=>!v) || relation.terms.some((t:any)=>!['1','-1'].includes(t.coefficient))) fail('INVALID_RELATION_REFERENCE');
      const first=refs[0];
      let problem: string | null = relation.assumptions.length ? 'UNRESOLVED_ASSUMPTIONS' : null;
      if(refs.some((v:any)=>v.dimension!==first.dimension)) problem='DIMENSION_MISMATCH';
      if(relation.kind==='identity' && refs.some((v:any)=>v.nature!==first.nature || v.as_of!==first.as_of)) problem='TEMPORAL_SCOPE_MISMATCH';
      if(relation.kind==='rollforward' && (refs.filter((v:any)=>v.nature==='instant').length!==2 ||
          !refs.some((v:any)=>v.nature==='instant' && v.as_of===scope.end_date) ||
          !refs.some((v:any)=>v.nature==='instant' && [scope.start_date,priorDay].includes(v.as_of)))) problem='TEMPORAL_SCOPE_MISMATCH';
      if(relation.terms.some((t:any,i:number)=>relation.terms.findIndex((x:any)=>x.variable_id===t.variable_id)!==i)) problem='OVERLAPPING_INPUTS';
      if(problem) {diagnostics.push({code:problem,detail:relation.id});continue;}
      for(const v of refs.slice(1)) join(first.id,v.id);
      relations.push(relation);
    }
    const groups=new Map<string,string[]>();
    for(const key of variables.keys()) {const r=root(key),g=groups.get(r)??[];g.push(key);groups.set(r,g);}
    const solved=new Map<string,Solved>();
    for(const keys of groups.values()) {
      const keySet=new Set(keys), unknown=keys.filter(k=>!values.has(k)), component=relations.filter(r=>keySet.has(r.terms[0].variable_id));
      let issue=keys.map(k=>invalid.get(k)).find(Boolean);
      if(unknown.length>20) issue='CALCULATION_LIMIT';
      const rows: Row[]=[];
      if(!issue) for(const r of component) {
        const row:Row={a:unknown.map(()=>ZERO),b:ZERO,evidence:new Set(),relations:new Set([r.id])};
        for(const t of r.terms) {
          const coefficient=Decimal.parse(t.coefficient), known=values.get(t.variable_id);
          if(known) {row.b=limited(row.b.sub(coefficient.mul(known)));for(const o of observations.get(t.variable_id)??[]) row.evidence.add(o.id);
            if(seeds.has(t.variable_id)){union(row.evidence,new Set(seeds.get(t.variable_id)!.leaves));union(row.relations,new Set(seeds.get(t.variable_id)!.relation_ids));}}
          else {const i=unknown.indexOf(t.variable_id);row.a[i]=limited(row.a[i].add(coefficient));}
        }
        rows.push(row);
      }
      const pivots=new Map<number,Row>();
      if(!issue) {
        let next=0;
        for(let col=0;col<unknown.length && next<rows.length;col++) {
          const pivot=rows.findIndex((r,i)=>i>=next && !same(r.a[col],ZERO));if(pivot<0)continue;
          [rows[next],rows[pivot]]=[rows[pivot],rows[next]];
          const row=rows[next], divisor=row.a[col];
          row.a=row.a.map(v=>limited(v.div(divisor)));row.b=limited(row.b.div(divisor));
          for(let i=0;i<rows.length;i++) if(i!==next && !same(rows[i].a[col],ZERO)) {
            const other=rows[i],factor=other.a[col];
            other.a=other.a.map((v,j)=>limited(v.sub(factor.mul(row.a[j]))));other.b=limited(other.b.sub(factor.mul(row.b)));
            union(other.evidence,row.evidence);union(other.relations,row.relations);
          }
          pivots.set(col,row);next++;
        }
        const contradictions=rows.filter(r=>r.a.every(v=>same(v,ZERO))&&!same(r.b,ZERO));
        if(contradictions.length) {
          issue='CONFLICT';
          for(const r of contradictions.slice(0,10))diagnostics.push({code:'RELATION_CONFLICT',detail:[...r.relations].map(rid=>relations.find(x=>x.id===rid)?.label??rid).join('; ').slice(0,1000)});
        }
      }
      if(issue) {for(const k of keys)invalid.set(k,issue);continue;}
      for(const k of keys) if(values.has(k)) solved.set(k,seeds.get(k)??{value:values.get(k)!,leaves:(observations.get(k)??[]).map(o=>o.id),relation_ids:[],depth:0});
      // Each pivot target is unique only if its RREF row contains no free variable.
      for(const [col,row] of pivots) if(row.a.every((v,i)=>i===col||same(v,ZERO))) {
        if(row.evidence.size===0) continue; // A circular/evidence-free identity is not a financial source.
        solved.set(unknown[col],{value:row.b,leaves:[...row.evidence],relation_ids:[...row.relations],depth:row.relations.size});
      }
    }
    const observationById=new Map(graph.observations.map((o:any)=>[o.id,o]));
    for(const key of FHI_FACT_KEYS) {
      const candidates=[...variables.values()].filter(v=>v.key===key), v=candidates[0];
      let code:string|null = candidates.length>1 ? 'AMBIGUOUS_TARGET' : !v ? 'NOT_IDENTIFIED' : invalid.get(v.id)??null;
      const result=v ? solved.get(v.id) : null;
      const nature=['operating_profit','depreciation_amortization','interest_expense','net_revenue','cash_from_operations'].includes(key)?'duration':'instant';
      if(v && (v.nature!==nature || v.dimension!=='money' || (nature==='instant' && v.as_of!==scope.end_date))) code='TEMPORAL_SCOPE_MISMATCH';
      if(!code && !result) code='UNDERDETERMINED';
      const exact=result?.value.toExact(), value=exact?.decimal??null;
      if(!code && (value===null || !/^-?\d{1,30}(\.\d{1,12})?$/.test(value))) code='PRECISION_POLICY_REQUIRED';
      if(!code && result && result.leaves.length>128) code='CALCULATION_LIMIT';
      if(!code && result && result.depth>8) code='CALCULATION_LIMIT';
      if(!code && result && ['cash','unrestricted_short_term_equivalents','trade_receivables','interest_bearing_debt','interest_expense'].includes(key) &&
          result.value.compare(ZERO)<0) code='INVALID_FINANCIAL_BOUNDS';
      const inputs=result?.leaves.map(k=>observationById.get(k))??[];
      if(!code && key==='trade_receivables' && result?.relation_ids.length) code=receivablesIssue(inputs,result.value,scope);
      const proof=result ? {variable_id:v.id,leaf_ids:result.leaves,relation_ids:result.relation_ids,depth:result.depth,
        exact_value:exact,steps:graph.relations.filter((r:any)=>result.relation_ids.includes(r.id)),
        variables:[...variables.values()].filter(n=>n.id===v.id||result.relation_ids.some(r=>graph.relations.find((x:any)=>x.id===r)?.terms.some((t:any)=>t.variable_id===n.id))),
        intermediate_values:[...solved.entries()].filter(([k])=>keysForProof(k,result.relation_ids,graph.relations)).map(([k,r])=>({variable_id:k,value:r.value.toExact()}))}:null;
      resolutions.push({key,variable_id:v?.id??null,status:code ? (code==='CONFLICT'?'conflict':'unresolved'):'resolved',
        origin:result?.relation_ids.length?'derived':'direct',value:code?null:value,code,inputs,proof});
    }
    const semanticFailures=new Set(resolutions.filter(r=>['NET_TRADE_RECEIVABLES_REQUIRED','UNALLOCATED_RECEIVABLES_PROVISION','RECEIVABLES_BRIDGE_SIGN_MISMATCH'].includes(r.code)).map(r=>r.variable_id));
    for(let pass=0;pass<variables.size;pass++) {
      let changed=false;
      for(const [k,s] of solved)if(!semanticFailures.has(k)&&s.relation_ids.some(rid=>graph.relations.find((r:any)=>r.id===rid)?.terms.some((t:any)=>semanticFailures.has(t.variable_id)))) {
        semanticFailures.add(k);changed=true;
      }
      if(!changed)break;
    }
    for(const k of semanticFailures)solved.delete(k);
    for(const r of resolutions)if(r.status==='resolved'&&semanticFailures.has(r.variable_id)) {
      r.status='unresolved';r.value=null;r.code='DOWNSTREAM_INPUT_INVALID';
    }
    return {version:REASONING_VERSION,resolutions,diagnostics,coverage:graph.coverage,_solutions:solved};
  } catch(e) {
    return {version:REASONING_VERSION,resolutions:FHI_FACT_KEYS.map(key=>({key,status:'unresolved',origin:'derived',value:null,
      code:e instanceof Error?e.message:'INVALID_REASONING_GRAPH',inputs:[],proof:null})),diagnostics,coverage:graph?.coverage};
  }
}
function receivablesIssue(inputs:any[],value:Decimal,scope:any):string|null {
  const customer=(s:string)=>/customer|trade receivable|accounts receivable|phai thu.*khach hang|应收账款/.test(words(s));
  const provision=(s:string)=>/allowance|provision|du phong|坏账/.test(words(s));
  const net=(s:string)=>/\bnet\b|thuan|sau du phong|gia tri ghi so|账面价值/.test(words(s));
  const gross=inputs.filter(o=>customer(o.label)&&!provision(o.label)&&!net(o.label));
  const allowances=inputs.filter(o=>provision(o.label));
  if(!gross.length)return null;
  if(!allowances.length)return 'NET_TRADE_RECEIVABLES_REQUIRED';
  if(allowances.some(o=>!customer(o.label)&&Decimal.parse(o.value).compare(ZERO)!==0))return 'UNALLOCATED_RECEIVABLES_PROVISION';
  // For the simple gross-to-net bridge, an allowance is a deduction regardless of
  // whether the statement prints it as positive or in accounting parentheses.
  if(gross.length===1&&inputs.length===gross.length+allowances.length) {
    let expected=Decimal.parse(gross[0].value).mul(Decimal.parse(gross[0].unit_multiplier));
    for(const o of allowances){const amount=Decimal.parse(o.value);expected=expected.sub((amount.compare(ZERO)<0?ZERO.sub(amount):amount).mul(Decimal.parse(o.unit_multiplier)));}
    if(!same(expected.div(Decimal.parse(scope.unit_multiplier)),value))return 'RECEIVABLES_BRIDGE_SIGN_MISMATCH';
  }
  return null;
}
/** Alternate exact linear solving and fully-known arithmetic expressions; no nonlinear root selection. */
export function solveReasoning(graph:any,scope:any) {
  const seeds=new Map<string,Solved>(), failures=new Map<string,string>();
  const processed=new Set<string>();
  let result:any=solveLinearReasoning(graph,scope,seeds);
  const expressions=Array.isArray(graph?.relations)?graph.relations.filter((r:any)=>r?.kind==='expression'):[];
  for(let pass=0;pass<8;pass++) {
    let changed=false;
    for(const r of expressions) {
      try {
        if(!id.test(r.id)||graph.relations.filter((other:any)=>other.id===r.id).length!==1||!Array.isArray(r.assumptions)||r.assumptions.length||!Array.isArray(r.expression)||
          r.expression.length>63||!Array.isArray(r.evidence)||!r.evidence.length) fail('INVALID_EXPRESSION');
        if(processed.has(r.id))continue;
        const output=graph.variables.find((v:any)=>v.id===r.output_variable_id);
        if(!output)fail('INVALID_EXPRESSION');
        const stack:{value:Decimal;dimension:number;leaves:Set<string>;relations:Set<string>}[]=[];
        let missing=false;
        for(const token of r.expression) {
          const variable=graph.variables.find((v:any)=>v.id===token);
          if(variable) {
            if(token===r.output_variable_id)fail('CIRCULAR_EXPRESSION');
            if(!r.terms.some((t:any)=>t.variable_id===token))fail('INVALID_EXPRESSION_REFERENCE');
            if(variable.dimension==='money'&&(variable.nature!==output.nature||variable.as_of!==output.as_of))fail('TEMPORAL_SCOPE_MISMATCH');
            const input=result._solutions?.get(token);
            if(!input){missing=true;break;}
            stack.push({value:input.value,dimension:variable.dimension==='money'?1:0,leaves:new Set(input.leaves),relations:new Set(input.relation_ids)});
          } else {
            if(!['+','-','*','/'].includes(token)||stack.length<2)fail('INVALID_EXPRESSION');
            const b=stack.pop()!,a=stack.pop()!;
            if(['+','-'].includes(token)&&a.dimension!==b.dimension)fail('DIMENSION_MISMATCH');
            if(token==='/'&&same(b.value,ZERO))fail('DIVISION_BY_ZERO');
            const value=limited(token==='+'?a.value.add(b.value):token==='-'?a.value.sub(b.value):token==='*'?a.value.mul(b.value):a.value.div(b.value));
            const dimension=token==='*'?a.dimension+b.dimension:token==='/'?a.dimension-b.dimension:a.dimension;
            if(Math.abs(dimension)>4)fail('DIMENSION_MISMATCH');
            union(a.leaves,b.leaves);union(a.relations,b.relations);stack.push({value,dimension,leaves:a.leaves,relations:a.relations});
          }
        }
        if(missing)continue;
        if(stack.length!==1||stack[0].dimension!==(output.dimension==='money'?1:0)||!stack[0].leaves.size)fail('INVALID_RESULT_DIMENSION');
        const v=stack[0];v.relations.add(r.id);
        processed.add(r.id);
        if(seeds.has(output.id)&&!same(seeds.get(output.id)!.value,v.value))fail('CONFLICT');
        const prior=seeds.get(output.id);
        if(prior){union(v.leaves,new Set(prior.leaves));union(v.relations,new Set(prior.relation_ids));}
        seeds.set(output.id,{value:v.value,leaves:[...v.leaves],relation_ids:[...v.relations],depth:v.relations.size});changed=true;
      } catch(e) {
        const code=e instanceof Error?e.message:'INVALID_EXPRESSION';
        if(!failures.has(r.output_variable_id)){failures.set(r.output_variable_id,code);changed=true;}
      }
    }
    if(!changed)break;
    result=solveLinearReasoning(graph,scope,seeds,failures);
  }
  // A failed expression invalidates every dependent component, including values seeded
  // before an alternative derivation exposed a contradiction.
  for(let pass=0;pass<graph?.variables?.length;pass++) {
    let changed=false;
    for(const r of graph.relations??[]) {
      const refs=(r.terms??[]).map((t:any)=>t.variable_id);
      if(r.output_variable_id)refs.push(r.output_variable_id);
      const code=refs.map((v:string)=>failures.get(v)).find(Boolean);
      const affected=r.kind==='expression'?[r.output_variable_id]:refs;
      if(code)for(const v of affected)if(!failures.has(v)){failures.set(v,code);changed=true;}
    }
    if(!changed)break;
  }
  if(failures.size)result=solveLinearReasoning(graph,scope,seeds,failures);
  for(const resolution of result.resolutions) if(failures.has(resolution.variable_id)) {
    resolution.status=failures.get(resolution.variable_id)==='CONFLICT'?'conflict':'unresolved';resolution.value=null;resolution.code=failures.get(resolution.variable_id);
  }
  const {_solutions,...publicResult}=result;
  return publicResult;
}
function keysForProof(key:string, ids:string[], relations:any[]) {
  return relations.some(r=>ids.includes(r.id)&&r.terms.some((t:any)=>t.variable_id===key));
}

export function reasoningCalculations(receipt:any) {
  if(!receipt.reasoning)return [];
  return solveReasoning(receipt.reasoning,receipt.scope).resolutions
    .filter((r:any)=>!receipt.facts.some((f:any)=>f.key===r.key))
    .map((r:any,i:number)=>({id:'r_'+i,key:r.key,reason:r.code?'Chưa đủ căn cứ xác định số liệu; cần rà soát liên kết, phạm vi và điều kiện sử dụng nguồn.':r.origin==='direct'?'Số đọc trực tiếp đã đối chiếu nguồn.':'Suy ra từ các quan hệ kế toán; cần rà soát toàn bộ chuỗi nguồn.',
      ...(r.code?{blocked_details:blockedDetails(receipt.reasoning,r.variable_id,receipt.scope)}:{}),
      assumptions:[],expression:[r.variable_id??'unresolved'],inputs:r.inputs.slice(0,128).map((o:any)=>({...o,id:o.id})),
      computed_value:r.value,blocked_reason:r.code,proof:r.proof,reasoning_version:REASONING_VERSION}));
}
function blockedDetails(graph:any,target:string|null,scope:any) {
  const connected=new Set<string>(target?[target]:[]);
  for(let pass=0;pass<graph.variables.length;pass++) {
    const count=connected.size;
    for(const r of graph.relations) {
      const refs=[...r.terms.map((t:any)=>t.variable_id),...(r.output_variable_id?[r.output_variable_id]:[])];
      if(refs.some((v:string)=>connected.has(v)))for(const v of refs)connected.add(v);
    }
    if(connected.size===count)break;
  }
  const observed=new Set(graph.observations.map((o:any)=>o.variable_id));
  const labelTokens=(s:string)=>words(s).replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
  return {missing_variables:graph.variables.filter((v:any)=>connected.has(v.id)&&!observed.has(v.id)&&v.id!==target).slice(0,20).map((v:any)=>{
    const tokens=labelTokens(v.label);
    // Suggestions explain an unlinked observation; they never alias solver variables.
    const candidates=graph.observations.filter((o:any)=>{
      const other=labelTokens(o.label), common=tokens.filter((t:string)=>other.includes(t)).length;
      const provision=(parts:string[])=>parts.includes('du') && parts.includes('phong');
      return tokens.length>=3 && other.length>=3 && provision(tokens)===provision(other) &&
        common/Math.min(tokens.length,other.length)>=0.8;
    }).slice(0,8).map((o:any)=>{
      const sourceVariable=graph.variables.find((x:any)=>x.id===o.variable_id);
      const inScope=o.period_start===scope.start_date && o.period_end===scope.end_date &&
        o.basis===scope.basis && o.currency===scope.currency && sourceVariable?.nature===v.nature &&
        sourceVariable?.as_of===v.as_of && o.dimension===v.dimension;
      const label=words(o.label);
      const generalProvision=label.includes('du phong') && label.includes('phai thu') && !label.includes('khach hang') &&
        Decimal.parse(o.value).compare(ZERO)!==0;
      return {observation_id:o.id,label:o.label,page:o.page,quote:o.quote,
        status:!inScope?'scope_mismatch':generalProvision?'allocation_unproven':'observed_unlinked'};
    });
    return {id:v.id,label:v.label,source_status:candidates.some((o:any)=>o.status==='allocation_unproven')?'allocation_unproven':
      candidates.some((o:any)=>o.status==='observed_unlinked')?'observed_unlinked':candidates.length?'scope_mismatch':'not_observed',
      source_candidates:candidates};
  }),
    assumptions:[...new Set<string>(graph.relations.filter((r:any)=>r.terms.some((t:any)=>connected.has(t.variable_id))).flatMap((r:any)=>r.assumptions))].slice(0,8)};
}
export function reasoningSummary(receipt:any) {
  if(!receipt.reasoning)return undefined;
  const result=solveReasoning(receipt.reasoning,receipt.scope);
  return {version:REASONING_VERSION,receipt_id:receipt.receipt_id,coverage:result.coverage,diagnostics:result.diagnostics,
    targets:result.resolutions.map(({key,status,origin,value,code,proof}:any)=>({key,status,origin,value,code,steps:proof?.depth??0})),
    proof_hash:createHash('sha256').update(canonicalJson(receipt.reasoning)).digest('hex')};
}
