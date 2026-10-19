// Render preDeployCommand for aic-backend. Runs as the schema OWNER (AIC_MIGRATION_DATABASE_URL), never at app start:
//   1. apply pending numbered migrations (the repository's own runner, transactional, checksum-verified)
//   2. re-apply privileges for the restricted runtime role (idempotent; covers tables added by new migrations)
//   3. verify the runtime role is restricted, otherwise the API would refuse to start
// Prints migration names and fixed messages only; never connection strings or credentials.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const ROOT = path.resolve(__dirname, '../..')
const apiRequire = createRequire(path.join(ROOT, 'apps/api/package.json'))
const { Client } = apiRequire('pg')
const { migrate } = require(path.join(ROOT, 'apps/api/dist/database/migrate.js'))

async function main() {
  const url = process.env.AIC_MIGRATION_DATABASE_URL
  if (!url) throw new Error('AIC_MIGRATION_DATABASE_URL is not set')
  const { applied } = await migrate(url)
  process.stdout.write(`[predeploy] migrations applied: ${applied.length ? applied.join(', ') : 'none (up to date)'}\n`)

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000, application_name: 'aic-predeploy' })
  client.on('error', () => undefined)
  await client.connect()
  try {
    const role = await client.query(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
                                      FROM pg_roles WHERE rolname = 'aic_runtime'`)
    if (!role.rows.length)
      throw new Error('Role aic_runtime does not exist; run deploy/supabase/create-runtime-role.sql in Supabase first')
    await client.query(fs.readFileSync(path.join(__dirname, 'runtime-grants.sql'), 'utf8'))
    const check = await client.query(`
      SELECT has_schema_privilege('aic_runtime', 'aic', 'CREATE') AS schema_create,
             has_database_privilege('aic_runtime', current_database(), 'CREATE') AS database_create,
             EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'aic' AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'aic_runtime'))
               AS owns_objects`)
    const flags = { ...role.rows[0], ...check.rows[0] }
    const unsafe = Object.entries(flags).filter(([, value]) => value === true).map(([name]) => name)
    if (unsafe.length) throw new Error(`aic_runtime is not restricted (${unsafe.join(', ')}); the API would refuse it`)
    process.stdout.write('[predeploy] runtime role aic_runtime: privileges applied, restricted check passed\n')
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  // pg/network errors can include host names but never passwords; still keep the message short.
  process.stderr.write(`[predeploy] FAILED: ${String(error && error.message).slice(0, 200)}\n`)
  process.exit(1)
})
