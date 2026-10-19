"""OCR một trang (ảnh PNG trên stdin) bằng Docling, chạy LOCAL trong venv riêng (DOCLING_PYTHON), không import code dự án.

  <DOCLING_PYTHON> docling_page.py --engine easyocr --lang vi,en  < page.png  > {"text": ..., "version": ...}
  <DOCLING_PYTHON> docling_page.py --version

- Layout + bảng (TableFormer ACCURATE) + OCR toàn trang. enable_remote_services=False: không gọi dịch vụ ngoài.
- Text theo thứ tự đọc; bảng tuần tự hóa MỖI HÀNG MỘT DÒNG "ô | ô | ô" để trích dẫn của model khớp nguyên văn.
- KHÔNG bỏ thông tin: lấy cả tiêu đề/chân trang (layer FURNITURE, mặc định Docling ẩn) và chữ nằm trong vùng ảnh.
- Windows/Linux mặc định EasyOCR vi/en; auto trên macOS giữ lựa chọn Apple Vision của nhánh nguồn.
- --serve giữ model giữa các trang. Runtime chỉ dùng model đã tải trong DOCLING_ARTIFACTS_PATH, không tự tải.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import base64
import contextlib
from functools import lru_cache
from importlib import metadata
from pathlib import Path


@lru_cache(maxsize=1)
def _converter(engine: str, lang: tuple[str, ...]):
    from docling.datamodel.accelerator_options import AcceleratorOptions
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (EasyOcrOptions, OcrMacOptions, OcrMode, PdfPipelineOptions, RapidOcrOptions,
                                                    TableFormerMode, TableStructureOptions)
    from docling.document_converter import DocumentConverter, ImageFormatOption

    if engine == "easyocr":
        # On the real BCTCs, scale 1 drops bold total-row labels. Scale 2
        # preserves these labels without the cost of Docling's default scale 3.
        # One correctly read total in the real PDF has confidence 0.423; the
        # default 0.5 threshold deletes it. Preserve it for unverified review.
        ocr = EasyOcrOptions(mode=OcrMode.FULL_PAGE, lang=list(lang) or ["vi", "en"], scale=2.0,
                             confidence_threshold=0.3,
                             download_enabled=False)
    elif engine == "rapidocr":
        ocr = RapidOcrOptions(mode=OcrMode.FULL_PAGE, lang=list(lang) or ["iso:vi"],scale=1.0,
                              backend='onnxruntime')
    elif engine == "ocrmac":
        ocr = OcrMacOptions(mode=OcrMode.FULL_PAGE, lang=list(lang) or ["zh-Hans", "en-US", "vi-VT"], recognition="accurate")
    else:
        raise SystemExit(f"unknown engine {engine}")
    options = PdfPipelineOptions(do_ocr=True, ocr_options=ocr, do_table_structure=True,
                                 table_structure_options=TableStructureOptions(mode=TableFormerMode.ACCURATE,
                                                                               do_cell_matching=True),
                                 enable_remote_services=False,
                                 generate_parsed_pages=True,
                                 accelerator_options=AcceleratorOptions(num_threads=2,device='cpu'),
                                 artifacts_path=os.environ.get('DOCLING_ARTIFACTS_PATH') or None)
    return DocumentConverter(format_options={InputFormat.IMAGE: ImageFormatOption(pipeline_options=options)})


def _spatial_text(box, cells, height):
    box=box.to_top_left_origin(height)
    selected=[]
    for cell in cells:
        rect=cell.rect.to_bounding_box().to_top_left_origin(height)
        x,y=(rect.l+rect.r)/2,(rect.t+rect.b)/2
        if box.l <= x <= box.r and box.t <= y <= box.b and cell.text.strip():
            selected.append((rect,cell.text))
    selected.sort(key=lambda item:((item[0].t+item[0].b)/2,item[0].l))
    lines=[]
    for rect,text in selected:
        center=(rect.t+rect.b)/2
        if not lines or abs(center-lines[-1][0]) > max(2,(rect.b-rect.t)*.5):
            lines.append((center,[(rect.l,text)]))
        else:
            lines[-1][1].append((rect.l,text))
    return ' '.join(text for _,line in lines for _,text in sorted(line))


def _table_lines(table, doc, page_cells=None) -> list[str]:
    grid = table.data.grid if table.data else []
    lines = []
    for row in grid:
        cells, last = [], None
        for cell in row:
            if cell is last:            # ô gộp trải nhiều cột: chỉ ghi một lần
                continue
            last = cell
            text=cell.text or ''
            if page_cells and table.prov and cell.bbox:
                page_no=table.prov[0].page_no
                height=doc.pages[page_no].size.height
                # TableFormer can concatenate matched OCR fragments in token-ID
                # order. Rebuild only from the original boxes inside this cell.
                spatial=_spatial_text(cell.bbox,page_cells.get(page_no,[]),height)
                if spatial:
                    text=spatial
            cells.append(" ".join(text.split()))
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


def _item_lines(item, doc, page_cells=None) -> list[str]:
    from docling_core.types.doc import PictureItem, TableItem
    if isinstance(item, TableItem):
        return _table_lines(item, doc,page_cells)
    if isinstance(item, PictureItem):          # chữ trong ảnh đến từ item con (traverse_pictures)
        return []
    text = " ".join((getattr(item, "text", "") or "").split())
    return [text] if text else []


def _document_text(doc,page_cells=None) -> str:
    from docling_core.types.doc import ContentLayer
    body = list(doc.iterate_items(traverse_pictures=True, included_content_layers={ContentLayer.BODY}))
    furniture = list(doc.iterate_items(traverse_pictures=True, included_content_layers={ContentLayer.FURNITURE}))
    first = min((_top(i, doc) for i, _ in body), default=float("inf"))
    head = sorted((i for i, _ in furniture if _top(i, doc) < first), key=lambda i: _top(i, doc))
    tail = sorted((i for i, _ in furniture if _top(i, doc) >= first), key=lambda i: _top(i, doc))
    lines: list[str] = []
    for item in head + [i for i, _ in body] + tail:
        lines += _item_lines(item, doc,page_cells)
    return "\n".join(lines)


def _convert(png: bytes, engine: str, lang: list[str]) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "page.png"
        path.write_bytes(png)
        result=_converter(engine, tuple(lang)).convert(path)
        page_cells={p.page_no:p.parsed_page.textline_cells for p in result.pages if p.parsed_page}
        return _document_text(result.document,page_cells)


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
    if sys.platform != "darwin":
        return _convert(png, "easyocr", lang or ["vi", "en"]), "easyocr"
    text = _convert(png, "rapidocr", ["ch"])
    if _cjk_ratio(text) < 0.2 and _has_vision():
        return _convert(png, "ocrmac", ["vi-VT", "en-US"]), "ocrmac"
    return text, "rapidocr"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", default="easyocr", choices=["auto", "easyocr", "rapidocr", "ocrmac"])
    parser.add_argument("--lang", default="")
    parser.add_argument("--version", action="store_true")
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    if args.version:
        from importlib.util import find_spec
        backend = 'easyocr' if args.engine == 'auto' and sys.platform != 'darwin' else args.engine
        if backend in ('easyocr','rapidocr','ocrmac') and find_spec(backend) is None:
            return 2
        if os.environ.get('DOCLING_ARTIFACTS_PATH') and backend == 'easyocr':
            models=Path(os.environ['DOCLING_ARTIFACTS_PATH'])
            required=['EasyOcr/craft_mlt_25k.pth','EasyOcr/latin_g2.pth',
                      'docling-project--docling-layout-heron/model.safetensors',
                      'docling-project--docling-models/model_artifacts/tableformer/accurate/tableformer_accurate.safetensors']
            if any(not (models/name).is_file() for name in required):
                return 2
        print(json.dumps({"version": f"docling-{metadata.version('docling')}/{args.engine}", 'protocol':'json-lines-v1'}))
        return 0
    if args.serve:
        for line in sys.stdin.buffer:
            try:
                if len(line)>14000000:
                    raise ValueError()
                png=base64.b64decode(json.loads(line)['png_base64'],validate=True)
                if not png.startswith(b'\x89PNG'):
                    raise ValueError()
                with contextlib.redirect_stdout(sys.stderr):
                    text,used=page_text(png,args.engine,[x for x in args.lang.split(',') if x])
                if len(text)>250000:
                    raise ValueError()
                result={'text':text,'version':f"docling-{metadata.version('docling')}/{used}"}
            except Exception:
                result={'error':'LOCAL_OCR_FAILED'}
            print(json.dumps(result,ensure_ascii=True),flush=True)
        return 0
    png = sys.stdin.buffer.read()
    if not png.startswith(b"\x89PNG"):
        print(json.dumps({"error": "stdin is not a PNG"}))
        return 2
    text, used = page_text(png, args.engine, [x for x in args.lang.split(",") if x])
    if len(text) > 250000:
        return 2
    version = f"docling-{metadata.version('docling')}/{used}"
    sys.stdout.write(json.dumps({"text": text, "version": version}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
