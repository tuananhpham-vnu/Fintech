/** Additive contracts for the owner-approved international financial pilot. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const profiles = {
 type:'object', additionalProperties:false,
 properties:{
  id:{enum:['US_GAAP_DISTRIBUTION_1','CN_ASBE_DISTRIBUTION_1']},
  country:{enum:['US','CN']}, accounting_regime:{enum:['US_GAAP','CN_ASBE']},
  mapping_version:{const:'international-accounting-v1'},
  method_version:{enum:['1.0.0-us-gaap-pilot.1','1.0.0-cn-asbe-pilot.1']},
 },
 required:['id','country','accounting_regime','mapping_version','method_version'],
};
const extra='eligible_cash_and_equivalents';
function visit(node) {
 if(!node || typeof node!=='object') return;
 if(Array.isArray(node)) { node.forEach(visit); return; }
 // Only financial-key lists are extended; the legacy 14 reasoning targets stay unchanged.
 if(Array.isArray(node.enum) && node.enum.includes('current_assets') && node.enum.includes('cash_from_operations') && !node.enum.includes(extra)) node.enum.push(extra);
 if(node.type==='array' && node.maxItems===14 && node.items?.properties?.key?.enum?.includes(extra)) node.maxItems=15;
 if(node.type==='array' && node.maxItems===14 && node.items?.enum?.includes(extra)) node.maxItems=15;
 if(node.properties?.facts?.maxItems===14) node.properties.facts.maxItems=15;
 if(node.properties?.fact_count?.maximum===14) {
  node.properties.fact_count.maximum=15;
  if(node.properties.missing_keys?.maxItems===14) node.properties.missing_keys.maxItems=15;
 }
 if(node.properties?.bridge_assertions && node.properties?.fact_ids?.maxItems===14) node.properties.fact_ids.maxItems=15;
 if(node.properties?.bridge_assertions?.properties) {
  node.properties.bridge_assertions.properties.international_operating_profit_reconciled={type:'boolean'};
  node.properties.bridge_assertions.properties.source_rounding_reviewed={type:'boolean'};
  node.properties.bridge_assertions.properties.assessment_basis={enum:['standalone','consolidated']};
  node.properties.bridge_assertions.properties.expense_presentation_sign_reviewed={type:'boolean'};
 }
 for(const value of Object.values(node))visit(value);
}
for(const relative of [
 'packages/contracts/aic-foundation/schemas.json','packages/contracts/aic-assessment/schemas.json',
 'packages/contracts/aic-assessment/openapi.json','packages/contracts/aic-financial-import/schemas.json',
 'packages/contracts/aic-financial-intake/schemas.json',
 'packages/contracts/aic-financial-import/observation-model.schema.json',
 'packages/contracts/aic-financial-import/relation-model.schema.json',
 'packages/contracts/aic-financial-import/reasoning-model.schema.json',
 'packages/contracts/aic-financial-import/calculation-model.schema.json',
]) {
 const file=path.join(root,relative), doc=JSON.parse(fs.readFileSync(file,'utf8'));
 visit(doc);
 const defs=doc.definitions ?? doc.components?.schemas;
 if(defs) {
  defs.AccountingProfileV1=profiles;
  if(defs.FinancialSetRead?.properties?.metadata?.properties) {
   defs.FinancialSetRead.properties.metadata.properties.accounting_profile=profiles;
   defs.FinancialSetRead.properties.metadata.properties.source_rounding={
    type:'object',additionalProperties:false,required:['quantums','evidence'],properties:{
     quantums:{type:'object',additionalProperties:false,properties:Object.fromEntries(['total_assets','total_liabilities','total_equity'].map(k=>[k,{type:'string',pattern:'^[0-9]+(\\.[0-9]+)?$'}])),required:['total_assets','total_liabilities','total_equity']},
     evidence:{type:'array',minItems:1,items:{type:'object',required:['page','quote'],properties:{page:{type:'integer',minimum:1,maximum:600},quote:{type:'string',minLength:1}},additionalProperties:false}}
    }
   };
  }
  if(defs.CaseAggregationV1) defs.CaseAggregationV1.properties.accounting_profile=profiles;
  if(defs.FinancialIntakePage) defs.FinancialIntakePage.properties.capabilities={
   type:'object',additionalProperties:false,required:['countries','country'],
   properties:{countries:{type:'array',uniqueItems:true,items:{enum:['VN','US','CN']}},country:{type:'string'}}
  };
 }
 fs.writeFileSync(file,JSON.stringify(doc,null,2)+'\n');
}
