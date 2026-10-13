"""Cấu hình đọc từ biến môi trường. Không có secret mặc định; không đọc secret từ file trong repo."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONTRACTS_DIR = REPO_ROOT / "packages" / "contracts"
DEFAULT_FIXTURES_DIR = DEFAULT_CONTRACTS_DIR / "fixtures"

DOTENV_PATH = REPO_ROOT / ".env"

MODE_MOCK = "mock"


def load_dotenv(path: Path = DOTENV_PATH) -> list[str]:
    """Nạp KEY=VALUE từ .env (đã gitignore) vào os.environ nếu biến chưa có; trả về tên biến đã nạp, không trả giá trị."""
    if not path.is_file():
        return []
    loaded = []
    for line in path.read_text("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
            loaded.append(key)
    return loaded
MODE_LIVE = "live"


@dataclass(frozen=True)
class Settings:
    internal_api_key: str | None
    mode: str
    model_id: str
    prompt_version: str
    contracts_dir: Path
    fixtures_dir: Path
    gemini_key_configured: bool

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        if env is None:
            load_dotenv()
        env = dict(os.environ if env is None else env)
        mode = env.get("AI_MODE", MODE_MOCK).strip().lower()
        if mode not in (MODE_MOCK, MODE_LIVE):
            raise ValueError(f"AI_MODE must be '{MODE_MOCK}' or '{MODE_LIVE}', got {mode!r}")
        return cls(
            internal_api_key=env.get("INTERNAL_API_KEY") or None,
            mode=mode,
            model_id=env.get("MODEL_ID", ""),
            prompt_version=env.get("PROMPT_VERSION", ""),
            contracts_dir=Path(env.get("CONTRACTS_DIR", DEFAULT_CONTRACTS_DIR)),
            fixtures_dir=Path(env.get("AI_FIXTURES_DIR", DEFAULT_FIXTURES_DIR)),
            gemini_key_configured=bool(env.get("GEMINI_API_KEY")),
        )
