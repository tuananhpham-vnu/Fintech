const fs = require('node:fs'), path = require('node:path')
const name = path.resolve(__dirname, '../packages/contracts/aic-financial-intake/schemas.json')
const data = JSON.parse(fs.readFileSync(name, 'utf8'))
const decision = data.definitions.FinancialIntakeDecision
Object.assign(data.definitions.FinancialIntakeItem.properties.statements.items.properties, {
  kind: { enum: ['FY','INTERIM','TTM'] }, start_date: { type: 'string', format: 'date' },
})
decision.properties.action.enum = ['retry', 'replace', 'keep_existing', 'exclude', 'compare_periods', 'select_period_source', 'keep_period_source']
Object.assign(decision.properties, {
  receipt_id: { type: 'string', format: 'uuid' }, set_id: { type: 'string', format: 'uuid' },
  expected_set_revision: { type: 'integer', minimum: 1 },
})
decision.allOf = [{ if: { properties: { action: { enum: ['select_period_source', 'keep_period_source'] } } },
  then: { required: ['receipt_id', 'set_id', 'expected_set_revision'] } }]
fs.writeFileSync(name, JSON.stringify(data, null, 2) + '\n')
