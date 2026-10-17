import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { canonicalMigrationSource } from './migration-source'

const migrationsDirectory = resolve(__dirname, '../../migrations')
// Session lock shared by every invocation, including invocations before schema creation.
const advisoryLock = [1_095_320_369, 1]

interface Migration {
  name: string
  checksum: string
  sql: string
}

async function readMigrations(): Promise<Migration[]> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true })
  const names: string[] = []
  const versions = new Set<string>()
  for (const entry of entries) {
    if (!entry.name.endsWith('.sql')) continue
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(entry.name)
    if (!entry.isFile() || !match || versions.has(match[1])) {
      throw new Error('Invalid or duplicate numbered SQL migration')
    }
    versions.add(match[1])
    names.push(entry.name)
  }
  if (names.length === 0) throw new Error('No numbered SQL migrations found')
  return Promise.all(
    names.sort().map(async (name) => {
      const contents = await readFile(resolve(migrationsDirectory, name), 'utf8')
      return {
        name,
        ...canonicalMigrationSource(contents),
      }
    }),
  )
}

async function inTransaction<T>(client: Client, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN')
  try {
    const result = await work()
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

/** Explicit operator action only: importing this module or starting Nest never migrates. */
export async function migrate(databaseUrl: string): Promise<{ applied: string[] }> {
  if (!databaseUrl?.trim()) throw new Error('Database URL is required')
  const migrations = await readMigrations()
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 60_000,
    idle_in_transaction_session_timeout: 60_000,
    application_name: 'aic-migrate',
  })
  // Query promises carry connection failures to the caller; suppress unhandled idle events.
  client.on('error', () => undefined)
  let locked = false
  try {
    await client.connect()
    await client.query('SELECT pg_advisory_lock($1::integer, $2::integer)', advisoryLock)
    locked = true
    await inTransaction(client, async () => {
      await client.query('CREATE SCHEMA IF NOT EXISTS aic')
      await client.query(`
        CREATE TABLE IF NOT EXISTS aic.schema_migrations (
          name text PRIMARY KEY,
          checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `)
    })
    const ledger = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM aic.schema_migrations ORDER BY name COLLATE "C"',
    )
    // The applied ledger must be a prefix: reject deleted/renamed/reordered history too.
    for (let index = 0; index < ledger.rows.length; index += 1) {
      const recorded = ledger.rows[index]
      const migration = migrations[index]
      if (!migration || migration.name !== recorded.name) {
        throw new Error('Applied migration history does not match local migration order')
      }
      if (migration.checksum !== recorded.checksum) {
        throw new Error(`Migration checksum mismatch: ${migration.name}`)
      }
    }

    const applied: string[] = []
    for (const migration of migrations.slice(ledger.rows.length)) {
      await inTransaction(client, async () => {
        await client.query(migration.sql)
        await client.query('INSERT INTO aic.schema_migrations (name, checksum) VALUES ($1, $2)', [
          migration.name,
          migration.checksum,
        ])
      })
      applied.push(migration.name)
    }
    return { applied }
  } finally {
    if (locked) {
      // Closing the client also releases the session lock if the connection is broken.
      await client
        .query('SELECT pg_advisory_unlock($1::integer, $2::integer)', advisoryLock)
        .catch(() => undefined)
    }
    await client.end()
  }
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl?.trim()) {
    process.stderr.write('DATABASE_URL is required for migrations.\n')
    process.exitCode = 1
  } else {
    void migrate(databaseUrl).then(
      (result) => {
        process.stdout.write(`${JSON.stringify(result)}\n`)
      },
      () => {
        // pg errors may contain credentials, SQL, or row values. Never print them here.
        process.stderr.write('Database migration failed.\n')
        process.exitCode = 1
      },
    )
  }
}
