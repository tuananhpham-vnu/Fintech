-- Append-only human decisions apply only to one exact immutable document source.
CREATE TABLE aic.mvp_document_decisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_version integer NOT NULL,
  document_sha256 text NOT NULL,
  case_revision bigint NOT NULL CHECK(case_revision BETWEEN 1 AND 9007199254740991),
  kind text NOT NULL CHECK(kind IN ('classification','correction')),
  payload_json jsonb NOT NULL CHECK(jsonb_typeof(payload_json)='object'),
  reason text NOT NULL CHECK(btrim(reason)<>''),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(organization_id,case_id,document_id,document_version,document_sha256)
    REFERENCES aic.mvp_documents(organization_id,case_id,id,version,hash),
  FOREIGN KEY(organization_id,actor_id) REFERENCES aic.users(organization_id,id),
  UNIQUE(organization_id,case_id,document_id,case_revision)
);
CREATE INDEX mvp_document_decisions_read_idx ON aic.mvp_document_decisions(organization_id,case_id,document_id,case_revision DESC);
CREATE TRIGGER mvp_document_decisions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_document_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
