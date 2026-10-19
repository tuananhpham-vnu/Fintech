-- Additive reasoning snapshots; accepted source receipts and old facts remain unchanged.
CREATE TABLE aic.financial_reasoning_runs (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 case_id uuid NOT NULL,
 source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
 graph_hash text NOT NULL CHECK (graph_hash ~ '^[a-f0-9]{64}$'),
 scope_json jsonb NOT NULL CHECK (jsonb_typeof(scope_json)='object'),
 graph_json jsonb NOT NULL CHECK (jsonb_typeof(graph_json)='object'),
 summary_json jsonb NOT NULL CHECK (jsonb_typeof(summary_json)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (organization_id,case_id,id),
 FOREIGN KEY (organization_id,case_id) REFERENCES aic.cases(organization_id,id)
);
CREATE TABLE aic.financial_reasoning_observations (
 organization_id uuid NOT NULL,
 case_id uuid NOT NULL,
 run_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK (ordinal>=0),
 variable_id text NOT NULL,
 payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json)='object'),
 PRIMARY KEY(run_id,ordinal),
 FOREIGN KEY(organization_id,case_id,run_id) REFERENCES aic.financial_reasoning_runs(organization_id,case_id,id)
);
CREATE TABLE aic.financial_reasoning_relations (
 organization_id uuid NOT NULL,
 case_id uuid NOT NULL,
 run_id uuid NOT NULL,
 relation_id text NOT NULL,
 payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json)='object'),
 PRIMARY KEY(run_id,relation_id),
 FOREIGN KEY(organization_id,case_id,run_id) REFERENCES aic.financial_reasoning_runs(organization_id,case_id,id)
);
CREATE TABLE aic.financial_reasoning_derivations (
 organization_id uuid NOT NULL,
 case_id uuid NOT NULL,
 run_id uuid NOT NULL,
 fact_key text NOT NULL,
 payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json)='object'),
 PRIMARY KEY(run_id,fact_key),
 FOREIGN KEY(organization_id,case_id,run_id) REFERENCES aic.financial_reasoning_runs(organization_id,case_id,id)
);
CREATE TRIGGER financial_reasoning_runs_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.financial_reasoning_runs FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER financial_reasoning_observations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.financial_reasoning_observations FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER financial_reasoning_relations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.financial_reasoning_relations FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
CREATE TRIGGER financial_reasoning_derivations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON aic.financial_reasoning_derivations FOR EACH STATEMENT EXECUTE FUNCTION aic.reject_mvp_workflow_mutation();
