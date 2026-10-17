-- Append-only decisions retain the exact source/review context. No source fact
-- or immutable review payload is updated by a human finding disposition.
CREATE TABLE aic.mvp_issue_decisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  run_id uuid NOT NULL,
  source_snapshot_hash text NOT NULL CHECK(source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  case_revision bigint NOT NULL CHECK(case_revision BETWEEN 1 AND 9007199254740991),
  action text NOT NULL CHECK(action IN ('resolve','dismiss','reopen')),
  reason text NOT NULL CHECK(btrim(reason)<>''),
  evidence_refs jsonb NOT NULL CHECK(jsonb_typeof(evidence_refs)='array'),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(organization_id,case_id,case_revision),
  FOREIGN KEY(organization_id,case_id,run_id) REFERENCES aic.mvp_review_runs(organization_id,case_id,id),
  FOREIGN KEY(organization_id,actor_id) REFERENCES aic.users(organization_id,id)
);
CREATE INDEX mvp_issue_decisions_read_idx ON aic.mvp_issue_decisions(organization_id,case_id,issue_id,case_revision DESC);
CREATE TRIGGER mvp_issue_decisions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_issue_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
