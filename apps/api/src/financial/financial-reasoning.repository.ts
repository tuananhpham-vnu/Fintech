import { canonicalJson } from '../foundation/canonical';
import type { SqlClient } from '../foundation/ports';
import { reasoningSummary, solveReasoning } from './financial-reasoning';

/** Written only in the same fenced acceptance transaction as the immutable receipt. */
export async function persistReasoning(tx:SqlClient,current:any,receipt:any) {
  if(!receipt.reasoning)return;
  const summary=reasoningSummary(receipt), result=solveReasoning(receipt.reasoning,receipt.scope);
  await tx.query(`INSERT INTO aic.financial_reasoning_runs(id,organization_id,case_id,source_hash,graph_hash,scope_json,graph_json,summary_json)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)`,[receipt.receipt_id,current.organization_id,current.id,
    receipt.sha256,summary!.proof_hash,canonicalJson(receipt.scope),canonicalJson(receipt.reasoning),canonicalJson(summary)]);
  let ordinal=0;
  for(const variable of receipt.reasoning.variables) {
    await tx.query(`INSERT INTO aic.financial_reasoning_observations(organization_id,case_id,run_id,ordinal,variable_id,payload_json)
      VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[current.organization_id,current.id,receipt.receipt_id,ordinal++,variable.id,
      canonicalJson({variable,observations:receipt.reasoning.observations.filter((o:any)=>o.variable_id===variable.id)})]);
  }
  for(const relation of receipt.reasoning.relations) await tx.query(`INSERT INTO aic.financial_reasoning_relations
    (organization_id,case_id,run_id,relation_id,payload_json) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [current.organization_id,current.id,receipt.receipt_id,relation.id,canonicalJson(relation)]);
  for(const resolution of result.resolutions) await tx.query(`INSERT INTO aic.financial_reasoning_derivations
    (organization_id,case_id,run_id,fact_key,payload_json) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [current.organization_id,current.id,receipt.receipt_id,resolution.key,canonicalJson(resolution)]);
}
