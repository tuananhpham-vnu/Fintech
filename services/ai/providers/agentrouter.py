"""Agent Router gateway, with isolated credentials and explicit model selection.

The gateway speaks the same Chat Completions JSON wire protocol as DeepSeek.
Reuse its bounded transport/JSON handling, not its key or image-capability claims.
"""
from dataclasses import dataclass

from .deepseek import DeepSeekConfig, DeepSeekProvider

BASE_URL = 'https://agentrouter.org/v1'
DEFAULT_MODEL = 'deepseek-v4-flash'


@dataclass(frozen=True)
class AgentRouterConfig(DeepSeekConfig):
    model_id: str = DEFAULT_MODEL
    base_url: str = BASE_URL
    vision_enabled: bool = False


class AgentRouterProvider(DeepSeekProvider):
    name = 'agentrouter'
    label = 'AgentRouter'
    key_setting = 'AGENTROUTER_API_KEY'
    model_setting = 'AGENTROUTER_MODEL_ID'
    base_setting = 'AGENTROUTER_BASE_URL'
    allowed_base_paths = ('/v1',)

    @property
    def supports_images(self) -> bool:
        # Gateway model aliases do not establish upstream vision support.
        return self.config.vision_enabled

    def _headers(self) -> dict[str, str]:
        return {**super()._headers(), 'User-Agent': 'AIC-Rating/1.0 (financial-document-service)'}
