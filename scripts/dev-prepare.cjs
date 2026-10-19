// Local development preparation only. Nest/production startup stays read-only.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawn, execFileSync } = require("node:child_process");

function localTarget(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Local startup requires a valid PostgreSQL DATABASE_URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash ||
    !url.username ||
    url.pathname.length < 2
  )
    throw new Error(
      "Automatic dev preparation requires plain loopback PostgreSQL URLs (no query options).",
    );
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

function validateTargets(ownerUrl, apiUrl, workerUrl, env = process.env) {
  if (env.NODE_ENV === "production")
    throw new Error(
      "dev:all is for local development; production migrations require the explicit runner.",
    );
  const targets = [ownerUrl, apiUrl, workerUrl].map(localTarget);
  if (
    targets.some(
      (target) =>
        target.port !== targets[0].port ||
        target.database !== targets[0].database ||
        target.host !== targets[0].host,
    )
  )
    throw new Error(
      "Owner, API and worker URLs must identify the same local PostgreSQL database.",
    );
  return targets;
}

function pendingMigrations(root, ledger) {
  const { canonicalMigrationSource } = require(
    path.join(root, "apps/api/dist/database/migration-source.js"),
  );
  const directory = path.join(root, "apps/api/migrations");
  const names = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const versions = new Set();
  for (const name of names) {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name);
    if (
      !match ||
      versions.has(match[1]) ||
      !fs.statSync(path.join(directory, name)).isFile()
    )
      throw new Error("Invalid or duplicate numbered SQL migration.");
    versions.add(match[1]);
  }
  if (!names.length) throw new Error("No numbered SQL migrations found.");
  for (let i = 0; i < ledger.length; i++) {
    if (names[i] !== ledger[i].name)
      throw new Error(
        "Applied migration history does not match local migration order.",
      );
    const { checksum } = canonicalMigrationSource(
      fs.readFileSync(path.join(directory, names[i]), "utf8"),
    );
    if (checksum !== ledger[i].checksum)
      throw new Error(`Migration checksum mismatch: ${names[i]}`);
  }
  return names.slice(ledger.length);
}

function privateBackupDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aic-dev-backup-"));
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `
      $ErrorActionPreference='Stop'; $me=[Security.Principal.WindowsIdentity]::GetCurrent().User;
      $acl=New-Object Security.AccessControl.DirectorySecurity;
      $acl.SetOwner($me); $acl.SetAccessRuleProtection($true,$false);
      foreach($sid in @($me.Value,'S-1-5-18','S-1-5-32-544')) {
        $identity=New-Object Security.Principal.SecurityIdentifier($sid);
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
      }; [IO.Directory]::SetAccessControl($env:AIC_DEV_BACKUP_DIR,$acl)
    `,
      ],
      {
        env: { ...process.env, AIC_DEV_BACKUP_DIR: directory },
        stdio: "pipe",
        windowsHide: true,
      },
    );
  } else fs.chmodSync(directory, 0o700);
  return directory;
}

function quietCommand(file, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env,
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Database backup timed out; no migration was started."));
    }, 120_000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(
        new Error(
          "PostgreSQL backup tools could not start; no migration was started.",
        ),
      );
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(new Error("Database backup failed; no migration was started."));
    });
  });
}

async function backupDatabase(target, env = process.env) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const bin =
    env.AIC_POSTGRES_BIN ||
    (process.platform === "win32" ? "C:/Program Files/PostgreSQL/18/bin" : "");
  const tool = (name) => (bin ? path.join(bin, name + suffix) : name);
  const directory = privateBackupDirectory();
  const file = path.join(directory, "before-migration.dump");
  // Credentials are passed only in the child environment, never argv/output.
  const pgEnv = {
    ...Object.fromEntries(
      Object.entries(env).filter(([key]) =>
        /^(PATH|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE)$/i.test(key),
      ),
    ),
    PGHOST: target.host,
    PGPORT: target.port,
    PGDATABASE: target.database,
    PGUSER: target.user,
    PGPASSWORD: target.password,
    PGCONNECT_TIMEOUT: "5",
    PGSSLMODE: "disable",
  };
  await quietCommand(
    tool("pg_dump"),
    ["--no-password", "--format=custom", "--file", file],
    pgEnv,
  );
  await quietCommand(tool("pg_restore"), ["--list", file], pgEnv);
  if (!fs.statSync(file).size)
    throw new Error("Database backup is empty; no migration was started.");
  return file;
}

async function prepareLocalDatabase({
  root,
  ownerUrl,
  apiUrl,
  workerUrl,
  env = process.env,
  log = console.log,
  backup = backupDatabase,
  migrate,
}) {
  const targets = validateTargets(ownerUrl, apiUrl, workerUrl, env);
  const req = createRequire(path.join(root, "apps/api/package.json"));
  const { Client } = req("pg");
  const client = new Client({
    connectionString: ownerUrl,
    connectionTimeoutMillis: 5000,
    statement_timeout: 60_000,
  });
  client.on("error", () => undefined);
  let phase =
    "Database connection failed; check the local PostgreSQL service and DATABASE_URL.";
  try {
    await client.connect();
    const exists = (
      await client.query(
        "SELECT to_regclass('aic.schema_migrations') IS NOT NULL AS present",
      )
    ).rows[0].present;
    const ledger = exists
      ? (
          await client.query(
            'SELECT name,checksum FROM aic.schema_migrations ORDER BY name COLLATE "C"',
          )
        ).rows
      : [];
    const pending = pendingMigrations(root, ledger);
    let backupPath;
    if (pending.length) {
      log(
        `[PREP] ${pending.length} pending migration(s); backing up the local database first...`,
      );
      phase = "Local database backup failed; no migration was started.";
      backupPath = await backup(targets[0], env);
      log(`[PREP] Database backup: ${backupPath}`);
      phase = `Local migration failed. Backup retained at ${backupPath}`;
      const run =
        migrate ||
        require(path.join(root, "apps/api/dist/database/migrate.js")).migrate;
      const result = await run(ownerUrl);
      log(`[PREP] Applied: ${result.applied.join(", ") || "already current"}`);
    } else log("[PREP] Database migrations are current.");

    // Use the existing reviewed runtime grant list; never create roles/passwords.
    phase =
      "Runtime database grants failed; check the owner connection and configured API/worker roles.";
    const ident = (name) => '"' + name.replaceAll('"', '""') + '"';
    const grants = fs
      .readFileSync(
        path.join(root, "scripts/sandbox-runtime-grants.sql"),
        "utf8",
      )
      .replaceAll(':"api_role"', ident(targets[1].user))
      .replaceAll(':"worker_role"', ident(targets[2].user));
    if (
      targets[1].user !== targets[0].user ||
      targets[2].user !== targets[0].user
    ) {
      await client.query("BEGIN");
      try {
        await client.query(grants);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      log("[PREP] Local API/worker runtime grants are current.");
    }
    return { pending, backupPath };
  } catch (error) {
    // SQL/connection errors can contain credentials or financial row values.
    if (
      error.message?.startsWith("Migration checksum mismatch:") ||
      error.message ===
        "Applied migration history does not match local migration order."
    )
      throw error;
    throw new Error(phase);
  } finally {
    await client.end().catch(() => undefined);
  }
}

module.exports = {
  localTarget,
  validateTargets,
  pendingMigrations,
  backupDatabase,
  prepareLocalDatabase,
};
