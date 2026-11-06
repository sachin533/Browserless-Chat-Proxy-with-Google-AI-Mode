"""Connection registry for the Chrome extension.

The backend talks to exactly one browser session at a time: the extension is
the only component that can drive the user's Google AI Mode tab, so a single
active WebSocket is the source of truth for the whole pipeline.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any

from fastapi import WebSocket

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.schemas.extension import (
    ExtensionClientInfo,
    ExtensionStatus,
    ExtensionTabStatus,
)

logger = get_logger(__name__)


class ExtensionManager:
    """Owns the WebSocket connection to the Chrome extension."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._websocket: WebSocket | None = None
        self._session_id: str | None = None
        self._client: ExtensionClientInfo | None = None
        self._connected_at: float | None = None
        self._last_seen_at: float | None = None
        self._last_message_at: float | None = None
        self._tab_status = ExtensionTabStatus()
        self._send_lock = asyncio.Lock()
        self._listeners: set[asyncio.Queue[dict[str, Any]]] = set()
        self._pending_requests = 0

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------
    @property
    def is_connected(self) -> bool:
        return self._websocket is not None

    @property
    def session_id(self) -> str | None:
        return self._session_id

    @property
    def websocket(self) -> WebSocket | None:
        return self._websocket

    async def register(
        self, websocket: WebSocket, client: ExtensionClientInfo
    ) -> str:
        """Register a freshly authenticated extension connection."""
        previous = self._websocket
        if previous is not None and previous is not websocket:
            logger.warning("Replacing an already connected extension session")
            try:
                await previous.close(code=4001, reason="replaced by a new extension")
            except Exception:  # pragma: no cover - best effort cleanup
                pass

        self._websocket = websocket
        self._session_id = uuid.uuid4().hex
        self._client = client
        self._connected_at = time.time()
        self._last_seen_at = time.time()
        self._last_message_at = time.time()
        self._tab_status = ExtensionTabStatus()
        logger.info("Extension connected (session=%s, client=%s)", self._session_id, client.name)
        return self._session_id

    async def unregister(self, websocket: WebSocket | None = None) -> None:
        """Remove the connection if it is the active one."""
        if websocket is not None and self._websocket is not websocket:
            return
        if self._websocket is None:
            return
        self._websocket = None
        self._session_id = None
        self._client = None
        self._connected_at = None
        self._tab_status = ExtensionTabStatus()
        logger.info("Extension disconnected")
        await self._broadcast({"type": "extension_disconnected"})

    # ------------------------------------------------------------------
    # Outbound messages
    # ------------------------------------------------------------------
    async def send(self, payload: dict[str, Any]) -> bool:
        """Send a JSON payload to the extension. Returns ``False`` on failure."""
        websocket = self._websocket
        if websocket is None:
            return False
        try:
            async with self._send_lock:
                await websocket.send_text(json.dumps(payload, default=str))
            self._last_message_at = time.time()
            return True
        except Exception as exc:  # pragma: no cover - transport failure
            logger.warning("Failed to send %s to the extension: %s", payload.get("type"), exc)
            return False

    # ------------------------------------------------------------------
    # Inbound state
    # ------------------------------------------------------------------
    def touch(self) -> None:
        self._last_seen_at = time.time()
        self._last_message_at = time.time()

    def update_tab_status(self, status: ExtensionTabStatus) -> None:
        self._tab_status = status
        self._last_seen_at = time.time()

    def set_pending_requests(self, count: int) -> None:
        self._pending_requests = count

    @property
    def tab_status(self) -> ExtensionTabStatus:
        return self._tab_status

    @property
    def pending_requests(self) -> int:
        return self._pending_requests

    def status(self) -> ExtensionStatus:
        """Build the current status snapshot."""
        connected = self.is_connected
        tab = self._tab_status
        if not connected:
            message = "The Chrome extension is not connected to the backend."
        elif tab.captcha_detected:
            message = "Google is showing a CAPTCHA in the AI Mode tab. Solve it manually."
        elif not tab.ai_mode_tab_open:
            message = "No Google AI Mode tab is open. Open it from the extension popup."
        elif not tab.logged_in:
            message = "Google sign-in is required in the AI Mode tab. Log in manually."
        elif not tab.ai_mode_ready:
            message = "The Google AI Mode page is not ready yet. Open the tab and retry."
        else:
            message = "The extension is connected and Google AI Mode is ready."

        return ExtensionStatus(
            connected=connected,
            session_id=self._session_id,
            client=self._client,
            connected_at=self._connected_at,
            last_seen_at=self._last_seen_at,
            last_message_at=self._last_message_at,
            pending_requests=self._pending_requests,
            tab=tab,
            login_required=not tab.logged_in,
            message=message,
        )

    # ------------------------------------------------------------------
    # Status broadcasting
    # ------------------------------------------------------------------
    def add_listener(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._listeners.add(queue)

    def remove_listener(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._listeners.discard(queue)

    async def _broadcast(self, payload: dict[str, Any]) -> None:
        for queue in list(self._listeners):
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:  # pragma: no cover - defensive
                logger.warning("Dropping status broadcast: listener queue is full")
