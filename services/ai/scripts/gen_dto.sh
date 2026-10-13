#!/usr/bin/env bash
# Sinh lại runner/dto.py từ packages/contracts/schemas.json (chạy khi contract đổi version).
set -euo pipefail
cd "$(dirname "$0")/.."
../../.venv/bin/datamodel-codegen --input ../../packages/contracts/schemas.json --input-file-type jsonschema \
  --output runner/dto.py --output-model-type pydantic_v2.BaseModel --target-python-version 3.11 \
  --use-standard-collections --use-union-operator --field-constraints --disable-timestamp \
  --custom-file-header '# GENERATED from packages/contracts/schemas.json (1.0.2) by scripts/gen_dto.sh. Do not edit.
# Typing aid only: jsonschema (runner/contracts.py) is the authority at the API boundary,
# e.g. required-but-nullable fields must be present even though these models default them to None.'
