from typing import List

import pytest

from sme_rules import run_analysis
from sme_rules.contracts import RuleResult, RunOutput, RuleStatus


def results(output: RunOutput, rule_id: str) -> List[RuleResult]:
    return [r for r in output.rule_results if r.rule_id == rule_id]


def statuses(output: RunOutput, rule_id: str) -> List[RuleStatus]:
    return [r.status for r in results(output, rule_id)]


def issues(output: RunOutput, rule_id: str) -> List[RuleResult]:
    return [r for r in results(output, rule_id) if r.status == RuleStatus.ISSUE]


@pytest.fixture
def run():
    def _run(builder, **kwargs) -> RunOutput:
        snapshot, facts = builder.build()
        return run_analysis(snapshot, facts, **kwargs)
    return _run
