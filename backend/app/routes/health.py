"""Health endpoint."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Request

from app.core.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health", summary="Backend health")
async def health(request: Request) -> dict[str, Any]:
    """Return the health of the backend and of the browser bridge."""
    settings = get_settings()
    extension_manager = request.app.state.extension_manager

    status = extension_manager.status()
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": settings.version,
        "environment": settings.environment,
        "timestamp": time.time(),
        "extension_connected": status.connected,
        "pending_requests": status.pending_requests,
    }
