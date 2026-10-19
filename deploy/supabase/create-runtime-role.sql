-- Run ONCE in the Supabase SQL Editor, BEFORE the first Render deploy.
-- Put the password you generated (letters and digits only) between the quotes below, then click Run.
-- Do not save this query with the real password in it, and never commit it.
-- Creates the restricted login role the API and workers use. Privileges are granted automatically
-- by the Render pre-deploy step after migrations (deploy/backend/runtime-grants.sql).
CREATE ROLE aic_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  PASSWORD 'PASTE_GENERATED_PASSWORD';
