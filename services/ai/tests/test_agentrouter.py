"""Gateway transport doubles; these do not establish live account/model access."""
import json
from dataclasses import replace

import httpx
import pytest

from providers.agentrouter import AgentRouterConfig, AgentRouterProvider
from providers.base import ProviderError, ProviderUnavailable
from providers.factory import create_provider
from runner.config import Settings
from runner.__main__ import health
from runner.provider_diagnostics import classify
from .test_deepseek import reply


def test_gateway_uses_own_bearer_model_endpoint_and_honest_client_identity():
    calls=[]
    p=AgentRouterProvider(AgentRouterConfig('synthetic-router'),client=httpx.Client(
        transport=httpx.MockTransport(lambda r:calls.append(r) or reply({'ok':True}))))
    result=p.generate_json('Synthetic JSON parser','Return JSON',{'type':'object'})
    request=calls[0];body=json.loads(request.content)
    assert str(request.url)=='https://agentrouter.org/v1/chat/completions'
    assert request.headers['Authorization']=='Bearer synthetic-router'
    assert request.headers['User-Agent']=='AIC-Rating/1.0 (financial-document-service)'
    assert body['model']=='deepseek-v4-flash' and body['response_format']=={'type':'json_object'}
    assert body['thinking']=={'type':'disabled'} and not body['stream']
    assert result.data=={'ok':True} and p.name=='agentrouter'
    assert 'synthetic-router' not in repr(p.config)
    p.close()


def test_factory_and_health_require_gateway_key_and_do_not_fallback():
    env={'AI_PROVIDER':'agentrouter','AGENTROUTER_API_KEY':'synthetic-router','AI_MODE':'live',
         'INTERNAL_API_KEY':'synthetic-internal','PROMPT_VERSION':'synthetic-v1',
         'GEMINI_API_KEY':'synthetic-gemini','DEEPSEEK_API_KEY':'synthetic-deepseek','MODEL_ID':'gemini-old'}
    p=create_provider(env)
    assert isinstance(p,AgentRouterProvider) and p.model_id=='deepseek-v4-flash'
    assert p.config.api_key=='synthetic-router' and not p.supports_images
    p.close()
    missing={k:v for k,v in env.items() if k!='AGENTROUTER_API_KEY'}
    with pytest.raises(ProviderUnavailable,match='AGENTROUTER_API_KEY'):create_provider(missing)
    settings=Settings.from_env(env)
    report=health(settings)
    assert report['ok'] and report['checks']['agentrouter_api_key']=={'ok':True}
    assert 'deepseek_api_key' not in report['checks'] and 'gemini_api_key' not in report['checks']
    assert not replace(settings,agentrouter_key_configured=False).provider_key_configured


@pytest.mark.parametrize('base',['http://agentrouter.org/v1','https://agentrouter.org',
    'https://key:secret@agentrouter.org/v1','https://agentrouter.org/v1?key=secret',
    'https://agentrouter.org/v1#fragment','https://agentrouter.org/v1/chat/completions'])
def test_invalid_endpoint_fails_before_any_credentials_sent(base):
    with pytest.raises(ProviderUnavailable,match='AGENTROUTER_BASE_URL'):
        AgentRouterProvider(AgentRouterConfig('synthetic',base_url=base))


@pytest.mark.parametrize('status',[401,402,403,307])
def test_gateway_denial_does_not_retry_fallback_redirect_or_leak_body(status,caplog):
    calls=[];sleeps=[]
    p=AgentRouterProvider(AgentRouterConfig('synthetic-router'),client=httpx.Client(transport=httpx.MockTransport(
        lambda r:calls.append(r) or httpx.Response(status,text='private upstream body with secret',headers={'Location':'https://elsewhere.invalid'}))),sleep=sleeps.append)
    with pytest.raises(ProviderError) as failed:p.generate_json('private prompt','private document',{})
    assert str(failed.value)==f'AgentRouter HTTP {status}'
    assert len(calls)==1 and not sleeps
    assert classify(failed.value)['http_status']==status
    assert 'private' not in caplog.text and 'synthetic-router' not in caplog.text
    p.close()


def test_gateway_vision_is_explicit_and_rejected_before_call_unless_enabled():
    calls=[]
    p=AgentRouterProvider(AgentRouterConfig('synthetic'),client=httpx.Client(transport=httpx.MockTransport(
        lambda r:calls.append(r) or reply({'text':'SYNTHETIC 0'}))))
    with pytest.raises(ProviderUnavailable,match='image OCR'):
        p.generate_json('s','u',{},media=[('image/png',b'synthetic')])
    assert not calls
    p.close()
    p=AgentRouterProvider(AgentRouterConfig('synthetic',vision_enabled=True),client=httpx.Client(transport=httpx.MockTransport(
        lambda r:calls.append(r) or reply({'text':'SYNTHETIC 0'}))))
    p.generate_json('s','u',{},media=[('image/png',b'synthetic')])
    assert json.loads(calls[0].content)['messages'][1]['content'][1]['type']=='image_url'
    p.close()
    with pytest.raises(ProviderUnavailable,match='VISION_ENABLED'):
        create_provider({'AI_PROVIDER':'agentrouter','AGENTROUTER_API_KEY':'synthetic','AGENTROUTER_VISION_ENABLED':'yes'})


def test_gateway_financial_discovery_keeps_source_and_provider_provenance():
    from financial_import.intake import discover
    from .test_financial_intake import pdf,request,answer
    p=AgentRouterProvider(AgentRouterConfig('synthetic'),client=httpx.Client(transport=httpx.MockTransport(lambda r:reply(answer()))))
    result=discover(request(pdf()),p)
    assert len(result['periods'])==2 and result['provenance']['model_id']=='deepseek-v4-flash'
    p.close()
