CREATE TABLE aic.mvp_counterparty_versions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  counterparty_id uuid NOT NULL,
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  source_json jsonb NOT NULL CHECK(jsonb_typeof(source_json)='object'),
  payload_json jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
  actor_id uuid NOT NULL,
  reason text NOT NULL CHECK(btrim(reason)<>''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(organization_id,counterparty_id,revision),
  FOREIGN KEY(organization_id,counterparty_id) REFERENCES aic.counterparties(organization_id,id),
  FOREIGN KEY(organization_id,actor_id) REFERENCES aic.users(organization_id,id)
);
CREATE TRIGGER mvp_counterparty_versions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_counterparty_versions
  FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
