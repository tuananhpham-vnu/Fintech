"""Native inspect and explicitly FAKE-model grounding probes, never live AI.

The real-source oracle remains fixed even when the current implementation fails.
Exit 1 means scored oracle mismatches; inspect the JSON rather than a script banner.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import uuid

sys.dont_write_bytecode = True
OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
sys.path.insert(0, str(ROOT / "services/ai"))


def restrict(event, args):
    if event == "socket.connect":
        raise RuntimeError("Offline checks prohibit network access")
    if event == "open" and isinstance(args[0], (str, bytes, os.PathLike)):
        if Path(os.fsdecode(args[0])).name == ".env":
            raise RuntimeError("Offline checks prohibit .env reads")


sys.addaudithook(restrict)
from extraction import Config, Service, grounding
from extraction.extractor import Extractor
from runner.contracts import Contracts
from runner.errors import ServiceError
from runner.guards import extraction_output_violations
import normalize

audit = json.loads((OUT / "bundle-review.json").read_text("utf-8"))
oracles = json.loads((OUT / "live-oracles.json").read_text("utf-8"))
contracts = Contracts(ROOT / "packages/contracts")
registry = grounding.Registry.from_json(contracts.load("field-registry.json"))
documents = Path(audit["bundle"]) / "documents"
service = Service(Config(storage_dir=documents))
report = {"mode": "OFFLINE_NATIVE_AND_FAKE_MODEL_NOT_LIVE", "inspections": [], "rehearsals": [], "date_probes": []}

for doc in audit["documents"]:
    request = {"schema_version": "1.0.2", "storage_key": doc["filename"], "sha256": doc["sha256"]}
    response = service.inspect(request)
    assert not contracts.violations("InspectionOutput", response)
    assert response["page_count"] == 1 and response["byte_size"] == doc["bytes"]
    assert response["sha256"] == doc["sha256"]
    report["inspections"].append({"filename": doc["filename"], "passed": True, "response": response})


class FakeModel:
    model_id = "FAKE-ORACLE-REHEARSAL-NOT-LIVE"

    def __init__(self, answer):
        self.answer = answer

    def generate_json(self, *args, **kwargs):
        return SimpleNamespace(data=self.answer)


for doc in oracles["documents"]:
    fields = []
    for spec in registry.document_types[doc["type"]]:
        key = spec["field_key"]
        expected = doc["fields"].get(key)
        value = expected["value"] if expected else None
        # Unscored fields are placeholders for pipeline testing, not source truth.
        status = (expected["missing_reason"] or "found") if expected else "not_present"
        fields.append({"field_key": key, "status": status,
                       "value": None if isinstance(value, dict) else value,
                       "payment_condition": value if isinstance(value, dict) else None,
                       "evidence": [{"page": 1, "quote": q} for q in expected["source_quotes"]] if expected else []})
    model = FakeModel({"detected_type": doc["type"], "classification_confident": True, "fields": fields})
    svc = Service(Config(storage_dir=documents), lambda: Extractor(contracts, model, None))
    request = {"schema_version": "1.0.2", "case_id": str(uuid.uuid5(uuid.NAMESPACE_URL, "accept-ai-case")),
               "document_id": str(uuid.uuid5(uuid.NAMESPACE_URL, doc["filename"])),
               "type": doc["type"], "storage_key": doc["filename"], "sha256": doc["sha256"]}
    response = svc.extract(request)
    assert not contracts.violations("ExtractionOutput", response)
    assert not extraction_output_violations(request, response)
    actual = {f["field_key"]: f for f in response["fields"]}
    mismatches = []
    for key, expected in doc["fields"].items():
        for attr in ("value", "quality", "missing_reason"):
            want, got = expected[attr], actual[key][attr]
            if attr == "value" and key.endswith((".ref", ".contract_ref", ".scope_ref")) and isinstance(want, str) and isinstance(got, str):
                want, got = normalize.ref(want), normalize.ref(got)
            if want != got:
                mismatches.append({"field_key": key, "attribute": attr, "expected": want, "actual": got})
    required = doc.get("required_diagnostic")
    assert not required or required in {d["code"] for d in response["diagnostics"]}
    report["rehearsals"].append({"filename": doc["filename"], "scored_fields": len(doc["fields"]),
                                "mismatches": mismatches,
                                "missing_scored_values": sum(actual[k]["value"] is None and e["value"] is not None for k, e in doc["fields"].items()),
                                "diagnostics": response["diagnostics"]})

for prefix, key, date in [("DOC_REC_02", "acceptance.date", "2026-10-15"),
                          ("DOC_REC_03", "acceptance.date", "2026-10-18"),
                          ("DOC_PRE_02", "payment.date", "2026-10-16"),
                          ("DOC_PRE_03", "payment.date", "2026-10-17")]:
    doc = next(d for d in audit["documents"] if d["filename"].startswith(prefix))
    quote = next(line for line in doc["pages"][0]["text"].splitlines() if line.startswith("Ngày"))
    checked = grounding.check_value(key, "string", date, quote, registry)
    report["date_probes"].append({"filename": doc["filename"], "field_key": key, "expected_date": date,
                                  "source_quote": quote, "actual_value": checked.value, "problem": checked.problem})

scan = next(d for d in audit["documents"] if d["scanned_pages"])
request = {"schema_version": "1.0.2", "document_id": str(uuid.uuid4()), "case_id": str(uuid.uuid4()),
           "type": "contract", "storage_key": scan["filename"], "sha256": scan["sha256"]}
try:
    Service(Config(storage_dir=documents), lambda: Extractor(contracts, None, None)).extract(request)
    raise AssertionError("Scan unexpectedly extracted without OCR")
except ServiceError as error:
    assert (error.status, error.code) == (503, "PROVIDER_UNAVAILABLE")
    report["scan_without_ocr"] = {"status": error.status, "code": error.code, "passed": True}

report["counts"] = {"native_inspect_passed": len(report["inspections"]),
                    "fake_model_documents": len(report["rehearsals"]),
                    "scored_fields": sum(d["scored_fields"] for d in report["rehearsals"]),
                    "mismatched_field_attributes": sum(len(d["mismatches"]) for d in report["rehearsals"]),
                    "missing_scored_values": sum(d["missing_scored_values"] for d in report["rehearsals"]),
                    "date_probes_rejected": sum(d["actual_value"] is None for d in report["date_probes"])}
(OUT / "offline-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
print(json.dumps(report["counts"], indent=2))
raise SystemExit(1 if report["counts"]["mismatched_field_attributes"] else 0)
