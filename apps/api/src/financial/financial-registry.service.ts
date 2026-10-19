import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CaseMutations } from "../foundation/case-mutations";
import { canonicalJson, requestHash } from "../foundation/canonical";
import { CoreRepository, requireUuid } from "../foundation/core.repository";
import { FoundationError, notFound } from "../foundation/errors";
import { FOUNDATION_CONFIG, FOUNDATION_DB } from "../foundation/ports";
import type {
  AuthSession,
  FoundationConfig,
  FoundationDatabase,
  SqlClient,
} from "../foundation/ports";
import { validateContract } from "../foundation/validation";
import { projectLegacyExtraction } from "../documents/evidence-projection";
import { Decimal } from "./decimal";
import { calculationFact, calculationMetadata } from './financial-calculations';
import { reasoningSummary, reasoningCalculations } from './financial-reasoning';
import { countryCode, importReceipt, importSource, validImportedSource, currentFinancialFile } from './financial-import-source';
import { scoreFhi } from "./fhi-scorer";
import type {
  FhiInput,
  FhiFinancialFact,
  FhiScope,
  FhiEngineResult,
} from "./fhi-scorer";
import { FHI_METRICS } from "./fhi-method";
import { activeFhiPolicy } from "./fhi-policy";
import { accountingProfile, internationalPolicy, INTERNATIONAL_CASH_KEY } from './accounting-profiles';
import { aggregateCaseAssessment, CASE_AGGREGATION_METHOD, type CaseAggregation } from './case-assessment';
import { reviewIntakePeriod } from './financial-intake-review';
import {
  financialComparisonIssues,
  standaloneTrendEligible,
  verifiedTrendFacts,
} from "./financial-trends";

const fail = (code: string, status = 422): never => {
  throw new FoundationError(status, code);
};
const iso = (value: Date | string) => new Date(value).toISOString();
@Injectable()
export class FinancialRegistry {
  constructor(
    @Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) private readonly config: FoundationConfig,
    private readonly core: CoreRepository,
    private readonly mutations: CaseMutations,
  ) {}
  private input(name: string, body: unknown): any {
    const input = JSON.parse(canonicalJson(body));
    validateContract(name, input);
    return input;
  }
  async trends(session: AuthSession, caseId: string, baselineId?: string) {
    requireUuid(caseId);
    if (baselineId) requireUuid(baselineId);
    return this.db.transaction(async (tx) => {
      const current = await this.access(tx, session, caseId);
      const initial = await this.evaluateTx(tx, current, baselineId);
      const sets = [...initial.registry.sets].sort(
        (a, b) =>
          a.scope.period.end_date.localeCompare(b.scope.period.end_date) ||
          a.id.localeCompare(b.id),
      );
      const baseline = sets.find((s) => s.id === baselineId) ?? sets.at(-1);
      const rows = [];
      for (const set of sets) {
        const comparison_issues = financialComparisonIssues(
          set,
          baseline,
          sets,
        );
        const registry = (await this.evaluateTx(tx, current, set.id)).registry;
        const visible = current.purpose === 'company_health'
          ? standaloneTrendEligible(set, sets) : comparison_issues.length === 0;
        const previous = rows.at(-1)?.set;
        rows.push({
          set,
          ...(current.purpose === 'company_health' && visible ? { standalone_values: true } : {}),
          comparison_issues,
          gap_before:
            !!previous &&
            Number(set.scope.period.end_date.slice(0, 4)) -
              Number(previous.scope.period.end_date.slice(0, 4)) >
              1,
          facts: visible ? verifiedTrendFacts(set) : [],
          metrics: visible ? registry.metrics : [],
        });
      }
      return this.output("FinancialTrendsV1", {
        contract_version: "AIC-FINANCIAL-TRENDS-1",
        case_revision: Number(current.revision),
        captured_at: new Date().toISOString(),
        baseline_set_id: baseline?.id ?? null,
        baseline_metrics: initial.registry.metrics,
        rows,
      });
    });
  }
  private output(name: string, body: any): any {
    validateContract(name, body, true);
    return body;
  }
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
    return current;
  }
  private async source(
    tx: SqlClient,
    current: any,
    input: any,
    reviewed: boolean,
  ): Promise<boolean> {
    if (input.kind === "manual_entry") return true;
    if (input.kind === 'calculated') {
      try {
        const receipt=await importReceipt(tx,current,input.receipt_id), file=await importSource(tx,current,input.source_kind,input.source_id);
        return current.purpose === 'company_health' && receipt.document_type === 'financial_statement' &&
          (await currentFinancialFile(tx,current,file.id)) && file.sha256 === input.source_hash && receipt.sha256 === file.sha256 &&
          receipt.source.id === file.id && receipt.source.kind === file.kind && !!calculationFact(receipt,input);
      } catch(error) { if(error instanceof FoundationError && error.getStatus() === 404)return false;throw error; }
    }
    if (input.kind === 'statement_entry') {
      try {
        const receipt=await importReceipt(tx,current,input.receipt_id),file=await importSource(tx,current,input.source_kind,input.source_id);
        return receipt.document_type==='financial_statement' && (await currentFinancialFile(tx,current,file.id)) && receipt.source.id===file.id && receipt.source.kind===input.source_kind &&
          receipt.sha256===input.source_hash && file.sha256===input.source_hash && input.page>=1 && input.page<=file.page_count &&
          !!input.quote.trim() && !!input.reason.trim();
      } catch(error) {if(error instanceof FoundationError && error.getStatus()===404)return false;throw error}
    }
    if (input.kind === 'financial_import') return validImportedSource(tx, current, input, reviewed);
    if (current.purpose === 'company_health') return false;
    const doc = (
      await tx.query(
        `SELECT d.*,r.raw_extraction AS extraction,(l.current_document_id=d.id) AS active FROM aic.mvp_documents d
      JOIN aic.mvp_document_lineages l ON l.organization_id=d.organization_id AND l.case_id=d.case_id AND l.id=d.lineage
      LEFT JOIN aic.mvp_document_results r ON r.organization_id=d.organization_id AND r.case_id=d.case_id AND r.document_id=d.id AND r.outcome='published'
      WHERE d.organization_id=$1 AND d.case_id=$2 AND d.id=$3 AND d.version=$4 AND d.hash=$5`,
        [
          current.organization_id,
          current.id,
          input.document_id,
          input.document_version,
          input.source_hash,
        ],
      )
    ).rows[0];
    if (!doc?.extraction || !doc.active) return false;
    let projection;
    try {
      projection = projectLegacyExtraction(doc, doc.extraction);
    } catch {
      return false;
    }
    if (
      !projection.evidence.some(
        (e) =>
          e.id === input.evidence_ref &&
          e.page === input.page &&
          e.quote === input.quote,
      )
    )
      return false;
    if (!reviewed) return true;
    const human = (
      await tx.query(
        "SELECT payload_json FROM aic.mvp_document_decisions WHERE organization_id=$1 AND case_id=$2 AND document_id=$3 AND kind='classification' ORDER BY case_revision DESC LIMIT 1",
        [current.organization_id, current.id, doc.id],
      )
    ).rows[0]?.payload_json;
    const cp = (
      await tx.query(
        "SELECT revision FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE",
        [current.organization_id, current.counterparty_id],
      )
    ).rows[0];
    return (
      human?.subject_match === "match" &&
      human.reviewed_pages.includes(input.page) &&
      Number(human.counterparty_revision) === Number(cp.revision)
    );
  }
  private async snapshot(tx: SqlClient, current: any, facts: any[]) {
    const cp = (
      await tx.query(
        "SELECT revision,identity_status FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE",
        [current.organization_id, current.counterparty_id],
      )
    ).rows[0];
    const decisions = (
      await tx.query(
        "SELECT id,payload_json FROM aic.mvp_document_decisions WHERE organization_id=$1 AND case_id=$2 ORDER BY case_revision",
        [current.organization_id, current.id],
      )
    ).rows;
    const docs = (
      await tx.query(
        "SELECT id,current_document_id FROM aic.mvp_document_lineages WHERE organization_id=$1 AND case_id=$2 ORDER BY id",
        [current.organization_id, current.id],
      )
    ).rows;
    return requestHash({
      counterparty: cp,
      exposure: current.exposure_json,
      docs,
      decisions,
      facts: facts.map((f) => ({
        id: f.id,
        revision: Number(f.revision),
        payload: f.payload_json,
      })),
    });
  }
  private async setTx(tx: SqlClient, current: any, row: any) {
    const facts = (
      await tx.query(
        "SELECT * FROM aic.mvp_financial_facts WHERE organization_id=$1 AND case_id=$2 AND set_id=$3 AND set_revision=$4 ORDER BY fact_key",
        [current.organization_id, current.id, row.id, row.revision],
      )
    ).rows;
    const hash = await this.snapshot(tx, current, facts);
    const decisions = (
      await tx.query(
        "SELECT * FROM aic.mvp_financial_verifications WHERE organization_id=$1 AND case_id=$2 AND set_id=$3 AND set_revision=$4 ORDER BY case_revision",
        [current.organization_id, current.id, row.id, row.revision],
      )
    ).rows;
    let stale = false;
    const output = [];
    for (const fact of facts) {
      const decision = decisions
          .filter((d) => d.fact_ids.includes(fact.id))
          .at(-1),
        currentSource = await this.source(
          tx,
          current,
          fact.payload_json.source,
          false,
        );
      const isStale =
        !!decision &&
        (decision.source_snapshot_hash !== hash || !currentSource);
      stale ||= isStale;
      output.push({
        ...fact.payload_json,
        id: fact.id,
        revision: Number(fact.revision),
        current_source: currentSource,
        verification: {
          status: !decision
            ? "unverified"
            : isStale
              ? "stale"
              : decision.status,
          verified_revision: decision ? Number(fact.revision) : null,
          verified_by: decision?.actor_id ?? null,
          verified_at: decision ? iso(decision.created_at) : null,
        },
        ...(decision ? { verification_reason: decision.reason } : {}),
      });
    }
    const metadata = structuredClone(row.metadata_json);
    // Refresh explanatory diagnostics for old snapshots without rewriting their
    // sealed graph, calculation result, source facts or published assessments.
    const receiptIds = [...new Set<string>((metadata.calculations ?? [])
      .filter((c:any)=>c.blocked_reason && c.reasoning_version).map((c:any)=>c.receipt_id))];
    for (const receiptId of receiptIds) {
      try {
        const diagnostics=reasoningCalculations(await importReceipt(tx,current,receiptId));
        for (const calculation of metadata.calculations) {
          const updated=diagnostics.find((d:any)=>d.id===calculation.id && d.key===calculation.key);
          if (calculation.receipt_id===receiptId && calculation.blocked_reason && updated?.blocked_details) {
            calculation.blocked_details=updated.blocked_details;
            calculation.reason=updated.reason;
          }
        }
      } catch (error) { if (!(error instanceof FoundationError && error.getStatus()===404)) throw error; }
    }
    return {
      read: this.output("FinancialSetRead", {
        id: row.id,
        revision: Number(row.revision),
        scope: row.scope_json,
        metadata,
        facts: output,
        created_at: iso(row.created_at),
        verification_stale: stale,
      }),
      decisions,
      hash,
    };
  }
  async get(session: AuthSession, caseId: string, setId?: string) {
    requireUuid(caseId);
    if (setId !== undefined) requireUuid(setId);
    return this.db.transaction(async (tx) => {
      const current = await this.access(tx, session, caseId);
      return this.detailTx(tx, current, setId);
    });
  }
  async detailTx(tx: SqlClient, current: any, setId?: string) {
    return (await this.evaluateTx(tx, current, setId)).registry;
  }
  /** Internal exact calculation for publication; the ordinary registry remains score-free. */
  async evaluateTx(tx: SqlClient, current: any, setId?: string, caseWide = false) {
    const rows = (
      await tx.query(
        "SELECT DISTINCT ON(id) * FROM aic.mvp_financial_sets WHERE organization_id=$1 AND case_id=$2 ORDER BY id,revision DESC",
        [current.organization_id, current.id],
      )
    ).rows;
    const sets = [];
    const prepared = [];
    for (const row of rows) {
      const value = await this.setTx(tx, current, row);
      sets.push(value.read);
      prepared.push(value);
    }
    const now = iso(
      (await tx.query("SELECT clock_timestamp() AS at")).rows[0].at,
    );
    const ownerCountry = countryCode((await tx.query('SELECT country FROM aic.counterparties WHERE organization_id=$1 AND id=$2',
      [current.organization_id,current.counterparty_id])).rows[0]?.country ?? 'UNKNOWN');
    const policy = ownerCountry === 'VN' ? activeFhiPolicy(
      this.config.fhiPolicy,
      current.organization_id,
      now,
    ) : current.purpose === 'company_health' ? internationalPolicy(this.config,current.organization_id,now,ownerCountry) : null;
    const blockers: string[] = policy ? [] : ["FHI_METHOD_UNCONFIGURED"];
    let engine: FhiEngineResult | null = null;
    let metrics: any[] = [];
    const latestDate = sets.map(s => s.scope.period.end_date).sort().at(-1);
    const newest = sets.filter(s => s.scope.period.end_date === latestDate);
    // A latest year is automatic; different bases for that year require a choice.
    let selected = setId === undefined
      ? newest.length === 1 ? sets.indexOf(newest[0]) : -1
      : sets.findIndex((s) => s.id === setId);
    if (setId !== undefined && selected === -1) throw notFound();
    const evaluateSet = async (index: number) => {
      const blockers: string[] = [];
      const set = sets[index],
        facts: FhiFinancialFact[] = set.facts.map((f: any) => ({
          id: f.id,
          revision: f.revision,
          key: f.key,
          statement_set_id: set.id,
          statement_set_revision: set.revision,
          scope: { ...set.scope, unit_multiplier: "1" },
          value: f.normalized_decimal,
          verification: f.verification,
          current_source: f.current_source,
          source_refs: [
            f.source.kind === "document"
              ? {
                  kind: "document",
                  document_id: f.source.document_id,
                  document_version: f.source.document_version,
                  source_hash: f.source.source_hash,
                  page: f.source.page,
                  quote: f.source.quote,
                }
              : {
                  kind: "verified_entry",
                  entry_id: f.id,
                  entry_revision: f.revision,
                },
          ],
        }));
      if (current.purpose === 'company_health') {
        const cp = (await tx.query('SELECT country,industry_code FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE',
          [current.organization_id,current.counterparty_id])).rows[0];
        if (set.scope.industry !== (cp.industry_code ?? 'UNKNOWN') || countryCode(set.scope.country) !== countryCode(cp.country))
          blockers.push('INVALID_SCOPE');
      }
      const profile = accountingProfile(set.scope);
      if (countryCode(set.scope.country) !== 'VN' && (!profile || !policy ||
          !('profiles' in policy) || !policy.profiles.some(p=>p.profile_id===profile.id)))
        blockers.push('COUNTRY_METHOD_NOT_VALIDATED');
      const latest = prepared[index].decisions.at(-1);
      const verifiedBridge = (
        keys: string[],
        kind: "quick_assets" | "ebitda",
      ) => {
        if (
          !latest ||
          latest.status !== "verified" ||
          latest.source_snapshot_hash !== prepared[index].hash ||
          !keys.every((k) =>
            set.facts.some(
              (f: any) =>
                f.key === k &&
                f.verification.status === "verified" &&
                latest.fact_ids.includes(f.id),
            ),
          )
        )
          return null;
        const components = facts.filter((f) => keys.includes(f.key));
        return {
          id: latest.id,
          revision: Number(latest.case_revision),
          statement_set_id: set.id,
          statement_set_revision: set.revision,
          verification: {
            status: "verified" as const,
            verified_revision: Number(latest.case_revision),
            verified_by: latest.actor_id,
            verified_at: iso(latest.created_at),
          },
          current_source: true,
          source_refs: components.flatMap((f) => f.source_refs),
          components: components.map((f) => ({
            key: f.key,
            fact_id: f.id,
            fact_revision: f.revision,
          })),
          non_overlapping:
            kind === "quick_assets"
              ? latest.bridge_assertions.quick_assets_non_overlapping
              : true,
        };
      };
      const quick = verifiedBridge(
          profile && facts.some(f=>f.key===INTERNATIONAL_CASH_KEY && f.value!==null)
            ? [INTERNATIONAL_CASH_KEY,'trade_receivables']
            : ["cash", "unrestricted_short_term_equivalents", "trade_receivables"],
          "quick_assets",
        ),
        ebitda = verifiedBridge(
          ["operating_profit", "depreciation_amortization"],
          "ebitda",
        );
      const input: FhiInput = {
        ...(profile ? {accounting_profile:profile} : {}),
        ...(profile && latest?.bridge_assertions.expense_presentation_sign_reviewed===true ? {
          reviewed_expense_magnitude_fact_ids:set.facts.filter((f:any)=>f.key==='interest_expense' &&
            /interest expense|利息费用|利息支出/i.test(f.raw_label) && !/\bnet\b|\bpaid\b|recovery|reversal|净|支付|冲回/i.test(f.raw_label)).map((f:any)=>f.id),
        } : {}),
        ...(profile && latest?.bridge_assertions.source_rounding_reviewed===true && set.metadata.source_rounding
          ? {rounding_quantums:set.metadata.source_rounding.quantums} : {}),
        ...(profile?.country==='CN' ? {international_operating_profit_reconciled:
          set.facts.some((f:any)=>f.key==='operating_profit' && /(?<!营业)经营利润/.test(f.raw_label)) ||
          (latest?.bridge_assertions.international_operating_profit_reconciled===true &&
            set.facts.some((f:any)=>f.key==='operating_profit' && f.source.kind==='calculated'))} : {}),
        statement_set: {
          id: set.id,
          revision: set.revision,
          scope: { ...set.scope, unit_multiplier: "1" },
        },
        facts,
        quick_assets_bridge: quick
          ? {
              ...quick,
              kind: "quick_assets",
              acceptable_per_source:
                latest.bridge_assertions.quick_assets_eligible,
            }
          : null,
        ebitda_bridge: ebitda
          ? {
              ...ebitda,
              kind: "ebitda",
              da_is_addback_to_ebit:
                latest.bridge_assertions.da_addback_to_operating_profit,
            }
          : null,
      };
      const engine = scoreFhi(input);
      if (
        set.metadata.observation_kind !== "actual" ||
        set.scope.accounting_regime === "UNKNOWN"
      )
        blockers.push("ACTUAL_KNOWN_ACCOUNTING_BASIS_REQUIRED");
      blockers.push(...engine.blockers.map((b) => b.code));
      return { set, engine, blockers };
    };
    let aggregation: CaseAggregation | null = null;
    let periodEngines: Awaited<ReturnType<typeof evaluateSet>>[] = [];
    if (caseWide && current.purpose === 'company_health') {
      for (let index = 0; index < sets.length; index++) periodEngines.push(await evaluateSet(index));
      const bases=[...new Set(sets.map(s=>s.scope.basis))];
      const requestedBasis = prepared.map(p=>p.decisions.at(-1)?.bridge_assertions.assessment_basis).find(Boolean);
      const combined = aggregateCaseAssessment(periodEngines,ownerCountry!=='VN' && bases.length>1 ? requestedBasis : undefined);
      engine = combined.engine;
      aggregation = combined.summary;
      blockers.push(...combined.blockers);
      selected = -1;
    } else if (selected !== -1) {
      const record = await evaluateSet(selected);
      engine = record.engine;
      blockers.push(...record.blockers);
    } else blockers.push(sets.length ? 'EXPLICIT_STATEMENT_SET_SELECTION_REQUIRED' : 'FINANCIAL_INPUTS_REQUIRED');
    if (engine) metrics = engine.metrics.map((m) => ({
        metric_id: m.metric_id,
        group: m.group,
        formula_id: m.formula_id,
        formula: m.formula,
        status: m.status,
        raw_ratio: m.raw_ratio,
        source_facts: m.source_facts,
        max_points: m.max_points,
        anchors: FHI_METRICS.find((d) => d.id === m.metric_id)!.anchors,
        points: null,
        flags: m.flags,
        blockers: m.blockers,
      }));
    const registry = this.output("FinancialRegistry", {
      sets,
      selected_set_id: selected === -1 ? null : sets[selected].id,
      method_status: policy?.status ?? "unconfigured",
      score: null,
      band: null,
      grade: null,
      pd: null,
      metrics,
      blockers: [...new Set(blockers)],
      strengths: [],
      weaknesses: [],
      limitations: [
        policy
          ? "The registry shows source facts and ratios. Publish an assessment for the AIC experimental financial index — NOT VALIDATED."
          : "AIC experimental method is not approved; no score or band is published.",
        "Verified entry/source fidelity does not confirm legal identity.",
        "No FX, annualization, profit proxy or weight redistribution.",
        ...(ownerCountry==='VN'
          ? ["Balance sheet tolerance awaits approval; only exact reconciliation is accepted by this implementation."]
          : ['International pilot: cash-flow classification follows the source standard; no calibrated cross-country credit risk or PD.',
            'Rounding requires explicit source precision and a current human verification; otherwise exact reconciliation remains required.']),
      ],
    });
    return {
      policy,
      registry,
      engine,
      aggregation,
      periodEngines,
      source_snapshot_hash: requestHash({
        ...(aggregation ? { aggregation_method: CASE_AGGREGATION_METHOD } : {}),
        selected_set_id: registry.selected_set_id,
        sets: sets.map((set,index)=>({...set,metadata:rows[index].metadata_json})),
        snapshots: prepared.map((value) => value.hash),
      }),
    };
  }
  private async resource(session: AuthSession, id: string) {
    requireUuid(id);
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query(
          "SELECT * FROM aic.mvp_financial_sets WHERE organization_id=$1 AND id=$2 ORDER BY revision DESC LIMIT 1",
          [session.user.organization_id, id],
        )
      ).rows[0];
      if (!row) throw notFound();
      await this.access(tx, session, row.case_id);
      return row;
    });
  }
  async save(
    session: AuthSession,
    caseId: string,
    id: string | undefined,
    key: string,
    body: unknown,
  ) {
    const input = this.input("FinancialSetInput", body);
    if (input.period.start_date > input.period.end_date)
      fail("INVALID_FINANCIAL_PERIOD");
    if (new Set(input.facts.map((f: any) => f.key)).size !== input.facts.length)
      fail("DUPLICATE_FINANCIAL_FACT");
    return this.mutations.execute(session, caseId, {
      operation: id ? "financial.revise:" + id : "financial.create",
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        if (
          current.purpose !== "company_health" &&
          !["RECEIVABLE", "PREPAYMENT"].includes(current.exposure_kind)
        )
          fail("UNSUPPORTED_EXPOSURE");
        const prior = id
          ? (
              await tx.query(
                "SELECT * FROM aic.mvp_financial_sets WHERE organization_id=$1 AND case_id=$2 AND id=$3 ORDER BY revision DESC LIMIT 1",
                [current.organization_id, current.id, id],
              )
            ).rows[0]
          : null;
        if (id && !prior) throw notFound();
        if (input.import_review) {
          const receipt = await importReceipt(tx, current, input.import_review.receipt_id);
          if (receipt.document_type !== 'financial_statement' || !receipt.facts.length)
            fail('FINANCIAL_STATEMENT_REQUIRED');
          const file = await importSource(tx, current, receipt.source.kind, receipt.source.id);
          if (file.sha256 !== receipt.sha256) fail('INVALID_FINANCIAL_SOURCE');
          const cp = (await tx.query('SELECT revision,country FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE',
            [current.organization_id,current.counterparty_id])).rows[0];
          if (countryCode(cp.country) !== receipt.scope.country) fail('FINANCIAL_COUNTRY_MISMATCH');
          await tx.query(`INSERT INTO aic.audit_events(id,organization_id,case_id,actor_type,actor_id,action,subject_id,
            revision_before,revision_after,metadata_json,reason) VALUES($1,$2,$3,'specialist',$4,'financial.import_reviewed',$5,$6,$7,$8::jsonb,$9)`,
            [randomUUID(),current.organization_id,current.id,session.user.id,input.import_review.receipt_id,
              Number(current.revision),next,canonicalJson({counterparty_revision:Number(cp.revision),confirmed:true,
                reviewed_pages:receipt.selected_pages,source_hash:receipt.sha256}),input.reason]);
        }
        const setId = id ?? randomUUID(),
          revision = prior ? Number(prior.revision) + 1 : 1;
        if (!Number.isSafeInteger(revision)) fail("REVISION_CONFLICT", 409);
        const cp = (
          await tx.query(
            "SELECT country,industry_code FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE",
            [current.organization_id, current.counterparty_id],
          )
        ).rows[0];
        const scope: FhiScope = {
          entity_id: current.counterparty_id,
          country: countryCode(cp.country),
          industry: cp.industry_code ?? "UNKNOWN",
          pilot_scope: input.industry_scope,
          period: input.period,
          basis: input.basis,
          accounting_regime: input.accounting_regime,
          currency: input.currency,
          unit_multiplier: input.unit_multiplier,
        };
        if (input.facts.some((f:any)=>f.key===INTERNATIONAL_CASH_KEY) && !accountingProfile(scope)) fail('UNSUPPORTED_FINANCIAL_FACT');
        const industryScope = ['DISTRIBUTION_WHOLESALE_PILOT','MANUFACTURING','RETAIL','BUSINESS_SERVICES','CONSUMER_DURABLES','OTHER'].includes(cp.industry_code) ? cp.industry_code : 'UNKNOWN';
        if (current.purpose === 'company_health' && input.industry_scope !== industryScope)
          fail('FINANCIAL_INDUSTRY_SCOPE_MISMATCH');
        if (input.intake_review)
          await reviewIntakePeriod(tx,current,input,setId,prior,session.user.id,next);
        await tx.query(
          `INSERT INTO aic.mvp_financial_sets(id,revision,organization_id,case_id,scope_json,metadata_json,bridges_json,case_revision,actor_id,reason)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,'{}'::jsonb,$7,$8,$9)`,
          [
            setId,
            revision,
            current.organization_id,
            current.id,
            canonicalJson(scope),
            canonicalJson({
              audit_status: input.audit_status,
              statement_version: input.statement_version,
              observation_kind: input.observation_kind,
              ...(accountingProfile(scope) ? {accounting_profile:accountingProfile(scope)} : {}),
              ...(prior?.metadata_json.calculations ? {calculations:prior.metadata_json.calculations} : {}),
              ...(prior?.metadata_json.reasoning ? {reasoning:prior.metadata_json.reasoning} : {}),
              ...(input.import_review ? {calculations:calculationMetadata(await importReceipt(tx,current,input.import_review.receipt_id))} : {}),
              ...(input.import_review && (await importReceipt(tx,current,input.import_review.receipt_id)).reasoning ?
                {reasoning:reasoningSummary(await importReceipt(tx,current,input.import_review.receipt_id))} : {}),
            }),
            next,
            session.user.id,
            input.reason,
          ],
        );
        const old = prior
          ? (
              await tx.query(
                "SELECT * FROM aic.mvp_financial_facts WHERE organization_id=$1 AND case_id=$2 AND set_id=$3 AND set_revision=$4",
                [current.organization_id, current.id, setId, prior.revision],
              )
            ).rows
          : [];
        for (const fact of input.facts) {
          if (fact.source.kind === 'calculated') {
            const receipt=await importReceipt(tx,current,fact.source.receipt_id), candidate=calculationFact(receipt,fact.source), s=receipt.scope;
            const before=old.find(f=>f.fact_key === fact.key)?.payload_json;
            if(before?.raw_value != null && (before.source.kind !== 'calculated' || before.source.calculation_id !== fact.source.calculation_id || before.source.receipt_id !== fact.source.receipt_id))
              fail('FINANCIAL_CALCULATION_TARGET_PRESENT');
            if (!candidate || fact.key !== candidate.key || fact.raw_value !== candidate.computed_value ||
              fact.raw_label !== 'Số tính ra: '+candidate.key || input.currency!==s.currency || input.unit_multiplier!==s.unit_multiplier ||
              input.basis!==s.basis || input.accounting_regime!==s.accounting_regime || input.period.kind!==s.period_kind ||
              input.period.start_date!==s.start_date || input.period.end_date!==s.end_date || input.observation_kind!=='actual')
              fail('FINANCIAL_CALCULATION_CHANGED');
          }
          if(fact.source.kind==='statement_entry') {
            const receipt=await importReceipt(tx,current,fact.source.receipt_id),s=receipt.scope;
            if(current.purpose!=='company_health' || fact.source.fact_key!==fact.key || !receipt.missing_keys.includes(fact.key) ||
              input.currency!==s.currency || input.unit_multiplier!==s.unit_multiplier || input.basis!==s.basis ||
              input.accounting_regime!==s.accounting_regime || input.period.kind!==s.period_kind || input.period.start_date!==s.start_date ||
              input.period.end_date!==s.end_date || input.observation_kind!=='actual')fail('FINANCIAL_IMPORT_VALUE_OR_SCOPE_CHANGED');
          }
          if (fact.source.kind === 'financial_import') {
            const receipt = await importReceipt(tx,current,fact.source.receipt_id);
            const candidate = receipt.facts.find((f:any) => f.key === fact.key);
            const scope = receipt.scope;
            const correction = fact.source.human_correction;
            const corrected = !!correction && current.purpose === 'company_health' && !!prior &&
              !!correction.reason.trim() && old.some(f=>f.fact_key===fact.key &&
                f.payload_json.source.kind==='financial_import' && f.payload_json.source.receipt_id===fact.source.receipt_id);
            if (correction && !corrected) fail('FINANCIAL_CORRECTION_REQUIRES_EXISTING_SOURCE');
            if (!candidate || fact.source.fact_key !== fact.key || (!corrected && fact.raw_value !== candidate.value) || fact.raw_label !== candidate.label ||
              input.currency !== scope.currency || input.unit_multiplier !== scope.unit_multiplier ||
              input.basis !== scope.basis || input.accounting_regime !== scope.accounting_regime ||
              input.period.kind !== scope.period_kind || input.period.start_date !== scope.start_date || input.period.end_date !== scope.end_date ||
              input.observation_kind !== 'actual') fail('FINANCIAL_IMPORT_VALUE_OR_SCOPE_CHANGED');
          }
          if (
            fact.raw_value === null
              ? !fact.missing_reason?.trim()
              : fact.missing_reason !== null
          )
            fail("FINANCIAL_MISSING_REASON_REQUIRED");
          if (!(await this.source(tx, current, fact.source, false)))
            fail("INVALID_FINANCIAL_SOURCE");
          const id =
            old.find((f) => f.fact_key === fact.key)?.id ?? randomUUID();
          const normalized =
            fact.raw_value === null
              ? null
              : Decimal.parse(fact.raw_value)
                  .mul(Decimal.parse(input.unit_multiplier))
                  .toString();
          const payload = {
            ...fact,
            normalized_decimal: normalized,
            currency: input.currency,
            unit_multiplier: input.unit_multiplier,
            period: input.period,
            basis: input.basis,
            adjustments:
              fact.raw_value === null
                ? []
                : [
                    {
                      kind: "unit_normalization",
                      multiplier: input.unit_multiplier,
                      result: normalized,
                    },
                  ],
            source_origin:
              ['manual_entry','statement_entry'].includes(fact.source.kind)
                ? "staff_entered"
                : "document",
            entered_by: session.user.id,
            recorded_case_revision: next,
          };
          await tx.query(
            "INSERT INTO aic.mvp_financial_facts(id,revision,organization_id,case_id,set_id,set_revision,fact_key,payload_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
            [
              id,
              revision,
              current.organization_id,
              current.id,
              setId,
              revision,
              fact.key,
              canonicalJson(payload),
            ],
          );
          if (fact.source.kind === "document")
            await tx.query(
              "INSERT INTO aic.mvp_financial_source_bindings(organization_id,case_id,fact_id,fact_revision,document_id,document_version,document_sha256) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                current.organization_id,
                current.id,
                id,
                revision,
                fact.source.document_id,
                fact.source.document_version,
                fact.source.source_hash,
              ],
            );
        }
        const row = (
          await tx.query(
            "SELECT * FROM aic.mvp_financial_sets WHERE id=$1 AND revision=$2",
            [setId, revision],
          )
        ).rows[0];
        return {
          status: id ? 200 : 201,
          body: this.output("FinancialMutationOutput", {
            set: (await this.setTx(tx, current, row)).read,
            revision: next,
          }),
          action: id ? "financial.revised" : "financial.created",
          reason: input.reason,
          subjectId: setId,
        };
      },
    });
  }
  async revise(session: AuthSession, id: string, key: string, body: unknown) {
    const row = await this.resource(session, id);
    return this.save(session, row.case_id, id, key, body);
  }
  /** One explicit human review replaces individual fact verification for company cases. */
  async confirmAllTx(tx: SqlClient, current: any, actorId: string, next: number, bridges: any) {
    const rows = (await tx.query(`SELECT DISTINCT ON(id) * FROM aic.mvp_financial_sets
      WHERE organization_id=$1 AND case_id=$2 ORDER BY id,revision DESC`, [current.organization_id,current.id])).rows;
    const cp = (await tx.query('SELECT country,industry_code FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE',
      [current.organization_id,current.counterparty_id])).rows[0];
    const industryScope = ['DISTRIBUTION_WHOLESALE_PILOT','MANUFACTURING','RETAIL','BUSINESS_SERVICES','CONSUMER_DURABLES','OTHER'].includes(cp.industry_code) ? cp.industry_code : 'UNKNOWN';
    let count = 0;
    for (const row of rows) {
      if(row.metadata_json.reasoning?.targets.some((t:any)=>t.status==='conflict'))fail('FINANCIAL_REASONING_CONFLICT');
      if (row.scope_json.industry !== (cp.industry_code ?? 'UNKNOWN') || row.scope_json.pilot_scope !== industryScope)
        fail('FINANCIAL_INDUSTRY_SCOPE_MISMATCH');
      if (countryCode(row.scope_json.country) !== countryCode(cp.country)) fail('FINANCIAL_SCOPE_MISMATCH');
      const facts = (await tx.query(`SELECT * FROM aic.mvp_financial_facts WHERE organization_id=$1
        AND case_id=$2 AND set_id=$3 AND set_revision=$4 ORDER BY fact_key`, [current.organization_id,current.id,row.id,row.revision])).rows;
      const eligible = [];
      for (const fact of facts) {
        if (fact.payload_json.normalized_decimal === null) continue;
        if (fact.payload_json.source.kind === 'manual_entry' || !(await this.source(tx,current,fact.payload_json.source,false)))
          fail('BCTC_SOURCE_REQUIRED');
        eligible.push(fact);
      }
      if (!eligible.length) continue;
      await tx.query(`INSERT INTO aic.mvp_financial_verifications(id,organization_id,case_id,set_id,set_revision,
        fact_ids,status,bridge_assertions,source_snapshot_hash,case_revision,actor_id,reason)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,'verified',$7::jsonb,$8,$9,$10,$11)`,
        [randomUUID(),current.organization_id,current.id,row.id,row.revision,canonicalJson(eligible.map(f=>f.id)),
          canonicalJson(bridges),await this.snapshot(tx,current,facts),next,actorId,'Confirmed financial statements, source facts and reviewed calculations']);
      count += eligible.length;
    }
    return count;
  }
  async verify(session: AuthSession, id: string, key: string, body: unknown) {
    const input = this.input("FinancialVerifyInput", body),
      bound = await this.resource(session, id);
    return this.mutations.execute(session, bound.case_id, {
      operation: "financial.verify:" + id,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        const row = (
          await tx.query(
            "SELECT * FROM aic.mvp_financial_sets WHERE organization_id=$1 AND case_id=$2 AND id=$3 ORDER BY revision DESC LIMIT 1",
            [current.organization_id, current.id, id],
          )
        ).rows[0];
        if (Number(row.revision) !== input.set_revision)
          fail("STALE_FINANCIAL_SET", 409);
        const prepared = await this.setTx(tx, current, row);
        if (
          input.fact_ids.some(
            (id: string) => !prepared.read.facts.some((f: any) => f.id === id),
          )
        )
          fail("INVALID_FINANCIAL_FACT");
        for (const f of prepared.read.facts.filter((f: any) =>
          input.fact_ids.includes(f.id),
        )) {
          if (
            input.status === "verified" &&
            (f.normalized_decimal === null ||
              !(await this.source(tx, current, f.source, true)))
          )
            fail("FINANCIAL_SOURCE_REVIEW_REQUIRED");
        }
        await tx.query(
          `INSERT INTO aic.mvp_financial_verifications(id,organization_id,case_id,set_id,set_revision,fact_ids,status,bridge_assertions,source_snapshot_hash,case_revision,actor_id,reason)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12)`,
          [
            randomUUID(),
            current.organization_id,
            current.id,
            id,
            row.revision,
            canonicalJson(input.fact_ids),
            input.status,
            canonicalJson(input.bridge_assertions),
            prepared.hash,
            next,
            session.user.id,
            input.reason,
          ],
        );
        return {
          status: 200,
          body: this.output("FinancialMutationOutput", {
            set: (await this.setTx(tx, current, row)).read,
            revision: next,
          }),
          action: "financial.verified",
          reason: input.reason,
          subjectId: id,
        };
      },
    });
  }
}
