"""Provider LLM và tác vụ ngữ nghĩa có guard. Không import ở đường chạy deterministic.

Chọn provider bằng `LLM_PROVIDER` (đọc lúc tạo, không cache):
  - `ollama` (mặc định): model local `LLM_MODEL` (mặc định gemma3:4b) tại `OLLAMA_URL`. Dữ liệu không ra khỏi máy.
  - `gemini`: cloud, CHỈ khi `ALLOW_CLOUD_LLM=true` được đặt tường minh (dữ liệu mật mặc định không gửi đi).
  - `none`: tắt LLM (unit test, môi trường không có model): route cần model trả 503, rule vẫn chạy.
"""
from __future__ import annotations

import os

CLOUD_PROVIDERS = ("gemini",)


def cloud_allowed(env: dict[str, str] | None = None) -> bool:
    env = os.environ if env is None else env
    return env.get("ALLOW_CLOUD_LLM", "").strip().lower() in ("1", "true", "yes")


def provider_name(env: dict[str, str] | None = None) -> str:
    env = os.environ if env is None else env
    return env.get("LLM_PROVIDER", "ollama").strip().lower() or "ollama"


def build_provider(model_id: str | None = None):
    """Provider cho extraction/chat/semantic. Lỗi cấu hình -> ProviderUnavailable (route trả 503, không rơi về mock)."""
    from runner.config import load_dotenv

    from .gemini import ProviderUnavailable
    if os.environ.get('AI_LOAD_DOTENV', '1') != '0':
        load_dotenv()
    if os.environ.get('AI_PROVIDER', '').strip():
        from .factory import create_provider
        return create_provider(model=model_id)
    name = provider_name()
    if name == "none":
        raise ProviderUnavailable("LLM_PROVIDER=none")
    if name == "ollama":
        from .ollama import OllamaConfig, OllamaProvider
        config = OllamaConfig.from_env()
        if model_id:
            config = OllamaConfig(config.base_url, model_id, config.timeout_s, config.max_retries, config.num_ctx,
                                  config.keep_alive)
        return OllamaProvider(config)
    if name in CLOUD_PROVIDERS:
        if not cloud_allowed():
            raise ProviderUnavailable("Cloud LLM is disabled; set ALLOW_CLOUD_LLM=true to send documents to Gemini")
        from .gemini import GeminiConfig, GeminiProvider
        config = GeminiConfig.from_env()
        return GeminiProvider(GeminiConfig(config.api_key, model_id or config.model_id))
    raise ProviderUnavailable(f"LLM_PROVIDER must be ollama, gemini or none, got {name!r}")
