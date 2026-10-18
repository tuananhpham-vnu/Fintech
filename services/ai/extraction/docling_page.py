"""OCR một trang (ảnh PNG trên stdin) bằng Docling, chạy LOCAL trong venv riêng (DOCLING_PYTHON), không import code dự án.

  <DOCLING_PYTHON> docling_page.py --engine rapidocr --lang ch,en  < page.png  > {"text": ..., "version": ...}
  <DOCLING_PYTHON> docling_page.py --version

- Layout + bảng (TableFormer ACCURATE) + OCR toàn trang. enable_remote_services=False: không gọi dịch vụ ngoài.
- Text theo thứ tự đọc; bảng tuần tự hóa MỖI HÀNG MỘT DÒNG "ô | ô | ô" để trích dẫn của model khớp nguyên văn.
- KHÔNG bỏ thông tin: lấy cả tiêu đề/chân trang (layer FURNITURE, mặc định Docling ẩn) và chữ nằm trong vùng ảnh.
- --engine auto: lượt 1 RapidOCR PP-OCR `ch` (mạnh nhất cho chữ Hán, đọc được chữ Latin lẫn trong trang); trang gần như
  không có chữ Hán và có Apple Vision (macOS) thì lượt 2 ocrmac vi-VT/en-US (giữ đủ dấu tiếng Việt).
- Model (layout, TableFormer, OCR) lấy từ HF_HOME / thư mục package trong MODEL_DIR; đặt HF_HUB_OFFLINE=1 khi đã tải.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from importlib import metadata
from pathlib import Path


def _converter(engine: str, lang: list[str]):
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (OcrMacOptions, OcrMode, PdfPipelineOptions, RapidOcrOptions,
                                                    TableFormerMode, TableStructureOptions)
    from docling.document_converter import DocumentConverter, ImageFormatOption

    if engine == "rapidocr":
        ocr = RapidOcrOptions(mode=OcrMode.FULL_PAGE, lang=lang or ["ch"])
    elif engine == "ocrmac":
        ocr = OcrMacOptions(mode=OcrMode.FULL_PAGE, lang=lang or ["zh-Hans", "en-US", "vi-VT"], recognition="accurate")
    else:
        raise SystemExit(f"unknown engine {engine}")
    options = PdfPipelineOptions(do_ocr=True, ocr_options=ocr, do_table_structure=True,
                                 table_structure_options=TableStructureOptions(mode=TableFormerMode.ACCURATE,
                                                                               do_cell_matching=True),
                                 enable_remote_services=False)
    return DocumentConverter(format_options={InputFormat.IMAGE: ImageFormatOption(pipeline_options=options)})


def _table_lines(table, doc) -> list[str]:
    grid = table.data.grid if table.data else []
    lines = []
    for row in grid:
        cells, last = [], None
        for cell in row:
            if cell is last:            # ô gộp trải nhiều cột: chỉ ghi một lần
                continue
            last = cell
            cells.append(" ".join((cell.text or "").split()))
        if any(cells):
            lines.append(" | ".join(cells))
    return lines


def _top(item, doc) -> float:
    """Toạ độ đỉnh (gốc trên-trái) của item trên trang; không có vị trí thì coi như cuối trang."""
    prov = getattr(item, "prov", None) or []
    if not prov:
        return float("inf")
    page = doc.pages.get(prov[0].page_no)
    return prov[0].bbox.to_top_left_origin(page.size.height).t if page else float("inf")


def _item_lines(item, doc) -> list[str]:
    from docling_core.types.doc import PictureItem, TableItem
    if isinstance(item, TableItem):
        return _table_lines(item, doc)
    if isinstance(item, PictureItem):          # chữ trong ảnh đến từ item con (traverse_pictures)
        return []
    text = " ".join((getattr(item, "text", "") or "").split())
    return [text] if text else []


def _document_text(doc) -> str:
    from docling_core.types.doc import ContentLayer
    body = list(doc.iterate_items(traverse_pictures=True, included_content_layers={ContentLayer.BODY}))
    furniture = list(doc.iterate_items(traverse_pictures=True, included_content_layers={ContentLayer.FURNITURE}))
    first = min((_top(i, doc) for i, _ in body), default=float("inf"))
    head = sorted((i for i, _ in furniture if _top(i, doc) < first), key=lambda i: _top(i, doc))
    tail = sorted((i for i, _ in furniture if _top(i, doc) >= first), key=lambda i: _top(i, doc))
    lines: list[str] = []
    for item in head + [i for i, _ in body] + tail:
        lines += _item_lines(item, doc)
    return "\n".join(lines)


def _convert(png: bytes, engine: str, lang: list[str]) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "page.png"
        path.write_bytes(png)
        return _document_text(_converter(engine, lang).convert(path).document)


def _cjk_ratio(text: str) -> float:
    visible = [c for c in text if not c.isspace()]
    return sum(1 for c in visible if "\u3400" <= c <= "\u9fff" or "\uf900" <= c <= "\ufaff") / max(1, len(visible))


def _has_vision() -> bool:
    if sys.platform != "darwin":
        return False
    try:
        import ocrmac  # noqa: F401
        return True
    except ImportError:
        return False


def page_text(png: bytes, engine: str, lang: list[str]) -> tuple[str, str]:
    """-> (text, engine thực dùng)."""
    if engine != "auto":
        return _convert(png, engine, lang), engine
    text = _convert(png, "rapidocr", ["ch"])
    if _cjk_ratio(text) < 0.2 and _has_vision():
        return _convert(png, "ocrmac", ["vi-VT", "en-US"]), "ocrmac"
    return text, "rapidocr"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", default="auto", choices=["auto", "rapidocr", "ocrmac"])
    parser.add_argument("--lang", default="")
    parser.add_argument("--version", action="store_true")
    args = parser.parse_args()
    if args.version:
        print(json.dumps({"version": f"docling-{metadata.version('docling')}/{args.engine}"}))
        return 0
    png = sys.stdin.buffer.read()
    if not png.startswith(b"\x89PNG"):
        print(json.dumps({"error": "stdin is not a PNG"}))
        return 2
    text, used = page_text(png, args.engine, [x for x in args.lang.split(",") if x])
    version = f"docling-{metadata.version('docling')}/{used}"
    sys.stdout.write(json.dumps({"text": text, "version": version}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
