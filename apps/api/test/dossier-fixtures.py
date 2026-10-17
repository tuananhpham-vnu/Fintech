"""Offline, synthetic dossier fixtures; stdout is always one JSON object.

Run with the repository's .venv Python (PyMuPDF is the only dependency)::

    .venv/Scripts/python.exe -I -B apps/api/test/dossier-fixtures.py
    .venv/Scripts/python.exe -I -B apps/api/test/dossier-fixtures.py --inventory

Default keys are base64 ZIP bytes: thirty, sixty, mixed, unsafe, crc, depth,
duplicate. --include-pdf also emits a standalone one-page contract as `pdf`.
--inventory lists every member, counts, byte sizes and intentional anomalies
instead of base64. It describes fixture intent, not a measured API outcome.

Thirty/sixty count file paths, including one deliberately retained identical-
byte pair (29/59 unique PDF payloads). All other PDFs have unique serials.
There are no service/config imports, dotenv reads, file writes or network calls.
"""
from __future__ import annotations

import argparse
import base64
from collections import Counter, defaultdict
from dataclasses import dataclass
import hashlib
import io
import json
import stat
import struct
import zipfile

import pymupdf


CONTRACT_TEXT = "Contract ref: DEMO001. Contract amount: 1250000 VND."
CATEGORIES = ("contract", "BCTC", "payment", "tax")
FIXTURE_NAMES = ("thirty", "sixty", "mixed", "unsafe", "crc", "depth", "duplicate")


@dataclass(frozen=True)
class Member:
    path: str
    data: bytes
    pages: int | None = None
    category: str | None = None
    intent: str = "readable_pdf"


def pdf_bytes(category: str, serial: str, year: int, pages: int = 1) -> bytes:
    body = {
        "contract": CONTRACT_TEXT,
        "BCTC": f"Financial statements (BCTC). Period end: {year}-12-31.\n"
                "Total assets: 2500000 VND. Total liabilities: 1250000 VND.",
        "payment": "Payment ref: DEMOPAY001. Payment amount: 1250000 VND.",
        "tax": f"Synthetic tax declaration. Reporting year: {year}. Tax amount: 125000 VND.",
    }[category]
    with pymupdf.open() as document:
        document.set_metadata({"title": f"SYNTHETIC DEMO {serial}", "author": "Synthetic fixture"})
        for page in range(1, pages + 1):
            document.new_page().insert_text(
                (40, 60),
                f"SYNTHETIC DEMO ONLY - NOT A BUSINESS RECORD\n"
                f"Serial: {serial}. Category: {category}. Year: {year}.\n"
                f"{body}\nPage {page} of {pages}.",
                fontsize=10,
            )
        # Suppress random PDF IDs; stable metadata/ZIP timestamps make reruns identical.
        return document.tobytes(garbage=4, deflate=True, no_new_id=True)


def zip_bytes(members: list[Member], compression: int = zipfile.ZIP_DEFLATED) -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", allowZip64=False) as archive:
        for member in members:
            info = zipfile.ZipInfo(member.path, date_time=(2025, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            info.compress_type = compression
            archive.writestr(info, member.data)
    return stream.getvalue()


def corrupt_pdf_payload(archive_bytes: bytes, path: str) -> bytes:
    """Flip a stored PDF's payload byte, preserving local/central CRC metadata."""
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        info = archive.getinfo(path)
        if info.compress_type != zipfile.ZIP_STORED:
            raise ValueError("CRC fixture requires a stored member")
        offset = info.header_offset
        name_length, extra_length = struct.unpack_from("<HH", archive_bytes, offset + 26)
        start = offset + 30 + name_length + extra_length
        # Keep %PDF- intact and alter actual document bytes, not ZIP metadata.
        position = start + info.file_size // 2
        changed = bytearray(archive_bytes)
        changed[position] ^= 1
        return bytes(changed)


def build_fixtures() -> tuple[dict[str, bytes], dict[str, list[Member]], bytes]:
    sixty = []
    for index in range(60):
        category = CATEGORIES[index % len(CATEGORIES)]
        year = 2023 + (index // 2) % 3
        entity = "entity-a" if index % 2 == 0 else "entity-b"
        pages = 10 if index == 9 else 1
        if index == 59:
            category, pages = "contract", 12
        serial = f"DEMO{index + 1:04d}"
        path = f"{entity}/{year}/{category}_{serial}_{pages}pages.pdf"
        sixty.append(Member(path, pdf_bytes(category, serial, year, pages), pages, category,
                            "over_page_limit_needs_review" if pages > 10 else "readable_pdf"))
    # Two paths are intentionally separate documents with identical bytes/serials.
    sixty[1] = Member("entity-b/2024/contract_retained_copy_DEMO0001.pdf", sixty[0].data,
                      1, "contract", "identical_bytes_different_path")
    valid = [Member(f"entity-{'a' if n % 2 == 0 else 'b'}/{2023 + n % 3}/{category}_MIX{n + 1:04d}.pdf",
                    pdf_bytes(category, f"MIX{n + 1:04d}", 2023 + n % 3), 1, category)
             for n, category in enumerate(CATEGORIES)]
    twelve = Member("entity-b/2025/contract_MIX0012_12pages.pdf",
                    pdf_bytes("contract", "MIX0012", 2025, 12), 12, "contract",
                    "over_page_limit_needs_review")
    # Unsupported spreadsheets/archives are labelled probes, not claimed-valid files.
    # The images and the nested ZIP are real containers, all generated in memory.
    image = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 16, 16), False)
    image.clear_with(235)
    mixed = valid + [twelve,
        Member("entity-a/2023/contract_corrupt.pdf", b"%PDF- invalid\nSYNTHETIC DEMO CORRUPT\n",
               category="contract", intent="invalid_pdf_header_only"),
        Member("entity-a/2023/BCTC_demo.xlsx", b"SYNTHETIC DEMO XLSX UNSUPPORTED FORMAT PROBE\n",
               category="BCTC", intent="unsupported_format_placeholder"),
        Member("entity-b/2024/BCTC_demo.xls", b"SYNTHETIC DEMO XLS UNSUPPORTED FORMAT PROBE\n",
               category="BCTC", intent="unsupported_format_placeholder"),
        Member("entity-a/2025/payment_demo.jpg", image.tobytes("jpeg"),
               category="payment", intent="unsupported_format"),
        Member("entity-b/2023/tax_demo.png", image.tobytes("png"),
               category="tax", intent="unsupported_format"),
        Member("entity-a/2024/demo.rar", b"Rar!\x1a\x07\x00SYNTHETIC DEMO RAR PROBE\n",
               intent="unsupported_format_placeholder"),
        Member("entity-b/2025/nested.zip", zip_bytes([valid[0]]), intent="unsupported_nested_zip"),
    ]
    members = {
        "thirty": sixty[:30],
        "sixty": sixty,
        "mixed": mixed,
        "unsafe": valid + [Member("../contract_escape.pdf", valid[0].data, 1, "contract", "unsafe_path")],
        "crc": valid + [Member("entity-a/2025/contract_crc.pdf",
                                pdf_bytes("contract", "CRC0001", 2025), 1, "contract", "bad_crc")],
        "depth": [Member("entity-a/2025/level-1/level-2/level-3/level-4/level-5/level-6/level-7/contract_deep.pdf",
                         pdf_bytes("contract", "DEPTH0001", 2025), 1, "contract", "nine_directory_levels")],
        "duplicate": [Member("entity-a/2025/Contract_DEMO.pdf", valid[0].data, 1, "contract"),
                      Member("ENTITY-A/2025/contract_demo.PDF", pdf_bytes("contract", "DUP0002", 2025), 1, "contract",
                             "duplicate_casefolded_path")],
    }
    archives = {name: zip_bytes(entries, zipfile.ZIP_STORED if name == "crc" else zipfile.ZIP_DEFLATED)
                for name, entries in members.items()}
    archives["crc"] = corrupt_pdf_payload(archives["crc"], members["crc"][-1].path)
    return archives, members, valid[0].data


def inventory(archives: dict[str, bytes], members: dict[str, list[Member]], pdf: bytes | None) -> dict:
    output = {}
    for name in FIXTURE_NAMES:
        entries, rows, identical = members[name], [], defaultdict(list)
        with zipfile.ZipFile(io.BytesIO(archives[name])) as archive:
            for entry, info in zip(entries, archive.infolist(), strict=True):
                # Stream every member through zipfile's CRC/size checks, no extraction.
                digest = hashlib.sha256()
                read_bytes, crc_ok = 0, True
                try:
                    with archive.open(info) as source:
                        while chunk := source.read(65536):
                            digest.update(chunk)
                            read_bytes += len(chunk)
                except zipfile.BadZipFile:
                    if entry.intent != "bad_crc":
                        raise
                    crc_ok = False
                if crc_ok and (read_bytes != len(entry.data) or digest.digest() != hashlib.sha256(entry.data).digest()):
                    raise ValueError(f"Unexpected member bytes: {name}/{entry.path}")
                if entry.intent == "bad_crc" and crc_ok:
                    raise ValueError("CRC attack unexpectedly passed integrity validation")
                sha = digest.hexdigest() if crc_ok else None
                if sha is not None:
                    identical[sha].append(entry.path)
                rows.append({"path": entry.path, "bytes": info.file_size,
                             "compressed_bytes": info.compress_size, "pages": entry.pages,
                             "category": entry.category, "intent": entry.intent,
                             "crc_ok": crc_ok, "sha256": sha,
                             "directory_depth": len(entry.path.split("/")) - 1})
        pdf_entries = [entry for entry in entries if entry.path.lower().endswith(".pdf")]
        output[name] = {
            "zip_bytes": len(archives[name]), "expanded_bytes": sum(len(entry.data) for entry in entries),
            "member_count": len(entries), "pdf_count": len(pdf_entries),
            "valid_pdf_count": sum(entry.pages is not None and entry.intent != "bad_crc" for entry in pdf_entries),
            "unique_pdf_payloads": len({entry.data for entry in pdf_entries if entry.pages is not None}),
            "over_ten_page_count": sum((entry.pages or 0) > 10 for entry in entries),
            "unsupported_count": sum(entry.intent.startswith("unsupported") for entry in entries),
            "category_counts": dict(Counter(entry.category for entry in entries if entry.category)),
            "identical_byte_paths": [paths for paths in identical.values() if len(paths) > 1],
            "members": rows,
        }
    result = {"synthetic_only": True, "fixture_count": len(archives),
              "total_bytes": sum(map(len, archives.values())) + (len(pdf) if pdf is not None else 0),
              "total_zip_bytes": sum(map(len, archives.values())),
              "total_member_count": sum(len(entries) for entries in members.values()),
              "total_expanded_bytes": sum(len(entry.data) for entries in members.values() for entry in entries),
              "fixtures": output}
    if pdf is not None:
        result["pdf"] = {"bytes": len(pdf), "pages": 1, "category": "contract"}
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--inventory", action="store_true", help="List all members, sizes and streamed ZIP integrity")
    parser.add_argument("--include-pdf", action="store_true", help="Include standalone contract PDF bytes (base64)")
    args = parser.parse_args()
    archives, members, pdf = build_fixtures()
    if args.inventory:
        result = inventory(archives, members, pdf if args.include_pdf else None)
    else:
        payloads = {**archives, **({"pdf": pdf} if args.include_pdf else {})}
        result = {key: base64.b64encode(value).decode("ascii") for key, value in payloads.items()}
    print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
