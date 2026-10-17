import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { FOUNDATION_CONFIG } from '../foundation/ports'
import type {
  FoundationConfig,
  FoundationDatabase,
  SqlClient,
  SqlResult,
} from '../foundation/ports'
import { canonicalMigrationSource } from './migration-source'

const requiredMigration = '0003_authorization_row_locks.sql'

@Injectable()
export class DatabaseService implements FoundationDatabase, OnModuleInit, OnModuleDestroy {
  readonly pool: Pool
  private readonly logger = new Logger(DatabaseService.name)
  private shutdown?: Promise<void>

  constructor(@Inject(FOUNDATION_CONFIG) config: FoundationConfig) {
    if (!config.databaseUrl?.trim()) throw new Error('Database URL is required')
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 30_000,
      max: 10,
      application_name: 'aic-foundation',
    })
    // Idle clients emit outside request handling; never log the error/connection details.
    this.pool.on('error', () => this.logger.error('PostgreSQL idle connection failed'))
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.query('SELECT 1')
      const directory = resolve(__dirname, '../../migrations')
      const migrations = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /^\d{4}_[a-z0-9_]+\.sql$/.test(entry.name))
        .map((entry) => entry.name)
        .sort()
      const latest = migrations[migrations.length - 1]
      if (!latest || !migrations.includes(requiredMigration)) {
        throw new Error('Database migration files are required for readiness')
      }
      const { checksum } = canonicalMigrationSource(
        await readFile(resolve(directory, latest), 'utf8'),
      )
      const ledger = await this.query(
        'SELECT checksum FROM aic.schema_migrations WHERE name = $1',
        [latest],
      )
      if (ledger.rows.length !== 1 || ledger.rows[0].checksum !== checksum) {
        throw new Error('Database migrations are not current; run the explicit migration runner')
      }
    } catch (error) {
      await this.onModuleDestroy().catch(() => undefined)
      throw error
    }
  }

  async onModuleDestroy(): Promise<void> {
    await (this.shutdown ??= this.pool.end())
  }

  async query(text: string, values?: unknown[]): Promise<SqlResult> {
    return this.pool.query(text, values)
  }

  async transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    let discard = false
    try {
      await client.query('BEGIN')
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // A connection whose transaction cannot be rolled back must not reenter the pool.
        discard = true
      }
      // Preserve the original SQL/domain error for the main application's global filter.
      throw error
    } finally {
      client.release(discard)
    }
  }
}
