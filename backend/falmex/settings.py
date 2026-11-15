from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ".env"), env_prefix="FALMEX_", extra="ignore",
        populate_by_name=True,
    )

    data_dir: Path = REPO_ROOT / "data"
    schema_path: Path | None = None

    llm_provider: str = "mock"
    gemini_api_key: str | None = Field(
        default=None, validation_alias=AliasChoices("GEMINI_API_KEY", "FALMEX_GEMINI_API_KEY")
    )
    gemini_model: str = Field(
        default="gemini-flash-latest",
        validation_alias=AliasChoices("GEMINI_MODEL", "FALMEX_GEMINI_MODEL"),
    )

    cors_origins: list[str] = ["http://localhost:3000"]

    # Discovery defaults — tune once the real NASA data is known.
    test_fraction: float = 0.3
    alpha: float = 0.05
    min_samples: int = 8
    random_seed: int = 42


@lru_cache
def get_settings() -> Settings:
    return Settings()
