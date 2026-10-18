"""Bounded stdlib ZIP reader for the local demo API. Stdin bytes -> JSON stdout.

No filesystem extraction, imports of service settings, dotenv, OCR or provider.
Whole-archive security validation precedes decompression and all persistence.
The API also enforces process concurrency, timeout and maximum stdout bytes.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import re
import stat
import struct
import sys
from typing import NamedTuple
import unicodedata
import zipfile
import zlib

MAX_ARCHIVE = 20 * 1024 * 1024
MAX_TOTAL = 40 * 1024 * 1024
MAX_FILE = 10 * 1024 * 1024
MAX_ENTRIES = 32
MAX_PDFS = 8
MAX_RATIO = 100


class ArchivePolicy(NamedTuple):
    max_archive: int = MAX_ARCHIVE
    max_total: int = MAX_TOTAL
    max_entries: int = MAX_ENTRIES
    max_pdfs: int = MAX_PDFS
    max_file: int = MAX_FILE
    max_ratio: int = MAX_RATIO
    max_depth: int | None = None
    strict_metadata: bool = False


LEGACY_POLICY = ArchivePolicy()
DOSSIER_POLICY = ArchivePolicy(
    max_archive=32 * 1024 * 1024, max_total=64 * 1024 * 1024,
    max_entries=128, max_pdfs=64, max_depth=8, strict_metadata=True,
)


class ArchiveError(Exception):
    pass


def _check_extra(extra: bytes) -> None:
    """Check even ignored extra fields; ZIP64 is never part of this profile."""
    position = 0
    while position < len(extra):
        if position + 4 > len(extra):
            raise ArchiveError("ARCHIVE_INVALID_ZIP")
        kind, size = struct.unpack_from("<HH", extra, position)
        if kind == 1:
            raise ArchiveError("ARCHIVE_UNSUPPORTED_ZIP")
        position += 4 + size
        if position > len(extra):
            raise ArchiveError("ARCHIVE_INVALID_ZIP")


def _central_records(data: bytes, offset: int, end: int, entries: int) -> list:
    """Bound directory parsing before ZipFile allocates its member objects."""
    records = []
    position = offset
    for _ in range(entries):
        if position + 46 > end:
            raise ArchiveError("ARCHIVE_INVALID_ZIP")
        central = struct.unpack_from("<4s6H3I5H2I", data, position)
        next_position = position + 46 + sum(central[10:13])
        if central[0] != b"PK\x01\x02" or next_position > end:
            raise ArchiveError("ARCHIVE_INVALID_ZIP")
        records.append((position, central))
        position = next_position
    if position != end:
        raise ArchiveError("ARCHIVE_INVALID_ZIP")
    return records


def _check_metadata(data: bytes, infos: list, offset: int, records: list) -> None:
    """Validate all dossier members without inflating unsupported payloads.

    ZipExtFile checks accepted members too, but does not open rejected entries.
    Check their local names, sizes, extra fields and byte ranges here as well.
    Classic streaming data descriptors are supported; ZIP64 descriptors are not.
    """
    spans = []
    for info, (position, central) in zip(infos, records):
        (signature, _, version, flags, method, mtime, mdate, crc, compressed,
         expanded, name_size, extra_size, comment_size, disk, _, _, local) = central
        if local != info.header_offset:
            raise ArchiveError("ARCHIVE_INVALID_ZIP")
        if disk or version > 20 or compressed == 0xffffffff or expanded == 0xffffffff:
            raise ArchiveError("ARCHIVE_UNSUPPORTED_ZIP")
        # Only classic stored/deflated data, optional descriptor and UTF-8 names.
        if flags & ~(0x800 | 8 | 6):
            raise ArchiveError("ARCHIVE_UNSUPPORTED_ZIP")
        if method == zipfile.ZIP_STORED and compressed != expanded:
            raise ArchiveError("ARCHIVE_INVALID_ZIP")
        name = data[position + 46:position + 46 + name_size]
        _check_extra(data[position + 46 + name_size:position + 46 + name_size + extra_size])
        if local + 30 > offset:
            raise ArchiveError("ARCHIVE_INVALID_ZIP")
        (local_signature, local_version, local_flags, local_method, local_time,
         local_date, local_crc, local_compressed, local_expanded,
         local_name_size, local_extra_size) = struct.unpack_from("<4s5H3I2H", data, local)
        if local_version > 20 or local_compressed == 0xffffffff or local_expanded == 0xffffffff:
            raise ArchiveError("ARCHIVE_UNSUPPORTED_ZIP")
        if (local_signature != b"PK\x03\x04" or
                (local_version, local_flags, local_method, local_time, local_date) !=
                (version, flags, method, mtime, mdate)):
            raise ArchiveError("ARCHIVE_INVALID_ZIP")
        payload = local + 30 + local_name_size + local_extra_size
        payload_end = payload + compressed
        if (payload_end > offset or local_name_size != name_size or
                data[local + 30:local + 30 + local_name_size] != name):
            raise ArchiveError("ARCHIVE_INVALID_ZIP")
        _check_extra(data[local + 30 + local_name_size:payload])
        expected = (crc, compressed, expanded)
        declared = (local_crc, local_compressed, local_expanded)
        if flags & 8:
            if any(value not in (0, target) for value, target in zip(declared, expected)):
                raise ArchiveError("ARCHIVE_INVALID_ZIP")
            descriptor = struct.pack("<III", *expected)
            if data[payload_end:payload_end + 16] == b"PK\x07\x08" + descriptor:
                payload_end += 16
            elif data[payload_end:payload_end + 12] == descriptor:
                payload_end += 12
            else:
                raise ArchiveError("ARCHIVE_INVALID_ZIP")
        elif declared != expected:
            raise ArchiveError("ARCHIVE_INVALID_ZIP")
        spans.append((local, payload_end))
    # Exact coverage excludes overlap, hidden local members and prepended data.
    previous = 0
    for start, stop in sorted(spans):
        if start != previous or stop > offset:
            raise ArchiveError("ARCHIVE_INVALID_ZIP")
        previous = stop
    if previous != offset:
        raise ArchiveError("ARCHIVE_INVALID_ZIP")


def read_archive(data: bytes, policy: ArchivePolicy = LEGACY_POLICY) -> list[dict]:
    if not data or len(data) > policy.max_archive:
        raise ArchiveError("ARCHIVE_SIZE_LIMIT")
    if not data.startswith(b"PK\x03\x04"):
        raise ArchiveError("ARCHIVE_INVALID_ZIP")
    # Explicitly exclude multi-volume, ZIP64, prepended/trailing payload variants.
    end = data.rfind(b"PK\x05\x06", max(0, len(data) - 65557))
    if end < 0 or end + 22 > len(data):
        raise ArchiveError("ARCHIVE_INVALID_ZIP")
    disk, central_disk, on_disk, entries, size, offset, comment = struct.unpack_from("<HHHHIIH", data, end + 4)
    if disk or central_disk or on_disk != entries or entries == 65535 or size == 0xffffffff or offset == 0xffffffff:
        raise ArchiveError("ARCHIVE_UNSUPPORTED_ZIP")
    if end + 22 + comment != len(data) or offset + size != end:
        raise ArchiveError("ARCHIVE_INVALID_ZIP")
    if entries > policy.max_entries:
        raise ArchiveError("ARCHIVE_ENTRY_LIMIT")
    try:
        records = _central_records(data, offset, end, entries) if policy.strict_metadata else []
        with zipfile.ZipFile(io.BytesIO(data), allowZip64=False) as archive:
            infos = archive.infolist()
            if len(infos) != entries or not infos:
                raise ArchiveError("ARCHIVE_INVALID_ZIP")
            seen, claimed = set(), 0
            for info in infos:
                name = info.orig_filename
                normalized = unicodedata.normalize("NFKC", name).casefold()
                # ZIP names are not URLs. Reject escaped path/control aliases in
                # the dossier profile rather than letting a later consumer decode
                # them into traversal; the stored display path is never rewritten.
                if policy.strict_metadata and re.search(r"%(?:2e|2f|5c|3a|25|0[0-9a-f]|7f)", normalized):
                    raise ArchiveError("ARCHIVE_UNSAFE_PATH")
                path = normalized[:-1] if policy.strict_metadata and normalized.endswith("/") else normalized.rstrip("/")
                parts = path.split("/")
                if (len(name) > 512 or not name or normalized.startswith(("/", "\\"))
                        or "\\" in normalized or ":" in normalized
                        or any(p in ("", ".", "..") or p != p.rstrip(" .") for p in parts)
                        or any(unicodedata.category(c).startswith("C") for c in name)):
                    raise ArchiveError("ARCHIVE_UNSAFE_PATH")
                depth = len(parts) if info.is_dir() else len(parts) - 1
                if policy.max_depth is not None and depth > policy.max_depth:
                    raise ArchiveError("ARCHIVE_UNSAFE_PATH")
                identity = "/".join(parts)
                if identity in seen:
                    raise ArchiveError("ARCHIVE_DUPLICATE_PATH")
                seen.add(identity)
                kind = stat.S_IFMT(info.external_attr >> 16)
                if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or (kind == stat.S_IFDIR and not info.is_dir()):
                    raise ArchiveError("ARCHIVE_UNSAFE_ENTRY")
                if info.flag_bits & (1 | 64):
                    raise ArchiveError("ARCHIVE_ENCRYPTED")
                if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise ArchiveError("ARCHIVE_UNSUPPORTED_COMPRESSION")
                if info.extract_version > 20:
                    raise ArchiveError("ARCHIVE_UNSUPPORTED_ZIP")
                if info.file_size > max(1, info.compress_size) * policy.max_ratio:
                    raise ArchiveError("ARCHIVE_COMPRESSION_RATIO")
                claimed += info.file_size
                if claimed > policy.max_total:
                    raise ArchiveError("ARCHIVE_EXPANDED_SIZE_LIMIT")
                if info.header_offset < 0 or info.header_offset + 30 > offset:
                    raise ArchiveError("ARCHIVE_INVALID_ZIP")
                # Local metadata must not hide an encrypted entry / disagree with central directory.
                signature, _, flags, method = struct.unpack_from("<IHHH", data, info.header_offset)
                if signature != 0x04034b50 or flags != info.flag_bits or method != info.compress_type:
                    raise ArchiveError("ARCHIVE_INVALID_ZIP")
                if info.is_dir() and info.file_size:
                    raise ArchiveError("ARCHIVE_UNSAFE_ENTRY")
            if policy.strict_metadata:
                _check_metadata(data, infos, offset, records)
            result, pdfs, actual = [], 0, 0
            for index, info in enumerate(infos):
                if info.is_dir():
                    continue
                name = info.orig_filename
                item = {"entry_index": index, "entry_path": name, "byte_size": info.file_size,
                        "sha256": None, "rejection_code": None, "data": None}
                if not name.lower().endswith(".pdf"):
                    item["rejection_code"] = "ARCHIVE_UNSUPPORTED_FORMAT"
                elif info.file_size > policy.max_file:
                    item["rejection_code"] = "DOCUMENT_TOO_LARGE"
                elif pdfs >= policy.max_pdfs:
                    item["rejection_code"] = "ARCHIVE_PDF_LIMIT"
                else:
                    pdfs += 1
                    # ZipExtFile enforces overlap/local-name/CRC checks. Read one
                    # bounded member at a time; never use extract/extractall.
                    with archive.open(info) as member:
                        content = member.read(policy.max_file + 1)
                    actual += len(content)
                    if len(content) != info.file_size or actual > policy.max_total:
                        raise ArchiveError("ARCHIVE_EXPANDED_SIZE_LIMIT")
                    if zlib.crc32(content) != info.CRC:
                        raise ArchiveError("ARCHIVE_INVALID_ZIP")
                    if not content.startswith(b"%PDF-"):
                        item["rejection_code"] = "INVALID_DOCUMENT"
                    else:
                        item["sha256"] = hashlib.sha256(content).hexdigest()
                        item["data"] = base64.b64encode(content).decode("ascii")
                result.append(item)
            if not result:
                raise ArchiveError("ARCHIVE_NO_FILES")
            return result
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, ValueError, EOFError, struct.error, zlib.error) as exc:
        raise ArchiveError("ARCHIVE_INVALID_ZIP") from exc


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dossier", action="store_true", help="use the fixed bounded dossier profile")
    args = parser.parse_args()
    policy = DOSSIER_POLICY if args.dossier else LEGACY_POLICY
    try:
        items = read_archive(sys.stdin.buffer.read(policy.max_archive + 1), policy)
        print(json.dumps({"items": items}, ensure_ascii=True, separators=(",", ":")))
    except ArchiveError as exc:
        print(json.dumps({"error": str(exc)}))
    except Exception:
        # Never echo member content, internal paths or parser exception text.
        print(json.dumps({"error": "ARCHIVE_INVALID_ZIP"}))


if __name__ == "__main__":
    main()
