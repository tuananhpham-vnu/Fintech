"""Extraction package (M2) — OWNER: Nguyên. File này chỉ là interface stub do T13a đặt để thống nhất import.

Quy ước (runner gọi, không copy code):
    import extraction
    extraction.inspect(payload: dict) -> dict   # InspectionInput  -> InspectionOutput (1.0.2)
    extraction.extract(payload: dict) -> dict   # ExtractionInput  -> ExtractionOutput (1.0.2)

- Input đã được runner validate theo schema; output sẽ được runner validate + guard trước khi trả.
- Lỗi nghiệp vụ: raise runner.errors.ServiceError(status, code, message) với code trong catalogue
  (PDF_ENCRYPTED, PDF_INVALID, INVALID_EVIDENCE, PROVIDER_UNAVAILABLE...). Không trả chuỗi lỗi giả dạng field.
- Đặt IMPLEMENTED = True khi xong để `python -m runner health` ở AI_MODE=live báo ok.
Nguyên thay toàn bộ nội dung file này bằng package thật; runner không cần sửa.
"""
__version__ = "0.0.0-stub"
IMPLEMENTED = False


def inspect(payload: dict) -> dict:
    raise NotImplementedError("extraction.inspect — N13b (Nguyên)")


def extract(payload: dict) -> dict:
    raise NotImplementedError("extraction.extract — N13b (Nguyên)")
