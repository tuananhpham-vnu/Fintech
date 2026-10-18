-- Narrow creator-only trigger authority: runtime case insertion does not grant
-- generic membership DML. The existing no-argument body uses fully qualified SQL.
ALTER FUNCTION aic.grant_case_creator_membership() SECURITY DEFINER;
ALTER FUNCTION aic.grant_case_creator_membership() SET search_path = pg_catalog;
REVOKE EXECUTE ON FUNCTION aic.grant_case_creator_membership() FROM PUBLIC;

-- B02 sandbox approval: unavailable positive VND amount may be explicitly null
-- only with a nonblank reason. Zero, missing keys and malformed strings fail.
ALTER TABLE aic.cases DROP CONSTRAINT cases_exposure_amount;
ALTER TABLE aic.cases ADD CONSTRAINT cases_exposure_amount CHECK ((
  (jsonb_typeof(exposure_json->'amount_vnd') = 'string'
    AND (exposure_json->>'amount_vnd') ~ '^[1-9][0-9]{0,23}$') OR
  (exposure_json->'amount_vnd' = 'null'::jsonb
    AND jsonb_typeof(exposure_json->'amount_missing_reason') = 'string'
    AND btrim(exposure_json->>'amount_missing_reason') <> '')
) IS TRUE);

ALTER TABLE aic.mvp_document_replays DROP CONSTRAINT mvp_document_replays_operation_check;
ALTER TABLE aic.mvp_document_replays ADD CONSTRAINT mvp_document_replays_operation_check
  CHECK (operation IN ('document/new','document/replace','document/response'));

CREATE TABLE aic.mvp_review_runs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  case_revision bigint NOT NULL CHECK (case_revision BETWEEN 1 AND 9007199254740991),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  policy_version text NOT NULL REFERENCES aic.mvp_policy_artifacts(version),
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, case_id, id),
  FOREIGN KEY (organization_id, case_id) REFERENCES aic.cases(organization_id, id)
);

CREATE TABLE aic.mvp_document_requests (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  run_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  purpose text NOT NULL CHECK (btrim(purpose) <> ''),
  content text NOT NULL CHECK (btrim(content) <> ''),
  document_types jsonb NOT NULL CHECK (jsonb_typeof(document_types) = 'array'),
  status text NOT NULL CHECK (status IN ('draft','approved','cancelled','closed')),
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  approved_payload jsonb,
  approved_export bytea,
  approved_hash text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, case_id, id),
  FOREIGN KEY (organization_id, case_id) REFERENCES aic.cases(organization_id, id),
  FOREIGN KEY (organization_id, case_id, run_id) REFERENCES aic.mvp_review_runs(organization_id, case_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES aic.users(organization_id, id),
  CHECK ((approved_payload IS NULL AND approved_export IS NULL AND approved_hash IS NULL) OR
    (approved_payload IS NOT NULL AND jsonb_typeof(approved_payload) = 'object'
      AND approved_export IS NOT NULL AND approved_hash IS NOT NULL
      AND approved_hash ~ '^[0-9a-f]{64}$' AND encode(sha256(approved_export),'hex') = approved_hash)),
  CHECK (status NOT IN ('approved','closed') OR approved_hash IS NOT NULL)
);

-- Service records the authenticated actor for every edit/approval/status change.
-- No trigger invents an actor from created_by when a different member edits a request.
CREATE TABLE aic.mvp_request_history (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_revision bigint NOT NULL CHECK (request_revision BETWEEN 1 AND 9007199254740991),
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, case_id, request_id, request_revision),
  FOREIGN KEY (organization_id, case_id, request_id) REFERENCES aic.mvp_document_requests(organization_id, case_id, id),
  FOREIGN KEY (organization_id, actor_id) REFERENCES aic.users(organization_id, id)
);

CREATE FUNCTION aic.guard_mvp_document_request_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.issue_id IS DISTINCT FROM OLD.issue_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Request identity is immutable';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Request revision must advance once';
  END IF;
  IF OLD.approved_hash IS NOT NULL AND (
    NEW.approved_payload IS DISTINCT FROM OLD.approved_payload OR
    NEW.approved_export IS DISTINCT FROM OLD.approved_export OR
    NEW.approved_hash IS DISTINCT FROM OLD.approved_hash OR
    NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.content IS DISTINCT FROM OLD.content OR
    NEW.document_types IS DISTINCT FROM OLD.document_types
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Approved request publication is immutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION aic.guard_mvp_document_request_update() FROM PUBLIC;
CREATE TRIGGER mvp_document_request_update_guard BEFORE UPDATE ON aic.mvp_document_requests
  FOR EACH ROW EXECUTE FUNCTION aic.guard_mvp_document_request_update();

CREATE TABLE aic.mvp_response_bindings (
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_revision bigint NOT NULL CHECK (request_revision BETWEEN 1 AND 9007199254740991),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  document_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, case_id, document_id),
  FOREIGN KEY (organization_id, case_id, request_id) REFERENCES aic.mvp_document_requests(organization_id, case_id, id),
  FOREIGN KEY (organization_id, case_id, document_id) REFERENCES aic.mvp_documents(organization_id, case_id, id)
);

CREATE FUNCTION aic.check_mvp_response_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  request_row aic.mvp_document_requests%ROWTYPE;
  document_type text;
BEGIN
  SELECT r.* INTO request_row FROM aic.mvp_document_requests AS r
    WHERE r.organization_id = NEW.organization_id AND r.case_id = NEW.case_id AND r.id = NEW.request_id
    FOR SHARE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Response request not found';
  END IF;
  IF request_row.status <> 'approved' OR request_row.revision <> NEW.request_revision
    OR request_row.approved_hash IS DISTINCT FROM NEW.request_hash THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Response requires current approved request';
  END IF;
  SELECT d.type INTO document_type FROM aic.mvp_documents AS d
    WHERE d.organization_id = NEW.organization_id AND d.case_id = NEW.case_id AND d.id = NEW.document_id;
  IF FOUND AND NOT (request_row.document_types ? document_type) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Response document type was not requested';
  END IF;
  RETURN NEW;
END;
$$;
-- This invoker trigger acquires request row locks. The combined API already needs
-- request UPDATE for editing/approval; it requires no user/membership DML.
REVOKE EXECUTE ON FUNCTION aic.check_mvp_response_binding() FROM PUBLIC;
CREATE TRIGGER mvp_response_binding_valid BEFORE INSERT ON aic.mvp_response_bindings
  FOR EACH ROW EXECUTE FUNCTION aic.check_mvp_response_binding();

CREATE TABLE aic.mvp_waivers (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  requirement_key text NOT NULL CHECK (btrim(requirement_key) <> ''),
  issue_id uuid NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  policy_version text NOT NULL REFERENCES aic.mvp_policy_artifacts(version),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, case_id, id),
  FOREIGN KEY (organization_id, case_id) REFERENCES aic.cases(organization_id, id),
  FOREIGN KEY (organization_id, actor_id) REFERENCES aic.users(organization_id, id)
);

CREATE TABLE aic.mvp_waiver_revocations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  waiver_id uuid NOT NULL UNIQUE,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, case_id, waiver_id) REFERENCES aic.mvp_waivers(organization_id, case_id, id),
  FOREIGN KEY (organization_id, actor_id) REFERENCES aic.users(organization_id, id)
);

CREATE FUNCTION aic.reject_mvp_workflow_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MVP workflow history is immutable';
END;
$$;
REVOKE EXECUTE ON FUNCTION aic.reject_mvp_workflow_mutation() FROM PUBLIC;
CREATE TRIGGER mvp_review_runs_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_review_runs FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER mvp_requests_no_delete BEFORE DELETE OR TRUNCATE
  ON aic.mvp_document_requests FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER mvp_request_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_request_history FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER mvp_response_bindings_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_response_bindings FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER mvp_waivers_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_waivers FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER mvp_waiver_revocations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_waiver_revocations FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();

-- Runtime: SELECT,INSERT on these six tables; UPDATE only on document_requests.
-- History INSERT is explicit in the same service transaction as request edit + audit.
-- Request approval/response/waiver persistence never asserts human verification.
