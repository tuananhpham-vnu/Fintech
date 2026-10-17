-- PH1-DB: frozen core only. aic/schema_migrations are bootstrapped by migrate.ts.
-- UUID defaults run on PostgreSQL (13+); callers may also supply server-created UUIDs.
-- Creator membership is approved only within the same organization/creation transaction.
-- Public case creation remains BLOCKED: no approved policy selection or complete Exposure
-- conditions/claims/source schema. JSON storage and these checks do not release write APIs.

CREATE TABLE aic.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  tax_id text,
  country text NOT NULL DEFAULT 'VN' CHECK (btrim(country) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE aic.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES aic.organizations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  username text NOT NULL UNIQUE CHECK (btrim(username) <> ''),
  password_hash text NOT NULL CHECK (btrim(password_hash) <> ''),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  role text NOT NULL CHECK (role = 'specialist'),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TABLE aic.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES aic.organizations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_hash char(64) NOT NULL CHECK (csrf_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, user_id) REFERENCES aic.users(organization_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE aic.counterparties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES aic.organizations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  name text NOT NULL CHECK (btrim(name) <> ''),
  country text NOT NULL CHECK (btrim(country) <> ''),
  tax_id text,
  industry_code text,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_refs) = 'array'),
  identity_status text NOT NULL DEFAULT 'unresolved'
    CHECK (identity_status IN ('unresolved', 'confirmed', 'conflicting')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX counterparties_tax_identity_unique
  ON aic.counterparties (organization_id, country, tax_id) WHERE tax_id IS NOT NULL;
CREATE INDEX counterparties_org_updated_id_idx
  ON aic.counterparties (organization_id, updated_at DESC, id DESC);

CREATE TABLE aic.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES aic.organizations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  counterparty_id uuid NOT NULL,
  exposure_kind text NOT NULL CHECK (exposure_kind IN ('RECEIVABLE', 'PREPAYMENT', 'LOAN', 'DEBT_INVESTMENT')),
  lifecycle_stage text NOT NULL CHECK (lifecycle_stage IN ('proposed', 'active')),
  exposure_json jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  policy_version text NOT NULL CHECK (btrim(policy_version) <> ''),
  method_version text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, counterparty_id) REFERENCES aic.counterparties(organization_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES aic.users(organization_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cases_exposure_object CHECK (jsonb_typeof(exposure_json) = 'object'),
  -- IS TRUE is deliberate: absent or JSON-null required fields must fail CHECK too.
  CONSTRAINT cases_exposure_amount CHECK ((
    jsonb_typeof(exposure_json -> 'amount_vnd') = 'string'
    AND (exposure_json ->> 'amount_vnd') ~ '^[1-9][0-9]{0,23}$'
  ) IS TRUE),
  CONSTRAINT cases_exposure_roles CHECK ((
    CASE exposure_kind
      WHEN 'RECEIVABLE' THEN exposure_json ->> 'organization_role' = 'seller'
        AND exposure_json ->> 'counterparty_role' = 'buyer'
      WHEN 'PREPAYMENT' THEN exposure_json ->> 'organization_role' = 'buyer'
        AND exposure_json ->> 'counterparty_role' = 'seller'
      WHEN 'LOAN' THEN exposure_json ->> 'organization_role' = 'lender'
        AND exposure_json ->> 'counterparty_role' = 'borrower'
      WHEN 'DEBT_INVESTMENT' THEN exposure_json ->> 'organization_role' = 'investor'
        AND exposure_json ->> 'counterparty_role' = 'issuer'
      ELSE false
    END
  ) IS TRUE),
  -- term_days is required but may be JSON null. Null-explanation shape is pending.
  CONSTRAINT cases_exposure_term CHECK (
    CASE
      WHEN NOT (exposure_json ? 'term_days') THEN false
      WHEN exposure_json -> 'term_days' = 'null'::jsonb THEN true
      WHEN jsonb_typeof(exposure_json -> 'term_days') = 'number' THEN
        (exposure_json ->> 'term_days')::numeric BETWEEN 0 AND 9007199254740991
        AND trunc((exposure_json ->> 'term_days')::numeric) = (exposure_json ->> 'term_days')::numeric
      ELSE false
    END
  )
);

CREATE INDEX cases_org_updated_id_idx ON aic.cases (organization_id, updated_at DESC, id DESC);
CREATE INDEX cases_counterparty_idx ON aic.cases (organization_id, counterparty_id);
CREATE INDEX cases_creator_idx ON aic.cases (organization_id, created_by);

CREATE TABLE aic.case_memberships (
  organization_id uuid NOT NULL REFERENCES aic.organizations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  case_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, user_id),
  FOREIGN KEY (organization_id, case_id) REFERENCES aic.cases(organization_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, user_id) REFERENCES aic.users(organization_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, granted_by) REFERENCES aic.users(organization_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX case_memberships_user_idx ON aic.case_memberships (organization_id, user_id, case_id);
CREATE INDEX case_memberships_grantor_idx ON aic.case_memberships (organization_id, granted_by);
CREATE INDEX sessions_user_idx ON aic.sessions (organization_id, user_id);

CREATE TABLE aic.idempotency_keys (
  organization_id uuid NOT NULL REFERENCES aic.organizations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK (btrim(operation) <> ''),
  key text NOT NULL CHECK (btrim(key) <> ''),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_status integer NOT NULL CHECK (response_status BETWEEN 100 AND 599),
  response_body jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, actor_id, operation, key),
  FOREIGN KEY (organization_id, actor_id) REFERENCES aic.users(organization_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE aic.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES aic.organizations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  case_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN ('specialist', 'operator')),
  actor_id uuid,
  action text NOT NULL CHECK (btrim(action) <> ''),
  subject_id uuid,
  revision_before bigint CHECK (revision_before BETWEEN 1 AND 9007199254740991),
  revision_after bigint CHECK (revision_after BETWEEN 1 AND 9007199254740991),
  reason text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_type <> 'specialist' OR actor_id IS NOT NULL),
  FOREIGN KEY (organization_id, case_id) REFERENCES aic.cases(organization_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_id) REFERENCES aic.users(organization_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX audit_events_case_created_id_idx ON aic.audit_events (case_id, created_at DESC, id DESC);
CREATE INDEX audit_events_org_created_id_idx ON aic.audit_events (organization_id, created_at DESC, id DESC);
CREATE INDEX audit_events_actor_idx ON aic.audit_events (organization_id, actor_id);

CREATE FUNCTION aic.reject_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Audit events are append-only';
END;
$$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_audit_event_mutation();

-- One SHA-256 account+IP bucket. Only failed logins count; auth owns window/block logic.
-- No production throttle thresholds, global-IP buckets, or automatic resets are defined here.
CREATE TABLE aic.login_attempts (
  bucket_hash char(64) PRIMARY KEY CHECK (bucket_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts >= 0),
  blocked_until timestamptz
);
