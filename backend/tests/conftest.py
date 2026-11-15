import pandas as pd
import pytest
from fastapi.testclient import TestClient

from falmex import synthetic
from falmex.ai.providers import MockProvider
from falmex.api import create_app
from falmex.pipeline import standardize
from falmex.schema import Schema
from falmex.settings import Settings
from falmex.storage import Store


@pytest.fixture(scope="session")
def schema() -> Schema:
    return Schema.load()


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path / "data", llm_provider="mock", gemini_api_key=None)


@pytest.fixture
def store(settings) -> Store:
    s = Store(settings.data_dir)
    yield s
    s.close()


@pytest.fixture(scope="session")
def synthetic_frame(schema) -> pd.DataFrame:
    frame, _ = standardize(synthetic.generate(300, seed=1), schema, "synthetic000000")
    return frame


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings, provider=MockProvider())) as c:
        yield c
