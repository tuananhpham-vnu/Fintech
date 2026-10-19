-- Additive company-first intake. Original files and historical facts remain intact.
ALTER TABLE aic.mvp_counterparty_versions ALTER COLUMN reason DROP NOT NULL;

CREATE TABLE aic.financial_intakes (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  parent_id uuid,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 512),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 33554432),
  content_type text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','ready','needs_review','failed','duplicate','skipped','expanded')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  fence bigint NOT NULL DEFAULT 0,
  worker_id text,
  lease_expires_at timestamptz,
  prepared_source_id uuid,
  classification_json jsonb,
  result_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(result_json)='array'),
  origin_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_of uuid,
  replacement_of uuid,
  superseded_by uuid,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(organization_id,case_id,id),
  FOREIGN KEY(organization_id,case_id) REFERENCES aic.cases(organization_id,id),
  FOREIGN KEY(organization_id,actor_id) REFERENCES aic.users(organization_id,id),
  FOREIGN KEY(organization_id,case_id,parent_id) REFERENCES aic.financial_intakes(organization_id,case_id,id),
  FOREIGN KEY(organization_id,case_id,duplicate_of) REFERENCES aic.financial_intakes(organization_id,case_id,id),
  FOREIGN KEY(organization_id,case_id,replacement_of) REFERENCES aic.financial_intakes(organization_id,case_id,id),
  FOREIGN KEY(organization_id,case_id,superseded_by) REFERENCES aic.financial_intakes(organization_id,case_id,id),
  FOREIGN KEY(organization_id,case_id,prepared_source_id) REFERENCES aic.financial_import_sources(organization_id,case_id,id),
  CHECK(encode(sha256(bytes),'hex')=sha256),
  CHECK((worker_id IS NULL)=(lease_expires_at IS NULL))
);
CREATE INDEX financial_intakes_queue ON aic.financial_intakes(created_at) WHERE state IN ('queued','running');
CREATE INDEX financial_intakes_case ON aic.financial_intakes(organization_id,case_id,created_at);

CREATE FUNCTION aic.protect_financial_intake_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.organization_id,NEW.case_id,NEW.actor_id,NEW.parent_id,NEW.name,NEW.sha256,NEW.bytes,NEW.content_type,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.case_id,OLD.actor_id,OLD.parent_id,OLD.name,OLD.sha256,OLD.bytes,OLD.content_type,OLD.created_at)
 THEN RAISE EXCEPTION 'financial intake source is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER financial_intake_source_immutable BEFORE UPDATE ON aic.financial_intakes FOR EACH ROW EXECUTE FUNCTION aic.protect_financial_intake_source();
CREATE TRIGGER financial_intake_no_delete BEFORE DELETE OR TRUNCATE ON aic.financial_intakes FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();

CREATE TABLE aic.financial_review_confirmations (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 case_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 source_snapshot_hash text NOT NULL CHECK(source_snapshot_hash ~ '^[a-f0-9]{64}$'),
 source_snapshot_json jsonb NOT NULL,
 bridge_assertions jsonb NOT NULL,
 case_revision bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,case_id) REFERENCES aic.cases(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES aic.users(organization_id,id)
);
CREATE INDEX financial_review_confirmations_case ON aic.financial_review_confirmations(organization_id,case_id,case_revision DESC);
CREATE TRIGGER financial_review_confirmation_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.financial_review_confirmations FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
