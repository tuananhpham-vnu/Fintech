const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const { validateTargets, prepareLocalDatabase } = require("../dev-prepare.cjs");
const { localEnvironment, aiEnvironment } = require("../dev-environment.cjs");
const root = path.resolve(__dirname, "../..");
test('Mot APIs launcher isolates key, model, endpoint and explicit vision flag',()=>{
  const selected=aiEnvironment({AI_PROVIDER:'motapis',MOTAPIS_API_KEY:'synthetic-motapis',
    MOTAPIS_VISION_ENABLED:'1',DEEPSEEK_API_KEY:'wrong-key',AGENTROUTER_API_KEY:'wrong-key',GEMINI_API_KEY:'wrong-key'});
  assert.equal(selected.MOTAPIS_API_KEY,'synthetic-motapis');
  assert.equal(selected.MODEL_ID,'gpt-6-luna');
  assert.equal(selected.MOTAPIS_BASE_URL,'https://motapis.com/v1');
  assert.equal(selected.MOTAPIS_VISION_ENABLED,'1');
  for(const key of ['DEEPSEEK_API_KEY','AGENTROUTER_API_KEY','GEMINI_API_KEY'])assert.equal(selected[key],undefined);
  assert.throws(()=>aiEnvironment({AI_PROVIDER:'motapis',DEEPSEEK_API_KEY:'wrong-key'}),/MOTAPIS_API_KEY/);
});
test('AI launcher passes local OCR settings without changing Gemini or exposing other provider keys',()=>{
  const selected=aiEnvironment({AI_PROVIDER:'gemini',GEMINI_API_KEY:'synthetic',OCR_ENGINE:'docling',
    DOCLING_ENGINE:'easyocr',DOCLING_LANG:'vi,en',DOCLING_PYTHON:'C:/private/runtime/python.exe',
    DOCLING_ARTIFACTS_PATH:'C:/private/models',DEEPSEEK_API_KEY:'private-unused'});
  assert.equal(selected.AI_PROVIDER,'gemini');assert.equal(selected.MODEL_ID,'gemini-3.1-flash-lite');
  assert.equal(selected.DOCLING_LANG,'vi,en');assert.equal(selected.DOCLING_PYTHON,'C:/private/runtime/python.exe');
  assert.equal(selected.DEEPSEEK_API_KEY,undefined);
});
const req = createRequire(path.join(root, "apps/api/package.json"));
const { Client } = req("pg");
const { canonicalMigrationSource } = require(
  path.join(root, "apps/api/dist/database/migration-source.js"),
);
const { startupFailure } = require(
  path.join(root, "apps/api/dist/config/startup-diagnostics.js"),
);

test("AI launcher selects one provider/key/model, retaining Gemini defaults and legacy model config", () => {
  const shared = {
    GEMINI_API_KEY: "synthetic-gemini",
    DEEPSEEK_API_KEY: "synthetic-deepseek",
    AGENTROUTER_API_KEY: "synthetic-agentrouter",
    MODEL_ID: "gemini-legacy",
    DATABASE_URL: "must-not-reach-ai",
  };
  const gemini = aiEnvironment(shared);
  assert.equal(gemini.AI_PROVIDER, "gemini");
  assert.equal(gemini.MODEL_ID, "gemini-legacy");
  assert.equal(gemini.GEMINI_API_KEY, "synthetic-gemini");
  assert.equal(gemini.DEEPSEEK_API_KEY, undefined);
  assert.equal(gemini.AGENTROUTER_API_KEY, undefined);
  const deepseek = aiEnvironment({ ...shared, AI_PROVIDER: "deepseek" });
  assert.equal(deepseek.MODEL_ID, "deepseek-flash");
  assert.equal(deepseek.DEEPSEEK_BASE_URL, "https://api.deepseek.com");
  assert.equal(deepseek.DEEPSEEK_API_KEY, "synthetic-deepseek");
  assert.equal(deepseek.GEMINI_API_KEY, undefined);
  assert.equal(deepseek.AGENTROUTER_API_KEY, undefined);
  assert.equal(deepseek.DATABASE_URL, undefined);
  assert.equal(deepseek.OCR_ENGINE, "provider");
  assert.equal(
    aiEnvironment({
      AI_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "synthetic",
      DEEPSEEK_MODEL_ID: "deepseek-v4-pro",
      OCR_ENGINE: "none",
    }).OCR_ENGINE,
    "none",
  );
  assert.equal(
    aiEnvironment({ ...shared, GEMINI_MODEL_ID: "gemini-new" }).MODEL_ID,
    "gemini-new",
  );
});

test("AI launcher isolates Agent Router credentials, model, endpoint and vision capability", () => {
  const selected = aiEnvironment({
    AI_PROVIDER: "agentrouter",
    AGENTROUTER_API_KEY: "synthetic-router",
    GEMINI_API_KEY: "must-not-forward",
    DEEPSEEK_API_KEY: "must-not-forward",
    MODEL_ID: "gemini-old",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com",
    DATABASE_URL: "must-not-forward",
  });
  assert.equal(selected.AGENTROUTER_API_KEY, "synthetic-router");
  assert.equal(selected.AGENTROUTER_MODEL_ID, "deepseek-v4-flash");
  assert.equal(selected.MODEL_ID, "deepseek-v4-flash");
  assert.equal(selected.AGENTROUTER_BASE_URL, "https://agentrouter.org/v1");
  assert.equal(selected.AGENTROUTER_VISION_ENABLED, "0");
  for (const name of [
    "GEMINI_API_KEY",
    "DEEPSEEK_API_KEY",
    "DATABASE_URL",
    "DEEPSEEK_BASE_URL",
  ])
    assert.equal(selected[name], undefined);
  assert.throws(
    () =>
      aiEnvironment({
        AI_PROVIDER: "agentrouter",
        DEEPSEEK_API_KEY: "wrong-key",
      }),
    /AGENTROUTER_API_KEY/,
  );
  assert.throws(
    () =>
      aiEnvironment({
        AI_PROVIDER: "agentrouter",
        AGENTROUTER_API_KEY: "synthetic",
        AGENTROUTER_BASE_URL: "https://agentrouter.org",
      }),
    /AGENTROUTER_BASE_URL/,
  );
  assert.throws(
    () =>
      aiEnvironment({
        AI_PROVIDER: "agentrouter",
        AGENTROUTER_API_KEY: "synthetic",
        AGENTROUTER_VISION_ENABLED: "yes",
      }),
    /VISION_ENABLED/,
  );
});

test("AI launcher rejects missing selected keys, invalid provider/endpoints and empty models", () => {
  assert.throws(
    () =>
      aiEnvironment({ AI_PROVIDER: "deepseek", GEMINI_API_KEY: "synthetic" }),
    /requires DEEPSEEK_API_KEY/,
  );
  assert.throws(
    () =>
      aiEnvironment({ AI_PROVIDER: "gemini", DEEPSEEK_API_KEY: "synthetic" }),
    /requires GEMINI_API_KEY/,
  );
  assert.throws(
    () => aiEnvironment({ AI_PROVIDER: "unsupported" }),
    /must be gemini or deepseek/,
  );
  for (const DEEPSEEK_BASE_URL of [
    "http://api.deepseek.com",
    "https://secret@api.deepseek.com",
    "https://api.deepseek.com?key=secret",
    "https://api.deepseek.com/chat/completions",
  ])
    assert.throws(
      () =>
        aiEnvironment({
          AI_PROVIDER: "deepseek",
          DEEPSEEK_API_KEY: "synthetic",
          DEEPSEEK_BASE_URL,
        }),
      /Invalid DEEPSEEK_BASE_URL/,
    );
  assert.throws(
    () =>
      aiEnvironment({
        AI_PROVIDER: "deepseek",
        DEEPSEEK_API_KEY: "synthetic",
        DEEPSEEK_MODEL_ID: " ",
      }),
    /must not be empty/,
  );
});

test("local .env overrides stale terminal config and resolves policy paths before changing directory", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "aic-startup-config-"),
  );
  const method = require(
    path.join(root, "apps/api/dist/financial/fhi-method.js"),
  );
  const { fhiMethodHash } = require(
    path.join(root, "apps/api/dist/financial/fhi-policy.js"),
  );
  fs.writeFileSync(
    path.join(directory, "policy.json"),
    JSON.stringify({
      policy_id: "synthetic-startup-test",
      method_id: method.FHI_METHOD_ID,
      method_version: method.FHI_METHOD_VERSION,
      method_hash: fhiMethodHash(),
      status: "validation_pending",
      industry_scope: method.FHI_PILOT_SCOPE,
      organization_ids: ["11111111-1111-4111-8111-111111111111"],
      approval: {
        by: "Synthetic test",
        recorded_at: "2026-01-01T00:00:00Z",
        source: "synthetic",
        scope: "test",
      },
      effective_from: "2026-01-01T00:00:00Z",
      effective_until: null,
    }),
  );
  fs.writeFileSync(
    path.join(directory, ".env"),
    [
      'AIC_FHI_POLICY_PATH="policy.json" # relative to repository root',
      'AIC_STORAGE_DIR="private cache"',
      "AIC_SESSION_TTL_MS=28800000",
      'INTERNAL_API_KEY="synthetic#quoted-value"',
    ].join("\n"),
  );
  const inherited = {
    ...process.env,
    DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unconnected_test",
    NODE_ENV: "development",
    AIC_RUNTIME_MODE: "foundation",
    AIC_DOCUMENT_RUNTIME: "local",
    AIC_DOCUMENT_AI_MODE: "live",
    AIC_FHI_POLICY_PATH: path.join(
      directory,
      "deleted-from-previous-session.json",
    ),
    AIC_SESSION_TTL_MS: "invalid",
  };
  const check = (env) =>
    spawnSync(
      process.execPath,
      [
        "-e",
        `
    try { require('./dist/config/configuration.js').loadConfig(); process.stdout.write('valid'); }
    catch(error) { process.stdout.write(error.code || 'invalid'); process.exitCode=1; }
  `,
      ],
      {
        env,
        cwd: path.join(root, "apps/api"),
        encoding: "utf8",
        windowsHide: true,
      },
    );
  const before = check(inherited);
  assert.equal(before.status, 1);
  assert.equal(before.stdout, "ENOENT");
  const { env, overridden } = localEnvironment(directory, inherited);
  assert.deepEqual(overridden, ["AIC_FHI_POLICY_PATH", "AIC_SESSION_TTL_MS"]);
  assert.equal(env.AIC_FHI_POLICY_PATH, path.join(directory, "policy.json"));
  assert.equal(env.AIC_STORAGE_DIR, path.join(directory, "private cache"));
  assert.equal(env.INTERNAL_API_KEY, "synthetic#quoted-value");
  const after = check(env);
  assert.equal(after.status, 0);
  assert.equal(after.stdout, "valid");
  assert.equal(inherited.AIC_SESSION_TTL_MS, "invalid");
  // Only synthetic, small files created in this test directory; no recursive removal.
  for (const file of ["policy.json", ".env"])
    fs.unlinkSync(path.join(directory, file));
  fs.rmdirSync(directory);
});

test("local .env handles Windows environment names without leaving conflicting case aliases", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aic-startup-case-"));
  fs.writeFileSync(path.join(directory, ".env"), "AIC_SESSION_TTL_MS=28800000");
  const { env } = localEnvironment(directory, {
    aic_session_ttl_ms: "stale",
    AIC_SESSION_TTL_MS: "invalid",
  });
  assert.deepEqual(env, { AIC_SESSION_TTL_MS: "28800000" });
  fs.unlinkSync(path.join(directory, ".env"));
  fs.rmdirSync(directory);
});

test("startup diagnostics identify configuration failures without exposing raw errors or credentials", () => {
  assert.match(
    startupFailure(
      { code: "ENOENT", message: "secret file contents" },
      "CONFIG",
    ),
    /CONFIG_FILE_MISSING/,
  );
  assert.match(
    startupFailure(
      new Error("Invalid AIC_SESSION_TTL_MS configuration"),
      "CONFIG",
    ),
    /INVALID_AIC_SESSION_TTL_MS/,
  );
  for (const error of [
    {
      code: "28P01",
      message:
        "postgresql://user:private-password@host/db SQL private-row-value",
    },
    { message: "private-password private-row-value" },
    new SyntaxError("private-password private-row-value"),
  ])
    assert.doesNotMatch(
      startupFailure(error, "CONFIG"),
      /private-password|private-row-value|postgresql:/,
    );
});

test("automatic dev preparation rejects production, remote and mismatched targets before connecting", () => {
  const local = "postgresql://owner:unused@127.0.0.1:5432/dev";
  assert.equal(validateTargets(local, local, local, {}).length, 3);
  for (const value of [
    "postgresql://owner:unused@db.example.com/dev",
    local + "?host=db.example.com",
    local + "?options=-c%20search_path=public",
  ])
    assert.throws(() => validateTargets(value, value, value, {}), /loopback/);
  assert.throws(
    () => validateTargets(local, local.replace("/dev", "/other"), local, {}),
    /same local/,
  );
  assert.throws(
    () => validateTargets(local, local, local, { NODE_ENV: "production" }),
    /production migrations/,
  );
});

test(
  "local startup backs up before migration, preserves data, grants bounded access and reruns without another backup",
  {
    skip:
      process.env.AIC_ALLOW_LOCAL_DB_TESTS !== "true" ||
      !process.env.AIC_TEST_DATABASE_URL,
  },
  async () => {
    // Only the private cluster created by scripts/test-local-postgres.cjs is accepted.
    const adminUrl = new URL(process.env.AIC_TEST_DATABASE_URL);
    assert.equal(adminUrl.hostname, "127.0.0.1");
    assert.equal(adminUrl.port, "15432");
    const admin = new Client({ connectionString: adminUrl.href });
    const suffix = randomBytes(6).toString("hex");
    const database = "dev_startup_" + suffix;
    const apiRole = "startup_api_" + suffix,
      workerRole = "startup_worker_" + suffix;
    await admin.connect();
    let client;
    try {
      await admin.query(`CREATE DATABASE ${database}`);
      await admin.query(
        `CREATE ROLE ${apiRole} NOLOGIN; CREATE ROLE ${workerRole} NOLOGIN`,
      );
      const url = new URL(adminUrl);
      url.pathname = "/" + database;
      client = new Client({ connectionString: url.href });
      await client.connect();
      await client.query(
        "CREATE SCHEMA aic; CREATE TABLE aic.schema_migrations(name text PRIMARY KEY,checksum char(64) NOT NULL,applied_at timestamptz DEFAULT now())",
      );
      const names = fs
        .readdirSync(path.join(root, "apps/api/migrations"))
        .filter((name) => /^\d{4}.*\.sql$/.test(name))
        .sort();
      assert.equal(names.at(-1), "0023_financial_reasoning.sql");
      for (const name of names.slice(0, -1)) {
        const { sql, checksum } = canonicalMigrationSource(
          fs.readFileSync(path.join(root, "apps/api/migrations", name), "utf8"),
        );
        await client.query(sql);
        await client.query(
          "INSERT INTO aic.schema_migrations(name,checksum) VALUES($1,$2)",
          [name, checksum],
        );
      }
      await client.query(
        "CREATE TABLE public.startup_preservation_marker(value text); INSERT INTO public.startup_preservation_marker VALUES('preserve-existing-local-data')",
      );
      const apiUrl = new URL(url);
      apiUrl.username = apiRole;
      const workerUrl = new URL(url);
      workerUrl.username = workerRole;
      const options = {
        root,
        ownerUrl: url.href,
        apiUrl: apiUrl.href,
        workerUrl: workerUrl.href,
        env: { ...process.env, NODE_ENV: "development" },
        log: () => {},
      };
      let migrated = false;
      await assert.rejects(
        prepareLocalDatabase({
          ...options,
          backup: async () => {
            throw new Error("simulated backup failure with sensitive details");
          },
          migrate: async () => {
            migrated = true;
          },
        }),
        { message: "Local database backup failed; no migration was started." },
      );
      assert.equal(migrated, false);
      assert.equal(
        (await client.query("SELECT count(*) FROM aic.schema_migrations"))
          .rows[0].count,
        "22",
      );

      const result = await prepareLocalDatabase(options);
      assert.deepEqual(result.pending, ["0023_financial_reasoning.sql"]);
      assert.ok(fs.statSync(result.backupPath).size > 0);
      const bin =
        process.env.AIC_POSTGRES_BIN || "C:/Program Files/PostgreSQL/18/bin";
      const contents = execFileSync(
        path.join(bin, "pg_restore.exe"),
        ["--list", result.backupPath],
        { encoding: "utf8", windowsHide: true },
      );
      assert.match(contents, /startup_preservation_marker/);
      assert.doesNotMatch(contents, /financial_reasoning_runs/);
      assert.equal(
        (
          await client.query(
            "SELECT value FROM public.startup_preservation_marker",
          )
        ).rows[0].value,
        "preserve-existing-local-data",
      );
      assert.equal(
        (await client.query("SELECT count(*) FROM aic.schema_migrations"))
          .rows[0].count,
        "23",
      );
      const rights = (
        await client.query(
          `SELECT
      has_table_privilege($1,'aic.financial_intakes','SELECT,INSERT,UPDATE') AS intake,
      has_table_privilege($1,'aic.financial_review_confirmations','SELECT,INSERT') AS review,
      has_table_privilege($1,'aic.financial_intakes','DELETE') AS removal,
      has_table_privilege($2,'aic.financial_intakes','INSERT') AS legacy_worker_intake`,
          [apiRole, workerRole],
        )
      ).rows[0];
      assert.deepEqual(rights, {
        intake: true,
        review: true,
        removal: false,
        legacy_worker_intake: false,
      });
      const rerun = await prepareLocalDatabase({
        ...options,
        backup: async () => {
          assert.fail("Current schema must not be backed up again");
        },
      });
      assert.deepEqual(rerun.pending, []);
      assert.equal(rerun.backupPath, undefined);
      await client.query(
        "UPDATE aic.schema_migrations SET checksum=repeat('0',64) WHERE name=$1",
        [names[0]],
      );
      await assert.rejects(
        prepareLocalDatabase(options),
        /Migration checksum mismatch: 0001_foundation.sql/,
      );
    } finally {
      await client?.end();
      await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
      await admin.query(`DROP ROLE ${apiRole}; DROP ROLE ${workerRole}`);
      await admin.end();
    }
  },
);
