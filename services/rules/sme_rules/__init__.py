"""P3 - đối chiếu và kiểm chứng: Facts + Evidence -> RuleResult, Findings + SuggestedRequests."""
from .config import RuleConfig
from .engine import evaluate, run_analysis

__all__ = ["RuleConfig", "evaluate", "run_analysis"]
