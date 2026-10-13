"""Registry: thêm rule mới bằng `@register` mà không sửa engine (open/closed)."""
from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Type

from .base import Rule


class RuleRegistry:
    def __init__(self) -> None:
        self._rules: Dict[str, Type[Rule]] = {}

    def register(self, rule_cls: Type[Rule]) -> Type[Rule]:
        rule_id = getattr(rule_cls, "rule_id", None)
        if not rule_id:
            raise ValueError(f"{rule_cls.__name__} must declare rule_id")
        if rule_id in self._rules and self._rules[rule_id] is not rule_cls:
            raise ValueError(f"rule_id {rule_id} already registered")
        self._rules[rule_id] = rule_cls
        return rule_cls

    @property
    def rule_ids(self) -> List[str]:
        return sorted(self._rules)

    def create(self, enabled: Optional[Iterable[str]] = None) -> List[Rule]:
        selected = self.rule_ids if enabled is None else list(enabled)
        unknown = [rule_id for rule_id in selected if rule_id not in self._rules]
        if unknown:
            raise ValueError(f"unknown rules: {unknown}")
        return [self._rules[rule_id]() for rule_id in sorted(selected)]


default_registry = RuleRegistry()
register = default_registry.register
