import type { SqlClient } from "../foundation/ports";
import { requestHash } from "../foundation/canonical";

/** Missing facts may be acknowledged as N/A; an unresolved reporting period cannot disappear. */
export function unresolvedIntakes(items: any[]) {
  return items.filter(i => {
    if (i.superseded_by || ['skipped','expanded'].includes(i.state)) return false;
    if (i.classification_json?.document_type === 'other') return false;
    if (['failed','queued','running','duplicate'].includes(i.state)) return true;
    if (i.origin_json?.period_candidates?.some((c:any)=>c.status === 'pending')) return true;
    if (i.classification_json?.period_issues?.some((issue:any)=>issue.severity==='blocking')) return true;
    const periods = i.classification_json?.periods ?? [];
    return !periods.length || periods.some((p:any) => !p.start_date ||
      !(i.result_json ?? []).some((s:any) => s.end_date === p.end_date && s.basis === p.basis &&
        (!s.kind || s.kind===p.kind) && (!s.start_date || s.start_date===p.start_date)) &&
      !(i.origin_json?.period_candidates ?? []).some((c:any)=>c.status==='kept' && c.period.kind===p.kind &&
        c.period.start_date===p.start_date && c.period.end_date===p.end_date && c.basis===p.basis));
  });
}

/** Includes content, versions and active jobs, never the confirmation's own revision. */
export async function financialReviewSnapshot(tx: SqlClient, current: any) {
  const args = [current.organization_id, current.id];
  const counterparty = (
    await tx.query(
      "SELECT id,revision FROM aic.counterparties WHERE organization_id=$1 AND id=$2 FOR SHARE",
      [current.organization_id, current.counterparty_id],
    )
  ).rows[0];
  const documents = (
    await tx.query(
      "SELECT id,current_document_id FROM aic.mvp_document_lineages WHERE organization_id=$1 AND case_id=$2 ORDER BY id",
      args,
    )
  ).rows;
  const decisions = (
    await tx.query(
      "SELECT id,payload_json FROM aic.mvp_document_decisions WHERE organization_id=$1 AND case_id=$2 ORDER BY case_revision,id",
      args,
    )
  ).rows;
  const sets = (
    await tx.query(
      "SELECT DISTINCT ON(id) id,revision,scope_json,metadata_json FROM aic.mvp_financial_sets WHERE organization_id=$1 AND case_id=$2 ORDER BY id,revision DESC",
      args,
    )
  ).rows;
  const facts = (
    await tx.query(
      `SELECT f.id,f.revision,f.payload_json FROM aic.mvp_financial_facts f
    JOIN (SELECT DISTINCT ON(id) id,revision FROM aic.mvp_financial_sets WHERE organization_id=$1 AND case_id=$2 ORDER BY id,revision DESC) s
    ON s.id=f.set_id AND s.revision=f.set_revision WHERE f.organization_id=$1 AND f.case_id=$2 ORDER BY f.id,f.revision`,
      args,
    )
  ).rows;
  const intakes = (
    await tx.query(
      `SELECT id,sha256,state,attempts,fence,error_code,origin_json,prepared_source_id,classification_json,result_json,replacement_of,superseded_by
    FROM aic.financial_intakes WHERE organization_id=$1 AND case_id=$2 ORDER BY id`,
      args,
    )
  ).rows;
  const files = (
    await tx.query(
      "SELECT id,sha256 FROM aic.financial_import_sources WHERE organization_id=$1 AND case_id=$2 ORDER BY id",
      args,
    )
  ).rows;
  const snapshot = {
    counterparty,
    documents,
    decisions,
    sets,
    facts,
    intakes,
    files,
  };
  return { snapshot, hash: requestHash(snapshot) };
}

export async function financialReviewState(tx: SqlClient, current: any) {
  const { hash, snapshot } = await financialReviewSnapshot(tx, current);
  const row = (
    await tx.query(
      `SELECT id,actor_id,created_at,source_snapshot_hash FROM aic.financial_review_confirmations
    WHERE organization_id=$1 AND case_id=$2 ORDER BY case_revision DESC LIMIT 1`,
      [current.organization_id, current.id],
    )
  ).rows[0];
  return {
    confirmed: !!row && row.source_snapshot_hash === hash,
    stale: !!row && row.source_snapshot_hash !== hash,
    id: row?.id ?? null,
    confirmed_at: row ? new Date(row.created_at).toISOString() : null,
    source_snapshot_hash: hash,
    processing: snapshot.intakes.some((i: any) =>
      ["queued", "running"].includes(i.state),
    ),
    unresolved_count: unresolvedIntakes(snapshot.intakes).length,
  };
}
