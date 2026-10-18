-- Technical MVP only. No policy approval, case creation, Exposure or verification writes.
-- Canonical bytea is committed with acceptance; private files are disposable caches.
CREATE TABLE aic.mvp_document_objects (
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  document_id uuid NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, case_id, document_id),
  UNIQUE (organization_id, case_id, document_id, sha256, byte_size),
  FOREIGN KEY (organization_id, case_id) REFERENCES aic.cases(organization_id, id),
  CHECK (octet_length(bytes) = byte_size),
  CHECK (encode(sha256(bytes), 'hex') = sha256)
);

CREATE TABLE aic.mvp_document_lineages (
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  id uuid NOT NULL,
  current_document_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, case_id, id),
  FOREIGN KEY (organization_id, case_id) REFERENCES aic.cases(organization_id, id)
);

CREATE TABLE aic.mvp_documents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  lineage uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  replaces_document_id uuid,
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  pages integer NOT NULL CHECK (pages BETWEEN 1 AND 10),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 255 AND btrim(name) <> ''),
  type text NOT NULL CHECK (type IN ('registration','loan_request','financial_statement',
    'contract','acceptance_record','payment_record','invoice','other')),
  source_class text NOT NULL CHECK (length(source_class) BETWEEN 1 AND 200 AND btrim(source_class) <> ''),
  ai_mode text NOT NULL CHECK (ai_mode IN ('live','mock')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, case_id, id),
  UNIQUE (organization_id, case_id, lineage, id),
  UNIQUE (organization_id, case_id, lineage, version),
  UNIQUE (organization_id, case_id, id, version, hash),
  CHECK ((version = 1 AND replaces_document_id IS NULL) OR
    (version > 1 AND replaces_document_id IS NOT NULL)),
  FOREIGN KEY (organization_id, case_id) REFERENCES aic.cases(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES aic.users(organization_id, id),
  FOREIGN KEY (organization_id, case_id, lineage)
    REFERENCES aic.mvp_document_lineages(organization_id, case_id, id),
  FOREIGN KEY (organization_id, case_id, lineage, replaces_document_id)
    REFERENCES aic.mvp_documents(organization_id, case_id, lineage, id),
  FOREIGN KEY (organization_id, case_id, id, hash, byte_size)
    REFERENCES aic.mvp_document_objects(organization_id, case_id, document_id, sha256, byte_size)
);

ALTER TABLE aic.mvp_document_lineages ADD CONSTRAINT mvp_document_current_version_fk
  FOREIGN KEY (organization_id, case_id, id, current_document_id)
  REFERENCES aic.mvp_documents(organization_id, case_id, lineage, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE aic.mvp_document_jobs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_version integer NOT NULL,
  sha256 text NOT NULL,
  snapshot_case_revision bigint NOT NULL CHECK (snapshot_case_revision BETWEEN 1 AND 9007199254740991),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','succeeded','failed','stale')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  fence bigint NOT NULL DEFAULT 0 CHECK (fence BETWEEN 0 AND 9007199254740991),
  worker_id text,
  lease_expires_at timestamptz,
  error_code text,
  retryable boolean NOT NULL DEFAULT false,
  ai_mode text NOT NULL CHECK (ai_mode IN ('live','mock')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, case_id, id),
  UNIQUE (organization_id, case_id, document_id),
  UNIQUE (organization_id, case_id, id, document_id, document_version, sha256),
  CHECK (state <> 'running' OR (worker_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
  FOREIGN KEY (organization_id, case_id, document_id, document_version, sha256)
    REFERENCES aic.mvp_documents(organization_id, case_id, id, version, hash)
);

CREATE INDEX mvp_document_jobs_claim_idx ON aic.mvp_document_jobs(state, created_at, id)
  WHERE state IN ('queued','running');

-- Every finished attempt is retained, including failures, lease expiry and raw stale output.
CREATE TABLE aic.mvp_document_results (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  job_id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_version integer NOT NULL,
  sha256 text NOT NULL,
  fence bigint NOT NULL CHECK (fence BETWEEN 0 AND 9007199254740991),
  worker_id text NOT NULL CHECK (btrim(worker_id) <> ''),
  case_revision bigint NOT NULL CHECK (case_revision BETWEEN 1 AND 9007199254740991),
  outcome text NOT NULL CHECK (outcome IN ('published','stale','failed','lease_expired')),
  raw_extraction jsonb,
  ai_mode text NOT NULL CHECK (ai_mode IN ('live','mock')),
  error_code text,
  retryable boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, case_id, job_id, fence),
  FOREIGN KEY (organization_id, case_id, job_id, document_id, document_version, sha256)
    REFERENCES aic.mvp_document_jobs(organization_id, case_id, id, document_id, document_version, sha256)
);
CREATE UNIQUE INDEX mvp_document_one_published_result_idx
  ON aic.mvp_document_results(organization_id, case_id, document_id) WHERE outcome = 'published';

CREATE TABLE aic.mvp_document_replays (
  organization_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  case_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('document/new','document/replace')),
  key text NOT NULL CHECK (key ~ '^[!-~]{1,200}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  document_id uuid NOT NULL,
  job_id uuid NOT NULL,
  response_status integer NOT NULL CHECK (response_status = 202),
  response_body jsonb NOT NULL CHECK (jsonb_typeof(response_body) = 'object'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, actor_id, case_id, operation, key),
  FOREIGN KEY (organization_id, actor_id) REFERENCES aic.users(organization_id, id),
  FOREIGN KEY (organization_id, case_id, document_id)
    REFERENCES aic.mvp_documents(organization_id, case_id, id),
  FOREIGN KEY (organization_id, case_id, job_id)
    REFERENCES aic.mvp_document_jobs(organization_id, case_id, id),
  CHECK (expires_at > created_at)
);

CREATE FUNCTION aic.reject_mvp_document_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MVP document records are immutable';
END;
$$;
REVOKE EXECUTE ON FUNCTION aic.reject_mvp_document_mutation() FROM PUBLIC;
CREATE TRIGGER mvp_document_objects_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_document_objects FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_document_mutation();
CREATE TRIGGER mvp_documents_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_documents FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_document_mutation();
CREATE TRIGGER mvp_document_results_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_document_results FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_document_mutation();
-- Expiry disables replay. It never authorizes deletion or reuse of a key.
CREATE TRIGGER mvp_document_replays_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_document_replays FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_document_mutation();
-- aic.audit_events already has an append-only UPDATE/DELETE/TRUNCATE trigger (0001).

-- Explicit operator grants (replace role identifiers outside this migration):
-- API: SELECT on the six mvp tables, INSERT on all except results, UPDATE(current_document_id)
-- on lineages. Worker: SELECT on mvp tables/cases, INSERT on results, UPDATE on jobs.
-- Shared: UPDATE(revision,updated_at) on cases, INSERT on audit_events.
-- API EXECUTE: existing lock_active_session(uuid,uuid,uuid,bigint) and
-- lock_case_access(uuid,uuid,uuid). No users/membership UPDATE is needed or intended.
-- Worker case/job FOR UPDATE requires the above cases/jobs UPDATE, never a user session.
-- No new SECURITY DEFINER functions, PUBLIC grants, policies, or automatic data seeds.
