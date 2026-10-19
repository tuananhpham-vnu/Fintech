// Run with scripts/test-local-postgres.cjs --test-concurrency=1.
// Real PostgreSQL (separate API/worker roles), real Nest HTTP + session/CSRF, real FastAPI chat route in
// explicit mock mode (no .env read, no model call). Synthetic gold extractions only.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const { fixture, project } = require("./acceptance-security/harness.cjs");
const { launcherEnv } = require("./acceptance-security/run-security-tests.cjs");
const { createApplication } = require("../dist/main");
const { loadConfig } = require("../dist/config/configuration");
const { hashPassword } = require("../dist/auth/password");
const { CaseMutations } = require("../dist/foundation/case-mutations");
const {
  PostgresDocumentRepository,
} = require("../dist/documents/postgres-document.repository");
const {
  DocumentDecisions,
} = require("../dist/documents/document-decisions.service");
const { AssistantService } = require("../dist/assistant/assistant.service");
const {
  createLegacyAiValidationBoundary,
} = require("../dist/ai-adapters/legacy-validation");
const { validateContract } = require("../dist/foundation/validation");

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const contractDir = path.join(project, "packages/contracts");
const manifest = fs.readFileSync(path.join(contractDir, "SHA256SUMS"), "utf8");
const boundary = createLegacyAiValidationBoundary({
  version: "1.0.2",
  sha256sums: manifest,
  files: Object.fromEntries(
    manifest
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(/\s+/)[1])
      .map((name) => [name, fs.readFileSync(path.join(contractDir, name))]),
  ),
});
const gold = JSON.parse(
  fs.readFileSync(
    path.join(contractDir, "fixtures/extraction-gold.json"),
    "utf8",
  ),
);

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test(
  "case assistant: ACL-scoped Q&A and search over real published extractions",
  { timeout: 180000 },
  async (t) => {
    const f = await fixture(t);
    const mutations = new CaseMutations(f.apiDb, f.config, f.core);
    const documents = new PostgresDocumentRepository(f.apiDb, f.config);
    const worker = new PostgresDocumentRepository(f.workerDb, f.config);
    const decisions = new DocumentDecisions(f.apiDb, documents, mutations);
    const revision = (caseId) => f.revision(caseId);

    async function publish(caseId, template, overrides = {}) {
      const bytes = Buffer.from(
        `%PDF-1.7\nSYNTHETIC ${template.detected_type} ${randomUUID()}\n%%EOF`,
      );
      const accepted = await documents.accept(f.session, caseId, randomUUID(), {
        mode: "new",
        type: template.detected_type,
        sourceClass: "synthetic",
        expectedRevision: await revision(caseId),
        displayName: template.detected_type + ".pdf",
        bytes,
        sha256: sha(bytes),
        pageCount: template.pages.length,
        aiMode: "mock",
      });
      const attempt = await worker.claim("assistant-test-worker", 60000, 3);
      assert.equal(attempt.documentId, accepted.body.document.id);
      const raw = JSON.parse(JSON.stringify(template));
      Object.assign(raw, {
        document_id: attempt.documentId,
        case_id: caseId,
        sha256: sha(bytes),
      });
      for (const item of [...raw.fields, ...raw.evidence])
        item.document_id = attempt.documentId;
      if (overrides.pageText) raw.pages[0].text = overrides.pageText;
      const validated = boundary.validate({
        operation: "extract",
        body: raw,
        headers: { "x-ai-mode": "mock" },
        expectedMode: "mock",
        request: {
          schema_version: "1.0.2",
          document_id: attempt.documentId,
          case_id: caseId,
          sha256: sha(bytes),
          type: template.detected_type,
          storage_key: "synthetic/input.pdf",
        },
      });
      assert.equal(await worker.publish(attempt, validated.body, "mock"), true);
      return attempt.documentId;
    }
    const financial = gold.find(
      (g) => g.detected_type === "financial_statement",
    );
    const contract = gold.find((g) => g.detected_type === "contract");
    const caseA = await f.newCase();
    const finId = await publish(caseA, financial);
    const contractId = await publish(caseA, contract);
    const caseB = await f.newCase();
    const secret = "THÔNG TIN RIÊNG CỦA CASE B - KHÔNG ĐƯỢC LỘ";
    const foreignId = await publish(caseB, contract, { pageText: secret });

    // Real FastAPI listener in explicit mock mode; Settings from an explicit env, so .env is never read.
    const aiPort = await freePort();
    const internalKey = randomBytes(32).toString("hex");
    const python = path.join(
      project,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
    const boot = [
      "import os, uvicorn",
      "from runner.app import create_app",
      "from runner.config import Settings",
      "env = {'AI_MODE': 'mock', 'INTERNAL_API_KEY': os.environ['AIC_TEST_INTERNAL_KEY']}",
      `uvicorn.run(create_app(Settings.from_env(env)), host='127.0.0.1', port=${aiPort}, log_level='warning')`,
    ].join("\n");
    const ai = spawn(python, ["-B", "-c", boot], {
      cwd: path.join(project, "services/ai"),
      env: { ...launcherEnv(process.env), AIC_TEST_INTERNAL_KEY: internalKey },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let aiError = "";
    ai.stderr.on("data", (chunk) => (aiError = (aiError + chunk).slice(-1500)));
    const aiClosed = new Promise((resolve) => ai.once("close", resolve));
    // Close Nest/FastAPI in finally (before the fixture's own after-hook drops the database).
    let app;
    const previous = {};
    try {
      let ready = false;
      for (let i = 0; i < 100 && !ready; i++) {
        try {
          ready = (
            await fetch(`http://127.0.0.1:${aiPort}/healthz`, {
              signal: AbortSignal.timeout(1000),
            })
          ).ok;
        } catch {}
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(ready, "FastAPI must start: " + aiError);

      const apiRole = (await f.apiDb.query("SELECT current_user AS name"))
        .rows[0].name;
      const storage = fs.realpathSync.native(
        fs.mkdtempSync(
          path.join(require("node:os").tmpdir(), "aic-assistant-"),
        ),
      );
      if (process.platform === 'win32') {
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference='Stop'; $me=[Security.Principal.WindowsIdentity]::GetCurrent().User;
$acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($me); $acl.SetAccessRuleProtection($true,$false);
foreach($sid in @($me.Value,'S-1-5-18','S-1-5-32-544')) {
  $identity=New-Object Security.Principal.SecurityIdentifier($sid);
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
}
[IO.Directory]::SetAccessControl($env:AIC_ASSISTANT_TEST_ROOT,$acl)
`], { env:{...process.env,AIC_ASSISTANT_TEST_ROOT:storage}, windowsHide:true,stdio:'pipe' });
      } else fs.chmodSync(storage, 0o700);
      const overrides = {
        NODE_ENV: "test",
        DATABASE_URL: f.runtimeUrl(apiRole),
        AIC_RUNTIME_MODE: "foundation",
        AIC_DOCUMENT_RUNTIME: "local",
        AIC_DOCUMENT_AI_MODE: "mock",
        AIC_STORAGE_DIR: storage,
        AIC_AI_SERVICE_URL: `http://127.0.0.1:${aiPort}`,
        INTERNAL_API_KEY: internalKey,
        AIC_FRONTEND_ORIGIN: "http://127.0.0.1:3000",
        AIC_COOKIE_NAME: "aic_assistant_http",
        AIC_IDEMPOTENCY_TTL_MS: "86400000",
        AIC_SESSION_TTL_MS: "3600000",
        AIC_SESSION_IDLE_MS: "3600000",
      };
      for (const key of Object.keys(overrides))
        previous[key] = process.env[key];
      Object.assign(process.env, overrides);
      const config = loadConfig();
      app = await createApplication(config, true);
      await app.listen(0, "127.0.0.1");
      const base = (await app.getUrl()) + "/api/v2";

      async function login(username, password) {
        const response = await fetch(base + "/auth/login", {
          method: "POST",
          headers: {
            origin: config.frontendOrigin,
            "content-type": "application/json",
          },
          body: JSON.stringify({ username, password }),
        });
        assert.equal(response.status, 200);
        return {
          cookie: response.headers.get("set-cookie").split(";")[0],
          csrf: (await response.json()).csrf_token,
        };
      }
      const password = "Synthetic-" + randomUUID();
      await f.owner.query("UPDATE aic.users SET password_hash=$2 WHERE id=$1", [
        f.user,
        await hashPassword(password),
      ]);
      const username = (
        await f.owner.query("SELECT username FROM aic.users WHERE id=$1", [
          f.user,
        ])
      ).rows[0].username;
      const member = await login(username, password);
      const ask = (who, caseId, body, headers = {}) =>
        fetch(`${base}/cases/${caseId}/assistant/messages`, {
          method: "POST",
          body: JSON.stringify(body),
          headers: {
            cookie: who.cookie,
            origin: config.frontendOrigin,
            "content-type": "application/json",
            "x-csrf-token": who.csrf,
            "idempotency-key": randomUUID(),
            ...headers,
          },
        });
      const search = (who, caseId, q) =>
        fetch(
          `${base}/cases/${caseId}/assistant/search?q=${encodeURIComponent(q)}`,
          { headers: { cookie: who.cookie } },
        );

      await t.test(
        "answer cites only documents of the requested case",
        async () => {
          const response = await ask(member, caseA, {
            question: "Tóm tắt tài chính và hợp đồng",
            history: [],
          });
          const body = await response.json();
          assert.equal(response.status, 200, JSON.stringify(body));
          validateContract("AssistantAnswer", body);
          assert.equal(body.mode, "mock");
          assert.equal(body.documents_considered, 2);
          assert.ok(
            body.citations.length >= 2 &&
              body.citations.every((c) => c.verified),
          );
          assert.deepEqual(
            new Set(body.citations.map((c) => c.document_id)),
            new Set([finId, contractId]),
          );
          assert.ok(
            !JSON.stringify(body).includes(foreignId) &&
              !body.answer.includes("RIÊNG CỦA CASE B"),
          );
          const metrics = Object.fromEntries(
            body.metrics.map((m) => [m.metric_id, m.value]),
          );
          assert.equal(metrics.debt_to_equity, "1.5");
          assert.equal(metrics.contract_total_vnd, "500000000");
        },
      );

      await t.test(
        "audit records the question without its content",
        async () => {
          const rows = (
            await f.owner.query(
              "SELECT actor_id,metadata_json FROM aic.audit_events WHERE case_id=$1 AND action='assistant.question'",
              [caseA],
            )
          ).rows;
          assert.equal(rows.length, 1);
          assert.equal(rows[0].actor_id, f.user);
          assert.equal(rows[0].metadata_json.documents, 2);
          assert.ok(!JSON.stringify(rows[0].metadata_json).includes("Tóm tắt"));
        },
      );

      await t.test(
        "reviewer correction is the value the assistant analyses",
        async () => {
          const doc = (await documents.list(f.session, caseA)).find(
            (d) => d.id === finId,
          );
          const field = doc.extraction.fields.find(
            (x) => x.field_key === "financial.liabilities",
          );
          await decisions.decide(f.session, finId, "correction", randomUUID(), {
            expected_revision: await revision(caseA),
            reason: "Synthetic reviewer correction",
            field_key: "legacy:1.0.2:financial.liabilities",
            value: "800",
            evidence_refs: field.evidence_ids,
          });
          const response = await ask(member, caseA, {
            question: "Tỷ lệ nợ trên vốn?",
            history: [],
          });
          const body = await response.json();
          assert.equal(response.status, 200, JSON.stringify(body));
          const metrics = Object.fromEntries(
            body.metrics.map((m) => [m.metric_id, m.value]),
          );
          assert.equal(metrics.debt_to_equity, "2"); // 800 / 400, not the model-extracted 600 / 400
          assert.equal(metrics.balance_gap, "-200000000"); // (1000 - (800 + 400)) * 1 000 000: inconsistency shown
        },
      );

      await t.test(
        "search is accent-insensitive and stays inside the case",
        async () => {
          const hits = await search(member, caseA, "tong tai san");
          const body = await hits.json();
          assert.equal(hits.status, 200, JSON.stringify(body));
          validateContract("AssistantSearchResult", body);
          assert.ok(
            body.hits.some((h) => h.document_id === finId && h.page === 1),
          );
          const hit = body.hits.find((h) => h.document_id === finId);
          assert.equal(
            hit.snippet
              .slice(hit.match_start, hit.match_start + hit.match_length)
              .toLowerCase(),
            "tổng tài sản",
          );
          const leak = await (
            await search(member, caseA, "RIÊNG CỦA CASE B")
          ).json();
          assert.deepEqual(leak.hits, []);
          assert.ok(
            (await (await search(member, caseB, "rieng cua case b")).json())
              .hits.length === 1,
          );
          assert.equal((await search(member, caseA, "x")).status, 422);
        },
      );

      await t.test(
        "non-members, missing CSRF and bad input are rejected",
        async () => {
          const outsider = randomUUID(),
            outsiderPassword = "Synthetic-" + randomUUID();
          await f.owner.query(
            `INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role)
      VALUES($1,$2,$3,$4,'Synthetic outsider','specialist')`,
            [
              outsider,
              f.org,
              "outsider_" + outsider.slice(0, 8),
              await hashPassword(outsiderPassword),
            ],
          );
          const other = await login(
            "outsider_" + outsider.slice(0, 8),
            outsiderPassword,
          );
          assert.equal(
            (await ask(other, caseA, { question: "Tóm tắt", history: [] }))
              .status,
            404,
          );
          assert.equal(
            (await search(other, caseA, "tong tai san")).status,
            404,
          );
          assert.equal(
            (
              await ask(
                member,
                caseA,
                { question: "Tóm tắt", history: [] },
                { "x-csrf-token": "" },
              )
            ).status,
            403,
          );
          assert.equal(
            (await ask(member, caseA, { question: "", history: [] })).status,
            422,
          );
          assert.equal(
            (await ask(member, caseA, { question: "x", history: [], extra: 1 }))
              .status,
            422,
          );
        },
      );

      await t.test(
        "AI failures map to explicit errors, never a fabricated answer",
        async () => {
          let reply = {
            status: 200,
            mode: "mock",
            body: '{"not":"a chat output"}',
          };
          const fake = http.createServer((req, res) => {
            req.resume();
            req.on("end", () => {
              res.writeHead(reply.status, {
                "content-type": "application/json",
                "x-ai-mode": reply.mode,
              });
              res.end(reply.body);
            });
          });
          await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
          try {
            const service = new AssistantService(
              f.apiDb,
              documents,
              decisions,
              {
                ...config,
                aiServiceUrl: `http://127.0.0.1:${fake.address().port}`,
              },
            );
            const code = async (expected) =>
              assert.rejects(
                service.ask(f.session, caseA, {
                  question: "Tóm tắt",
                  history: [],
                }),
                (e) => e.getResponse?.().code === expected,
              );
            await code("INVALID_AI_RESPONSE");
            reply = {
              status: 503,
              mode: "mock",
              body: '{"error":{"code":"PROVIDER_UNAVAILABLE"}}',
            };
            await code("AI_UNAVAILABLE");
            reply = {
              status: 422,
              mode: "mock",
              body: '{"error":{"code":"INVALID_MODEL_OUTPUT"}}',
            };
            await code("AI_ANSWER_REJECTED");
            const ok = await (
              await fetch(`http://127.0.0.1:${aiPort}/internal/v1/chat`, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-internal-key": internalKey,
                },
                body: JSON.stringify({
                  schema_version: "aic-chat-0.1",
                  case_id: caseA,
                  question: "q",
                  history: [],
                  documents: [],
                  findings: [],
                }),
              })
            ).text();
            reply = { status: 200, mode: "live", body: ok };
            await code("AI_MODE_MISMATCH");
          } finally {
            await new Promise((resolve) => fake.close(resolve));
          }
        },
      );
    } finally {
      if (app) await app.close();
      for (const [key, value] of Object.entries(previous))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      ai.kill();
      await aiClosed;
    }
  },
);
