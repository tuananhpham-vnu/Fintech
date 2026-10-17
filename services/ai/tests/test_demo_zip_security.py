"""Actual stdlib ZIP validation/decompression, synthetic bytes only."""
import importlib.util
import io
from pathlib import Path
import stat
import struct
import zipfile

import pytest

spec = importlib.util.spec_from_file_location("demo_zip_reader", Path(__file__).parents[1] / "scripts/demo_zip_reader.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def archive(*entries, compression=zipfile.ZIP_STORED):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=compression) as z:
        for name, data in entries:
            z.writestr(name, data)
    return output.getvalue()


def rejected(data, code):
    with pytest.raises(reader.ArchiveError, match="^" + code + "$"):
        reader.read_archive(data)


@pytest.mark.parametrize("name", ["../evil.pdf", "/evil.pdf", "C:/evil.pdf", "C:evil.pdf", "\\\\host\\share\\a.pdf",
                                 "a/../evil.pdf", "a\\evil.pdf", "a//b.pdf", "a/./b.pdf", "a. /b.pdf",
                                 "a\x03b.pdf", "\uff0e\uff0e/evil.pdf", "a/\uff0e\uff0e/b.pdf"])
def test_unsafe_paths(name):
    raw = archive((name, b"%PDF-1.7\n"))
    # Windows ZipInfo writers turn OS separators into '/'. Put the adversarial
    # wire name back in both local and central headers without changing length.
    if "\\" in name:
        raw = raw.replace(name.replace("\\", "/").encode(), name.encode())
    rejected(raw, "ARCHIVE_UNSAFE_PATH")


def test_symlink():
    link = zipfile.ZipInfo("linked.pdf")
    link.create_system = 3
    link.external_attr = (stat.S_IFLNK | 0o777) << 16
    rejected(archive((link, b"../target")), "ARCHIVE_UNSAFE_ENTRY")


def test_duplicate_case_and_unicode_aliases():
    rejected(archive(("A.pdf", b"%PDF-1.7"), ("a.pdf", b"%PDF-1.7")), "ARCHIVE_DUPLICATE_PATH")
    rejected(archive(("é.pdf", b"%PDF-1.7"), ("e\u0301.pdf", b"%PDF-1.7")), "ARCHIVE_DUPLICATE_PATH")


def test_encrypted_flags_and_local_metadata_mismatch():
    raw = bytearray(archive(("safe.pdf", b"%PDF-1.7")))
    central = raw.index(b"PK\x01\x02")
    struct.pack_into("<H", raw, central + 8, 1)
    rejected(bytes(raw), "ARCHIVE_ENCRYPTED")
    raw = bytearray(archive(("safe.pdf", b"%PDF-1.7")))
    struct.pack_into("<H", raw, 6, 1)
    rejected(bytes(raw), "ARCHIVE_INVALID_ZIP")


def test_resource_caps_and_invalid_containers():
    rejected(archive(*[(f"{n}.pdf", b"%PDF-1.7") for n in range(33)]), "ARCHIVE_ENTRY_LIMIT")
    rejected(archive(("bomb.pdf", b"0" * 1000000), compression=zipfile.ZIP_DEFLATED), "ARCHIVE_COMPRESSION_RATIO")
    rejected(b"x" * (reader.MAX_ARCHIVE + 1), "ARCHIVE_SIZE_LIMIT")
    rejected(b"not zip", "ARCHIVE_INVALID_ZIP")
    rejected(archive(("safe.pdf", b"%PDF-1.7"))[:-2], "ARCHIVE_INVALID_ZIP")
    raw = bytearray(archive(("safe.pdf", b"%PDF-1.7")))
    struct.pack_into("<H", raw, raw.index(b"PK\x05\x06") + 4, 1)
    rejected(bytes(raw), "ARCHIVE_UNSUPPORTED_ZIP")


def test_crc_failure_and_local_name_mismatch_abort_entire_archive():
    raw = bytearray(archive(("first.pdf", b"%PDF-1.7 first"), ("second.pdf", b"%PDF-1.7 second")))
    raw[raw.index(b"%PDF-")] = ord("!")
    rejected(bytes(raw), "ARCHIVE_INVALID_ZIP")
    raw = bytearray(archive(("safe.pdf", b"%PDF-1.7")))
    raw[30] = ord("X")
    rejected(bytes(raw), "ARCHIVE_INVALID_ZIP")


def test_nested_and_other_formats_are_reported_not_omitted():
    result = reader.read_archive(archive(("folder/", b""), ("folder/a.pdf", b"%PDF-1.7"),
        ("nested.zip", b"PK\x03\x04"), ("book.xlsx", b"xlsx"), ("image.jpg", b"jpg"),
        ("old.rar", b"Rar!"), ("fake.pdf", b"not PDF")))
    assert len(result) == 6
    assert result[0]["entry_index"] == 1 and result[0]["sha256"] and result[0]["data"]
    assert [r["rejection_code"] for r in result[1:]] == ["ARCHIVE_UNSUPPORTED_FORMAT"] * 4 + ["INVALID_DOCUMENT"]


def test_pdf_batch_limit_is_explicit():
    result = reader.read_archive(archive(*[(f"{n}.pdf", b"%PDF-1.7") for n in range(9)]))
    assert len(result) == 9 and result[-1]["rejection_code"] == "ARCHIVE_PDF_LIMIT"


def test_oversized_member_is_explicit_before_decompression():
    raw = bytearray(archive(("large.pdf", b"%PDF-1.7")))
    central = raw.index(b"PK\x01\x02")
    struct.pack_into("<I", raw, central + 20, 200000)
    struct.pack_into("<I", raw, central + 24, reader.MAX_FILE + 1)
    result = reader.read_archive(bytes(raw))
    assert result[0]["rejection_code"] == "DOCUMENT_TOO_LARGE"


def test_total_expanded_budget_precedes_decompression():
    raw = bytearray(archive(("one.pdf", b"%PDF-1.7"), ("two.pdf", b"%PDF-1.7")))
    position = 0
    for _ in range(2):
        position = raw.index(b"PK\x01\x02", position)
        struct.pack_into("<I", raw, position + 20, 1000000)
        struct.pack_into("<I", raw, position + 24, 21 * 1024 * 1024)
        position += 4
    rejected(bytes(raw), "ARCHIVE_EXPANDED_SIZE_LIMIT")
