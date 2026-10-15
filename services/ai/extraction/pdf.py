"""Đọc PDF bằng PyMuPDF: inspect (không OCR/LLM), text nhúng theo trang, nhận diện trang scan, render ảnh, bbox.

PyMuPDF không thread-safe, còn runner chạy backend trong threadpool: mọi thao tác MuPDF đi qua `_LOCK`.
Lock chỉ giữ trong lúc đọc PDF, không giữ khi gọi OCR/LLM.

Giới hạn tài nguyên (`Limits`), đều kiểm TRƯỚC khi MuPDF cấp phát theo kích thước do file tự khai:
  - số trang: kiểm trước khi đọc text bất kỳ trang nào;
  - content stream FlateDecode của trang: giải nén thử bằng zlib có giới hạn trước khi MuPDF parse (chặn zip bomb);
  - tổng text trích ra; số pixel ảnh theo từ điển ảnh (không giải mã); kích thước ảnh render và PNG gửi OCR.
Không chặn được bên trong MuPDF (font, filter khác Flate, thời gian CPU của một lệnh native): xem README.
"""
from __future__ import annotations

import math
import threading
import unicodedata
import zlib
from dataclasses import dataclass, field

import pymupdf

from runner.errors import ServiceError

PDF_INVALID = "PDF_INVALID"
PDF_ENCRYPTED = "PDF_ENCRYPTED"
PDF_TOO_LARGE = "PDF_TOO_LARGE"
PDF_TOO_MANY_PAGES = "PDF_TOO_MANY_PAGES"

_LOCK = threading.Lock()

MIN_TEXT_CHARS = 20          # ít hơn số ký tự (không tính khoảng trắng) này thì coi trang là ảnh scan
MAX_GARBLED_RATIO = 0.3      # tỉ lệ ký tự hỏng (thiếu ToUnicode) cao thì OCR lại
MIN_UNTEXTED_IMAGE = 0.3     # ảnh chiếm >= 30% trang ...
MIN_TEXT_SPAN = 0.15         # ... mà chữ nhúng phủ < 15% chiều cao ảnh -> thân trang là scan, OCR cả trang
OCR_DPI = 200
INSPECT_ANNOT_PAGES = 100    # inspect chỉ quét annotation đính kèm ở chừng này trang đầu (file dài hơn bị backend chặn)

pymupdf.TOOLS.mupdf_display_errors(False)   # không in cảnh báo MuPDF (có thể chứa nội dung) ra stderr


@dataclass(frozen=True)
class Limits:
    max_pages: int = 10
    max_content_bytes: int = 8_000_000       # content stream đã giải nén / trang
    max_page_text_chars: int = 40_000
    max_text_chars: int = 150_000
    max_image_pixels: int = 40_000_000       # tổng pixel ảnh khai báo trên một trang cần render (A4 600dpi ~ 35M)
    max_render_pixels: int = 8_000_000       # ảnh xám gửi OCR (A3 200dpi ~ 7.7M)
    max_render_side: int = 5_000
    min_ocr_dpi: int = 100                   # trang quá lớn để render đủ nét trong giới hạn -> từ chối, không OCR mờ
    max_ocr_png_bytes: int = 10_000_000


DEFAULT_LIMITS = Limits()


@dataclass
class PageInfo:
    page: int
    text: str                 # NFC, đúng như PDF (chưa OCR)
    width: float
    height: float
    image_count: int
    needs_ocr: bool
    blank: bool
    ocr_reason: str | None = None     # no_text | garbled | image_region


@dataclass
class PdfInfo:
    page_count: int
    encrypted: bool
    needs_password: bool
    has_embedded_files: bool
    pages: list[PageInfo] = field(default_factory=list)

    @property
    def scanned_pages(self) -> list[int]:
        return [p.page for p in self.pages if p.needs_ocr]


def _too_large(message: str) -> ServiceError:
    return ServiceError(413, PDF_TOO_LARGE, message)


def _open(data: bytes) -> pymupdf.Document:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # FileDataError, EmptyFileError, RuntimeError tùy phiên bản
        raise ServiceError(422, PDF_INVALID, "File is not a readable PDF.") from exc
    if not doc.is_pdf:
        doc.close()
        raise ServiceError(422, PDF_INVALID, "File is not a PDF.")
    return doc


def _garbled_ratio(text: str) -> float:
    chars = [c for c in text if not c.isspace()]
    if not chars:
        return 0.0
    bad = sum(1 for c in chars if c == "�" or unicodedata.category(c) in ("Co", "Cn", "Cc"))
    return bad / len(chars)


def _inflated_size(raw: bytes, cap: int) -> int:
    """Kích thước sau giải nén Flate, dừng ngay khi vượt `cap` (không bao giờ giữ quá ~1MB trong bộ nhớ)."""
    inflater, size, pending = zlib.decompressobj(), 0, raw
    try:
        while pending and size <= cap:
            size += len(inflater.decompress(pending, 1 << 20))
            pending = inflater.unconsumed_tail
        return size
    except zlib.error:
        return size        # stream hỏng: để MuPDF tự xử lý/báo lỗi như cũ


def _check_content_size(doc: pymupdf.Document, page: pymupdf.Page, limits: Limits) -> None:
    xrefs = list(page.get_contents()) + [x[0] for x in page.get_xobjects()]
    total = 0
    for xref in xrefs:
        try:
            filters = doc.xref_get_key(xref, "Filter")[1]
            raw = doc.xref_stream_raw(xref) or b""
        except Exception:
            continue
        if filters in ("null", ""):
            total += len(raw)
        elif filters == "/FlateDecode":
            total += _inflated_size(raw, limits.max_content_bytes - total)
        # Filter khác (LZW, chuỗi filter...) không đo được ở đây: rủi ro còn lại, ghi trong README
        if total > limits.max_content_bytes:
            raise _too_large(f"Page {page.number + 1} content exceeds {limits.max_content_bytes} bytes when decoded.")


def _scan_like_image(page: pymupdf.Page) -> bool:
    """Ảnh lớn (>= MIN_UNTEXTED_IMAGE diện tích trang) gần như không có chữ nhúng chạy qua (< MIN_TEXT_SPAN chiều cao
    của ảnh): thân trang là ảnh scan, chữ nhúng (nếu có) chỉ là tiêu đề/chân trang. Ảnh nền hoặc logo dưới một trang
    chữ bình thường có chữ chạy suốt chiều cao nên không bị OCR lại."""
    page_rect = page.rect
    area = page_rect.get_area()
    if area <= 0:
        return False
    images = [pymupdf.Rect(i["bbox"]) & page_rect for i in page.get_image_info()]   # vị trí đặt ảnh, không giải mã pixel
    images = [r for r in images if not r.is_empty and r.get_area() / area >= MIN_UNTEXTED_IMAGE]
    if not images:
        return False
    texts = [pymupdf.Rect(b[:4]) for b in page.get_text("blocks") if b[6] == 0 and b[4].strip()]
    for rect in images:
        spans = sorted((max(t.y0, rect.y0), min(t.y1, rect.y1)) for t in texts if (rect & t).get_area() > 0)
        covered, end = 0.0, rect.y0
        for y0, y1 in spans:                       # độ dài hợp các khoảng y có chữ trong ảnh
            if y1 > end:
                covered += y1 - max(y0, end)
                end = y1
        if covered / rect.height < MIN_TEXT_SPAN:
            return True
    return False


def _page_info(doc: pymupdf.Document, page: pymupdf.Page, limits: Limits) -> PageInfo:
    _check_content_size(doc, page, limits)
    text = unicodedata.normalize("NFC", page.get_text("text"))
    if len(text) > limits.max_page_text_chars:
        raise _too_large(f"Page {page.number + 1} has more than {limits.max_page_text_chars} characters of text.")
    images = len(page.get_images(full=False))
    visible = sum(1 for c in text if not c.isspace())
    reason = None
    if images:
        if visible < MIN_TEXT_CHARS:
            reason = "no_text"
        elif _garbled_ratio(text) > MAX_GARBLED_RATIO:
            reason = "garbled"
        elif _scan_like_image(page):
            reason = "image_region"
    return PageInfo(page=page.number + 1, text=text, width=float(page.rect.width), height=float(page.rect.height),
                    image_count=images, needs_ocr=reason is not None, blank=visible == 0 and images == 0,
                    ocr_reason=reason)


def inspect(data: bytes, with_pages: bool = False, limits: Limits = DEFAULT_LIMITS) -> PdfInfo:
    """Chỉ đọc cấu trúc. Không render, không OCR. `with_pages` thêm text nhúng từng trang (dùng cho extract) và
    áp `limits`: quá số trang thì từ chối TRƯỚC khi đọc text của bất kỳ trang nào."""
    with _LOCK:
        doc = _open(data)
        try:
            encrypted = bool(doc.needs_pass or doc.is_encrypted or (doc.metadata or {}).get("encryption"))
            page_count = doc.page_count
            if page_count < 1:
                raise ServiceError(422, PDF_INVALID, "PDF has no pages.")
            info = PdfInfo(page_count=page_count, encrypted=encrypted, needs_password=bool(doc.needs_pass),
                           has_embedded_files=_embedded_files(doc))
            if with_pages:
                if doc.needs_pass:
                    raise ServiceError(422, PDF_ENCRYPTED, "PDF requires a password; content cannot be read.")
                if page_count > limits.max_pages:
                    raise ServiceError(413, PDF_TOO_MANY_PAGES,
                                       f"PDF has {page_count} pages; limit is {limits.max_pages}.")
                total = 0
                for page in doc:
                    info.pages.append(_page_info(doc, page, limits))
                    total += len(info.pages[-1].text)
                    if total > limits.max_text_chars:
                        raise _too_large(f"PDF has more than {limits.max_text_chars} characters of text.")
            return info
        finally:
            doc.close()


def _embedded_files(doc: pymupdf.Document) -> bool:
    try:
        if doc.embfile_count() > 0:
            return True
    except Exception:  # PDF hỏng một phần: không đoán là có
        return False
    if doc.needs_pass:
        return False
    try:
        pages = range(min(doc.page_count, INSPECT_ANNOT_PAGES))
        return any(annot.type[0] == pymupdf.PDF_ANNOT_FILE_ATTACHMENT for n in pages for annot in doc[n].annots())
    except Exception:
        return False


def render_zoom(width_pt: float, height_pt: float, limits: Limits = DEFAULT_LIMITS, dpi: int = OCR_DPI) -> float:
    """Zoom render cho OCR: tối đa `dpi`, nhưng ảnh không vượt số pixel/cạnh cho phép."""
    if width_pt <= 0 or height_pt <= 0:
        raise ServiceError(422, PDF_INVALID, "Page has no area.")
    zoom = min(dpi / 72, math.sqrt(limits.max_render_pixels / (width_pt * height_pt)),
               limits.max_render_side / max(width_pt, height_pt))
    if zoom * 72 < limits.min_ocr_dpi:
        raise _too_large(f"Page is too large to OCR within {limits.max_render_pixels} pixels.")
    return zoom


def render_png(data: bytes, page_number: int, limits: Limits = DEFAULT_LIMITS, dpi: int = OCR_DPI) -> bytes:
    with _LOCK:
        doc = _open(data)
        try:
            page = doc[page_number - 1]
            declared = sum(i[2] * i[3] for i in page.get_images(full=True))   # từ điển ảnh, chưa giải mã
            if declared > limits.max_image_pixels:
                raise _too_large(f"Page {page_number} images declare {declared} pixels; limit is "
                                 f"{limits.max_image_pixels}.")
            zoom = render_zoom(page.rect.width, page.rect.height, limits, dpi)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csGRAY, alpha=False)
            png = pix.tobytes("png")
        finally:
            doc.close()
    if len(png) > limits.max_ocr_png_bytes:
        raise _too_large(f"Rendered page {page_number} is larger than {limits.max_ocr_png_bytes} bytes.")
    return png


def find_bboxes(data: bytes, quotes: dict[int, list[str]]) -> dict[tuple[int, str], list[float]]:
    """bbox chuẩn hóa [x0, y0, x1, y1] trong [0, 1] cho quote trên trang text. Không tìm thấy thì bỏ qua (bbox null)."""
    found: dict[tuple[int, str], list[float]] = {}
    with _LOCK:
        doc = _open(data)
        try:
            for page_number, items in quotes.items():
                page = doc[page_number - 1]
                width, height = page.rect.width, page.rect.height
                for quote in items:
                    per_line = [page.search_for(line.strip()) for line in quote.splitlines() if line.strip()]
                    if not per_line or any(len(h) != 1 for h in per_line):
                        continue  # không thấy hoặc trùng nhiều chỗ: không đoán vị trí, để bbox null
                    hits = [h[0] for h in per_line]
                    box = pymupdf.Rect(hits[0])
                    for h in hits[1:]:
                        box |= h
                    found[(page_number, quote)] = [round(min(max(v, 0.0), 1.0), 4) for v in
                                                   (box.x0 / width, box.y0 / height, box.x1 / width, box.y1 / height)]
        finally:
            doc.close()
    return found
