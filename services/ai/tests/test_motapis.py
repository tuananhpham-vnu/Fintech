"""Mot APIs integration contracts; synthetic transport only, no paid calls."""
import json
from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from providers.base import ProviderError, ProviderUnavailable
from providers.factory import create_provider
from providers.motapis import MotApisConfig, MotApisProvider
from runner.config import Settings
from runner.__main__ import health
from runner.provider_diagnostics import classify
from .test_deepseek import reply


def test_gateway_wire_json_separate_credentials_and_cache_identity():
    calls=[]
    p=MotApisProvider(MotApisConfig('synthetic-motapis'),client=httpx.Client(transport=httpx.MockTransport(
        lambda r:calls.append(r) or reply({'value':'1234.50'}))))
    try:
        r=p.generate_json('Synthetic JSON parser','Synthetic source',{},max_output_tokens=128)
        assert r.data=={'value':'1234.50'} and len(calls)==1
        assert str(calls[0].url)=='https://motapis.com/v1/chat/completions'
        assert calls[0].headers['Authorization']=='Bearer synthetic-motapis'
        body=json.loads(calls[0].content)
        assert body['model']=='gpt-6-luna' and body['max_tokens']==128
        assert body['response_format']=={'type':'json_object'}
        assert p.cache_identity=='motapis:https://motapis.com/v1:gpt-6-luna'
        assert 'synthetic-motapis' not in repr(p.config)
    finally:p.close()


def test_factory_and_health_never_use_other_provider_keys():
    env={'AI_PROVIDER':'motapis','MOTAPIS_API_KEY':'synthetic-motapis',
         'DEEPSEEK_API_KEY':'wrong-key','GEMINI_API_KEY':'wrong-key','AGENTROUTER_API_KEY':'wrong-key',
         'AI_MODE':'live','INTERNAL_API_KEY':'synthetic-internal','PROMPT_VERSION':'synthetic-v1'}
    p=create_provider(env)
    try:
        assert isinstance(p,MotApisProvider) and p.config.api_key=='synthetic-motapis'
        assert p.model_id=='gpt-6-luna' and not p.supports_images
    finally:p.close()
    with pytest.raises(ProviderUnavailable,match='MOTAPIS_API_KEY'):
        create_provider({k:v for k,v in env.items() if k!='MOTAPIS_API_KEY'})
    settings=Settings.from_env(env)
    assert health(settings)['checks']['motapis_api_key']=={'ok':True}
    assert not replace(settings,motapis_key_configured=False).provider_key_configured


@pytest.mark.parametrize('base',['http://motapis.com/v1','https://motapis.com',
    'https://key:secret@motapis.com/v1','https://motapis.com/v1?key=secret',
    'https://motapis.com/v1/chat/completions'])
def test_invalid_endpoint_fails_before_authentication(base):
    with pytest.raises(ProviderUnavailable,match='MOTAPIS_BASE_URL'):
        MotApisProvider(MotApisConfig('synthetic',base_url=base))


@pytest.mark.parametrize('status',[401,402,403,307])
def test_denial_is_not_retried_redirected_or_logged(status,caplog):
    calls=[]
    p=MotApisProvider(MotApisConfig('synthetic'),client=httpx.Client(transport=httpx.MockTransport(
        lambda r:calls.append(r) or httpx.Response(status,text='private provider body',headers={'Location':'https://example.invalid'}))))
    try:
        with pytest.raises(ProviderError) as e:p.generate_json('private source','private prompt',{})
        assert str(e.value)==f'MotAPIs HTTP {status}' and len(calls)==1
        assert classify(e.value)['http_status']==status
        assert 'private' not in caplog.text
    finally:p.close()


def test_ocr_requires_explicit_capability_and_endpoint_specific_cache():
    from extraction.ocr import ProviderOcr
    p=MotApisProvider(MotApisConfig('synthetic'))
    try:
        with pytest.raises(ProviderUnavailable,match='image OCR'):
            p.generate_json('s','u',{},media=[('image/png',b'synthetic')])
        assert 'motapis:https://motapis.com/v1:' in ProviderOcr(p).version
    finally:p.close()
    with pytest.raises(ProviderUnavailable,match='VISION_ENABLED'):
        create_provider({'AI_PROVIDER':'motapis','MOTAPIS_API_KEY':'synthetic','MOTAPIS_VISION_ENABLED':'yes'})


def test_provider_switch_can_keep_old_ledger_and_cache_directory(tmp_path,monkeypatch):
    from datetime import datetime,timezone
    from providers.spend_budget import reserve
    from types import SimpleNamespace
    old=tmp_path/'old';new=tmp_path/'motapis';old.mkdir();new.mkdir()
    old_file=old/'ai-spend-budget.sqlite3';old_file.write_bytes(b'OLD LEDGER IS NOT RESET')
    values={'AI_STORAGE_DIR':str(old),'AI_SPEND_LEDGER_DIR':str(new),'AI_SPEND_BUDGET_USD':'0.1',
        'AI_SPEND_PROVIDER':'motapis','AI_SPEND_MODEL':'deepseek-v4-flash','AI_SPEND_BASE_URL':'https://motapis.com/v1',
        'AI_SPEND_PRICE_CHECKED_DATE':datetime.now(timezone.utc).date().isoformat(),
        'AI_SPEND_INPUT_USD_PER_MILLION':'0.07','AI_SPEND_OUTPUT_USD_PER_MILLION':'0.14',
        'AI_SPEND_MAX_CONTEXT_TOKENS':'1000000'}
    for k,v in values.items():monkeypatch.setenv(k,v)
    p=SimpleNamespace(name='motapis',model_id='deepseek-v4-flash',config=SimpleNamespace(base_url='https://motapis.com/v1'))
    r=reserve(p,{'max_tokens':128,'messages':[{'role':'user','content':'synthetic'}]})
    assert Path(r[0]).parent==new and old_file.read_bytes()==b'OLD LEDGER IS NOT RESET'
