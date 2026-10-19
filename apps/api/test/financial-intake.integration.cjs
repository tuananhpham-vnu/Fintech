// Private PostgreSQL database and an explicit synthetic AI transport double.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  http = require("node:http");
const { Client } = require("pg"),
  { migrate } = require("../dist/database/migrate"),
  { DatabaseService } = require("../dist/database/database.service");
const { SessionService, hashPassword } = require("../dist/auth"),
  { CoreRepository } = require("../dist/foundation/core.repository");
const { CaseMutations } = require("../dist/foundation/case-mutations"),
  { MvpCaseService } = require("../dist/foundation/mvp-case.service");
const {
    MvpCounterpartyService,
  } = require("../dist/foundation/mvp-counterparty.service"),
  { MvpWorkflowService } = require("../dist/foundation/mvp-workflow.service");
const {
    FinancialRegistry,
  } = require("../dist/financial/financial-registry.service"),
  {
    FinancialIntakeService,
  } = require("../dist/financial/financial-intake.service");
const {
    FinancialReviewService,
  } = require("../dist/financial/financial-review.service"),
  { AssessmentService } = require("../dist/financial/assessment.service");
const { sha } = require("../dist/financial/financial-import-source"),
  { fhiMethodHash } = require("../dist/financial/fhi-policy");
const uuid = () => crypto.randomUUID(),
  reject = (p, code) =>
    assert.rejects(p, (e) => e.getResponse?.().code === code);

test("company BCTC: automatic periods, common review, current method, duplicate replacement and stale confirmation", async (t) => {
  assert.equal(process.env.AIC_ALLOW_LOCAL_DB_TESTS, "true");
  const url = new URL(process.env.AIC_TEST_DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  const name = "aic_intake_" + crypto.randomBytes(6).toString("hex"),
    admin = new Client({ connectionString: url.href });
  await admin.connect();
  let owner, db, server, app;
  try {
    await admin.query("CREATE DATABASE " + name);
    url.pathname = "/" + name;
    await migrate(url.href);
    owner = new Client({ connectionString: url.href });
    await owner.connect();
    const values = {
      current_assets: "50",
      current_liabilities: "25",
      cash: "10",
      unrestricted_short_term_equivalents: "5",
      trade_receivables: "25",
      total_equity: "40",
      total_assets: "100",
      total_liabilities: "60",
      interest_bearing_debt: "20",
      operating_profit: "15",
      depreciation_amortization: "5",
      interest_expense: "3",
      net_revenue: "100",
      cash_from_operations: "20",
    };
    let calculationMode = false;
    let fixtureCountry = 'VN';
    let discoveryYears = [2024, 2025];
    let interimPeriod = null;
    let reasoningMode = false, reasoningConflict = false;
    let failProvider = false,
      calls = 0,
      omitKey = false, missingStart = false, emptyFacts = false, failedYear = null, documentType = 'financial_statement',
      discoveryFailure = null, periodIssues = [];
    server = http.createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      calls++;
      assert.equal(req.headers["x-internal-key"], "SYNTHETIC-only");
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-AI-Mode", "live");
      if (failProvider) {
        res.statusCode = 503;
        return res.end(
          JSON.stringify({ error: { code: "PROVIDER_UNAVAILABLE" } }),
        );
      }
      const bytes = Buffer.from(
        input.data_base64 ?? input.pdf_base64,
        "base64",
      );
      assert.equal(sha(bytes), input.sha256);
      if (req.url.endsWith("financial-prepare"))
        return res.end(
          JSON.stringify({
            contract_version: "AIC-FINANCIAL-INTAKE-1",
            original_sha256: input.sha256,
            sha256: input.sha256,
            content_type: "application/pdf",
            pdf_base64: input.data_base64,
            page_count: 1,
            locations: [],
            warnings: [],
          }),
        );
      if (req.url.endsWith('financial-discovery') && discoveryFailure) {
        res.statusCode = 422;
        return res.end(JSON.stringify({error:{code:discoveryFailure,request_id:uuid(),details:[
          {path:'/ocr/4',message:'MODEL_OUTPUT_BLOCKED'},
          {path:'/private',message:'PRIVATE MODEL TEXT MUST NOT BE STORED'},
        ]}}));
      }
      if (req.url.endsWith("financial-discovery"))
        return res.end(
          JSON.stringify({
            contract_version: "AIC-FINANCIAL-INTAKE-1",
            sha256: input.sha256,
            page_count: 1,
            document_type: documentType,
            period_issues: periodIssues,
            entity_name: "SYNTHETIC company",
            tax_id: null,
            periods: discoveryYears.map((y) => ({
              kind: interimPeriod ? 'INTERIM' : "FY",
              start_date: missingStart ? null : y + (interimPeriod?.start ?? "-01-01"),
              end_date: y + (interimPeriod?.end ?? "-12-31"),
              basis: "consolidated",
              pages: [1],
              evidence: [{ page: 1, quote: 'SYNTHETIC ' + (y === Math.max(...discoveryYears) ? 'current year ' : 'previous year ') + y },
                {page:1,quote:'Năm nay | Năm trước'}],
            })),
            warnings: periodIssues.filter(i=>i.severity==='blocking').map(i=>'PERIOD_REVIEW_REQUIRED:'+i.end_date+':'+i.code),
            provenance: {
              model_id: "SYNTHETIC-DOUBLE",
              prompt_version: "test",
            },
          }),
        );
      const end = input.requested_scope.end_date,
        scope = {
          entity_name: "SYNTHETIC company",
          country: fixtureCountry,
          period_kind: interimPeriod ? 'INTERIM' : "FY",
          start_date: end.slice(0, 4) + (interimPeriod?.start ?? "-01-01"),
          end_date: end,
          basis: "consolidated",
          accounting_regime: fixtureCountry==='US' ? 'US_GAAP' : fixtureCountry==='CN' ? 'CN_ASBE' : 'VN_TT200',
          currency: fixtureCountry==='US' ? 'USD' : fixtureCountry==='CN' ? 'CNY' : 'VND',
          unit_multiplier: "1",
        };
      if (end.startsWith(String(failedYear))) { res.statusCode=503; return res.end(JSON.stringify({error:{code:'PROVIDER_UNAVAILABLE'}})); }
      res.end(
        JSON.stringify({
          contract_version: "AIC-FINANCIAL-IMPORT-1",
          sha256: input.sha256,
          page_count: 1,
          suggested_pages: [1],
          document_type: "financial_statement",
          scope,
          scope_evidence: [{ page: 1, quote: "SYNTHETIC " + end }],
          selected_pages: [1],
          facts: Object.entries(emptyFacts ? {} : values)
            .filter(
              ([key]) =>
                (!omitKey || key !== "unrestricted_short_term_equivalents") && (!(calculationMode || reasoningMode) || key !== 'current_liabilities'),
            )
            .map(([key, value]) => ({
              key,
              value,
              raw_token: value,
              label: key,
              page: 1,
              quote: key + " " + value,
              period_end: end,
              basis: "consolidated",
              method: "native",
              verification: "unverified",
            })),
          missing_keys: emptyFacts ? Object.keys(values) : omitKey ? ["unrestricted_short_term_equivalents"] : [],
          calculations: calculationMode ? [{id:'current_debt',key:'current_liabilities',reason:'SYNTHETIC complete liability breakdown',assumptions:[],
            expression:['total','long_term','-'],inputs:[['total','60'],['long_term','35']].map(([id,value])=>({id,value,label:id,raw_token:value,
              page:1,quote:id+' '+value,period_start:scope.start_date,period_end:end,basis:scope.basis,currency:scope.currency,
              unit_multiplier:scope.unit_multiplier,dimension:'money'}))}] : [],
          ...(reasoningMode ? {reasoning:require('./helpers/reasoning-fixture.cjs')({...scope,end_date:end},values,reasoningConflict && end==='2025-12-31')} : {}),
          rejected: [],
          warnings: ["HUMAN_SOURCE_REVIEW_REQUIRED"],
          ocr_failures: [],
          provenance: {
            model_id: "SYNTHETIC-DOUBLE",
            prompt_version: "financial-import-v1",
            ocr_version: "none",
          },
        }),
      );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const config = {
      databaseUrl: url.href,
      isProduction: false,
      frontendOrigin: "http://127.0.0.1",
      allowedOrigins: ["http://127.0.0.1"],
      cookieName: "synthetic_intake",
      secureCookies: false,
      sessionTtlMs: 3600000,
      sessionIdleMs: 3600000,
      loginMaxAttempts: 5,
      loginWindowMs: 900000,
      loginBlockMs: 900000,
      idempotencyTtlMs: 86400000,
      documentAiMode: "live",
      internalApiKey: "SYNTHETIC-only",
      aiServiceUrl: "http://127.0.0.1:" + server.address().port,
    };
    db = new DatabaseService(config);
    await db.onModuleInit();
    const core = new CoreRepository(db),
      mutations = new CaseMutations(db, config, core),
      auth = new SessionService(db, config),
      cp = new MvpCounterpartyService(db, config);
    const cases = new MvpCaseService(db, config, core, mutations),
      registry = new FinancialRegistry(db, config, core, mutations),
      intake = new FinancialIntakeService(db, config, core, mutations);
    const review = new FinancialReviewService(mutations, registry),
      workflows = new MvpWorkflowService(db, config, core, mutations),
      assessment = new AssessmentService(
        db,
        config,
        core,
        mutations,
        registry,
        workflows,
      );
    const password =
        process.env.AIC_INTAKE_UI_CHECK === "true"
          ? "SyntheticOnly-2026!"
          : "SYNTHETIC-" + uuid(),
      encoded = await hashPassword(password);
    async function tenant(username = uuid()) {
      const org = uuid(),
        id = uuid();
      await owner.query(
        "INSERT INTO aic.organizations(id,name) VALUES($1,'SYNTHETIC intake test')",
        [org],
      );
      await owner.query(
        "INSERT INTO aic.users(id,organization_id,username,password_hash,display_name,role) VALUES($1,$2,$3,$4,'SYNTHETIC','specialist')",
        [id, org, username, encoded],
      );
      return auth.resolve(
        (await auth.login(username, password, "127.0.0.1")).token,
      );
    }
    const alice = await tenant(
        process.env.AIC_INTAKE_UI_CHECK === "true"
          ? "synthetic-intake-ui"
          : uuid(),
      ),
      bob = await tenant();
    config.fhiPolicy = {
      policy_id: "SYNTHETIC-policy",
      method_id: "AIC-FHI-1.0",
      method_version: "1.0.0",
      method_hash: fhiMethodHash(),
      status: "configured_pilot",
      industry_scope: "DISTRIBUTION_WHOLESALE_PILOT",
      organization_ids: [alice.user.organization_id],
      approval: {
        by: "SYNTHETIC",
        recorded_at: "2020-01-01T00:00:00Z",
        source: "test only",
        scope: "test only",
      },
      effective_from: "2020-01-01T00:00:00Z",
      effective_until: null,
    };
    // New forms require neither declaration text nor a reason.
    const company = (
      await cp.create(alice, uuid(), {
        name: "SYNTHETIC company",
        country: "VN",
        tax_id: null,
        industry_code: "DISTRIBUTION_WHOLESALE_PILOT",
      })
    ).body;
    const current = (
      await cases.createCompany(alice, uuid(), {
        schema_version: "AIC-COMPANY-HEALTH-1",
        counterparty_id: company.id,
      })
    ).body;
    let page = await intake.list(alice, current.id);
    const file = {
        originalname: "BCTC.pdf",
        buffer:
          process.env.AIC_INTAKE_UI_CHECK === "true"
            ? require("node:fs").readFileSync(process.env.AIC_UI_PDF)
            : Buffer.from("%PDF-SYNTHETIC BCTC transport fixture"),
      },
      key = uuid();
    const queued = (
      await intake.upload(alice, current.id, key, file, page.revision)
    ).body;
    assert.equal(queued.item.state, "queued");
    assert.equal(calls, 0);
    assert.deepEqual(
      (await intake.upload(alice, current.id, key, file, 1)).body,
      queued,
    );
    await reject(intake.list(bob, current.id), "NOT_FOUND");
    await reject(intake.original(bob, queued.item.id), "NOT_FOUND");
    const processed = await intake.once("SYNTHETIC-worker");
    assert.equal(
      processed,
      "processed",
      JSON.stringify(await intake.list(alice, current.id)),
    );
    page = await intake.list(alice, current.id);
    assert.equal(page.items[0].state, "ready");
    assert.equal(page.items[0].statements.length, 2);
    if (process.env.AIC_INTAKE_UI_CHECK === "true") {
      const { createApplication } = require("../dist/main");
      const { mkdtempSync, existsSync } = require("node:fs"),
        path = require("node:path"),
        os = require("node:os");
      const storageDir = mkdtempSync(path.join(os.tmpdir(), "aic-ui-storage-"));
      if (process.platform === "win32")
        require("node:child_process").execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `
        $ErrorActionPreference='Stop'; $me=[Security.Principal.WindowsIdentity]::GetCurrent().User;
        $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($me); $acl.SetAccessRuleProtection($true,$false);
        foreach($sid in @($me.Value,'S-1-5-18','S-1-5-32-544')) { $identity=New-Object Security.Principal.SecurityIdentifier($sid); $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))) };
        [IO.Directory]::SetAccessControl($env:AIC_UI_STORAGE_ROOT,$acl)
      `,
          ],
          {
            env: { ...process.env, AIC_UI_STORAGE_ROOT: storageDir },
            windowsHide: true,
            stdio: "pipe",
            timeout: 15000,
          },
        );
      else require("node:fs").chmodSync(storageDir, 0o700);
      Object.assign(config, {
        runtimeMode: "foundation",
        documentRuntime: "local",
        nodeEnv: "test",
        port: 3001,
        storageDir,
        frontendOrigin: "http://127.0.0.1:3000",
        allowedOrigins: ["http://127.0.0.1:3000"],
      });
      app = await createApplication(config, true);
      await app.listen(3001, "127.0.0.1");
      console.log(
        "SYNTHETIC UI CHECK ready: http://127.0.0.1:3000/cases/" + current.id,
      );
      console.log(
        "SYNTHETIC sign-in: synthetic-intake-ui / SyntheticOnly-2026!",
      );
      await new Promise((resolve) => {
        const timer = setInterval(async () => {
          if (existsSync(process.env.AIC_UI_STOP_FILE)) {
            clearInterval(timer);
            resolve();
          } else await intake.once("SYNTHETIC-UI-worker");
        }, 1000);
      });
      return;
    }
    let data = await registry.get(alice, current.id);
    assert.equal(
      data.sets.find((s) => s.id === data.selected_set_id).scope.period
        .end_date,
      "2025-12-31",
    );
    assert.ok(
      data.sets.every((s) =>
        s.facts.every((f) => f.verification.status === "unverified"),
      ),
    );
    assert.equal(
      (await assessment.workspace(alice, current.id)).readiness
        .assessment_allowed,
      false,
    );
    await assert.rejects(
      assessment.run(alice, current.id, uuid(), {
        expected_revision: page.revision,
      }),
      (e) => e.getResponse?.().code === "ASSESSMENT_NOT_READY",
    );
    const bridges = {
      quick_assets_non_overlapping: true,
      quick_assets_eligible: true,
      da_addback_to_operating_profit: true,
    };
    await reject(
      review.confirm(alice, current.id, uuid(), {
        expected_revision: page.revision,
        confirmed: true,
        source_snapshot_hash: "0".repeat(64),
        bridge_assertions: bridges,
      }),
      "FINANCIAL_REVIEW_CHANGED",
    );
    const confirmed = (
      await review.confirm(alice, current.id, uuid(), {
        expected_revision: page.revision,
        confirmed: true,
        source_snapshot_hash: page.review.source_snapshot_hash,
        bridge_assertions: bridges,
      })
    ).body;
    assert.equal(confirmed.verified_fact_count, 28);
    assert.equal(confirmed.review.confirmed, true);
    data = await registry.get(alice, current.id);
    assert.ok(
      data.sets.every((s) =>
        s.facts.every((f) => f.verification.status === "verified"),
      ),
    );
    const readiness = (await assessment.workspace(alice, current.id)).readiness;
    assert.equal(
      readiness.numeric_assessment_allowed,
      true,
      JSON.stringify(readiness.blockers),
    );
    const scored = (
      await assessment.run(alice, current.id, uuid(), {
        expected_revision: confirmed.revision,
      })
    ).body;
    assert.ok(scored.financial_health.score !== null);
    assert.equal(scored.financial_health.partial_assessment, undefined);
    assert.equal(scored.financial_health.components.length, 7);
    assert.equal(scored.method_version, "AIC-FHI-1.0/1.0.0/mean_metric_points_v1");
    assert.equal(scored.financial_set_id, null);
    assert.equal(scored.case_aggregation.included_set_ids.length, 2);
    assert.equal((await registry.trends(alice, current.id)).rows.length, 2);
    const set = data.sets.find((s) => s.id === data.selected_set_id);
    const correction = {
      expected_revision: scored.case_revision,
      reason: "SYNTHETIC correction from original statement",
      period: set.scope.period,
      basis: set.scope.basis,
      accounting_regime: set.scope.accounting_regime,
      currency: set.scope.currency,
      unit_multiplier: set.scope.unit_multiplier,
      industry_scope: set.scope.pilot_scope,
      ...set.metadata,
      facts: set.facts.map((f) => ({
        key: f.key,
        raw_value: f.key === "current_assets" ? "55" : f.raw_value,
        raw_label: f.raw_label,
        missing_reason: null,
        source:
          f.key === "current_assets"
            ? {
                ...f.source,
                human_correction: { reason: "SYNTHETIC reviewed original" },
              }
            : f.source,
      })),
    };
    const corrected = (
      await registry.save(alice, current.id, set.id, uuid(), correction)
    ).body;
    assert.equal(
      corrected.set.facts.find((f) => f.key === "current_assets").raw_value,
      "55",
    );
    assert.ok(
      corrected.set.facts.every((f) => f.verification.status === "unverified"),
    );
    assert.equal(
      (await intake.list(alice, current.id)).review.confirmed,
      false,
    );
    const historical = await assessment.get(alice, scored.id);
    assert.equal(historical.stale, true);
    assert.equal(
      historical.financial_health.score,
      scored.financial_health.score,
    );
    await reject(assessment.get(bob, scored.id), "NOT_FOUND");
    page = await intake.list(alice, current.id);
    const duplicate = (
      await intake.upload(alice, current.id, uuid(), file, page.revision)
    ).body;
    assert.equal(duplicate.item.state, "duplicate");
    page = await intake.list(alice, current.id);
    assert.equal(page.review.confirmed, false);
    assert.equal(page.review.stale, true);
    await reject(
      review.confirm(alice, current.id, uuid(), {
        expected_revision: page.revision,
        confirmed: true,
        source_snapshot_hash: page.review.source_snapshot_hash,
        bridge_assertions: bridges,
      }),
      "SOURCE_PROCESSING_OR_DUPLICATE",
    );
    await intake.decide(alice, current.id, duplicate.item.id, uuid(), {
      expected_revision: page.revision,
      action: "keep_existing",
    });
    page = await intake.list(alice, current.id);
    const newer = (
      await intake.upload(
        alice,
        current.id,
        uuid(),
        { ...file, buffer: Buffer.from("%PDF-SYNTHETIC changed BCTC") },
        page.revision,
      )
    ).body;
    values.net_revenue = '101';
    assert.equal(await intake.once("SYNTHETIC-worker"), "processed");
    values.net_revenue = '100';
    page = await intake.list(alice, current.id);
    const pendingPeriods=page.items.find(i=>i.id===newer.item.id).origin.period_candidates;
    assert.equal(pendingPeriods.length,2);
    for(const candidate of pendingPeriods) {
      page=await intake.list(alice,current.id);
      const target=(await registry.get(alice,current.id)).sets.find(s=>s.id===candidate.existing_sets[0].set_id);
      await intake.decide(alice,current.id,newer.item.id,uuid(),{expected_revision:page.revision,
        action:'select_period_source',receipt_id:candidate.receipt_id,set_id:target.id,expected_set_revision:target.revision});
    }
    page = await intake.list(alice, current.id);
    assert.equal(
      page.items.find((i) => i.id === queued.item.id).superseded_by,
      null,
    );
    assert.equal(
      (await registry.get(alice, current.id)).sets.length,
      2,
      "Period source selection adds versions, not extra active periods",
    );
    data = await registry.get(alice, current.id);
    assert.ok(data.sets.every((s) => s.revision >= 2));
    await t.test(
      "Missing AI inputs can be entered from an explicit BCTC page, then reviewed together",
      async () => {
        omitKey = true;
        const second = (
          await cases.createCompany(alice, uuid(), {
            schema_version: "AIC-COMPANY-HEALTH-1",
            counterparty_id: company.id,
          })
        ).body;
        await intake.upload(alice, second.id, uuid(), file, second.revision);
        assert.equal(await intake.once("SYNTHETIC-worker"), "processed");
        const missing = await registry.get(alice, second.id),
          latest = missing.sets.find((s) => s.id === missing.selected_set_id);
        assert.equal(latest.facts.length, 13);
        const source = latest.facts[0].source;
        const input = {
          expected_revision: (await intake.list(alice, second.id)).revision,
          reason: "SYNTHETIC human addition from BCTC",
          period: latest.scope.period,
          basis: latest.scope.basis,
          accounting_regime: latest.scope.accounting_regime,
          currency: latest.scope.currency,
          unit_multiplier: latest.scope.unit_multiplier,
          industry_scope: latest.scope.pilot_scope,
          ...latest.metadata,
          facts: [
            ...latest.facts.map((f) => ({
              key: f.key,
              raw_value: f.raw_value,
              raw_label: f.raw_label,
              missing_reason: null,
              source: f.source,
            })),
            {
              key: "unrestricted_short_term_equivalents",
              raw_value: "0",
              raw_label: "Unrestricted equivalents",
              missing_reason: null,
              source: {
                kind: "statement_entry",
                receipt_id: source.receipt_id,
                fact_key: "unrestricted_short_term_equivalents",
                source_kind: source.source_kind,
                source_id: source.source_id,
                source_hash: source.source_hash,
                page: 1,
                quote: "Unrestricted equivalents 0",
                reason: "SYNTHETIC read original",
              },
            },
          ],
        };
        const forged = structuredClone(input);
        forged.facts.at(-1).source.source_hash = "0".repeat(64);
        await reject(
          registry.save(alice, second.id, latest.id, uuid(), forged),
          "INVALID_FINANCIAL_SOURCE",
        );
        const saved = (
          await registry.save(alice, second.id, latest.id, uuid(), input)
        ).body;
        assert.equal(
          saved.set.facts.find(
            (f) => f.key === "unrestricted_short_term_equivalents",
          ).normalized_decimal,
          "0",
        );
        assert.equal(saved.set.facts.at(-1).verification.status, "unverified");
        const p = await intake.list(alice, second.id);
        await review.confirm(alice, second.id, uuid(), {
          expected_revision: p.revision,
          confirmed: true,
          source_snapshot_hash: p.review.source_snapshot_hash,
          bridge_assertions: bridges,
        });
        assert.equal(
          (await assessment.workspace(alice, second.id)).readiness
            .numeric_assessment_allowed,
          true,
        );
        omitKey = false;
      },
    );
    await t.test('Missing discovery start does not discard financial extraction; empty candidates have a human recovery', async () => {
      const company = (await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:current.counterparty_id})).body;
      missingStart=true; emptyFacts=true;
      await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC unresolved period')},company.revision);
      assert.equal(await intake.once('SYNTHETIC-recovery'),'processed');
      let p=await intake.list(alice,company.id);
      assert.equal(p.items[0].classification.periods[0].start_date,'2024-01-01');
      const existing=await registry.get(alice,company.id), set=existing.sets.find(s=>s.id===existing.selected_set_id);
      assert.equal(set.facts.length,0); assert.equal(existing.sets.length,2);
      const receiptId=uuid(), item=p.items[0];
      const input={expected_revision:p.revision,reason:'SYNTHETIC read the original statement',period:set.scope.period,basis:set.scope.basis,
        accounting_regime:set.scope.accounting_regime,currency:set.scope.currency,unit_multiplier:set.scope.unit_multiplier,industry_scope:set.scope.pilot_scope,...set.metadata,
        intake_review:{intake_id:item.id,receipt_id:receiptId,page:1,quote:'SYNTHETIC financial year 2025'},
        facts:[{key:'net_revenue',raw_value:'0',raw_label:'Net revenue',missing_reason:null,source:{kind:'statement_entry',receipt_id:receiptId,
          fact_key:'net_revenue',source_kind:'financial_file',source_id:item.prepared_source_id,source_hash:item.classification.sha256,page:1,quote:'Net revenue 0',reason:'SYNTHETIC source review'}}]};
      const forged=structuredClone(input);forged.industry_scope='MANUFACTURING';
      await reject(registry.save(alice,company.id,set.id,uuid(),forged),'FINANCIAL_INDUSTRY_SCOPE_MISMATCH');
      const saved=(await registry.save(alice,company.id,set.id,uuid(),input)).body;
      assert.equal(saved.set.facts[0].normalized_decimal,'0');assert.equal(saved.set.facts[0].verification.status,'unverified');
      missingStart=false;emptyFacts=false;
    });
    await t.test('A failed retry keeps the same file linked to its previously extracted periods',async()=>{
      const company=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:current.counterparty_id})).body;
      omitKey=true;
      await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC retry retains links')},company.revision);
      await intake.once('SYNTHETIC-retained-retry');
      let p=await intake.list(alice,company.id), item=p.items[0];
      const previous=structuredClone(item.statements), before=await registry.get(alice,company.id);
      failedYear='2025';
      await intake.decide(alice,company.id,item.id,uuid(),{expected_revision:p.revision,action:'retry'});
      await intake.once('SYNTHETIC-retained-retry');
      failedYear=null;omitKey=false;
      p=await intake.list(alice,company.id);item=p.items[0];
      assert.equal(item.error_code,'FINANCIAL_REPLACEMENT_INCOMPLETE');
      assert.deepEqual(item.statements,previous);
      assert.deepEqual((await registry.get(alice,company.id)).sets.map(s=>[s.id,s.revision]),before.sets.map(s=>[s.id,s.revision]));
    });
    await t.test('identical comparative figures retain both files and all years without a source decision',async()=>{
      const company=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:current.counterparty_id})).body;
      discoveryYears=[2023,2024];
      try {
        await intake.upload(alice,company.id,uuid(),{...file,originalname:'SYNTHETIC_2024.pdf',buffer:Buffer.from('%PDF-SYNTHETIC identical original')},company.revision);
        await intake.once('SYNTHETIC-identical');
      } finally { discoveryYears=[2024,2025]; }
      let p=await intake.list(alice,company.id);
      const before=(await registry.get(alice,company.id)).sets;
      const incoming=(await intake.upload(alice,company.id,uuid(),{...file,originalname:'SYNTHETIC_2025.pdf',buffer:Buffer.from('%PDF-SYNTHETIC identical comparative')},p.revision)).body.item;
      await intake.once('SYNTHETIC-identical');
      p=await intake.list(alice,company.id);
      const item=p.items.find(i=>i.id===incoming.id);
      assert.equal(item.state,'ready');assert.equal(item.error_code,null);
      assert.equal(item.origin.period_candidates.length,1);
      assert.equal(item.origin.period_candidates[0].status,'kept');
      assert.equal(item.origin.period_candidates[0].role,'comparative');
      assert.equal(item.origin.period_candidates[0].existing_sets[0].role,'current');
      assert.equal(p.review.unresolved_count,0);
      assert.equal(p.items.length,2);
      const data=await registry.get(alice,company.id);
      assert.equal(data.sets.length,3);
      for (const original of before) assert.deepEqual(data.sets.find(s=>s.id===original.id),original);
      // An upload containing only already-known periods also completes without empty new statements.
      const third=(await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC all identical periods')},p.revision)).body.item;
      await intake.once('SYNTHETIC-identical');
      p=await intake.list(alice,company.id);
      assert.equal(p.items.find(i=>i.id===third.id).state,'ready');
      assert.equal(p.items.find(i=>i.id===third.id).statements.length,0);
      assert.deepEqual((await registry.get(alice,company.id)).sets,data.sets);
    });
    await t.test('overlapping sources reconcile only selected periods, preserve other years and support legacy recovery',async()=>{
      const company=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:current.counterparty_id})).body;
      const original=(await intake.upload(alice,company.id,uuid(),{...file,originalname:'SYNTHETIC_2025.pdf',buffer:Buffer.from('%PDF-SYNTHETIC current 2025 and comparative 2024')},company.revision)).body.item;
      await intake.once('SYNTHETIC-period-choice');
      let p=await intake.list(alice,company.id),before=await registry.get(alice,company.id);
      const old2025=before.sets.find(s=>s.scope.period.end_date==='2025-12-31'),old2024=before.sets.find(s=>s.scope.period.end_date==='2024-12-31');
      discoveryYears=[2023,2024];
      values.net_revenue='102';
      let uploaded;
      try {
        uploaded=(await intake.upload(alice,company.id,uuid(),{...file,originalname:'SYNTHETIC_2024.pdf',buffer:Buffer.from('%PDF-SYNTHETIC original 2024 and comparative 2023')},p.revision)).body.item;
        assert.equal(await intake.once('SYNTHETIC-period-choice'),'processed');
      } finally { discoveryYears=[2024,2025]; values.net_revenue='100'; }
      p=await intake.list(alice,company.id);
      let item=p.items.find(i=>i.id===uploaded.id),candidate=item.origin.period_candidates[0];
      assert.equal(item.state,'needs_review');assert.equal(item.duplicate_of,null);
      assert.equal(item.error_code,'FINANCIAL_PERIOD_SOURCE_SELECTION_REQUIRED');
      assert.equal(candidate.period.end_date,'2024-12-31');assert.equal(candidate.role,'current');
      assert.equal(candidate.existing_sets[0].role,'comparative');
      assert.deepEqual(candidate.existing_sets[0].source_names,['SYNTHETIC_2025.pdf']);
      assert.equal(candidate.facts.length,14);assert.equal(item.statements.length,1);
      let data=await registry.get(alice,company.id);
      assert.equal(data.sets.length,3);assert.deepEqual(data.sets.find(s=>s.id===old2025.id),old2025);
      assert.deepEqual(data.sets.find(s=>s.id===old2024.id),old2024);
      await reject(review.confirm(alice,company.id,uuid(),{expected_revision:p.revision,confirmed:true,
        source_snapshot_hash:p.review.source_snapshot_hash,bridge_assertions:bridges}),'FINANCIAL_PERIOD_REVIEW_REQUIRED');
      const command={expected_revision:p.revision,action:'select_period_source',receipt_id:candidate.receipt_id,
        set_id:old2024.id,expected_set_revision:old2024.revision};
      await reject(intake.decide(bob,company.id,item.id,uuid(),command),'NOT_FOUND');
      await reject(intake.decide(alice,company.id,item.id,uuid(),{...command,set_id:old2025.id}),'INTAKE_DECISION_UNAVAILABLE');
      await reject(intake.decide(alice,company.id,item.id,uuid(),{...command,expected_set_revision:old2024.revision+1}),'FINANCIAL_PERIOD_SOURCE_CHANGED');
      await intake.decide(alice,company.id,item.id,uuid(),command);
      data=await registry.get(alice,company.id);
      assert.equal(data.sets.length,3);assert.deepEqual(data.sets.find(s=>s.id===old2025.id),old2025);
      const selected=data.sets.find(s=>s.id===old2024.id);
      assert.equal(selected.revision,old2024.revision+1);
      assert.ok(selected.facts.every(f=>f.source.source_id===item.prepared_source_id));
      assert.equal((await owner.query('SELECT count(*)::int AS n FROM aic.mvp_financial_sets WHERE id=$1',[old2024.id])).rows[0].n,2);
      p=await intake.list(alice,company.id);assert.equal(p.items.find(i=>i.id===original.id).superseded_by,null);
      assert.equal(p.review.unresolved_count,0);
      await review.confirm(alice,company.id,uuid(),{expected_revision:p.revision,confirmed:true,
        source_snapshot_hash:p.review.source_snapshot_hash,bridge_assertions:bridges});
      // A pre-fix period collision can be reopened for extraction without whole-file replacement.
      p=await intake.list(alice,company.id);
      const legacy=(await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC legacy period collision')},p.revision)).body.item;
      await owner.query("UPDATE aic.financial_intakes SET state='duplicate',duplicate_of=$2 WHERE id=$1",[legacy.id,original.id]);
      p=await intake.list(alice,company.id);
      await intake.decide(alice,company.id,legacy.id,uuid(),{expected_revision:p.revision,action:'keep_existing'});
      p=await intake.list(alice,company.id);
      assert.equal(p.items.find(i=>i.id===legacy.id).state,'skipped');
      await intake.decide(alice,company.id,legacy.id,uuid(),{expected_revision:p.revision,action:'compare_periods'});
      await intake.once('SYNTHETIC-period-choice');
      p=await intake.list(alice,company.id);item=p.items.find(i=>i.id===legacy.id);
      const untouched=structuredClone((await registry.get(alice,company.id)).sets);
      for(const option of item.origin.period_candidates) {
        if (option.status !== 'pending') continue;
        p=await intake.list(alice,company.id);
        const target=untouched.find(s=>s.id===option.existing_sets[0].set_id);
        await intake.decide(alice,company.id,legacy.id,uuid(),{expected_revision:p.revision,action:'keep_period_source',
          receipt_id:option.receipt_id,set_id:target.id,expected_set_revision:target.revision});
      }
      assert.deepEqual((await registry.get(alice,company.id)).sets,untouched);
      p=await intake.list(alice,company.id);assert.equal(p.review.unresolved_count,0);
      assert.ok(p.items.find(i=>i.id===legacy.id).origin.period_candidates.every(c=>c.status==='kept'));
      await review.confirm(alice,company.id,uuid(),{expected_revision:p.revision,confirmed:true,
        source_snapshot_hash:p.review.source_snapshot_hash,bridge_assertions:bridges});
    });
    await t.test('reverse upload order preserves the original year when a later comparative source is kept separately',async()=>{
      const company=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:current.counterparty_id})).body;
      discoveryYears=[2023,2024];
      try {
        await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC reverse original 2024')},company.revision);
        await intake.once('SYNTHETIC-reverse');
      } finally { discoveryYears=[2024,2025]; }
      let p=await intake.list(alice,company.id);
      const original=(await registry.get(alice,company.id)).sets.find(s=>s.scope.period.end_date==='2024-12-31');
      const incoming=(await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC reverse comparative 2024')},p.revision)).body.item;
      values.net_revenue='103';
      await intake.once('SYNTHETIC-reverse');
      values.net_revenue='100';
      p=await intake.list(alice,company.id);
      const candidate=p.items.find(i=>i.id===incoming.id).origin.period_candidates[0];
      assert.equal(candidate.role,'comparative');assert.equal(candidate.existing_sets[0].role,'current');
      assert.deepEqual((await registry.get(alice,company.id)).sets.find(s=>s.id===original.id),original);
      await intake.decide(alice,company.id,incoming.id,uuid(),{expected_revision:p.revision,action:'keep_period_source',
        receipt_id:candidate.receipt_id,set_id:original.id,expected_set_revision:original.revision});
      const data=await registry.get(alice,company.id);
      assert.equal(data.sets.length,3);assert.deepEqual(data.sets.find(s=>s.id===original.id),original);
    });
    await t.test('a quarter and year-to-date period ending on the same day cannot overwrite each other',async()=>{
      const company=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:current.counterparty_id})).body;
      discoveryYears=[2026];interimPeriod={start:'-04-01',end:'-06-30'};
      try {
        await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC Q2 standalone period')},company.revision);
        await intake.once('SYNTHETIC-quarter');
        let p=await intake.list(alice,company.id);
        const original=(await registry.get(alice,company.id)).sets[0];
        interimPeriod={start:'-01-01',end:'-06-30'};
        await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC six months cumulative period')},p.revision);
        await intake.once('SYNTHETIC-quarter');
        const data=await registry.get(alice,company.id);
        assert.equal(data.sets.length,2);assert.deepEqual(data.sets.find(s=>s.id===original.id),original);
        assert.deepEqual(data.sets.map(s=>s.scope.period.start_date).sort(),['2026-01-01','2026-04-01']);
        p=await intake.list(alice,company.id);
        assert.ok(p.items.every(i=>!i.origin.period_candidates?.length));
      } finally { discoveryYears=[2024,2025];interimPeriod=null; }
    });
    await t.test('Outside-scope documents leave the action queue; failed files require a reason to exclude',async()=>{
      const company=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:current.counterparty_id})).body;
      documentType='other';await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC tax declaration')},company.revision);
      await intake.once('SYNTHETIC-other');documentType='financial_statement';
      let p=await intake.list(alice,company.id);assert.equal(p.items[0].state,'skipped');assert.equal(p.review.unresolved_count,0);
      const uploaded=(await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC unavailable source')},p.revision)).body;
      failProvider=true;await intake.once('SYNTHETIC-other');failProvider=false;p=await intake.list(alice,company.id);
      await reject(intake.decide(alice,company.id,uploaded.item.id,uuid(),{expected_revision:p.revision,action:'exclude'}),'INTAKE_EXCLUSION_REASON_REQUIRED');
      await intake.decide(alice,company.id,uploaded.item.id,uuid(),{expected_revision:p.revision,action:'exclude',reason:'SYNTHETIC duplicate outside current assessment'});
      assert.equal((await intake.list(alice,company.id)).review.unresolved_count,0);
    });
    await t.test('Only an unresolved comparative period blocks common review; explicit sourced review resolves that scope',async()=>{
      const company=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:current.counterparty_id})).body;
      periodIssues=[{candidate_index:2,kind:'FY',end_date:'2023-12-31',basis:'consolidated',pages:[1],
        code:'PERIOD_CONTEXT_REQUIRED',severity:'blocking'},
        {candidate_index:4,kind:'FY',end_date:'2023-12-31',basis:'standalone',pages:[1],
          code:'PERIOD_CONTEXT_REQUIRED',severity:'blocking'},
        {candidate_index:3,kind:'FY',end_date:'2025-12-31',basis:'consolidated',pages:[1],code:'DUPLICATE_MERGED',severity:'info'}];
      await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC comparative review')},company.revision);
      await intake.once('SYNTHETIC-comparative');periodIssues=[];
      let p=await intake.list(alice,company.id),item=p.items[0];
      assert.equal(p.review.unresolved_count,1);assert.equal(item.classification.periods.length,2);
      await reject(review.confirm(alice,company.id,uuid(),{expected_revision:p.revision,confirmed:true,
        source_snapshot_hash:p.review.source_snapshot_hash,bridge_assertions:bridges}),'FINANCIAL_PERIOD_REVIEW_REQUIRED');
      async function saveReviewedScope(basis) {
      const receiptId=uuid();
      await registry.save(alice,company.id,undefined,uuid(),{expected_revision:p.revision,
        reason:'SYNTHETIC independently reviewed comparative year',
        period:{kind:'FY',start_date:'2023-01-01',end_date:'2023-12-31'},basis,
        accounting_regime:'VN_TT200',currency:'VND',unit_multiplier:'1',industry_scope:'DISTRIBUTION_WHOLESALE_PILOT',
        audit_status:'unknown',statement_version:'SYNTHETIC reviewed comparative',observation_kind:'actual',
        intake_review:{intake_id:item.id,receipt_id:receiptId,page:1,quote:'SYNTHETIC reviewed reporting year 2023'},
        facts:Object.entries(values).map(([key,value])=>({key,raw_value:value,raw_label:key,missing_reason:null,
          source:{kind:'statement_entry',receipt_id:receiptId,fact_key:key,source_kind:'financial_file',source_id:item.prepared_source_id,
            source_hash:item.classification.sha256,page:1,quote:'SYNTHETIC '+key+' '+value,reason:'SYNTHETIC comparative source review'}}))});
      }
      await saveReviewedScope('consolidated');
      p=await intake.list(alice,company.id);item=p.items[0];
      assert.equal(p.review.unresolved_count,1);
      assert.ok(item.classification.period_issues.some(i=>i.severity==='blocking' && i.basis==='standalone'));
      assert.ok(item.classification.warnings.some(w=>w.startsWith('PERIOD_REVIEW_REQUIRED:2023-12-31:')));
      await saveReviewedScope('standalone');
      p=await intake.list(alice,company.id);item=p.items[0];
      assert.equal(p.review.unresolved_count,0);assert.equal(item.classification.period_issues.length,1);
      assert.equal(item.classification.period_issues[0].severity,'info');
      assert.ok(!item.classification.warnings.some(w=>w.startsWith('PERIOD_REVIEW_REQUIRED:2023-12-31:')));
      await review.confirm(alice,company.id,uuid(),{expected_revision:p.revision,confirmed:true,
        source_snapshot_hash:p.review.source_snapshot_hash,bridge_assertions:bridges});
    });
    await t.test('Discovery failure preserves PDF, safe diagnostics and an authenticated manual recovery after retries',async()=>{
      const company=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:current.counterparty_id})).body;
      const uploaded=(await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC blocked OCR')},company.revision)).body;
      discoveryFailure='MODEL_OUTPUT_BLOCKED';
      assert.equal(await intake.once('SYNTHETIC-blocked'),'failed');
      let p=await intake.list(alice,company.id), item=p.items[0];
      assert.equal(item.state,'failed');assert.equal(item.error_code,'MODEL_OUTPUT_BLOCKED');
      assert.ok(item.prepared_source_id);assert.equal(item.classification.document_type,'unknown');
      assert.deepEqual(item.classification.periods,[]);assert.equal(item.statements.length,0);
      assert.deepEqual(item.origin.diagnostics[0].validation,[{path:'/ocr/4',message:'MODEL_OUTPUT_BLOCKED'}]);
      assert.ok(!JSON.stringify(item).includes('PRIVATE MODEL TEXT'));
      assert.equal((await registry.get(alice,company.id)).sets.length,0);
      await reject(intake.list(bob,company.id),'NOT_FOUND');
      const sourceId=item.prepared_source_id;
      await intake.decide(alice,company.id,uploaded.item.id,uuid(),{expected_revision:p.revision,action:'retry'});
      discoveryFailure='INVALID_MODEL_OUTPUT';
      assert.equal(await intake.once('SYNTHETIC-blocked'),'failed');
      discoveryFailure=null;
      p=await intake.list(alice,company.id);item=p.items[0];
      assert.equal(item.prepared_source_id,sourceId);assert.equal(item.error_code,'INVALID_MODEL_OUTPUT');
      assert.equal((await owner.query('SELECT count(*)::int AS n FROM aic.financial_import_sources WHERE case_id=$1',[company.id])).rows[0].n,1);
      await reject(review.confirm(alice,company.id,uuid(),{expected_revision:p.revision,confirmed:true,
        source_snapshot_hash:p.review.source_snapshot_hash,bridge_assertions:bridges}),'FINANCIAL_INPUTS_REQUIRED');
      const receiptId=uuid();
      await registry.save(alice,company.id,undefined,uuid(),{expected_revision:p.revision,
        reason:'SYNTHETIC read the preserved original after AI refusal',
        period:{kind:'FY',start_date:'2024-01-01',end_date:'2024-12-31'},basis:'consolidated',
        accounting_regime:'VN_TT200',currency:'VND',unit_multiplier:'1',industry_scope:'DISTRIBUTION_WHOLESALE_PILOT',
        audit_status:'unknown',statement_version:'SYNTHETIC manual review',observation_kind:'actual',
        intake_review:{intake_id:item.id,receipt_id:receiptId,page:1,quote:'SYNTHETIC reporting year 2024'},
        facts:Object.entries(values).map(([key,value])=>({key,raw_value:value,raw_label:key,missing_reason:null,
          source:{kind:'statement_entry',receipt_id:receiptId,fact_key:key,source_kind:'financial_file',source_id:sourceId,
            source_hash:item.classification.sha256,page:1,quote:'SYNTHETIC '+key+' '+value,reason:'SYNTHETIC read original'}}))});
      p=await intake.list(alice,company.id);
      assert.equal(p.items[0].error_code,'HUMAN_PERIOD_REVIEWED');assert.equal(p.review.unresolved_count,0);
      const data=await registry.get(alice,company.id);
      assert.equal(data.sets.length,1);assert.ok(data.sets[0].facts.every(f=>f.verification.status==='unverified'));
      await review.confirm(alice,company.id,uuid(),{expected_revision:p.revision,confirmed:true,
        source_snapshot_hash:p.review.source_snapshot_hash,bridge_assertions:bridges});
      assert.equal((await intake.list(alice,company.id)).review.confirmed,true);
    });
    await t.test('AI calculations remain proposals, reject tampering, and require fresh common verification',async()=>{
      const company=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:current.counterparty_id})).body;
      calculationMode=true;
      await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC calculation proposal')},company.revision);
      await intake.once('SYNTHETIC-calculation');calculationMode=false;
      const read=await registry.get(alice,company.id),set=read.sets.find(s=>s.scope.period.end_date==='2025-12-31');
      assert.ok(!set.facts.some(f=>f.key==='current_liabilities'));
      const calculation=set.metadata.calculations[0];assert.equal(calculation.computed_value,'25');assert.equal(calculation.blocked_reason,null);
      let p=await intake.list(alice,company.id);
      await review.confirm(alice,company.id,uuid(),{expected_revision:p.revision,confirmed:true,source_snapshot_hash:p.review.source_snapshot_hash,bridge_assertions:bridges});
      p=await intake.list(alice,company.id);assert.equal(p.review.confirmed,true);
      const source={kind:'calculated',receipt_id:calculation.receipt_id,calculation_id:calculation.id,fact_key:calculation.key,
        source_kind:calculation.source_kind,source_id:calculation.source_id,source_hash:calculation.source_hash,
        page:calculation.inputs[0].page,quote:calculation.inputs[0].quote};
      const body={expected_revision:p.revision,reason:'SYNTHETIC reviewed formula and complete components',
        period:set.scope.period,basis:set.scope.basis,accounting_regime:set.scope.accounting_regime,currency:set.scope.currency,
        unit_multiplier:set.scope.unit_multiplier,industry_scope:set.scope.pilot_scope,observation_kind:'actual',audit_status:'unknown',statement_version:'synthetic calculation review',
        facts:[...set.facts.map(f=>({key:f.key,raw_value:f.raw_value,raw_label:f.raw_label,missing_reason:f.missing_reason,source:f.source})),
          {key:calculation.key,raw_value:'25',raw_label:'Số tính ra: '+calculation.key,missing_reason:null,source}]};
      const forged=structuredClone(body);forged.facts.at(-1).raw_value='26';
      await reject(registry.save(alice,company.id,set.id,uuid(),forged),'FINANCIAL_CALCULATION_CHANGED');
      const scopeChanged=structuredClone(body);scopeChanged.unit_multiplier='1000';
      await reject(registry.save(alice,company.id,set.id,uuid(),scopeChanged),'FINANCIAL_IMPORT_VALUE_OR_SCOPE_CHANGED');
      await reject(registry.save(bob,company.id,set.id,uuid(),body),'NOT_FOUND');
      const saved=(await registry.save(alice,company.id,set.id,uuid(),body)).body;
      const derived=saved.set.facts.find(f=>f.key===calculation.key);
      assert.equal(derived.normalized_decimal,'25');assert.equal(derived.source.kind,'calculated');
      assert.equal(derived.verification.status,'unverified');assert.equal(derived.current_source,true);
      assert.equal(saved.set.revision,set.revision+1);
      assert.equal((await owner.query('SELECT count(*)::int AS n FROM aic.mvp_financial_sets WHERE id=$1',[set.id])).rows[0].n,2);
      p=await intake.list(alice,company.id);assert.equal(p.review.confirmed,false);
      await review.confirm(alice,company.id,uuid(),{expected_revision:p.revision,confirmed:true,source_snapshot_hash:p.review.source_snapshot_hash,bridge_assertions:bridges});
      const verifiedRegistry=await registry.get(alice,company.id,set.id),verified=verifiedRegistry.sets.find(s=>s.id===set.id);
      assert.equal(verified.facts.find(f=>f.key===calculation.key).verification.status,'verified');
      assert.equal(verifiedRegistry.metrics.find(m=>m.metric_id==='AIC-M01').raw_ratio.decimal,'2');
      p=await intake.list(alice,company.id);
      const scopeReview={...body,expected_revision:p.revision,reason:'SYNTHETIC review scope without rewriting calculation evidence',
        intake_review:{intake_id:p.items[0].id,receipt_id:uuid(),page:1,quote:'SYNTHETIC current year 2025'}};
      const brokenProof=structuredClone(scopeReview);
      brokenProof.facts.at(-1).source.quote='SYNTHETIC altered proof citation';
      await reject(registry.save(alice,company.id,set.id,uuid(),brokenProof),'INVALID_FINANCIAL_SOURCE');
      const reviewed=(await registry.save(alice,company.id,set.id,uuid(),scopeReview)).body.set;
      assert.deepEqual(reviewed.facts.find(f=>f.key===calculation.key).source,source);
      assert.equal(reviewed.facts.find(f=>f.key===calculation.key).verification.status,'unverified');
      assert.deepEqual(reviewed.metadata.calculations,saved.set.metadata.calculations);
      assert.equal((await intake.list(alice,company.id)).review.confirmed,false);
      p=await intake.list(alice,company.id);
      const removed=(await registry.save(alice,company.id,set.id,uuid(),{...body,expected_revision:p.revision,
        reason:'SYNTHETIC no longer use this calculation',facts:body.facts.filter(f=>f.key!==calculation.key)})).body;
      assert.ok(!removed.set.facts.some(f=>f.key===calculation.key));
      assert.equal((await intake.list(alice,company.id)).review.confirmed,false);
    });
    await t.test('reasoning chain is persisted, scoped, reviewed, tamper-proof and stale after source selection',async()=>{
      const {FinancialImportService}=require('../dist/financial/financial-import.service');
      const imports=new FinancialImportService(db,config,core,mutations);
      const company=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:current.counterparty_id})).body;
      reasoningMode=true;reasoningConflict=true;
      await intake.upload(alice,company.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC reasoning chain')},company.revision);
      await intake.once('SYNTHETIC-reasoning');reasoningMode=false;reasoningConflict=false;
      let data=await registry.get(alice,company.id),set=data.sets.find(s=>s.scope.period.end_date==='2025-12-31');
      assert.ok(set.metadata.reasoning);assert.equal(set.metadata.calculations.find(p=>p.key==='current_liabilities').blocked_reason,'CONFLICT');
      let p=await intake.list(alice,company.id);
      await reject(review.confirm(alice,company.id,uuid(),{expected_revision:p.revision,confirmed:true,source_snapshot_hash:p.review.source_snapshot_hash,bridge_assertions:bridges}),'FINANCIAL_REASONING_CONFLICT');
      const receipt=set.metadata.reasoning.receipt_id;
      const evaluate=()=>db.transaction(async(tx)=>registry.evaluateTx(tx,await core.assertCaseAccess(tx,alice.user,company.id,false)));
      const canonical=(await evaluate()).source_snapshot_hash, originalSetTx=registry.setTx;
      try {
        registry.setTx=async function(...args) {
          const value=await originalSetTx.apply(this,args);
          value.read.metadata=structuredClone(value.read.metadata);
          for(const calculation of value.read.metadata.calculations ?? []) calculation.reason='SYNTHETIC refreshed explanatory text only';
          return value;
        };
        assert.equal((await evaluate()).source_snapshot_hash,canonical,'read-only diagnostic changes cannot stale financial assessments');
      } finally { registry.setTx=originalSetTx; }
      const page=await imports.reasoning(alice,company.id,receipt,0);assert.ok(page.rows.length>14);
      assert.equal(page.relations.length,2);
      await reject(imports.reasoning(bob,company.id,receipt,0),'NOT_FOUND');
      const command={set_id:set.id,expected_revision:p.revision,reason:'SYNTHETIC source review excludes misread 61; original 60 retained',excluded_observation_ids:['o_bad']};
      await reject(imports.reviewReasoning(alice,company.id,receipt,uuid(),{...command,excluded_relation_ids:['invented_relation']}),'INVALID_INPUT');
      const result=await imports.reviewReasoning(alice,company.id,receipt,uuid(),command);
      assert.notEqual(result.receipt_id,receipt);
      data=await registry.get(alice,company.id);set=data.sets.find(s=>s.id===set.id);
      const proposal=set.metadata.calculations.find(c=>c.key==='current_liabilities');
      assert.equal(proposal.computed_value,'25');assert.equal(proposal.proof.steps.length,2);assert.equal(proposal.inputs.length,3);
      assert.equal((await owner.query('SELECT count(*)::int AS n FROM aic.financial_reasoning_runs WHERE id=$1',[result.receipt_id])).rows[0].n,1);
      const sealed=(await owner.query('SELECT graph_json,graph_hash,scope_json FROM aic.financial_reasoning_runs WHERE id=$1',[result.receipt_id])).rows[0];
      assert.equal(sealed.graph_hash,require('../dist/financial/financial-reasoning').reasoningSummary({receipt_id:result.receipt_id,scope:sealed.scope_json,reasoning:sealed.graph_json}).proof_hash);
      await assert.rejects(owner.query('UPDATE aic.financial_reasoning_runs SET graph_hash=graph_hash WHERE id=$1',[result.receipt_id]),e=>e.code==='55000');
      p=await intake.list(alice,company.id);
      const source={kind:'calculated',receipt_id:proposal.receipt_id,calculation_id:proposal.id,fact_key:proposal.key,source_kind:proposal.source_kind,
        source_id:proposal.source_id,source_hash:proposal.source_hash,page:proposal.inputs[0].page,quote:proposal.inputs[0].quote};
      const body={expected_revision:p.revision,reason:'SYNTHETIC review of complete multi-step proof',period:set.scope.period,basis:set.scope.basis,
        accounting_regime:set.scope.accounting_regime,currency:set.scope.currency,unit_multiplier:set.scope.unit_multiplier,industry_scope:set.scope.pilot_scope,
        observation_kind:'actual',audit_status:'unknown',statement_version:'SYNTHETIC reasoning',
        facts:[...set.facts.map(f=>({key:f.key,raw_value:f.raw_value,raw_label:f.raw_label,missing_reason:f.missing_reason,source:f.source})),
          {key:proposal.key,raw_value:'25',raw_label:'Số tính ra: '+proposal.key,missing_reason:null,source}]};
      const forged=structuredClone(body);forged.facts.at(-1).raw_value='26';
      await reject(registry.save(alice,company.id,set.id,uuid(),forged),'FINANCIAL_CALCULATION_CHANGED');
      await registry.save(alice,company.id,set.id,uuid(),body);
      p=await intake.list(alice,company.id);
      await review.confirm(alice,company.id,uuid(),{expected_revision:p.revision,confirmed:true,source_snapshot_hash:p.review.source_snapshot_hash,bridge_assertions:bridges});
      p=await intake.list(alice,company.id);assert.equal(p.review.confirmed,true);
      await imports.reviewReasoning(alice,company.id,result.receipt_id,uuid(),{...command,expected_revision:p.revision,excluded_observation_ids:[],excluded_relation_ids:['one'],reason:'SYNTHETIC review rejects an accounting relation'});
      p=await intake.list(alice,company.id);assert.equal(p.review.confirmed,false);
      const after=(await registry.get(alice,company.id)).sets.find(s=>s.id===set.id);
      assert.ok(!after.facts.some(f=>f.key==='current_liabilities'));
      assert.equal(after.metadata.calculations.find(c=>c.key==='current_liabilities').blocked_reason,'UNDERDETERMINED');
    });
    await t.test('reviewed incomplete company exposes bounds without changing complete cases or source facts', async () => {
      const company = (await cases.createCompany(alice, uuid(), {
        schema_version: 'AIC-COMPANY-HEALTH-1', counterparty_id: current.counterparty_id,
      })).body;
      await intake.upload(alice, company.id, uuid(), {
        ...file, buffer: Buffer.from('%PDF-SYNTHETIC limited-data bounds'),
      }, company.revision);
      await intake.once('SYNTHETIC-partial-assessment');
      const original = await registry.get(alice, company.id);
      const set = original.sets.find(s => s.scope.period.end_date === '2025-12-31');
      let p = await intake.list(alice, company.id);
      await registry.save(alice, company.id, set.id, uuid(), {
        expected_revision: p.revision, reason: 'SYNTHETIC source has no net receivables or period depreciation',
        period: set.scope.period, basis: set.scope.basis, accounting_regime: set.scope.accounting_regime,
        currency: set.scope.currency, unit_multiplier: set.scope.unit_multiplier,
        industry_scope: set.scope.pilot_scope, observation_kind: 'actual', audit_status: 'unknown',
        statement_version: 'SYNTHETIC incomplete source',
        facts: set.facts.filter(f => !['trade_receivables', 'depreciation_amortization'].includes(f.key))
          .map(f => ({ key: f.key, raw_value: f.raw_value, raw_label: f.raw_label,
            missing_reason: f.missing_reason, source: f.source })),
      });
      p = await intake.list(alice, company.id);
      await review.confirm(alice, company.id, uuid(), {
        expected_revision: p.revision, confirmed: true, source_snapshot_hash: p.review.source_snapshot_hash,
        bridge_assertions: { quick_assets_non_overlapping: false, quick_assets_eligible: false,
          da_addback_to_operating_profit: false },
      });
      p = await intake.list(alice, company.id);
      const before = await registry.get(alice, company.id);
      const assessmentResult = (await assessment.run(alice, company.id, uuid(), {
        expected_revision: p.revision, financial_set_id: set.id,
      })).body;
      const partial = assessmentResult.financial_health.partial_assessment;
      assert.ok(partial, JSON.stringify(assessmentResult.financial_health.blockers));
      assert.equal(partial.available_max_points, '80');
      assert.equal(partial.unresolved_max_points, '20');
      assert.equal(partial.components.length, 5);
      for (const component of assessmentResult.financial_health.components) {
        const available=partial.components.find(c=>c.metric_id===component.metric_id);
        assert.equal(component.points,available?.points??null);
        assert.equal(assessmentResult.factors.find(f=>f.factor_id===component.metric_id).score,available?.points??null);
      }
      assert.deepEqual(partial.unresolved_metric_ids, ['AIC-M02', 'AIC-M04']);
      assert.equal(assessmentResult.overall_score, null);
      assert.equal(assessmentResult.financial_health.score, null);
      assert.equal(assessmentResult.financial_health.band, null);
      assert.equal(assessmentResult.pd, null);
      assert.deepEqual((await assessment.get(alice, assessmentResult.id)).financial_health.partial_assessment, partial);
      assert.deepEqual((await registry.get(alice, company.id)).sets, before.sets);
      assert.equal((await assessment.get(alice, scored.id)).financial_health.score, scored.financial_health.score);
      const now = (await registry.get(alice, company.id)).sets.find(s => s.id === set.id);
      assert.ok(!now.facts.some(f => ['trade_receivables', 'depreciation_amortization'].includes(f.key)));
      await reject(assessment.get(bob, assessmentResult.id), 'NOT_FOUND');
      const empty=(await registry.save(alice,company.id,undefined,uuid(),{
        expected_revision:assessmentResult.case_revision,reason:'SYNTHETIC newer quarter with no extracted facts',
        period:{kind:'INTERIM',start_date:'2026-04-01',end_date:'2026-06-30'},
        basis:set.scope.basis,accounting_regime:'UNKNOWN',currency:set.scope.currency,
        unit_multiplier:set.scope.unit_multiplier,industry_scope:set.scope.pilot_scope,
        observation_kind:'actual',audit_status:'unknown',statement_version:'SYNTHETIC empty quarter',facts:[],
      })).body.set;
      const trends=await registry.trends(alice,company.id,empty.id);
      const annual=trends.rows.find(r=>r.set.id===set.id), quarter=trends.rows.find(r=>r.set.id===empty.id);
      assert.ok(annual.comparison_issues.includes('INCOMPATIBLE_ACCOUNTING_REGIME'));
      assert.equal(annual.standalone_values,true);
      assert.equal(quarter.standalone_values,undefined);
      assert.equal(annual.metrics.filter(m=>m.raw_ratio!==null).length,5);
      assert.ok(annual.facts.some(f=>f.key==='net_revenue'&&f.value!==null));
      assert.deepEqual(quarter.metrics,[]);
      assert.deepEqual(quarter.facts,[]);
      p=await intake.list(alice,company.id);
      await review.confirm(alice,company.id,uuid(),{
        expected_revision:p.revision,confirmed:true,source_snapshot_hash:p.review.source_snapshot_hash,
        bridge_assertions:{quick_assets_non_overlapping:false,quick_assets_eligible:false,da_addback_to_operating_profit:false},
      });
      p=await intake.list(alice,company.id);
      const baseline=await registry.get(alice,company.id), caseKey=uuid(), command={expected_revision:p.revision};
      const combined=(await assessment.run(alice,company.id,caseKey,command)).body;
      assert.equal(combined.financial_set_id,null);
      assert.equal(combined.case_aggregation.included_set_ids.length,2);
      assert.equal(combined.case_aggregation.excluded_sets.find(s=>s.set_id===empty.id).reasons.includes('FULL_CALENDAR_FY_REQUIRED'),true);
      assert.equal(combined.financial_health.partial_assessment.available_max_points,'80');
      assert.equal(combined.financial_health.partial_assessment.components.length,5);
      assert.equal(combined.case_aggregation.metrics.find(m=>m.metric_id==='AIC-M01').contributions.length,2);
      assert.equal(combined.financial_health.components.find(c=>c.metric_id==='AIC-M01').raw_value,null);
      assert.equal(combined.financial_health.components.find(c=>c.metric_id==='AIC-M01').points,
        assessmentResult.financial_health.components.find(c=>c.metric_id==='AIC-M01').points);
      assert.equal(combined.calculation_trace.periods.length,3);
      const reread=await assessment.get(alice,combined.id);
      assert.equal(reread.stale,false);
      assert.deepEqual(reread.case_aggregation,combined.case_aggregation);
      assert.deepEqual((await assessment.run(alice,company.id,caseKey,command)).body,combined);
      assert.deepEqual((await registry.get(alice,company.id)).sets,baseline.sets);
      assert.deepEqual((await assessment.get(alice,assessmentResult.id)).financial_health.partial_assessment,partial);
      assert.equal((await assessment.get(alice,assessmentResult.id)).case_aggregation,undefined);
      await reject(assessment.get(bob,combined.id),'NOT_FOUND');
    });
    const last = (
      await intake.upload(
        alice,
        current.id,
        uuid(),
        { ...file, buffer: Buffer.from("%PDF-SYNTHETIC provider failure") },
        page.revision,
      )
    ).body;
    failProvider = true;
    assert.equal(await intake.once("SYNTHETIC-worker"), "failed");
    page = await intake.list(alice, current.id);
    assert.equal(page.items.find((i) => i.id === last.item.id).state, "failed");
    assert.equal(
      page.items.find((i) => i.id === last.item.id).error_code,
      "PROVIDER_UNAVAILABLE",
    );
    assert.equal(page.review.confirmed, false);
    await t.test('US/CN intake uses the counterparty country, separate policy and current case-wide points',async()=>{
      const {ACCOUNTING_PROFILES,profileMethodHash}=require('../dist/financial/accounting-profiles');
      failProvider=false;discoveryYears=[2024,2025];interimPeriod=null;documentType='financial_statement';
      omitKey=false;calculationMode=false;reasoningMode=false;emptyFacts=false;missingStart=false;periodIssues=[];
      config.internationalPolicy={policy_id:'SYNTHETIC-international',status:'configured_pilot',organization_ids:[alice.user.organization_id],
        profiles:ACCOUNTING_PROFILES.map(p=>({profile_id:p.id,method_hash:profileMethodHash(p)})),
        approval:{by:'SYNTHETIC',recorded_at:'2020-01-01T00:00:00Z',source:'synthetic-test',scope:'US/CN distribution'},
        effective_from:'2020-01-01T00:00:00Z',effective_until:null};
      for(const country of ['US','CN']) {
        fixtureCountry=country;
        values.eligible_cash_and_equivalents='15';
        const party=(await cp.create(alice,uuid(),{name:'SYNTHETIC company',country,tax_id:null,industry_code:'DISTRIBUTION_WHOLESALE_PILOT'})).body;
        const c=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:party.id})).body;
        await intake.upload(alice,c.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC international '+country)},c.revision);
        assert.equal(await intake.once('SYNTHETIC-intl'),'processed');
        let p=await intake.list(alice,c.id);const r=await registry.get(alice,c.id);
        assert.equal(r.sets.length,2);assert.ok(r.sets.every(s=>s.scope.country===country && s.metadata.accounting_profile.country===country));
        assert.ok(r.sets.every(s=>s.facts.length===15));
        assert.ok(p.capabilities.countries.includes(country));
        await review.confirm(alice,c.id,uuid(),{expected_revision:p.revision,confirmed:true,source_snapshot_hash:p.review.source_snapshot_hash,
          bridge_assertions:{quick_assets_non_overlapping:true,quick_assets_eligible:true,da_addback_to_operating_profit:true}});
        p=await intake.list(alice,c.id);
        const result=(await assessment.run(alice,c.id,uuid(),{expected_revision:p.revision})).body;
        assert.ok(result.method_version.includes(country==='US'?'us-gaap-pilot':'cn-asbe-pilot'));
        assert.equal(result.case_aggregation.accounting_profile.country,country);
        assert.ok(!result.financial_health.blockers.includes('COUNTRY_METHOD_NOT_VALIDATED'));
        if(country==='US')assert.ok(result.financial_health.score!==null);
        else {assert.equal(result.financial_health.score,null);assert.ok(result.financial_health.partial_assessment);}
        const count=calls;
        await intake.upload(alice,c.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC international '+country)},result.case_revision);
        assert.equal(calls,count,'Duplicate content must not invoke the paid processing transport');
        const foreignParty=(await cp.create(alice,uuid(),{name:'OTHER SYNTHETIC company',country,tax_id:null,industry_code:'DISTRIBUTION_WHOLESALE_PILOT'})).body;
        const foreignCase=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:foreignParty.id})).body;
        await intake.upload(alice,foreignCase.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC foreign-company '+country)},foreignCase.revision);
        assert.equal(await intake.once('SYNTHETIC-wrong-entity'),'failed');
        const foreignPage=await intake.list(alice,foreignCase.id);
        assert.equal(foreignPage.items[0].error_code,'FINANCIAL_ENTITY_MISMATCH');
        assert.equal((await registry.get(alice,foreignCase.id)).sets.length,0);
        const disabled=config.internationalPolicy;delete config.internationalPolicy;
        try {
          const blocked=(await cases.createCompany(alice,uuid(),{schema_version:'AIC-COMPANY-HEALTH-1',counterparty_id:party.id})).body;
          await reject(intake.upload(alice,blocked.id,uuid(),{...file,buffer:Buffer.from('%PDF-SYNTHETIC disabled '+country)},blocked.revision),'MVP_COUNTRY_NOT_ENABLED');
        } finally {config.internationalPolicy=disabled;}
      }
      delete values.eligible_cash_and_equivalents;
      fixtureCountry='VN';
    });
    await t.test(
      "Original bytes and confirmations cannot be rewritten",
      async () => {
        for (const sql of [
          "UPDATE aic.financial_intakes SET bytes=bytes||decode('00','hex')",
          "DELETE FROM aic.financial_intakes",
          "UPDATE aic.financial_review_confirmations SET actor_id=actor_id",
        ])
          await assert.rejects(owner.query(sql), (e) => e.code === "55000");
      },
    );
  } finally {
    if (app) await app.close();
    if (server) await new Promise((r) => server.close(r));
    if (db) await db.onModuleDestroy();
    if (owner) await owner.end();
    await admin.query("DROP DATABASE IF EXISTS " + name + " WITH (FORCE)");
    await admin.end();
  }
});
