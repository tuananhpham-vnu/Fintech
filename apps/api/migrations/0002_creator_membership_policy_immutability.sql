-- Owner-approved persistence invariants only. Public case creation remains blocked
-- until effective approved policy selection and the Exposure write schema are locked.
-- No policy registry, organization-wide grants, or historical membership backfill.

CREATE FUNCTION aic.grant_case_creator_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO aic.case_memberships (organization_id, case_id, user_id, granted_by)
  VALUES (NEW.organization_id, NEW.id, NEW.created_by, NEW.created_by);
  RETURN NEW;
END;
$$;

CREATE TRIGGER cases_grant_creator_membership
  AFTER INSERT ON aic.cases
  FOR EACH ROW EXECUTE FUNCTION aic.grant_case_creator_membership();

CREATE FUNCTION aic.reject_case_policy_version_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Case policy_version is immutable',
      CONSTRAINT = 'cases_policy_version_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cases_policy_version_immutable
  BEFORE UPDATE ON aic.cases
  FOR EACH ROW EXECUTE FUNCTION aic.reject_case_policy_version_change();
