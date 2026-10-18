-- Assessments and acknowledgements are immutable; source changes create a new result.
CREATE TABLE aic.assessments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  case_revision bigint NOT NULL CHECK (case_revision BETWEEN 1 AND 9007199254740991),
  selected_set_id uuid,
  method_policy_hash text CHECK (method_policy_hash ~ '^[a-f0-9]{64}$'),
  source_snapshot_hash text NOT NULL CHECK (source_snapshot_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json)='object'),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id,case_id,id),
  UNIQUE (organization_id,case_id,case_revision),
  FOREIGN KEY (organization_id,case_id) REFERENCES aic.cases(organization_id,id),
  FOREIGN KEY (organization_id,actor_id) REFERENCES aic.users(organization_id,id),
  CHECK (payload_json->>'id'=id::text AND payload_json->>'case_id'=case_id::text)
);
CREATE INDEX assessments_case_history ON aic.assessments(organization_id,case_id,case_revision DESC,id DESC);
CREATE TABLE aic.assessment_acknowledgements (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  case_revision bigint NOT NULL CHECK (case_revision BETWEEN 1 AND 9007199254740991),
  actor_id uuid NOT NULL,
  reason text NOT NULL CHECK (btrim(reason)<>''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id,case_id,assessment_id),
  FOREIGN KEY (organization_id,case_id,assessment_id) REFERENCES aic.assessments(organization_id,case_id,id),
  FOREIGN KEY (organization_id,actor_id) REFERENCES aic.users(organization_id,id)
);
CREATE TRIGGER assessments_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.assessments
  FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER assessment_acknowledgements_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.assessment_acknowledgements
  FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
