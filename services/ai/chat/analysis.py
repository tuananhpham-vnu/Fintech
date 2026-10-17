"""Chỉ số tính bằng code (Decimal) từ field đã trích. Model chỉ được trích dẫn các chỉ số này, không tự tính.

Không chấm điểm, không xếp hạng, không PD: chỉ là tỷ số/tổng/so sánh có công thức và tài liệu nguồn kèm theo.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

USABLE_QUALITIES = ("readable", "human_reviewed", "uncertain")
TRUSTED_QUALITIES = ("readable", "human_reviewed")   # còn lại (uncertain/OCR) -> chỉ số bị gắn chưa xác minh
RATIO_PLACES = Decimal("0.0001")


@dataclass
class Metric:
    metric_id: str
    label: str
    value: Decimal | None
    unit: str
    period: str | None
    formula: str
    document_ids: list[str]
    uncertain: bool = False

    @property
    def status(self) -> str:
        return "ok" if self.value is not None else "insufficient_data"

    def as_output(self) -> dict:
        return {"metric_id": self.metric_id, "label": self.label, "value": _fmt(self.value), "unit": self.unit,
                "period": self.period, "formula": self.formula, "status": self.status,
                "document_ids": self.document_ids}


@dataclass
class _Statement:
    document_id: str
    period: str | None
    values: dict[str, Decimal] = field(default_factory=dict)
    uncertain: bool = False


def _fmt(value: Decimal | None) -> str | None:
    if value is None:
        return None
    text = format(value.normalize(), "f")
    return text if text not in ("-0",) else "0"


def _decimal(raw: str | None) -> Decimal | None:
    if raw is None:
        return None
    try:
        value = Decimal(raw.strip())
    except (InvalidOperation, AttributeError):
        return None
    return value if value.is_finite() else None


def _fields(doc: dict) -> dict[str, tuple[str, str]]:
    return {f["field_key"]: (f["value"], f["quality"]) for f in doc["fields"]
            if f["value"] is not None and f["quality"] in USABLE_QUALITIES}


def _ratio(numerator: Decimal, denominator: Decimal) -> Decimal | None:
    if denominator == 0:
        return None
    return (numerator / denominator).quantize(RATIO_PLACES)


def _statements(documents: list[dict]) -> list[_Statement]:
    found = []
    for doc in documents:
        if doc["type"] != "financial_statement":
            continue
        fields = _fields(doc)
        multiplier = _decimal(fields.get("financial.unit_multiplier", (None, ""))[0]) or Decimal(1)
        statement = _Statement(doc["document_id"], fields.get("financial.period_end", (None, ""))[0])
        for key in ("financial.total_assets", "financial.liabilities", "financial.equity"):
            value = _decimal(fields.get(key, (None, ""))[0])
            if value is not None:
                statement.values[key] = value * multiplier
                statement.uncertain |= fields[key][1] not in TRUSTED_QUALITIES
        found.append(statement)
    return found


def _statement_metrics(s: _Statement) -> list[Metric]:
    a, l, e = (s.values.get(k) for k in ("financial.total_assets", "financial.liabilities", "financial.equity"))
    docs = [s.document_id]

    def metric(metric_id, label, value, unit, formula):
        return Metric(metric_id, label, value, unit, s.period, formula, docs, s.uncertain)

    return [
        metric("liabilities_to_assets", "Nợ phải trả / Tổng tài sản",
               _ratio(l, a) if l is not None and a is not None else None, "ratio", "liabilities / total_assets"),
        metric("debt_to_equity", "Nợ phải trả / Vốn chủ sở hữu",
               _ratio(l, e) if l is not None and e is not None else None, "ratio", "liabilities / equity"),
        metric("equity_ratio", "Vốn chủ sở hữu / Tổng tài sản",
               _ratio(e, a) if e is not None and a is not None else None, "ratio", "equity / total_assets"),
        metric("balance_gap", "Chênh lệch Tổng tài sản − (Nợ + Vốn)",
               a - (l + e) if None not in (a, l, e) else None, "VND", "total_assets - (liabilities + equity)"),
    ]


def _growth_metrics(statements: list[_Statement]) -> list[Metric]:
    dated = sorted((s for s in statements if s.period), key=lambda s: s.period)
    by_period: dict[str, _Statement] = {}
    for s in dated:                        # cùng kỳ nhiều bản: giữ bản sau, tránh so một kỳ với chính nó
        by_period[s.period] = s
    periods = list(by_period.values())
    metrics = []
    for old, new in zip(periods, periods[1:]):
        for key, label in (("financial.total_assets", "Tổng tài sản"), ("financial.equity", "Vốn chủ sở hữu")):
            before, after = old.values.get(key), new.values.get(key)
            value = _ratio(after - before, before) if before is not None and after is not None else None
            metrics.append(Metric(f"growth_{key.split('.')[1]}", f"Tăng trưởng {label} {old.period} → {new.period}",
                                  value, "ratio", new.period, f"({key}[{new.period}] - {key}[{old.period}]) / "
                                  f"{key}[{old.period}]", [old.document_id, new.document_id],
                                  old.uncertain or new.uncertain))
    return metrics


def _sum_metric(documents: list[dict], doc_type: str, key: str, metric_id: str, label: str) -> list[Metric]:
    totals: dict[str, tuple[Decimal, list[str], bool]] = {}
    for doc in documents:
        if doc["type"] != doc_type:
            continue
        fields = _fields(doc)
        amount = _decimal(fields.get(key, (None, ""))[0])
        if amount is None:
            continue
        currency = fields.get("money.currency", ("UNKNOWN", ""))[0]
        total, ids, uncertain = totals.get(currency, (Decimal(0), [], False))
        totals[currency] = (total + amount, ids + [doc["document_id"]], uncertain or fields[key][1] not in TRUSTED_QUALITIES)
    return [Metric(f"{metric_id}_{currency.lower()}", f"{label} ({currency})", total, currency, None,
                   f"sum({key}) over {doc_type}", ids, uncertain)
            for currency, (total, ids, uncertain) in sorted(totals.items())]


def _tax_id_metric(documents: list[dict]) -> list[Metric]:
    seen: dict[str, list[str]] = {}
    for doc in documents:
        fields = _fields(doc)
        for key in ("borrower.tax_id", "parties.borrower.tax_id"):
            if key in fields:
                seen.setdefault(fields[key][0].strip(), []).append(doc["document_id"])
    if not seen:
        return []
    ids = sorted({d for docs in seen.values() for d in docs})
    return [Metric("distinct_borrower_tax_ids", "Số MST bên vay khác nhau giữa các hồ sơ", Decimal(len(seen)),
                   "count", None, "count(distinct borrower tax_id)", ids)]


def compute(documents: list[dict]) -> list[Metric]:
    statements = _statements(documents)
    metrics = [m for s in statements for m in _statement_metrics(s)]
    metrics += _growth_metrics(statements)
    metrics += _sum_metric(documents, "contract", "contract.amount", "contract_total", "Tổng giá trị hợp đồng")
    metrics += _sum_metric(documents, "loan_request", "loan.amount", "loan_requested_total", "Tổng số tiền đề nghị vay")
    metrics += _tax_id_metric(documents)
    return metrics[:50]
