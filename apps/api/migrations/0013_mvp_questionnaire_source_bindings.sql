ALTER TABLE aic.mvp_exposure_source_bindings DROP CONSTRAINT mvp_exposure_source_bindings_source_kind_check;
ALTER TABLE aic.mvp_exposure_source_bindings ADD CONSTRAINT mvp_source_kind CHECK(source_kind IN ('declaration','document','questionnaire'));
-- The earlier two-branch check applies to old source types. Preserve its
-- invariants and add an exact response revision branch without fake documents.
ALTER TABLE aic.mvp_exposure_source_bindings DROP CONSTRAINT mvp_exposure_source_bindings_check;
ALTER TABLE aic.mvp_exposure_source_bindings ADD COLUMN response_revision bigint;
ALTER TABLE aic.mvp_exposure_source_bindings ADD COLUMN questionnaire_id uuid;
ALTER TABLE aic.mvp_exposure_source_bindings ADD COLUMN question_id uuid;
ALTER TABLE aic.mvp_exposure_source_bindings ADD COLUMN response_id uuid GENERATED ALWAYS AS (CASE WHEN source_kind='questionnaire' THEN source_id END) STORED;
ALTER TABLE aic.mvp_exposure_source_bindings ADD CONSTRAINT mvp_source_payload CHECK(
  (source_kind='document' AND document_version>0 AND document_sha256 ~ '^[0-9a-f]{64}$' AND response_revision IS NULL AND questionnaire_id IS NULL AND question_id IS NULL) OR
  (source_kind='declaration' AND document_version IS NULL AND document_sha256 IS NULL AND evidence_ref IS NULL AND response_revision IS NULL AND questionnaire_id IS NULL AND question_id IS NULL) OR
  (source_kind='questionnaire' AND document_version IS NULL AND document_sha256 IS NULL AND evidence_ref IS NULL AND response_revision>0 AND questionnaire_id IS NOT NULL AND question_id IS NOT NULL));
ALTER TABLE aic.mvp_exposure_source_bindings ADD CONSTRAINT mvp_response_exact_source_fk
  FOREIGN KEY(organization_id,case_id,response_id,response_revision) REFERENCES aic.mvp_staff_responses(organization_id,case_id,id,revision);
ALTER TABLE aic.mvp_exposure_source_bindings ADD CONSTRAINT mvp_response_form_source_fk
  FOREIGN KEY(organization_id,case_id,questionnaire_id) REFERENCES aic.mvp_questionnaires(organization_id,case_id,id);
ALTER TABLE aic.mvp_document_jobs ADD COLUMN snapshot_counterparty_revision bigint CHECK(snapshot_counterparty_revision BETWEEN 1 AND 9007199254740991);
CREATE FUNCTION aic.lock_case_source_counterparty(org uuid,case_ref uuid)
RETURNS TABLE(revision bigint) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT p.revision FROM aic.counterparties p JOIN aic.cases c ON c.organization_id=p.organization_id AND c.counterparty_id=p.id
  WHERE c.organization_id=org AND c.id=case_ref FOR SHARE OF p
$$;
REVOKE EXECUTE ON FUNCTION aic.lock_case_source_counterparty(uuid,uuid) FROM PUBLIC;
