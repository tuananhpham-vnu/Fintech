import pytest
from fastapi.testclient import TestClient

from runner.app import create_app
from runner.backends import GoldFixtures, MockBackend
from runner.config import DEFAULT_CONTRACTS_DIR, DEFAULT_FIXTURES_DIR, MODE_LIVE, MODE_MOCK, Settings
from runner.contracts import Contracts

KEY = "test-internal-key"
HEADERS = {"X-Internal-Key": KEY}


def make_settings(mode: str = MODE_MOCK, key: str | None = KEY) -> Settings:
    return Settings(internal_api_key=key, mode=mode, model_id="", prompt_version="",
                    contracts_dir=DEFAULT_CONTRACTS_DIR, fixtures_dir=DEFAULT_FIXTURES_DIR, gemini_key_configured=False)


@pytest.fixture(scope="session")
def contracts() -> Contracts:
    return Contracts(DEFAULT_CONTRACTS_DIR)


@pytest.fixture(scope="session")
def examples(contracts) -> list[dict]:
    return contracts.load("examples.json")


@pytest.fixture(scope="session")
def gold() -> GoldFixtures:
    return GoldFixtures(DEFAULT_FIXTURES_DIR)


@pytest.fixture
def client(contracts) -> TestClient:
    return TestClient(create_app(make_settings(), contracts=contracts))


@pytest.fixture
def live_client(contracts) -> TestClient:
    return TestClient(create_app(make_settings(MODE_LIVE), contracts=contracts))


def example(examples: list[dict], name: str) -> dict:
    return next(e["value"] for e in examples if e["name"] == name)


class TamperingBackend(MockBackend):
    """Mock trả gold rồi bị sửa: kiểm guard không để output sai lọt ra."""

    def __init__(self, fixtures, tamper):
        super().__init__(fixtures)
        self.tamper = tamper

    def evaluate(self, payload: dict) -> dict:
        output = super().evaluate(payload)
        self.tamper(output)
        return output
