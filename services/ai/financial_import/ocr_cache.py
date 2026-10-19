"""Bounded in-process OCR reuse, keyed by verified original bytes/page/engine version.
Optional private disk checkpoint when AI_REASONING_CACHE=1; never a public read endpoint.
"""
import threading
import time
from collections import OrderedDict

_lock=threading.Lock()
_values=OrderedDict()
MAX_CHARS=4_000_000
MAX_PAGES=64
TTL_S=1800

def get(key):
    from . import checkpoint
    key=(checkpoint.CACHE_SCOPE.get(),*key)
    with _lock:
        item=_values.get(key)
        if item and item[0]<time.monotonic():
            del _values[key]
            item=None
        if item:
            _values.move_to_end(key)
            return item[1]
    from . import checkpoint
    value=checkpoint.get(['ocr',*key])
    return value if isinstance(value,str) and len(value)<=250_000 else None

def put(key,text):
    from . import checkpoint
    key=(checkpoint.CACHE_SCOPE.get(),*key)
    if len(text)>250_000:return
    with _lock:
        _values[key]=(time.monotonic()+TTL_S,text)
        _values.move_to_end(key)
        while len(_values)>MAX_PAGES or sum(len(v[1]) for v in _values.values())>MAX_CHARS:
            _values.popitem(last=False)
    from . import checkpoint
    checkpoint.put(['ocr',*key],text)
