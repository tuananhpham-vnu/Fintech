"""Mot APIs Chat Completions gateway with separate credentials and capability opt-in."""
from dataclasses import dataclass

from .deepseek import DeepSeekConfig, DeepSeekProvider

BASE_URL = 'https://motapis.com/v1'
DEFAULT_MODEL = 'gpt-6-luna'


@dataclass(frozen=True)
class MotApisConfig(DeepSeekConfig):
    model_id: str = DEFAULT_MODEL
    base_url: str = BASE_URL
    vision_enabled: bool = False


class MotApisProvider(DeepSeekProvider):
    name = 'motapis'
    label = 'MotAPIs'
    key_setting = 'MOTAPIS_API_KEY'
    model_setting = 'MOTAPIS_MODEL_ID'
    base_setting = 'MOTAPIS_BASE_URL'
    allowed_base_paths = ('/v1',)

    @property
    def supports_images(self) -> bool:
        return self.config.vision_enabled

    @property
    def cache_identity(self) -> str:
        return f'{self.name}:{self.config.base_url.rstrip("/")}:{self.model_id}'

    def _headers(self) -> dict[str, str]:
        return {**super()._headers(), 'User-Agent': 'AIC-Rating/1.0 (financial-document-service)'}
