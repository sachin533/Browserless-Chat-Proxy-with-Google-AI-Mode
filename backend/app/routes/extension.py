"""Extension status, diagnostics and the WebSocket control channel."""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from typing import Any

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketDisconnected

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.security import extract_ws_token, verify_pairing_token
from app.schemas.extension import ExtensionClientInfo, ExtensionStatusResponse
from app.services.extension_protocol import handle_extension_message

logger = get_logger(__name__)

router = APIRouter(tags=["extension"])
ws_router = APIRouter()

AUTH_TIMEOUT_SECONDS = 15.0
HEARTBEAT_SECONDS = 30.0


@router.get(
    "/api/extension/status",
    response_model=ExtensionStatusResponse,
    summary="Extension and browser status",
)
async def extension_status(request: Request) -> ExtensionStatusResponse:
    """Report whether the extension is connected and whether AI Mode is usable."""
    settings = get_settings()
    extension_manager = request.app.state.extension_manager
    status = extension_manager.status()

    return ExtensionStatusResponse(
        connected=status.connected,
        session_id=status.session_id,
        ai_mode_tab_open=status.tab.ai_mode_tab_open,
        ai_mode_ready=status.tab.ai_mode_ready,
        logged_in=status.tab.logged_in,
        login_required=status.login_required,
        captcha_detected=status.tab.captcha_detected,
        page_url=status.tab.page_url,
        surface=status.tab.surface,
        pending_requests=status.pending_requests,
        last_seen_at=status.last_seen_at,
        connected_at=status.connected_at,
        pairing_token_configured=settings.pairing_token_configured,
        message=status.message,
    )


@router.post(
    "/api/extension/diagnose",
    summary="Inspect the live Google AI Mode DOM",
)
async def diagnose(request: Request) -> dict[str, Any]:
    """Ask the extension to report the selectors it can see on the live page.

    This is the escape hatch for layout changes: run it after Google updates
    the page and adjust the selector list in ``extension/lib/ai-mode-dom.js``
    accordingly.
    """
    service = request.app.state.google_ai_service
    result = await service.diagnose()
    return result


@ws_router.websocket("/ws/extension")
async def extension_socket(websocket: WebSocket) -> None:
    """Control channel between the backend and the Chrome extension."""
    settings = get_settings()
    extension_manager: Any = websocket.app.state.extension_manager
    request_manager: Any = websocket.app.state.request_manager

    # Starlette requires the socket to be accepted before it can be read.
    await websocket.accept()

    token = extract_ws_token(websocket)
    client = ExtensionClientInfo()

    if token is not None:
        # A token was supplied in the handshake - validate it immediately.
        if not verify_pairing_token(token, settings):
            logger.warning("Rejected an extension with an invalid pairing token")
            await _reject(websocket, "Invalid pairing token.")
            return
    else:
        # No token in the handshake: expect an `auth` message as the first frame.
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=AUTH_TIMEOUT_SECONDS)
        except (asyncio.TimeoutError, WebSocketDisconnect, WebSocketDisconnected):
            await websocket.close(code=1008, reason="authentication timeout")
            return

        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            message = {}

        if message.get("type") != "auth":
            await websocket.close(code=1008, reason="authentication required")
            return

        if not verify_pairing_token(message.get("token"), settings):
            logger.warning("Rejected an extension with an invalid pairing token")
            await _reject(websocket, "Invalid pairing token.")
            return
        client = _parse_client(message.get("client"))

    session_id = await extension_manager.register(websocket, client)

    await websocket.send_text(
        json.dumps(
            {
                "type": "auth_ok",
                "session_id": session_id,
                "server_time": time.time(),
                "heartbeat_seconds": HEARTBEAT_SECONDS,
            }
        )
    )

    heartbeat_task = asyncio.create_task(_heartbeat(websocket))
    try:
        while True:
            raw = await websocket.receive_text()
            extension_manager.touch()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("Received a non JSON message from the extension")
                continue

            await handle_extension_message(message, extension_manager, request_manager)
    except WebSocketDisconnect:
        logger.info("Extension closed the WebSocket")
    except Exception as exc:  # pragma: no cover - transport failure
        logger.warning("Extension WebSocket failed: %s", exc)
    finally:
        heartbeat_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task
        await extension_manager.unregister(websocket)
        failed = request_manager.fail_all(
            "extension_disconnected",
            "The Chrome extension disconnected while the request was running.",
        )
        if failed:
            logger.warning("Failed %d pending request(s) after the extension dropped", failed)


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
async def _reject(websocket: WebSocket, message: str) -> None:
    """Send a structured authentication error and close the socket."""
    await websocket.send_text(
        json.dumps(
            {
                "type": "auth_error",
                "error": {"code": "extension_auth_failed", "message": message},
            }
        )
    )
    await websocket.close(code=1008, reason="invalid pairing token")


def _parse_client(raw: Any) -> ExtensionClientInfo:
    if not isinstance(raw, dict):
        return ExtensionClientInfo()
    try:
        return ExtensionClientInfo(
            name=str(raw.get("name") or "google-ai-mode-extension"),
            version=str(raw.get("version") or "unknown"),
            user_agent=raw.get("user_agent"),
        )
    except Exception:  # pragma: no cover - defensive
        return ExtensionClientInfo()


async def _heartbeat(websocket: WebSocket) -> None:
    """Ping the extension so a dead socket is detected quickly."""
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            await websocket.send_text(json.dumps({"type": "ping", "timestamp": time.time()}))
    except asyncio.CancelledError:  # pragma: no cover - normal shutdown
        raise
    except Exception:  # pragma: no cover - transport failure
        return


async def _handle_extension_message(
    message: dict[str, Any], extension_manager: Any, request_manager: Any
) -> None:
    """Backwards compatible alias for :func:`handle_extension_message`."""
    await handle_extension_message(message, extension_manager, request_manager)
