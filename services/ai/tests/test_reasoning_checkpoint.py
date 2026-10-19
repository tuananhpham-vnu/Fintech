import json
from financial_import import checkpoint

def setup(monkeypatch,tmp_path):
    monkeypatch.setenv('AI_REASONING_CACHE','1');monkeypatch.setenv('AI_STORAGE_DIR',str(tmp_path))

def test_checkpoint_is_bound_to_source_model_and_scope(monkeypatch,tmp_path):
    setup(monkeypatch,tmp_path)
    key=['observations','source-hash','model-v1','scope-fingerprint']
    checkpoint.put(key,{'value':'0'})
    assert checkpoint.get(key)=={'value':'0'}
    assert checkpoint.get(['observations','another-source','model-v1','scope-fingerprint']) is None
    assert checkpoint.get(['observations','source-hash','model-v2','scope-fingerprint']) is None

def test_corrupted_checkpoint_is_not_accepted(monkeypatch,tmp_path):
    setup(monkeypatch,tmp_path);key=['ocr','hash',1,'version'];checkpoint.put(key,'source text')
    file=next((tmp_path/'reasoning-cache').glob('*.json'));envelope=json.loads(file.read_text('utf8'))
    envelope['payload']='tampered';file.write_text(json.dumps(envelope),'utf8')
    assert checkpoint.get(key) is None

def test_disabled_checkpoint_does_not_write(monkeypatch,tmp_path):
    monkeypatch.setenv('AI_REASONING_CACHE','0');monkeypatch.setenv('AI_STORAGE_DIR',str(tmp_path))
    checkpoint.put(['key'],'text');assert not list(tmp_path.iterdir())

def test_organization_namespace_isolated_and_restored_after_calls(monkeypatch,tmp_path):
    setup(monkeypatch,tmp_path)
    checkpoint.scoped_call('organization-a',checkpoint.put,['same-source'],'scoped-content')
    assert checkpoint.scoped_call('organization-a',checkpoint.get,['same-source'])=='scoped-content'
    assert checkpoint.scoped_call('organization-b',checkpoint.get,['same-source']) is None
    assert checkpoint.CACHE_SCOPE.get()=='standalone'

def test_bounded_checkpoint_does_not_evict_an_outside_file(monkeypatch,tmp_path):
    setup(monkeypatch,tmp_path);monkeypatch.setattr(checkpoint,'MAX_FILES',2)
    for n in range(4):checkpoint.put(['key',n],str(n))
    assert len(list((tmp_path/'reasoning-cache').glob('*.json')))==2
    assert checkpoint.get(['key',3])=='3'
