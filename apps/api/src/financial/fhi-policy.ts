import { readFileSync } from "node:fs";
import { requestHash } from "../foundation/canonical";
import {
  FHI_METHOD_ID,
  FHI_METHOD_VERSION,
  FHI_METRICS,
  FHI_PILOT_SCOPE,
} from "./fhi-method";

export interface FhiPublicationPolicy {
  policy_id: string;
  method_id: typeof FHI_METHOD_ID;
  method_version: typeof FHI_METHOD_VERSION;
  method_hash: string;
  status: "configured_pilot" | "validation_pending";
  industry_scope: typeof FHI_PILOT_SCOPE;
  organization_ids: string[];
  approval: { by: string; recorded_at: string; source: string; scope: string };
  effective_from: string;
  effective_until: string | null;
}

export const fhiMethodHash = () =>
  requestHash({
    id: FHI_METHOD_ID,
    version: FHI_METHOD_VERSION,
    scope: FHI_PILOT_SCOPE,
    metrics: FHI_METRICS,
  });

/** Explicit server-side approval artifact; neither clients nor AI can activate a method. */
export function loadFhiPolicy(
  file: string | undefined,
): Readonly<FhiPublicationPolicy> | undefined {
  if (!file) return undefined;
  const policy = JSON.parse(readFileSync(file, "utf8")) as FhiPublicationPolicy;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0;
  const date = (value: unknown) =>
    text(value) && Number.isFinite(Date.parse(value as string));
  if (
    !policy ||
    !text(policy.policy_id) ||
    policy.method_id !== FHI_METHOD_ID ||
    policy.method_version !== FHI_METHOD_VERSION ||
    policy.method_hash !== fhiMethodHash() ||
    policy.industry_scope !== FHI_PILOT_SCOPE ||
    !["configured_pilot", "validation_pending"].includes(policy.status) ||
    !Array.isArray(policy.organization_ids) ||
    policy.organization_ids.length === 0 ||
    policy.organization_ids.some(
      (id) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          id,
        ),
    ) ||
    new Set(policy.organization_ids).size !== policy.organization_ids.length ||
    !policy.approval ||
    !text(policy.approval.by) ||
    !text(policy.approval.source) ||
    !text(policy.approval.scope) ||
    !date(policy.approval.recorded_at) ||
    !date(policy.effective_from) ||
    Date.parse(policy.effective_from) <
      Date.parse(policy.approval.recorded_at) ||
    (policy.effective_until !== null &&
      (!date(policy.effective_until) ||
        Date.parse(policy.effective_until) <=
          Date.parse(policy.effective_from)))
  )
    throw new Error(
      "Invalid or incompatible AIC_FHI_POLICY_PATH approval artifact",
    );
  Object.freeze(policy.organization_ids);
  Object.freeze(policy.approval);
  return Object.freeze(policy);
}

export function activeFhiPolicy(
  policy: Readonly<FhiPublicationPolicy> | undefined,
  organizationId: string,
  now: string,
) {
  const instant = Date.parse(now);
  return policy &&
    Number.isFinite(instant) &&
    policy.organization_ids.includes(organizationId) &&
    Date.parse(policy.approval.recorded_at) <= instant &&
    Date.parse(policy.effective_from) <= instant &&
    (policy.effective_until === null ||
      instant < Date.parse(policy.effective_until))
    ? policy
    : null;
}
