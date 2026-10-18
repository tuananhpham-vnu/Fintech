import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CaseMutations } from "../foundation/case-mutations";
import { CoreRepository, requireUuid } from "../foundation/core.repository";
import { canonicalJson, requestHash } from "../foundation/canonical";
import { FoundationError, notFound } from "../foundation/errors";
import { MvpWorkflowService } from "../foundation/mvp-workflow.service";
import { FOUNDATION_CONFIG, FOUNDATION_DB } from "../foundation/ports";
import type {
  AuthSession,
  FoundationConfig,
  FoundationDatabase,
  SqlClient,
} from "../foundation/ports";
import { validateContract } from "../foundation/validation";
import { Decimal } from "./decimal";
import type { ExactValue } from "./decimal";
import { FinancialRegistry } from "./financial-registry.service";
import { FHI_METHOD_ID, FHI_METHOD_VERSION } from "./fhi-method";
import { activeFhiPolicy } from "./fhi-policy";

const iso = (value: Date | string) => new Date(value).toISOString();
const display = (value: ExactValue | null) =>
  value
    ? Decimal.fraction(
        BigInt(value.numerator),
        BigInt(value.denominator),
      ).format(12)
    : null;

@Injectable()
export class AssessmentService {
  constructor(
    @Inject(FOUNDATION_DB) private readonly db: FoundationDatabase,
    @Inject(FOUNDATION_CONFIG) private readonly config: FoundationConfig,
    private readonly core: CoreRepository,
    private readonly mutations: CaseMutations,
    private readonly finance: FinancialRegistry,
    private readonly workflows: MvpWorkflowService,
  ) {}

  private async active(tx: SqlClient, session: AuthSession) {
    const result = await tx.query(
      "SELECT * FROM aic.lock_active_session($1,$2,$3,$4)",
      [
        session.id,
        session.user.id,
        session.user.organization_id,
        this.config.sessionIdleMs,
      ],
    );
    if (!result.rows[0]) throw new FoundationError(401, "SESSION_EXPIRED");
  }
  private async access(tx: SqlClient, session: AuthSession, caseId: string) {
    await this.active(tx, session);
    const current = await this.core.assertCaseAccess(
      tx,
      session.user,
      caseId,
      true,
    );
    await this.active(tx, session);
    return current;
  }
  private async prepare(tx: SqlClient, current: any, setId?: string) {
    const financial = await this.finance.evaluateTx(tx, current, setId);
    const context = await this.workflows.assessmentContextTx(tx, current);
    const at = iso(
      (await tx.query("SELECT clock_timestamp() AS at")).rows[0].at,
    );
    const policy = activeFhiPolicy(
      this.config.fhiPolicy,
      current.organization_id,
      at,
    );
    const jobs = (
      await tx.query(
        "SELECT id FROM aic.mvp_document_jobs WHERE organization_id=$1 AND case_id=$2 AND state IN ('queued','running') LIMIT 1",
        [current.organization_id, current.id],
      )
    ).rows;
    const blockers = [...financial.registry.blockers] as string[];
    const company = current.purpose === "company_health";
    const core =
      company || ["RECEIVABLE", "PREPAYMENT"].includes(current.exposure_kind);
    if (!core) blockers.push("UNSUPPORTED_EXPOSURE_KIND");
    if (jobs.length) blockers.push("SOURCE_PROCESSING");
    if (!company && !context.review) blockers.push("REVIEW_REQUIRED");
    else if (context.review) {
      if (context.review.stale) blockers.push("STALE_REVIEW");
      for (const finding of context.review.findings) {
        if (
          finding.severity === "blocker" &&
          finding.finding_state !== "verified_resolved"
        )
          blockers.push(finding.issue_key);
      }
    }
    const codes = [...new Set(blockers)];
    const snapshot = requestHash({
      financial: financial.source_snapshot_hash,
      review_inputs: context.snapshot,
      method_policy: policy ? requestHash(policy) : null,
    });
    const readiness = {
      case_revision: Number(current.revision),
      document_review_allowed: true,
      assessment_allowed:
        core &&
        jobs.length === 0 &&
        (company || (!!context.review && !context.review.stale)),
      numeric_assessment_allowed:
        !!policy &&
        codes.length === 0 &&
        financial.engine?.calculation.status === "complete",
      method_status: policy?.status ?? "unconfigured",
      blockers: codes.map((code) => ({ code, message: code })),
      limitations: [
        "Assessment is decision support; acknowledgement is not transaction approval.",
        "AIC experimental financial index — NOT VALIDATED. No default calibration; PD remains null.",
      ],
      waivable_requirements:
        context.review && !context.review.stale
          ? context.policy.checklist
              .filter(
                (item: any) =>
                  item.waivable &&
                  context.review.findings.some(
                    (f: any) =>
                      f.issue_key === item.requirement_key &&
                      f.category === "missing_document",
                  ),
              )
              .map((item: any) => ({
                requirement_key: item.requirement_key,
                label: item.requirement_key,
                issue_id: context.review.findings.find(
                  (f: any) => f.issue_key === item.requirement_key,
                ).id,
              }))
          : [],
    };
    validateContract("Readiness", readiness, true);
    return { ...financial, context, policy, readiness, snapshot, at };
  }
  private async result(tx: SqlClient, current: any, row: any) {
    const prepared = await this.prepare(
      tx,
      current,
      row.selected_set_id ?? undefined,
    );
    const ack = (
      await tx.query(
        "SELECT actor_id,created_at,reason FROM aic.assessment_acknowledgements WHERE organization_id=$1 AND case_id=$2 AND assessment_id=$3",
        [current.organization_id, current.id, row.id],
      )
    ).rows[0];
    const result = {
      ...row.payload_json,
      checked_case_revision: Number(current.revision),
      stale: row.source_snapshot_hash !== prepared.snapshot,
      acknowledged_by: ack?.actor_id ?? null,
      acknowledged_at: ack ? iso(ack.created_at) : null,
      acknowledgement_reason: ack?.reason ?? null,
    };
    validateContract("Assessment", result, true);
    return result;
  }
  async workspace(session: AuthSession, caseId: string, setId?: string) {
    requireUuid(caseId);
    if (setId !== undefined) requireUuid(setId);
    return this.db.transaction(async (tx) => {
      const current = await this.access(tx, session, caseId);
      const prepared = await this.prepare(tx, current, setId);
      const row = (
        await tx.query(
          "SELECT * FROM aic.assessments WHERE organization_id=$1 AND case_id=$2 ORDER BY case_revision DESC,id DESC LIMIT 1",
          [current.organization_id, current.id],
        )
      ).rows[0];
      const assessment = row ? await this.result(tx, current, row) : null;
      await this.active(tx, session);
      return {
        readiness: prepared.readiness,
        latest_assessment_id: assessment?.id ?? null,
        assessment,
      };
    });
  }
  async get(session: AuthSession, id: string) {
    requireUuid(id);
    return this.db.transaction(async (tx) => {
      const row = (
        await tx.query(
          "SELECT * FROM aic.assessments WHERE organization_id=$1 AND id=$2",
          [session.user.organization_id, id],
        )
      ).rows[0];
      if (!row) throw notFound();
      const current = await this.access(tx, session, row.case_id);
      const result = await this.result(tx, current, row);
      await this.active(tx, session);
      return result;
    });
  }
  async list(
    session: AuthSession,
    caseId: string,
    query: Record<string, unknown>,
  ) {
    requireUuid(caseId);
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    const cursor = query.cursor === undefined ? null : Number(query.cursor);
    if (
      Object.keys(query).some((key) => !["limit", "cursor"].includes(key)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (query.limit !== undefined &&
        (typeof query.limit !== "string" ||
          !/^[1-9][0-9]*$/.test(query.limit))) ||
      (query.cursor !== undefined &&
        (typeof query.cursor !== "string" ||
          !/^[1-9][0-9]*$/.test(query.cursor) ||
          !Number.isSafeInteger(cursor) ||
          cursor < 1))
    )
      throw new FoundationError(422, "INVALID_INPUT");
    return this.db.transaction(async (tx) => {
      const current = await this.access(tx, session, caseId);
      const rows = (
        await tx.query(
          `SELECT id,case_revision,created_at,payload_json FROM aic.assessments
          WHERE organization_id=$1 AND case_id=$2 AND ($3::bigint IS NULL OR case_revision<$3)
          ORDER BY case_revision DESC LIMIT $4`,
          [current.organization_id, caseId, cursor, limit + 1],
        )
      ).rows;
      const page = rows.slice(0, limit);
      await this.active(tx, session);
      return {
        items: page.map((row) => ({
          id: row.id,
          case_revision: Number(row.case_revision),
          created_at: iso(row.created_at),
          method_version: row.payload_json.method_version,
          state: row.payload_json.state,
        })),
        next_cursor:
          rows.length > limit
            ? String(page[page.length - 1].case_revision)
            : null,
      };
    });
  }
  async run(session: AuthSession, caseId: string, key: string, body: unknown) {
    requireUuid(caseId);
    const input: any = JSON.parse(canonicalJson(body));
    validateContract("AssessmentInput", input);
    return this.mutations.execute(session, caseId, {
      operation: "assessment.run",
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        const prepared = await this.prepare(
          tx,
          current,
          input.financial_set_id,
        );
        if (!prepared.readiness.assessment_allowed)
          throw new FoundationError(
            409,
            "ASSESSMENT_NOT_READY",
            "Review current sources before assessment",
            {
              blockers: prepared.readiness.blockers,
            },
          );
        const published = prepared.readiness.numeric_assessment_allowed;
        const engine = prepared.engine;
        const components = (engine?.metrics ?? []).map((metric) => ({
          metric_id: metric.metric_id,
          formula_id: metric.formula_id,
          raw_value: display(metric.raw_ratio),
          points: published ? display(metric.points) : null,
          max_points: metric.max_points,
          source_facts: metric.source_facts.map((fact) => fact.id),
          verification_state: metric.flags.includes(
            "VERIFIED_ZERO_INTEREST_ZERO_DEBT",
          )
            ? "verified_zero_debt_exception"
            : metric.status === "available"
              ? "verified"
              : "unverified",
          blockers: metric.blockers.map((blocker) => blocker.code),
          flags: metric.flags,
        }));
        const review = prepared.context.review;
        const payload = {
          ...(current.purpose === "company_health"
            ? { purpose: "company_health" }
            : {}),
          id: randomUUID(),
          case_id: caseId,
          case_revision: next,
          checked_case_revision: next,
          method_version: FHI_METHOD_ID + "/" + FHI_METHOD_VERSION,
          method_status: prepared.policy?.status ?? "unconfigured",
          method_policy_hash: prepared.policy
            ? requestHash(prepared.policy)
            : null,
          policy_version: current.policy_version,
          snapshot_hash: prepared.snapshot,
          state: "completed",
          stale: false,
          overall_score: published ? engine.calculation.display_total : null,
          grade: null,
          pd: null,
          created_at: prepared.at,
          financial_set_id: prepared.registry.selected_set_id,
          factors: (engine?.metrics ?? []).map((metric) => ({
            factor_id: metric.metric_id,
            label: metric.metric_id,
            status: metric.status === "available" ? "available" : "missing",
            score: published ? display(metric.points) : null,
            value: display(metric.raw_ratio),
            rationale: metric.formula,
            evidence_refs: [
              ...new Set<string>(
                prepared.registry.sets
                  .filter(
                    (set: any) => set.id === prepared.registry.selected_set_id,
                  )
                  .flatMap((set: any) => set.facts)
                  .filter((fact: any) =>
                    metric.source_facts.some((source) => source.id === fact.id),
                  )
                  .flatMap((fact: any) =>
                    fact.source.kind === "document"
                      ? [fact.source.evidence_ref]
                      : [],
                  ),
              ),
            ],
            verification_state:
              metric.status === "available" ? "verified" : "unverified",
            limitations: metric.blockers.map((blocker) => blocker.code),
          })),
          strengths: [] as string[],
          weaknesses: [] as string[],
          red_flags: (review?.findings ?? [])
            .filter(
              (finding: any) => finding.finding_state !== "verified_resolved",
            )
            .map((finding: any) => finding.summary),
          limitations: prepared.readiness.limitations,
          financial_health: {
            status: published ? "PREVIEW_ELIGIBLE" : "blocked",
            score: published ? engine.calculation.display_total : null,
            band: published ? engine.calculation.candidate_band : null,
            score_quality: published
              ? "experimental_not_validated"
              : "unavailable",
            pd: null,
            components,
            blockers: prepared.readiness.blockers.map(
              (blocker) => blocker.code,
            ),
          },
          transaction_review:
            current.purpose === "company_health"
              ? null
              : {
                  exposure_kind: current.exposure_kind,
                  status: review.transaction_review?.status ?? "UNKNOWN",
                  findings: review.findings.map((finding: any) => ({
                    code: finding.issue_key,
                    severity: finding.severity,
                    evidence_refs: finding.evidence_refs,
                    verification_state:
                      finding.finding_state === "verified_resolved"
                        ? "verified"
                        : "needs_review",
                  })),
                  limitations: review.transaction_review?.limitations ?? [],
                },
          calculation_trace: engine
            ? {
                metrics: engine.metrics,
                groups: engine.groups,
                calculation: engine.calculation,
              }
            : null,
          acknowledged_by: null,
          acknowledged_at: null,
          acknowledgement_reason: null,
        };
        // Descriptions follow the approved rubric endpoints; no new threshold or penalty is introduced.
        if (published)
          for (const metric of engine.metrics) {
            if (metric.credit?.decimal === "1")
              payload.strengths.push(
                metric.metric_id + ": maximum points in the AIC pilot rubric.",
              );
            if (metric.credit?.decimal === "0")
              payload.weaknesses.push(
                metric.metric_id + ": zero points in the AIC pilot rubric.",
              );
          }
        validateContract("Assessment", payload, true);
        await tx.query(
          "INSERT INTO aic.assessments(id,organization_id,case_id,case_revision,selected_set_id,method_policy_hash,source_snapshot_hash,payload_json,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)",
          [
            payload.id,
            current.organization_id,
            caseId,
            next,
            payload.financial_set_id,
            payload.method_policy_hash,
            prepared.snapshot,
            canonicalJson(payload),
            session.user.id,
          ],
        );
        return {
          status: 201,
          body: payload,
          action: "assessment.completed",
          subjectId: payload.id,
        };
      },
    });
  }
  async acknowledge(
    session: AuthSession,
    id: string,
    key: string,
    body: unknown,
  ) {
    requireUuid(id);
    const input: any = JSON.parse(canonicalJson(body));
    validateContract("AssessmentAcknowledgementInput", input);
    const resource = (
      await this.db.query(
        "SELECT case_id FROM aic.assessments WHERE organization_id=$1 AND id=$2",
        [session.user.organization_id, id],
      )
    ).rows[0];
    if (!resource) throw notFound();
    return this.mutations.execute(session, resource.case_id, {
      operation: "assessment.acknowledge:" + id,
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        const row = (
          await tx.query(
            "SELECT * FROM aic.assessments WHERE organization_id=$1 AND case_id=$2 AND id=$3",
            [current.organization_id, current.id, id],
          )
        ).rows[0];
        if (!row) throw notFound();
        const result = await this.result(tx, current, row);
        if (result.stale) throw new FoundationError(409, "STALE_ASSESSMENT");
        if (result.acknowledged_by)
          throw new FoundationError(409, "ASSESSMENT_ALREADY_ACKNOWLEDGED");
        const at = iso(
          (await tx.query("SELECT clock_timestamp() AS at")).rows[0].at,
        );
        await tx.query(
          "INSERT INTO aic.assessment_acknowledgements(id,organization_id,case_id,assessment_id,case_revision,actor_id,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)",
          [
            randomUUID(),
            current.organization_id,
            current.id,
            id,
            next,
            session.user.id,
            input.reason,
            at,
          ],
        );
        return {
          status: 200,
          body: {
            ...result,
            checked_case_revision: next,
            acknowledged_by: session.user.id,
            acknowledged_at: at,
            acknowledgement_reason: input.reason,
          },
          action: "assessment.acknowledged",
          subjectId: id,
          reason: input.reason,
        };
      },
    });
  }
}
