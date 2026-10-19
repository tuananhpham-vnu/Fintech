"""Extraction package (M2) — OWNER: Nguyên. Runner import trực tiếp, không copy code:

    import extraction
    extraction.inspect(payload: dict) -> dict   # InspectionInput  -> InspectionOutput (1.0.2)
    extraction.extract(payload: dict) -> dict   # ExtractionInput  -> ExtractionOutput (1.0.2)

- inspect: đọc cấu trúc PDF bằng PyMuPDF (số trang, mã hóa, file đính kèm). Không OCR, không LLM.
- extract: text nhúng theo trang, trang scan -> OCR, provider đề xuất field, code kiểm căn cứ (extractor.py, grounding.py).
- Input đã được runner validate; output được runner validate schema + guard trước khi trả.
- Lỗi nghiệp vụ: ServiceError với mã PDF_NOT_FOUND, SHA256_MISMATCH, PDF_INVALID, PDF_ENCRYPTED, PDF_TOO_LARGE,
  PDF_TOO_MANY_PAGES, PDF_NO_TEXT, PROVIDER_UNAVAILABLE, INVALID_MODEL_OUTPUT. Không bao giờ trả gold/mock ở live.

Biến môi trường (đọc lúc request đầu tiên):
  AI_STORAGE_DIR          thư mục gốc chứa file theo storage_key (bắt buộc cho live inspect/extract)
  AI_MAX_PDF_BYTES        mặc định 25000000
  AI_MAX_PAGES            mặc định 10 (extract; inspect vẫn báo đúng số trang thật)
  AI_EXTRACT_DEADLINE_S   budget tổng một lần extract (OCR + model + repair), mặc định 240
  AI_MAX_MODEL_CALLS      số lời gọi Gemini/OCR chạy cùng lúc trong process, mặc định 4
  AI_MAX_MODEL_QUEUE      số lời gọi được chờ slot; đầy thì 503 ngay, mặc định 16
  OCR_ENGINE              provider (mặc định) | tesseract | none; gemini là alias cũ
  OCR_LANG, TESSERACT_CMD cho OCR_ENGINE=tesseract (mặc định vie, `tesseract` trên PATH)
  AI_PROVIDER, GEMINI_API_KEY hoặc DEEPSEEK_API_KEY, model và CONTRACTS_DIR như runner
"""
from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path

from runner.errors import PROVIDER_UNAVAILABLE, ServiceError

__version__ = "1.0.0"
IMPLEMENTED = True

DEFAULT_MAX_BYTES = 25_000_000


@dataclass(frozen=True)
class Config:
    storage_dir: Path | None
    max_bytes: int = DEFAULT_MAX_BYTES
    max_pages: int = 10
    deadline_s: float = 240.0
    ocr_engine: str = "provider"
    ocr_lang: str = "vie"
    tesseract_cmd: str | None = None
    docling_python: str | None = None
    docling_engine: str = 'easyocr'
    docling_lang: str = 'vi,en'
    docling_artifacts: str | None = None
    docling_hf_home: str | None = None

    @classmethod
    def from_env(cls) -> "Config":
        from runner.config import load_dotenv
        if os.environ.get('AI_LOAD_DOTENV', '1') != '0':
            load_dotenv()
        env = os.environ
        storage = env.get("AI_STORAGE_DIR", "").strip()
        return cls(storage_dir=Path(storage) if storage else None,
                   max_bytes=int(env.get("AI_MAX_PDF_BYTES", DEFAULT_MAX_BYTES)),
                   max_pages=int(env.get("AI_MAX_PAGES", 10)),
                   deadline_s=float(env.get("AI_EXTRACT_DEADLINE_S", 240)),
                   ocr_engine=env.get("OCR_ENGINE", "provider" if env.get('AI_PROVIDER') else
                                      "docling" if env.get('DOCLING_PYTHON') else "none").strip().lower(),
                   ocr_lang=env.get("OCR_LANG", "vie"),
                   tesseract_cmd=env.get("TESSERACT_CMD") or None,
                   docling_python=env.get('DOCLING_PYTHON') or str(Path(__file__).resolve().parents[3] / '.venv-docling' /
                       ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')),
                   docling_engine=env.get('DOCLING_ENGINE','easyocr' if env.get('AI_PROVIDER') else 'auto'),
                   docling_lang=env.get('DOCLING_LANG','vi,en' if env.get('AI_PROVIDER') else ''),
                   docling_artifacts=env.get('DOCLING_ARTIFACTS_PATH') or (str(Path(__file__).resolve().parents[3] / 'data/local/docling/models') if env.get('AI_PROVIDER') else None),
                   docling_hf_home=env.get('DOCLING_HF_HOME') or None)


class Service:
    """Ghép storage + PDF + extractor. Không giữ trạng thái giữa các request ngoài cấu hình."""

    def __init__(self, config: Config, extractor_factory=None):
        self.config = config
        self._extractor_factory = extractor_factory or self._default_extractor
        self._extractor = None
        self._lock = threading.Lock()

    def inspect(self, payload: dict) -> dict:
        from . import pdf, storage
        stored = storage.read_verified(self.config.storage_dir, payload["storage_key"], payload["sha256"],
                                       self.config.max_bytes)
        info = pdf.inspect(stored.data)
        return {
            "schema_version": payload["schema_version"],
            "sha256": stored.sha256,
            "page_count": info.page_count,
            "byte_size": stored.byte_size,
            "encrypted": info.encrypted,
            "has_embedded_files": info.has_embedded_files,
        }

    def extract(self, payload: dict) -> dict:
        from . import storage
        stored = storage.read_verified(self.config.storage_dir, payload["storage_key"], payload["sha256"],
                                       self.config.max_bytes)
        return self.extractor().extract(payload, stored)

    def extractor(self):
        with self._lock:
            if self._extractor is None:
                self._extractor = self._extractor_factory()
            return self._extractor

    def _default_extractor(self):
        from providers.base import ProviderUnavailable
        from providers import build_provider, cloud_allowed
        from providers.factory import create_provider
        from runner.config import Settings
        from runner.contracts import Contracts

        from .extractor import Extractor, Settings as ExtractorSettings
        from .ocr import DoclingOcr, ProviderOcr, TesseractOcr

        try:
            provider = create_provider() if self.config.ocr_engine == 'provider' else build_provider()
        except ProviderUnavailable as exc:
            raise ServiceError(503, PROVIDER_UNAVAILABLE, "Live extract needs the selected provider key and model.") from exc
        if self.config.ocr_engine in ("provider", "gemini"):
            if self.config.ocr_engine == 'gemini' and not os.environ.get('AI_PROVIDER') and not cloud_allowed():
                raise ServiceError(503, PROVIDER_UNAVAILABLE, 'Cloud OCR needs ALLOW_CLOUD_LLM=true or an explicit AI_PROVIDER configuration.')
            ocr = ProviderOcr(provider)
        elif self.config.ocr_engine == 'docling':
            ocr = DoclingOcr(self.config.docling_python or '', self.config.docling_engine,
                             self.config.docling_lang, self.config.docling_artifacts, hf_home=self.config.docling_hf_home)
        elif self.config.ocr_engine == "tesseract":
            ocr = TesseractOcr(self.config.tesseract_cmd, self.config.ocr_lang)
        elif self.config.ocr_engine == "none":
            ocr = None
        else:
            raise ServiceError(503, PROVIDER_UNAVAILABLE, "OCR_ENGINE must be docling, provider, tesseract or none (gemini remains a legacy alias).")
        contracts = Contracts(Settings.from_env().contracts_dir)
        return Extractor(contracts, provider, ocr,
                         ExtractorSettings(max_pages=self.config.max_pages, deadline_s=self.config.deadline_s))


_service: Service | None = None
_service_lock = threading.Lock()


def service() -> Service:
    global _service
    with _service_lock:
        if _service is None:
            _service = Service(Config.from_env())
        return _service


def configure(new_service: Service | None) -> None:
    """Cho test/script: thay Service mặc định (None = đọc lại env ở lần gọi sau)."""
    global _service
    with _service_lock:
        _service = new_service


def inspect(payload: dict) -> dict:
    return service().inspect(payload)


def extract(payload: dict) -> dict:
    return service().extract(payload)
