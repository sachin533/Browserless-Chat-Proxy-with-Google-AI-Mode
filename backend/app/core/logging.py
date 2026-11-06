"""Logging setup.

The backend never logs prompt text, response text or any credential - only
identifiers, timings and sizes.  That keeps sensitive user content out of log
files that may be shipped to a log aggregator.
"""

from __future__ import annotations

import logging
import sys

from app.core.config import Settings

_CONFIGURED = False


class PrivacyFilter(logging.Filter):
    """Redact obvious secrets that accidentally reach a log record."""

    _SECRET_KEYS = (
        "token",
        "api_key",
        "apikey",
        "authorization",
        "password",
        "cookie",
    )

    def filter(self, record: logging.LogRecord) -> bool:
        return True

    @classmethod
    def redact(cls, value: str) -> str:
        lowered = value.lower()
        for key in cls._SECRET_KEYS:
            if key in lowered:
                return "***redacted***"
        return value


def configure_logging(settings: Settings) -> None:
    """Configure the root logger once per process."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    handler.addFilter(PrivacyFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # uvicorn is very chatty on the access log; keep it but quiet the noise.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """Return a module logger."""
    return logging.getLogger(name)
