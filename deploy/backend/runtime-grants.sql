-- Privileges for the restricted runtime role used by the API and workers (production refuses owner/superuser
-- connections). Applied automatically by deploy/backend/predeploy.cjs after migrations, as the schema owner.
-- Idempotent. The role itself (LOGIN + password) is created once by you: deploy/supabase/create-runtime-role.sql
--
-- Scope: no DDL, no ownership, no DELETE/TRUNCATE (the application never deletes). Table-level SELECT/INSERT/UPDATE
-- is broader than the column-level grants in scripts/sandbox-runtime-grants.sql, which predate migrations
-- 0018-0023; the schema's immutability triggers still reject forbidden updates for every role.
GRANT USAGE ON SCHEMA aic TO aic_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA aic TO aic_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA aic TO aic_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA aic TO aic_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA aic GRANT SELECT, INSERT, UPDATE ON TABLES TO aic_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA aic GRANT USAGE, SELECT ON SEQUENCES TO aic_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA aic GRANT EXECUTE ON FUNCTIONS TO aic_runtime;
