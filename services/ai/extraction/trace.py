"""Opt-in live diagnostics for ONE synthetic fixture and TWO fields. Off by default; never part of API output.

Purpose: see what the live model proposed for the two tax IDs of `04_contract.pdf` and why grounding rejected them.
Recording happens only when AI_EXTRACTION_TRACE=1 AND the file content hashes to the canonical fixture SHA-256
(computed by storage from the bytes, not taken from the request). Written to services/ai/logs/ (gitignored).

Captured per attempt (incl. repair): status, value, evidence page + quote (capped) for the two fields only.
Captured after grounding: quote match per evidence, check_value / check_source result, party role found at the value,
final value/quality/missing_reason and this field's diagnostics. Never: keys, headers, prompts, full model responses,
page text, other fields. Structural violations are recorded as JSON paths only (messages can echo model output).
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

ENV = "AI_EXTRACTION_TRACE"
FIXTURE = "04_contract.pdf"
FIXTURE_SHA256 = "33a453e3558ff0e8b5a770b70b38f2fb1bc32a2484cd3e916742ed973d378764"   # manifest.json, 04_contract.pdf
FIELDS = ("parties.borrower.tax_id", "parties.counterparty.tax_id")
PATH = Path(__file__).resolve().parents[1] / "logs" / "extraction-trace-04_contract.json"
MAX_TEXT = 200


def _cap(value: object) -> object:
    return value[:MAX_TEXT] if isinstance(value, str) else value


def _checked(checked) -> dict:
    return {"value": _cap(checked.value), "quality": checked.quality, "problem": checked.problem}


class Trace:
    def __init__(self, model_id: str):
        self.model_id = model_id
        self.attempts: list[dict] = []
        self.grounding: dict[str, dict] = {key: {} for key in FIELDS}

    def attempt(self, number: int, data: object = None, malformed: bool = False, violations=()) -> None:
        proposals = {}
        fields = data.get("fields") if isinstance(data, dict) else None
        for entry in fields if isinstance(fields, list) else []:
            if isinstance(entry, dict) and entry.get("field_key") in FIELDS:
                evidence = entry.get("evidence") if isinstance(entry.get("evidence"), list) else []
                proposals[entry["field_key"]] = {
                    "status": _cap(entry.get("status")), "value": _cap(entry.get("value")),
                    "evidence": [{"page": e.get("page"), "quote": _cap(e.get("quote"))}
                                 for e in evidence if isinstance(e, dict)]}
        self.attempts.append({"attempt": number, "malformed_json": malformed,
                              "structural_violation_paths": [v.path for v in violations], "proposals": proposals})

    def note(self, key: str, stage: str, value: object) -> None:
        if key in self.grounding:
            self.grounding[key][stage] = value

    def finish(self, fields: list[dict], diagnostics: list[dict], error: str | None = None) -> None:
        for key in FIELDS:
            final = next((f for f in fields if f["field_key"] == key), None)
            self.grounding[key]["final"] = None if final is None else {
                "value": _cap(final["value"]), "quality": final["quality"], "missing_reason": final["missing_reason"]}
            self.grounding[key]["diagnostics"] = [{"code": d["code"], "message": d["message"]}
                                                  for d in diagnostics if d["field_key"] == key]
        report = {"fixture": FIXTURE, "sha256": FIXTURE_SHA256, "model_id": self.model_id,
                  "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "error": error,
                  "attempts": self.attempts, "grounding": self.grounding}
        PATH.parent.mkdir(parents=True, exist_ok=True)
        PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")


def start(sha256: str, model_id: str) -> Trace | None:
    enabled = os.environ.get(ENV, "").strip() == "1"
    return Trace(model_id) if enabled and sha256 == FIXTURE_SHA256 else None


def value_roles(grounding_module, key: str, value: object, spans, texts: list[str]) -> list:
    """Party role the role check sees at each occurrence of the tax ID inside the quoted spans (diagnostic only)."""
    tax_id = grounding_module.normalize.tax_id(value) if isinstance(value, str) else None
    if tax_id is None:
        return []
    pattern = re.compile(r"(?<!\d)" + r"[\s.]*".join(map(re.escape, tax_id)) + r"(?!\s*-?\s*\d)")
    roles = []
    for span in spans:
        text = texts[span.page - 1]
        for match in pattern.finditer(text, span.start, span.end):
            roles.append({"page": span.page, "role": grounding_module.party_role(text, match.start())})
    return roles
