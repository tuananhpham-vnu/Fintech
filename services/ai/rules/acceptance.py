"""R08 (điều kiện nghiệm thu của khoản thu) + R10 (tài liệu bổ sung cho request R08) — một issue, một assessment.

Final assessment (Specs §2 quy tắc 4, §10, §11), theo thứ tự ưu tiên:
  1. Có biên bản đủ mọi guard          -> candidate_resolved / supported      (R08 pass)
  2. Không có, có biên bản đúng nhưng thiếu tiền rõ -> still_open / insufficient_evidence + supported/unsupported
  3. Không có, có sai khác xác định (ref/bên/scope) -> still_open / mismatched_document
  4. Chỉ có tài liệu mơ hồ              -> unknown / insufficient_evidence     (R08 unknown)
  5. Không có biên bản nào               -> still_open / missing_document + absence_basis
Một tài liệu sai không phủ định tài liệu đúng; tài liệu tốt nhất quyết định, mọi ứng viên đều nằm trong evidence.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

import normalize
from linking import Doc, SnapshotView, unique

from .common import Assessment, RuleOutcome, absence_basis, issue_id_for
from .receipt import Receipt, read_receipt

# Theo Specs §2 quy tắc 4 + §11: đủ > (đủ nhưng điều kiện HĐ chưa giải quyết) > thiếu tiền rõ > sai xác định > mơ hồ
VERDICT_RANK = {"full": 0, "condition_blocked": 1, "partial": 2, "mismatch": 3, "ambiguous": 4}


@dataclass
class Candidate:
    doc: Doc
    verdict: str
    reasons: list[str] = field(default_factory=list)
    amount: Decimal | None = None
    acceptance_date: str | None = None

    @property
    def is_response(self) -> bool:
        return self.doc.response_request_id is not None

    @property
    def label(self) -> str:
        return normalize.text(self.doc.value("acceptance.ref")) or self.doc.filename


def _check(doc: Doc, receipt: Receipt, view: SnapshotView, mismatched_identity: set[str]) -> Candidate:
    if not doc.usable:
        return Candidate(doc, "ambiguous", ["UNREADABLE_SOURCE"])
    mismatches, unclear = [], []

    def compare(key: str, expected: str | None, normalizer, code: str) -> None:
        if doc.state(key) != "readable" or normalizer(doc.value(key)) is None:
            unclear.append(f"{code}_UNCLEAR")
        elif expected is not None and normalizer(doc.value(key)) != expected:
            mismatches.append(f"{code}_MISMATCH")

    compare("acceptance.contract_ref", receipt.ref, normalize.ref, "CONTRACT")
    compare("parties.borrower.tax_id", view.borrower_tax_id, normalize.tax_id, "PARTY")
    compare("parties.counterparty.tax_id", receipt.counterparty_tax_id, normalize.tax_id, "PARTY")
    compare("acceptance.scope_ref", receipt.scope, normalize.ref, "SCOPE")
    if doc.id in mismatched_identity and "PARTY_MISMATCH" not in mismatches:
        mismatches.append("PARTY_MISMATCH")
    if mismatches:
        return Candidate(doc, "mismatch", sorted(set(mismatches)))

    currency = doc.value("money.currency")
    amount = normalize.amount(doc.value("acceptance.amount"))
    event = normalize.iso_date(doc.value("acceptance.date"))
    if currency != "VND":
        unclear.append("UNSUPPORTED_CURRENCY" if currency else "CURRENCY_UNCLEAR")
    if amount is None or receipt.contract_amount is None:
        unclear.append("AMOUNT_UNCLEAR")
    if event is None:
        unclear.append("ACCEPTANCE_DATE_UNCLEAR")
    if unclear:
        return Candidate(doc, "ambiguous", sorted(set(unclear)))
    if amount > receipt.contract_amount:
        return Candidate(doc, "ambiguous", ["AMOUNT_EXCEEDS_CONTRACT"], amount, event.isoformat())
    if amount < receipt.contract_amount:
        return Candidate(doc, "partial", ["PARTIAL_ACCEPTANCE"], amount, event.isoformat())
    # Đủ tiền: còn phải qua guard điều kiện (A01: điều kiện khác/phụ lục chưa giải quyết thì không candidate)
    condition = receipt.condition or {}
    if condition.get("other_conditions_state") != "none":
        return Candidate(doc, "condition_blocked", ["OTHER_CONDITIONS_UNRESOLVED"], amount, event.isoformat())
    return Candidate(doc, "full", [], amount, event.isoformat())


def _mismatch_codes(candidates: list[Candidate]) -> list[str]:
    codes = []
    for c in candidates:
        prefix = "SUPPLEMENT_" if c.is_response else "ACCEPTANCE_"
        codes += [prefix + r for r in c.reasons]
    return sorted(set(codes))


def _mismatch_summary(c: Candidate, receipt: Receipt) -> str:
    if "CONTRACT_MISMATCH" in c.reasons:
        other = normalize.text(c.doc.value("acceptance.contract_ref"))
        return f"{c.label} tham chiếu {other}, chưa giải quyết yêu cầu {receipt.label}."
    what = {"PARTY_MISMATCH": "bên ký", "SCOPE_MISMATCH": "phạm vi"}
    parts = ", ".join(what[r] for r in c.reasons if r in what)
    return f"{c.label} không khớp {parts} của {receipt.label}; chưa giải quyết yêu cầu."


def evaluate(view: SnapshotView, mismatched_identity: set[str]) -> tuple[RuleOutcome, RuleOutcome]:
    receipt = read_receipt(view)
    r10_requests = [r for r in view.approved_requests if r["required_type"] == "acceptance_record"]
    other_requests = [r for r in view.approved_requests if r["required_type"] != "acceptance_record"]

    if receipt is None or receipt.claim_type not in ("expected", "due", "received") and "CLAIM_TYPE_UNCLEAR" not in receipt.problems:
        r08 = RuleOutcome("R08", "not_applicable", ["NO_RECEIPT_CLAIM"])
        return r08, _r10(view, r08, None, None, r10_requests, other_requests, [])

    key = receipt.issue_key("R08", "acceptance", view.borrower_tax_id or "UNKNOWN")
    condition = receipt.condition or {}
    blocking = list(receipt.problems)
    if receipt.contract is not None and not blocking:
        event_type = condition.get("event_type")
        if receipt.condition is None or event_type == "unknown":
            blocking.append("PAYMENT_CONDITION_UNCLEAR")
        elif event_type != "acceptance":
            r08 = RuleOutcome("R08", "not_applicable", ["NOT_ACCEPTANCE_CONDITION"])
            return r08, _r10(view, r08, None, None, r10_requests, other_requests, [])

    severity = "high" if receipt.claim_type in ("due", "received") else "medium"
    if blocking:
        blocking += receipt.hitl_reasons
        assessment = Assessment(
            key, ["R08"], "insufficient_evidence", severity, "unknown",
            f"Chưa đủ căn cứ để kiểm điều kiện nghiệm thu {receipt.label}.", sorted(set(blocking)),
            receipt.evidence_ids, None if receipt.evidence_ids else absence_basis(view, "contract", "Không xác định được hợp đồng chính"))
        r08 = RuleOutcome("R08", "unknown", sorted(set(blocking)), receipt.evidence_ids, [key], [assessment])
        return r08, _r10(view, r08, assessment, key, r10_requests, other_requests, [])

    records = view.of_type("acceptance_record", usable_only=False)
    candidates = [_check(d, receipt, view, mismatched_identity) for d in records]
    evidence = unique(receipt.evidence_ids + [e for c in candidates for e in c.doc.evidence()])
    best = min(candidates, key=lambda c: VERDICT_RANK[c.verdict]) if candidates else None
    assessment = _assess(view, receipt, key, severity, best, candidates, evidence, condition)
    if receipt.hitl_reasons:
        assessment.reason_codes = sorted(set(assessment.reason_codes + receipt.hitl_reasons))
    status = {"candidate_resolved": "pass", "unknown": "unknown"}.get(assessment.proposal, "issue")
    rule_reasons = assessment.reason_codes if status == "unknown" else []
    r08 = RuleOutcome("R08", status, rule_reasons, evidence, [key], [assessment])
    return r08, _r10(view, r08, assessment, key, r10_requests, other_requests, candidates)


def _assess(view, receipt: Receipt, key, severity, best, candidates, evidence, condition) -> Assessment:
    if best is None:
        return Assessment(
            key, ["R08"], "missing_document", severity, "still_open",
            f"Thiếu biên bản nghiệm thu {receipt.label}.", ["MISSING_ACCEPTANCE"], evidence,
            absence_basis(view, "acceptance_record", "Không có biên bản nghiệm thu trong snapshot"),
            suggestion=_suggestion(receipt))
    if best.verdict == "full":
        due = normalize.due_date(normalize.iso_date(best.acceptance_date), condition.get("offset_days"),
                                 condition.get("calendar_basis"), condition.get("counting_convention"))
        return Assessment(
            key, ["R08"], "supported", severity, "candidate_resolved",
            f"{best.label} hỗ trợ nghiệm thu {receipt.label}. Chờ reviewer xác nhận.", ["ACCEPTANCE_SUPPORTED"],
            evidence, supported_amount=normalize.format_amount(best.amount), unsupported_amount="0",
            computed_date=due.isoformat() if due else None)
    if best.verdict == "condition_blocked":
        return Assessment(
            key, ["R08"], "insufficient_evidence", severity, "unknown",
            f"{best.label} khớp {receipt.label} nhưng hợp đồng còn điều kiện/phụ lục chưa giải quyết; chưa đề xuất đóng.",
            ["OTHER_CONDITIONS_UNRESOLVED"], evidence)
    if best.verdict == "partial":
        missing = receipt.contract_amount - best.amount
        return Assessment(
            key, ["R08"], "insufficient_evidence", severity, "still_open",
            f"{best.label} chỉ nghiệm thu {normalize.format_amount(best.amount)} trên "
            f"{normalize.format_amount(receipt.contract_amount)} VND của {receipt.label}; phần còn lại chưa có căn cứ.",
            ["PARTIAL_ACCEPTANCE"], evidence, supported_amount=normalize.format_amount(best.amount),
            unsupported_amount=normalize.format_amount(missing), suggestion=_suggestion(receipt))
    if best.verdict == "mismatch":
        wrong = [c for c in candidates if c.verdict == "mismatch"]
        return Assessment(
            key, ["R08"], "mismatched_document", severity, "still_open", _mismatch_summary(best, receipt),
            _mismatch_codes(wrong), evidence, suggestion=_suggestion(receipt))
    return Assessment(
        key, ["R08"], "insufficient_evidence", severity, "unknown",
        f"Biên bản nghiệm thu cho {receipt.label} chưa đủ rõ để kết luận; cần reviewer xem nguồn.",
        sorted({r for c in candidates for r in c.reasons}), evidence)


def _suggestion(receipt: Receipt) -> dict:
    claim = {"expected": "khoản dự kiến thu", "due": "khoản đến hạn thu", "received": "khoản khai đã thu"}
    amount = normalize.format_amount(receipt.contract_amount) if receipt.contract_amount is not None else "?"
    return {"required_type": "acceptance_record", "contract_ref": receipt.ref_raw, "required_scope": receipt.scope_raw,
            "purpose": f"Xác minh điều kiện nghiệm thu của {claim.get(receipt.claim_type, 'khoản thu')}",
            "content": f"Vui lòng bổ sung biên bản nghiệm thu toàn bộ {receipt.scope_raw} thuộc {receipt.ref_raw}, "
                       f"trị giá {amount} VND."}


def _r10(view: SnapshotView, r08: RuleOutcome, assessment: Assessment | None, key: str | None,
         requests: list[dict], other_requests: list[dict], candidates: list[Candidate]) -> RuleOutcome:
    """R10 chỉ cho request acceptance_record gắn issue R08; dùng chung issue_id, không tạo issue riêng."""
    if not requests:
        reasons = ["UNSUPPORTED_REQUEST_TYPE"] if other_requests else []
        return RuleOutcome("R10", "not_applicable", reasons)
    linked_issue = issue_id_for(view.case["id"], key) if key else None
    if assessment is None or any(r["issue_id"] != linked_issue for r in requests):
        return RuleOutcome("R10", "unknown", ["REVIEW_REQUIRED", "SUBJECT_CHANGED"])
    if "R10" not in assessment.rule_ids:
        assessment.rule_ids.append("R10")   # một assessment cho issue R08, ghi nhận cả R10 đã xét
    request_ids = {r["id"] for r in requests}
    responses = [c for c in candidates if c.doc.response_request_id in request_ids]
    verdicts = {c.verdict for c in responses}
    if "full" in verdicts and assessment.is_candidate:
        status = "pass"
    elif verdicts & {"partial", "mismatch"} or not responses:
        status = "issue"   # chưa có response, hoặc response sai/thiếu: request vẫn mở
    else:
        status = "unknown"
    reasons = ["AWAITING_RESPONSE"] if not responses else (assessment.reason_codes if status == "unknown" else [])
    return RuleOutcome("R10", status, reasons, assessment.evidence_ids, [key])
