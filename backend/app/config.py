"""Application configuration loaded from environment variables.

Only placeholder values live here; real secrets must be provided through the
environment (see .env.example) and never committed to the repository.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _list(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def _database_url() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:///./deploysphere.db")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "DeploySphere")
    environment: str = os.getenv("ENVIRONMENT", "development")
    # Demo mode serves clearly-labelled sample data and starts the local
    # telemetry simulator. Disable it when real integrations are configured.
    demo_mode: bool = _bool("DEMO_MODE", True)
    simulator_enabled: bool = _bool("SIMULATOR_ENABLED", True)

    database_url: str = _database_url()
    redis_url: str = os.getenv("REDIS_URL", "")

    # PLACEHOLDER VALUE - replace in every non-local environment.
    secret_key: str = os.getenv("SECRET_KEY", "dev-only-secret-change-me-000000000000")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
    refresh_token_expire_days: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "14"))

    cors_origins: list[str] = field(
        default_factory=lambda: _list(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        )
    )
    allow_credentials: bool = True

    login_rate_limit: int = int(os.getenv("LOGIN_RATE_LIMIT", "10"))
    login_rate_window_seconds: int = int(os.getenv("LOGIN_RATE_WINDOW_SECONDS", "60"))

    # How often the demo simulator persists telemetry samples to the database.
    telemetry_persist_interval: int = int(os.getenv("TELEMETRY_PERSIST_INTERVAL", "30"))
    log_retention_days: int = int(os.getenv("LOG_RETENTION_DAYS", "30"))

    github_webhook_secret: str = os.getenv("GITHUB_WEBHOOK_SECRET", "")

    @property
    def is_demo(self) -> bool:
        return self.demo_mode

    @property
    def uses_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


settings = Settings()
