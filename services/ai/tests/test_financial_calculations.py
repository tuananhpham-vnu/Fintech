import pytest
from financial_import.calculations import propose
from financial_import.service import execute
from extraction.llm import Deadline
from runner.errors import ServiceError
from .test_extraction import FakeModel
from .test_financial_import import answer, sample, request


def proposal():
    scope=answer()['scope']
    component=dict(id='assets',value='77099',raw_token='77,099',label='Total assets',page=1,
        quote='Total assets 77,099 70,000',period_start=scope['start_date'],period_end=scope['end_date'],
        basis=scope['basis'],currency=scope['currency'],unit_multiplier=scope['unit_multiplier'],dimension='money')
    return dict(id='liabilities',key='total_liabilities',reason='SYNTHETIC proposal requiring source review',
        assumptions=['SYNTHETIC missing equity breakdown'],expression=['assets'],inputs=[component])


def run(p):
    return propose(FakeModel({'calculations':[p]}), answer()['scope'],
        {1:{'page':1,'text':'Total assets 77,099 70,000'}},[],['total_liabilities'],Deadline(10))


def test_proposals_keep_grounded_inputs_and_assumptions_without_computing_or_verifying(monkeypatch):
    monkeypatch.setenv('AI_FINANCIAL_CALCULATIONS','1')
    p=proposal();result=run(p)
    assert result==[p] and 'computed_value' not in result[0]
    assert result[0]['assumptions']


@pytest.mark.parametrize('change',[
    lambda p:p['inputs'][0].update(quote='Invented source 77,099'),
    lambda p:p['inputs'][0].update(value='770990'),
    lambda p:p['inputs'][0].update(raw_token='7',value='7'),
    lambda p:p['inputs'][0].update(page=2),
    lambda p:p.update(key='net_revenue'),
])
def test_ungrounded_inputs_or_unrequested_targets_are_withheld(monkeypatch,change):
    monkeypatch.setenv('AI_FINANCIAL_CALCULATIONS','1')
    p=proposal();change(p);assert run(p)==[]


def test_optional_failure_preserves_direct_facts_and_never_promotes_proposals(monkeypatch):
    monkeypatch.setenv('AI_FINANCIAL_CALCULATIONS','1')
    raw=answer();model=FakeModel(raw,ServiceError(503,'PROVIDER_UNAVAILABLE','SYNTHETIC timeout'))
    result=execute(request(sample()),model)
    assert len(result['facts'])==1 and result['facts'][0]['verification']=='unverified'
    assert 'calculations' not in result and 'total_liabilities' in result['missing_keys']


def test_pipeline_returns_separate_proposals_never_disguised_as_printed_facts(monkeypatch):
    monkeypatch.setenv('AI_FINANCIAL_CALCULATIONS','1')
    result=execute(request(sample()),FakeModel(answer(),{'calculations':[proposal()]}))
    assert result['calculations'][0]['key']=='total_liabilities'
    assert [f['key'] for f in result['facts']]==['total_assets']
    assert 'total_liabilities' in result['missing_keys']


def test_disabled_feature_does_not_spend_a_model_call(monkeypatch):
    monkeypatch.setenv('AI_FINANCIAL_CALCULATIONS','0')
    model=FakeModel({'calculations':[proposal()]})
    assert propose(model,answer()['scope'],{},[],['total_liabilities'],Deadline(10))==[]
    assert model.calls==[]
