-- Additive source storage for long international financial PDFs. No existing rows change.
CREATE TABLE aic.financial_import_sources (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 255),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 5 AND 25000000),
  page_count integer NOT NULL CHECK(page_count BETWEEN 1 AND 600),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(organization_id,case_id,id),
  FOREIGN KEY(organization_id,case_id) REFERENCES aic.cases(organization_id,id),
  FOREIGN KEY(organization_id,actor_id) REFERENCES aic.users(organization_id,id)
);
CREATE INDEX financial_import_sources_case ON aic.financial_import_sources(organization_id,case_id,created_at);
CREATE TRIGGER financial_import_sources_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.financial_import_sources FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
