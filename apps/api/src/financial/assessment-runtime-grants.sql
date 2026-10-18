-- Operator-owned application role only. Never grant these tables to the extraction worker.
GRANT SELECT,INSERT ON aic.assessments,aic.assessment_acknowledgements TO :"api_role";
