"""First run bootstrap helpers.

The pairing token is never hard coded.  When it is missing the backend
generates a strong random token and stores it in the local ``.env`` file so
that the operator can copy it into the extension without touching code.
"""

from __future__ import annotations

import os
from pathlib import Path

from app.core.config import Settings
from app.core.logging import get_logger
from app.core.security import generate_pairing_token

logger = get_logger(__name__)


def _update_env_file(env_path: Path, key: str, value: str) -> bool:
    """Update or append ``KEY=value`` in an env file. Returns success."""
    try:
        existing = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    except OSError:
        existing = ""

    lines = existing.splitlines()
    replaced = False
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(f"{key}="):
            lines[index] = f"{key}={value}"
            replaced = True
            break
    if not replaced:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append(f"{key}={value}")

    try:
        env_path.parent.mkdir(parents=True, exist_ok=True)
        env_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
        return True
    except OSError as exc:
        logger.warning("Could not write %s: %s", env_path, exc)
        return False


def ensure_pairing_token(settings: Settings, env_path: Path | None = None) -> str:
    """Return a usable pairing token, generating and persisting one if needed."""
    if settings.extension_pairing_token:
        return settings.extension_pairing_token

    if not settings.auto_generate_pairing_token:
        raise RuntimeError(
            "EXTENSION_PAIRING_TOKEN is not configured and auto generation is "
            "disabled. Set the token in the backend .env file."
        )

    token = generate_pairing_token()
    settings.extension_pairing_token = token

    target = env_path or Path(os.environ.get("GAIM_ENV_FILE", ".env")).resolve()
    persisted = _update_env_file(target, "EXTENSION_PAIRING_TOKEN", token)

    logger.warning("=" * 78)
    logger.warning("EXTENSION_PAIRING_TOKEN was not configured - a new one was generated.")
    logger.warning("Token: %s", token)
    if persisted:
        logger.warning("The token was saved to %s", target)
    else:
        logger.warning("The token could NOT be saved - copy it manually.")
    logger.warning("Paste this token into the extension popup (Backend settings).")
    logger.warning("=" * 78)
    return token
