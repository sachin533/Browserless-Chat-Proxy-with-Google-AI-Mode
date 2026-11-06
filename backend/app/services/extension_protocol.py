"""Inbound message handling for the extension channel.

The protocol lives in its own module so that the WebSocket route and the test
harness process extension messages through exactly the same code path.
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.schemas.extension import ExtensionTabStatus

logger = get_logger(__name__)


async def handle_extension_message(
    message: dict[str, Any],
    extension_manager: Any,
    request_manager: Any,
) -> None:
    """Route a message received from the extension.

    * ``status``      - refreshes the browser state snapshot
    * ``job_delta``   - delivers an incremental answer update
    * ``job_result``  - resolves or fails a pending request
    * ``ping``        - answered with a ``pong``
    """
    message_type = message.get("type")

    if message_type == "status":
        payload = message.get("payload") or {}
        try:
            tab_status = ExtensionTabStatus(**payload)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Ignoring an invalid status payload: %s", exc)
            return
        extension_manager.update_tab_status(tab_status)
        return

    if message_type == "job_delta":
        request_id = message.get("request_id")
        payload = message.get("payload") or {}
        text = payload.get("text")
        if request_id and isinstance(text, str) and text:
            request_manager.delta(request_id, text)
        return

    if message_type == "job_result":
        request_id = message.get("request_id")
        if not request_id:
            return
        if message.get("ok", True):
            payload = message.get("payload") or {}
            text = payload.get("text")
            if not isinstance(text, str):
                request_manager.fail(
                    request_id,
                    "response_extraction_failed",
                    "The extension returned a result without any text.",
                )
                return
            request_manager.resolve(
                request_id,
                text,
                finish_reason=payload.get("finish_reason") or "stop",
                duration_ms=int(payload.get("duration_ms") or 0),
                source_url=payload.get("source_url"),
            )
        else:
            error = message.get("error") or {}
            request_manager.fail(
                request_id,
                error.get("code") or "upstream_error",
                error.get("message") or "The browser interaction failed.",
                error.get("details") or {},
            )
        return

    if message_type == "ping":
        await extension_manager.send({"type": "pong", "timestamp": _now()})
        return

    logger.debug("Ignoring an unknown extension message type: %s", message_type)


def _now() -> float:
    import time

    return time.time()
