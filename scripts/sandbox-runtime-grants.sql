-- Explicit operator psql invocation, against the freshly migrated sandbox only:
-- psql ... -v api_role=aic_mvp_api -v worker_role=aic_mvp_worker -f this-file
-- Roles/passwords are provisioned separately; no credentials or CREATE ROLE here.
-- Both roles must be NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT, not table owners.
GRANT USAGE ON SCHEMA aic TO :"api_role", :"worker_role";
GRANT EXECUTE ON FUNCTION aic.lock_case_source_counterparty(uuid,uuid) TO :"api_role", :"worker_role";
GRANT SELECT ON ALL TABLES IN SCHEMA aic TO :"api_role";
GRANT SELECT ON aic.schema_migrations,aic.cases,aic.counterparties,aic.mvp_document_objects,aic.mvp_document_lineages,
  aic.mvp_documents,aic.mvp_document_jobs,aic.mvp_document_results,aic.mvp_document_decisions TO :"worker_role";
GRANT INSERT,UPDATE ON aic.sessions,aic.login_attempts TO :"api_role";
GRANT INSERT ON aic.counterparties,aic.mvp_counterparty_versions,aic.mvp_invitations,aic.mvp_invitation_revocations,
  aic.mvp_questionnaire_events,aic.mvp_respondent_submissions,aic.mvp_financial_sets,aic.mvp_financial_facts,aic.mvp_financial_verifications,aic.mvp_financial_source_bindings TO :"api_role";
GRANT INSERT,UPDATE ON aic.mvp_capability_limits TO :"api_role";
GRANT UPDATE(name,country,tax_id,industry_code,source_refs,identity_status,revision,updated_at) ON aic.counterparties TO :"api_role";
GRANT UPDATE(state,retryable,error_code,updated_at) ON aic.mvp_document_jobs TO :"api_role";
GRANT INSERT ON aic.idempotency_keys TO :"api_role";
GRANT INSERT ON aic.cases TO :"api_role";
GRANT UPDATE(exposure_json,revision,updated_at) ON aic.cases TO :"api_role";
GRANT UPDATE(revision,updated_at) ON aic.cases TO :"worker_role";
GRANT INSERT ON aic.audit_events TO :"api_role", :"worker_role";
GRANT EXECUTE ON FUNCTION aic.lock_login_user(text),aic.lock_case_access(uuid,uuid,uuid),
  aic.lock_active_session(uuid,uuid,uuid,bigint),aic.lock_case_counterparty(uuid,uuid,uuid) TO :"api_role";
GRANT INSERT ON aic.mvp_issue_decisions,aic.mvp_exposure_versions,aic.mvp_exposure_source_bindings,
  aic.mvp_questionnaires,aic.mvp_staff_responses,aic.mvp_response_verifications,
  aic.mvp_document_objects,aic.mvp_document_lineages,aic.mvp_documents,aic.mvp_document_jobs,
  aic.mvp_document_replays,aic.mvp_document_decisions,aic.mvp_review_runs,aic.mvp_document_requests,
  aic.mvp_request_history,aic.mvp_response_bindings,aic.mvp_waivers,aic.mvp_waiver_revocations TO :"api_role";
GRANT UPDATE(current_document_id) ON aic.mvp_document_lineages TO :"api_role";
GRANT UPDATE(status,revision,purpose,content,document_types,approved_payload,approved_export,approved_hash,updated_at)
  ON aic.mvp_document_requests TO :"api_role";
GRANT INSERT ON aic.mvp_document_results TO :"worker_role";
GRANT UPDATE(state,attempts,fence,worker_id,snapshot_case_revision,lease_expires_at,error_code,retryable,updated_at)
  ON aic.mvp_document_jobs TO :"worker_role";
