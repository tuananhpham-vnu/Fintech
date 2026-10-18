"""Bounded in-process OCR reuse, keyed by verified original bytes/page/engine version.
No disk persistence, paths, prompts, credentials or hash-only public read endpoint.
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
    with _lock:
        item=_values.get(key)
        if not item:return None
        if item[0]<time.monotonic():
            del _values[key]
            return None
        _values.move_to_end(key)
        return item[1]

def put(key,text):
    if len(text)>250_000:return
    with _lock:
        _values[key]=(time.monotonic()+TTL_S,text)
        _values.move_to_end(key)
        while len(_values)>MAX_PAGES or sum(len(v[1]) for v in _values.values())>MAX_CHARS:
            _values.popitem(last=False)
