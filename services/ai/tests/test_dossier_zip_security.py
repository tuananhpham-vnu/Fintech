"""Offline synthetic ZIP fixtures for the fixed dossier and legacy profiles."""
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import random
import stat
import struct
import subprocess
import sys
import zipfile

import pytest


SCRIPT = Path(__file__).parents[1] / "scripts/demo_zip_reader.py"
spec = importlib.util.spec_from_file_location("dossier_zip_reader", SCRIPT)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
MIB = 1024 * 1024
PDF = b"%PDF-1.7\nsynthetic fixture\n"


def test_financial_profile_accepts_supported_members_without_relaxing_legacy_profile():
    payload=archive(('source.pdf',PDF),('book.xlsx',b'PK\x03\x04synthetic'),('scan.png',b'\x89PNG\r\n\x1a\nsynthetic'),('notes.txt',b'not a statement'))
    financial=reader.read_archive(payload,reader.FINANCIAL_POLICY)
    assert [entry['rejection_code'] for entry in financial]==[None,None,None,'ARCHIVE_UNSUPPORTED_FORMAT']
    legacy=reader.read_archive(payload,reader.DOSSIER_POLICY)
    assert sum(entry['rejection_code'] is None for entry in legacy)==1


def archive(*entries, compression=zipfile.ZIP_STORED, stream=False):
    class Unseekable(io.BytesIO):
        def seekable(self):
            return False

        def seek(self, *args):
            raise io.UnsupportedOperation("synthetic streaming writer")

    output = Unseekable() if stream else io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=compression) as writer:
        for name, content in entries:
            writer.writestr(name, content)
    return output.getvalue()


def dossier(raw):
    return reader.read_archive(raw, reader.DOSSIER_POLICY)


def rejected(raw, code, policy=reader.DOSSIER_POLICY):
    with pytest.raises(reader.ArchiveError, match="^" + code + "$"):
        reader.read_archive(bytes(raw), policy)


def cli(raw, *args):
    completed = subprocess.run(
        [sys.executable, "-B", str(SCRIPT), *args], input=bytes(raw),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=30,
    )
    assert completed.stderr == b""
    lines = completed.stdout.splitlines()
    assert len(lines) == 1
    return json.loads(lines[0])


def central_positions(raw):
    end = raw.rfind(b"PK\x05\x06")
    position = struct.unpack_from("<I", raw, end + 16)[0]
    result = []
    while position < end:
        result.append(position)
        lengths = struct.unpack_from("<HHH", raw, position + 28)
        position += 46 + sum(lengths)
    return result


def local_offset(raw, central):
    return struct.unpack_from("<I", raw, central + 42)[0]


def padded_pdf(size):
    # Roughly 4:1 compression: bounded ZIP bytes without triggering ratio 100.
    block = random.Random(17).randbytes(16 * 1024) + bytes(48 * 1024)
    return PDF + (block * (size // len(block) + 1))[:size - len(PDF)]


def test_profiles_are_fixed_and_legacy_defaults_unchanged():
    assert (reader.MAX_ARCHIVE, reader.MAX_TOTAL, reader.MAX_ENTRIES,
            reader.MAX_PDFS, reader.MAX_FILE, reader.MAX_RATIO) == (
                20 * MIB, 40 * MIB, 32, 8, 10 * MIB, 100)
    assert reader.LEGACY_POLICY == reader.ArchivePolicy()
    assert reader.DOSSIER_POLICY == reader.ArchivePolicy(
        max_archive=32 * MIB, max_total=64 * MIB, max_entries=128,
        max_pdfs=64, max_depth=8, strict_metadata=True,
    )


@pytest.mark.parametrize("name", ["%2e%2e/evil.pdf", "%252e%252e/evil.pdf", "%2fabsolute.pdf",
                                 "folder/%5cevil.pdf", "C%3a/evil.pdf", "hidden%00.pdf"])
def test_dossier_rejects_escaped_traversal_aliases_without_decoding_display_path(name):
    rejected(archive((name, PDF)), "ARCHIVE_UNSAFE_PATH")


@pytest.mark.parametrize("count", [30, 60])
@pytest.mark.parametrize("compression", [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED])
def test_real_cli_accepts_thirty_and_sixty_pdfs(count, compression):
    raw = archive(*[(f"batch/{n}.pdf", PDF + str(n).encode()) for n in range(count)],
                  compression=compression)
    output = cli(raw, "--dossier")
    assert set(output) == {"items"}
    assert len(output["items"]) == count
    for index, item in enumerate(output["items"]):
        content = PDF + str(index).encode()
        assert item == {
            "entry_index": index, "entry_path": f"batch/{index}.pdf",
            "byte_size": len(content), "sha256": hashlib.sha256(content).hexdigest(),
            "rejection_code": None, "data": base64.b64encode(content).decode("ascii"),
        }
    legacy = cli(raw)
    if count > 32:
        assert legacy == {"error": "ARCHIVE_ENTRY_LIMIT"}
    else:
        assert [item["rejection_code"] for item in legacy["items"]] == (
            [None] * 8 + ["ARCHIVE_PDF_LIMIT"] * (count - 8))


@pytest.mark.parametrize("count", [64, 65, 128, 129])
def test_pdf_and_entry_boundaries(count):
    raw = archive(*[(f"{n}.pdf", PDF) for n in range(count)])
    if count > 128:
        rejected(raw, "ARCHIVE_ENTRY_LIMIT")
    else:
        items = dossier(raw)
        assert len(items) == count
        assert [item["rejection_code"] for item in items] == (
            [None] * min(count, 64) + ["ARCHIVE_PDF_LIMIT"] * max(0, count - 64))


def test_entry_budget_counts_directories_and_unsupported_files():
    raw = archive(*[(f"folder{n}/", b"") for n in range(127)], ("ok.pdf", PDF))
    assert dossier(raw)[0]["entry_index"] == 127
    rejected(archive(*[(f"{n}.txt", b"") for n in range(129)]), "ARCHIVE_ENTRY_LIMIT")


@pytest.mark.parametrize("declared", [1, 3])
def test_directory_count_is_checked_before_zipfile_allocates_members(monkeypatch, declared):
    raw = bytearray(archive(("one.txt", b"one"), ("two.txt", b"two")))
    end = raw.rfind(b"PK\x05\x06")
    struct.pack_into("<HH", raw, end + 8, declared, declared)

    def forbidden(*args, **kwargs):
        raise AssertionError("ZipFile must not parse a forged directory count")

    monkeypatch.setattr(reader.zipfile, "ZipFile", forbidden)
    rejected(raw, "ARCHIVE_INVALID_ZIP")


@pytest.mark.parametrize("directory", [False, True])
def test_directory_depth_boundary(directory):
    prefix = "/".join(f"d{n}" for n in range(8))
    name = prefix + ("/" if directory else "/ok.pdf")
    entries = [(name, b"" if directory else PDF)]
    if directory:
        entries.append(("ok.pdf", PDF))
    assert dossier(archive(*entries))
    deep = prefix + ("/ninth/" if directory else "/ninth/ok.pdf")
    rejected(archive((deep, b"" if directory else PDF), ("other.pdf", PDF)), "ARCHIVE_UNSAFE_PATH")
    assert reader.read_archive(archive((prefix + "/ninth/ok.pdf", PDF)))[0]["data"]


@pytest.mark.parametrize("name", [
    "../evil.pdf", "/evil.pdf", "C:/evil.pdf", "C:evil.pdf", "a/../evil.pdf",
    "a//b.pdf", "a/./b.pdf", "a. /b.pdf", "a\x00b.pdf", "\uff0e\uff0e/evil.pdf",
    "a/\uff0e\uff0e/b.pdf", "a//", "a\x03b.pdf", "\\evil.pdf", "a\\b.pdf",
])
def test_dossier_unsafe_paths_apply_to_unsupported_entries_too(name):
    # Replace equal-length wire names to bypass ZipInfo's NUL/separator cleanup.
    wire = name.encode("utf-8")
    safe = "s" * len(wire)
    raw = bytearray(archive((safe, b"unsupported")).replace(safe.encode(), wire))
    if not name.isascii():
        struct.pack_into("<H", raw, 6, 0x800)
        struct.pack_into("<H", raw, central_positions(raw)[0] + 8, 0x800)
    rejected(raw, "ARCHIVE_UNSAFE_PATH")


@pytest.mark.parametrize("names", [("A.pdf", "a.pdf"), ("é.txt", "e\u0301.txt"),
                                    ("folder/", "FOLDER")])
def test_dossier_duplicate_normalized_paths(names):
    rejected(archive(*[(name, b"") for name in names]), "ARCHIVE_DUPLICATE_PATH")


@pytest.mark.parametrize("kind", [stat.S_IFLNK, stat.S_IFIFO, stat.S_IFSOCK])
def test_dossier_rejects_special_entries(kind):
    info = zipfile.ZipInfo("unsupported.txt")
    info.create_system = 3
    info.external_attr = (kind | 0o777) << 16
    rejected(archive((info, b"target")), "ARCHIVE_UNSAFE_ENTRY")


def test_unsupported_nested_files_are_explicit_and_indices_preserved():
    raw = archive(("folder/", b""), ("folder/ok.PDF", PDF),
                  ("nested.zip", archive(("hidden.pdf", PDF))), ("old.rar", b"Rar!"),
                  ("old.7z", b"7z"), ("file.txt", b"text"), ("fake.pdf", b"PK\x03\x04"))
    items = dossier(raw)
    assert [item["entry_index"] for item in items] == list(range(1, 7))
    assert [item["rejection_code"] for item in items] == (
        [None] + ["ARCHIVE_UNSUPPORTED_FORMAT"] * 4 + ["INVALID_DOCUMENT"])
    assert all(item["data"] is None and item["sha256"] is None for item in items[1:])


@pytest.mark.parametrize("policy", [reader.LEGACY_POLICY, reader.DOSSIER_POLICY])
def test_exact_zip_byte_budget(policy):
    overhead = len(archive(("large.bin", b"")))
    raw = archive(("large.bin", b"x" * (policy.max_archive - overhead)))
    assert len(raw) == policy.max_archive
    assert reader.read_archive(raw, policy)[0]["rejection_code"] == "ARCHIVE_UNSUPPORTED_FORMAT"
    rejected(raw + b"x", "ARCHIVE_SIZE_LIMIT", policy)


@pytest.mark.parametrize("extra", [0, 1])
def test_real_ten_mib_member_boundary(extra):
    raw = archive(("member.pdf", padded_pdf(10 * MIB + extra)), compression=zipfile.ZIP_DEFLATED)
    item = dossier(raw)[0]
    assert item["byte_size"] == 10 * MIB + extra
    assert item["rejection_code"] == ("DOCUMENT_TOO_LARGE" if extra else None)
    if not extra:
        assert len(base64.b64decode(item["data"])) == 10 * MIB


def test_real_sixty_four_mib_expanded_boundary_includes_unsupported_entries():
    content = padded_pdf(9 * MIB)
    raw = archive(*[(f"{n}.txt", content) for n in range(7)],
                  ("last.txt", padded_pdf(MIB)), compression=zipfile.ZIP_DEFLATED)
    assert sum(item["byte_size"] for item in dossier(raw)) == 64 * MIB
    changed = bytearray(raw)
    last = central_positions(changed)[-1]
    # One byte over the aggregate budget must fail before any decompression.
    struct.pack_into("<I", changed, last + 24, MIB + 1)
    rejected(changed, "ARCHIVE_EXPANDED_SIZE_LIMIT")


@pytest.mark.parametrize("name", ["bomb.pdf", "bomb.txt", "nested.zip"])
def test_ratio_applies_to_every_entry(name):
    rejected(archive((name, b"0" * MIB), compression=zipfile.ZIP_DEFLATED),
             "ARCHIVE_COMPRESSION_RATIO")


def test_ratio_exact_metadata_boundary():
    raw = bytearray(archive(("unsupported.txt", b"x")))
    central = central_positions(raw)[0]
    struct.pack_into("<I", raw, central + 24, 101)
    rejected(raw, "ARCHIVE_COMPRESSION_RATIO")
    struct.pack_into("<I", raw, central + 24, 100)
    # Ratio 100 passes the ratio gate and reaches the metadata mismatch gate.
    rejected(raw, "ARCHIVE_INVALID_ZIP")


@pytest.mark.parametrize("name", ["ok.pdf", "unsupported.txt"])
@pytest.mark.parametrize("flag", [1, 64])
def test_central_encryption_flags(name, flag):
    raw = bytearray(archive((name, PDF)))
    struct.pack_into("<H", raw, central_positions(raw)[0] + 8, flag)
    rejected(raw, "ARCHIVE_ENCRYPTED")


@pytest.mark.parametrize("name", ["ok.pdf", "unsupported.txt"])
@pytest.mark.parametrize("field,fmt,value", [
    (4, "H", 21), (6, "H", 1), (8, "H", 8), (10, "H", 1),
    (12, "H", 1), (14, "I", 0), (18, "I", 1), (22, "I", 1),
    (26, "H", 1), (28, "H", 65535),
])
def test_local_metadata_must_match_for_all_entries(name, field, fmt, value):
    raw = bytearray(archive((name, PDF)))
    struct.pack_into("<" + fmt, raw, field, value)
    rejected(raw, "ARCHIVE_UNSUPPORTED_ZIP" if field == 4 else "ARCHIVE_INVALID_ZIP")


def test_local_name_of_unsupported_entry_cannot_hide_traversal():
    raw = bytearray(archive(("safe.txt", b"text")))
    raw[30:38] = b"../x.txt"
    rejected(raw, "ARCHIVE_INVALID_ZIP")


def test_stored_sizes_must_agree_even_for_unsupported_entries():
    raw = bytearray(archive(("unsupported.txt", b"text")))
    struct.pack_into("<I", raw, 22, 3)
    struct.pack_into("<I", raw, central_positions(raw)[0] + 24, 3)
    rejected(raw, "ARCHIVE_INVALID_ZIP")


@pytest.mark.parametrize("name", ["ok.pdf", "unsupported.txt"])
@pytest.mark.parametrize("location", ["central", "local"])
def test_zip64_extra_fields_are_rejected_even_without_sentinel_sizes(name, location):
    info = zipfile.ZipInfo(name)
    info.extra = struct.pack("<HHQ", 0xbeef, 8, 0)
    raw = bytearray(archive((info, PDF)))
    central = central_positions(raw)[0]
    extra = (central + 46 if location == "central" else 30) + len(name)
    struct.pack_into("<H", raw, extra, 1)
    rejected(raw, "ARCHIVE_UNSUPPORTED_ZIP")


@pytest.mark.parametrize("location", ["local", "central"])
def test_malformed_extra_field_bounds(location):
    info = zipfile.ZipInfo("unsupported.txt")
    info.extra = struct.pack("<HH", 0xbeef, 0)
    raw = bytearray(archive((info, b"text")))
    central = central_positions(raw)[0]
    extra = (central + 46 if location == "central" else 30) + len(info.filename)
    struct.pack_into("<H", raw, extra + 2, 1)
    rejected(raw, "ARCHIVE_INVALID_ZIP")


@pytest.mark.parametrize("field,fmt,value,code", [
    (6, "H", 45, "ARCHIVE_UNSUPPORTED_ZIP"),
    (10, "H", zipfile.ZIP_BZIP2, "ARCHIVE_UNSUPPORTED_COMPRESSION"),
    (20, "I", 0xffffffff, "ARCHIVE_UNSUPPORTED_ZIP"),
    (34, "H", 1, "ARCHIVE_UNSUPPORTED_ZIP"),
    (42, "I", 1, "ARCHIVE_INVALID_ZIP"),
])
def test_unsupported_central_metadata(field, fmt, value, code):
    raw = bytearray(archive(("unsupported.txt", b"text")))
    struct.pack_into("<" + fmt, raw, central_positions(raw)[0] + field, value)
    rejected(raw, code)


@pytest.mark.parametrize("compression", [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED])
def test_crc_failure_in_late_pdf_aborts_cli_without_partial_items(compression):
    raw = bytearray(archive(("first.pdf", PDF), ("second.pdf", PDF + b"second"),
                            compression=compression))
    central = central_positions(raw)[1]
    local = local_offset(raw, central)
    # Keep metadata mutually consistent but make its CRC disagree with content.
    crc = struct.unpack_from("<I", raw, central + 16)[0] ^ 1
    struct.pack_into("<I", raw, central + 16, crc)
    struct.pack_into("<I", raw, local + 14, crc)
    rejected(raw, "ARCHIVE_INVALID_ZIP")
    assert cli(raw, "--dossier") == {"error": "ARCHIVE_INVALID_ZIP"}


@pytest.mark.parametrize("compression", [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED])
def test_streaming_descriptor_validation(compression):
    raw = archive(("ok.pdf", PDF), ("unsupported.txt", b"text"),
                  compression=compression, stream=True)
    assert dossier(raw)[0]["data"]
    changed = bytearray(raw)
    descriptor = changed.rfind(b"PK\x07\x08")
    changed[descriptor + 4] ^= 1
    rejected(changed, "ARCHIVE_INVALID_ZIP")


def test_unsigned_classic_descriptor_is_supported():
    raw = bytearray(archive(("ok.pdf", PDF), stream=True))
    descriptor = raw.index(b"PK\x07\x08")
    del raw[descriptor:descriptor + 4]
    end = raw.rfind(b"PK\x05\x06")
    offset = struct.unpack_from("<I", raw, end + 16)[0]
    struct.pack_into("<I", raw, end + 16, offset - 4)
    assert dossier(raw)[0]["data"]


def test_overlapping_unsupported_members_and_hidden_local_members_fail():
    raw = bytearray(archive(("first.txt", b"first"), ("other.txt", b"other")))
    first, second = central_positions(raw)
    struct.pack_into("<I", raw, second + 42, 0)
    rejected(raw, "ARCHIVE_INVALID_ZIP")
    raw = bytearray(archive(("first.txt", b"first"), ("other.txt", b"other")))
    first, second = central_positions(raw)
    end = raw.rfind(b"PK\x05\x06")
    del raw[first:second]
    end -= second - first
    struct.pack_into("<HHI", raw, end + 8, 1, 1, end - first)
    rejected(raw, "ARCHIVE_INVALID_ZIP")


def test_nonempty_directories_fail_before_output():
    rejected(archive(("ok.pdf", PDF), ("directory/", b"hidden")), "ARCHIVE_UNSAFE_ENTRY")
    rejected(archive(("empty/", b"")), "ARCHIVE_NO_FILES")


@pytest.mark.parametrize("mutation", ["truncated", "trailing", "multidisk", "zip64"])
def test_invalid_container_variants(mutation):
    raw = bytearray(archive(("ok.pdf", PDF)))
    end = raw.rfind(b"PK\x05\x06")
    code = "ARCHIVE_INVALID_ZIP"
    if mutation == "truncated":
        del raw[-2:]
    elif mutation == "trailing":
        raw.extend(b"payload")
    elif mutation == "multidisk":
        struct.pack_into("<H", raw, end + 4, 1)
        code = "ARCHIVE_UNSUPPORTED_ZIP"
    else:
        struct.pack_into("<H", raw, end + 10, 65535)
        code = "ARCHIVE_UNSUPPORTED_ZIP"
    rejected(raw, code)


def test_late_security_error_prevents_any_cli_items():
    raw = archive(("ok.pdf", PDF), ("../unsupported.txt", b"text"))
    assert cli(raw, "--dossier") == {"error": "ARCHIVE_UNSAFE_PATH"}
