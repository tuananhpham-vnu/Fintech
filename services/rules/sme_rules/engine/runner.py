"""Chạy toàn bộ rule trên một snapshot và gom Findings + SuggestedRequests.

Bảo đảm của runner (không phụ thuộc rule cụ thể):
- Mỗi rule được bật luôn có ít nhất một RuleResult; không ẩn rule.
- Một rule lỗi -> unknown INTERNAL_RULE_ERROR và run partial; không đổi lỗi thành pass.
- issue_key không trùng trong một run; câu chữ cấm không lọt ra kết quả.
- Log chỉ chứa ID và loại lỗi, không chứa nội dung hồ sơ.
"""
from __future__ import annotations

import logging
from collections import Counter, OrderedDict
from typing import Dict, Iterable, List, Optional

from ..config import RuleConfig
from ..contracts.inputs import CaseSnapshot, Fact
from ..contracts.outputs import (
    Finding,
    RuleResult,
    RuleStatus,
    RunOutput,
    RunStatus,
    SuggestedRequestItem,
)
from ..domain.integrity import sanitize_facts
from ..domain.views import CaseView
from .base import Rule, RuleContext
from .registry import RuleRegistry, default_registry

logger = logging.getLogger(__name__)

INTERNAL_RULE_ERROR = "INTERNAL_RULE_ERROR"


class RuleContractViolation(Exception):
    """Rule trả kết quả vi phạm bất biến của engine."""


def evaluate(snapshot: CaseSnapshot, facts: Iterable[Fact],
             config: Optional[RuleConfig] = None,
             registry: Optional[RuleRegistry] = None) -> List[RuleResult]:
    """Interface theo tài liệu: evaluate(snapshot, facts, config) -> RuleResult[]."""
    return run_analysis(snapshot, facts, config, registry).rule_results


def run_analysis(snapshot: CaseSnapshot, facts: Iterable[Fact],
                 config: Optional[RuleConfig] = None,
                 registry: Optional[RuleRegistry] = None) -> RunOutput:
    config = config or RuleConfig()
    registry = registry or load_default_registry()
    valid_facts, input_issues = sanitize_facts(snapshot, facts)
    ctx = RuleContext(snapshot=snapshot, case=CaseView(snapshot, valid_facts), config=config)

    results: List[RuleResult] = []
    for rule in registry.create(config.enabled_rules):
        results.extend(_run_rule(rule, ctx))

    findings = [r.finding for r in results if r.finding is not None]
    partial = any(r.reason_code == INTERNAL_RULE_ERROR for r in results)
    return RunOutput(
        run_id=snapshot.run_id,
        snapshot_hash=snapshot.snapshot_hash,
        rule_set_version=config.rule_set_version,
        status=RunStatus.PARTIAL if partial else RunStatus.COMPLETED,
        rule_results=results,
        findings=findings,
        suggested_requests=_group_requests(findings),
        resolutions=[r.resolution for r in results if r.resolution is not None],
        input_issues=input_issues,
        coverage=_coverage(results),
    )


def load_default_registry() -> RuleRegistry:
    """Registry có đủ R01-R10 (import package rules để các rule tự đăng ký)."""
    from .. import rules  # noqa: F401
    return default_registry


def _run_rule(rule: Rule, ctx: RuleContext) -> List[RuleResult]:
    try:
        results = list(rule.evaluate(ctx))
        _check_contract(rule, results, ctx.config)
        return results
    except Exception as exc:  # cô lập lỗi từng rule
        logger.error("rule %s failed on run %s: %s", rule.rule_id, ctx.run_id, type(exc).__name__)
        return [rule.unknown(
            ctx, INTERNAL_RULE_ERROR,
            "Quy tắc gặp lỗi nội bộ nên chưa đánh giá được; cần chạy lại sau khi sửa lỗi.",
            operands={"error_type": type(exc).__name__},
        )]


def _check_contract(rule: Rule, results: List[RuleResult], config: RuleConfig) -> None:
    if not results:
        raise RuleContractViolation("EMPTY_RULE_OUTPUT")
    if any(r.rule_id != rule.rule_id for r in results):
        raise RuleContractViolation("FOREIGN_RULE_ID")
    keys = [r.finding.issue_key for r in results if r.finding is not None]
    if len(keys) != len(set(keys)):
        raise RuleContractViolation("DUPLICATE_ISSUE_KEY")
    for result in results:
        if _violates_wording(result, config.forbidden_phrases):
            raise RuleContractViolation("WORDING_POLICY_VIOLATION")


def _texts(result: RuleResult) -> List[str]:
    texts = [result.message]
    if result.finding is not None:
        texts += [result.finding.title, result.finding.description]
        if result.finding.suggested_request is not None:
            texts.append(result.finding.suggested_request.purpose)
    return texts


def _violates_wording(result: RuleResult, phrases: List[str]) -> bool:
    lowered = [t.lower() for t in _texts(result)]
    return any(p.lower() in text for p in phrases for text in lowered)


def _group_requests(findings: List[Finding]) -> List[SuggestedRequestItem]:
    """Một giấy tờ có thể giải quyết nhiều finding (RequestItem N:M Finding)."""
    groups: "OrderedDict[str, Dict]" = OrderedDict()
    for finding in findings:
        request = finding.suggested_request
        if request is None:
            continue
        key = f"{request.type.value}:{request.contract_ref or 'case'}"
        group = groups.setdefault(key, {"type": request.type, "contract_ref": request.contract_ref,
                                        "purposes": [], "keys": []})
        if request.purpose not in group["purposes"]:
            group["purposes"].append(request.purpose)
        group["keys"].append(finding.issue_key)
    return [
        SuggestedRequestItem(request_key=key, document_type=g["type"], contract_ref=g["contract_ref"],
                             purposes=g["purposes"], finding_issue_keys=g["keys"])
        for key, g in groups.items()
    ]


def _coverage(results: List[RuleResult]) -> Dict[str, Dict[str, int]]:
    coverage: Dict[str, Dict[str, int]] = {}
    for rule_id in sorted({r.rule_id for r in results}):
        counts = Counter(r.status.value for r in results if r.rule_id == rule_id)
        coverage[rule_id] = {status.value: counts.get(status.value, 0) for status in RuleStatus}
    return coverage
