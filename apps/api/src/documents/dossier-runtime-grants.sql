-- Explicit operator action AFTER 0018 in a selected sandbox, never API startup.
-- Uses the existing API/intake role (not the extraction-only worker role).
-- psql -v api_role=your_existing_api_role -f dossier-runtime-grants.sql
GRANT SELECT,INSERT ON aic.mvp_dossier_archives,aic.mvp_dossier_archive_objects,
  aic.mvp_dossier_members,aic.mvp_dossier_member_objects TO :"api_role";
GRANT UPDATE(state,parse_attempts,fence,worker_id,lease_expires_at,error_code,updated_at)
  ON aic.mvp_dossier_archives TO :"api_role";
GRANT UPDATE(state,attempts,page_count,document_id,job_id,error_code,retryable)
  ON aic.mvp_dossier_members TO :"api_role";
GRANT UPDATE(dossier_intake_pending) ON aic.cases TO :"api_role";
-- Existing runtime grants cover canonical document inserts, case revisions,
-- audit, replay, ACL functions and source reads. No DELETE/DDL or PUBLIC grants.
