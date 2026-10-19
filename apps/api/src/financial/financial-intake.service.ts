import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { calculationMetadata } from './financial-calculations';
import { reasoningSummary } from './financial-reasoning';
import { persistReasoning } from './financial-reasoning.repository';
import { extname } from "node:path";
import { Agent, fetch } from "undici";
import { FOUNDATION_CONFIG, FOUNDATION_DB } from "../foundation/ports";
import type {
  AuthSession,
  FoundationDatabase,
  SqlClient,
} from "../foundation/ports";
import type { AppConfig } from "../config/configuration";
import { CoreRepository, requireUuid } from "../foundation/core.repository";
import { CaseMutations } from "../foundation/case-mutations";
import { FoundationError, notFound } from "../foundation/errors";
import { canonicalJson } from "../foundation/canonical";
import { validateContract } from "../foundation/validation";
import { countryCode, sha, importSource, importReceipt } from "./financial-import-source";
import { Decimal } from "./decimal";
import { readZipArchive } from "../documents/document-archive";
import { financialReviewState } from "./financial-review-state";
import { reportingColumnRole, identicalPeriodFigures } from './financial-period-source';
import { accountingProfile, intakeCountryEnabled, sameFinancialEntity, sourceRoundingQuantum } from './accounting-profiles';

export const INTAKE_VERSION = "AIC-FINANCIAL-INTAKE-1";
export const INTAKE_MAX_BYTES = 32 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".zip": "application/zip",
};
const fail = (code: string, status = 422): never => {
  throw new FoundationError(status, code);
};
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const publicItem = (r: any) => ({
  id: r.id,
  parent_id: r.parent_id,
  name: r.name,
  sha256: r.sha256,
  content_type: r.content_type,
  state: r.state,
  attempts: r.attempts,
  prepared_source_id: r.prepared_source_id,
  classification: r.classification_json,
  statements: r.result_json,
  origin: r.origin_json,
  duplicate_of: r.duplicate_of,
  replacement_of: r.replacement_of,
  superseded_by: r.superseded_by,
  error_code: r.error_code,
  created_at: new Date(r.created_at).toISOString(),
});

@Injectable()
export class FinancialIntakeService {
  constructor(
    @Inject(FOUNDATION_DB) private db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) private config: AppConfig,
    private core: CoreRepository,
    private mutations: CaseMutations,
  ) {}

  private async access(tx: SqlClient, session: AuthSession, caseId: string) {
    const check = async () => {
      if (
        !(
          await tx.query("SELECT * FROM aic.lock_active_session($1,$2,$3,$4)", [
            session.id,
            session.user.id,
            session.user.organization_id,
            this.config.sessionIdleMs,
          ])
        ).rows[0]
      )
        fail("SESSION_EXPIRED", 401);
    };
    await check();
    const current = await this.core.assertCaseAccess(
      tx,
      session.user,
      caseId,
      true,
    );
    await check();
    if (current.purpose !== "company_health")
      fail("COMPANY_FINANCIAL_WORKSPACE_REQUIRED");
    return current;
  }

  async list(session: AuthSession, caseId: string) {
    return this.db.transaction(async (tx) => {
      const current = await this.access(tx, session, caseId);
      const items = (
        await tx.query(
          `SELECT id,parent_id,name,sha256,content_type,state,attempts,prepared_source_id,
        classification_json,result_json,origin_json,duplicate_of,replacement_of,superseded_by,error_code,created_at
        FROM aic.financial_intakes WHERE organization_id=$1 AND case_id=$2 ORDER BY created_at,id`,
          [current.organization_id, current.id],
        )
      ).rows;
      // Refresh display roles for previously imported files without changing their saved decisions.
      const pending = items.flatMap(i => i.origin_json.period_candidates ?? []).filter(c => c.status === 'pending');
      const matches: any[] = pending.length ? await this.matchingSets(tx, current,
        pending.map(c => ({...c.period, basis:c.basis}))) : [];
      const displayed = items.map(row => {
        const item = publicItem(row);
        item.origin = {...item.origin, period_candidates:(item.origin.period_candidates ?? []).map((c:any) => ({
          ...c, role:this.periodRole(item.classification?.periods ?? [], {...c.period,basis:c.basis}),
          existing_sets:c.existing_sets.map((s:any) => ({...s,role:matches.find((m:any) => m.set_id===s.set_id)?.role ?? s.role})),
        }))};
        return item;
      });
      const result = {
        contract_version: INTAKE_VERSION,
        revision: Number(current.revision),
        items: displayed,
        review: await financialReviewState(tx, current),
        capabilities: {
          countries: ['VN','US','CN'].filter(country=>intakeCountryEnabled(this.config,current.organization_id,country,new Date().toISOString())),
          country: countryCode((await tx.query('SELECT country FROM aic.counterparties WHERE organization_id=$1 AND id=$2',
            [current.organization_id,current.counterparty_id])).rows[0]?.country ?? 'UNKNOWN'),
        },
      };
      validateContract("FinancialIntakePage", result, true);
      return result;
    });
  }

  async upload(
    session: AuthSession,
    caseId: string,
    key: string,
    file: Express.Multer.File,
    expected: number,
  ) {
    await this.db.transaction((tx) => this.access(tx, session, caseId));
    const extension = extname(file?.originalname || "").toLowerCase();
    if (!MIME[extension] || !file?.buffer?.length)
      fail("UNSUPPORTED_SOURCE_FORMAT", 415);
    if (
      file.buffer.length >
      (extension === ".zip" ? INTAKE_MAX_BYTES : 25_000_000)
    )
      fail("SOURCE_TOO_LARGE", 413);
    const signatures: Record<string, Buffer[]> = {
      ".pdf": [Buffer.from("%PDF-")],
      ".xlsx": [Buffer.from("504b0304", "hex")],
      ".xls": [Buffer.from("d0cf11e0", "hex")],
      ".png": [Buffer.from("89504e470d0a1a0a", "hex")],
      ".jpg": [Buffer.from("ffd8ff", "hex")],
      ".jpeg": [Buffer.from("ffd8ff", "hex")],
      ".zip": [Buffer.from("504b0304", "hex")],
    };
    if (
      !signatures[extension].some((s) =>
        file.buffer.subarray(0, s.length).equals(s),
      )
    )
      fail("SOURCE_FORMAT_MISMATCH");
    const bytes = Buffer.from(file.buffer),
      hash = sha(bytes),
      name = file.originalname
        .replace(/[\\/\x00-\x1f\x7f]/g, "_")
        .slice(0, 255);
    return this.mutations.execute(session, caseId, {
      operation: "financial.intake",
      key,
      expectedRevision: expected,
      payload: { name, sha256: hash },
      work: async (tx, current, next) => {
        const cp = (
          await tx.query(
            "SELECT country FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE",
            [current.organization_id, current.counterparty_id],
          )
        ).rows[0];
        if (!intakeCountryEnabled(this.config,current.organization_id,countryCode(cp.country),new Date().toISOString())) fail("MVP_COUNTRY_NOT_ENABLED");
        const usage = (
          await tx.query(
            "SELECT count(*)::int AS n,COALESCE(sum(octet_length(bytes)),0)::bigint AS bytes FROM aic.financial_intakes WHERE organization_id=$1 AND case_id=$2",
            [current.organization_id, current.id],
          )
        ).rows[0];
        if (usage.n >= 256 || Number(usage.bytes) + bytes.length > 300_000_000)
          fail("FINANCIAL_SOURCE_CASE_LIMIT", 409);
        const duplicate = (
          await tx.query(
            `SELECT id FROM aic.financial_intakes WHERE organization_id=$1 AND case_id=$2
          AND sha256=$3 AND state IN ('ready','queued','running','needs_review') AND superseded_by IS NULL ORDER BY created_at LIMIT 1`,
            [current.organization_id, current.id, hash],
          )
        ).rows[0];
        const id = randomUUID(),
          row = (
            await tx.query(
              `INSERT INTO aic.financial_intakes(id,organization_id,case_id,actor_id,name,sha256,bytes,content_type,state,duplicate_of)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
              [
                id,
                current.organization_id,
                current.id,
                session.user.id,
                name,
                hash,
                bytes,
                MIME[extension],
                duplicate ? "duplicate" : "queued",
                duplicate?.id ?? null,
              ],
            )
          ).rows[0];
        return {
          status: 202,
          body: {
            contract_version: INTAKE_VERSION,
            revision: next,
            item: publicItem(row),
          },
          action: "financial.intake_received",
          subjectId: id,
          metadata: { sha256: hash, content_type: MIME[extension] },
        };
      },
    });
  }

  async importExisting(
    session: AuthSession,
    caseId: string,
    key: string,
    body: unknown,
  ) {
    validateContract("FinancialIntakeExistingInput", body);
    const input = JSON.parse(canonicalJson(body));
    const original = await this.db.transaction(async (tx) => {
      const current = await this.access(tx, session, caseId);
      return importSource(
        tx,
        current,
        input.source_kind,
        input.source_id,
        true,
      );
    });
    return this.upload(
      session,
      caseId,
      key,
      {
        buffer: original.bytes,
        originalname: original.name || "financial.pdf",
      } as Express.Multer.File,
      input.expected_revision,
    );
  }

  async decide(
    session: AuthSession,
    caseId: string,
    id: string,
    key: string,
    body: unknown,
  ) {
    requireUuid(id);
    validateContract("FinancialIntakeDecision", body);
    const input = JSON.parse(canonicalJson(body));
    return this.mutations.execute(session, caseId, {
      operation: "financial.intake_decision:" + id,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        const row = (
          await tx.query(
            "SELECT * FROM aic.financial_intakes WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE",
            [current.organization_id, current.id, id],
          )
        ).rows[0];
        if (!row) throw notFound();
        if (input.action === 'exclude') {
          if (!input.reason?.trim() || ['queued','running','expanded'].includes(row.state))
            fail('INTAKE_EXCLUSION_REASON_REQUIRED');
          if (row.result_json.length) fail('INTAKE_HAS_FINANCIAL_DATA');
          await tx.query(`UPDATE aic.financial_intakes SET state='skipped',error_code=NULL,
            origin_json=origin_json||$2::jsonb,updated_at=clock_timestamp() WHERE id=$1`,
            [id,canonicalJson({exclusion:{by:session.user.id,reason:input.reason.trim()}})]);
        } else if (['select_period_source','keep_period_source'].includes(input.action)) {
          await this.decidePeriod(tx,current,row,input,next,session.user.id);
        } else if (input.action === 'compare_periods') {
          if (!['duplicate','skipped'].includes(row.state) || row.origin_json.exclusion || row.attempts >= 3 || row.result_json.length)
            fail('INTAKE_DECISION_UNAVAILABLE',409);
          const target = row.duplicate_of ? (await tx.query(`SELECT sha256 FROM aic.financial_intakes
            WHERE organization_id=$1 AND case_id=$2 AND id=$3`,[current.organization_id,current.id,row.duplicate_of])).rows[0] : null;
          if (target?.sha256 === row.sha256 || (!target && !row.origin_json.duplicate_sets?.length))
            fail('INTAKE_DECISION_UNAVAILABLE',409);
          await tx.query(`UPDATE aic.financial_intakes SET state='queued',duplicate_of=NULL,replacement_of=NULL,
            origin_json=origin_json-'replaces_existing_sets'-'duplicate_sets',error_code=NULL,updated_at=clock_timestamp()
            WHERE id=$1`,[row.id]);
        } else if (input.action === "retry") {
          if (
            !["failed", "needs_review"].includes(row.state) ||
            row.attempts >= 3 || row.origin_json.period_candidates?.some((c:any)=>c.status === 'pending')
          )
            fail("INTAKE_RETRY_UNAVAILABLE", 409);
          await tx.query(
            "UPDATE aic.financial_intakes SET state='queued',error_code=NULL,updated_at=clock_timestamp() WHERE id=$1",
            [id],
          );
        } else {
          if (
            row.state !== "duplicate" ||
            (!row.duplicate_of && !row.origin_json.duplicate_sets?.length)
          )
            fail("INTAKE_DECISION_UNAVAILABLE", 409);
          if (row.duplicate_of) {
            const target = (
              await tx.query(
                "SELECT state FROM aic.financial_intakes WHERE organization_id=$1 AND case_id=$2 AND id=$3 FOR SHARE",
                [current.organization_id, current.id, row.duplicate_of],
              )
            ).rows[0];
            if (!target || ["queued", "running"].includes(target.state))
              fail("INTAKE_SOURCE_PROCESSING", 409);
          }
          await tx.query(
            `UPDATE aic.financial_intakes SET state=$2,replacement_of=$3,error_code=NULL,updated_at=clock_timestamp() WHERE id=$1`,
            [
              id,
              input.action === "replace" ? "queued" : "skipped",
              input.action === "replace" ? row.duplicate_of : null,
            ],
          );
          if (input.action === "replace" && !row.duplicate_of)
            await tx.query(
              `UPDATE aic.financial_intakes SET origin_json=origin_json||'{"replaces_existing_sets":true}'::jsonb WHERE id=$1`,
              [id],
            );
        }
        const updated = (
          await tx.query("SELECT * FROM aic.financial_intakes WHERE id=$1", [
            id,
          ])
        ).rows[0];
        return {
          status: 200,
          body: { revision: next, item: publicItem(updated) },
          action: "financial.intake_decided",
          subjectId: id,
          metadata: { action: input.action, ...(input.receipt_id ? {receipt_id:input.receipt_id,
            set_id:input.set_id,expected_set_revision:input.expected_set_revision} : {}) },
        };
      },
    });
  }

  private async decidePeriod(tx: SqlClient, current: any, row: any, input: any, next: number, actorId: string) {
    const candidates = structuredClone(row.origin_json.period_candidates ?? []);
    const candidate = candidates.find((c:any)=>c.receipt_id === input.receipt_id && c.status === 'pending');
    if (row.state !== 'needs_review' || row.superseded_by || !candidate || !input.set_id ||
      !candidate.existing_sets.some((s:any)=>s.set_id === input.set_id)) fail('INTAKE_DECISION_UNAVAILABLE',409);
    const target=(await tx.query(`SELECT * FROM aic.mvp_financial_sets WHERE organization_id=$1 AND case_id=$2
      AND id=$3 ORDER BY revision DESC LIMIT 1`,[current.organization_id,current.id,input.set_id])).rows[0];
    if (!target || Number(target.revision) !== input.expected_set_revision ||
      canonicalJson(target.scope_json.period) !== canonicalJson(candidate.period) || target.scope_json.basis !== candidate.basis)
      fail('FINANCIAL_PERIOD_SOURCE_CHANGED',409);
    let statements=[...row.result_json];
    if (input.action === 'select_period_source') {
      const receipt=await importReceipt(tx,current,candidate.receipt_id);
      const file=await importSource(tx,current,'financial_file',row.prepared_source_id);
      if (receipt.source.id !== file.id || receipt.sha256 !== file.sha256 ||
        canonicalJson({kind:receipt.scope.period_kind,start_date:receipt.scope.start_date,end_date:receipt.scope.end_date}) !== canonicalJson(candidate.period) ||
        receipt.scope.basis !== candidate.basis) fail('INVALID_FINANCIAL_SOURCE');
      const cp=(await tx.query(`SELECT country,industry_code,revision FROM aic.counterparties
        WHERE organization_id=$1 AND id=$2 FOR SHARE`,[current.organization_id,current.counterparty_id])).rows[0];
      if (!intakeCountryEnabled(this.config,current.organization_id,countryCode(cp.country),new Date().toISOString())) fail('MVP_COUNTRY_NOT_ENABLED');
      const statement=await this.writeStatement(tx,current,{...row,actor_id:actorId},cp,receipt,next,{set_id:target.id});
      statements=statements.filter((s:any)=>s.set_id !== target.id);
      statements.push(statement);
    }
    candidate.status=input.action === 'select_period_source' ? 'selected' : 'kept';
    candidate.selected_set_id=target.id;
    candidate.selected_set_revision=Number(target.revision)+(candidate.status === 'selected'?1:0);
    candidate.decided_by=actorId;
    await tx.query(`UPDATE aic.financial_intakes SET result_json=$2::jsonb,origin_json=origin_json||$3::jsonb,
      error_code=$4,updated_at=clock_timestamp() WHERE id=$1`,[row.id,canonicalJson(statements),
      canonicalJson({period_candidates:candidates}),candidates.some((c:any)=>c.status==='pending')?
        'FINANCIAL_PERIOD_SOURCE_SELECTION_REQUIRED':'FINANCIAL_PERIOD_OR_FIELDS_UNRESOLVED']);
  }

  private periodRole(periods: any[], period: any) {
    return reportingColumnRole(periods, period);
  }

  async original(session: AuthSession, id: string) {
    requireUuid(id);
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query(
          "SELECT * FROM aic.financial_intakes WHERE organization_id=$1 AND id=$2",
          [session.user.organization_id, id],
        )
      ).rows[0];
      if (!row) throw notFound();
      await this.access(tx, session, row.case_id);
      if (sha(row.bytes) !== row.sha256) fail("SOURCE_INTEGRITY_FAILURE", 500);
      return row;
    });
  }

  private async ai(operation: "prepare" | "discovery" | "extract", body: any, cacheScope = 'standalone') {
    if (this.config.documentAiMode !== "live")
      fail("FINANCIAL_IMPORT_LIVE_REQUIRED", 503);
    const base = new URL(this.config.aiServiceUrl);
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      fail("AI_INVALID_CONFIG", 503);
    const url =
      base.href.replace(/\/$/, "") +
      "/internal/v2/" +
      (operation === "extract" ? "financial-import" : "financial-" + operation);
    // AbortSignal alone does not raise Node's default 300-second header timeout.
    // Keep this dispatcher private to this call; other HTTP clients stay bounded.
    const timeout = operation === 'prepare' ? 255000 : 615000;
    const dispatcher = new Agent({headersTimeout:timeout,bodyTimeout:timeout});
    try {
      const response = await fetch(url, {
        dispatcher,
        method: "POST",
        redirect: "error",
        // Local OCR includes a cold model load. This remains below the 15-minute job lease.
        signal: AbortSignal.timeout(timeout),
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Key": this.config.internalApiKey,
          'X-AIC-Cache-Scope': cacheScope,
        },
        body: JSON.stringify(body),
      });
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      const reader = response.body?.getReader();
      if (!reader) fail("AI_INVALID_RESPONSE", 502);
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > (operation === "prepare" ? 36_000_000 : 2_000_000)) {
            await reader.cancel();
            fail("AI_RESPONSE_LIMIT", 502);
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!response.ok) {
        const code = data?.error?.code;
        throw new FoundationError(
          response.status >= 500 ? 503 : 422,
          typeof code === "string" && /^[A-Z_]{1,80}$/.test(code)
            ? code
            : "AI_SERVICE_UNAVAILABLE",
          'Financial processing service failed',
          {operation,upstream_status:response.status,
            request_id:/^[0-9a-f-]{36}$/i.test(data?.error?.request_id ?? '') ? data.error.request_id : null,
            validation: Array.isArray(data?.error?.details) ? data.error.details.filter((d:any) =>
              typeof d?.path === 'string' && /^\/(?:model|ocr)(?:\/[A-Za-z0-9_~-]+)*$/.test(d.path) &&
              typeof d?.message === 'string' && /^(?:MALFORMED_JSON|SCHEMA_[A-Za-z]+|MODEL_OUTPUT_(?:BLOCKED|TRUNCATED|EMPTY)|INVALID_MODEL_OUTPUT|PROVIDER_UNAVAILABLE)$/.test(d.message)
            ).slice(0,16) : []},
        );
      }
      if (response.headers.get("X-AI-Mode") !== "live")
        fail("AI_MODE_MISMATCH", 502);
      validateContract(
        operation === "prepare"
          ? "FinancialIntakePrepared"
          : operation === "discovery"
            ? "FinancialIntakeDiscovery"
            : "FinancialImportAiCandidates",
        data,
        true,
      );
      if (
        (operation !== "prepare" && data.sha256 !== body.sha256) ||
        (operation === "prepare" && data.original_sha256 !== body.sha256)
      )
        fail("AI_SOURCE_HASH_MISMATCH", 502);
      return data;
    } finally {
      await dispatcher.destroy();
    }
  }

  private async workerAccess(tx: SqlClient, job: any) {
    return this.core.assertCaseAccess(
      tx,
      {
        id: job.actor_id,
        organization_id: job.organization_id,
        role: "specialist",
        display_name: "",
      },
      job.case_id,
      true,
    );
  }

  async once(workerId = randomUUID()) {
    const job = await this.db.transaction(async (tx) => {
      await tx.query(
        "UPDATE aic.financial_intakes SET state='failed',error_code='PROCESSING_ATTEMPTS_EXHAUSTED',worker_id=NULL,lease_expires_at=NULL WHERE state='running' AND lease_expires_at<clock_timestamp() AND attempts>=3",
      );
      const row = (
        await tx.query(`SELECT * FROM aic.financial_intakes WHERE attempts<3 AND
        (state='queued' OR state='running' AND lease_expires_at<clock_timestamp()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)
      ).rows[0];
      if (!row) return null;
      await tx.query(
        `UPDATE aic.financial_intakes SET state='running',attempts=attempts+1,fence=fence+1,worker_id=$2,
        lease_expires_at=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp() WHERE id=$1`,
        [row.id, workerId],
      );
      return { ...row, fence: Number(row.fence) + 1, worker_id: workerId };
    });
    if (!job) return "idle";
    try {
      await this.db.transaction((tx) => this.workerAccess(tx, job));
      if (sha(job.bytes) !== job.sha256) fail("SOURCE_INTEGRITY_FAILURE", 500);
      const workerCounterparty = await this.db.transaction(async tx=>{
        const current=await this.workerAccess(tx,job);
        const cp=(await tx.query('SELECT country,name,tax_id FROM aic.counterparties WHERE organization_id=$1 AND id=$2',
          [current.organization_id,current.counterparty_id])).rows[0];
        if (!intakeCountryEnabled(this.config,current.organization_id,countryCode(cp.country),new Date().toISOString())) fail('MVP_COUNTRY_NOT_ENABLED');
        return cp;
      });
      const workerCountry = countryCode(workerCounterparty.country);
      if (job.content_type === "application/zip") {
        await this.expand(job);
        return "expanded";
      }
      const prepared = await this.ai("prepare", {
        contract_version: INTAKE_VERSION,
        name: job.name.slice(-255),
        sha256: job.sha256,
        data_base64: job.bytes.toString("base64"),
      });
      const pdf = Buffer.from(prepared.pdf_base64, "base64");
      if (
        sha(pdf) !== prepared.sha256 ||
        pdf.subarray(0, 5).toString() !== "%PDF-"
      )
        fail("AI_SOURCE_HASH_MISMATCH", 502);
      // Persist the readable original before any model work. Discovery failure
      // must not remove the user's route to an explicit, sourced human review.
      const preparedId = await this.savePrepared(job, prepared, pdf);
      if (!preparedId) return "stale";
      job.prepared_source_id = preparedId;
      const discovery = await this.ai("discovery", {
        contract_version: INTAKE_VERSION,
        name: "source.pdf",
        sha256: prepared.sha256,
        data_base64: prepared.pdf_base64,
      }, sha(Buffer.from(job.organization_id)));
      const duplicate = await this.db.transaction(async (tx) => {
        const current = await this.workerAccess(tx, job);
        if (!(await this.owned(tx, job))) return true;
        await tx.query(
          "UPDATE aic.financial_intakes SET classification_json=$2::jsonb,origin_json=origin_json||$3::jsonb,updated_at=clock_timestamp() WHERE id=$1",
          [
            job.id,
            canonicalJson(discovery),
            canonicalJson({
              locations: prepared.locations,
              warnings: prepared.warnings,
            }),
          ],
        );
        return false;
      });
      if (duplicate) return "duplicate";
      if (workerCountry !== 'VN' && discovery.document_type==='financial_statement' &&
          (!discovery.entity_name || !sameFinancialEntity(workerCounterparty.name,discovery.entity_name)))
        fail('FINANCIAL_ENTITY_MISMATCH');
      const outputs = [];
      for (const period of discovery.periods) {
        await this.db.query(
          `UPDATE aic.financial_intakes SET lease_expires_at=clock_timestamp()+interval '15 minutes'
          WHERE id=$1 AND worker_id=$2 AND fence=$3 AND state='running'`,
          [job.id, job.worker_id, job.fence],
        );
        try {
          const receipt = await this.ai("extract", {
            contract_version: "AIC-FINANCIAL-IMPORT-1",
            sha256: prepared.sha256,
            pdf_base64: prepared.pdf_base64,
            operation: "extract",
            pages: period.pages,
            requested_scope: {
              country: workerCountry,
              basis: period.basis,
              end_date: period.end_date,
            },
          }, sha(Buffer.from(job.organization_id)));
          if (
            receipt.scope.country !== workerCountry ||
            (period.start_date && receipt.scope.start_date !== period.start_date) ||
            receipt.scope.period_kind !== period.kind
          )
            fail("FINANCIAL_SCOPE_MISMATCH");
          period.start_date = receipt.scope.start_date;
          outputs.push(receipt);
        } catch (error) {
          if (!(error instanceof FoundationError)) throw error;
          prepared.warnings.push("PERIOD_EXTRACTION_FAILED:" + period.end_date + ':' + (error.getResponse() as any).code);
          const diagnostic = (error.getResponse() as any).details;
          if (diagnostic) {
            prepared.diagnostics ??= [];
            prepared.diagnostics.push({end_date:period.end_date,...diagnostic});
          }
        }
      }
      await this.publish(job, prepared, pdf, discovery, outputs);
      return "processed";
    } catch (error) {
      const code =
        error instanceof FoundationError
          ? (error.getResponse() as any).code
          : "FINANCIAL_PROCESSING_UNAVAILABLE";
      await this.db.query(
        `UPDATE aic.financial_intakes SET state='failed',error_code=$4,origin_json=origin_json||$5::jsonb,worker_id=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
        WHERE id=$1 AND worker_id=$2 AND fence=$3 AND state='running'`,
        [job.id, job.worker_id, job.fence, code,canonicalJson({diagnostics:error instanceof FoundationError && (error.getResponse() as any).details ? [(error.getResponse() as any).details] : []})],
      );
      return "failed";
    }
  }

  private async savePrepared(job: any, prepared: any, pdf: Buffer) {
    return this.db.transaction(async (tx) => {
      const current = await this.workerAccess(tx, job);
      if (!(await this.owned(tx, job))) return null;
      const previous = job.prepared_source_id ? (await tx.query(
        `SELECT id,sha256,page_count FROM aic.financial_import_sources
        WHERE organization_id=$1 AND case_id=$2 AND id=$3`,
        [current.organization_id,current.id,job.prepared_source_id],
      )).rows[0] : null;
      const reuse = previous?.sha256 === prepared.sha256 && previous.page_count === prepared.page_count;
      const id = reuse ? previous.id : randomUUID();
      if (!reuse) await tx.query(
        `INSERT INTO aic.financial_import_sources(id,organization_id,case_id,actor_id,name,sha256,bytes,page_count)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id,current.organization_id,current.id,job.actor_id,job.name.slice(0,240)+'.pdf',
          prepared.sha256,pdf,prepared.page_count],
      );
      const unresolved = {contract_version:INTAKE_VERSION,sha256:prepared.sha256,page_count:prepared.page_count,
        document_type:'unknown',entity_name:null,tax_id:null,periods:[],warnings:[],
        provenance:{model_id:'unresolved',prompt_version:'financial-discovery-v1'}};
      await tx.query(`UPDATE aic.financial_intakes SET prepared_source_id=$2,
        classification_json=CASE WHEN $5 THEN COALESCE(classification_json,$3::jsonb) ELSE $3::jsonb END,
        origin_json=origin_json||$4::jsonb,updated_at=clock_timestamp() WHERE id=$1`,
        [job.id,id,canonicalJson(unresolved),canonicalJson({locations:prepared.locations,warnings:prepared.warnings}),reuse]);
      if (!reuse) await this.workerAudit(tx,current,job,'financial.intake_prepared',{source_id:id});
      return id as string;
    });
  }

  private async owned(tx: SqlClient, job: any) {
    return (
      await tx.query(
        `SELECT id FROM aic.financial_intakes WHERE id=$1 AND worker_id=$2 AND fence=$3
      AND state='running' AND lease_expires_at>clock_timestamp() FOR UPDATE`,
        [job.id, job.worker_id, job.fence],
      )
    ).rows[0];
  }

  private async matchingSets(tx: SqlClient, current: any, periods: any[]) {
    const sets = (
      await tx.query(
        `SELECT DISTINCT ON(id) id,revision,scope_json FROM aic.mvp_financial_sets
      WHERE organization_id=$1 AND case_id=$2 ORDER BY id,revision DESC`,
        [current.organization_id, current.id],
      )
    ).rows;
    const matches = sets
      .filter((s) =>
        periods.some(
          (p) =>
            s.scope_json.period.end_date === p.end_date &&
            s.scope_json.period.kind === p.kind && (!p.start_date || s.scope_json.period.start_date === p.start_date) &&
            s.scope_json.basis === p.basis,
        ),
      )
      .map((s) => ({
        set_id: s.id,
        revision: Number(s.revision),
        kind: s.scope_json.period.kind,
        start_date: s.scope_json.period.start_date,
        end_date: s.scope_json.period.end_date,
        basis: s.scope_json.basis,
      }));
    const sources=(await tx.query(`SELECT id,name,prepared_source_id,classification_json FROM aic.financial_intakes
      WHERE organization_id=$1 AND case_id=$2`,[current.organization_id,current.id])).rows;
    for (const match of matches) {
      const facts=(await tx.query(`SELECT payload_json FROM aic.mvp_financial_facts
        WHERE organization_id=$1 AND case_id=$2 AND set_id=$3 AND set_revision=$4 ORDER BY fact_key`,
        [current.organization_id,current.id,match.set_id,match.revision])).rows.map(f=>f.payload_json);
      const names=[...new Set(facts.map(f=>sources.find(s=>s.prepared_source_id===f.source.source_id)?.name).filter(Boolean))];
      const source=sources.find(s=>facts.some(f=>f.source.source_id===s.prepared_source_id));
      Object.assign(match,{source_names:names,role:this.periodRole(source?.classification_json?.periods ?? [],match)});
    }
    return matches;
  }
  private async duplicateSets(tx: SqlClient, job: any, sets: any[]) {
    await tx.query(
      `UPDATE aic.financial_intakes SET state='duplicate',origin_json=origin_json||$2::jsonb,
      worker_id=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1`,
      [job.id, canonicalJson({ duplicate_sets: sets })],
    );
  }

  private async expand(job: any) {
    const entries = await readZipArchive(job.bytes, "financial");
    return this.db.transaction(async (tx) => {
      const current = await this.workerAccess(tx, job);
      if (!(await this.owned(tx, job))) return;
      const usage = (
        await tx.query(
          "SELECT count(*)::int AS n,COALESCE(sum(octet_length(bytes)),0)::bigint AS bytes FROM aic.financial_intakes WHERE organization_id=$1 AND case_id=$2",
          [current.organization_id, current.id],
        )
      ).rows[0];
      if (
        usage.n + entries.length > 256 ||
        Number(usage.bytes) +
          entries.reduce(
            (sum, e) => sum + (e.rejection_code ? 0 : e.byte_size),
            0,
          ) >
          300_000_000
      )
        fail("FINANCIAL_SOURCE_CASE_LIMIT", 409);
      for (const entry of entries) {
        // Rejected entries remain in the archive manifest; no fabricated source bytes.
        if (!entry.data || entry.rejection_code) continue;
        const bytes = Buffer.from(entry.data, "base64");
        if (sha(bytes) !== entry.sha256) fail("SOURCE_INTEGRITY_FAILURE", 500);
        const duplicate = (
          await tx.query(
            `SELECT id FROM aic.financial_intakes WHERE organization_id=$1 AND case_id=$2 AND sha256=$3
          AND state IN ('queued','running','ready','needs_review') AND superseded_by IS NULL ORDER BY created_at LIMIT 1`,
            [current.organization_id, current.id, entry.sha256],
          )
        ).rows[0];
        await tx.query(
          `INSERT INTO aic.financial_intakes(id,organization_id,case_id,actor_id,parent_id,name,sha256,bytes,content_type,state,duplicate_of)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            randomUUID(),
            current.organization_id,
            current.id,
            job.actor_id,
            job.id,
            entry.entry_path,
            entry.sha256,
            bytes,
            MIME[extname(entry.entry_path).toLowerCase()],
            duplicate ? "duplicate" : "queued",
            duplicate?.id ?? null,
          ],
        );
      }
      await tx.query(
        `UPDATE aic.financial_intakes SET state='expanded',origin_json=$2::jsonb,worker_id=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1`,
        [
          job.id,
          canonicalJson({
            rejected: entries
              .filter((e) => e.rejection_code)
              .map((e) => ({ name: e.entry_path, code: e.rejection_code })),
            discovered: entries.length,
          }),
        ],
      );
      await this.workerAudit(tx, current, job, "financial.archive_expanded", {
        discovered: entries.length,
      });
    });
  }

  private async workerAudit(
    tx: SqlClient,
    current: any,
    job: any,
    action: string,
    metadata: any,
  ) {
    const next = Number(current.revision) + 1;
    await tx.query(
      "UPDATE aic.cases SET revision=$3,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",
      [current.organization_id, current.id, next],
    );
    await tx.query(
      `INSERT INTO aic.audit_events(id,organization_id,case_id,actor_type,actor_id,action,subject_id,revision_before,revision_after,metadata_json)
      VALUES($1,$2,$3,'operator',$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        randomUUID(),
        current.organization_id,
        current.id,
        null,
        action,
        job.id,
        Number(current.revision),
        next,
        canonicalJson({...metadata,initiated_by:job.actor_id,worker_authority:{worker_id:job.worker_id,fence:job.fence}}),
      ],
    );
    return next;
  }

  /** Append a version for one explicitly selected period; never retire a whole source file. */
  private async writeStatement(tx: SqlClient, current: any, job: any, cp: any, receipt: any, next: number, prior?: any) {
    const s=receipt.scope, preparedId=receipt.source.id, receiptId=receipt.receipt_id;
    if (s.country !== countryCode(cp.country)) fail('FINANCIAL_COUNTRY_MISMATCH');
    if (s.country!=='VN' && !accountingProfile({...s,pilot_scope:cp.industry_code}))
      fail('ACCOUNTING_PROFILE_NOT_SUPPORTED');
        const setId = prior?.set_id ?? randomUUID(),
          setRevision = prior
            ? Number(
                (
                  await tx.query(
                    "SELECT max(revision)::int AS n FROM aic.mvp_financial_sets WHERE organization_id=$1 AND case_id=$2 AND id=$3",
                    [current.organization_id,current.id,setId],
                  )
                ).rows[0].n,
              ) + 1
            : 1;
        const period = {
          kind: s.period_kind,
          start_date: s.start_date,
          end_date: s.end_date,
        };
        const scope = {
          entity_id: current.counterparty_id,
          country: countryCode(cp.country),
          industry: cp.industry_code ?? "UNKNOWN",
          pilot_scope: cp.industry_code ?? "UNKNOWN",
          period,
          basis: s.basis,
          accounting_regime: s.accounting_regime,
          currency: s.currency,
          unit_multiplier: s.unit_multiplier,
        };
        const roundingEvidence = (receipt.scope_evidence ?? []).filter((e:any)=>/round(?:ed|ing)\s+to\s+(?:the\s+)?nearest|四舍五入/i.test(e.quote));
        const quantums:Record<string,string> = {};
        if (accountingProfile(scope) && roundingEvidence.length) for (const key of ['total_assets','total_liabilities','total_equity']) {
          const fact=receipt.facts.find((f:any)=>f.key===key);
          const quantum=fact && sourceRoundingQuantum(fact.raw_token,roundingEvidence.map((e:any)=>e.quote).join(' '),s.unit_multiplier);
          if (quantum) quantums[key]=quantum;
        }
        await tx.query(
          `INSERT INTO aic.mvp_financial_sets(id,revision,organization_id,case_id,scope_json,metadata_json,bridges_json,case_revision,actor_id,reason)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,'{}'::jsonb,$7,$8,$9)`,
          [
            setId,
            setRevision,
            current.organization_id,
            current.id,
            canonicalJson(scope),
            canonicalJson({
              audit_status: "unknown",
              statement_version: "intake:" + job.id,
              observation_kind: "actual",
              ...(accountingProfile(scope) ? {accounting_profile:accountingProfile(scope)} : {}),
              ...(Object.keys(quantums).length===3 ? {source_rounding:{quantums,evidence:roundingEvidence}} : {}),
              ...((receipt.calculations?.length || receipt.reasoning) ? {calculations:calculationMetadata(receipt)} : {}),
              ...(receipt.reasoning ? {reasoning:reasoningSummary(receipt)} : {}),
            }),
            next,
            job.actor_id,
            "Automatic extraction; human confirmation pending",
          ],
        );
        for (const fact of receipt.facts) {
          const payload = {
            key: fact.key,
            raw_value: fact.value,
            raw_label: fact.label,
            missing_reason: null,
            source: {
              kind: "financial_import",
              receipt_id: receiptId,
              fact_key: fact.key,
              source_kind: "financial_file",
              source_id: preparedId,
              source_hash: receipt.sha256,
              page: fact.page,
              quote: fact.quote,
            },
            normalized_decimal: Decimal.parse(fact.value)
              .mul(Decimal.parse(s.unit_multiplier))
              .toString(),
            currency: s.currency,
            unit_multiplier: s.unit_multiplier,
            period,
            basis: s.basis,
            adjustments: [
              {
                kind: "unit_normalization",
                multiplier: s.unit_multiplier,
                result: Decimal.parse(fact.value)
                  .mul(Decimal.parse(s.unit_multiplier))
                  .toString(),
              },
            ],
            source_origin: "document",
            entered_by: job.actor_id,
            recorded_case_revision: next,
          };
          await tx.query(
            "INSERT INTO aic.mvp_financial_facts(id,revision,organization_id,case_id,set_id,set_revision,fact_key,payload_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
            [
              randomUUID(),
              setRevision,
              current.organization_id,
              current.id,
              setId,
              setRevision,
              fact.key,
              canonicalJson(payload),
            ],
          );
        }
        return {
          receipt_id: receiptId,
          set_id: setId,
          kind: s.period_kind,
          start_date: s.start_date,
          end_date: s.end_date,
          basis: s.basis,
          fact_count: receipt.facts.length,
          missing_keys: receipt.missing_keys,
        };
  }

  private async publish(
    job: any,
    prepared: any,
    pdf: Buffer,
    discovery: any,
    outputs: any[],
  ) {
    return this.db.transaction(async (tx) => {
      const current = await this.workerAccess(tx, job);
      if (!(await this.owned(tx, job))) return;
      const cp = (
        await tx.query(
          "SELECT country,name,industry_code,revision FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE",
          [current.organization_id, current.counterparty_id],
        )
      ).rows[0];
      if (!intakeCountryEnabled(this.config,current.organization_id,countryCode(cp.country),new Date().toISOString())) fail("MVP_COUNTRY_NOT_ENABLED");
      if (countryCode(cp.country)!=='VN' && discovery.document_type==='financial_statement' &&
          !sameFinancialEntity(cp.name,discovery.entity_name)) fail('FINANCIAL_ENTITY_MISMATCH');
      const preparedId = job.prepared_source_id;
      if (!preparedId) fail('FINANCIAL_PREPARED_SOURCE_REQUIRED',500);
      const next = Number(current.revision) + 1,
        statements: any[] = [], candidates: any[] = [];
      const original = job.replacement_of
          ? ((
              await tx.query(
                "SELECT result_json FROM aic.financial_intakes WHERE id=$1",
                [job.replacement_of],
              )
            ).rows[0]?.result_json ?? [])
          : job.origin_json.replaces_existing_sets
            ? job.origin_json.duplicate_sets
            : [];
      const previous = [...(job.result_json ?? []), ...original];
      // A replacement is published as a complete set of periods. Failed periods
      // must never leave half of the predecessor replaced or create new set IDs on retry.
      const replacing = !!job.replacement_of || !!job.origin_json.replaces_existing_sets || !!job.result_json.length;
      const partialReplacement = replacing && (!discovery.periods.length ||
        outputs.length !== discovery.periods.length || outputs.some(o => o.document_type !== 'financial_statement'));
      if (partialReplacement && job.result_json.length) statements.push(...job.result_json);
      for (const output of partialReplacement ? [] : outputs) {
        if (output.document_type !== 'financial_statement') continue;
        const receiptId = randomUUID(),
          s = output.scope,
          source = {
            id: preparedId,
            kind: "financial_file",
            name: job.name,
            sha256: prepared.sha256,
            page_count: prepared.page_count,
          };
        const receipt = {
          ...output,
          receipt_id: receiptId,
          source,
          counterparty_revision: Number(cp.revision),
          initiated_by:job.actor_id,
          worker_authority:{worker_id:job.worker_id,fence:job.fence},
        };
        await tx.query(
          `INSERT INTO aic.audit_events(id,organization_id,case_id,actor_type,actor_id,action,subject_id,revision_before,revision_after,metadata_json)
          VALUES($1,$2,$3,'operator',$4,'financial.import_extracted',$5,$6,$7,$8::jsonb)`,
          [
            randomUUID(),
            current.organization_id,
            current.id,
            null,
            receiptId,
            Number(current.revision),
            next,
            canonicalJson(receipt),
          ],
        );
        await persistReasoning(tx,current,receipt);
        let prior: any;
        for (const option of previous.filter((p:any)=>p.end_date === s.end_date && p.basis === s.basis)) {
          const stored=(await tx.query(`SELECT scope_json FROM aic.mvp_financial_sets
            WHERE organization_id=$1 AND case_id=$2 AND id=$3 ORDER BY revision DESC LIMIT 1`,
            [current.organization_id,current.id,option.set_id])).rows[0];
          if (stored?.scope_json.period.kind===s.period_kind && stored.scope_json.period.start_date===s.start_date) {
            prior=option; break;
          }
        }
        const period = {kind:s.period_kind,start_date:s.start_date,end_date:s.end_date,basis:s.basis};
        const kept = (job.origin_json.period_candidates ?? []).find((c:any) => c.status === 'kept' &&
          c.period.kind === period.kind && c.period.start_date === period.start_date &&
          c.period.end_date === period.end_date && c.basis === period.basis);
        if (kept) { candidates.push(kept); continue; }
        const conflicts = prior ? [] : await this.matchingSets(tx,current,[period]);
        if (conflicts.length) {
          let identical = false;
          if (conflicts.length === 1) {
            const target = conflicts[0];
            const stored = (await tx.query(`SELECT scope_json FROM aic.mvp_financial_sets
              WHERE organization_id=$1 AND case_id=$2 AND id=$3 AND revision=$4`,
              [current.organization_id,current.id,target.set_id,target.revision])).rows[0];
            const facts = (await tx.query(`SELECT payload_json FROM aic.mvp_financial_facts
              WHERE organization_id=$1 AND case_id=$2 AND set_id=$3 AND set_revision=$4`,
              [current.organization_id,current.id,target.set_id,target.revision])).rows.map(f => f.payload_json);
            identical = !!stored && identicalPeriodFigures(stored.scope_json, facts, output);
          }
          candidates.push({receipt_id:receiptId,period:{kind:period.kind,start_date:period.start_date,end_date:period.end_date},
            basis:s.basis,currency:s.currency,unit_multiplier:s.unit_multiplier,
            role:this.periodRole(discovery.periods,period),status:identical ? 'kept' : 'pending',
            ...(identical ? {selected_set_id:conflicts[0].set_id,selected_set_revision:conflicts[0].revision} : {}),
            existing_sets:conflicts,facts:output.facts.map((f:any)=>({key:f.key,value:f.value,label:f.label,page:f.page,quote:f.quote}))});
        } else statements.push(await this.writeStatement(tx,current,job,cp,receipt,next,prior));
      }
      const incomplete =
        candidates.some((c:any)=>c.status === 'pending') ||
        statements.length + candidates.filter((c:any)=>c.status === 'kept').length < discovery.periods.length ||
        discovery.warnings.length > 0 || prepared.warnings.length > 0 ||
        outputs.some(o => !o.facts.length || o.missing_keys.length || o.rejected.length || o.ocr_failures.length);
      const resolvedCount = statements.length + candidates.filter((c:any) => c.status === 'kept').length;
      const state = discovery.document_type === 'other' ? 'skipped' : resolvedCount && !incomplete ? "ready" : "needs_review";
      if (job.replacement_of && !partialReplacement && statements.length === discovery.periods.length &&
        original.every((s:any)=>statements.some(t=>t.set_id===s.set_id)))
        await tx.query(
          "UPDATE aic.financial_intakes SET superseded_by=$2 WHERE id=$1",
          [job.replacement_of, job.id],
        );
      await tx.query(
        `UPDATE aic.financial_intakes SET state=$2,prepared_source_id=$3,classification_json=$4::jsonb,result_json=$5::jsonb,
        origin_json=$6::jsonb,error_code=$7,worker_id=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1`,
        [
          job.id,
          state,
          preparedId,
          canonicalJson(discovery),
          canonicalJson(statements),
          canonicalJson({
            ...job.origin_json,
            period_candidates: partialReplacement ? (job.origin_json.period_candidates ?? []) : candidates,
            locations: prepared.locations,
            warnings: prepared.warnings,
            diagnostics: prepared.diagnostics ?? [],
          }),
          state === "ready"
            ? null
            : discovery.document_type === "financial_statement"
              ? partialReplacement ? 'FINANCIAL_REPLACEMENT_INCOMPLETE' : candidates.some((c:any)=>c.status === 'pending') ? 'FINANCIAL_PERIOD_SOURCE_SELECTION_REQUIRED' : "FINANCIAL_PERIOD_OR_FIELDS_UNRESOLVED"
              : discovery.document_type === 'other' ? "NOT_FINANCIAL_STATEMENT" : 'DOCUMENT_TYPE_UNRESOLVED',
        ],
      );
      await this.workerAudit(tx, current, job, "financial.intake_processed", {
        state,
        statements: statements.length,
      });
    });
  }
}
