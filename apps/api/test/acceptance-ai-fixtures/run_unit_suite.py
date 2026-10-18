"""Run reviewed AI unit tests with dotenv reads and network connections blocked."""
from __future__ import annotations

import os
from pathlib import Path
import socket
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[4]
SOCKETPAIR_CODE = getattr(getattr(socket, "_fallback_socketpair", None), "__code__", None)


def deny_external_access(event, args):
    if event == "open" and isinstance(args[0], (str, bytes, os.PathLike)):
        if Path(os.fsdecode(args[0])).name == ".env":
            raise RuntimeError("ACCEPT-AI: .env reads are prohibited")
    if event == "socket.connect":
        # Windows implements the stdlib socketpair used by asyncio's wakeup pipe
        # with a fresh loopback listener. Permit only that exact stdlib caller.
        if SOCKETPAIR_CODE is not None and sys._getframe(1).f_code is SOCKETPAIR_CODE:
            return
        raise RuntimeError("ACCEPT-AI: network connections are prohibited")


sys.addaudithook(deny_external_access)
os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
os.environ["AI_EXTRACTION_TRACE"] = "0"
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("INTERNAL_API_KEY", None)
os.chdir(ROOT / "services/ai")
sys.path.insert(0, str(Path.cwd()))
import runner.config

# The service's configuration helpers call this implicitly. Skip file discovery;
# the audit hook also fails closed on any accidental direct .env read.
runner.config.load_dotenv = lambda *args, **kwargs: []
import pytest

raise SystemExit(pytest.main(["-q", "-rs", "-p", "no:cacheprovider", *sys.argv[1:]]))
