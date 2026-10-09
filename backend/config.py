from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["development", "production"] = "development"
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    database_url: str = "sqlite:///./data/telecom.db"
    demo_access_token: SecretStr = SecretStr("")
    openai_api_key: SecretStr = SecretStr("")
    openai_text_model: str = "gpt-4.1-mini"
    openai_stt_model: str = "gpt-4o-mini-transcribe"
    openai_tts_model: str = "gpt-4o-mini-tts"
    openai_tts_voice: str = "alloy"
    openai_timeout_seconds: float = Field(default=30, gt=0, le=120)
    cors_origins: list[str] = Field(default_factory=list)
    static_dir: Path = Path("frontend/dist")

    @model_validator(mode="after")
    def validate_runtime(self) -> "Settings":
        if not self.database_url.startswith("sqlite:"):
            raise ValueError("This demo requires a synchronous SQLite database URL.")
        if self.app_env == "production" and not self.demo_access_token.get_secret_value().strip():
            raise ValueError("DEMO_ACCESS_TOKEN must be set in production.")
        if "*" in self.cors_origins:
            raise ValueError("CORS_ORIGINS must list explicit origins.")
        return self
