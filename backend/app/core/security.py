"""Authentication helpers for the REST API and the extension WebSocket."""

from __future__ import annotations

import hmac
import secrets
from typing import Iterable

from fastapi import Request, WebSocket

from app.core.config import Settings, get_settings
from app.core.exceptions import AuthenticationError


def constant_time_equals(left: str, right: str) -> bool:
    """Timing-safe string comparison."""
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


def verify_pairing_token(candidate: str | None, settings: Settings | None = None) -> bool:
    """Return ``True`` when *candidate* matches the configured pairing token."""
    settings = settings or get_settings()
    expected = settings.extension_pairing_token
    if not expected or not candidate:
        return False
    return constant_time_equals(candidate, expected)


def verify_api_key(candidate: str | None, settings: Settings | None = None) -> bool:
    """Return ``True`` when *candidate* matches one of the configured API keys."""
    settings = settings or get_settings()
    keys: Iterable[str] = settings.api_key_list
    if not candidate:
        return False
    return any(constant_time_equals(candidate, key) for key in keys)


def extract_api_key(request: Request) -> str | None:
    """Pull the API key from the standard header locations."""
    header = request.headers.get("x-api-key")
    if header:
        return header.strip()
    authorization = request.headers.get("authorization")
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            return token.strip()
    return None


async def require_api_key(request: Request) -> None:
    """FastAPI dependency enforcing REST API authentication when enabled."""
    settings = get_settings()
    if not settings.require_api_key:
        return
    if not settings.api_key_list:
        # Misconfiguration: fail closed rather than exposing an open API.
        raise AuthenticationError(
            "API authentication is enabled but no API keys are configured.",
            code="auth_not_configured",
            status_code=500,
        )
    candidate = extract_api_key(request)
    if not verify_api_key(candidate, settings):
        raise AuthenticationError(
            "Missing or invalid API key. Send it via the 'X-API-Key' header "
            "or as a Bearer token."
        )


def extract_ws_token(websocket: WebSocket) -> str | None:
    """Extract the extension token from a WebSocket handshake.

    Accepted locations (in priority order):

    1. ``X-Extension-Token`` header
    2. ``token`` query parameter
    3. the first ``auth`` message sent by the extension (handled by the caller)
    """
    header = websocket.headers.get("x-extension-token")
    if header:
        return header.strip()
    query_token = websocket.query_params.get("token")
    if query_token:
        return query_token.strip()
    return None


def generate_pairing_token() -> str:
    """Create a cryptographically strong pairing token."""
    return secrets.token_urlsafe(32)
