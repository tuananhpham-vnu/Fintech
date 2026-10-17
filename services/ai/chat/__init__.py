"""Trợ lý hỏi đáp/phân tích hồ sơ trong phạm vi MỘT case: POST /internal/v1/chat (contract aic-chat-0.1).

Backend (Đức) gửi kèm toàn bộ dữ liệu đã kiểm quyền của case (text trang, field, kết quả rule); service không có DB,
không lưu hội thoại. Pipeline: chỉ số tính bằng code -> prompt có che dòng nghi chỉ dẫn -> Gemini -> kiểm trích dẫn
nguyên văn và số liệu -> output. Mock (AI_MODE=mock) trả câu trả lời mẫu có nhãn, không gọi model.
"""
from __future__ import annotations

import json
import logging
from functools import cached_property
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator, FormatChecker

from runner.contracts import Violation
from runner.errors import INVALID_MODEL_OUTPUT, PROVIDER_UNAVAILABLE, ServiceError

from . import analysis, context as ctx, verify

logger = logging.getLogger("chat")

SCHEMA_VERSION = "aic-chat-0.1"
PROMPT_VERSION = "case-chat-v1"
DEADLINE_S = 75.0                 # backend chờ 80s, proxy web 85s
MAX_OUTPUT_TOKENS = 4096


class ChatContracts:
    """packages/contracts/aic-chat/schemas.json — bundle riêng, không thuộc bộ 1.0.2 khóa SHA256SUMS."""

    def __init__(self, contracts_dir: Path):
        self.path = Path(contracts_dir) / "aic-chat" / "schemas.json"
        self.bundle = json.loads(self.path.read_text("utf-8"))
        if self.bundle.get("version") != SCHEMA_VERSION:
            raise RuntimeError(f"{self.path} is not {SCHEMA_VERSION}")
        Draft7Validator.check_schema(self.bundle)
        self._validators: dict[str, Draft7Validator] = {}

    def violations(self, name: str, payload: Any, limit: int = 20) -> list[Violation]:
        if name not in self._validators:
            self._validators[name] = Draft7Validator({"$ref": f"#/definitions/{name}",
                                                      "definitions": self.bundle["definitions"]},
                                                     format_checker=FormatChecker())
        errors = sorted(self._validators[name].iter_errors(payload), key=lambda e: list(e.absolute_path))
        return [Violation("/" + "/".join(map(str, e.absolute_path)), e.message[:300]) for e in errors[:limit]]


class ChatService:
    def __init__(self, mode: str, provider: Any | None = None, deadline_s: float = DEADLINE_S):
        self.mode = mode
        self.provider = provider
        self.deadline_s = deadline_s

    @cached_property
    def model_id(self) -> str:
        if self.mode == "mock":
            return "MOCK-CHAT-NOT-MODEL-OUTPUT"
        return getattr(self.provider, "model_id", "") or "unconfigured"

    def answer(self, payload: dict) -> dict:
        metrics = analysis.compute(payload["documents"])
        context = ctx.build(payload, metrics)
        raw = self._mock(context) if self.mode == "mock" else self._ask_model(payload, context)
        answer, citations, diagnostics, refs = verify.check(raw, payload, context)
        if not answer:
            raise ServiceError(422, INVALID_MODEL_OUTPUT, "Assistant returned an empty answer.")
        if context.truncated:
            diagnostics.insert(0, {"code": "CONTEXT_TRUNCATED",
                                   "message": f"{context.truncated} tài liệu quá dài chỉ được gửi field đã trích, "
                                              f"không gửi nội dung trang."})
        if any(p["method"] == "ocr" for d in payload["documents"] for p in d["pages"]):
            diagnostics.append({"code": "OCR_SOURCES", "message": "Một số trang lấy từ OCR; giá trị cần đối chiếu ảnh gốc."})
        if self.mode == "mock":
            diagnostics.insert(0, {"code": "MOCK_ANSWER", "message": "Chế độ mock: câu trả lời mẫu, không phải model."})
        used = {ref for ref in refs}
        chosen = [m for ref, m in context.metrics if ref in used] or [m for _, m in context.metrics]
        if any(m.uncertain for m in chosen):
            diagnostics.append({"code": "METRIC_USES_UNVERIFIED_VALUES",
                                "message": "Có chỉ số tính từ giá trị OCR/uncertain chưa được người duyệt xác minh."})
        return {"schema_version": SCHEMA_VERSION, "case_id": payload["case_id"], "answer": answer,
                "citations": citations, "metrics": [m.as_output() for m in chosen][:50],
                "diagnostics": _dedupe(diagnostics)[:50],
                "provenance": {"mode": "mock" if self.mode == "mock" else "live", "model_id": self.model_id[:128],
                               "prompt_version": PROMPT_VERSION}}

    def _ask_model(self, payload: dict, context: ctx.Context) -> dict:
        from extraction.llm import Deadline, MalformedOutput, call_json
        if self.provider is None:
            raise ServiceError(503, PROVIDER_UNAVAILABLE, "Assistant needs GEMINI_API_KEY and MODEL_ID.")
        deadline = Deadline(self.deadline_s)
        user = ctx.user_prompt(payload, context)
        for _ in range(2):                    # JSON hỏng thì hỏi lại đúng 1 lần
            try:
                data = call_json(self.provider, ctx.SYSTEM, user, ctx.RESPONSE_SCHEMA, deadline, "case chat",
                                 max_output_tokens=MAX_OUTPUT_TOKENS)
            except MalformedOutput:
                continue
            if isinstance(data, dict) and isinstance(data.get("answer"), str):
                return data
        logger.warning("case chat output invalid after repair")
        raise ServiceError(422, INVALID_MODEL_OUTPUT, "Assistant output was not valid JSON after one repair.")

    @staticmethod
    def _mock(context: ctx.Context) -> dict:
        lines, citations = ["(Mock) Tóm tắt hồ sơ trong case:"], []
        for view in context.docs[:8]:
            found = [f for f in view.doc["fields"] if f["value"] is not None][:4]
            summary = "; ".join(f"{f['field_key']} = {f['value']}" for f in found) or "chưa có field"
            first = next(((n, line.strip()) for n, text in sorted(view.pages.items())
                          for line in text.splitlines() if len(line.strip()) >= 3), None)
            marker = ""
            if first:
                citations.append({"id": len(citations) + 1, "doc": view.alias, "page": first[0],
                                  "quote": first[1][:200]})
                marker = f" [{len(citations)}]"
            lines.append(f"- {view.doc['name']} ({view.doc['type']}): {summary}{marker}")
        if len(context.docs) == 0:
            lines.append("- Case chưa có tài liệu đã trích xuất.")
        return {"answer": "\n".join(lines), "citations": citations,
                "metric_ids": [ref for ref, _ in context.metrics], "insufficient_information": not context.docs}


def _dedupe(diagnostics: list[dict]) -> list[dict]:
    seen, out = set(), []
    for d in diagnostics:
        key = (d["code"], d["message"])
        if key not in seen:
            seen.add(key)
            out.append({"code": d["code"], "message": d["message"][:500]})
    return out
