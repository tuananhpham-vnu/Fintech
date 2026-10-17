-- Additive local dossier intake. No seeds, auto grants, policy or FHI changes.
ALTER TABLE aic.cases ADD COLUMN dossier_intake_pending integer NOT NULL DEFAULT 0
  CHECK (dossier_intake_pending BETWEEN 0 AND 4);
ALTER TABLE aic.mvp_document_lineages ADD COLUMN capacity_class text NOT NULL DEFAULT 'legacy'
  CHECK (capacity_class IN ('legacy','dossier'));
ALTER TABLE aic.mvp_document_jobs ADD CONSTRAINT mvp_document_job_dossier_source_key
  UNIQUE (organization_id,case_id,id,document_id);
ALTER TABLE aic.mvp_documents ADD CONSTRAINT mvp_document_dossier_bytes_key
  UNIQUE (organization_id,case_id,id,hash,byte_size);

CREATE TABLE aic.mvp_dossier_archives (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  created_by uuid NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 33554432),
  ai_mode text NOT NULL CHECK (ai_mode IN ('live','mock')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','validating','registering','accepted','partially_accepted','rejected')),
  parse_attempts integer NOT NULL DEFAULT 0 CHECK (parse_attempts BETWEEN 0 AND 3),
  fence bigint NOT NULL DEFAULT 0 CHECK (fence BETWEEN 0 AND 9007199254740991),
  worker_id text,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id,case_id,id),
  FOREIGN KEY (organization_id,case_id) REFERENCES aic.cases(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES aic.users(organization_id,id),
  CHECK ((worker_id IS NULL) = (lease_expires_at IS NULL))
);
CREATE TABLE aic.mvp_dossier_archive_objects (
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  archive_id uuid NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 33554432),
  PRIMARY KEY (organization_id,case_id,archive_id),
  FOREIGN KEY (organization_id,case_id,archive_id) REFERENCES aic.mvp_dossier_archives(organization_id,case_id,id),
  CHECK (encode(sha256(bytes),'hex')=sha256)
);
CREATE TABLE aic.mvp_dossier_members (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  archive_id uuid NOT NULL,
  entry_index integer NOT NULL CHECK (entry_index BETWEEN 0 AND 127),
  entry_path text NOT NULL CHECK (length(entry_path) BETWEEN 1 AND 512),
  path_key text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 0 AND 67108864),
  sha256 text CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  detected_mime text CHECK (detected_mime IS NULL OR detected_mime='application/pdf'),
  suggested_type text NOT NULL CHECK (suggested_type IN ('registration','loan_request','financial_statement','contract','acceptance_record','payment_record','invoice','other')),
  group_name text NOT NULL CHECK (group_name IN ('financial_statements','contracts','tax','payments','other')),
  year_hint integer CHECK (year_hint BETWEEN 1900 AND 2100),
  state text NOT NULL CHECK (state IN ('awaiting_inspection','inspecting','registered','rejected','needs_review')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  page_count integer CHECK (page_count>0),
  document_id uuid,
  job_id uuid,
  error_code text,
  retryable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id,case_id,archive_id,entry_index),
  UNIQUE (organization_id,case_id,archive_id,path_key),
  UNIQUE (organization_id,case_id,id),
  UNIQUE (organization_id,case_id,document_id),
  FOREIGN KEY (organization_id,case_id,archive_id) REFERENCES aic.mvp_dossier_archives(organization_id,case_id,id),
  FOREIGN KEY (organization_id,case_id,document_id) REFERENCES aic.mvp_documents(organization_id,case_id,id),
  FOREIGN KEY (organization_id,case_id,document_id,sha256,byte_size) REFERENCES aic.mvp_documents(organization_id,case_id,id,hash,byte_size),
  FOREIGN KEY (organization_id,case_id,job_id) REFERENCES aic.mvp_document_jobs(organization_id,case_id,id),
  FOREIGN KEY (organization_id,case_id,job_id,document_id) REFERENCES aic.mvp_document_jobs(organization_id,case_id,id,document_id),
  CHECK ((document_id IS NULL) = (job_id IS NULL)),
  CHECK ((state='registered') = (document_id IS NOT NULL)),
  CHECK (state NOT IN ('awaiting_inspection','inspecting','registered','needs_review') OR sha256 IS NOT NULL)
);
CREATE TABLE aic.mvp_dossier_member_objects (
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  member_id uuid NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 10485760),
  PRIMARY KEY (organization_id,case_id,member_id),
  FOREIGN KEY (organization_id,case_id,member_id) REFERENCES aic.mvp_dossier_members(organization_id,case_id,id),
  CHECK (encode(sha256(bytes),'hex')=sha256)
);
CREATE INDEX mvp_dossier_archives_pending_idx ON aic.mvp_dossier_archives(state,updated_at,id);
CREATE INDEX mvp_dossier_members_pending_idx ON aic.mvp_dossier_members(archive_id,state,entry_index);
CREATE TRIGGER mvp_dossier_archive_bytes_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_dossier_archive_objects FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_document_mutation();
CREATE TRIGGER mvp_dossier_member_bytes_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON aic.mvp_dossier_member_objects FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_document_mutation();
CREATE TRIGGER mvp_dossier_archives_no_delete BEFORE DELETE OR TRUNCATE
  ON aic.mvp_dossier_archives FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_document_mutation();
CREATE TRIGGER mvp_dossier_members_no_delete BEFORE DELETE OR TRUNCATE
  ON aic.mvp_dossier_members FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_document_mutation();

CREATE FUNCTION aic.guard_dossier_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='mvp_dossier_archives' THEN
    IF ROW(NEW.id,NEW.organization_id,NEW.case_id,NEW.created_by,NEW.sha256,NEW.byte_size,NEW.ai_mode,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.case_id,OLD.created_by,OLD.sha256,OLD.byte_size,OLD.ai_mode,OLD.created_at)
    THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Dossier archive identity is immutable'; END IF;
  ELSE
    IF OLD.document_id IS NOT NULL AND ROW(NEW.document_id,NEW.job_id) IS DISTINCT FROM ROW(OLD.document_id,OLD.job_id)
    THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Dossier source association is immutable'; END IF;
    IF ROW(NEW.id,NEW.organization_id,NEW.case_id,NEW.archive_id,NEW.entry_index,NEW.entry_path,NEW.path_key,
      NEW.byte_size,NEW.sha256,NEW.detected_mime,NEW.suggested_type,NEW.group_name,NEW.year_hint,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.case_id,OLD.archive_id,OLD.entry_index,OLD.entry_path,OLD.path_key,
      OLD.byte_size,OLD.sha256,OLD.detected_mime,OLD.suggested_type,OLD.group_name,OLD.year_hint,OLD.created_at)
    THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Dossier member identity is immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mvp_dossier_archive_identity BEFORE UPDATE ON aic.mvp_dossier_archives
  FOR EACH ROW EXECUTE FUNCTION aic.guard_dossier_identity();
CREATE TRIGGER mvp_dossier_member_identity BEFORE UPDATE ON aic.mvp_dossier_members
  FOR EACH ROW EXECUTE FUNCTION aic.guard_dossier_identity();

CREATE FUNCTION aic.guard_dossier_capacity_class() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.capacity_class<>OLD.capacity_class THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Document capacity class is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mvp_document_capacity_class_immutable BEFORE UPDATE ON aic.mvp_document_lineages
  FOR EACH ROW EXECUTE FUNCTION aic.guard_dossier_capacity_class();
