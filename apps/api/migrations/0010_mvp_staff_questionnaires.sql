-- Owner approved supplementary optional text questions. These never satisfy
-- document requirements, financial minimums, identity or payment verification.
CREATE TABLE aic.mvp_questionnaires (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  questions jsonb NOT NULL CHECK(jsonb_typeof(questions)='array' AND jsonb_array_length(questions) BETWEEN 1 AND 20),
  policy_version text NOT NULL CHECK(policy_version='MVP-OPTIONAL-TEXT-1'),
  case_revision bigint NOT NULL CHECK(case_revision BETWEEN 1 AND 9007199254740991),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(organization_id,case_id,id),
  FOREIGN KEY(organization_id,case_id) REFERENCES aic.cases(organization_id,id),
  FOREIGN KEY(organization_id,actor_id) REFERENCES aic.users(organization_id,id)
);
CREATE TABLE aic.mvp_staff_responses (
  id uuid NOT NULL,
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  questionnaire_id uuid NOT NULL,
  question_id uuid NOT NULL,
  question_version integer NOT NULL CHECK(question_version=1),
  answer_state text NOT NULL CHECK(answer_state IN ('submitted','self_assessed','skipped')),
  answer_json jsonb NOT NULL,
  origin text NOT NULL CHECK(origin='staff_transcribed'),
  reported_by text NOT NULL CHECK(reported_by IN ('organization','counterparty')),
  reported_reference text NOT NULL CHECK(btrim(reported_reference)<>''),
  source_refs jsonb NOT NULL CHECK(jsonb_typeof(source_refs)='array'),
  reason text NOT NULL CHECK(btrim(reason)<>''),
  case_revision bigint NOT NULL CHECK(case_revision BETWEEN 1 AND 9007199254740991),
  entered_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(id,revision),
  UNIQUE(organization_id,case_id,id,revision),
  UNIQUE(organization_id,case_id,questionnaire_id,question_id,revision),
  CHECK((answer_state='skipped' AND answer_json='null'::jsonb) OR
    (answer_state<>'skipped' AND jsonb_typeof(answer_json)='string' AND btrim(answer_json#>>'{}')<>'')),
  FOREIGN KEY(organization_id,case_id,questionnaire_id) REFERENCES aic.mvp_questionnaires(organization_id,case_id,id),
  FOREIGN KEY(organization_id,entered_by) REFERENCES aic.users(organization_id,id)
);
CREATE TABLE aic.mvp_response_verifications (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  response_id uuid NOT NULL,
  response_revision bigint NOT NULL,
  status text NOT NULL CHECK(status IN ('unverified','verified','conflicting')),
  reason text NOT NULL CHECK(btrim(reason)<>''),
  evidence_refs jsonb NOT NULL CHECK(jsonb_typeof(evidence_refs)='array'),
  source_snapshot_hash text NOT NULL CHECK(source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  case_revision bigint NOT NULL CHECK(case_revision BETWEEN 1 AND 9007199254740991),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(organization_id,case_id,response_id,response_revision) REFERENCES aic.mvp_staff_responses(organization_id,case_id,id,revision),
  FOREIGN KEY(organization_id,actor_id) REFERENCES aic.users(organization_id,id),
  UNIQUE(organization_id,case_id,case_revision)
);
CREATE INDEX mvp_staff_responses_read_idx ON aic.mvp_staff_responses(organization_id,case_id,questionnaire_id,question_id,revision DESC);
CREATE INDEX mvp_response_verification_read_idx ON aic.mvp_response_verifications(organization_id,case_id,response_id,response_revision,case_revision DESC);
CREATE TRIGGER mvp_questionnaires_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_questionnaires
  FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER mvp_staff_responses_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_staff_responses
  FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER mvp_response_verifications_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.mvp_response_verifications
  FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
