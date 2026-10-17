CREATE TABLE aic.mvp_invitations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  questionnaire_id uuid NOT NULL,
  questionnaire_version integer NOT NULL CHECK(questionnaire_version=1),
  question_ids jsonb NOT NULL CHECK(jsonb_typeof(question_ids)='array' AND jsonb_array_length(question_ids) BETWEEN 1 AND 20),
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
  reported_by text NOT NULL CHECK(reported_by IN ('organization','counterparty')),
  recipient_reference text NOT NULL CHECK(btrim(recipient_reference)<>''),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid NOT NULL,
  UNIQUE(organization_id,case_id,id),
  CHECK(expires_at>created_at),
  FOREIGN KEY(organization_id,case_id,questionnaire_id) REFERENCES aic.mvp_questionnaires(organization_id,case_id,id),
  FOREIGN KEY(organization_id,created_by) REFERENCES aic.users(organization_id,id)
);
CREATE TABLE aic.mvp_invitation_revocations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  invitation_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  reason text NOT NULL CHECK(btrim(reason)<>''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(organization_id,case_id,invitation_id),
  FOREIGN KEY(organization_id,case_id,invitation_id) REFERENCES aic.mvp_invitations(organization_id,case_id,id),
  FOREIGN KEY(organization_id,actor_id) REFERENCES aic.users(organization_id,id)
);
CREATE TABLE aic.mvp_questionnaire_events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  questionnaire_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('published','closed')),
  actor_id uuid NOT NULL,
  case_revision bigint NOT NULL CHECK(case_revision BETWEEN 1 AND 9007199254740991),
  reason text NOT NULL CHECK(btrim(reason)<>''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(organization_id,case_id,questionnaire_id) REFERENCES aic.mvp_questionnaires(organization_id,case_id,id),
  FOREIGN KEY(organization_id,actor_id) REFERENCES aic.users(organization_id,id)
);
CREATE TABLE aic.mvp_respondent_submissions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  invitation_id uuid NOT NULL,
  key text NOT NULL CHECK(length(key) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  receipt_json jsonb NOT NULL CHECK(jsonb_typeof(receipt_json)='object'),
  replay_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(organization_id,case_id,invitation_id),
  FOREIGN KEY(organization_id,case_id,invitation_id) REFERENCES aic.mvp_invitations(organization_id,case_id,id)
);
CREATE TABLE aic.mvp_capability_limits (
  ip_hash text PRIMARY KEY CHECK(ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  count integer NOT NULL CHECK(count>0)
);
ALTER TABLE aic.mvp_staff_responses DROP CONSTRAINT mvp_staff_responses_origin_check;
ALTER TABLE aic.mvp_staff_responses ADD CONSTRAINT mvp_response_origin CHECK(origin IN ('staff_transcribed','SME_direct'));
ALTER TABLE aic.mvp_staff_responses ALTER COLUMN entered_by DROP NOT NULL;
ALTER TABLE aic.mvp_staff_responses ADD COLUMN invitation_id uuid;
ALTER TABLE aic.mvp_staff_responses ADD CONSTRAINT mvp_response_capability_fk
  FOREIGN KEY(organization_id,case_id,invitation_id) REFERENCES aic.mvp_invitations(organization_id,case_id,id);
ALTER TABLE aic.mvp_staff_responses ADD CONSTRAINT mvp_response_origin_actor CHECK(
  (origin='staff_transcribed' AND entered_by IS NOT NULL AND invitation_id IS NULL) OR
  (origin='SME_direct' AND entered_by IS NULL AND invitation_id IS NOT NULL));
ALTER TABLE aic.audit_events DROP CONSTRAINT audit_events_actor_type_check;
ALTER TABLE aic.audit_events ADD CONSTRAINT audit_events_actor_type_check CHECK(actor_type IN ('specialist','operator','capability'));
ALTER TABLE aic.audit_events ADD COLUMN capability_id uuid;
ALTER TABLE aic.audit_events ADD CONSTRAINT audit_capability_fk
  FOREIGN KEY(organization_id,case_id,capability_id) REFERENCES aic.mvp_invitations(organization_id,case_id,id);
ALTER TABLE aic.audit_events ADD CONSTRAINT audit_capability_actor CHECK(
  (actor_type='capability' AND capability_id IS NOT NULL AND actor_id IS NULL) OR (actor_type<>'capability' AND capability_id IS NULL));
CREATE TRIGGER mvp_invitations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_invitations FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER mvp_invitation_revocations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_invitation_revocations FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER mvp_questionnaire_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_questionnaire_events FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER mvp_respondent_submissions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_respondent_submissions FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
