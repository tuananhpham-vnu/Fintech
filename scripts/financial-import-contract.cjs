// Reproducible additive extension; canonical AI 1.0.2 and its checksums stay frozen.
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false })
const str = (maxLength = 500) => ({ type: 'string', minLength: 1, maxLength })
const uuid = { type: 'string', format: 'uuid' }
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' }
const page = { type: 'integer', minimum: 1, maximum: 600 }
const source = obj({ kind: { const: 'financial_import' }, receipt_id: uuid, fact_key: str(100),
  source_kind: { enum: ['document', 'dossier_member', 'financial_file'] }, source_id: uuid,
  source_hash: hash, page, quote: str(4000) })
const review = obj({ receipt_id: uuid, confirmed: { const: true } })
function extend(node) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node.enum) && node.enum.includes('VN_TT133')) {
    for (const regime of ['VN_TT200', 'US_GAAP', 'CN_ASBE']) if (!node.enum.includes(regime)) node.enum.push(regime)
  }
  if (node.FinancialSourceInput?.oneOf)
    node.FinancialSourceInput.oneOf = [...node.FinancialSourceInput.oneOf.filter(s => s.properties?.kind?.const !== 'financial_import'),source]
  if (node.FinancialSetInput?.properties) node.FinancialSetInput.properties.import_review = review
  for (const child of Object.values(node)) extend(child)
}
for (const file of ['aic-foundation/schemas.json', 'aic-assessment/schemas.json', 'aic-assessment/openapi.json']) {
  const name = path.join(root, 'packages/contracts', file)
  if (!fs.existsSync(name)) continue
  const bundle = JSON.parse(fs.readFileSync(name, 'utf8'))
  extend(bundle)
  fs.writeFileSync(name, JSON.stringify(bundle, null, 2) + '\n')
}
const definitions = {
  FinancialImportRequest: obj({ expected_revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    source_kind: { enum: ['document', 'dossier_member', 'financial_file'] }, source_id: uuid,
    operation: { enum: ['index', 'extract'] },
    pages: { type: 'array', uniqueItems: true, maxItems: 16, items: page },
    requested_scope: obj({ country: { enum: ['VN', 'US', 'CN'] }, basis: { enum: ['standalone', 'consolidated'] },
      end_date: { type: 'string', format: 'date' } }),
  }, ['expected_revision', 'source_kind', 'source_id', 'operation', 'pages']),
  FinancialImportSource: source,
}
const model = JSON.parse(fs.readFileSync(path.join(root,'packages/contracts/aic-financial-import/model.schema.json'),'utf8'))
const base = { contract_version:{const:'AIC-FINANCIAL-IMPORT-1'},sha256:hash,
  page_count:{type:'integer',minimum:1,maximum:600},
  suggested_pages:{type:'array',items:page,uniqueItems:true,maxItems:16} }
definitions.FinancialImportAiIndex = obj({...base,pages:{type:'array',minItems:1,maxItems:600,
  items:obj({page,preview:{type:'string',maxLength:220},needs_ocr:{type:'boolean'},statement_title:{type:'boolean'}})}})
const candidate = model.properties.facts.items
definitions.FinancialImportAiCandidates = obj({...base,...model.properties,
  facts:{...model.properties.facts,items:obj({...candidate.properties,method:{enum:['native','ocr']},verification:{const:'unverified'}})},
  selected_pages:{type:'array',items:page,uniqueItems:true,minItems:1,maxItems:16},
  missing_keys:{type:'array',items:{enum:candidate.properties.key.enum},uniqueItems:true,maxItems:14},
  rejected:{type:'array',maxItems:14,items:obj({key:{enum:candidate.properties.key.enum},code:str(100)})},
  warnings:{type:'array',maxItems:20,items:str(100)},
  ocr_failures:{type:'array',maxItems:8,items:obj({page,code:{enum:['INVALID_MODEL_OUTPUT','PROVIDER_UNAVAILABLE']}})},
  provenance:obj({model_id:str(250),prompt_version:{const:'financial-import-v1'},ocr_version:str(250)}),
})
const dir = path.join(root, 'packages/contracts/aic-financial-import')
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'schemas.json'), JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#',
  contract_version: 'AIC-FINANCIAL-IMPORT-1', definitions }, null, 2) + '\n')
