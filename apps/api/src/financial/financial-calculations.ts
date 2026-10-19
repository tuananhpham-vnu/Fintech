import { Decimal } from './decimal';
import { FHI_FACT_KEYS } from './fhi-method';
import { reasoningCalculations } from './financial-reasoning';

/** Bounded postfix data; never eval, code, literal constants or model-computed answers. */
export function evaluateCalculation(proposal: any, scope: any, existing: readonly any[] = []) {
  const reject = (code: string): never => { throw new Error(code); };
  try {
    if (!proposal || !FHI_FACT_KEYS.includes(proposal.key)) reject('INVALID_TARGET');
    if (existing.some(f => f.key === proposal.key && (f.value ?? f.raw_value) != null)) reject('TARGET_ALREADY_PRESENT');
    if (!Array.isArray(proposal.assumptions) || proposal.assumptions.length) reject('UNRESOLVED_ASSUMPTIONS');
    if (!Array.isArray(proposal.inputs) || proposal.inputs.length < 1 || proposal.inputs.length > 16 ||
        !Array.isArray(proposal.expression) || proposal.expression.length < 3 || proposal.expression.length > 31) reject('INVALID_EXPRESSION');
    const inputs = new Map<string, {value: Decimal; dimension: number}>(), signatures = new Set<string>();
    for (const input of proposal.inputs) {
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(input.id) || inputs.has(input.id)) reject('DUPLICATE_INPUT');
      if (input.period_start !== scope.start_date || input.period_end !== scope.end_date || input.basis !== scope.basis ||
          input.currency !== scope.currency || !['money','scalar'].includes(input.dimension) ||
          input.unit_multiplier !== (input.dimension === 'money' ? scope.unit_multiplier : '1')) reject('INPUT_SCOPE_OR_UNIT_MISMATCH');
      const whitespace = (value: string) => value.replace(/\s+/g,' ').trim();
      if (typeof input.quote !== 'string' || typeof input.label !== 'string' || typeof input.raw_token !== 'string') reject('INVALID_INPUT_EVIDENCE');
      const quote=whitespace(input.quote), escapedToken=whitespace(input.raw_token).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      if (!Number.isInteger(input.page) || input.page < 1 || input.page > 600 || !new RegExp('(?<![\\d.,])'+escapedToken+'(?![\\d.,])').test(quote) ||
          !quote.includes(whitespace(input.label)) || !/^-?\d{1,30}(\.\d{1,12})?$/.test(input.value)) reject('INVALID_INPUT_EVIDENCE');
      let token = String(input.raw_token).trim().replace(/\u2212/g,'-').replace(/[\u00a0\u202f]/g,' ');
      const negative = token.startsWith('(') && token.endsWith(')');
      if (negative) token = token.slice(1,-1).trim();
      if (token.includes(' ')) {
        if (!/^-?\d{1,3}(?: \d{3})+(?:[.,]\d{1,2})?$/.test(token)) reject('INVALID_INPUT_TOKEN');
        token=token.replace(/ /g,'');
      }
      const group = scope.country === 'VN' ? '.' : ',', decimal = scope.country === 'VN' ? ',' : '.';
      if (!new RegExp('^-?(?:\\d+|\\d{1,3}(?:'+(group === '.' ? '\\.' : ',')+'\\d{3})+)(?:'+(decimal === '.' ? '\\.' : ',')+'\\d{1,12})?$').test(token)) reject('INVALID_INPUT_TOKEN');
      token = token.split(group).join('').replace(decimal,'.');
      const value = Decimal.parse((negative ? '-' : '') + token);
      if (value.compare(Decimal.parse(input.value)) !== 0) reject('INPUT_VALUE_MISMATCH');
      const signature = JSON.stringify([input.page,whitespace(input.label),value.toString(),input.period_end]);
      if (signatures.has(signature)) reject('OVERLAPPING_INPUTS');
      signatures.add(signature); inputs.set(input.id,{value,dimension:input.dimension === 'money' ? 1 : 0});
    }
    const stack: {value: Decimal; dimension: number}[] = [], used = new Set<string>();
    for (const token of proposal.expression) {
      if (inputs.has(token)) {
        if (used.has(token)) reject('REUSED_INPUT');
        used.add(token); stack.push(inputs.get(token)!); continue;
      }
      if (!['+','-','*','/'].includes(token) || stack.length < 2) reject('INVALID_EXPRESSION');
      const b = stack.pop()!, a = stack.pop()!;
      if (['+','-'].includes(token) && a.dimension !== b.dimension) reject('DIMENSION_MISMATCH');
      if (token === '/' && b.value.numerator === 0n) reject('DIVISION_BY_ZERO');
      const value = token === '+' ? a.value.add(b.value) : token === '-' ? a.value.sub(b.value) : token === '*' ? a.value.mul(b.value) : a.value.div(b.value);
      const dimension = token === '*' ? a.dimension+b.dimension : token === '/' ? a.dimension-b.dimension : a.dimension;
      if (Math.abs(dimension)>4 || value.numerator.toString().length>1000 || value.denominator.toString().length>1000) reject('CALCULATION_LIMIT');
      stack.push({value,dimension});
    }
    if (stack.length !== 1 || used.size !== inputs.size || stack[0].dimension !== 1) reject('INVALID_RESULT_DIMENSION');
    const value = stack[0].value.toExact().decimal;
    if (value === null) reject('NON_TERMINATING_DECIMAL');
    if (!/^-?\d{1,30}(\.\d{1,12})?$/.test(value!)) reject('RESULT_PRECISION_LIMIT');
    return {...proposal, computed_value:value, blocked_reason:null};
  } catch (error) {
    return {...proposal, computed_value:null, blocked_reason:error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'INVALID_CALCULATION'};
  }
}
export function evaluateCalculations(receipt: any) {
  if (receipt.reasoning) return reasoningCalculations(receipt);
  return (receipt.calculations ?? []).map((proposal: any) => {
    const result = evaluateCalculation(proposal,receipt.scope,receipt.facts);
    if (receipt.calculations.filter((p: any)=>p.id===proposal.id || p.key===proposal.key).length>1) { result.computed_value=null; result.blocked_reason='DUPLICATE_CALCULATION'; }
    return result;
  });
}
export function calculationMetadata(receipt: any) {
  return evaluateCalculations(receipt).map((calculation: any) => ({...calculation,
    receipt_id:receipt.receipt_id, source_kind:receipt.source.kind,source_id:receipt.source.id,source_hash:receipt.sha256}));
}
export function calculationFact(receipt: any, source: any) {
  return evaluateCalculations(receipt).find((p: any) => p.id === source.calculation_id && p.key === source.fact_key &&
    p.computed_value !== null && !p.blocked_reason && p.inputs[0].page === source.page && p.inputs[0].quote === source.quote);
}
