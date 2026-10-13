"""T28 / G0-T (phía Python): import schema, parse 26 examples, từ chối field lạ, vectors S01–S04."""
import copy
import json
import shutil

import pytest
from pydantic import ValidationError

from runner import dto
from runner.contracts import ContractDriftError, Contracts


def test_canonical_schema_is_2020_12_and_has_52_named_schemas(contracts):
    assert len(contracts.defs) == 52


def test_internal_openapi_components_equal_canonical_schema(contracts):
    openapi = contracts.load("internal-openapi.json")
    components = json.loads(json.dumps(openapi["components"]["schemas"]).replace("#/components/schemas/", "#/$defs/"))
    assert components == contracts.defs
    operations = {(m.upper(), p) for p, ops in openapi["paths"].items() for m in ops}
    assert operations == {("POST", "/inspect"), ("POST", "/extract"), ("POST", "/evaluate")}


def test_all_26_examples_valid(contracts, examples):
    assert len(examples) == 26
    failures = {e["name"]: contracts.violations(e["schema"], e["value"]) for e in examples}
    assert {k: v for k, v in failures.items() if v} == {}


def test_unknown_field_rejected_for_every_example(contracts, examples):
    for e in examples:
        tampered = dict(e["value"], unexpected_field=True)
        assert contracts.violations(e["schema"], tampered), e["name"]


def test_required_nullable_field_must_be_present(contracts, examples):
    value = copy.deepcopy(next(e["value"] for e in examples if e["schema"] == "EvaluationOutput"))
    value["assessments"][0].pop("computed_date")
    assert contracts.violations("EvaluationOutput", value)


@pytest.mark.parametrize("vector_id", ["S01", "S02", "S03", "S04"])
def test_validation_vectors(contracts, vector_id):
    vector = next(v for v in contracts.load("validation-vectors.json") if v["id"] == vector_id)
    rejected = bool(contracts.violations(vector["schema"], vector["value"]))
    assert rejected == (vector["expected"] == "REJECT")


def test_examples_parse_into_typed_dtos(examples):
    for e in examples:
        model = getattr(dto, e["schema"])
        model.model_validate(e["value"])
        with pytest.raises(ValidationError):
            model.model_validate(dict(e["value"], unexpected_field=True))


def test_contract_drift_is_detected(tmp_path, contracts):
    tmp_path = tmp_path / "contracts"
    shutil.copytree(contracts.directory, tmp_path)
    schemas = json.loads((tmp_path / "schemas.json").read_text("utf-8"))
    schemas["$defs"]["Case"]["properties"]["sneaky"] = {"type": "string"}
    (tmp_path / "schemas.json").write_text(json.dumps(schemas), "utf-8")
    with pytest.raises(ContractDriftError):
        Contracts(tmp_path)
