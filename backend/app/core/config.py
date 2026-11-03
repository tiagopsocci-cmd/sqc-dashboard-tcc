from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    app_name: str = "SQC Dashboard"
    environment: str = Field(
        default="development",
        validation_alias=AliasChoices("ENVIRONMENT", "APP_ENV"),
    )
    database_url: str = "postgresql+asyncpg://sqc:sqc@localhost:5432/sqc"
    storage_root: Path = Field(
        default=_BACKEND_ROOT / "storage",
        validation_alias=AliasChoices("STORAGE_ROOT", "STORAGE_PATH"),
    )
    max_pdf_bytes: int = Field(default=20 * 1024 * 1024, gt=0)
    max_zip_bytes: int = Field(default=50 * 1024 * 1024, gt=0)
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
