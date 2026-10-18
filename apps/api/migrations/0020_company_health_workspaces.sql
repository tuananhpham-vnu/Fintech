-- Schema expansion only. Existing records remain transaction cases and retain
-- their source/policy/history. See AIC-COMPANY-HEALTH-CONTRACT-V1.md for rollout.
ALTER TABLE aic.cases ADD COLUMN purpose text NOT NULL DEFAULT 'transaction'
  CHECK (purpose IN ('transaction','company_health'));
ALTER TABLE aic.cases ALTER COLUMN exposure_kind DROP NOT NULL;
ALTER TABLE aic.cases ALTER COLUMN lifecycle_stage DROP NOT NULL;
ALTER TABLE aic.cases ALTER COLUMN exposure_json DROP NOT NULL;
ALTER TABLE aic.cases ALTER COLUMN policy_version DROP NOT NULL;
ALTER TABLE aic.cases ADD CONSTRAINT cases_purpose_shape CHECK (
  (purpose='transaction' AND exposure_kind IS NOT NULL AND lifecycle_stage IS NOT NULL
    AND exposure_json IS NOT NULL AND policy_version IS NOT NULL)
  OR (purpose='company_health' AND exposure_kind IS NULL AND lifecycle_stage IS NULL
    AND exposure_json IS NULL AND policy_version IS NULL AND policy_artifact_hash IS NULL)
);

-- Keep each installed legacy expression exactly, adding only a discriminator
-- guard. Fixed relation/constraint names; pg_get_constraintdef is server-owned.
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT conname, pg_get_expr(conbin,conrelid) AS expression
    FROM pg_constraint WHERE conrelid='aic.cases'::regclass
    AND conname IN ('cases_exposure_object','cases_exposure_amount','cases_exposure_roles','cases_exposure_term')
  LOOP
    EXECUTE format('ALTER TABLE aic.cases DROP CONSTRAINT %I',item.conname);
    EXECUTE format('ALTER TABLE aic.cases ADD CONSTRAINT %I CHECK (purpose=''company_health'' OR (%s))',item.conname,item.expression);
  END LOOP;
END;
$$;

CREATE FUNCTION aic.reject_case_purpose_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.purpose IS DISTINCT FROM OLD.purpose THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Case purpose is immutable',
      CONSTRAINT='cases_purpose_immutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION aic.reject_case_purpose_change() FROM PUBLIC;
CREATE TRIGGER cases_purpose_immutable BEFORE UPDATE ON aic.cases
  FOR EACH ROW EXECUTE FUNCTION aic.reject_case_purpose_change();
