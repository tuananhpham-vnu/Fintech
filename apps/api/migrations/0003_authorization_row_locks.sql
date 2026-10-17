-- Narrow authorization locks for a runtime role without users/membership UPDATE.
-- The migration owner retains execution. Operator/test setup must explicitly grant
-- EXECUTE on the required signatures to its runtime role; no runtime grants here.
-- These functions only select/lock rows in the caller's transaction; no data writes.

CREATE FUNCTION aic.lock_login_user(p_username text) RETURNS SETOF aic.users
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT u.*
  FROM aic.users AS u
  WHERE u.username = $1
  FOR SHARE OF u;
$$;

REVOKE EXECUTE ON FUNCTION aic.lock_login_user(text) FROM PUBLIC;

CREATE FUNCTION aic.lock_case_access(p_org uuid, p_user uuid, p_case uuid)
RETURNS SETOF aic.cases
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT c.*
  FROM aic.cases AS c
  JOIN aic.case_memberships AS m
    ON m.organization_id = c.organization_id
    AND m.case_id = c.id
    AND m.user_id = $2
  JOIN aic.users AS u
    ON u.organization_id = m.organization_id
    AND u.id = m.user_id
    AND u.disabled_at IS NULL
  WHERE c.organization_id = $1 AND c.id = $3
  FOR UPDATE OF c
  FOR SHARE OF m, u;
$$;

REVOKE EXECUTE ON FUNCTION aic.lock_case_access(uuid, uuid, uuid) FROM PUBLIC;

CREATE FUNCTION aic.lock_active_session(
  p_session uuid, p_user uuid, p_org uuid, p_idle_ms bigint
) RETURNS TABLE (id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT s.id
  FROM aic.sessions AS s
  JOIN aic.users AS u
    ON u.organization_id = s.organization_id
    AND u.id = s.user_id
    AND u.disabled_at IS NULL
  WHERE s.id = $1
    AND s.user_id = $2
    AND s.organization_id = $3
    AND s.revoked_at IS NULL
    AND s.expires_at > pg_catalog.clock_timestamp()
    AND s.last_seen_at > pg_catalog.clock_timestamp() - ($4 * INTERVAL '1 millisecond')
  FOR SHARE OF s, u;
$$;

REVOKE EXECUTE ON FUNCTION aic.lock_active_session(uuid, uuid, uuid, bigint) FROM PUBLIC;
