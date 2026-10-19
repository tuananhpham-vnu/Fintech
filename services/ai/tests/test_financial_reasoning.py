import copy
from financial_import.reasoning import build, VERSION
from financial_import.semantics import semantic_issue
from extraction.llm import Deadline
from runner.errors import ServiceError
from .test_extraction import FakeModel

SCOPE=dict(country='US',start_date='2024-01-01',end_date='2024-12-31',basis='standalone',currency='USD',unit_multiplier='1')
TEXT='Total liabilities 100\nLong term liabilities 20\nTrade payables 30\nTotal = Current + Long term\nCurrent = Payables + Borrowings'
PAGES={1:{'page':1,'text':TEXT,'preview':TEXT,'needs_ocr':False}}
def variable(id,key=None):
    return dict(id=id,key=key,label=id,dimension='money',nature='instant',as_of=SCOPE['end_date'])
def observation(id,label,value):
    return dict(id='o_'+id,variable_id=id,value=value,label=label,raw_token=value,page=1,quote=label+' '+value,
        period_start=SCOPE['start_date'],period_end=SCOPE['end_date'],basis='standalone',currency='USD',unit_multiplier='1',dimension='money')
def observed():
    return dict(variables=[variable('total','total_liabilities'),variable('long'),variable('payable')],
        observations=[observation('total','Total liabilities','100'),observation('long','Long term liabilities','20'),observation('payable','Trade payables','30')])
def relation(id,terms,quote):
    return dict(id=id,label=id,kind='identity',reason='SYNTHETIC complete partition',assumptions=[],
        terms=[dict(variable_id=v,coefficient=c) for v,c in terms],evidence=[dict(page=1,quote=quote)])
def planned():
    return dict(variables=[variable('current','current_liabilities'),variable('loan','interest_bearing_debt')],relations=[
        relation('partition',[('b0_0_0','1'),('current','-1'),('b0_0_1','-1')],'Total = Current + Long term'),
        relation('debt',[('current','1'),('b0_0_2','-1'),('loan','-1')],'Current = Payables + Borrowings')],requested_pages=[])
def run(model,pages=None,available=None,read_page=None):
    return build(model,SCOPE,copy.deepcopy(pages or PAGES),[],Deadline(30),available,read_page)

def test_preserves_extra_observed_components_and_proposes_unobserved_intermediates_not_values():
    model=FakeModel(observed(),planned(),dict(variables=[],observations=[]));g=run(model)
    assert g['version']==VERSION and len(g['observations'])==3 and len(g['relations'])==2
    assert next(v for v in g['variables'] if v['id']=='current')['key']=='current_liabilities'
    assert not any(o['variable_id']=='current' for o in g['observations'])
    assert g['coverage']['complete'] and len(model.calls)==3

def test_ungrounded_observation_is_not_promoted():
    source=observed();source['observations'][0]['value']='101'
    g=run(FakeModel(source,planned()))
    assert all(o['label']!='Total liabilities' for o in g['observations'])
    assert any(d['code']=='UNSUPPORTED_OBSERVATION' for d in g['diagnostics'])

def test_cross_period_observation_is_not_promoted():
    source=observed();source['observations'][0]['period_end']='2023-12-31'
    g=run(FakeModel(source,planned()));assert len(g['observations'])==2

def test_invented_relation_evidence_is_rejected_without_erasing_observations():
    p=planned();p['relations'][0]['evidence'][0]['quote']='Invented equality'
    g=run(FakeModel(observed(),p));assert len(g['observations'])==3 and len(g['relations'])==1
    assert any(d['code']=='RELATION_EVIDENCE_UNAVAILABLE' for d in g['diagnostics'])

def test_provider_failure_retains_observations_and_records_stage_reason():
    g=run(FakeModel(observed(),ServiceError(503,'PROVIDER_UNAVAILABLE','synthetic')))
    assert len(g['observations'])==3 and not g['relations']
    assert g['diagnostics'][-1]==dict(code='PROVIDER_UNAVAILABLE',detail='relations')

def test_targeted_search_reads_only_requested_extra_original_page_then_replans():
    p=planned();p['requested_pages']=[2]
    called=[]
    def read(number):
        called.append(number);return dict(page=number,text='Additional notes',preview='Notes',needs_ocr=False)
    model=FakeModel(observed(),p,dict(variables=[],observations=[]),dict(variables=[],observations=[]),
        dict(variables=[],relations=p['relations'],requested_pages=[]),dict(variables=[],observations=[]))
    g=run(model,available=[*PAGES.values(),dict(page=2,preview='Notes')],read_page=read)
    assert called==[2] and g['coverage']['pages_read']==[1,2] and g['coverage']['complete']
    assert len(g['relations'])==2

def test_unrestricted_english_and_vietnamese_labels_are_not_misread_as_restricted():
    assert semantic_issue('unrestricted_short_term_equivalents','Unrestricted cash equivalents','','standalone') is None
    assert semantic_issue('unrestricted_short_term_equivalents','Các khoản tương đương tiền không bị hạn chế','','standalone') is None
    assert semantic_issue('unrestricted_short_term_equivalents','Restricted cash equivalents','','standalone')=='CASH_COMPONENT_NOT_SEPARATE_OR_UNRESTRICTED'
    assert semantic_issue('unrestricted_short_term_equivalents','Các khoản tương đương tiền bị hạn chế','','standalone')=='CASH_COMPONENT_NOT_SEPARATE_OR_UNRESTRICTED'

def test_graph_matches_versioned_contract():
    import json
    from pathlib import Path
    from jsonschema import Draft7Validator
    schema=json.loads((Path(__file__).resolve().parents[3]/'packages/contracts/aic-financial-import/reasoning-model.schema.json').read_text('utf8'))
    Draft7Validator(schema).validate(run(FakeModel(observed(),planned())))

def test_accounting_parentheses_in_model_value_are_normalized_then_grounded():
    pages={1:{'page':1,'text':'Adjustment (10)','preview':'Adjustment','needs_ocr':False}}
    obs=observed();obs['variables']=[variable('adjustment')]
    obs['observations']=[observation('adjustment','Adjustment','(10)')]
    model=FakeModel(obs,dict(variables=[],relations=[],requested_pages=[]))
    g=run(model,pages);assert len(g['observations'])==1 and g['observations'][0]['value']=='-10'

def test_targeted_recovery_preserves_printed_zero_with_exact_requested_binding():
    source=observed();source['observations']=source['observations'][:1]+source['observations'][2:]
    p=planned();p['variables'].append(variable('long'))
    p['relations'][0]['terms'][2]['variable_id']='long'
    recovered=observation('long','Long term liabilities','0')
    pages=copy.deepcopy(PAGES);pages[1]['text']=TEXT.replace('liabilities 20','liabilities 0')
    g=run(FakeModel(source,p,dict(variables=[],observations=[recovered])),pages)
    assert any(o['variable_id']=='long' and o['value']=='0' for o in g['observations'])
    assert not any(o['variable_id']=='current' for o in g['observations'])

def test_planner_may_echo_unchanged_context_but_cannot_overwrite_existing_variable():
    p=planned();p['variables'].append(variable('b0_0_0','total_liabilities'))
    p['variables'][-1]['label']='total'
    g=run(FakeModel(observed(),p,dict(variables=[],observations=[])))
    assert len(g['relations'])==2
    p['variables'][-1]['label']='Changed source binding'
    g=run(FakeModel(observed(),p))
    assert not g['relations'] and any(d['detail']=='relations' for d in g['diagnostics'])

def test_one_malformed_relation_does_not_erase_other_independently_valid_equations():
    p=planned();p['relations'][0]['reason']=''
    g=run(FakeModel(observed(),p,dict(variables=[],observations=[])))
    assert [r['id'] for r in g['relations']]==['debt']
    assert any(d['code']=='INVALID_RELATION_SCHEMA' for d in g['diagnostics'])

def test_alternative_direct_sources_bind_same_quantity_so_conflicts_remain_visible_to_api():
    fact=dict(key='total_liabilities',label='Total liabilities',value='99',raw_token='99',page=1,quote='Total liabilities 99')
    pages=copy.deepcopy(PAGES);pages[1]['text']+='\nTotal liabilities 99'
    model=FakeModel(observed(),dict(variables=[],relations=[],requested_pages=[]))
    g=build(model,SCOPE,pages,[fact],Deadline(30))
    assert len([v for v in g['variables'] if v['key']=='total_liabilities'])==1
    assert {o['value'] for o in g['observations'] if o['variable_id']=='f_total_liabilities'}=={'99','100'}

def test_omitted_empty_page_requests_do_not_discard_valid_source_supported_relations():
    p=planned();del p['requested_pages'];p['provider_note']='Untrusted extra metadata'
    g=run(FakeModel(observed(),p,dict(variables=[],observations=[])))
    assert len(g['relations'])==2 and any(d['code']=='EMPTY_PLAN_COLLECTIONS' for d in g['diagnostics'])

def test_missing_component_id_is_replanned_instead_of_becoming_an_accounting_assumption():
    p=planned();p['relations'][0]['assumptions']=['Missing variable not yet captured']
    g=run(FakeModel(observed(),p,planned(),dict(variables=[],observations=[])))
    assert len(g['relations'])==2 and not g['relations'][0]['assumptions']
    assert any(d['code']=='PLANNING_REPAIRED' for d in g['diagnostics'])
