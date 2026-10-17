"""Read external PDFs/oracles without importing either external generator.

Usage from repository root: .venv/Scripts/python.exe <this-file> <bundle-dir>
Writes review evidence only beside this script; never copies or rewrites PDFs.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "services/ai"))

import pymupdf
from extraction import grounding, pdf
from runner.contracts import Contracts


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def review(bundle):
    contracts = Contracts(ROOT / "packages/contracts")  # verifies frozen hashes
    registry = grounding.Registry.from_json(contracts.load("field-registry.json"))
    manifest = json.loads((bundle / "ground-truth/manifest.json").read_text("utf-8"))
    truth = json.loads((bundle / "ground-truth/expected_facts.json").read_text("utf-8"))
    documents = []
    for entry in manifest["documents"]:
        name = entry["filename"]
        assert Path(name).name == name
        path = bundle / "documents" / name
        info = pdf.inspect(path.read_bytes(), with_pages=True)
        expected = truth[name]
        specs = {f["field_key"]: f for f in registry.document_types[expected["document_type"]]}
        quote_checks, condition_errors = [], []
        for key, field in expected["fields"].items():
            quote = field.get("quote")
            if quote:
                page_number = field.get("page")
                found = isinstance(page_number, int) and 1 <= page_number <= info.page_count
                found = found and quote in info.pages[page_number - 1].text
                quote_checks.append({"field_key": key, "page": page_number, "quote": quote,
                                     "exact_match": bool(found)})
            if isinstance(field.get("value"), dict):
                condition_errors.extend(v.as_detail() for v in
                                        contracts.violations("PaymentCondition", field["value"]))
        with pymupdf.open(path) as doc:
            page_details = [{"page": p.page, "characters": len(p.text), "text": p.text,
                             "needs_ocr": p.needs_ocr, "ocr_reason": p.ocr_reason,
                             "image_count": p.image_count,
                             "dimensions_pt": [p.width, p.height],
                             "injection_spans": grounding.injection_spans(p.text)} for p in info.pages]
            embedded_images = sum(len(p.get_images()) for p in doc)
        documents.append({"filename": name, "sha256": digest(path), "manifest_sha256": entry["sha256"],
                          "hash_matches": digest(path) == entry["sha256"], "bytes": path.stat().st_size,
                          "byte_size_matches": path.stat().st_size == entry["bytes"],
                          "page_count": info.page_count, "expected_page_count": expected["page_count"],
                          "encrypted": info.encrypted, "has_embedded_files": info.has_embedded_files,
                          "scanned_pages": info.scanned_pages, "embedded_images": embedded_images,
                          "document_type": expected["document_type"], "pages": page_details,
                          "oracle_fields": len(expected["fields"]), "registry_fields": len(specs),
                          "invalid_field_keys": sorted(set(expected["fields"]) - set(specs)),
                          "uncovered_field_keys": sorted(set(specs) - set(expected["fields"])),
                          "quote_checks": quote_checks, "payment_condition_errors": condition_errors})
    pdf_names = {p.name for p in (bundle / "documents").glob("*.pdf")}
    manifest_names = {e["filename"] for e in manifest["documents"]}
    report = {"kind": "independent_offline_review_not_live_acceptance", "bundle": str(bundle),
              "schema_version": "1.0.2", "pymupdf_version": pymupdf.VersionBind,
              "contract_sha256sums": contracts.sha256sums,
              "source_files": {str(p.relative_to(bundle)): digest(p)
                               for p in sorted(bundle.rglob("*")) if p.is_file()},
              "manifest_duplicate_names": len(manifest["documents"]) - len(manifest_names),
              "unlisted_pdfs": sorted(pdf_names - manifest_names),
              "missing_pdfs": sorted(manifest_names - pdf_names), "documents": documents}
    report["counts"] = {"pdfs": len(documents), "pages": sum(d["page_count"] for d in documents),
                        "matching_hashes": sum(d["hash_matches"] for d in documents),
                        "matching_byte_sizes": sum(d["byte_size_matches"] for d in documents),
                        "image_only_pdfs": sum(all(not p["text"].strip() for p in d["pages"])
                                               for d in documents),
                        "oracle_fields": sum(d["oracle_fields"] for d in documents),
                        "registry_field_slots": sum(d["registry_fields"] for d in documents),
                        "uncovered_field_slots": sum(len(d["uncovered_field_keys"]) for d in documents),
                        "quoted_fields": sum(len(d["quote_checks"]) for d in documents),
                        "non_verbatim_quotes": sum(not q["exact_match"] for d in documents for q in d["quote_checks"]),
                        "invalid_payment_conditions": sum(bool(d["payment_condition_errors"]) for d in documents)}
    (OUT / "bundle-review.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(json.dumps(report["counts"], indent=2))
    return report


if __name__ == "__main__":
    review(Path(sys.argv[1]).resolve(strict=True))
