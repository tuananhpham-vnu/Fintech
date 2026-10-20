// Render preDeployCommand for aic-backend. Runs before traffic switches to a new deploy, never at app start:
//   1. apply pending numbered migrations as the schema OWNER (AIC_MIGRATION_DATABASE_URL)
//   2. re-apply privileges for the restricted runtime role (idempotent; covers tables added by new migrations)
//   3. verify the runtime role is restricted, otherwise the API would refuse to start
//   4. connect with the app's own DATABASE_URL exactly like the API + workers do (aic_runtime, same timeout,
//      several connections at once) and run their startup checks, so a bad runtime URL/password/TLS/privilege
//      fails the deploy here instead of crash-looping the backend
// Prints migration names and sanitized reasons only; never connection strings or credentials.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { databaseUrlProblem } = require('./db-url.cjs')

const ROOT = path.resolve(__dirname, '../..')
const apiRequire = createRequire(path.join(ROOT, 'apps/api/package.json'))
const { Client } = apiRequire('pg')
const { migrate } = require(path.join(ROOT, 'apps/api/dist/database/migrate.js'))

// Same pool settings as apps/api/src/database/database.service.ts, so this proves the app's connection path.
const APP_CLIENT = { connectionTimeoutMillis: 5_000, statement_timeout: 30_000, idle_in_transaction_session_timeout: 30_000 }
const STARTUP_CONNECTIONS = 4 // API + document, dossier and financial-intake workers start at the same time

function describe(error) {
  const code = typeof error?.code === 'string' ? ` ${error.code}` : ''
  const message = String(error?.message ?? error)
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/[^\s:@/]+:[^\s@/]+@/g, '<credentials>@')
    .replace(/(password|passwd|pwd)\s*[=:]\s*\S+/gi, '$1=<redacted>')
    .replace(/\s+/g, ' ')
    .slice(0, 300)
  return `${code.trim() ? code.trim() + ': ' : ''}${message}`
}

async function ownerSteps(url) {
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

async function runtimeConnection(url, index) {
  const started = Date.now()
  const client = new Client({ connectionString: url, ...APP_CLIENT, application_name: `aic-predeploy-runtime-${index}` })
  client.on('error', () => undefined)
  try {
    await client.connect()
    const connectMs = Date.now() - started
    const who = (await client.query('SELECT current_user AS name')).rows[0].name
    if (who !== 'aic_runtime')
      throw new Error(`DATABASE_URL logs in as "${who}", expected "aic_runtime" (user must be aic_runtime.<ref>)`)
    // The API/worker startup check (DatabaseService.onModuleInit), as the runtime role itself.
    const role = (await client.query(`
      SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
        has_schema_privilege(current_user, 'aic', 'CREATE') AS schema_create,
        has_database_privilege(current_user, current_database(), 'CREATE') AS database_create
      FROM pg_roles WHERE rolname = current_user`)).rows[0]
    if (!role || Object.values(role).some((value) => value === true))
      throw new Error('DATABASE_URL role is not restricted; the API would refuse it')
    await client.query('SELECT checksum FROM aic.schema_migrations ORDER BY name DESC LIMIT 1')
    const jobs = (await client.query(`SELECT has_table_privilege(current_user, 'aic.mvp_document_jobs', 'SELECT,UPDATE')
                                        AS ok`)).rows[0]
    if (!jobs.ok) throw new Error('aic_runtime lacks SELECT/UPDATE on aic.mvp_document_jobs')
    return connectMs
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function main() {
  const ownerUrl = process.env.AIC_MIGRATION_DATABASE_URL
  const runtimeUrl = process.env.DATABASE_URL
  if (!ownerUrl) throw new Error('AIC_MIGRATION_DATABASE_URL is not set')
  if (!runtimeUrl) throw new Error('DATABASE_URL is not set')
  for (const [name, value] of [['AIC_MIGRATION_DATABASE_URL', ownerUrl], ['DATABASE_URL', runtimeUrl]]) {
    const problem = databaseUrlProblem(name, value)
    if (problem) throw new Error(problem)
  }
  await ownerSteps(ownerUrl)

  let times
  try {
    times = await Promise.all(Array.from({ length: STARTUP_CONNECTIONS }, (_, i) => runtimeConnection(runtimeUrl, i + 1)))
  } catch (error) {
    throw new Error(`runtime DATABASE_URL check failed: ${describe(error)}`)
  }
  process.stdout.write(`[predeploy] runtime DATABASE_URL: ${STARTUP_CONNECTIONS} concurrent logins as aic_runtime OK ` +
                       `(slowest connect ${Math.max(...times)} ms of 5000 ms allowed)\n`)
}

main().catch((error) => {
  process.stderr.write(`[predeploy] FAILED: ${describe(error)}\n`)
  process.exit(1)
})
