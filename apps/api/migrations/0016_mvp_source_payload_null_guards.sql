-- CHECK treats UNKNOWN as passing. Require a fully true branch so missing
-- document/response versions cannot bypass the exact-source foreign keys.
ALTER TABLE aic.mvp_exposure_source_bindings DROP CONSTRAINT mvp_source_payload;
ALTER TABLE aic.mvp_exposure_source_bindings ADD CONSTRAINT mvp_source_payload CHECK ((
  (source_kind='document'
    AND document_version IS NOT NULL AND document_version>0
    AND document_sha256 IS NOT NULL AND document_sha256 ~ '^[0-9a-f]{64}$'
    AND response_revision IS NULL AND questionnaire_id IS NULL AND question_id IS NULL)
  OR (source_kind='declaration'
    AND document_version IS NULL AND document_sha256 IS NULL AND evidence_ref IS NULL
    AND response_revision IS NULL AND questionnaire_id IS NULL AND question_id IS NULL)
  OR (source_kind='questionnaire'
    AND document_version IS NULL AND document_sha256 IS NULL AND evidence_ref IS NULL
    AND response_revision IS NOT NULL AND response_revision>0
    AND questionnaire_id IS NOT NULL AND question_id IS NOT NULL)
) IS TRUE);
