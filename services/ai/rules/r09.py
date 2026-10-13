"""R09 — phát biểu "đã thu" phải có đúng một chứng từ thanh toán completed khớp ref + bên + VND + số tiền.

Không xác thực giao dịch ngân hàng; thiếu chứng từ chỉ là "chưa đủ tài liệu chứng minh", không phải "chưa trả tiền".
Không so payment.date với expected_date để tạo lỗi giả.
"""
from __future__ import annotations

import normalize
from linking import SnapshotView, unique

from .common import Assessment, RuleOutcome, absence_basis
from .receipt import read_receipt


def _classify(doc, receipt, view, mismatched_identity) -> tuple[str, list[str]]:
    if not doc.usable:
        return "ambiguous", ["UNREADABLE_SOURCE"]
    checks = (("payment.contract_ref", receipt.ref, normalize.ref, "CONTRACT"),
              ("parties.payee.tax_id", view.borrower_tax_id, normalize.tax_id, "PAYEE"),
              ("parties.payer.tax_id", receipt.counterparty_tax_id, normalize.tax_id, "PAYER"))
    mismatches, unclear = [], []
    for key, expected, normalizer, code in checks:
        value = normalizer(doc.value(key))
        if value is None:
            unclear.append(f"{code}_UNCLEAR")
        elif expected is not None and value != expected:
            mismatches.append(f"{code}_MISMATCH")
    if doc.id in mismatched_identity:
        mismatches.append("PAYEE_MISMATCH")
    if mismatches:
        return "mismatch", sorted(set(mismatches))
    if doc.value("money.currency") != "VND":
        unclear.append("UNSUPPORTED_CURRENCY")
    if doc.value("payment.status") != "completed":
        unclear.append("PAYMENT_STATUS_NOT_COMPLETED")
    if normalize.amount(doc.value("payment.amount")) is None:
        unclear.append("AMOUNT_UNCLEAR")
    return ("ambiguous", sorted(set(unclear))) if unclear else ("match", [])


def evaluate(view: SnapshotView, mismatched_identity: set[str]) -> RuleOutcome:
    receipt = read_receipt(view)
    if receipt is None or receipt.claim_type != "received":
        return RuleOutcome("R09", "not_applicable", [])
    key = receipt.issue_key("R09", "received", view.borrower_tax_id or "UNKNOWN")
    blocking = [p for p in receipt.problems if p != "CLAIM_TYPE_UNCLEAR"]
    if blocking or receipt.amount is None:
        reasons = sorted(set(blocking or ["CLAIM_AMOUNT_UNCLEAR"]))
        a = Assessment(key, ["R09"], "insufficient_evidence", "high", "unknown",
                       f"Chưa đủ căn cứ để đối chiếu khoản khai đã thu {receipt.label}.", reasons, receipt.evidence_ids,
                       None if receipt.evidence_ids else absence_basis(view, "payment_record", "Thiếu khoản thu đọc được"))
        return RuleOutcome("R09", "unknown", reasons, receipt.evidence_ids, [key], [a])

    payments = view.of_type("payment_record", usable_only=False)
    classified = [(doc, *_classify(doc, receipt, view, mismatched_identity)) for doc in payments]
    matches = [doc for doc, verdict, _ in classified if verdict == "match"]
    evidence = unique(receipt.evidence_ids + [e for doc, _, _ in classified for e in doc.evidence()])
    claimed = receipt.amount
    label = receipt.label

    def make(category, proposal, summary, reasons, supported=None, unsupported=None, basis=None, suggest=True):
        a = Assessment(key, ["R09"], category, "high", proposal, summary, reasons, evidence, basis,
                       supported, unsupported, suggestion=_suggestion(receipt) if suggest else None)
        status = {"candidate_resolved": "pass", "unknown": "unknown"}.get(proposal, "issue")
        return RuleOutcome("R09", status, reasons if status == "unknown" else [], evidence, [key], [a])

    if len(matches) > 1:
        return make("insufficient_evidence", "unknown", f"Nhiều chứng từ cho {label}; P0 không tự cộng giao dịch.",
                    ["MULTIPLE_PAYMENTS_REQUIRE_SUM"], suggest=False)
    if matches:
        paid = normalize.amount(matches[0].value("payment.amount"))
        if paid == claimed:
            return make("supported", "candidate_resolved",
                        f"Chứng từ thanh toán hỗ trợ khoản khai đã thu {label} trong phạm vi tài liệu. Chờ reviewer xác nhận.",
                        ["PAYMENT_SUPPORTED"], normalize.format_amount(paid), "0", suggest=False)
        if paid < claimed:
            return make("insufficient_evidence", "still_open",
                        f"Chứng từ chỉ hỗ trợ {normalize.format_amount(paid)} trên {normalize.format_amount(claimed)} VND khai đã thu {label}.",
                        ["PARTIAL_PAYMENT"], normalize.format_amount(paid), normalize.format_amount(claimed - paid))
        return make("insufficient_evidence", "unknown", f"Số tiền chứng từ lớn hơn khoản khai {label}; cần reviewer xem.",
                    ["AMOUNT_EXCEEDS_CLAIM"], suggest=False)
    unclear = sorted({r for _, verdict, reasons in classified if verdict == "ambiguous" for r in reasons})
    if unclear:
        return make("insufficient_evidence", "unknown", f"Chứng từ thanh toán cho {label} chưa đủ rõ.", unclear, suggest=False)
    mismatched = [r for _, verdict, reasons in classified if verdict == "mismatch" for r in reasons]
    if mismatched:
        return make("mismatched_document", "still_open", f"Chứng từ thanh toán không khớp {label}.", sorted(set(mismatched)))
    if view.of_type("acceptance_record") or view.of_type("invoice"):
        return make("insufficient_evidence", "still_open",
                    f"Khai đã thu {label} nhưng chỉ có nghiệm thu/hóa đơn, chưa có chứng từ thanh toán phù hợp trong hồ sơ.",
                    ["RECEIVED_WITHOUT_PAYMENT_RECORD"])
    return make("missing_document", "still_open", f"Chưa có chứng từ thanh toán cho khoản khai đã thu {label}.",
                ["MISSING_PAYMENT_RECORD"],
                basis=absence_basis(view, "payment_record", "Không có chứng từ thanh toán trong snapshot"))


def _suggestion(receipt) -> dict:
    amount = normalize.format_amount(receipt.amount) if receipt.amount is not None else "?"
    return {"required_type": "payment_record", "contract_ref": receipt.ref_raw, "required_scope": receipt.scope_raw,
            "purpose": "Xác minh khoản khai đã thu",
            "content": f"Vui lòng bổ sung chứng từ thanh toán đã hoàn tất cho khoản {amount} VND thuộc "
                       f"{receipt.ref_raw}/{receipt.scope_raw}."}
