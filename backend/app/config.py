"""Application settings, loaded from environment / .env."""
from __future__ import annotations

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
CONFIG_DIR = BASE_DIR / "app" / "configs"
SEED_DIR = BASE_DIR / "app" / "seed"
DATA_DIR = BASE_DIR / "data"
STORAGE_DIR = BASE_DIR / "data" / "storage"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    jwt_secret: str = "dev-secret-change-me"
    jwt_ttl_hours: int = 72
    database_url: str = "sqlite:///./data/negotiator.db"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    call_mode: str = "simulation"  # "simulation" | "live"

    elevenlabs_api_key: str = ""
    elevenlabs_agent_id: str = ""
    elevenlabs_intake_agent_id: str = ""  # conversational agent for the voice intake studio (falls back to agent_id)
    elevenlabs_phone_number_id: str = ""
    elevenlabs_webhook_secret: str = ""  # if set, the post-call webhook requires a matching x-webhook-secret header
    agent_tools_secret: str = ""  # if set, /api/agent-tools/* requires a matching Authorization header (the ElevenLabs workspace secret)
    public_base_url: str = ""

    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""

    google_places_api_key: str = ""
    anthropic_api_key: str = ""

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def live_calls_available(self) -> bool:
        return bool(
            self.elevenlabs_api_key
            and self.twilio_account_sid
            and self.twilio_auth_token
            and self.twilio_from_number
        )


settings = Settings()

# Ensure runtime dirs exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
