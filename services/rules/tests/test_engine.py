"""Bất biến của engine: đủ rule, cô lập lỗi, mở rộng qua registry, kiểm tra nguồn, câu chữ."""
import json

import pytest

from sme_rules import RuleConfig, evaluate, run_analysis
from sme_rules.contracts import DocType, Fact, RunStatus
from sme_rules.engine import INTERNAL_RULE_ERROR, Rule, RuleRegistry, load_default_registry
from sme_rules.evaluation import detection_metrics, time_reduction
from sme_rules.fixtures import sao_mai_base, sao_mai_golden

ALL_RULES = [f"R{i:02d}" for i in range(1, 11)]


def test_every_rule_reports_on_golden_case():
    for stage in (1, 2, 3):
        out = run_analysis(*sao_mai_golden(stage))
        assert sorted(out.coverage) == ALL_RULES
        assert out.status == RunStatus.COMPLETED
        assert all(r.run_id == f"run_0{stage}" for r in out.rule_results)


def test_evaluate_interface_returns_rule_results():
    snapshot, facts = sao_mai_golden(1)
    assert {r.rule_id for r in evaluate(snapshot, facts, RuleConfig())} == set(ALL_RULES)


def test_output_is_json_serializable_with_decimal_strings():
    payload = json.loads(run_analysis(*sao_mai_golden(1)).model_dump_json())
    r05 = next(r for r in payload["rule_results"] if r["rule_id"] == "R05")
    assert r05["operands"]["normalized_vnd"]["total_assets"] == "1000000000"


def test_deterministic_output():
    snapshot, facts = sao_mai_golden(2)
    assert run_analysis(snapshot, facts).model_dump() == run_analysis(snapshot, facts).model_dump()


class _Boom(Rule):
    rule_id = "R99"
    title = "Rule lỗi"

    def evaluate(self, ctx):
        raise RuntimeError("số tài khoản 123 không được lộ ra log")


class _Silent(Rule):
    rule_id = "R98"
    title = "Rule không trả kết quả"

    def evaluate(self, ctx):
        return []


class _BadWording(Rule):
    rule_id = "R97"
    title = "Rule sai câu chữ"

    def evaluate(self, ctx):
        yield self.passed(ctx, "X", "Doanh nghiệp không có khả năng trả nợ")


def _registry(*extra):
    base = load_default_registry()
    registry = RuleRegistry()
    for rule_id in base.rule_ids:
        registry.register(type(base.create([rule_id])[0]))
    for rule_cls in extra:
        registry.register(rule_cls)
    return registry


@pytest.mark.parametrize("rule_cls", [_Boom, _Silent, _BadWording])
def test_broken_rule_becomes_unknown_and_run_partial(rule_cls, caplog):
    out = run_analysis(*sao_mai_golden(1), registry=_registry(rule_cls))
    broken = [r for r in out.rule_results if r.rule_id == rule_cls.rule_id]
    assert [r.reason_code for r in broken] == [INTERNAL_RULE_ERROR]
    assert broken[0].status.value == "unknown"
    assert out.status == RunStatus.PARTIAL
    assert "123" not in caplog.text
    assert len([r for r in out.rule_results if r.rule_id != rule_cls.rule_id]) > 10  # rule khác vẫn chạy


def test_new_rule_plugs_in_without_engine_change():
    class R11Example(Rule):
        rule_id = "R11"
        title = "Ví dụ rule mở rộng"

        def evaluate(self, ctx):
            yield self.not_applicable(ctx, "EXAMPLE", "Rule ví dụ.")

    out = run_analysis(*sao_mai_golden(1), registry=_registry(R11Example))
    assert "R11" in out.coverage


def test_enabled_rules_subset_for_scope_reduction():
    out = run_analysis(*sao_mai_golden(1), config=RuleConfig(enabled_rules=["R02", "R05", "R08", "R10"]))
    assert sorted(out.coverage) == ["R02", "R05", "R08", "R10"]


def test_registry_rejects_duplicate_ids():
    registry = RuleRegistry()
    registry.register(_Boom)

    class Other(_Boom):
        pass

    with pytest.raises(ValueError):
        registry.register(Other)


def test_fact_with_foreign_evidence_is_excluded_and_reported():
    snapshot, facts = sao_mai_golden(1)
    facts = [f for f in facts if f.field != "contract.payment_terms"]
    facts.append(Fact(id="fact_bad", document_version_id="dv_doc_contract_01_v1", field="contract.payment_terms",
                      value=[{"event_type": "acceptance", "offset_days": 30, "calendar_basis": "calendar_days"}],
                      evidence_ids=["ev_dv_doc_registration_v1_tax_id"]))  # nguồn của file khác
    out = run_analysis(snapshot, facts)
    assert [(i.object_id, i.code) for i in out.input_issues] == [("fact_bad", "EVIDENCE_VERSION_MISMATCH")]
    r08 = next(r for r in out.rule_results if r.rule_id == "R08")
    assert r08.reason_code == "PAYMENT_TERMS_UNAVAILABLE"


def test_fact_outside_snapshot_and_without_evidence_rejected():
    snapshot, facts = sao_mai_golden(1)
    facts += [
        Fact(id="f1", document_version_id="dv_other_case", field="contract.contract_no", value="HĐ01", evidence_ids=["x"]),
        Fact(id="f2", document_version_id="dv_doc_contract_01_v1", field="contract.note", value="ghi chú"),
    ]
    codes = {i.object_id: i.code for i in run_analysis(snapshot, facts).input_issues}
    assert codes == {"f1": "FACT_OUTSIDE_SNAPSHOT", "f2": "FACT_WITHOUT_EVIDENCE"}


def test_findings_always_traceable_and_wording_clean():
    config = RuleConfig()
    b = sao_mai_base(claim_type="received")
    b.remove_documents(DocType.FINANCIAL_STATEMENT)
    out = run_analysis(*b.build())
    assert out.findings
    for finding in out.findings:
        assert finding.evidence_ids or finding.absence_basis
        text = (finding.title + finding.description).lower()
        assert not any(p in text for p in config.forbidden_phrases)


def test_detection_metrics_and_time_reduction():
    metrics = detection_metrics(["a", "b", "c"], ["a", "b", "d", "e"])
    assert metrics.as_record()["precision"] == "0.6667"
    assert metrics.as_record()["recall"] == "0.5000"
    assert detection_metrics([], []).as_record()["precision"] == "N/A"
    assert time_reduction(1000, 650) == 35
    assert time_reduction(0, 10) is None
