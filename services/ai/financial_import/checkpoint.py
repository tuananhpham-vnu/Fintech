"""Optional private source/version-bound cache. Never a canonical document store.
Only successful, validated stage outputs are written. No public hash lookup API.
"""
import hashlib
import json
import os
import time
import uuid
from contextvars import ContextVar
from pathlib import Path

MAX_BYTES=1_000_000
MAX_FILES=256
TTL=1800
CACHE_SCOPE=ContextVar('financial_cache_scope',default='standalone')

def scoped_call(scope, function, *args, **kwargs):
    if not isinstance(scope,str) or len(scope)>128:
        raise ValueError('Invalid financial cache scope')
    token=CACHE_SCOPE.set(scope)
    try:return function(*args,**kwargs)
    finally:CACHE_SCOPE.reset(token)

def _directory():
    if os.environ.get('AI_REASONING_CACHE')!='1':return None
    configured=os.environ.get('AI_STORAGE_DIR')
    if not configured:return None
    original=Path(configured).absolute()
    if original.resolve()!=original or original.is_symlink():return None
    target=original/'reasoning-cache'
    if target.exists() and (target.is_symlink() or target.resolve()!=target):return None
    target.mkdir(mode=0o700,parents=True,exist_ok=True)
    return target

def _name(key):
    return hashlib.sha256(json.dumps([CACHE_SCOPE.get(),key],sort_keys=True,ensure_ascii=True).encode()).hexdigest()+'.json'

def get(key):
    try:
        root=_directory()
        if root is None:return None
        target=root/_name(key)
        if target.is_symlink() or target.stat().st_size>MAX_BYTES or time.time()-target.stat().st_mtime>TTL:return None
        envelope=json.loads(target.read_text('utf8'))
        if envelope['key_hash']!=_name(key):return None
        payload=envelope['payload']
        digest=hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        return payload if digest==envelope['payload_hash'] else None
    except (OSError,ValueError,TypeError,KeyError):return None

def put(key,payload):
    temporary=None
    try:
        root=_directory()
        if root is None:return
        files=[p for p in root.iterdir() if p.is_file() and not p.is_symlink() and len(p.stem)==64 and p.suffix=='.json']
        if len(files)>=MAX_FILES:
            # Cache-only eviction; resolved targets stay inside this explicit private directory.
            oldest=min(files,key=lambda p:p.stat().st_mtime)
            if oldest.resolve().parent==root:oldest.unlink()
        data=json.dumps({'key_hash':_name(key),'payload':payload,
            'payload_hash':hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False).encode()).hexdigest()},ensure_ascii=False)
        if len(data.encode())>MAX_BYTES:return
        temporary=root/(uuid.uuid4().hex+'.tmp')
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w',encoding='utf8') as stream:stream.write(data)
        os.replace(temporary,root/_name(key))
    except (OSError,ValueError,TypeError):pass
    finally:
        if temporary is not None and temporary.exists() and not temporary.is_symlink():
            try:temporary.unlink()
            except OSError:pass
