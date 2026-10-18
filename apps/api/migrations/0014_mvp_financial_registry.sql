CREATE TABLE aic.mvp_financial_sets (
  id uuid NOT NULL,
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  scope_json jsonb NOT NULL CHECK(jsonb_typeof(scope_json)='object'),
  metadata_json jsonb NOT NULL CHECK(jsonb_typeof(metadata_json)='object'),
  bridges_json jsonb NOT NULL CHECK(jsonb_typeof(bridges_json)='object'),
  case_revision bigint NOT NULL CHECK(case_revision BETWEEN 1 AND 9007199254740991),
  actor_id uuid NOT NULL,
  reason text NOT NULL CHECK(btrim(reason)<>''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(id,revision),
  UNIQUE(organization_id,case_id,id,revision),
  FOREIGN KEY(organization_id,case_id) REFERENCES aic.cases(organization_id,id),
  FOREIGN KEY(organization_id,actor_id) REFERENCES aic.users(organization_id,id)
);
CREATE TABLE aic.mvp_financial_facts (
  id uuid NOT NULL,
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  set_id uuid NOT NULL,
  set_revision bigint NOT NULL,
  fact_key text NOT NULL,
  payload_json jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
  PRIMARY KEY(id,revision),
  UNIQUE(organization_id,case_id,id,revision),
  UNIQUE(organization_id,case_id,set_id,set_revision,fact_key),
  FOREIGN KEY(organization_id,case_id,set_id,set_revision) REFERENCES aic.mvp_financial_sets(organization_id,case_id,id,revision)
);
CREATE TABLE aic.mvp_financial_verifications (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  set_id uuid NOT NULL,
  set_revision bigint NOT NULL,
  fact_ids jsonb NOT NULL CHECK(jsonb_typeof(fact_ids)='array'),
  status text NOT NULL CHECK(status IN ('verified','unverified','rejected')),
  bridge_assertions jsonb NOT NULL CHECK(jsonb_typeof(bridge_assertions)='object'),
  source_snapshot_hash text NOT NULL CHECK(source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  case_revision bigint NOT NULL CHECK(case_revision BETWEEN 1 AND 9007199254740991),
  actor_id uuid NOT NULL,
  reason text NOT NULL CHECK(btrim(reason)<>''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(organization_id,case_id,set_id,set_revision) REFERENCES aic.mvp_financial_sets(organization_id,case_id,id,revision),
  FOREIGN KEY(organization_id,actor_id) REFERENCES aic.users(organization_id,id)
);
CREATE TABLE aic.mvp_financial_source_bindings (
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  fact_id uuid NOT NULL,
  fact_revision bigint NOT NULL,
  document_id uuid NOT NULL,
  document_version integer NOT NULL,
  document_sha256 text NOT NULL,
  PRIMARY KEY(organization_id,case_id,fact_id,fact_revision,document_id),
  FOREIGN KEY(organization_id,case_id,fact_id,fact_revision) REFERENCES aic.mvp_financial_facts(organization_id,case_id,id,revision),
  FOREIGN KEY(organization_id,case_id,document_id,document_version,document_sha256) REFERENCES aic.mvp_documents(organization_id,case_id,id,version,hash)
);
CREATE TRIGGER mvp_financial_sets_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_financial_sets FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER mvp_financial_facts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_financial_facts FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER mvp_financial_verifications_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_financial_verifications FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER mvp_financial_sources_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_financial_source_bindings FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
