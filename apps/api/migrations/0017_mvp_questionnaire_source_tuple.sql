-- The form/question pair must belong to the exact response revision, not just
-- independently exist in the same case. Declarations/documents have NULL here.
ALTER TABLE aic.mvp_staff_responses ADD CONSTRAINT mvp_response_source_tuple
  UNIQUE(organization_id,case_id,id,revision,questionnaire_id,question_id);
ALTER TABLE aic.mvp_exposure_source_bindings ADD CONSTRAINT mvp_questionnaire_source_tuple_fk
  FOREIGN KEY(organization_id,case_id,response_id,response_revision,questionnaire_id,question_id)
  REFERENCES aic.mvp_staff_responses(organization_id,case_id,id,revision,questionnaire_id,question_id);
