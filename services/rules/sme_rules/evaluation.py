"""Phép đo benchmark (phần 29, 35): precision/recall theo issue_key và giảm thời gian.

Mẫu số 0 -> None (báo N/A), không bao giờ báo 100%. Không trộn hai baseline.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, Iterable, Optional


@dataclass(frozen=True)
class DetectionMetrics:
    true_positives: int
    predicted: int
    gold: int

    @property
    def false_alerts(self) -> int:
        return self.predicted - self.true_positives

    @property
    def missed(self) -> int:
        return self.gold - self.true_positives

    @property
    def precision(self) -> Optional[Decimal]:
        return _ratio(self.true_positives, self.predicted)

    @property
    def recall(self) -> Optional[Decimal]:
        return _ratio(self.true_positives, self.gold)

    def as_record(self) -> Dict[str, object]:
        return {
            "true_findings": self.true_positives,
            "false_alerts": self.false_alerts,
            "gold_findings": self.gold,
            "missed": self.missed,
            "precision": _fmt(self.precision),
            "recall": _fmt(self.recall),
        }


def detection_metrics(predicted_keys: Iterable[str], gold_keys: Iterable[str]) -> DetectionMetrics:
    predicted, gold = set(predicted_keys), set(gold_keys)
    return DetectionMetrics(true_positives=len(predicted & gold), predicted=len(predicted), gold=len(gold))


def time_reduction(baseline_total_sec: Decimal, mvp_total_sec: Decimal) -> Optional[Decimal]:
    """(baseline - MVP) / baseline x 100%, tính riêng cho từng baseline."""
    if baseline_total_sec <= 0:
        return None
    return (Decimal(baseline_total_sec) - Decimal(mvp_total_sec)) / Decimal(baseline_total_sec) * 100


def _ratio(numerator: int, denominator: int) -> Optional[Decimal]:
    return None if denominator == 0 else Decimal(numerator) / Decimal(denominator)


def _fmt(value: Optional[Decimal]) -> str:
    return "N/A" if value is None else f"{value:.4f}"
