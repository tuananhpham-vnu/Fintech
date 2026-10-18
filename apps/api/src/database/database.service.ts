import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { FOUNDATION_CONFIG } from "../foundation/ports";
import type {
  FoundationConfig,
  FoundationDatabase,
  SqlClient,
  SqlResult,
} from "../foundation/ports";
import { canonicalMigrationSource } from "./migration-source";

const requiredMigration = "0003_authorization_row_locks.sql";

@Injectable()
export class DatabaseService
  implements FoundationDatabase, OnModuleInit, OnModuleDestroy
{
  readonly pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);
  private shutdown?: Promise<void>;
  private readonly requireRestrictedRole: boolean;

  constructor(@Inject(FOUNDATION_CONFIG) config: FoundationConfig) {
    this.requireRestrictedRole = config.isProduction;
    if (!config.databaseUrl?.trim())
      throw new Error("Database URL is required");
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 30_000,
      max: 10,
      application_name: "aic-foundation",
    });
    // Idle clients emit outside request handling; never log the error/connection details.
    this.pool.on("error", () =>
      this.logger.error("PostgreSQL idle connection failed"),
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.query("SELECT 1");
      if (this.requireRestrictedRole) {
        const role = (
          await this.query(`
          SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
            has_schema_privilege(current_user,'aic','CREATE') AS schema_create,
            has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
            EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='aic' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owns_objects
          FROM pg_roles WHERE rolname=current_user
        `)
        ).rows[0];
        if (!role || Object.values(role).some((value) => value === true))
          throw new Error(
            "Production database connections require a restricted nonowner role",
          );
      }
      const directory = resolve(__dirname, "../../migrations");
      const migrations = (await readdir(directory, { withFileTypes: true }))
        .filter(
          (entry) =>
            entry.isFile() && /^\d{4}_[a-z0-9_]+\.sql$/.test(entry.name),
        )
        .map((entry) => entry.name)
        .sort();
      // 0020 is an optional, additive company-workspace expansion. Transaction
      // installations on 0019 remain usable until an operator approves rollout.
      // The company creation service fails closed when the expansion is absent.
      const optionalExpansion = "0020_company_health_workspaces.sql";
      const required = migrations.filter((name) => name !== optionalExpansion);
      const latest = required[required.length - 1];
      if (!latest || !migrations.includes(requiredMigration)) {
        throw new Error("Database migration files are required for readiness");
      }
      const { checksum } = canonicalMigrationSource(
        await readFile(resolve(directory, latest), "utf8"),
      );
      const ledger = await this.query(
        "SELECT checksum FROM aic.schema_migrations WHERE name = $1",
        [latest],
      );
      if (ledger.rows.length !== 1 || ledger.rows[0].checksum !== checksum) {
        throw new Error(
          "Database migrations are not current; run the explicit migration runner",
        );
      }
      const expansion = await this.query(
        "SELECT checksum FROM aic.schema_migrations WHERE name=$1",
        [optionalExpansion],
      );
      if (expansion.rows.length) {
        const expected = canonicalMigrationSource(
          await readFile(resolve(directory, optionalExpansion), "utf8"),
        ).checksum;
        if (
          expansion.rows.length !== 1 ||
          expansion.rows[0].checksum !== expected
        )
          throw new Error(
            "Company workspace migration checksum does not match",
          );
      }
    } catch (error) {
      await this.onModuleDestroy().catch(() => undefined);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await (this.shutdown ??= this.pool.end());
  }

  async query(text: string, values?: unknown[]): Promise<SqlResult> {
    return this.pool.query(text, values);
  }

  async transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // A connection whose transaction cannot be rolled back must not reenter the pool.
        discard = true;
      }
      // Preserve the original SQL/domain error for the main application's global filter.
      throw error;
    } finally {
      client.release(discard);
    }
  }
}
