"""Application configuration.

Every setting is overridable through environment variables (or a ``.env`` file
placed next to the backend package).  Secrets are never hard coded: the
extension pairing token and the REST API keys must be supplied by the operator.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


class Settings(BaseSettings):
    """Runtime settings for the Google AI Mode API backend."""

    model_config = SettingsConfigDict(
        env_file=(".env",),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ------------------------------------------------------------------
    # Service metadata
    # ------------------------------------------------------------------
    app_name: str = "Google AI Mode API"
    version: str = "1.0.0"
    environment: str = "development"
    debug: bool = False
    log_level: str = "INFO"

    # ------------------------------------------------------------------
    # HTTP server
    # ------------------------------------------------------------------
    host: str = "127.0.0.1"
    port: int = 8000
    root_path: str = ""

    # ------------------------------------------------------------------
    # Security
    # ------------------------------------------------------------------
    # Shared secret used by the Chrome extension to authenticate itself over
    # the WebSocket channel.  Leave empty to auto-generate one on first run.
    extension_pairing_token: str = ""
    auto_generate_pairing_token: bool = True

    # Comma separated list of REST API keys.  Empty + require_api_key=False
    # keeps the REST API open for local development.
    api_keys: str = ""
    require_api_key: bool = False

    # Allow plain (non TLS) WebSocket / HTTP connections to non loopback
    # hosts.  Must stay False in production: tokens would travel in clear
    # text.
    allow_insecure_transport: bool = True

    # ------------------------------------------------------------------
    # CORS
    # ------------------------------------------------------------------
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: list(DEFAULT_CORS_ORIGINS)
    )
    cors_allow_credentials: bool = False

    # ------------------------------------------------------------------
    # Request handling
    # ------------------------------------------------------------------
    # Hard upper bound for a single browser interaction (seconds).
    request_timeout_seconds: float = 180.0
    # How long a request may wait for the browser session to become free.
    queue_wait_timeout_seconds: float = 60.0
    # The browser tab is a single shared resource: one prompt at a time.
    max_concurrent_requests: int = 1
    # Maximum number of requests that may be queued/pending at once.
    max_pending_requests: int = 20
    # Maximum accepted prompt length (characters).
    max_prompt_chars: int = 8000
    # Maximum accepted HTTP body size (bytes).
    max_request_bytes: int = 1_048_576
    # Simple token bucket rate limit for the REST API.
    rate_limit_requests: int = 60
    rate_limit_window_seconds: int = 60

    # ------------------------------------------------------------------
    # Google AI Mode behaviour
    # ------------------------------------------------------------------
    # Model identifiers accepted by the OpenAI compatible endpoint.
    supported_models: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "google-ai-mode",
            "ai-mode",
            "google-ai",
            "gemini",
            "gpt-4o-mini",
            "gpt-4o",
        ]
    )
    # Ask the extension to start a brand new AI Mode conversation for every
    # request so that answers never inherit earlier context.
    reset_conversation_per_request: bool = True

    # ------------------------------------------------------------------
    # Validators
    # ------------------------------------------------------------------
    @field_validator("cors_origins", "supported_models", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        """Allow comma separated values in ``.env`` files."""
        if value is None:
            return value
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                # Allow a JSON array as well.
                import json

                try:
                    return json.loads(stripped)
                except json.JSONDecodeError:
                    pass
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @property
    def api_key_list(self) -> list[str]:
        """Parsed list of configured REST API keys."""
        return [key.strip() for key in self.api_keys.split(",") if key.strip()]

    @property
    def pairing_token_configured(self) -> bool:
        return bool(self.extension_pairing_token)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached settings singleton."""
    return Settings()
