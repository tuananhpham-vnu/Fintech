"""Select one provider explicitly; a failure never switches credentials/providers."""
from __future__ import annotations

import os
from collections.abc import Mapping

from .base import ModelProvider, ProviderUnavailable


def provider_name(env: Mapping[str, str]) -> str:
    name = env.get("AI_PROVIDER", "gemini").strip().lower()
    if name not in {"gemini", "deepseek", "agentrouter", "motapis"}:
        raise ProviderUnavailable("AI_PROVIDER must be gemini or deepseek or agentrouter or motapis")
    return name


def model_id(env: Mapping[str, str], name: str | None = None) -> str:
    name = name or provider_name(env)
    if name == "gemini":
        return (env.get("GEMINI_MODEL_ID") or env.get("MODEL_ID") or "gemini-3.1-flash-lite").strip()
    if name == 'agentrouter':
        return env.get('AGENTROUTER_MODEL_ID', 'deepseek-v4-flash').strip()
    if name == 'motapis':
        return env.get('MOTAPIS_MODEL_ID', 'gpt-6-luna').strip()
    return env.get("DEEPSEEK_MODEL_ID", "deepseek-flash").strip()


def create_provider(env: Mapping[str, str] | None = None, *, name: str | None = None,
                    model: str | None = None) -> ModelProvider:
    if env is None:
        from runner.config import load_dotenv
        if os.environ.get("AI_LOAD_DOTENV", "1") != "0":
            load_dotenv()
        env = os.environ
    selected = provider_name({**env, **({"AI_PROVIDER": name} if name is not None else {})})
    selected_model = model if model is not None else model_id(env, selected)
    if selected == 'motapis':
        from .motapis import MotApisConfig, MotApisProvider
        vision = env.get('MOTAPIS_VISION_ENABLED', '0')
        if vision not in ('0', '1'):
            raise ProviderUnavailable('MOTAPIS_VISION_ENABLED must be 0 or 1')
        return MotApisProvider(MotApisConfig(env.get('MOTAPIS_API_KEY') or None, selected_model,
            base_url=env.get('MOTAPIS_BASE_URL', 'https://motapis.com/v1'), vision_enabled=vision == '1'))
    if selected == 'agentrouter':
        from .agentrouter import AgentRouterConfig, AgentRouterProvider
        vision = env.get('AGENTROUTER_VISION_ENABLED', '0')
        if vision not in ('0', '1'):
            raise ProviderUnavailable('AGENTROUTER_VISION_ENABLED must be 0 or 1')
        return AgentRouterProvider(AgentRouterConfig(env.get('AGENTROUTER_API_KEY') or None, selected_model,
            base_url=env.get('AGENTROUTER_BASE_URL', 'https://agentrouter.org/v1'), vision_enabled=vision == '1'))
    if selected == "deepseek":
        from .deepseek import DeepSeekConfig, DeepSeekProvider
        return DeepSeekProvider(DeepSeekConfig(env.get("DEEPSEEK_API_KEY") or None, selected_model,
                                              base_url=env.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")))
    from .gemini import GeminiConfig, GeminiProvider
    return GeminiProvider(GeminiConfig(env.get("GEMINI_API_KEY") or None, selected_model))
