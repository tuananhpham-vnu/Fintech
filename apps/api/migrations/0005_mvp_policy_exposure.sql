-- Owner-approved sandbox persistence boundary; no artifact/assignment data is seeded.
-- Runtime case/Exposure validation and approval provenance belong to the service.
CREATE TABLE aic.mvp_policy_artifacts (
  version text PRIMARY KEY CHECK (length(version) BETWEEN 1 AND 200 AND btrim(version) <> ''),
  sha256 text NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  artifact_json jsonb NOT NULL CHECK (jsonb_typeof(artifact_json) = 'object'),
  approved_at timestamptz NOT NULL CHECK (isfinite(approved_at)),
  effective_from timestamptz NOT NULL CHECK (isfinite(effective_from)),
  UNIQUE (version, sha256)
);

CREATE TABLE aic.mvp_policy_assignments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES aic.organizations(id),
  policy_version text NOT NULL,
  artifact_hash text NOT NULL,
  exposure_kind text NOT NULL CHECK (exposure_kind IN ('RECEIVABLE','PREPAYMENT')),
  effective_from timestamptz NOT NULL CHECK (isfinite(effective_from)),
  effective_until timestamptz CHECK (effective_until IS NULL OR
    (isfinite(effective_until) AND effective_until > effective_from)),
  FOREIGN KEY (policy_version, artifact_hash) REFERENCES aic.mvp_policy_artifacts(version, sha256)
);
CREATE INDEX mvp_policy_assignments_lookup_idx
  ON aic.mvp_policy_assignments(organization_id, exposure_kind, effective_from);

CREATE FUNCTION aic.check_mvp_policy_assignment() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog AS $$
DECLARE
  artifact_effective timestamptz;
BEGIN
  -- A repeatable-read snapshot cannot refresh after an advisory-lock wait. Fail
  -- closed there; READ COMMITTED refreshes and SERIALIZABLE provides SSI checks.
  IF pg_catalog.current_setting('transaction_isolation') = 'repeatable read' THEN
    RAISE EXCEPTION USING ERRCODE = '0A000',
      MESSAGE = 'Policy assignment requires read committed or serializable isolation';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'mvp_policy_assignment:' || NEW.organization_id::text || ':' || NEW.exposure_kind, 0));
  SELECT a.effective_from INTO artifact_effective FROM aic.mvp_policy_artifacts AS a
    WHERE a.version = NEW.policy_version AND a.sha256 = NEW.artifact_hash;
  -- A missing/mismatched artifact is left to the declarative composite FK.
  IF FOUND AND NEW.effective_from < artifact_effective THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Assignment precedes artifact effectiveness',
      CONSTRAINT = 'mvp_policy_assignment_artifact_effective';
  END IF;
  IF EXISTS (
    SELECT 1 FROM aic.mvp_policy_assignments AS a
    WHERE a.organization_id = NEW.organization_id AND a.exposure_kind = NEW.exposure_kind
      AND (NEW.effective_until IS NULL OR a.effective_from < NEW.effective_until)
      AND (a.effective_until IS NULL OR NEW.effective_from < a.effective_until)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23P01', MESSAGE = 'Policy assignment intervals overlap',
      CONSTRAINT = 'mvp_policy_assignments_no_overlap';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION aic.check_mvp_policy_assignment() FROM PUBLIC;
CREATE TRIGGER mvp_policy_assignment_valid BEFORE INSERT ON aic.mvp_policy_assignments
  FOR EACH ROW EXECUTE FUNCTION aic.check_mvp_policy_assignment();

ALTER TABLE aic.cases ADD COLUMN policy_artifact_hash text
  CHECK (policy_artifact_hash IS NULL OR policy_artifact_hash ~ '^[0-9a-f]{64}$');
-- Historical NULL hashes remain NULL; new pinned versions must reference exact content.
ALTER TABLE aic.cases ADD CONSTRAINT cases_policy_artifact_fk
  FOREIGN KEY (policy_version, policy_artifact_hash) REFERENCES aic.mvp_policy_artifacts(version, sha256);
CREATE FUNCTION aic.reject_mvp_case_policy_hash_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.policy_artifact_hash IS DISTINCT FROM OLD.policy_artifact_hash THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Case policy artifact hash is immutable',
      CONSTRAINT = 'cases_policy_artifact_hash_immutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION aic.reject_mvp_case_policy_hash_change() FROM PUBLIC;
CREATE TRIGGER cases_policy_artifact_hash_immutable BEFORE UPDATE ON aic.cases
  FOR EACH ROW EXECUTE FUNCTION aic.reject_mvp_case_policy_hash_change();

CREATE TABLE aic.mvp_exposure_versions (
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  source_id uuid NOT NULL UNIQUE,
  aggregate_json jsonb NOT NULL CHECK (jsonb_typeof(aggregate_json) = 'object'),
  entered_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, case_id, revision),
  UNIQUE (organization_id, case_id, source_id),
  FOREIGN KEY (organization_id, case_id) REFERENCES aic.cases(organization_id, id),
  FOREIGN KEY (organization_id, entered_by) REFERENCES aic.users(organization_id, id)
);

CREATE TABLE aic.mvp_exposure_source_bindings (
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  exposure_revision bigint NOT NULL,
  binding_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('declaration','document')),
  source_id uuid NOT NULL,
  document_version integer,
  document_sha256 text,
  evidence_ref text,
  reported_by text NOT NULL CHECK (reported_by IN ('organization','counterparty')),
  -- Callers insert only the frozen fields above. Generated nullable keys make the
  -- polymorphic source checks real tenant/case-scoped FKs without trigger DML.
  document_id uuid GENERATED ALWAYS AS (CASE WHEN source_kind = 'document' THEN source_id END) STORED,
  declaration_id uuid GENERATED ALWAYS AS (CASE WHEN source_kind = 'declaration' THEN source_id END) STORED,
  PRIMARY KEY (organization_id, case_id, exposure_revision, binding_id),
  CHECK ((source_kind = 'document' AND document_version IS NOT NULL AND document_version > 0
      AND document_sha256 IS NOT NULL AND document_sha256 ~ '^[0-9a-f]{64}$') OR
    (source_kind = 'declaration' AND document_version IS NULL AND document_sha256 IS NULL AND evidence_ref IS NULL)),
  FOREIGN KEY (organization_id, case_id, exposure_revision)
    REFERENCES aic.mvp_exposure_versions(organization_id, case_id, revision),
  FOREIGN KEY (organization_id, case_id, document_id, document_version, document_sha256)
    REFERENCES aic.mvp_documents(organization_id, case_id, id, version, hash),
  FOREIGN KEY (organization_id, case_id, declaration_id)
    REFERENCES aic.mvp_exposure_versions(organization_id, case_id, source_id)
);

CREATE FUNCTION aic.reject_mvp_policy_exposure_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MVP policy and Exposure records are immutable';
END;
$$;
REVOKE EXECUTE ON FUNCTION aic.reject_mvp_policy_exposure_mutation() FROM PUBLIC;
CREATE TRIGGER mvp_policy_artifacts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_policy_artifacts FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_policy_exposure_mutation();
CREATE TRIGGER mvp_policy_assignments_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_policy_assignments FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_policy_exposure_mutation();
CREATE TRIGGER mvp_exposure_versions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_exposure_versions FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_policy_exposure_mutation();
CREATE TRIGGER mvp_exposure_source_bindings_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_exposure_source_bindings FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_policy_exposure_mutation();

-- Operator owns artifact/assignment INSERT. Runtime: SELECT on these four tables;
-- INSERT on exposure versions/bindings only, once the authorized service is wired.
-- No new SECURITY DEFINER functions, users/membership DML grants, seed, expiry
-- updates, sliding TTL, or automatic purging. Replay TTL is explicit service config.
