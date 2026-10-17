ALTER TABLE aic.mvp_document_decisions DROP CONSTRAINT mvp_document_decisions_kind_check;
ALTER TABLE aic.mvp_document_decisions ADD CONSTRAINT mvp_document_decisions_kind_check CHECK(kind IN ('classification','correction','verification'));
