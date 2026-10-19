import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CaseMutations } from "../foundation/case-mutations";
import { canonicalJson } from "../foundation/canonical";
import type { AuthSession } from "../foundation/ports";
import { FoundationError } from "../foundation/errors";
import { validateContract } from "../foundation/validation";
import { FinancialRegistry } from "./financial-registry.service";
import {
  financialReviewSnapshot,
  financialReviewState,
  unresolvedIntakes,
} from "./financial-review-state";

@Injectable()
export class FinancialReviewService {
  constructor(
    private mutations: CaseMutations,
    private registry: FinancialRegistry,
  ) {}
  async confirm(
    session: AuthSession,
    caseId: string,
    key: string,
    body: unknown,
  ) {
    validateContract("FinancialReviewConfirmInput", body);
    const input = JSON.parse(canonicalJson(body));
    return this.mutations.execute(session, caseId, {
      operation: "financial.confirm_all",
      key,
      expectedRevision: input.expected_revision,
      payload: input,
      work: async (tx, current, next) => {
        if (current.purpose !== "company_health")
          throw new FoundationError(
            422,
            "COMPANY_FINANCIAL_WORKSPACE_REQUIRED",
          );
        const before = await financialReviewSnapshot(tx, current);
        if (before.hash !== input.source_snapshot_hash)
          throw new FoundationError(409, "FINANCIAL_REVIEW_CHANGED");
        if (
          before.snapshot.intakes.some((i) =>
            ["queued", "running", "duplicate"].includes(i.state),
          ) ||
          (
            await tx.query(
              `SELECT 1 FROM aic.mvp_document_jobs WHERE organization_id=$1 AND case_id=$2
            AND state IN ('queued','running') LIMIT 1`,
              [current.organization_id, current.id],
            )
          ).rows.length
        )
          throw new FoundationError(409, "SOURCE_PROCESSING_OR_DUPLICATE");
        if (!before.snapshot.sets.length)
          throw new FoundationError(422, "FINANCIAL_INPUTS_REQUIRED");
        if (unresolvedIntakes(before.snapshot.intakes).length)
          throw new FoundationError(422, 'FINANCIAL_PERIOD_REVIEW_REQUIRED');
        const count = await this.registry.confirmAllTx(
          tx,
          current,
          session.user.id,
          next,
          input.bridge_assertions,
        );
        const id = randomUUID();
        await tx.query(
          `INSERT INTO aic.financial_review_confirmations(id,organization_id,case_id,actor_id,
          source_snapshot_hash,source_snapshot_json,bridge_assertions,case_revision)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
          [
            id,
            current.organization_id,
            current.id,
            session.user.id,
            before.hash,
            canonicalJson(before.snapshot),
            canonicalJson(input.bridge_assertions),
            next,
          ],
        );
        const result = {
          revision: next,
          review: await financialReviewState(tx, current),
          verified_fact_count: count,
        };
        validateContract("FinancialReviewConfirmOutput", result, true);
        return {
          status: 201,
          body: result,
          action: "financial.review_confirmed_all",
          subjectId: id,
          metadata: {
            source_snapshot_hash: before.hash,
            verified_fact_count: count,
          },
        };
      },
    });
  }
}
