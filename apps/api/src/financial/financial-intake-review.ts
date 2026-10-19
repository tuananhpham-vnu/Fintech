import { randomUUID } from 'node:crypto';
import type { SqlClient } from '../foundation/ports';
import { FoundationError } from '../foundation/errors';
import { canonicalJson } from '../foundation/canonical';
import { FHI_FACT_KEYS } from './fhi-method';

/** A human receipt is explicit and append-only; it never masquerades as model extraction. */
export async function reviewIntakePeriod(tx: SqlClient, current: any, input: any,
  setId: string, prior: any, actorId: string, next: number) {
  const review = input.intake_review;
  const row = (await tx.query(`SELECT * FROM aic.financial_intakes
    WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE`,
    [current.organization_id,current.id,review.intake_id])).rows[0];
  const fail = (code: string): never => { throw new FoundationError(422,code); };
  if (current.purpose !== 'company_health' || !row?.prepared_source_id || row.superseded_by ||
    ['queued','running','duplicate','expanded'].includes(row.state) || row.origin_json.exclusion) fail('FINANCIAL_INTAKE_REVIEW_UNAVAILABLE');
  const file = (await tx.query(`SELECT id,sha256,page_count FROM aic.financial_import_sources
    WHERE organization_id=$1 AND case_id=$2 AND id=$3`,
    [current.organization_id,current.id,row.prepared_source_id])).rows[0];
  if (!file || review.page > file.page_count || !review.quote.trim()) fail('INVALID_FINANCIAL_SOURCE');
  const previous = row.result_json ?? [];
  if (row.origin_json.period_candidates?.some((c:any)=>c.status==='pending'))
    fail('FINANCIAL_PERIOD_SOURCE_SELECTION_REQUIRED');
  const predecessor = row.replacement_of ? (await tx.query(`SELECT result_json FROM aic.financial_intakes
    WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE`,
    [current.organization_id,current.id,row.replacement_of])).rows[0]?.result_json ?? [] :
    row.origin_json.replaces_existing_sets ? row.origin_json.duplicate_sets ?? [] : [];
  if (prior && ![...previous,...predecessor].some((s:any) => s.set_id === setId)) fail('FINANCIAL_INTAKE_SET_MISMATCH');
  const collision = (await tx.query(`SELECT DISTINCT ON(id) id,scope_json FROM aic.mvp_financial_sets
    WHERE organization_id=$1 AND case_id=$2 ORDER BY id,revision DESC`,[current.organization_id,current.id])).rows
    .some(s => s.id !== setId && s.scope_json.period.end_date === input.period.end_date &&
      s.scope_json.period.start_date === input.period.start_date &&
      s.scope_json.period.kind === input.period.kind && s.scope_json.basis === input.basis);
  if (collision) fail('FINANCIAL_DUPLICATE_DECISION_REQUIRED');
  const oldFacts = prior ? (await tx.query(`SELECT fact_key,payload_json FROM aic.mvp_financial_facts
    WHERE organization_id=$1 AND case_id=$2 AND set_id=$3 AND set_revision=$4`,
    [current.organization_id,current.id,setId,prior.revision])).rows : [];
  const sameScope = prior && canonicalJson(prior.scope_json.period) === canonicalJson(input.period) &&
    prior.scope_json.basis === input.basis && prior.scope_json.currency === input.currency &&
    prior.scope_json.unit_multiplier === input.unit_multiplier && prior.scope_json.accounting_regime === input.accounting_regime;
  for (const fact of input.facts) {
    const source = fact.source;
    const before = oldFacts.find(f => f.fact_key === fact.key)?.payload_json;
    // Retention is exact, scoped and bound to this file. Registry validation below
    // still rechecks the original receipt, arithmetic, source hash and scope.
    if (sameScope && before && ['financial_import','statement_entry','calculated'].includes(source.kind) &&
      source.source_id === file.id && source.source_hash === file.sha256 &&
      before.raw_value === fact.raw_value && before.raw_label === fact.raw_label &&
      before.missing_reason === fact.missing_reason && canonicalJson(before.source) === canonicalJson(source)) continue;
    if (source.kind !== 'statement_entry' || source.receipt_id !== review.receipt_id ||
      source.source_kind !== 'financial_file' || source.source_id !== file.id || source.source_hash !== file.sha256 ||
      source.page > file.page_count || !source.quote.trim()) fail('INVALID_FINANCIAL_SOURCE');
  }
  if ((await tx.query(`SELECT 1 FROM aic.audit_events WHERE subject_id=$1
    AND action IN ('financial.import_extracted','financial.intake_period_reviewed') LIMIT 1`,[review.receipt_id])).rows.length)
    fail('FINANCIAL_RECEIPT_ALREADY_EXISTS');
  const receipt = {
    contract_version:'AIC-FINANCIAL-IMPORT-1', receipt_id:review.receipt_id, document_type:'financial_statement',
    sha256:file.sha256, source:{id:file.id,kind:'financial_file',sha256:file.sha256,page_count:file.page_count},
    scope:{...input.period,period_kind:input.period.kind,basis:input.basis,accounting_regime:input.accounting_regime,
      currency:input.currency,unit_multiplier:input.unit_multiplier},
    facts:[], missing_keys:[...FHI_FACT_KEYS], selected_pages:[...new Set([review.page,...input.facts.map((f:any)=>f.source.page)])],
    scope_evidence:[{page:review.page,quote:review.quote}], human_review:{by:actorId,reason:input.reason},
  };
  await tx.query(`INSERT INTO aic.audit_events(id,organization_id,case_id,actor_type,actor_id,action,subject_id,
    revision_before,revision_after,metadata_json,reason) VALUES($1,$2,$3,'specialist',$4,
    'financial.intake_period_reviewed',$5,$6,$7,$8::jsonb,$9)`,
    [randomUUID(),current.organization_id,current.id,actorId,review.receipt_id,Number(current.revision),next,canonicalJson(receipt),input.reason]);
  const period = {...input.period,basis:input.basis,pages:receipt.selected_pages,
    evidence:[{page:review.page,quote:review.quote}]};
  const periods = [...(row.classification_json?.periods ?? [])].filter((p:any) =>
    !(p.end_date === input.period.end_date && p.basis === input.basis && p.kind === input.period.kind &&
      (!p.start_date || p.start_date === input.period.start_date)) &&
    !(prior && p.end_date === prior.scope_json.period.end_date && p.basis === prior.scope_json.basis &&
      p.kind === prior.scope_json.period.kind && p.start_date === prior.scope_json.period.start_date));
  periods.push(period);
  if (periods.length > 12) fail('FINANCIAL_PERIOD_LIMIT');
  const statements = previous.filter((s:any)=>s.set_id !== setId);
  statements.push({receipt_id:review.receipt_id,set_id:setId,kind:input.period.kind,start_date:input.period.start_date,end_date:input.period.end_date,basis:input.basis,
    fact_count:input.facts.filter((f:any)=>f.raw_value !== null).length,
    missing_keys:FHI_FACT_KEYS.filter(k=>!input.facts.some((f:any)=>f.key === k && f.raw_value !== null))});
  const classification = {...row.classification_json,contract_version:'AIC-FINANCIAL-INTAKE-1',sha256:file.sha256,
    page_count:file.page_count,document_type:'financial_statement',entity_name:row.classification_json?.entity_name ?? null,
    tax_id:row.classification_json?.tax_id ?? null,periods,warnings:row.classification_json?.warnings ?? [],
    provenance:row.classification_json?.provenance ?? {model_id:'human-review',prompt_version:'human-review-v1'}};
  if (classification.period_issues) classification.period_issues=classification.period_issues.filter((i:any)=>
    !(i.kind===input.period.kind && i.end_date===input.period.end_date && i.basis===input.basis));
  classification.warnings=classification.warnings.filter((w:string)=>
    !w.startsWith('PERIOD_REVIEW_REQUIRED:'+input.period.end_date+':'));
  // Another basis/kind can share the same end date. Keep its warning until
  // that specific scope is reviewed as well.
  for (const issue of classification.period_issues ?? []) {
    if (issue.severity !== 'blocking') continue;
    const warning='PERIOD_REVIEW_REQUIRED:'+(issue.end_date ?? 'unknown')+':'+issue.code;
    if (!classification.warnings.includes(warning)) classification.warnings.push(warning);
  }
  await tx.query(`UPDATE aic.financial_intakes SET classification_json=$2::jsonb,result_json=$3::jsonb,
    state='needs_review',error_code='HUMAN_PERIOD_REVIEWED',origin_json=origin_json||$4::jsonb,
    updated_at=clock_timestamp() WHERE id=$1`,[row.id,canonicalJson(classification),canonicalJson(statements),
      canonicalJson({human_review:{by:actorId,reason:input.reason,receipt_id:review.receipt_id}})]);
  // A multi-period original may still support untouched years. Retire it only
  // after every predecessor set has a replacement and every discovered period is resolved.
  if (row.replacement_of && predecessor.length &&
    predecessor.every((s:any)=>statements.some(t=>t.set_id===s.set_id)) &&
    periods.every((p:any)=>p.start_date && statements.some(s=>s.end_date===p.end_date && s.basis===p.basis)))
    await tx.query('UPDATE aic.financial_intakes SET superseded_by=$2 WHERE id=$1',[row.replacement_of,row.id]);
}
