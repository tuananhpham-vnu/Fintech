-- Fix exact declaration revision binding; older migration checks only tenant/case.
ALTER TABLE aic.mvp_exposure_versions ADD CONSTRAINT mvp_exposure_source_revision_unique
  UNIQUE(organization_id,case_id,revision,source_id);
ALTER TABLE aic.mvp_exposure_source_bindings ADD CONSTRAINT mvp_declaration_exact_revision_fk
  FOREIGN KEY(organization_id,case_id,exposure_revision,declaration_id)
  REFERENCES aic.mvp_exposure_versions(organization_id,case_id,revision,source_id);

-- Fixed scope row lock, not general counterparty mutation authority.
CREATE FUNCTION aic.lock_case_counterparty(org uuid, actor uuid, counterparty uuid)
RETURNS TABLE(id uuid) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT c.id FROM aic.counterparties c
  JOIN aic.users u ON u.organization_id=c.organization_id AND u.id=actor AND u.disabled_at IS NULL
  WHERE c.organization_id=org AND c.id=counterparty FOR SHARE OF c,u
$$;
REVOKE EXECUTE ON FUNCTION aic.lock_case_counterparty(uuid,uuid,uuid) FROM PUBLIC;
