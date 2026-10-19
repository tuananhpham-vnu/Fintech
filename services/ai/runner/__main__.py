"""CLI: `python -m runner health` (kiểm cấu hình, exit 0/1) và `python -m runner serve`."""
from __future__ import annotations

import argparse
import importlib
import json
import sys

from .config import MODE_MOCK, Settings
from .contracts import SCHEMA_VERSION, ContractDriftError, Contracts


def health(settings: Settings) -> dict:
    report: dict = {"schema_version": SCHEMA_VERSION, "mode": settings.mode, "checks": {}}
    checks = report["checks"]
    try:
        contracts = Contracts(settings.contracts_dir)
        checks["contracts"] = {"ok": True, "schemas": len(contracts.defs), "dir": str(settings.contracts_dir)}
    except (ContractDriftError, OSError) as exc:
        checks["contracts"] = {"ok": False, "error": str(exc)}
    checks["internal_api_key"] = {"ok": bool(settings.internal_api_key)}
    if settings.mode == MODE_MOCK:
        names = ("manifest.json", "extraction-gold.json", "golden-cases.json")
        missing = [n for n in names if not (settings.fixtures_dir / n).is_file()]
        checks["mock_fixtures"] = {"ok": not missing, "missing": missing, "dir": str(settings.fixtures_dir)}
    else:
        checks["model"] = {"ok": bool(settings.model_id and settings.prompt_version), "model_id": settings.model_id,
                           "prompt_version": settings.prompt_version}
        checks[settings.provider_name + "_api_key"] = {"ok": settings.provider_key_configured}
        try:
            module = importlib.import_module("extraction")
            checks["extraction_package"] = {"ok": getattr(module, "IMPLEMENTED", False),
                                            "version": getattr(module, "__version__", None)}
        except ImportError:
            checks["extraction_package"] = {"ok": False, "error": "not installed"}
    report["ok"] = all(c["ok"] for c in checks.values())
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m runner")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("health", help="Kiểm contracts, key và dependency theo AI_MODE")
    serve = sub.add_parser("serve", help="Chạy FastAPI nội bộ (chỉ bind loopback/private network)")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8100)
    args = parser.parse_args(argv)

    settings = Settings.from_env()
    if args.command == "health":
        report = health(settings)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["ok"] else 1

    import uvicorn
    from .app import create_app
    uvicorn.run(create_app(settings), host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
