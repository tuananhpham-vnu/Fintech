"""Smoke M2 thật: PDF bundle -> PyMuPDF -> LLM (LLM_PROVIDER, mặc định Ollama local gemma3:4b) -> guard căn cứ.

Chạy: cd services/ai && ../../.venv/Scripts/python.exe scripts/extraction_smoke.py [tên file ...]
      (Linux: ../../.venv/bin/python). Có tên file thì chỉ chạy các fixture đó, vd. 04_contract.pdf.
Ghi evidence/extraction-smoke-<time>.json: field nào khớp gold, field nào bị guard từ chối, mã diagnostic, độ trễ.
Gold CHỈ dùng để chấm output model sau khi chạy, không bao giờ làm output. Dữ liệu giả lập dev, không phải holdout.
Có scan 07/08 trong AI_FIXTURES_DIR thì chạy cả đường OCR (OCR_ENGINE; mặc định none tới khi có docling).
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import extraction  # noqa: E402
from runner.config import DEFAULT_CONTRACTS_DIR, DEFAULT_FIXTURES_DIR  # noqa: E402
from runner.contracts import Contracts  # noqa: E402
from runner.errors import ServiceError  # noqa: E402
from runner.guards import extraction_output_violations  # noqa: E402


def main(only: list[str] | None = None) -> int:
    fixtures = Path(os.environ.get("AI_FIXTURES_DIR", DEFAULT_FIXTURES_DIR))
    contracts = Contracts(DEFAULT_CONTRACTS_DIR)
    manifest = json.loads((fixtures / "manifest.json").read_text("utf-8"))["files"]
    gold = {g["document_id"]: g for g in json.loads((fixtures / "extraction-gold.json").read_text("utf-8"))}
    config = extraction.Config.from_env()
    service = extraction.Service(extraction.Config(fixtures, config.max_bytes, config.max_pages, config.deadline_s,
                                                   config.ocr_engine, config.ocr_lang, config.tesseract_cmd))
    try:
        service.extractor()
    except ServiceError as exc:
        print(f"NOT RUN: {exc.message}")
        return 2

    rows = []
    for entry in [e for e in manifest if not only or e["filename"] in only]:
        if not (fixtures / entry["filename"]).is_file():
            print(f"skip {entry['filename']:28} not in AI_FIXTURES_DIR")
            continue
        reference = gold.get(entry["document_id"]) or gold.get(
            next((f["document_id"] for f in manifest if f["filename"] == entry["scan_of"]), ""))
        request = {"schema_version": "1.0.2", "document_id": entry["document_id"],
                   "case_id": reference["case_id"] if reference else "a06adf0c-7110-51f6-86ad-4b4b903c3e9e",
                   "type": entry["type"], "storage_key": entry["filename"], "sha256": entry["sha256"]}
        started = time.monotonic()
        try:
            out = service.extract(request)
        except ServiceError as exc:
            rows.append({"file": entry["filename"], "ok": False, "error": exc.code, "message": exc.message})
            print(f"ERR {entry['filename']:28} {exc.code}: {exc.message}")
            continue
        problems = contracts.violations("ExtractionOutput", out) or extraction_output_violations(request, out)
        expected = {f["field_key"]: f["value"] for f in reference["fields"]} if reference else {}
        got = {f["field_key"]: f for f in out["fields"]}
        matched = sorted(k for k, v in expected.items() if got.get(k, {}).get("value") == v)
        rows.append({
            "file": entry["filename"], "ok": not problems and len(matched) == len(expected),
            "latency_ms": int((time.monotonic() - started) * 1000),
            "fields_expected": len(expected), "fields_matched": len(matched),
            "mismatched": {k: {"got": got.get(k, {}).get("value"), "quality": got.get(k, {}).get("quality")}
                           for k in expected if k not in matched},
            "methods": [p["method"] for p in out["pages"]],
            "diagnostics": [[d["code"], d["field_key"]] for d in out["diagnostics"]],
            "provenance": out["provenance"], "contract_violations": [p.as_detail() for p in problems]})
        r = rows[-1]
        print(f"{'ok ' if r['ok'] else 'BAD'} {entry['filename']:28} {r['fields_matched']}/{r['fields_expected']} "
              f"{r['methods']} {r['latency_ms']}ms {r['diagnostics']}")

    ict = datetime.now(timezone(timedelta(hours=7)))
    report = {"generated_at": ict.isoformat(timespec="seconds"), "rows": rows,
              "note": "Dev synthetic fixtures; gold used only to score live output after the fact."}
    path = ROOT / "evidence" / f"extraction-smoke-{ict:%Y%m%dT%H%M}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"-> {path.relative_to(ROOT)}")
    return 0 if rows and all(r["ok"] for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or None))
